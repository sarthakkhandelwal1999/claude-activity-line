import { describe, expect, mock, test } from 'claude-code/testing'

import type { ActivitySnapshot } from '../types'
import { demoSnapshot } from './demo'
import { cells, contextTone, cut, duration, fit, lineParts, modelName, plain, resetIn, span, tokens, toolLabel, width } from './model'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const DEMO = demoSnapshot(NOW)
const ids = (s: ActivitySnapshot, columns: number) => fit(s, columns).map(p => p.id)

describe('formatting', () => {
  test('token counts keep one decimal under 100k', () => {
    expect(tokens(950)).toBe('950')
    expect(tokens(35_600)).toBe('35.6k')
    expect(tokens(4_000)).toBe('4k')
    expect(tokens(131_400)).toBe('131k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(1_500_000)).toBe('1.5M')
  })

  test('durations and spans', () => {
    expect(duration(900)).toBe('0s')
    expect(duration(125_000)).toBe('2m05s')
    expect(duration(2 * 3_600_000 + 10 * 60_000)).toBe('2h10m')
    expect(span(47 * 60_000 + 59_000)).toBe('47m')
    expect(span(26 * 3_600_000)).toBe('1d2h')
  })

  test('model ids read as their names', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelName('Opus 5.5')).toBe('Opus 5.5')
  })

  test('widths are terminal cells: wide characters count two', () => {
    expect(cells('abc')).toBe(3)
    expect(cells('漢字テスト')).toBe(10)
    expect(cells('✓ ▸ ◆ ⧗ ↻')).toBe(9)
    expect(cut('漢字テストを書く', 7)).toBe('漢字テ…')
    expect(cells(cut('漢字テストを書く', 7))).toBeLessThanOrEqual(7)
  })

  test('MCP tools read by their own name', () => {
    expect(toolLabel('mcp__github__create_issue')).toBe('create_issue')
    expect(toolLabel('Bash')).toBe('Bash')
  })
})

describe('colours', () => {
  test('context is judged against the auto-compact threshold', () => {
    expect(contextTone({ tokens: 100_000, window: 200_000, percent: 50, compactAt: 167_000 })).toBe('ok')
    expect(contextTone({ tokens: 131_400, window: 200_000, percent: 66, compactAt: 167_000 })).toBe('warn')
    expect(contextTone({ tokens: 155_000, window: 200_000, percent: 78, compactAt: 167_000 })).toBe('crit')
    // Auto-compact off: judged against the window itself.
    expect(contextTone({ tokens: 155_000, window: 200_000, percent: 78 })).toBe('warn')
  })

  test('each part carries its tones', () => {
    const tones = (id: string) => lineParts(DEMO).find(p => p.id === id)?.full.map(s => s.tone)
    expect(tones('context')).toEqual(['label', 'warn', 'muted', 'warn', 'warn'])
    expect(tones('limits')).toEqual(['label', 'crit', 'muted', 'muted', 'label', 'ok'])
    expect(tones('tools')).toEqual(['tool', 'tool', 'warn', 'muted', 'tool'])
  })
})

describe('the line', () => {
  test('everything, widest form', () => {
    expect(plain(lineParts(DEMO).map(p => ({ segs: p.full })))).toBe(
      'ctx █████░░░ 66% 35.6k to compact │ 5h 83% ↻1h24m · 7d 41% │ ▸ Bash 38s · Read │ ◆ 2 agents Explore, test-runner │ ⧗ shell npm run dev │ ✓ 2/5 Writing the tests │ Opus 5.5 │ $4.37',
    )
  })

  test('narrows, then drops the least important parts, never past the width', () => {
    expect(ids(DEMO, 200)).toEqual(['context', 'limits', 'tools', 'agents', 'tasks', 'todos', 'model', 'cost'])
    expect(ids(DEMO, 144)).toEqual(['context', 'limits', 'tools', 'agents', 'tasks', 'todos'])
    expect(ids(DEMO, 84)).toEqual(['context', 'limits', 'tools', 'agents', 'tasks', 'todos'])
    expect(ids(DEMO, 40)).toEqual(['context', 'limits'])
    expect(ids(DEMO, 20)).toEqual(['context'])
    const wide: ActivitySnapshot = {
      ...DEMO,
      todos: [{ content: 'テストを書く', status: 'in_progress', activeForm: '日本語のテストを書いています' }],
    }
    for (const s of [DEMO, wide]) {
      for (let columns = 16; columns <= 220; columns++) {
        const rows = fit(s, columns)
        if (rows.length > 1) expect(width(rows)).toBeLessThanOrEqual(columns)
      }
    }
  })

  test('a rate limit near its cap outranks the work in progress', () => {
    const calm = { ...DEMO, rateLimits: [{ kind: 'five_hour', percentUsed: 20 }] }
    expect(lineParts(calm).find(p => p.id === 'limits')?.priority).toBeGreaterThan(5)
    expect(lineParts(DEMO).find(p => p.id === 'limits')?.priority).toBeLessThan(2)
  })

  test('the reset countdown shows on the line once a window is half used', () => {
    const at = new Date(NOW + 3_600_000).toISOString()
    expect(resetIn({ kind: 'seven_day', percentUsed: 20, resetsAt: at }, NOW)).toBe(undefined)
    expect(resetIn({ kind: 'seven_day', percentUsed: 60, resetsAt: at }, NOW)).toBe('1h00m')
    expect(resetIn({ kind: 'seven_day', percentUsed: 20, resetsAt: at }, NOW, true)).toBe('1h00m')
    // To the minute, rounded up, so a window never reads as reset early.
    expect(resetIn({ kind: 'five_hour', percentUsed: 90, resetsAt: new Date(NOW + 23 * 60_000 + 41_000).toISOString() }, NOW)).toBe('24m')
    expect(resetIn({ kind: 'five_hour', percentUsed: 90, resetsAt: new Date(NOW + 30_000).toISOString() }, NOW)).toBe('<1m')
  })

  test('no reading yet', () => {
    const fresh: ActivitySnapshot = { now: NOW, context: { window: 1_000_000 }, categories: [], rateLimits: [], tools: [], agents: [], tasks: [], todos: [] }
    expect(plain(fit(fresh, 120))).toBe('ctx – of 1M')
  })
})

describe('in a session', () => {
  test('todos, background shells and their end, drawn on every surface', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('tool.call', ($, e) => {
      if (e.tool === 'Bash') return { result: { stdout: '', stderr: '', backgroundTaskId: 'bash-7' } as never }
      return { result: {} as never }
    })
    on('classic.Stop', () => ({}))
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
    await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Start the dev server', run_in_background: true })

    for (const surface of ['terminal', 'desktop'] as const) {
      const hint = await $.ui.mount({
        plugin: 'activity-line',
        surface,
        component: 'PromptHint',
        props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
        viewport: { columns: 150, rows: 40 },
      })
      expect((await hint.find({ type: 'Text', text: '? for shortcuts' }))?.text).toBe('? for shortcuts')
      expect(await hint.find({ text: /✓ 1\/2 Testing it/ })).toBeDefined()
      expect(await hint.find({ text: /⧗ shell Start the dev server/ })).toBeDefined()
    }

    const pane = await $.ui.mount({
        plugin: 'activity-line',
        surface: 'vscode',
        component: 'Pane',
        requestId: 'activity',
      props: { title: 'Activity', isFocused: false, bodyColumns: 90, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await pane.find({ text: /◐ Testing it/ })).toBeDefined()
    expect(await pane.find({ text: /Start the dev server/ })).toBeDefined()

    // The end of the turn reports the shell done: it leaves the dashboard.
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    expect(await pane.find({ text: /Start the dev server/ })).toBeUndefined()
    expect(await pane.find({ text: 'idle' })).toBeDefined()
  })

  test('the dashboard keeps context, limits and todos in a short pane', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.env(on, { ACTIVITY_LINE_DEMO: '1' })
    on('session.start', () => ({ cwd: '/tmp' }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
    on('session.surfaces', () => ({ value: ['terminal'] }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)

    const short = await $.ui.mount({
      plugin: 'activity-line',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'activity',
      props: { title: 'Activity', isFocused: false, bodyColumns: 110, placement: 'inline', scroll: { offset: 0, bodyRows: 8 }, view: {} },
    })
    expect(await short.find({ text: /compacts at 167k/ })).toBeDefined()
    expect(await short.find({ text: /5-hour/ })).toBeDefined()
    expect(await short.find({ text: /◐ Writing the tests/ })).toBeDefined()
    expect(await short.find({ text: /Messages/ })).toBeUndefined()
  })
})

describe('a new conversation', () => {
  test('/resume starts the figures over', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('tool.call', () => ({ result: {} as never }))
    on('session.end', ($, e) => ({ sessionId: 'old' }) as never)
    on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Old work', status: 'in_progress', activeForm: 'Doing old work' }] })
    const pane = await $.ui.mount({
      plugin: 'activity-line',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'activity',
      props: { title: 'Activity', isFocused: false, bodyColumns: 90, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await pane.find({ text: /Doing old work/ })).toBeDefined()

    await $.session.end({ reason: 'resume' } as never)
    expect(await pane.find({ text: /Doing old work/ })).toBeUndefined()
  })
})
