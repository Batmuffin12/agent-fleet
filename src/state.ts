// The starting values of what the host keeps for this session: every
// session's files as last read (`view`), this session's own file (`self`) and
// its pane settings (`ui`).
//
// The engine lists what a module reads and writes by scanning each file, so a
// file that reads or writes one of these declares its own atom, right there:
//
//   const self = atom({ plugin: 'agent-fleet', key: 'self' } as const, EMPTY_BEAT, { shape: 'self-4' })
//   const view = atom({ plugin: 'agent-fleet', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-4' })
//   const ui = atom({ plugin: 'agent-fleet', key: 'ui' } as const, EMPTY_UI, { shape: 'ui-2' })
//
// Change a value's shape here and in each of those lines together.
import type { FleetBeat, FleetUi, FleetView } from '../types'

export const EMPTY_BEAT: FleetBeat = {
  v: 4,
  sessionId: '',
  cwd: '',
  repoRoot: '',
  name: '',
  title: '',
  notifier: true,
  worktrees: [],
  worktreesAt: 0,
  status: 'idle',
  activity: '',
  prompt: '',
  trail: [],
  subagents: [],
  events: [],
  updatedAt: 0,
  aliveAt: 0,
}

export const EMPTY_VIEW: FleetView = { beats: [], checkedAt: 0 }

export const EMPTY_UI: FleetUi = {
  compact: false,
  folded: [],
  selected: '',
  seenAt: 0,
  notified: [],
  notifiedAt: 0,
  lastAction: null,
}
