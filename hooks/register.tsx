import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type { ActivityAgent, ActivityCategory, ActivitySnapshot, ActivityTask, ActivityTodo, ActivityTool } from '../types'
import { demoSnapshot } from './demo'
import { dashboard, line } from './draw'
import { fit, plain, summary } from './model'

const PANE = 'activity'
const TICK_MS = 1000
const BREAKDOWN_EVERY_MS = 15_000
const LIVE: ReadonlySet<AgentStatus> = new Set(['pending', 'running', 'waiting'])
// Surfaces that draw the line under the prompt; any other gets the status text.
const LINE_SURFACES: ReadonlySet<RenderSurface> = new Set(['terminal', 'desktop'])
// The engine's hint row is indented 2; the line adds 2 more and keeps 2 spare.
const LINE_INSET = 6

const EMPTY: ActivitySnapshot = { now: 0, categories: [], rateLimits: [], tools: [], agents: [], tasks: [], todos: [] }
const snapshot = atom({ plugin: 'activity-line', key: 'snapshot' } as const, EMPTY)

// ── Live figures ────────────────────────────────────────────────────────────
// Module state: a hot reload starts it over; session.start restores the last
// snapshot from $.state, which the host keeps for the session.
const calls = new Map<string, ActivityTool>()
const firstSeen = new Map<string, number>()
let tasks: ActivityTask[] = []
let todos: ActivityTodo[] = []
let agents: ActivityAgent[] = []
let categories: ActivityCategory[] = []
let context: ActivitySnapshot['context']
let compactAt: number | undefined
let model: string | undefined
let startedAt: number | undefined
let rateLimits: ActivitySnapshot['rateLimits'] = []
let costUsd: number | undefined
let surfaces: RenderSurface[] = []
let isDemo = false
let published = ''
let statusText: string | undefined
let breakdownAt = 0
let breakdownPending: Timer | undefined
let ticker: Timer | undefined
// /activity output rows: the newest stays live, older ones fold to a line.
const seenRows = new Set<string>()
let newestRow: string | undefined
let nextId = 0

function current(now: number): ActivitySnapshot {
  if (isDemo) return demoSnapshot(now)
  return {
    now,
    startedAt,
    model,
    context: context && { ...context, compactAt },
    categories,
    rateLimits,
    costUsd,
    tools: [...calls.values()],
    agents,
    tasks,
    todos,
  }
}

/**
 * Writes the snapshot when what it shows changed: each second while anything
 * runs (elapsed times tick), else every 15 s (reset countdowns, session age).
 */
async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const next = current(now)
  const isBusy = next.tools.length + next.agents.length + next.tasks.length > 0
  const key = JSON.stringify({ ...next, now: Math.floor(now / (isBusy ? 1000 : 15_000)) })
  if (key !== published) {
    published = key
    await update($, snapshot, () => next)
  }
  // VS Code and the other remote surfaces draw no line under the prompt; they
  // get the same line as this plugin's status text.
  const wantsText = surfaces.some(s => !LINE_SURFACES.has(s))
  const text = wantsText ? plain(fit(next, 160)) || undefined : undefined
  if (text !== statusText) {
    statusText = text
    $.ui.status(text)
  }
}

/**
 * The model, the auto-compact threshold and what fills the context, as
 * /context counts them (estimated locally). At most every 15 s; a call inside
 * that window is postponed to its end rather than dropped, so a /model switch
 * is never left unmeasured.
 */
async function measureBreakdown($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const wait = breakdownAt + BREAKDOWN_EVERY_MS - now
  if (wait > 0) {
    breakdownPending ??= $.clock.after(wait, () => {
      breakdownPending = undefined
      measureBreakdown($)
        .then(() => publish($))
        .catch(() => undefined)
    })
    return
  }
  breakdownAt = now
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (b === undefined) return
  model = b.model
  compactAt = b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined
  categories = b.categories
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((x, y) => y.tokens - x.tokens)
    .map(c => ({ name: c.name, tokens: c.tokens, color: c.color }))
}

/** The status line's figures: free to read, so read every second, mid-turn too. */
async function readUsage($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  startedAt = usage.startedAt
  context = usage.context
  rateLimits = usage.rateLimits
  costUsd = usage.cost?.usd
}

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await readUsage($)
  const live = (await $.agent.list()).filter(a => LIVE.has(a.status))
  const ids = new Set(live.map(a => a.id))
  for (const id of firstSeen.keys()) if (!ids.has(id)) firstSeen.delete(id)
  agents = live.map(a => {
    if (!firstSeen.has(a.id)) firstSeen.set(a.id, now)
    return { id: a.id, type: a.type, description: a.description, status: a.status, since: firstSeen.get(a.id) ?? now }
  })
  await publish($)
}

/**
 * A new conversation in the same process (/clear, /resume): nothing of the
 * old one stays. The state resets at once; the fresh figures are read just
 * after, outside session.end's short time budget.
 */
async function startOver($: EngineInterface): Promise<void> {
  calls.clear()
  firstSeen.clear()
  todos = []
  agents = []
  tasks = []
  categories = []
  context = undefined
  costUsd = undefined
  breakdownAt = 0
  await publish($)
  $.clock.after(100, () => {
    readUsage($)
      .then(() => measureBreakdown($))
      .then(() => publish($))
      .catch(() => undefined)
  })
}

async function restore($: EngineInterface): Promise<void> {
  const saved = await read($, snapshot)
  if (todos.length === 0) todos = saved.todos
  if (tasks.length === 0) tasks = saved.tasks ?? []
  if (categories.length === 0) categories = saved.categories ?? []
  // Agents keep their age across a reload.
  for (const a of saved.agents ?? []) if (!firstSeen.has(a.id)) firstSeen.set(a.id, a.since)
  context ??= saved.context
  compactAt ??= saved.context?.compactAt
  model ??= saved.model
  if (rateLimits.length === 0) rateLimits = saved.rateLimits
  costUsd ??= saved.costUsd
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const placement = String(options.placement ?? 'below')
  const openPane = String(options.openPane ?? 'never')

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    isDemo = (await $.env.get('ACTIVITY_LINE_DEMO')) === '1'
    await $.command.register({
      name: 'activity',
      description: 'Open the activity dashboard: context, rate limits, what is running, todos',
    })
    await restore($)
    await readUsage($)
    surfaces = [...(await $.session.surfaces())]
    await measureBreakdown($).catch(() => undefined)
    await publish($)

    if (openPane === 'always' && surfaces.includes('terminal')) void $.ui.open({ id: PANE, title: 'Activity' })

    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      tick($).catch(() => undefined)
    })
    return result
  })

  // The VS Code panel and the other remote surfaces attach after the session
  // starts; those without a line under the prompt get the status text.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    if (!surfaces.includes(e.surface)) surfaces.push(e.surface)
    await publish($)
    return result
  })

  on('session.detach', async ($, e, next) => {
    const result = await next(e)
    if (e.reason !== 'end') {
      surfaces = [...(await $.session.surfaces())]
      await publish($)
    }
    return result
  })

  // /activity: in the terminal the dashboard opens as a pane; the VS Code
  // panel draws no panes, so there it is drawn live in the command's own
  // output row (below). The text is the summary the model reads, and what a
  // surface that draws neither shows.
  on('command.run', { command: 'activity' }, async $ => {
    if (surfaces.includes('terminal')) void $.ui.open({ id: PANE, title: 'Activity' })
    return { text: summary(await read($, snapshot)) }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'activity' } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    if (e.surface === 'terminal') return next({ ...e, props: { ...e.props, text: 'Activity dashboard opened above the prompt.' } })
    if (!seenRows.has(e.requestId)) {
      seenRows.add(e.requestId)
      newestRow = e.requestId
    }
    const t = $.ui.resolve(e)
    if (e.requestId !== newestRow) return <t.Text color="inactive">Activity snapshot; the newest /activity below is live.</t.Text>
    return dashboard(t, await read($, snapshot), e.viewport?.columns ?? 100)
  })

  on('session.measure', async ($, e, next) => {
    context = e.context
    rateLimits = e.rateLimits
    costUsd = e.cost?.usd
    if (e.changed.includes('context')) await measureBreakdown($).catch(() => undefined)
    await publish($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? `local-${nextId++}`
    try {
      calls.set(id, { id, tool: String(e.tool), startedAt: await $.clock.now(), agentId: e.agentId })
      await publish($).catch(() => undefined)
      const ran = await next(e)
      const isOk = ran.deny === undefined && ran.isError !== true
      if (isOk && e.tool === 'TodoWrite' && e.agentId === undefined) {
        todos = e.todos.map(({ content, status, activeForm }) => ({ content, status, activeForm }))
      }
      // A shell goes to the background when asked, on ctrl+b or on its
      // timeout; each way its result names the task. A monitor always does.
      if (isOk && e.tool === 'Bash') {
        const taskId = (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId
        if (taskId !== undefined) tasks = [...tasks, { id: taskId, type: 'shell', description: e.description ?? e.command, since: await $.clock.now() }]
      }
      if (isOk && e.tool === 'Monitor') {
        const taskId = (ran.result as { taskId?: string } | undefined)?.taskId
        if (taskId !== undefined) tasks = [...tasks, { id: taskId, type: 'monitor', description: e.description, since: await $.clock.now() }]
      }
      if (isOk && e.tool === 'TaskStop') {
        const stopped = e.task_id ?? e.shell_id
        tasks = tasks.filter(task => task.id !== stopped)
      }
      return ran
    } finally {
      calls.delete(id)
      await publish($).catch(() => undefined)
    }
  })

  // The end of every main turn lists the background work still in flight: the
  // authoritative list, which also drops what finished in between.
  on('classic.Stop', async ($, e, next) => {
    const now = await $.clock.now()
    const before = new Map(tasks.map(task => [task.id, task.since]))
    tasks = (e.background_tasks ?? [])
      .filter(task => task.type !== 'subagent')
      .map(task => ({
        id: task.id,
        type: task.type,
        description: task.command ?? task.name ?? task.description,
        since: before.get(task.id) ?? now,
      }))
    await publish($)
    return next(e)
  })

  // A safety net: a call whose result never came back leaves no ghost behind
  // once the loop that made it is done.
  on('turn.complete', async ($, e, next) => {
    for (const [id, call] of calls) {
      if (call.agentId === e.agentId) calls.delete(id)
    }
    if (e.agentId === undefined) await measureBreakdown($).catch(() => undefined)
    await publish($)
    return next(e)
  })

  // /clear and /resume end one conversation and go on with another in the
  // same process; no session.start follows. Any other end is the process's.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await startOver($).catch(() => undefined)
    return result
  })

  // The line under the prompt, beneath the engine's own hint row, which stays
  // as the engine draws it (its pills live).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    if (placement !== 'below') return engine
    const rows = fit(await read($, snapshot), (e.viewport?.columns ?? 120) - LINE_INSET)
    if (rows.length === 0) return engine
    const t = $.ui.resolve(e)
    return (
      <t.Box flexDirection="column">
        {engine}
        <t.Box paddingLeft={2}>{line(t, rows)}</t.Box>
      </t.Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (placement !== 'above' || e.props.hasSurvey) return next(e)
    const rows = fit(await read($, snapshot), e.props.bodyColumns - 1)
    if (rows.length === 0) return next(e)
    return line($.ui.resolve(e), rows)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return dashboard($.ui.resolve(e), await read($, snapshot), e.props.bodyColumns, e.props.scroll.bodyRows)
  })
}
