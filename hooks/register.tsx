import { atom, read, update } from 'claude-code'
import type { AgentStatus, Color, EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import type { ActivityAgent, ActivitySnapshot, ActivityTodo, ActivityTool } from '../types'
import {
  bar,
  contextTone,
  cut,
  duration,
  elapsedTone,
  fit,
  groupTools,
  limitTitle,
  limitTone,
  resetIn,
  SEPARATOR,
  todoCounts,
  tokens,
} from './model'
import type { Part, Seg, Tone } from './model'

const PANE = 'activity'
const TICK_MS = 1500
const LIVE: ReadonlySet<AgentStatus> = new Set(['pending', 'running', 'waiting'])

const EMPTY: ActivitySnapshot = { now: 0, rateLimits: [], tools: [], agents: [], todos: [] }
const snapshot = atom({ plugin: 'activity-line', key: 'snapshot' } as const, EMPTY)

/** Theme colours, so the line reads in light and dark themes alike. */
const STYLE: Record<Tone, { color?: Color; dimColor?: boolean }> = {
  ok: { color: 'success' },
  warn: { color: 'warning' },
  crit: { color: 'error' },
  label: { dimColor: true },
  muted: { color: 'inactive' },
  text: {},
  tool: { color: 'suggestion' },
  agent: { color: 'merged' },
  todo: { color: 'planMode' },
  cost: { color: 'claude' },
}

type Tables = ReturnType<EngineInterface['ui']['resolve']>
type Call = ActivityTool & { agentId?: string }

// The live figures. A hot reload starts these over; session.start restores
// the last snapshot from $.state, which the host keeps.
const calls = new Map<string, Call>()
let todos: ActivityTodo[] = []
let agents: ActivityAgent[] = []
let context: ActivitySnapshot['context']
let rateLimits: ActivitySnapshot['rateLimits'] = []
let costUsd: number | undefined
let published = ''
let ticker: Timer | undefined
let nextId = 0

/** Writes the snapshot when what it shows changed: each second while a tool runs, else each minute. */
async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const tools = [...calls.values()].map(({ tool, startedAt, inAgent }) => ({ tool, startedAt, inAgent }))
  const next: ActivitySnapshot = { now, context, rateLimits, costUsd, tools, agents, todos }
  const grain = tools.length > 0 ? 1000 : 60_000
  const key = JSON.stringify({ ...next, now: Math.floor(now / grain) })
  if (key === published) return
  published = key
  await update($, snapshot, () => next)
}

async function tick($: EngineInterface): Promise<void> {
  agents = (await $.agent.list())
    .filter(a => LIVE.has(a.status))
    .map(a => ({ id: a.id, type: a.type, description: a.description, status: a.status }))
  await publish($)
}

async function restore($: EngineInterface): Promise<void> {
  const saved = await read($, snapshot)
  if (todos.length === 0) todos = saved.todos
  context ??= saved.context
  if (rateLimits.length === 0) rateLimits = saved.rateLimits
  costUsd ??= saved.costUsd
}

function styled(Text: Tables['Text'], seg: Seg): RenderElement {
  return (
    <Text {...STYLE[seg.tone]} bold={seg.bold}>
      {seg.text}
    </Text>
  )
}

function line(Text: Tables['Text'], parts: readonly Part[]): RenderElement {
  const children: RenderElement[] = []
  parts.forEach((part, i) => {
    if (i > 0) children.push(<Text color="inactive">{SEPARATOR}</Text>)
    for (const seg of part.segs) children.push(styled(Text, seg))
  })
  return <Text wrap="truncate-end">{children}</Text>
}

function meter(t: Tables, label: string, percent: number, tone: Tone, cells: number, after: string): RenderElement {
  const { filled, empty } = bar(percent, cells)
  return (
    <t.Box>
      <t.Text dimColor>{label.padEnd(9)}</t.Text>
      <t.Text {...STYLE[tone]}>{filled}</t.Text>
      <t.Text color="inactive">{empty}</t.Text>
      <t.Text {...STYLE[tone]} bold>
        {` ${String(percent).padStart(3)}%`}
      </t.Text>
      <t.Text color="inactive">{`  ${after}`}</t.Text>
    </t.Box>
  )
}

function heading(t: Tables, title: string, count: string): RenderElement {
  return (
    <t.Box marginTop={1}>
      <t.Text bold>{title}</t.Text>
      <t.Text color="inactive">{` ${count}`}</t.Text>
    </t.Box>
  )
}

function dashboard(t: Tables, s: ActivitySnapshot, columns: number): RenderElement {
  const cells = Math.max(8, Math.min(30, columns - 28))
  const rows: RenderElement[] = []

  if (s.context?.percent !== undefined && s.context.tokens !== undefined) {
    const { percent, tokens: used, window } = s.context
    rows.push(meter(t, 'Context', percent, contextTone(percent), cells, `${tokens(used)} / ${tokens(window)}`))
  } else {
    rows.push(
      <t.Text color="inactive">{`${'Context'.padEnd(9)}no reading yet${s.context ? ` (window ${tokens(s.context.window)})` : ''}`}</t.Text>,
    )
  }
  for (const limit of s.rateLimits) {
    const reset = resetIn(limit, s.now, true)
    rows.push(meter(t, limitTitle(limit.kind), limit.percentUsed, limitTone(limit.percentUsed), cells, reset ? `resets in ${reset}` : ''))
  }
  if (s.costUsd !== undefined) {
    rows.push(
      <t.Box>
        <t.Text dimColor>{'Cost'.padEnd(9)}</t.Text>
        <t.Text {...STYLE.cost} bold>{`$${s.costUsd.toFixed(2)}`}</t.Text>
      </t.Box>,
    )
  }

  const groups = groupTools(s.tools)
  rows.push(heading(t, 'Tools', groups.length === 0 ? 'idle' : `${s.tools.length} running`))
  for (const g of groups) {
    const elapsed = s.now - g.startedAt
    rows.push(
      <t.Box>
        <t.Text {...STYLE.tool}>{'  ● '}</t.Text>
        <t.Text {...STYLE.tool} bold>{cut(g.name, columns - 20)}</t.Text>
        <t.Text color="inactive">{g.count > 1 ? ` ×${g.count}` : ''}</t.Text>
        <t.Text {...STYLE[elapsedTone(elapsed)]}>{`  ${duration(elapsed)}`}</t.Text>
      </t.Box>,
    )
  }

  rows.push(heading(t, 'Agents', s.agents.length === 0 ? 'none running' : `${s.agents.length} running`))
  for (const a of s.agents) {
    rows.push(
      <t.Box>
        <t.Text {...STYLE.agent}>{'  ◆ '}</t.Text>
        <t.Text {...STYLE.agent} bold>{a.type}</t.Text>
        <t.Text color={a.status === 'running' ? 'success' : 'warning'}>{`  ${a.status}`}</t.Text>
        <t.Text>{`  ${cut(a.description, Math.max(10, columns - a.type.length - 20))}`}</t.Text>
      </t.Box>,
    )
  }

  const { done, total } = todoCounts(s.todos)
  rows.push(heading(t, 'Todos', total === 0 ? 'no list yet' : `${done}/${total} done`))
  for (const todo of s.todos) {
    const isDone = todo.status === 'completed'
    const isActive = todo.status === 'in_progress'
    const mark = isDone ? '  ☑ ' : isActive ? '  ◐ ' : '  ☐ '
    const tone: Tone = isDone ? 'ok' : isActive ? 'todo' : 'muted'
    rows.push(
      <t.Box>
        <t.Text {...STYLE[tone]}>{mark}</t.Text>
        <t.Text {...(isActive ? STYLE.todo : isDone ? STYLE.muted : {})} bold={isActive} strikethrough={isDone}>
          {cut(isActive ? todo.activeForm || todo.content : todo.content, columns - 6)}
        </t.Text>
      </t.Box>,
    )
  }

  return <t.Box flexDirection="column">{rows}</t.Box>
}

export const register: Register = (on, options) => {
  const placement = String(options.placement ?? 'below')
  const openPane = String(options.openPane ?? 'auto')

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'activity',
      description: 'Open the activity dashboard: context, rate limits, tools, agents and todos',
    })
    await restore($)
    const usage = await $.session.usage()
    context = usage.context
    rateLimits = usage.rateLimits
    costUsd = usage.cost?.usd
    await publish($)

    // Surfaces with no line under the prompt (VS Code, the mobile app) get the pane.
    const surfaces = await $.session.surfaces()
    const hasLine = surfaces.includes('terminal') || surfaces.includes('desktop')
    if (openPane === 'always' || (openPane === 'auto' && surfaces.length > 0 && !hasLine)) {
      void $.ui.open({ id: PANE, title: 'Activity' })
    }

    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      tick($).catch(() => undefined)
    })
    return result
  })

  on('command.run', { command: 'activity' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Activity' })
    return { text: opened.isPlaced ? 'Activity dashboard opened.' : 'Activity dashboard opened; it shows once this surface has room for it.' }
  })

  on('session.measure', async ($, e, next) => {
    context = e.context
    rateLimits = e.rateLimits
    costUsd = e.cost?.usd
    await publish($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? `local-${nextId++}`
    calls.set(id, { tool: String(e.tool), startedAt: await $.clock.now(), inAgent: e.agentId !== undefined, agentId: e.agentId })
    await publish($)
    try {
      const ran = await next(e)
      if (e.tool === 'TodoWrite' && ran.deny === undefined && ran.isError !== true && e.agentId === undefined) {
        todos = e.todos.map(({ content, status, activeForm }) => ({ content, status, activeForm }))
      }
      return ran
    } finally {
      calls.delete(id)
      await publish($)
    }
  })

  // A safety net: a call whose result never came back leaves no ghost behind
  // once the loop that made it is done.
  on('turn.complete', async ($, e, next) => {
    for (const [id, call] of calls) {
      if (call.agentId === e.agentId) calls.delete(id)
    }
    await publish($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      calls.clear()
      todos = []
      agents = []
      context = undefined
      costUsd = undefined
      await publish($)
    } else {
      ticker?.cancel()
    }
    return next(e)
  })

  // The line under the prompt: the engine's own hint row stays as it is (its
  // pills live), and the activity row is drawn beneath it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    if (placement !== 'below') return engine
    const parts = fit(await read($, snapshot), (e.viewport?.columns ?? 120) - 2)
    if (parts.length === 0) return engine
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {engine}
        {line(Text, parts)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (placement !== 'above' || e.props.hasSurvey) return next(e)
    const parts = fit(await read($, snapshot), e.props.bodyColumns)
    if (parts.length === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    return line(Text, parts)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    return dashboard(t, await read($, snapshot), e.props.bodyColumns)
  })
}
