import type { ActivityAgent, ActivityContext, ActivityLimit, ActivitySnapshot, ActivityTodo, ActivityTool } from '../types'

/** What a piece of text means; the render hooks map each to a theme colour. */
export type Tone = 'ok' | 'warn' | 'crit' | 'label' | 'muted' | 'text' | 'tool' | 'agent' | 'task' | 'todo' | 'cost' | 'model'

export type Seg = { text: string; tone: Tone; bold?: boolean }

/**
 * One part of the line. `short` is the narrow form (absent: the part has none
 * and is dropped instead); a lower `priority` is kept longer.
 */
export type Part = { id: string; priority: number; full: Seg[]; short?: Seg[] }

export const SEPARATOR = ' │ '

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', seven_day_opus: '7d opus', spend_limit: 'spend' }
const LIMIT_TITLES: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', seven_day_opus: '7-day Opus', spend_limit: 'Spend' }

// ── Formatting ──────────────────────────────────────────────────────────────

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

/** A long span to the minute: `47m`, `2h05m`, `3d4h`. */
export function span(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

/**
 * Terminal cells a code point takes: 2 for East Asian wide and fullwidth
 * characters and for emoji, 0 for combining marks and joiners, else 1.
 */
function cellsOf(cp: number): number {
  if (cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

/** How many terminal cells `text` takes. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += cellsOf(ch.codePointAt(0) ?? 0)
  return n
}

/** `text` on one line, cut to `max` cells with an ellipsis. */
export function cut(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (cells(one) <= max) return one
  let out = ''
  let used = 0
  for (const ch of one) {
    const w = cellsOf(ch.codePointAt(0) ?? 0)
    if (used + w > max - 1) break
    out += ch
    used += w
  }
  return max >= 1 ? `${out}…` : ''
}

export function bar(percent: number, cells: number): { filled: string; empty: string } {
  const n = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  return { filled: '█'.repeat(n), empty: '░'.repeat(cells - n) }
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`; a name that is already friendly passes. */
export function modelName(id: string): string {
  const bare = (id.split('[')[0] ?? id).trim()
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(bare)
  if (m?.[1] !== undefined && m[2] !== undefined) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
    return `${family} ${m[2]}${m[3] === undefined ? '' : `.${m[3]}`}`
  }
  return cut(bare, 20)
}

export function limitName(kind: string): string {
  return LIMIT_NAMES[kind] ?? kind.replace(/_/g, ' ')
}

export function limitTitle(kind: string): string {
  return LIMIT_TITLES[kind] ?? kind.replace(/_/g, ' ')
}

// ── Health: what the colours say ────────────────────────────────────────────

/**
 * How full the context is, measured against where it matters: the auto-compact
 * threshold when it is on, else the window itself.
 */
export function contextTone(c: ActivityContext): Tone {
  if (c.tokens === undefined) return 'muted'
  const ratio = c.tokens / (c.compactAt ?? c.window)
  if (ratio >= 0.9) return 'crit'
  if (ratio >= 0.7) return 'warn'
  return 'ok'
}

export function limitTone(percent: number): Tone {
  if (percent >= 80) return 'crit'
  if (percent >= 50) return 'warn'
  return 'ok'
}

export function elapsedTone(ms: number): Tone {
  if (ms >= 120_000) return 'crit'
  if (ms >= 30_000) return 'warn'
  return 'muted'
}

/** Time left in a window, to the minute; on the line only once the window is half used. */
export function resetIn(limit: ActivityLimit, now: number, always = false): string | undefined {
  if (limit.resetsAt === undefined) return undefined
  const at = Date.parse(limit.resetsAt)
  if (Number.isNaN(at) || at <= now) return undefined
  if (!always && limit.percentUsed < 50) return undefined
  // Rounded up, so a window never reads as reset before it is.
  return at - now < 60_000 ? '<1m' : span(at - now + 59_999)
}

/** Tokens left before auto-compaction runs; undefined when it is off or unknown. */
export function toCompact(c: ActivityContext): number | undefined {
  if (c.compactAt === undefined || c.tokens === undefined) return undefined
  return Math.max(0, c.compactAt - c.tokens)
}

// ── Grouping ────────────────────────────────────────────────────────────────

export type ToolGroup = { name: string; count: number; startedAt: number }

export function toolLabel(tool: string): string {
  if (!tool.startsWith('mcp__')) return tool
  return tool.split('__').slice(2).join('__') || tool
}

/** Running tools grouped by name, oldest first. */
export function groupTools(tools: readonly ActivityTool[]): ToolGroup[] {
  const byName = new Map<string, ToolGroup>()
  for (const t of tools) {
    const name = toolLabel(t.tool)
    const seen = byName.get(name)
    byName.set(name, {
      name,
      count: (seen?.count ?? 0) + 1,
      startedAt: Math.min(seen?.startedAt ?? t.startedAt, t.startedAt),
    })
  }
  return [...byName.values()].sort((a, b) => a.startedAt - b.startedAt)
}

export function mainTools(s: ActivitySnapshot): ActivityTool[] {
  return s.tools.filter(t => t.agentId === undefined)
}

/** The tool an agent is running now, its oldest. */
export function agentTool(s: ActivitySnapshot, agent: ActivityAgent): ActivityTool | undefined {
  return s.tools.filter(t => t.agentId === agent.id).sort((a, b) => a.startedAt - b.startedAt)[0]
}

export function todoCounts(todos: readonly ActivityTodo[]): { done: number; total: number; active?: ActivityTodo } {
  return {
    done: todos.filter(t => t.status === 'completed').length,
    total: todos.length,
    active: todos.find(t => t.status === 'in_progress'),
  }
}

// ── The line ────────────────────────────────────────────────────────────────

function contextPart(c: ActivityContext): Part {
  const label: Seg = { text: 'ctx ', tone: 'label' }
  if (c.tokens === undefined || c.percent === undefined) {
    return {
      id: 'context',
      priority: 1,
      full: [label, { text: `– of ${tokens(c.window)}`, tone: 'muted' }],
      short: [label, { text: '–', tone: 'muted' }],
    }
  }
  const tone = contextTone(c)
  const meter = (cells: number): Seg[] => {
    const { filled, empty } = bar(c.percent ?? 0, cells)
    return [label, { text: filled, tone }, { text: empty, tone: 'muted' }, { text: ` ${c.percent}%`, tone, bold: true }]
  }
  const left = toCompact(c)
  let detail: Seg
  if (left === undefined) detail = { text: ` ${tokens(c.tokens)}/${tokens(c.window)}`, tone: 'muted' }
  else if (left === 0) detail = { text: ' compacts next turn', tone: 'crit' }
  else detail = { text: ` ${tokens(left)} to compact`, tone: tone === 'ok' ? 'muted' : tone }
  return { id: 'context', priority: 1, full: [...meter(8), detail], short: meter(5) }
}

function toolsPart(s: ActivitySnapshot): Part | undefined {
  const groups = groupTools(mainTools(s))
  const [first] = groups
  if (first === undefined) return undefined
  const one = (g: ToolGroup): Seg[] => {
    const elapsed = s.now - g.startedAt
    const segs: Seg[] = [{ text: cut(g.name, 22), tone: 'tool', bold: true }]
    if (g.count > 1) segs.push({ text: `×${g.count}`, tone: 'tool' })
    if (elapsed >= 2000) segs.push({ text: ` ${duration(elapsed)}`, tone: elapsedTone(elapsed) })
    return segs
  }
  const icon: Seg = { text: '▸ ', tone: 'tool' }
  const full: Seg[] = [icon]
  groups.slice(0, 2).forEach((g, i) => {
    if (i > 0) full.push({ text: ' · ', tone: 'muted' })
    full.push(...one(g))
  })
  if (groups.length > 2) full.push({ text: ` +${groups.length - 2}`, tone: 'muted' })
  const short: Seg[] = [icon, ...one(first)]
  if (groups.length > 1) short.push({ text: ` +${groups.length - 1}`, tone: 'muted' })
  return { id: 'tools', priority: 2, full, short }
}

function agentsPart(s: ActivitySnapshot): Part | undefined {
  const [first] = s.agents
  if (first === undefined) return undefined
  const icon: Seg = { text: '◆ ', tone: 'agent' }
  const short: Seg[] = [icon, { text: String(s.agents.length), tone: 'agent', bold: true }]
  if (s.agents.length > 1) {
    const types = [...new Set(s.agents.map(a => a.type))].slice(0, 2).join(', ')
    return {
      id: 'agents',
      priority: 3,
      full: [icon, { text: `${s.agents.length} agents`, tone: 'agent', bold: true }, { text: ` ${types}`, tone: 'agent' }],
      short,
    }
  }
  const age = s.now - first.since
  return {
    id: 'agents',
    priority: 3,
    full: [
      icon,
      { text: first.type, tone: 'agent', bold: true },
      { text: ` ${duration(age)}`, tone: elapsedTone(age) === 'crit' ? 'warn' : 'muted' },
      { text: ` ${cut(first.description, 28)}`, tone: 'text' },
    ],
    short,
  }
}

function todosPart(s: ActivitySnapshot): Part | undefined {
  const { done, total, active } = todoCounts(s.todos)
  if (total === 0) return undefined
  const icon: Seg = { text: '✓ ', tone: done === total ? 'ok' : 'todo' }
  const count: Seg = { text: `${done}/${total}`, tone: done === total ? 'ok' : 'todo', bold: true }
  const full: Seg[] = [icon, count]
  if (done === total) full.push({ text: ' done', tone: 'ok' })
  else if (active !== undefined) full.push({ text: ` ${cut(active.activeForm || active.content, 34)}`, tone: 'text' })
  return { id: 'todos', priority: 4, full, short: [icon, count] }
}

function tasksPart(s: ActivitySnapshot): Part | undefined {
  const [first] = s.tasks
  if (first === undefined) return undefined
  const icon: Seg = { text: '⧗ ', tone: 'task' }
  const full: Seg[] =
    s.tasks.length === 1
      ? [icon, { text: first.type, tone: 'task', bold: true }, { text: ` ${cut(first.description, 24)}`, tone: 'text' }]
      : [icon, { text: `${s.tasks.length} background`, tone: 'task', bold: true }]
  return { id: 'tasks', priority: 5, full, short: [icon, { text: String(s.tasks.length), tone: 'task', bold: true }] }
}

function limitsPart(s: ActivitySnapshot): Part | undefined {
  if (s.rateLimits.length === 0) return undefined
  const one = (limit: ActivityLimit, withReset: boolean): Seg[] => {
    const segs: Seg[] = [
      { text: `${limitName(limit.kind)} `, tone: 'label' },
      { text: `${limit.percentUsed}%`, tone: limitTone(limit.percentUsed), bold: true },
    ]
    const reset = withReset ? resetIn(limit, s.now) : undefined
    if (reset !== undefined) segs.push({ text: ` ↻${reset}`, tone: 'muted' })
    return segs
  }
  const worst = [...s.rateLimits].sort((a, b) => b.percentUsed - a.percentUsed)[0] as ActivityLimit
  const full: Seg[] = []
  s.rateLimits.forEach((limit, i) => {
    if (i > 0) full.push({ text: ' · ', tone: 'muted' })
    full.push(...one(limit, true))
  })
  // A window close to its limit matters more than anything but the context.
  const priority = worst.percentUsed >= 80 ? 1.5 : worst.percentUsed >= 50 ? 4.5 : 6
  return { id: 'limits', priority, full, short: one(worst, worst.percentUsed >= 80) }
}

/** The line's parts in reading order, each with its full and short form. */
export function lineParts(s: ActivitySnapshot): Part[] {
  const parts: (Part | undefined)[] = [
    s.context === undefined ? undefined : contextPart(s.context),
    limitsPart(s),
    toolsPart(s),
    agentsPart(s),
    tasksPart(s),
    todosPart(s),
    s.model === undefined ? undefined : { id: 'model', priority: 7, full: [{ text: modelName(s.model), tone: 'model' }] },
    s.costUsd === undefined ? undefined : { id: 'cost', priority: 8, full: [{ text: `$${s.costUsd.toFixed(2)}`, tone: 'cost' }] },
  ]
  return parts.filter((p): p is Part => p !== undefined)
}

/** A part as the line draws it: its id and the form that fit. */
export type Fitted = { id: string; segs: readonly Seg[] }

export function width(rows: readonly { segs: readonly Seg[] }[]): number {
  const text = rows.reduce((n, row) => n + row.segs.reduce((m, seg) => m + cells(seg.text), 0), 0)
  return text + Math.max(0, rows.length - 1) * SEPARATOR.length
}

/**
 * The line that fits `columns`: every part full if it fits; else the least
 * important parts take their short form one by one; else they are dropped,
 * least important first. The context part is the last to go.
 */
export function fit(s: ActivitySnapshot, columns: number): Fitted[] {
  const parts = lineParts(s)
  const forms = new Map<string, readonly Seg[]>(parts.map(p => [p.id, p.full]))
  const shown = (): Fitted[] => parts.flatMap(p => {
    const segs = forms.get(p.id)
    return segs === undefined ? [] : [{ id: p.id, segs }]
  })
  if (width(shown()) <= columns) return shown()

  const leastFirst = [...parts].sort((a, b) => b.priority - a.priority)
  for (const p of leastFirst) {
    if (p.short === undefined) forms.delete(p.id)
    else forms.set(p.id, p.short)
    if (width(shown()) <= columns) return shown()
  }
  for (const p of leastFirst) {
    if (forms.size <= 1) break
    forms.delete(p.id)
    if (width(shown()) <= columns) return shown()
  }
  return shown()
}

/** The line as plain text: what tests, VS Code's status text and screen readers read. */
export function plain(rows: readonly { segs: readonly Seg[] }[]): string {
  return rows.map(row => row.segs.map(seg => seg.text).join('')).join(SEPARATOR)
}

/**
 * The whole picture as a few lines of markdown: the /activity command's text,
 * which the model reads and which any surface can show as it is.
 */
export function summary(s: ActivitySnapshot): string {
  const lines: string[] = []

  const head = [
    s.model === undefined ? undefined : `**${modelName(s.model)}**`,
    s.startedAt === undefined ? undefined : `session ${span(s.now - s.startedAt)}`,
    s.costUsd === undefined ? undefined : `$${s.costUsd.toFixed(2)}`,
  ].filter(Boolean)
  if (head.length > 0) lines.push(head.join(' · '))

  const c = s.context
  if (c?.tokens === undefined || c.percent === undefined) lines.push('- Context: no reading yet')
  else {
    const left = toCompact(c)
    let after = ''
    if (c.compactAt === undefined) after = ', auto-compact off'
    else if (left === 0) after = ', compacts next turn'
    else after = `, compacts at ${tokens(c.compactAt)} (${tokens(left ?? 0)} left)`
    lines.push(`- Context: ${c.percent}% (${tokens(c.tokens)} / ${tokens(c.window)})${after}`)
  }

  if (s.rateLimits.length > 0) {
    const limits = s.rateLimits.map(limit => {
      const reset = resetIn(limit, s.now, true)
      return `${limitTitle(limit.kind)} ${limit.percentUsed}%${reset === undefined ? '' : `, resets in ${reset}`}`
    })
    lines.push(`- Limits: ${limits.join(' · ')}`)
  }

  const running: string[] = groupTools(mainTools(s)).map(g => `${g.name}${g.count > 1 ? ` ×${g.count}` : ''} ${duration(s.now - g.startedAt)}`)
  for (const a of s.agents) running.push(`${a.type} agent ${duration(s.now - a.since)} (${cut(a.description, 40)})`)
  for (const task of s.tasks) running.push(`${task.type} ${duration(s.now - task.since)} (${cut(task.description, 40)})`)
  lines.push(`- Running: ${running.length === 0 ? 'nothing' : running.join(' · ')}`)

  const { done, total, active } = todoCounts(s.todos)
  if (total > 0) {
    const now = active === undefined ? '' : `, now: ${active.activeForm || active.content}`
    lines.push(`- Todos: ${done}/${total} done${now}`)
  }
  return lines.join('\n')
}
