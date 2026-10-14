export type ActivityTodo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

export type ActivityTool = { tool: string; startedAt: number; inAgent: boolean }

export type ActivityAgent = { id: string; type: string; description: string; status: string }

export type ActivityLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type ActivityContext = { tokens?: number; window: number; percent?: number }

/** Everything the line and the pane draw, as of `now`. */
export type ActivitySnapshot = {
  now: number
  context?: ActivityContext
  rateLimits: ActivityLimit[]
  costUsd?: number
  tools: ActivityTool[]
  agents: ActivityAgent[]
  todos: ActivityTodo[]
}

declare module 'claude-code' {
  interface PluginState {
    'activity-line': { snapshot: ActivitySnapshot }
  }
}
