export type AgentStatusWord = 'working' | 'waiting' | 'idle' | 'done' | 'offline'

/** One moment of activity, for the activity bars: what kind of work it was. */
export type Sample = {
  at: number
  kind: 'edit' | 'run' | 'wait'
}

/** One agent (a session, or one of its subagents). */
export type FleetAgent = {
  id: string
  name: string
  status: AgentStatusWord
  activity: string
  /** Where the agent works: a session's cwd, a subagent's last touched path. */
  path: string
  /** When the status or activity last changed. */
  updatedAt: number
  /** The last half hour of activity, oldest first. */
  trail: Sample[]
}

/** Another branch this one cannot merge with cleanly, and the files that clash. */
export type FleetConflict = {
  branch: string
  files: string[]
}

export type FleetWorktree = {
  path: string
  branch: string
  /** The full commit id. */
  head: string
  dirty: number
  dirtyFiles: string[]
  lastCommit: string
  /** The main worktree's branch, which `ahead` and `behind` count against. */
  base: string
  ahead: number
  behind: number
  conflicts: FleetConflict[]
}

/** One line of the feed. */
export type FleetEvent = {
  /** Stable across sessions, so the union shows each event once. */
  id: string
  kind: 'commit' | 'done' | 'needs' | 'stuck' | 'message' | 'reply'
  /** Who it is about: an agent's name, or a branch for a commit. */
  who: string
  text: string
  at: number
}

/**
 * What one session writes to ~/.claude/agent-fleet/v4/<session>.json. Every
 * session on the machine reads every file, so each pane draws the union.
 */
export type FleetBeat = {
  v: 4
  sessionId: string
  cwd: string
  /** The main working tree of the session's repo; '' outside a repo. */
  repoRoot: string
  /** Set with `/fleet name`; else the pane names the session by `title`. */
  name: string
  /** The session's first prompt, shortened: what it was started for. */
  title: string
  /** A real session, which may send the machine's notifications. */
  notifier: boolean
  /** This session's last `git worktree list` of its repo, shared with the others. */
  worktrees: FleetWorktree[]
  worktreesAt: number
  status: AgentStatusWord
  activity: string
  prompt: string
  trail: Sample[]
  subagents: FleetAgent[]
  events: FleetEvent[]
  /** When the status or activity last changed. */
  updatedAt: number
  /** The last heartbeat: a session that stops writing goes offline. */
  aliveAt: number
  ended?: boolean
  /** The person's last message to this session from another session. */
  inbox?: { text: string; at: number } | null
  /** This session's answer to it: its first reply after the message. */
  reply?: { text: string; at: number } | null
}

export type FleetView = {
  beats: FleetBeat[]
  checkedAt: number
}

/** This session's own pane settings and what its buttons last did. */
export type FleetUi = {
  /** The map alone, no feed. */
  compact: boolean
  /** Repo roots whose branches are folded. */
  folded: string[]
  /** A row key (an agent), or `branch:<worktree path>`: its details show under it. */
  selected: string
  /** The feed marks what came after this as new. */
  seenAt: number
  /** Events already sent as notifications. */
  notified: string[]
  notifiedAt: number
  lastAction: { text: string; ok: boolean; at: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-fleet': {
      view: Shaped<FleetView>
      self: Shaped<FleetBeat>
      ui: Shaped<FleetUi>
    }
  }
}
