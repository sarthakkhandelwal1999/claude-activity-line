export type ActivityTodo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

/** A tool call that has started and not yet returned; `agentId` when a subagent made it. */
export type ActivityTool = { id: string; tool: string; startedAt: number; agentId?: string }

/** A subagent or teammate that is pending, running or waiting; `since` is when it was first seen. */
export type ActivityAgent = { id: string; type: string; description: string; status: string; since: number }

/** Background work that is not an agent: a shell, a monitor, a workflow. */
export type ActivityTask = { id: string; type: string; description: string; since: number }

export type ActivityLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type ActivityContext = {
  /** Input tokens of the last response (uncached + cache written + cache read). */
  tokens?: number
  /** The model's context window. */
  window: number
  /** tokens / window, 0 to 100. */
  percent?: number
  /** Token count at which auto-compaction runs; absent when it is off or not yet known. */
  compactAt?: number
}

/** One row of the /context breakdown; `color` is the theme key /context draws it in. */
export type ActivityCategory = { name: string; tokens: number; color: string }

/** Everything the line and the dashboard draw, as of `now`. */
export type ActivitySnapshot = {
  now: number
  /** When the session began (a resumed session's first launch). */
  startedAt?: number
  model?: string
  context?: ActivityContext
  categories: ActivityCategory[]
  rateLimits: ActivityLimit[]
  costUsd?: number
  tools: ActivityTool[]
  agents: ActivityAgent[]
  tasks: ActivityTask[]
  todos: ActivityTodo[]
}

declare module 'claude-code' {
  interface PluginState {
    'activity-line': { snapshot: ActivitySnapshot }
  }
}
