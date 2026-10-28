// This session's file, ~/.claude/agent-fleet/v4/<session>.json, and reading
// every session's. Each session owns its file, so writers never collide; every
// session reads them all. A session that stops writing shows as offline after
// 30s and disappears after 10m; files untouched for a day are deleted.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AgentStatusWord, FleetAgent, FleetBeat, FleetEvent, Sample } from '../types'
import {
  EVENTS_KEEP_MS,
  FORGET_AFTER_MS,
  HIDE_ENDED_AFTER_MS,
  MIN_WRITE_MS,
  NOTIFY_EVERY_MS,
  OFFLINE_AFTER_MS,
  PRUNE_AFTER_MS,
  STUCK_AFTER_MS,
  TRAIL_MS,
} from './limits'
import { allEvents, nameOf } from './model'
import { EMPTY_BEAT, EMPTY_UI } from './state'
import { ago, clip } from './util'
import { agentStatus, sentence } from './words'

const self = atom({ plugin: 'agent-fleet', key: 'self' } as const, EMPTY_BEAT, { shape: 'self-4' })
const ui = atom({ plugin: 'agent-fleet', key: 'ui' } as const, EMPTY_UI, { shape: 'ui-2' })

// Set again by every session.start, which a reload re-runs.
let beatDir = ''
let beatFile = ''
let isWindows = false
let lastWriteAt = 0
let startedAt = 0

export function setPaths(home: string, sessionId: string, windows: boolean, now: number) {
  beatDir = `${home.replace(/\\/g, '/')}/.claude/agent-fleet/v4`
  beatFile = `${beatDir}/${sessionId}.json`
  isWindows = windows
  startedAt = now
}

// ── Writing ──────────────────────────────────────────────────────────────

export async function write($: EngineInterface) {
  if (!beatFile) return
  const beat = await read($, self)
  lastWriteAt = await $.clock.now()
  await $.fs.write(beatFile, JSON.stringify(beat)).catch(() => {})
}

/** Writes now, or leaves it to the next heartbeat when the last write was recent. */
async function flush($: EngineInterface) {
  if ((await $.clock.now()) - lastWriteAt >= MIN_WRITE_MS) await write($)
}

export async function addEvent($: EngineInterface, event: Omit<FleetEvent, 'at'>) {
  const now = await $.clock.now()
  await update($, self, b =>
    b.events.some(x => x.id === event.id)
      ? b
      : {
          ...b,
          events: [...b.events.filter(x => now - x.at < EVENTS_KEEP_MS).slice(-39), { ...event, at: now }],
        },
  )
}

const keepTrail = (trail: Sample[], now: number, kind?: Sample['kind']) => [
  ...trail.filter(s => now - s.at < TRAIL_MS).slice(-119),
  ...(kind ? [{ at: now, kind }] : []),
]

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
    const text = sentence(agent.activity, to)
    await addEvent($, { id: `needs:${agent.id}:${now}`, kind: 'needs', who: agent.name, text })
  } else if (from === 'working' && (to === 'done' || (isSession && to === 'idle'))) {
    const text = isSession ? 'finished and is waiting for you' : 'finished'
    await addEvent($, { id: `done:${agent.id}:${now}`, kind: 'done', who: agent.name, text })
  }
}

/** Changes this session's file; a sample kind adds a moment to its activity bar. */
export async function setSelf($: EngineInterface, patch: Partial<FleetBeat>, kind?: Sample['kind']) {
  const now = await $.clock.now()
  const before = await read($, self)
  await update($, self, b => ({
    ...b,
    ...patch,
    trail: keepTrail(b.trail, now, kind),
    updatedAt: now,
    aliveAt: now,
  }))
  const after = await read($, self)
  if (after.status !== before.status) {
    const agent = { id: after.sessionId, name: nameOf(after), activity: after.activity }
    await noteChange($, agent, before.status, after.status, true)
  }
  void flush($)
}

async function setSub($: EngineInterface, id: string, patch: Partial<FleetAgent>, kind?: Sample['kind']) {
  const now = await $.clock.now()
  const old = (await read($, self)).subagents.find(a => a.id === id)
  const next: FleetAgent = {
    id,
    name: old?.name ?? id.slice(0, 8),
    status: 'working',
    activity: '',
    path: old?.path ?? '',
    trail: [],
    ...old,
    ...patch,
    updatedAt: now,
  }
  await update($, self, b => ({
    ...b,
    subagents: [
      ...b.subagents.filter(a => a.id !== id),
      { ...next, path: next.path || b.cwd, trail: keepTrail(next.trail, now, kind) },
    ],
  }))
  if (old && old.status !== next.status) await noteChange($, next, old.status, next.status, false)
  void flush($)
}

/** Sets the session's or a subagent's status, whichever `agentId` names. */
export function setAgent(
  $: EngineInterface,
  agentId: string | undefined,
  patch: Partial<FleetAgent>,
  kind?: Sample['kind'],
) {
  return agentId ? setSub($, agentId, patch, kind) : setSelf($, patch, kind)
}

export async function statusOf($: EngineInterface, agentId?: string) {
  const b = await read($, self)
  return agentId ? b.subagents.find(a => a.id === agentId)?.status : b.status
}

/** This session's subagents, from the engine's own list. */
export async function refreshAgents($: EngineInterface) {
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
        trail: keepTrail(old?.trail ?? [], now),
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
export async function noteStuck($: EngineInterface, now: number) {
  const me = await read($, self)
  const agents = [{ id: me.sessionId, name: nameOf(me), status: me.status, updatedAt: me.updatedAt }, ...me.subagents]
  for (const a of agents) {
    if (a.status !== 'working' || now - a.updatedAt < STUCK_AFTER_MS) continue
    const id = `stuck:${a.id}:${a.updatedAt}`
    await addEvent($, { id, kind: 'stuck', who: a.name, text: `no progress for ${ago(now - a.updatedAt)}` })
  }
}

// ── Reading every session's file ─────────────────────────────────────────

async function readAll($: EngineInterface): Promise<{ name: string; beat?: FleetBeat }[]> {
  const entries = await $.fs.list(beatDir).catch(() => [])
  return Promise.all(
    entries
      .filter(f => f.kind === 'file' && f.name.endsWith('.json'))
      .map(async f => {
        try {
          const beat = JSON.parse(await $.fs.read(`${beatDir}/${f.name}`)) as FleetBeat
          return { name: f.name, beat: beat?.v === 4 ? beat : undefined }
        } catch {
          return { name: f.name }
        }
      }),
  )
}

/** Every live session's file; one that stopped writing is marked offline. */
export async function readBeats($: EngineInterface, now: number): Promise<FleetBeat[]> {
  return (await readAll($))
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
export async function prune($: EngineInterface, now: number) {
  for (const f of await readAll($)) {
    if (f.beat && now - f.beat.aliveAt < PRUNE_AFTER_MS) continue
    const path = `${beatDir}/${f.name}`
    const argv = isWindows ? ['cmd', '/c', 'del', '/f', '/q', path.replace(/\//g, '\\')] : ['rm', '-f', path]
    await $.process.run(argv, { timeoutMs: 5_000 }).catch(() => undefined)
  }
}

/**
 * One session sends the machine's notifications, so five sessions do not
 * ping five times: the live real session with the lowest id. At most one
 * notification per NOTIFY_EVERY_MS, gathering what came in meanwhile.
 */
export async function notifyNews($: EngineInterface, beats: FleetBeat[], me: FleetBeat, now: number) {
  const leader = beats
    .filter(b => b.notifier && !b.ended && b.status !== 'offline')
    .map(b => b.sessionId)
    .sort()[0]
  if (leader !== me.sessionId) return
  const u = await read($, ui)
  if (now - u.notifiedAt < NOTIFY_EVERY_MS) return
  const news = allEvents(beats).filter(
    x => (x.kind === 'needs' || x.kind === 'done' || x.kind === 'stuck') && x.at > startedAt && !u.notified.includes(x.id),
  )
  if (!news.length) return
  await update($, ui, s => ({
    ...s,
    notifiedAt: now,
    notified: [...s.notified, ...news.map(x => x.id)].slice(-200),
  }))
  const line = (x: FleetEvent) => `${x.who} ${x.text}`
  const text = news.length === 1 ? line(news[0]!) : `${news.length} updates: ${news.slice(-3).map(line).join(' · ')}`
  await $.ui.notify(clip(text, 190), { title: 'Agent fleet' }).catch(() => undefined)
}
