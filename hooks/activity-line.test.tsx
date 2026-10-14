import { expect, mock, test } from 'claude-code/testing'

import type { ActivitySnapshot } from '../types'
import { duration, fit, lineParts, plain, resetIn, tokens } from './model'

const NOW = Date.parse('2026-10-14T12:00:00Z')

const BUSY: ActivitySnapshot = {
  now: NOW,
  context: { tokens: 130_000, window: 200_000, percent: 65 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 84, resetsAt: new Date(NOW + 90 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 12 },
  ],
  costUsd: 0.842,
  tools: [
    { tool: 'Read', startedAt: NOW - 500, inAgent: false },
    { tool: 'Bash', startedAt: NOW - 45_000, inAgent: false },
    { tool: 'Read', startedAt: NOW - 800, inAgent: true },
  ],
  agents: [{ id: 'a1', type: 'Explore', description: 'Find the poller', status: 'running' }],
  todos: [
    { content: 'Write it', status: 'completed', activeForm: 'Writing it' },
    { content: 'Test it', status: 'in_progress', activeForm: 'Testing it' },
    { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' },
  ],
}

const tonesOf = (id: string) =>
  lineParts(BUSY)
    .find(p => p.id === id)
    ?.segs.map(s => s.tone)

test('formats token counts and durations compactly', () => {
  expect(tokens(950)).toBe('950')
  expect(tokens(62_400)).toBe('62k')
  expect(tokens(1_000_000)).toBe('1M')
  expect(duration(125_000)).toBe('2m05s')
  expect(duration(2 * 3600_000 + 10 * 60_000)).toBe('2h10m')
})

test('the full line, in priority order', () => {
  expect(plain(lineParts(BUSY))).toBe(
    'ctx ███████░░░ 65% 130k/200k  │  ☑ 1/3 Testing it  │  ⚙ Bash 45s · Read×2  │  5h 84% ↻1h30m  7d 12%  │  ◆ Explore: Find the poller  │  $0.84',
  )
})

test('colour codes by threshold', () => {
  expect(tonesOf('context')).toEqual(['label', 'warn', 'muted', 'warn', 'muted'])
  expect(tonesOf('limits')).toEqual(['label', 'crit', 'muted', 'muted', 'label', 'ok'])
  expect(tonesOf('tools')).toEqual(['label', 'tool', 'warn', 'muted', 'tool', 'tool'])
})

test('a narrow row narrows the bar, then drops cost, agents and limits in that order', () => {
  const ids = (columns: number) => fit(BUSY, columns).map(p => p.id)
  expect(ids(200)).toEqual(['context', 'todos', 'tools', 'limits', 'agents', 'cost'])
  expect(fit(BUSY, 125)[0]?.segs[1]?.text).toBe('███')
  expect(ids(110)).toEqual(['context', 'todos', 'tools', 'limits'])
  expect(ids(60)).toEqual(['context', 'todos'])
  expect(ids(10)).toEqual(['context'])
})

test('the reset countdown shows on the line only once a window is half used', () => {
  const at = new Date(NOW + 3_600_000).toISOString()
  expect(resetIn({ kind: 'seven_day', percentUsed: 20, resetsAt: at }, NOW)).toBe(undefined)
  expect(resetIn({ kind: 'seven_day', percentUsed: 20, resetsAt: at }, NOW, true)).toBe('1h00m')
})

test('a TodoWrite sets progress, and the line and the pane draw it', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } as never }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>? for shortcuts</Text>
  })

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Write the mod', status: 'completed', activeForm: 'Writing the mod' },
      { content: 'Test it', status: 'in_progress', activeForm: 'Testing it' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const hint = await $.ui.mount({
      plugin: 'activity-line',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await hint.find({ type: 'Text', text: '? for shortcuts' }))?.text).toBe('? for shortcuts')
    expect(await hint.find({ text: /Testing it/ })).toBeDefined()
  }

  for (const surface of ['terminal', 'vscode', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'activity-line',
      surface,
      component: 'Pane',
      requestId: 'activity',
      props: {
        title: 'Activity',
        isFocused: false,
        bodyColumns: 70,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await pane.find({ text: '1/2 done' })).toBeDefined()
    expect(await pane.find({ text: /Testing it/ })).toBeDefined()
    expect(await pane.find({ text: 'idle' })).toBeDefined()
  }
})
