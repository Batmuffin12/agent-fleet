// Every session's file turned into one picture of the fleet: repos, their
// branches with health warnings, the agents on each, what needs the person,
// the feed, and each agent's activity bar. Pure: no engine calls, no drawing.
import type { AgentStatusWord, FleetAgent, FleetBeat, FleetEvent, FleetView, FleetWorktree, Sample } from '../types'
import { DONE_SHOWN_MS, EVENTS_KEEP_MS, STUCK_AFTER_MS, TRAIL_MS } from './limits'
import { norm, slug, tail } from './util'
import { SAMPLE_COLOR } from './words'

/** What other panes call a session: its /fleet name, else what it was started for. */
export const nameOf = (b: FleetBeat) => b.name || b.title || `Claude #${b.sessionId.slice(0, 4)}`

/** Every session's events, each once, oldest first. */
export function allEvents(beats: FleetBeat[]): FleetEvent[] {
  const byId = new Map<string, FleetEvent>()
  for (const b of beats) for (const x of b.events ?? []) byId.set(x.id, x)
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

export type Row = {
  /** The session id, or `<session>/<subagent>`: what selection remembers. */
  key: string
  /** What the person types after @ to message it. */
  handle: string
  agent: FleetAgent
  repo: string
  isSub: boolean
  isMe: boolean
  task: string
  /** A session's own file; a subagent's parent's. */
  beat: FleetBeat
  tree?: FleetWorktree
}

export type Warning = { kind: 'conflict' | 'shared' | 'both'; text: string }

export type Branch = { tree: FleetWorktree; agents: Row[]; warnings: Warning[] }

export type Repo = {
  key: string
  name: string
  isMine: boolean
  /** The branches shown: all of this session's repo, else those with agents or warnings. */
  branches: Branch[]
  hidden: number
  /** Agents in the repo but in none of its known worktrees. */
  unplaced: Row[]
}

/** A feed line: one event, or the same news again, counted. */
export type FeedItem = FleetEvent & { n: number }

export type Fleet = {
  now: number
  rows: Row[]
  repos: Repo[]
  /** Agents outside any repo. */
  loose: Row[]
  count: (s: AgentStatusWord) => number
  conflicts: number
  needsYou: Row[]
  feed: FeedItem[]
}

export function gather(v: FleetView, me: FleetBeat): Fleet {
  const now = v.checkedAt || me.aliveAt
  const beats = [...v.beats.filter(b => b.sessionId !== me.sessionId), me]

  const rows: Row[] = beats.flatMap(b => {
    const isMe = b.sessionId === me.sessionId
    const session: Row = {
      key: b.sessionId,
      handle: slug(nameOf(b)),
      agent: {
        id: b.sessionId,
        name: isMe ? 'you' : nameOf(b),
        status: b.status,
        activity: b.activity,
        path: b.cwd,
        updatedAt: b.updatedAt,
        trail: b.trail ?? [],
      },
      repo: b.repoRoot,
      isSub: false,
      isMe,
      task: b.prompt,
      beat: b,
    }
    const subs = b.subagents
      .filter(s => s.status !== 'done' || now - s.updatedAt < DONE_SHOWN_MS)
      .map(s => ({
        key: `${b.sessionId}/${s.id}`,
        handle: slug(s.name),
        agent: { ...s, trail: s.trail ?? [] },
        repo: b.repoRoot,
        isSub: true,
        isMe: false,
        task: '',
        beat: b,
      }))
    return [session, ...subs]
  })

  // Each repo's worktrees: this session's own, else the freshest a session shared.
  const treesOf = new Map<string, FleetWorktree[]>()
  for (const b of [...beats].sort((x, y) => x.worktreesAt - y.worktreesAt)) {
    if (b.repoRoot && b.worktrees.length) treesOf.set(norm(b.repoRoot), b.worktrees)
  }
  if (me.repoRoot && me.worktrees.length) treesOf.set(norm(me.repoRoot), me.worktrees)

  // An agent goes to the deepest worktree its path lies in, else its repo's main one.
  for (const r of rows) {
    if (!r.repo) continue
    const trees = [...(treesOf.get(norm(r.repo)) ?? [])].sort((a, b) => b.path.length - a.path.length)
    const p = norm(r.agent.path)
    r.tree =
      trees.find(t => p === norm(t.path) || p.startsWith(norm(t.path) + '/')) ??
      trees.find(t => norm(t.path) === norm(r.repo))
  }

  const mine = norm(me.repoRoot)
  const repoKeys = [...new Set(rows.map(r => r.repo).filter(Boolean).map(norm))].sort((a, b) =>
    a === mine ? -1 : b === mine ? 1 : a.localeCompare(b),
  )
  const repos = repoKeys.map(key => {
    const inRepo = rows.filter(r => r.repo && norm(r.repo) === key)
    const trees = treesOf.get(key) ?? []
    const all = trees.map(tree => {
      const agents = inRepo.filter(r => r.tree?.path === tree.path)
      return { tree, agents, warnings: warningsFor(tree, trees, inRepo) }
    })
    const isMine = key === mine
    const branches = isMine ? all : all.filter(b => b.agents.length || b.warnings.length)
    return {
      key,
      name: tail(inRepo[0]?.repo ?? key, 1),
      isMine,
      branches,
      hidden: all.length - branches.length,
      unplaced: inRepo.filter(r => !r.tree),
    }
  })

  const pairs = new Set<string>()
  for (const t of treesOf.values()) {
    for (const tree of t) for (const c of tree.conflicts) pairs.add([tree.branch, c.branch].sort().join('|'))
  }

  // The same news again (a subagent that keeps asking) is one line with a count.
  const repeats = new Map<string, FeedItem>()
  for (const x of allEvents(beats)) {
    if (now - x.at > EVENTS_KEEP_MS) continue
    const k = `${x.kind}|${x.who}|${x.text}`
    repeats.set(k, { ...x, n: (repeats.get(k)?.n ?? 0) + 1 })
  }

  return {
    now,
    rows,
    repos,
    loose: rows.filter(r => !r.repo),
    count: s => rows.filter(r => r.agent.status === s).length,
    conflicts: pairs.size,
    needsYou: rows.filter(r => r.agent.status === 'waiting'),
    feed: [...repeats.values()].sort((a, b) => b.at - a.at),
  }
}

/** A worktree's warnings: clashes with other branches, and files changed in two places. */
export function warningsFor(t: FleetWorktree, trees: FleetWorktree[], rows: Row[]): Warning[] {
  const out: Warning[] = t.conflicts.map(c => ({
    kind: 'conflict',
    text: `will conflict with ${c.branch} in ${c.files.slice(0, 3).join(', ')}${c.files.length > 3 ? '…' : ''}`,
  }))
  for (const o of trees) {
    if (o.path === t.path) continue
    const shared = t.dirtyFiles.filter(f => o.dirtyFiles.includes(f))
    if (shared.length) out.push({ kind: 'shared', text: `${o.branch} also changed ${shared.slice(0, 3).join(', ')}` })
  }
  // Agents editing the same file of the repo, each in its own worktree or not.
  const fileOf = (r: Row) => {
    const p = norm(r.agent.path)
    const root = r.tree ? norm(r.tree.path) : ''
    return root && p.startsWith(root + '/') && /\.[a-z0-9]+$/.test(p) ? p.slice(root.length + 1) : ''
  }
  const seen = new Set<string>()
  for (const r of rows.filter(r => r.tree?.path === t.path && fileOf(r))) {
    const others = rows.filter(o => o !== r && fileOf(o) === fileOf(r))
    if (!others.length || seen.has(fileOf(r))) continue
    seen.add(fileOf(r))
    const names = [r, ...others].map(o => o.agent.name)
    out.push({ kind: 'both', text: `${names.join(' and ')} are both editing ${fileOf(r)}` })
  }
  return out
}

/**
 * The agents an @handle names: an exact handle, a session's id start
 * (`#72ba`) or its branch (`feat-auth`); else the handles it starts.
 */
export function findAgent(rows: Row[], token: string): Row[] {
  const t = token.toLowerCase().replace(/^[@#]/, '')
  const others = rows.filter(r => !r.isMe)
  const exact = others.filter(
    r =>
      r.handle === t ||
      r.agent.id.toLowerCase().slice(0, 4) === t ||
      (!r.isSub && !!r.tree && slug(r.tree.branch) === slug(t)),
  )
  if (exact.length || t.length < 2) return exact
  return others.filter(r => r.handle.startsWith(t))
}

export type BarCell = { ch: string; color: string }

const HEIGHTS = ['▁', '▃', '▄', '▅', '▅', '▆', '▆', '▆', '▇']

/**
 * An agent's activity bar: `cells` blocks over the last TRAIL_MS, oldest
 * first. Height is how much happened; color what kind (editing, running,
 * waiting on the person). A working agent silent past STUCK_AFTER_MS turns
 * the blocks since its last activity into a flat red line.
 */
export function bar(agent: FleetAgent, now: number, cells = 7): BarCell[] {
  const span = TRAIL_MS / cells
  const start = now - TRAIL_MS
  const last = agent.trail.reduce((m, s) => Math.max(m, s.at), 0)
  const isStuck = agent.status === 'working' && now - Math.max(last, agent.updatedAt) > STUCK_AFTER_MS
  return Array.from({ length: cells }, (_, i) => {
    const from = start + i * span
    const here = agent.trail.filter(s => s.at >= from && s.at < from + span)
    const isNow = i === cells - 1
    if (isNow && agent.status === 'waiting') return { ch: '▇', color: SAMPLE_COLOR.wait }
    if (!here.length) {
      return { ch: '▁', color: isStuck && from >= last ? SAMPLE_COLOR.stuck : SAMPLE_COLOR.idle }
    }
    const kind: Sample['kind'] = here.some(s => s.kind === 'wait')
      ? 'wait'
      : here.filter(s => s.kind === 'edit').length * 2 >= here.length
        ? 'edit'
        : 'run'
    return { ch: HEIGHTS[Math.min(here.length, HEIGHTS.length - 1)] ?? '▇', color: SAMPLE_COLOR[kind] }
  })
}
