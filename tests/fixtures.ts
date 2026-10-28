// A small fleet the tests share: two repos, a predicted conflict, a session
// waiting on the person, a busy subagent and an exchange with the person.
import type { FleetBeat, FleetView, FleetWorktree } from '../types'

export const NOW = 10_000_000

export const tree = (over: Partial<FleetWorktree> & { path: string; branch: string }): FleetWorktree => ({
  head: 'abc1234abc1234',
  dirty: 0,
  dirtyFiles: [],
  lastCommit: 'init',
  base: 'main',
  ahead: 0,
  behind: 0,
  conflicts: [],
  ...over,
})

export const beat = (over: Partial<FleetBeat> & { sessionId: string }): FleetBeat => ({
  v: 4,
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
  updatedAt: NOW - 2_000,
  aliveAt: NOW - 1_000,
  ...over,
})

const APP_TREES = [
  tree({ path: 'C:/code/app', branch: 'main' }),
  tree({
    path: 'C:/code/app-wt/auth',
    branch: 'feat/auth',
    dirty: 1,
    dirtyFiles: ['src/config.ts'],
    ahead: 2,
    behind: 1,
    conflicts: [{ branch: 'fix/billing', files: ['README.md'] }],
  }),
  tree({
    path: 'C:/code/app-wt/billing',
    branch: 'fix/billing',
    dirty: 1,
    dirtyFiles: ['src/config.ts'],
    ahead: 1,
    conflicts: [{ branch: 'feat/auth', files: ['README.md'] }],
  }),
]

export const ME = beat({ sessionId: 'me-session', title: 'my work', cwd: 'C:/code/app', repoRoot: 'C:/code/app' })

export const VIEW: FleetView = {
  checkedAt: NOW,
  beats: [
    beat({
      sessionId: 'other-session',
      title: 'oauth login',
      cwd: 'C:\\code\\app-wt\\auth\\src',
      repoRoot: 'C:/code/app',
      worktrees: APP_TREES,
      worktreesAt: NOW - 1_000,
      status: 'working',
      activity: 'Edit login.ts',
      prompt: 'add oauth login',
      trail: [
        { at: NOW - 60_000, kind: 'edit' },
        { at: NOW - 30_000, kind: 'edit' },
        { at: NOW - 20_000, kind: 'run' },
      ],
      subagents: [
        {
          id: 'sub-billing',
          name: 'billing worker',
          status: 'working',
          activity: 'Edit config.ts',
          path: 'C:/code/app-wt/billing/src/config.ts',
          updatedAt: NOW - 1_000,
          trail: [{ at: NOW - 5_000, kind: 'edit' }],
        },
      ],
      events: [{ id: 'commit:auth:1', kind: 'commit', who: 'feat/auth', text: '2 new commits', at: NOW - 90_000 }],
      inbox: { text: 'stop after login.ts', at: NOW - 50_000 },
      reply: { text: 'Stopping after login.ts, then committing.', at: NOW - 40_000 },
    }),
    beat({
      sessionId: 'blocked-session',
      title: 'site deploy',
      cwd: 'C:/code/site',
      repoRoot: 'C:/code/site',
      worktrees: [tree({ path: 'C:/code/site', branch: 'main' })],
      worktreesAt: NOW - 1_000,
      status: 'waiting',
      activity: 'ask: Bash npm publish',
    }),
  ],
}
