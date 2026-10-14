import type { Color, EngineInterface, RenderElement } from 'claude-code'

import type { ActivitySnapshot } from '../types'
import {
  agentTool,
  bar,
  contextTone,
  cut,
  duration,
  elapsedTone,
  groupTools,
  limitTitle,
  limitTone,
  mainTools,
  modelName,
  resetIn,
  SEPARATOR,
  span,
  toCompact,
  todoCounts,
  tokens,
  toolLabel,
} from './model'
import type { Seg, Tone } from './model'

export type Tables = ReturnType<EngineInterface['ui']['resolve']>

/** Theme colours, so every theme (light, dark, colour-blind, ANSI) reads right. */
export const STYLE: Record<Tone, { color?: Color; dimColor?: boolean }> = {
  ok: { color: 'success' },
  warn: { color: 'warning' },
  crit: { color: 'error' },
  label: { color: 'inactive' },
  muted: { color: 'inactive' },
  text: {},
  tool: { color: 'suggestion' },
  agent: { color: 'merged' },
  task: { color: 'ide' },
  todo: { color: 'planMode' },
  cost: { color: 'claude' },
  model: { color: 'claude' },
}

const LABEL = 9

export function styled(t: Tables, seg: Seg): RenderElement {
  return (
    <t.Text {...STYLE[seg.tone]} bold={seg.bold}>
      {seg.text}
    </t.Text>
  )
}

function text(t: Tables, segs: readonly Seg[]): RenderElement {
  return <t.Text wrap="truncate-end">{segs.map(seg => styled(t, seg))}</t.Text>
}

/** The one-row line: parts joined by a dim separator, cut at the row's end. */
export function line(t: Tables, rows: readonly { segs: readonly Seg[] }[]): RenderElement {
  const children: RenderElement[] = []
  rows.forEach((row, i) => {
    if (i > 0) children.push(<t.Text color="inactive">{SEPARATOR}</t.Text>)
    for (const seg of row.segs) children.push(styled(t, seg))
  })
  return <t.Text wrap="truncate-end">{children}</t.Text>
}

/** A row with a dim label in the left column; only the first row of a group names it. */
function labelled(t: Tables, label: string, body: RenderElement): RenderElement {
  return (
    <t.Box>
      <t.Box width={LABEL} flexShrink={0}>
        <t.Text color="inactive">{label}</t.Text>
      </t.Box>
      {body}
    </t.Box>
  )
}

function meter(t: Tables, label: string, percent: number, tone: Tone, cells: number, detail: Seg[]): RenderElement {
  const { filled, empty } = bar(percent, cells)
  return labelled(
    t,
    label,
    text(t, [
      { text: filled, tone },
      { text: empty, tone: 'muted' },
      { text: ` ${String(percent).padStart(3)}%  `, tone, bold: true },
      ...detail,
    ]),
  )
}

function header(t: Tables, s: ActivitySnapshot): RenderElement | undefined {
  const parts: { segs: Seg[] }[] = []
  if (s.model !== undefined) parts.push({ segs: [{ text: modelName(s.model), tone: 'model', bold: true }] })
  if (s.startedAt !== undefined) parts.push({ segs: [{ text: `session ${span(s.now - s.startedAt)}`, tone: 'muted' }] })
  if (s.costUsd !== undefined) parts.push({ segs: [{ text: `$${s.costUsd.toFixed(2)}`, tone: 'cost' }] })
  return parts.length === 0 ? undefined : line(t, parts)
}

function contextRows(t: Tables, s: ActivitySnapshot, cells: number): RenderElement[] {
  const c = s.context
  if (c?.tokens === undefined || c.percent === undefined) {
    const note = c === undefined ? 'no reading yet' : `no reading yet · ${tokens(c.window)} window`
    return [labelled(t, 'Context', text(t, [{ text: note, tone: 'muted' }]))]
  }
  const tone = contextTone(c)
  const left = toCompact(c)
  const detail: Seg[] = [{ text: `${tokens(c.tokens)} / ${tokens(c.window)}`, tone: 'text' }]
  if (c.compactAt === undefined) detail.push({ text: '  auto-compact off', tone: 'muted' })
  else if (left === 0) detail.push({ text: '  compacts next turn', tone: 'crit', bold: true })
  else
    detail.push(
      { text: `  compacts at ${tokens(c.compactAt)}, `, tone: 'muted' },
      { text: `${tokens(left ?? 0)} left`, tone: tone === 'ok' ? 'text' : tone, bold: true },
    )
  const rows = [meter(t, 'Context', c.percent, tone, cells, detail)]
  if (s.categories.length > 0) {
    rows.push(
      labelled(
        t,
        '',
        <t.Box flexWrap="wrap" columnGap={2}>
          {s.categories.slice(0, 6).map(cat => (
            <t.Text>
              <t.Text color={cat.color}>■ </t.Text>
              <t.Text color="inactive">{`${cat.name} `}</t.Text>
              <t.Text>{tokens(cat.tokens)}</t.Text>
            </t.Text>
          ))}
        </t.Box>,
      ),
    )
  }
  return rows
}

function limitRows(t: Tables, s: ActivitySnapshot, cells: number): RenderElement[] {
  return s.rateLimits.map(limit => {
    const reset = resetIn(limit, s.now, true)
    return meter(t, limitTitle(limit.kind), limit.percentUsed, limitTone(limit.percentUsed), cells, reset ? [{ text: `resets in ${reset}`, tone: 'muted' }] : [])
  })
}

function nowRows(t: Tables, s: ActivitySnapshot, columns: number): RenderElement[] {
  const bodies: RenderElement[] = []

  const groups = groupTools(mainTools(s))
  if (groups.length > 0) {
    const segs: Seg[] = []
    groups.forEach((g, i) => {
      const elapsed = s.now - g.startedAt
      if (i > 0) segs.push({ text: '   ', tone: 'muted' })
      segs.push({ text: '▸ ', tone: 'tool' }, { text: g.name, tone: 'tool', bold: true })
      if (g.count > 1) segs.push({ text: ` ×${g.count}`, tone: 'tool' })
      segs.push({ text: ` ${duration(elapsed)}`, tone: elapsedTone(elapsed) })
    })
    bodies.push(text(t, segs))
  }

  for (const a of s.agents) {
    const age = s.now - a.since
    const doing = agentTool(s, a)
    const segs: Seg[] = [
      { text: '◆ ', tone: 'agent' },
      { text: a.type, tone: 'agent', bold: true },
      { text: ` ${a.status}`, tone: a.status === 'running' ? 'ok' : 'warn' },
      { text: ` ${duration(age)}  `, tone: elapsedTone(age) === 'crit' ? 'warn' : 'muted' },
    ]
    if (doing !== undefined) segs.push({ text: `▸ ${toolLabel(doing.tool)} ${duration(s.now - doing.startedAt)}  `, tone: 'tool' })
    segs.push({ text: cut(a.description, Math.max(16, columns)), tone: 'text' })
    bodies.push(text(t, segs))
  }

  for (const task of s.tasks) {
    bodies.push(
      text(t, [
        { text: '⧗ ', tone: 'task' },
        { text: task.type, tone: 'task', bold: true },
        { text: ` ${duration(s.now - task.since)}  `, tone: 'muted' },
        { text: task.description, tone: 'text' },
      ]),
    )
  }

  if (bodies.length === 0) return [labelled(t, 'Now', text(t, [{ text: 'idle', tone: 'muted' }]))]
  return bodies.map((body, i) => labelled(t, i === 0 ? 'Now' : '', body))
}

function todoRows(t: Tables, s: ActivitySnapshot): RenderElement[] {
  const { done, total } = todoCounts(s.todos)
  if (total === 0) return []
  return [
    labelled(
      t,
      'Todos',
      <t.Box flexWrap="wrap" columnGap={2}>
        <t.Text {...STYLE[done === total ? 'ok' : 'todo']} bold>{`${done}/${total}`}</t.Text>
        {s.todos.map(todo => {
          if (todo.status === 'completed') {
            return (
              <t.Text>
                <t.Text {...STYLE.ok}>✓ </t.Text>
                <t.Text color="inactive">{todo.content}</t.Text>
              </t.Text>
            )
          }
          if (todo.status === 'in_progress') {
            return (
              <t.Text {...STYLE.todo} bold>
                {`◐ ${todo.activeForm || todo.content}`}
              </t.Text>
            )
          }
          return <t.Text>{`○ ${todo.content}`}</t.Text>
        })}
      </t.Box>,
    ),
  ]
}

type Entry = { el: RenderElement; drop: number; height: number }

/**
 * The /activity dashboard: one fact per row, sized to the pane's body. When
 * the pane has fewer rows than the dashboard, the least useful rows give way
 * (a higher `drop` goes first): the context breakdown, then the extra
 * running rows, then the header; context, limits, the first running row and
 * todos stay.
 */
export function dashboard(t: Tables, s: ActivitySnapshot, columns: number, maxRows = Infinity): RenderElement {
  const cells = Math.max(10, Math.min(24, columns - 56))
  const body = Math.max(20, columns - LABEL)
  const head = header(t, s)
  const [contextRow, breakdownRow] = contextRows(t, s, cells)
  const now = nowRows(t, s, body)
  const todoText = s.todos.reduce((n, todo) => n + (todo.activeForm || todo.content).length + 4, 6)

  const entries: (Entry | undefined)[] = [
    head && { el: head, drop: 2, height: 1 },
    contextRow && { el: contextRow, drop: 0, height: 1 },
    breakdownRow && { el: breakdownRow, drop: 4, height: Math.ceil((s.categories.slice(0, 6).length * 22) / body) },
    ...limitRows(t, s, cells).map(el => ({ el, drop: 1, height: 1 })),
    ...now.map((el, i) => ({ el, drop: i === 0 ? 1 : 3, height: 1 })),
    ...todoRows(t, s).map(el => ({ el, drop: 1, height: Math.ceil(todoText / body) })),
  ]
  let kept = entries.filter((x): x is Entry => x !== undefined)
  const height = () => kept.reduce((n, x) => n + x.height, 0)
  while (height() > maxRows && kept.some(x => x.drop > 1)) {
    const worst = Math.max(...kept.map(x => x.drop))
    const at = kept.map(x => x.drop).lastIndexOf(worst)
    kept = kept.filter((_, i) => i !== at)
  }
  return <t.Box flexDirection="column">{kept.map(x => x.el)}</t.Box>
}
