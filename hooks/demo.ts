import type { ActivitySnapshot } from '../types'

/**
 * A busy session for screenshots and layout checks: set ACTIVITY_LINE_DEMO=1
 * and the line and the dashboard draw this instead of the live figures.
 */
export function demoSnapshot(now: number): ActivitySnapshot {
  const at = (ms: number) => new Date(now + ms).toISOString()
  return {
    now,
    startedAt: now - 47 * 60_000,
    model: 'claude-opus-5-5',
    context: { tokens: 131_400, window: 200_000, percent: 66, compactAt: 167_000 },
    categories: [
      { name: 'Messages', tokens: 96_200, color: 'claude' },
      { name: 'System tools', tokens: 17_800, color: 'inactive' },
      { name: 'MCP tools', tokens: 9_300, color: 'suggestion' },
      { name: 'Memory files', tokens: 4_600, color: 'remember' },
      { name: 'System prompt', tokens: 3_500, color: 'subtle' },
    ],
    rateLimits: [
      { kind: 'five_hour', percentUsed: 83, resetsAt: at(84 * 60_000) },
      { kind: 'seven_day', percentUsed: 41, resetsAt: at(3 * 86_400_000 + 5 * 3_600_000) },
    ],
    costUsd: 4.37,
    tools: [
      { id: 't1', tool: 'Bash', startedAt: now - 38_000 },
      { id: 't2', tool: 'Read', startedAt: now - 900 },
      { id: 't3', tool: 'Grep', startedAt: now - 3_200, agentId: 'a1' },
    ],
    agents: [
      { id: 'a1', type: 'Explore', description: 'Find where the poller schedules checks', status: 'running', since: now - 72_000 },
      { id: 'a2', type: 'test-runner', description: 'Run the backend suite', status: 'running', since: now - 15_000 },
    ],
    tasks: [{ id: 'b1', type: 'shell', description: 'npm run dev', since: now - 4 * 60_000 }],
    todos: [
      { content: 'Read the poller', status: 'completed', activeForm: 'Reading the poller' },
      { content: 'Add the retry budget', status: 'completed', activeForm: 'Adding the retry budget' },
      { content: 'Write the tests', status: 'in_progress', activeForm: 'Writing the tests' },
      { content: 'Update the changelog', status: 'pending', activeForm: 'Updating the changelog' },
      { content: 'Run the full suite', status: 'pending', activeForm: 'Running the full suite' },
    ],
  }
}
