import type { ActivityLimit, ActivitySnapshot, ActivityTodo, ActivityTool } from '../types'

/** What a piece of text means; the render hooks map each to a theme colour. */
export type Tone = 'ok' | 'warn' | 'crit' | 'label' | 'muted' | 'text' | 'tool' | 'agent' | 'todo' | 'cost'

export type Seg = { text: string; tone: Tone; bold?: boolean }

/** One part of the line: its segments, and how readily it is dropped when the row is short. */
export type Part = { id: string; segs: Seg[]; priority: number }

export const SEPARATOR = '  │  '

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const LIMIT_TITLES: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'Spend' }

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

export function cut(text: string, max: number): string {
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function bar(percent: number, cells: number): { filled: string; empty: string } {
  const n = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  return { filled: '█'.repeat(n), empty: '░'.repeat(cells - n) }
}

/** Context fills faster near the end and auto-compacts, so it warns earlier than a rate limit. */
export function contextTone(percent: number): Tone {
  if (percent >= 80) return 'crit'
  if (percent >= 60) return 'warn'
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

export function limitName(kind: string): string {
  return LIMIT_NAMES[kind] ?? kind
}

export function limitTitle(kind: string): string {
  return LIMIT_TITLES[kind] ?? kind
}

/** Time left in a window, once it is worth showing (the window is half used). */
export function resetIn(limit: ActivityLimit, now: number, always = false): string | undefined {
  if (limit.resetsAt === undefined) return undefined
  const at = Date.parse(limit.resetsAt)
  if (!(at > now)) return undefined
  return always || limit.percentUsed >= 50 ? duration(at - now) : undefined
}

export type ToolGroup = { name: string; count: number; startedAt: number }

/** Running tools grouped by name, oldest first. */
export function groupTools(tools: readonly ActivityTool[]): ToolGroup[] {
  const byName = new Map<string, ToolGroup>()
  for (const t of tools) {
    const name = t.tool.replace(/^mcp__/, '')
    const seen = byName.get(name)
    byName.set(name, {
      name,
      count: (seen?.count ?? 0) + 1,
      startedAt: Math.min(seen?.startedAt ?? t.startedAt, t.startedAt),
    })
  }
  return [...byName.values()].sort((a, b) => a.startedAt - b.startedAt)
}

export function todoCounts(todos: readonly ActivityTodo[]): { done: number; total: number; active?: ActivityTodo } {
  return {
    done: todos.filter(t => t.status === 'completed').length,
    total: todos.length,
    active: todos.find(t => t.status === 'in_progress'),
  }
}

/** The line's parts, widest form; `fit` drops and narrows them to a width. */
export function lineParts(s: ActivitySnapshot, barCells = 10): Part[] {
  const parts: Part[] = []

  if (s.context !== undefined) {
    const { percent, tokens: used, window } = s.context
    if (percent === undefined || used === undefined) {
      parts.push({ id: 'context', priority: 1, segs: [{ text: 'ctx ', tone: 'label' }, { text: `–/${tokens(window)}`, tone: 'muted' }] })
    } else {
      const tone = contextTone(percent)
      const { filled, empty } = bar(percent, barCells)
      parts.push({
        id: 'context',
        priority: 1,
        segs: [
          { text: 'ctx ', tone: 'label' },
          { text: filled, tone },
          { text: empty, tone: 'muted' },
          { text: ` ${percent}%`, tone, bold: true },
          { text: ` ${tokens(used)}/${tokens(window)}`, tone: 'muted' },
        ],
      })
    }
  }

  const { done, total, active } = todoCounts(s.todos)
  if (total > 0) {
    const segs: Seg[] = [
      { text: '☑ ', tone: 'label' },
      { text: `${done}/${total}`, tone: done === total ? 'ok' : 'todo', bold: true },
    ]
    if (done === total) segs.push({ text: ' done', tone: 'ok' })
    else if (active !== undefined) segs.push({ text: ` ${cut(active.activeForm || active.content, 40)}`, tone: 'text' })
    parts.push({ id: 'todos', priority: 2, segs })
  }

  const groups = groupTools(s.tools)
  if (groups.length > 0) {
    const segs: Seg[] = [{ text: '⚙ ', tone: 'label' }]
    groups.slice(0, 3).forEach((g, i) => {
      if (i > 0) segs.push({ text: ' · ', tone: 'muted' })
      segs.push({ text: cut(g.name, 24), tone: 'tool', bold: true })
      if (g.count > 1) segs.push({ text: `×${g.count}`, tone: 'tool' })
      const elapsed = s.now - g.startedAt
      if (elapsed >= 2000) segs.push({ text: ` ${duration(elapsed)}`, tone: elapsedTone(elapsed) })
    })
    if (groups.length > 3) segs.push({ text: ` +${groups.length - 3}`, tone: 'muted' })
    parts.push({ id: 'tools', priority: 3, segs })
  }

  if (s.rateLimits.length > 0) {
    const segs: Seg[] = []
    s.rateLimits.forEach((limit, i) => {
      if (i > 0) segs.push({ text: '  ', tone: 'muted' })
      const tone = limitTone(limit.percentUsed)
      segs.push({ text: `${limitName(limit.kind)} `, tone: 'label' })
      segs.push({ text: `${limit.percentUsed}%`, tone, bold: true })
      const reset = resetIn(limit, s.now)
      if (reset !== undefined) segs.push({ text: ` ↻${reset}`, tone: 'muted' })
    })
    parts.push({ id: 'limits', priority: 4, segs })
  }

  if (s.agents.length > 0) {
    const [first] = s.agents
    const label =
      s.agents.length === 1 && first !== undefined
        ? `${first.type}: ${cut(first.description, 32)}`
        : `${s.agents.length} agents (${[...new Set(s.agents.map(a => a.type))].slice(0, 3).join(', ')})`
    parts.push({ id: 'agents', priority: 5, segs: [{ text: '◆ ', tone: 'agent' }, { text: label, tone: 'agent' }] })
  }

  if (s.costUsd !== undefined) {
    parts.push({ id: 'cost', priority: 6, segs: [{ text: `$${s.costUsd.toFixed(2)}`, tone: 'cost' }] })
  }

  return parts
}

export function width(parts: readonly Part[]): number {
  const text = parts.reduce((n, p) => n + p.segs.reduce((m, seg) => m + seg.text.length, 0), 0)
  return text + Math.max(0, parts.length - 1) * SEPARATOR.length
}

/** The parts that fit `columns`: a shorter bar first, then the least important parts dropped. */
export function fit(s: ActivitySnapshot, columns: number): Part[] {
  const wide = lineParts(s, 10)
  if (width(wide) <= columns) return wide
  let parts = lineParts(s, 5)
  while (parts.length > 1 && width(parts) > columns) {
    const worst = Math.max(...parts.map(p => p.priority))
    parts = parts.filter(p => p.priority !== worst)
  }
  return parts
}

/** The line as plain text: what tests and screen readers read. */
export function plain(parts: readonly Part[]): string {
  return parts.map(p => p.segs.map(seg => seg.text).join('')).join(SEPARATOR)
}
