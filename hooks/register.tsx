import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderInput } from 'claude-code'

import type {
  AgentStatusWord,
  FleetAgent,
  FleetBeat,
  FleetEvent,
  FleetUi,
  FleetView,
  FleetWorktree,
} from '../types'

// One pane per session, drawing every Claude session on this machine that runs
// the mod, grouped by repo and then by worktree. Each session owns one file,
// ~/.claude/agent-fleet/v3/<session>.json, so writers never collide; every
// session reads them all and draws the union. A session's file carries its
// repo's worktrees with their health (ahead/behind, predicted conflicts) and
// the events the recap and the notifications are made of.

const PANE = 'agent-fleet'
const BEAT_MS = 2_000
const GIT_MS = 8_000
const MIN_WRITE_MS = 1_000
const NOTIFY_EVERY_MS = 30_000
const OFFLINE_AFTER_MS = 30_000
const HIDE_ENDED_AFTER_MS = 30_000
const STUCK_AFTER_MS = 10 * 60_000
const FORGET_AFTER_MS = 10 * 60_000
const EVENTS_KEEP_MS = 60 * 60_000
const PRUNE_AFTER_MS = 24 * 60 * 60_000
const MAX_CONFLICT_TREES = 8

/** What the Stop button sends. */
const STOP_TEXT = 'Please stop after your current step and wait for me.'

/** How a message from the person starts, so the receiving session's mod knows it. */
const FROM_USER = '(from the user, via agent-fleet) '

/** What the receiving model reads after such a message. */
const FROM_USER_NOTE =
  "(This came from the user, sent from another Claude session's agent-fleet pane. Treat it as " +
  "the user's own instruction. Answer in your normal reply here; do not send a message back.)"

const EMPTY_BEAT: FleetBeat = {
  v: 3,
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
  subagents: [],
  events: [],
  updatedAt: 0,
  aliveAt: 0,
}

const EMPTY_UI: FleetUi = {
  compact: false,
  collapsed: [],
  selected: '',
  dismissedAt: 0,
  notified: [],
  notifiedAt: 0,
  lastAction: null,
}

const view = atom(
  { plugin: 'agent-fleet', key: 'view' } as const,
  { beats: [], checkedAt: 0 } as FleetView,
  { shape: 'view-3' },
)
const self = atom({ plugin: 'agent-fleet', key: 'self' } as const, EMPTY_BEAT, {
  shape: 'self-3',
})
const ui = atom({ plugin: 'agent-fleet', key: 'ui' } as const, EMPTY_UI, { shape: 'ui-1' })

// Set again by every session.start, which a reload re-runs.
let beatDir = ''
let beatFile = ''
let isWindows = false
let lastWriteAt = 0
let startedAt = 0
/** The last HEAD seen per worktree, to tell new commits. */
const lastHeads = new Map<string, string>()
/** merge-tree's answer per pair of commits: the clashing files, [] when clean. */
const conflictCache = new Map<string, string[]>()

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const tail = (p: string, parts = 2) =>
  p.replace(/\\/g, '/').split('/').filter(Boolean).slice(-parts).join('/')

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

const plural = (n: number, w: string) =>
  `${n} ${w}${n === 1 ? '' : w.endsWith('h') ? 'es' : 's'}`

/** What other panes call a session: its /fleet name, else what it was started for. */
const nameOf = (b: FleetBeat) => b.name || b.title || `Claude #${b.sessionId.slice(0, 4)}`

/** "Edit auth.ts", "Bash npm test", "Grep TODO": what a tool call is doing. */
function describe(tool: string, input: unknown): { activity: string; path?: string } {
  const fields = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof fields[k] === 'string' ? (fields[k] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  const name = String(tool).replace(/^mcp__[^_]+__/, '')
  const detail =
    str('command') ??
    str('pattern') ??
    (path ? tail(path) : undefined) ??
    str('description') ??
    str('url') ??
    str('query')

  return { activity: clip(detail ? `${name} ${detail}` : name, 80), path }
}

/** Tools that stop and wait for the person whatever the permission mode. */
const ASKS: Record<string, string> = {
  AskUserQuestion: 'asking you a question',
  ExitPlanMode: 'waiting for you to approve a plan',
}

function agentStatus(s: string): AgentStatusWord {
  if (s === 'running') return 'working'
  if (s === 'pending' || s === 'waiting') return 'waiting'
  if (s === 'idle') return 'idle'
  return 'done'
}

// ── This session's file ──────────────────────────────────────────────────

async function write($: EngineInterface) {
  if (!beatFile) return
  const beat = await read($, self)
  lastWriteAt = await $.clock.now()
  await $.fs.write(beatFile, JSON.stringify(beat)).catch(() => {})
}

/** Writes now, or leaves it to the next heartbeat when the last write was recent. */
async function flush($: EngineInterface) {
  if ((await $.clock.now()) - lastWriteAt >= MIN_WRITE_MS) await write($)
}

async function addEvent($: EngineInterface, kind: FleetEvent['kind'], id: string, text: string) {
  const now = await $.clock.now()
  await update($, self, b =>
    b.events.some(x => x.id === id)
      ? b
      : {
          ...b,
          events: [
            ...b.events.filter(x => now - x.at < EVENTS_KEEP_MS).slice(-29),
            { id, kind, text, at: now },
          ],
        },
  )
}

/** Turns a status change into an event: finished, or needs the person. */
async function noteChange(
  $: EngineInterface,
  agent: { id: string; name: string; activity: string },
  from: AgentStatusWord,
  to: AgentStatusWord,
  isSession: boolean,
) {
  const now = await $.clock.now()
  if (to === 'waiting') {
    const why = sentence(agent.activity, to)
    await addEvent($, 'needs', `needs:${agent.id}:${now}`, `${agent.name} needs you: ${why}`)
  } else if (from === 'working' && (to === 'done' || (isSession && to === 'idle'))) {
    const text = isSession ? `${agent.name} finished and is waiting for you` : `${agent.name} finished`
    await addEvent($, 'done', `done:${agent.id}:${now}`, text)
  }
}

async function setSelf($: EngineInterface, patch: Partial<FleetBeat>) {
  const now = await $.clock.now()
  const before = await read($, self)
  await update($, self, b => ({ ...b, ...patch, updatedAt: now, aliveAt: now }))
  const after = await read($, self)
  if (after.status !== before.status) {
    const agent = { id: after.sessionId, name: nameOf(after), activity: after.activity }
    await noteChange($, agent, before.status, after.status, true)
  }
  void flush($)
}

async function setSub($: EngineInterface, id: string, patch: Partial<FleetAgent>) {
  const now = await $.clock.now()
  const old = (await read($, self)).subagents.find(a => a.id === id)
  const next: FleetAgent = {
    id,
    name: old?.name ?? id.slice(0, 8),
    status: 'working',
    activity: '',
    path: old?.path ?? '',
    ...old,
    ...patch,
    updatedAt: now,
  }
  await update($, self, b => ({
    ...b,
    subagents: [...b.subagents.filter(a => a.id !== id), { ...next, path: next.path || b.cwd }],
  }))
  if (old && old.status !== next.status) await noteChange($, next, old.status, next.status, false)
  void flush($)
}

/** Sets the session's or a subagent's status, whichever `agentId` names. */
const setAgent = ($: EngineInterface, agentId: string | undefined, patch: Partial<FleetAgent>) =>
  agentId ? setSub($, agentId, patch) : setSelf($, patch)

async function statusOf($: EngineInterface, agentId?: string) {
  const b = await read($, self)
  return agentId ? b.subagents.find(a => a.id === agentId)?.status : b.status
}

async function refreshAgents($: EngineInterface) {
  const agents = await $.agent.list().catch(() => [])
  const now = await $.clock.now()
  const before = await read($, self)
  await update($, self, b => ({
    ...b,
    subagents: agents.map(a => {
      const old = b.subagents.find(s => s.id === a.id)
      const listed = agentStatus(a.status)
      // A subagent stopped on a question stays waiting until it moves on.
      const status = old?.status === 'waiting' && listed === 'working' ? 'waiting' : listed
      return {
        id: a.id,
        name: a.name ?? a.description ?? a.type,
        status,
        activity: status === 'done' ? a.status : old?.activity ?? a.description,
        path: old?.path ?? b.cwd,
        updatedAt: old?.updatedAt ?? now,
      }
    }),
    aliveAt: now,
  }))
  for (const s of (await read($, self)).subagents) {
    const old = before.subagents.find(o => o.id === s.id)
    if (old && old.status !== s.status) await noteChange($, s, old.status, s.status, false)
  }
}

/** An agent of this session that has done nothing for a while gets one event. */
async function noteStuck($: EngineInterface, now: number) {
  const me = await read($, self)
  const agents = [{ id: me.sessionId, name: nameOf(me), status: me.status, updatedAt: me.updatedAt }, ...me.subagents]
  for (const a of agents) {
    if (a.status !== 'working' || now - a.updatedAt < STUCK_AFTER_MS) continue
    const text = `${a.name} has shown no progress for ${ago(now - a.updatedAt)}`
    await addEvent($, 'stuck', `stuck:${a.id}:${a.updatedAt}`, text)
  }
}

// ── Git: worktrees and their health ──────────────────────────────────────

async function git($: EngineInterface, cwd: string, ...args: string[]) {
  const r = await $.process
    .run(['git', ...args], { cwd, timeoutMs: 10_000 })
    .catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : ''
}

/** The files two commits would clash on if merged; git touches no worktree. */
async function clashes($: EngineInterface, root: string, a: string, b: string) {
  if (a === b) return []
  const key = [a, b].sort().join(':')
  const known = conflictCache.get(key)
  if (known) return known
  const r = await $.process
    .run(['git', 'merge-tree', '--write-tree', '--name-only', '--no-messages', a, b], {
      cwd: root,
      timeoutMs: 10_000,
    })
    .catch(() => undefined)
  if (!r || (r.exitCode !== 0 && r.exitCode !== 1)) return []
  const files = r.exitCode === 1 ? r.stdout.split(/\r?\n/).slice(1).filter(Boolean) : []
  conflictCache.set(key, files)
  return files
}

async function readWorktrees($: EngineInterface, root: string): Promise<FleetWorktree[]> {
  const out = await git($, root, 'worktree', 'list', '--porcelain')
  const blocks = out.split(/\r?\n\r?\n/).filter(b => b.trim())
  const listed = blocks.map(block => {
    const lines = block.split(/\r?\n/)
    const field = (k: string) =>
      lines.find(l => l.startsWith(k + ' '))?.slice(k.length + 1) ?? ''
    const branch = field('branch').replace(/^refs\/heads\//, '')
    return {
      path: field('worktree'),
      head: field('HEAD'),
      branch: branch || (lines.includes('bare') ? '(bare)' : '(detached)'),
    }
  })
  // The main worktree comes first: its branch is what the others are measured against.
  const base = listed[0]?.branch ?? ''

  const trees: FleetWorktree[] = await Promise.all(
    listed.map(async t => {
      const blank = { ...t, base, dirty: 0, dirtyFiles: [], lastCommit: '', ahead: 0, behind: 0, conflicts: [] }
      if (t.branch === '(bare)') return blank
      const [status, log, counts] = await Promise.all([
        git($, t.path, 'status', '--porcelain'),
        git($, t.path, 'log', '-1', '--format=%s (%cr)'),
        t.branch !== base && t.head
          ? git($, root, 'rev-list', '--left-right', '--count', `${base}...${t.head}`)
          : Promise.resolve(''),
      ])
      const dirtyFiles = status
        .split(/\r?\n/)
        .filter(Boolean)
        .map(l => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''))
      const [behind = 0, ahead = 0] = counts.trim().split(/\s+/).map(Number)
      return {
        ...blank,
        dirty: dirtyFiles.length,
        dirtyFiles,
        lastCommit: log.trim(),
        ahead: ahead || 0,
        behind: behind || 0,
      }
    }),
  )

  const live = trees.filter(t => t.head && t.branch !== '(bare)').slice(0, MAX_CONFLICT_TREES)
  for (const [i, a] of live.entries()) {
    for (const b of live.slice(i + 1)) {
      const files = await clashes($, root, a.head, b.head)
      if (!files.length) continue
      a.conflicts.push({ branch: b.branch, files })
      b.conflicts.push({ branch: a.branch, files })
    }
  }
  return trees
}

/** A worktree whose HEAD moved since the last look gets a commit event. */
async function noteCommits($: EngineInterface, root: string, trees: FleetWorktree[]) {
  for (const t of trees) {
    const key = norm(t.path)
    const prev = lastHeads.get(key)
    lastHeads.set(key, t.head)
    if (!prev || !t.head || prev === t.head) continue
    const n = Number((await git($, root, 'rev-list', '--count', `${prev}..${t.head}`)).trim()) || 0
    const text = n > 0 ? `${t.branch}: ${plural(n, 'new commit')}` : `${t.branch} moved to ${t.head.slice(0, 7)}`
    await addEvent($, 'commit', `commit:${key}:${t.head}`, text)
  }
}

// ── Every session's file ─────────────────────────────────────────────────

async function readAllBeats($: EngineInterface): Promise<{ name: string; beat?: FleetBeat }[]> {
  const entries = await $.fs.list(beatDir).catch(() => [])
  return Promise.all(
    entries
      .filter(f => f.kind === 'file' && f.name.endsWith('.json'))
      .map(async f => {
        try {
          const beat = JSON.parse(await $.fs.read(`${beatDir}/${f.name}`)) as FleetBeat
          return { name: f.name, beat: beat?.v === 3 ? beat : undefined }
        } catch {
          return { name: f.name }
        }
      }),
  )
}

/** Every live session's beat; one that stopped writing is marked offline. */
async function readBeats($: EngineInterface, now: number): Promise<FleetBeat[]> {
  return (await readAllBeats($))
    .map(f => f.beat)
    .filter((b): b is FleetBeat => {
      if (!b) return false
      const quiet = now - b.aliveAt
      return b.ended ? quiet < HIDE_ENDED_AFTER_MS : quiet < FORGET_AFTER_MS
    })
    .map(b =>
      !b.ended && now - b.aliveAt > OFFLINE_AFTER_MS
        ? { ...b, status: 'offline' as const, updatedAt: b.aliveAt }
        : b,
    )
}

/** Deletes files of sessions gone for a day: the engine has no fs delete. */
async function prune($: EngineInterface, now: number) {
  for (const f of await readAllBeats($)) {
    if (f.beat && now - f.beat.aliveAt < PRUNE_AFTER_MS) continue
    const path = `${beatDir}/${f.name}`
    const argv = isWindows
      ? ['cmd', '/c', 'del', '/f', '/q', path.replace(/\//g, '\\')]
      : ['rm', '-f', path]
    await $.process.run(argv, { timeoutMs: 5_000 }).catch(() => undefined)
  }
}

/** Every session's events, each once, oldest first. */
function allEvents(beats: FleetBeat[]): FleetEvent[] {
  const byId = new Map<string, FleetEvent>()
  for (const b of beats) for (const x of b.events ?? []) byId.set(x.id, x)
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

/**
 * One session sends the machine's notifications, so five sessions do not
 * ping five times: the live real session with the lowest id. At most one
 * notification per NOTIFY_EVERY_MS, gathering what came in meanwhile.
 */
async function notifyNews($: EngineInterface, beats: FleetBeat[], me: FleetBeat, now: number) {
  const leader = beats
    .filter(b => b.notifier && !b.ended && b.status !== 'offline')
    .map(b => b.sessionId)
    .sort()[0]
  if (leader !== me.sessionId) return
  const u = await read($, ui)
  if (now - u.notifiedAt < NOTIFY_EVERY_MS) return
  const news = allEvents(beats).filter(
    x => x.kind !== 'commit' && x.at > startedAt && !u.notified.includes(x.id),
  )
  if (!news.length) return
  await update($, ui, s => ({
    ...s,
    notifiedAt: now,
    notified: [...s.notified, ...news.map(x => x.id)].slice(-200),
  }))
  const text =
    news.length === 1
      ? news[0]!.text
      : `${news.length} updates: ${news.slice(-3).map(x => x.text).join(' · ')}`
  await $.ui.notify(clip(text, 190), { title: 'Agent fleet' }).catch(() => undefined)
}

// ── How the pane words and draws things ──────────────────────────────────

/** Claude's spark, cycling while an agent works. */
const SPARK = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢']

const STATUS: Record<AgentStatusWord, { label: string; color: string }> = {
  working: { label: 'working', color: 'claude' },
  waiting: { label: 'needs you', color: 'warning' },
  idle: { label: 'idle', color: 'suggestion' },
  done: { label: 'finished', color: 'success' },
  offline: { label: 'offline', color: 'error' },
}

const KIND_COLOR: Record<FleetEvent['kind'], string> = {
  commit: 'suggestion',
  done: 'success',
  needs: 'warning',
  stuck: 'error',
}

const FIXED: Record<string, string> = {
  'thinking…': 'Thinking about what to do next',
  'waiting for you': 'Waiting for your next message',
  'turn finished': 'Done with its step, waiting for the next one',
  completed: 'Finished its job',
  'session ended': 'Session was closed',
}

const VERBS: Record<string, (d: string) => string> = {
  Read: d => `Reading ${d}`,
  Edit: d => `Editing ${d}`,
  MultiEdit: d => `Editing ${d}`,
  Write: d => `Writing ${d}`,
  NotebookEdit: d => `Editing notebook ${d}`,
  Bash: d => `Running "${d}"`,
  PowerShell: d => `Running "${d}"`,
  Grep: d => `Searching the code for "${d}"`,
  Glob: d => `Looking for files matching ${d}`,
  Agent: d => `Handing a task to "${d}"`,
  Task: d => `Handing a task to "${d}"`,
  WebFetch: d => `Reading the web page ${d}`,
  WebSearch: d => `Searching the web for "${d}"`,
  TaskList: () => 'Checking its to-do list',
  TodoWrite: () => 'Updating its to-do list',
}

/** "Edit auth.ts" → "Editing auth.ts.": one plain sentence per activity. */
function sentence(activity: string, status: AgentStatusWord): string {
  const a = activity.trim()
  if (!a) return status === 'idle' ? 'Waiting for your first message.' : 'Getting ready.'
  if (a.startsWith('ask: ')) return `Wants your OK: ${sentence(a.slice(5), 'working')}`
  if (a.startsWith('asks: ')) return `Is ${a.slice(6)}.`
  if (FIXED[a]) return FIXED[a] + '.'
  if (status === 'done') return `Finished (${a}).`
  const [tool = '', ...rest] = a.split(' ')
  const d = rest.join(' ').replace(/^"(.*)"$/, '$1')
  const verb = VERBS[tool]
  if (verb) return verb(d) + '.'
  return (d ? `Using ${tool}: ${d}` : `Using ${tool}`) + '.'
}

type Row = {
  /** The session id, or `<session>/<subagent>`: what selection remembers. */
  key: string
  /** What the person types after @ to message it. */
  handle: string
  agent: FleetAgent
  repo: string
  isSub: boolean
  task: string
  /** A session's own file; a subagent's is its parent's. */
  beat?: FleetBeat
  parent?: FleetBeat
  tree?: FleetWorktree
}

/** Every agent on the machine, with the repo and worktree it belongs to. */
function gather(v: FleetView, me: FleetBeat) {
  const now = v.checkedAt || me.aliveAt

  const label = (b: FleetBeat) => (b.sessionId === me.sessionId ? 'You (this session)' : nameOf(b))

  const beats = [...v.beats.filter(b => b.sessionId !== me.sessionId), me]
  const rows: Row[] = beats.flatMap(b => [
    {
      key: b.sessionId,
      handle: slug(nameOf(b)),
      beat: b,
      agent: {
        id: b.sessionId,
        name: label(b),
        status: b.status,
        activity: b.activity,
        path: b.cwd,
        updatedAt: b.updatedAt,
      },
      repo: b.repoRoot,
      isSub: false,
      task: b.prompt,
    },
    ...b.subagents
      .filter(s => s.status !== 'done' || now - s.updatedAt < 5 * 60_000)
      .map(s => ({
        key: `${b.sessionId}/${s.id}`,
        handle: slug(s.name),
        agent: s,
        repo: b.repoRoot,
        isSub: true,
        task: '',
        parent: b,
      })),
  ])

  // Each repo's worktrees: this session's own, else the freshest a session shared.
  const treesOf = new Map<string, FleetWorktree[]>()
  for (const b of [...beats].sort((x, y) => x.worktreesAt - y.worktreesAt)) {
    if (b.repoRoot && b.worktrees.length) treesOf.set(norm(b.repoRoot), b.worktrees)
  }
  if (me.repoRoot && me.worktrees.length) treesOf.set(norm(me.repoRoot), me.worktrees)

  // An agent goes to the deepest worktree its path lies in, else its repo's main one.
  const treeFor = (repo: string, path: string) => {
    const trees = [...(treesOf.get(norm(repo)) ?? [])].sort((a, b) => b.path.length - a.path.length)
    const n = norm(path)
    return (
      trees.find(t => n === norm(t.path) || n.startsWith(norm(t.path) + '/')) ??
      trees.find(t => norm(t.path) === norm(repo))
    )
  }
  for (const r of rows) r.tree = r.repo ? treeFor(r.repo, r.agent.path) : undefined

  const repos = [...new Set(rows.map(r => r.repo).filter(Boolean).map(norm))].sort((a, b) =>
    a === norm(me.repoRoot) ? -1 : b === norm(me.repoRoot) ? 1 : a.localeCompare(b),
  )
  const count = (s: AgentStatusWord) => rows.filter(r => r.agent.status === s).length
  const needsYou = rows.filter(r => r.agent.status === 'waiting')
  const where = (r: Row) =>
    [r.repo ? tail(r.repo, 1) : 'no repo', r.tree?.branch].filter(Boolean).join(' · ')

  return { now, beats, rows, treesOf, treeFor, repos, count, needsYou, where, label }
}

/** Warnings for one worktree: clashes with other branches, and shared files. */
function warningsFor(t: FleetWorktree, trees: FleetWorktree[], rows: Row[]): string[] {
  const out = t.conflicts.map(
    c => `Will conflict with ${c.branch} in ${c.files.slice(0, 3).join(', ')}${c.files.length > 3 ? '…' : ''}`,
  )
  for (const o of trees) {
    if (o.path === t.path) continue
    const shared = t.dirtyFiles.filter(f => o.dirtyFiles.includes(f))
    if (shared.length) out.push(`${o.branch} also has unsaved changes to ${shared.slice(0, 3).join(', ')}`)
  }
  // Agents editing the same file of the repo, each in its own worktree or not.
  const fileOf = (r: Row) => {
    const p = norm(r.agent.path)
    const root = r.tree ? norm(r.tree.path) : ''
    return root && p.startsWith(root + '/') && /\.[a-z0-9]+$/.test(p) ? p.slice(root.length + 1) : ''
  }
  const here = rows.filter(r => r.tree?.path === t.path && fileOf(r))
  for (const r of here) {
    const others = rows.filter(o => o !== r && o.repo === r.repo && fileOf(o) === fileOf(r))
    if (others.length) {
      const names = others.map(o => o.agent.name).join(', ')
      out.push(`${r.agent.name} and ${names} are ${others.length === 1 ? 'both' : 'all'} editing ${fileOf(r)}`)
    }
  }
  return [...new Set(out)]
}

/** What the agent is doing, in one sentence. */
const said = (r: Row, now: number) =>
  r.agent.status === 'offline' && r.agent.activity !== 'session ended'
    ? `Stopped responding ${ago(now - r.agent.updatedAt)} ago.`
    : sentence(r.agent.activity, r.agent.status)

/** The fleet as plain text, for a surface that draws no pane. */
function summary(v: FleetView, me: FleetBeat): string {
  const { now, rows, treesOf, repos, count, needsYou, where } = gather(v, me)
  const agent = (r: Row) =>
    `${r.isSub ? '    └ ' : '  • '}${r.agent.name}` +
    `${r.isSub || r.agent.id !== me.sessionId ? ` (@${r.handle})` : ''} — ${STATUS[r.agent.status].label}` +
    `${r.agent.updatedAt ? ` ${ago(now - r.agent.updatedAt)}` : ''}\n      ${said(r, now)}` +
    (r.task ? `\n      Task: ${r.task}` : '')
  const out = [
    `✻ Agent fleet — ${plural(repos.length, 'repo')} · ${plural(rows.length, 'agent')}`,
    (['working', 'waiting', 'idle', 'done', 'offline'] as const)
      .map(s => `${count(s)} ${STATUS[s].label}`)
      .join(' · '),
  ]
  if (needsYou.length) {
    out.push('', `⚠ Needs you (${needsYou.length})`)
    for (const r of needsYou) out.push(`  • ${r.agent.name} (${where(r)}): ${said(r, now)}`)
  }
  for (const key of repos) {
    const inRepo = rows.filter(r => r.repo && norm(r.repo) === key)
    const trees = treesOf.get(key) ?? []
    out.push('', `▌${tail(inRepo[0]?.repo ?? key, 1)}${key === norm(me.repoRoot) ? ' (this repo)' : ''}`)
    for (const t of trees) {
      const here = inRepo.filter(r => r.tree?.path === t.path)
      if (!here.length && key !== norm(me.repoRoot)) continue
      out.push(`⎇ ${t.branch} — ${t.dirty ? plural(t.dirty, 'unsaved change') : 'clean'}`)
      out.push(...warningsFor(t, trees, inRepo).map(w => `  ⚠ ${w}`))
      out.push(...(here.length ? here.map(agent) : ['  no agent']))
    }
    out.push(...inRepo.filter(r => !r.tree).map(agent))
  }
  const loose = rows.filter(r => !r.repo)
  if (loose.length) out.push('', '▌Outside any repo', ...loose.map(agent))
  return out.join('\n')
}

/** The short title a session gets from its first prompt. */
const titleFrom = (text: string) => clip(text.split(/\r?\n/)[0] ?? '', 28)

/** What the person types after @ to talk to an agent: "auth worker" → "auth-worker". */
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent'

/**
 * The agents an @handle names: an exact handle, a session's id start
 * (`#72ba`) or its branch (`feat-auth`); else the handles it starts.
 */
function findAgent(rows: Row[], me: FleetBeat, token: string): Row[] {
  const t = token.toLowerCase().replace(/^[@#]/, '')
  const others = rows.filter(r => r.isSub || r.agent.id !== me.sessionId)
  const exact = others.filter(
    r =>
      r.handle === t ||
      r.agent.id.toLowerCase().slice(0, 4) === t ||
      (!r.isSub && !!r.tree && slug(r.tree.branch) === slug(t)),
  )
  if (exact.length || t.length < 2) return exact
  return others.filter(r => r.handle.startsWith(t))
}

/** Sends the person's message to an agent: a session itself, a subagent through its session. */
async function sendTo($: EngineInterface, me: FleetBeat, r: Row, text: string) {
  const viaParent = r.isSub && r.parent?.sessionId !== me.sessionId
  const to = !r.isSub
    ? { sessionId: r.agent.id }
    : viaParent
      ? { sessionId: r.parent?.sessionId ?? '' }
      : { agentId: r.agent.id }
  const body = FROM_USER + (viaParent ? `For your subagent "${r.agent.name}": ${text}` : text)
  const res = await $.session
    .send({ to, text: body })
    .catch((err: unknown) => ({ isDelivered: false as const, reason: String(err) }))
  const at = await $.clock.now()
  const msg = res.isDelivered
    ? `Sent to ${r.agent.name}: "${clip(text, 40)}"`
    : `Couldn't reach ${r.agent.name}: ${clip(res.reason ?? '', 60)}`
  await update($, ui, s => ({ ...s, lastAction: { text: msg, ok: res.isDelivered, at } }))
  return { msg, ok: res.isDelivered }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const [sessionId, cwd, repo, home, os, now] = await Promise.all([
      $.session.id(),
      $.session.cwd(),
      $.session.repo(),
      $.env.get('USERPROFILE').then(v => v ?? $.env.get('HOME')),
      $.env.get('OS'),
      $.clock.now(),
    ])
    isWindows = os === 'Windows_NT'
    startedAt = now
    beatDir = `${(home ?? '.').replace(/\\/g, '/')}/.claude/agent-fleet/v3`
    beatFile = `${beatDir}/${sessionId}.json`
    const repoRoot = repo?.root ?? ''

    await update($, self, b => ({ ...b, v: 3 as const, notifier: true, sessionId, cwd, repoRoot }))
    await setSelf($, {})

    const pollBeats = async () => {
      await refreshAgents($)
      const now = await $.clock.now()
      await noteStuck($, now)
      await write($)
      const beats = await readBeats($, now)
      await update($, view, () => ({ beats, checkedAt: now }))
      await notifyNews($, beats, await read($, self), now)
    }
    const pollGit = async () => {
      if (!repoRoot) return
      const worktrees = await readWorktrees($, repoRoot)
      await noteCommits($, repoRoot, worktrees)
      const now = await $.clock.now()
      await update($, self, b => ({ ...b, worktrees, worktreesAt: now }))
    }
    void pollGit().then(pollBeats)
    void prune($, now)
    $.clock.every(BEAT_MS, () => void pollBeats())
    $.clock.every(GIT_MS, () => void pollGit())

    await $.command.register({
      name: 'fleet',
      description: 'Every Claude agent on this machine, by repo and branch (fleet name|compact|select …)',
    })
    void $.ui.open({ id: PANE, title: 'Agent fleet' })

    return next(e)
  })

  // `/fleet` opens the pane and answers with the fleet as text too: a surface
  // that places no pane (the phone) still gets the whole picture.
  // `/fleet name <name>`, `/fleet compact`, `/fleet select <agent or branch>`.
  on('command.run', { command: 'fleet' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()

    if (verb === 'name') {
      await setSelf($, { name: clip(arg, 30) })
      return { text: arg ? `Other panes now call this session "${clip(arg, 30)}".` : 'Name cleared.' }
    }
    if (verb === 'compact') {
      const { compact } = await update($, ui, u => ({ ...u, compact: !u.compact }))
      return { text: compact ? 'Compact view: one line per agent.' : 'Detailed view.' }
    }
    if (verb === 'select') {
      const [v, me] = await Promise.all([read($, view), read($, self)])
      const want = arg.toLowerCase()
      const row = gather(v, me).rows.find(
        r => r.agent.name.toLowerCase().includes(want) || (r.tree?.branch ?? '').toLowerCase().includes(want),
      )
      if (!row || !want) return { text: `No agent matches "${arg}".` }
      await update($, ui, u => ({ ...u, selected: row.key }))
      await $.ui.open({ id: PANE, title: 'Agent fleet' })
      return { text: `Selected ${row.agent.name}: its buttons are under it in the pane.` }
    }

    const [opened, surfaces, v, me] = await Promise.all([
      $.ui.open({ id: PANE, title: 'Agent fleet' }),
      $.session.surfaces(),
      read($, view),
      read($, self),
    ])
    const pane = opened.isPlaced ? 'pane drawn' : `pane not drawn: ${opened.reason}`

    return { text: `${summary(v, me)}\n\n(${pane} · screens: ${surfaces.join(', ')})` }
  })

  // "@auth-worker stop after this file" is a message for that agent, not for
  // this session's model. Anything else, an @file mention included, goes on.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.command) return next(e)
    const m = /^@([\w.#-]+)\s+([\s\S]+)$/.exec(e.text.trim())
    if (m) {
      const [v, me] = await Promise.all([read($, view), read($, self)])
      const found = findAgent(gather(v, me).rows, me, m[1] ?? '')
      if (found.length > 1) {
        const which = found.slice(0, 4).map(r => `@${r.handle} (#${r.agent.id.slice(0, 4)})`)
        return { drop: `@${m[1]} could be ${which.join(', ')}: use one of those.` }
      }
      if (found[0]) {
        const { msg, ok } = await sendTo($, me, found[0], (m[2] ?? '').trim())
        // The engine puts a dropped prompt back in the box: once sent, empty it,
        // unless the person has started typing something else.
        if (ok) {
          $.clock.after(300, async () => {
            const box = await $.prompt.read().catch(() => undefined)
            if (box?.text.trim() === e.text.trim()) await $.prompt.fill({ text: '' }).catch(() => undefined)
          })
        }
        return { drop: ok ? `${msg}. Its answer will show under it in the fleet pane.` : msg }
      }
    }
    const me = await read($, self)
    await setSelf($, { prompt: clip(e.text, 120), title: me.title || titleFrom(e.text) })
    return next(e)
  })

  // A message the person sent from another session's pane: their own
  // instruction. This session's next reply is the answer every pane shows.
  on('session.receive', async ($, e, next) => {
    const at = e.text.indexOf(FROM_USER)
    if (at < 0) return next(e)
    const text = e.text.slice(at + FROM_USER.length).trim()
    await setSelf($, { inbox: { text: clip(text, 120), at: await $.clock.now() }, reply: null })
    return next({ ...e, text: `${e.text}\n\n${FROM_USER_NOTE}` })
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await setSelf($, { status: 'working', activity: 'thinking…' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { activity, path } = describe(e.tool, e)
    const asks = ASKS[e.tool]
    await setAgent($, e.agentId, {
      status: asks ? 'waiting' : 'working',
      activity: asks ? `asks: ${asks}` : activity,
      ...(path ? { path } : {}),
    })
    const result = await next(e)
    // Answered: a question, a plan, or a permission prompt raised on the way.
    if ((await statusOf($, e.agentId)) === 'waiting') {
      await setAgent($, e.agentId, { status: 'working', activity: 'thinking…' })
    }
    return result
  }).catch(($, e, next) => next(e))

  // A permission prompt: the engine's verdict is an ask, put to the person.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && !ASKS[e.tool]) {
      const { activity } = describe(e.tool, e.input)
      await setAgent($, e.agentId, { status: 'waiting', activity: `ask: ${activity}` })
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) {
      await setSub($, e.agentId, { status: 'idle', activity: 'turn finished' })
      return result
    }
    // The first answer after a message from the fleet is its reply.
    const me = await read($, self)
    const isReply = !!me.inbox && (!me.reply || me.reply.at < me.inbox.at) && !!result.text.trim()
    const reply = isReply ? { reply: { text: clip(result.text, 160), at: await $.clock.now() } } : {}
    await setSelf($, { status: 'idle', activity: 'waiting for you', ...reply })
    return result
  })

  on('session.end', async ($, e, next) => {
    await update($, self, b => ({ ...b, ended: true }))
    await setSelf($, { status: 'offline', activity: 'session ended' })
    await write($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) =>
    drawFleet($, e, Math.max(24, e.props.bodyColumns)),
  )

  // The phone places no pane, so there /fleet's reply in the chat is the
  // fleet itself, live: it redraws as the sessions' files change.
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) =>
    e.props.command === 'fleet' && e.surface === 'mobile' && !e.props.isErrored
      ? drawFleet($, e)
      : next(e),
  )
}

async function drawFleet(
  $: EngineInterface,
  e: RenderInput<'Pane' | 'CommandOutput'>,
  width?: number,
) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const [v, me, u] = await Promise.all([read($, view), read($, self), read($, ui)])
  const tick = Math.floor(v.checkedAt / BEAT_MS)
  const { now, beats, rows, treesOf, repos, count, needsYou, where } = gather(v, me)

  const setUi = (fn: (s: FleetUi) => FleetUi) => void update($, ui, fn)
  const select = (r: Row) => setUi(s => ({ ...s, selected: s.selected === r.key ? '' : r.key }))

  // Message puts "@handle " in the prompt; the person finishes it there.
  const message = async (r: Row) => {
    const filled = await $.prompt.fill({ text: `@${r.handle} ` }).catch(() => undefined)
    $.ui.toast(
      filled?.isFilled
        ? `Type your message to ${r.agent.name} and press Enter`
        : `Type @${r.handle} and your message in the prompt`,
    )
  }

  // The same news again (a subagent that keeps asking) is one line with a count.
  const repeats = new Map<string, { x: FleetEvent; n: number }>()
  for (const x of allEvents(beats)) {
    if (x.at <= Math.max(u.dismissedAt, now - EVENTS_KEEP_MS)) continue
    repeats.set(x.text, { x, n: (repeats.get(x.text)?.n ?? 0) + 1 })
  }
  const recap = [...repeats.values()].sort((a, b) => b.x.at - a.x.at).slice(0, 6)

  const statusText = (r: Row) => {
    const s = STATUS[r.agent.status]
    return (
      <Text color={s.color} wrap="truncate-end">
        {' '}
        {s.label}
        <Text dimColor>{r.agent.updatedAt ? ` · ${ago(now - r.agent.updatedAt)}` : ''}</Text>
      </Text>
    )
  }

  const icon = (r: Row, i: number) =>
    r.agent.status === 'working' ? SPARK[(tick + i * 3) % SPARK.length] : '✻'

  const nameButton = (r: Row, prefix = '') => (
    <Button key={`${prefix}sel:${r.key}`} plain onPress={() => select(r)}>
      <Text bold>{r.agent.name}</Text>
    </Button>
  )

  const actions = (r: Row) => {
    if (!r.isSub && r.agent.id === me.sessionId) {
      return <Text dimColor>{'  '}This is you: pick another agent to message it.</Text>
    }
    const last = u.lastAction && now - u.lastAction.at < 60_000 ? u.lastAction : null
    const stop = () => void sendTo($, me, r, STOP_TEXT).then(({ msg }) => $.ui.toast(msg))
    return (
      <Box flexDirection="column" paddingLeft={2} marginTop={1}>
        <Box flexDirection="row" flexWrap="wrap">
          <Box marginRight={1}>
            <Button key="act:msg" hotkey="m" variant="primary" onPress={() => void message(r)}>
              Message (m)
            </Button>
          </Box>
          <Box marginRight={1}>
            <Button key="act:stop" hotkey="s" onPress={stop}>
              Stop (s)
            </Button>
          </Box>
          <Button key="act:close" hotkey="x" dimColor onPress={() => setUi(s => ({ ...s, selected: '' }))}>
            Close (x)
          </Button>
        </Box>
        {last ? (
          <Text color={last.ok ? 'success' : 'error'} wrap="truncate-end">
            {last.ok ? '✓ ' : '✗ '}
            {last.text} · {ago(now - last.at)} ago
          </Text>
        ) : null}
      </Box>
    )
  }

  // The person's last message to a session from the fleet, and its answer.
  const conversation = (b: FleetBeat) => {
    if (!b.inbox || now - b.inbox.at > 30 * 60_000) return null
    const answer = b.reply && b.reply.at >= b.inbox.at ? b.reply : null
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text dimColor wrap="truncate-end">
          → you: {b.inbox.text} · {ago(now - b.inbox.at)}
        </Text>
        {answer ? (
          <Text color="success" wrap="wrap">
            ↩ {answer.text} <Text dimColor>· {ago(now - answer.at)}</Text>
          </Text>
        ) : (
          <Text dimColor italic>
            {'  '}waiting for its answer…
          </Text>
        )}
      </Box>
    )
  }

  const agentRow = (r: Row, i: number) => {
    const s = STATUS[r.agent.status]
    const isSelected = r.key === u.selected
    const isMe = !r.isSub && r.agent.id === me.sessionId
    const head = (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexShrink={1}>
          <Text color={s.color} bold>
            {isSelected ? '▶ ' : r.isSub ? '└ ' : ''}
            {icon(r, i)}{' '}
          </Text>
          {nameButton(r)}
          {u.compact ? (
            <Text dimColor wrap="truncate-end">
              {' '}
              {said(r, now)}
            </Text>
          ) : isMe ? null : (
            <Text color="suggestion" wrap="truncate-end">
              {' '}@{r.handle}
            </Text>
          )}
        </Box>
        {statusText(r)}
      </Box>
    )
    const talk = r.beat ? conversation(r.beat) : null
    if (u.compact && !isSelected) {
      return (
        <Box flexDirection="column">
          {head}
          {talk}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" marginTop={i === 0 || u.compact ? 0 : 1}>
        {head}
        <Box paddingLeft={r.isSub ? 4 : 2}>
          <Text wrap="truncate-end" dimColor={r.agent.status !== 'working' && r.agent.status !== 'waiting'}>
            {said(r, now)}
          </Text>
        </Box>
        {r.task && !u.compact ? (
          <Box paddingLeft={2}>
            <Text wrap="truncate-end" dimColor>
              Task: <Text italic>{r.task}</Text>
            </Text>
          </Box>
        ) : null}
        {talk}
        {isSelected ? actions(r) : null}
      </Box>
    )
  }

  const card = (title: RenderChildren, lines: RenderChildren, here: Row[] | null) => (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={u.compact ? 0 : 1}>
      {title}
      {lines}
      {here === null ? null : (
        <Box flexDirection="column" marginTop={u.compact ? 0 : 1}>
          {here.length === 0 ? <Text dimColor>No agent here.</Text> : here.map(agentRow)}
        </Box>
      )}
    </Box>
  )

  const branchCard = (t: FleetWorktree, trees: FleetWorktree[], here: Row[], inRepo: Row[]) => {
    const fold = norm(t.path)
    const isFolded = u.collapsed.includes(fold)
    const toggle = () =>
      setUi(s => ({
        ...s,
        collapsed: isFolded ? s.collapsed.filter(p => p !== fold) : [...s.collapsed, fold],
      }))
    const vsBase =
      t.base && t.branch !== t.base
        ? t.ahead || t.behind
          ? `↑${t.ahead} ahead · ↓${t.behind} behind ${t.base}`
          : `even with ${t.base}`
        : ''
    const warnings = warningsFor(t, trees, inRepo)
    const working = here.filter(r => r.agent.status === 'working').length
    return card(
      <Box flexDirection="row" justifyContent="space-between">
        <Button key={`fold:${fold}`} plain onPress={toggle}>
          <Text color="claude" bold>
            {isFolded ? '▸' : '▾'} ⎇ {t.branch}
          </Text>
        </Button>
        {t.dirty > 0 ? (
          <Text color="warning"> {plural(t.dirty, 'unsaved change')}</Text>
        ) : (
          <Text color="success"> ✓ clean</Text>
        )}
      </Box>,
      <Box flexDirection="column">
        {!u.compact ? (
          <Text dimColor wrap="truncate-start">
            {tail(t.path, 2)}
            {t.lastCommit ? ` · last commit: ${t.lastCommit}` : ''}
          </Text>
        ) : null}
        {vsBase ? (
          <Text dimColor={t.behind < 10} color={t.behind >= 10 ? 'warning' : undefined}>
            {vsBase}
          </Text>
        ) : null}
        {warnings.map(w => (
          <Text color={w.startsWith('Will conflict') ? 'error' : 'warning'} wrap="truncate-end">
            ⚠ {w}
          </Text>
        ))}
        {isFolded ? (
          <Text dimColor>
            {plural(here.length, 'agent')}
            {working ? ` · ${working} working` : ''}
          </Text>
        ) : null}
      </Box>,
      isFolded ? null : here,
    )
  }

  // This repo shows every branch; the others only the branches with agents.
  const repoSection = (key: string) => {
    const isMine = key === norm(me.repoRoot)
    const inRepo = rows.filter(r => r.repo && norm(r.repo) === key)
    const trees = treesOf.get(key) ?? []
    const shown = isMine ? trees : trees.filter(t => inRepo.some(r => r.tree?.path === t.path))
    const unplaced = inRepo.filter(r => !r.tree)
    const hidden = trees.length - shown.length
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text bold>▌{tail(inRepo[0]?.repo ?? key, 1)}</Text>
          <Text dimColor>
            {isMine ? '  this repo' : ''} · {plural(trees.length, 'branch')} ·{' '}
            {plural(inRepo.length, 'agent')}
          </Text>
        </Text>
        {trees.length === 0 && <Text dimColor>Reading branches…</Text>}
        {shown.map(t => branchCard(t, trees, inRepo.filter(r => r.tree?.path === t.path), inRepo))}
        {unplaced.length > 0 && card(<Text bold>Somewhere in this repo</Text>, null, unplaced)}
        {hidden > 0 && (
          <Text dimColor>
            {'  '}+ {plural(hidden, 'more branch')} with no agent
          </Text>
        )}
      </Box>
    )
  }

  const loose = rows.filter(r => !r.repo)

  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color="claude" bold>
            ✻ Agent fleet
          </Text>
          <Text dimColor>
            {'  '}
            {plural(repos.length, 'repo')} · {plural(rows.length, 'agent')}
          </Text>
        </Text>
        <Button key="compact" hotkey="c" dimColor onPress={() => setUi(s => ({ ...s, compact: !s.compact }))}>
          {u.compact ? 'Detailed (c)' : 'Compact (c)'}
        </Button>
      </Box>
      <Box flexDirection="row" flexWrap="wrap">
        {(['working', 'waiting', 'idle', 'done', 'offline'] as const).map(st => (
          <Box marginRight={2}>
            <Text color={STATUS[st].color} dimColor={count(st) === 0}>
              ✻ {count(st)} {STATUS[st].label}
            </Text>
          </Box>
        ))}
      </Box>
      {recap.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color="claude" bold>
              ✻ While you were away
            </Text>
            <Button key="recap:ok" hotkey="g" dimColor onPress={() => setUi(s => ({ ...s, dismissedAt: now }))}>
              Got it (g)
            </Button>
          </Box>
          {recap.map(({ x, n }) => (
            <Box flexDirection="row" justifyContent="space-between">
              <Text wrap="truncate-end">
                <Text color={KIND_COLOR[x.kind]}>• </Text>
                {n > 1 ? <Text bold>{n}× </Text> : null}
                {x.text}
              </Text>
              <Text dimColor> {ago(now - x.at)}</Text>
            </Box>
          ))}
        </Box>
      )}
      {needsYou.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} marginTop={1}>
          <Text color="warning" bold>
            ✻ Needs you ({needsYou.length})
          </Text>
          {needsYou.map(r => (
            <Box flexDirection="column" marginTop={u.compact ? 0 : 1}>
              <Box flexDirection="row">
                {nameButton(r, 'need:')}
                <Text dimColor wrap="truncate-end"> · {where(r)}</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text wrap="truncate-end">{said(r, now)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
      {repos.map(repoSection)}
      {loose.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>▌Outside any repo</Text>
          {card(<Text dimColor>Agents working in a folder that is not a git repo</Text>, null, loose)}
        </Box>
      )}
      {e.surface === 'terminal' ? (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            Talk to an agent: type @its-name and a message in any prompt. Click a name for
            buttons, ▾ to fold a branch.
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
