import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  noteStuck,
  notifyNews,
  prune,
  readBeats,
  refreshAgents,
  setAgent,
  setPaths,
  setSelf,
  statusOf,
  write,
} from '../src/beat'
import { noteCommits, readWorktrees } from '../src/git'
import { BEAT_MS, GIT_MS } from '../src/limits'
import { findAgent, gather } from '../src/model'
import { EMPTY_BEAT, EMPTY_UI, EMPTY_VIEW } from '../src/state'
import { noteReply, receive, route } from '../src/talk'
import { drawBand } from '../src/ui/band'
import { PANE, drawFleet } from '../src/ui/pane'
import { statusLine, summary, timeline } from '../src/ui/text'
import { clip } from '../src/util'
import { ASKS, describe, sampleKind } from '../src/words'

const self = atom({ plugin: 'agent-fleet', key: 'self' } as const, EMPTY_BEAT, { shape: 'self-4' })
const ui = atom({ plugin: 'agent-fleet', key: 'ui' } as const, EMPTY_UI, { shape: 'ui-2' })
const view = atom({ plugin: 'agent-fleet', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-4' })

// agent-fleet: every Claude session on this machine, by repo and branch, in
// one pane. This file only wires the engine's events to the parts in src/:
// beat (each session's file), git (worktrees and their health), model (the
// fleet as one picture), talk (@name messages) and ui (pane, band, text).

/** The short title a session gets from its first prompt. */
const titleFrom = (text: string) => clip(text.split(/\r?\n/)[0] ?? '', 28)

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
    setPaths(home ?? '.', sessionId, os === 'Windows_NT', now)
    const repoRoot = repo?.root ?? ''

    await update($, self, b => ({ ...b, v: 4 as const, notifier: true, sessionId, cwd, repoRoot }))
    await setSelf($, {})

    const pollBeats = async () => {
      await refreshAgents($)
      const now = await $.clock.now()
      await noteStuck($, now)
      await write($)
      const beats = await readBeats($, now)
      await update($, view, () => ({ beats, checkedAt: now }))
      const me = await read($, self)
      $.ui.status(statusLine(gather({ beats, checkedAt: now }, me)))
      await notifyNews($, beats, me, now)
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
      description: 'Every Claude agent on this machine (fleet name|compact|select|timeline …)',
    })
    void $.ui.open({ id: PANE, title: 'Agent fleet' })

    return next(e)
  })

  // `/fleet` opens the pane and answers with the fleet as text, which is what
  // a surface with no pane (the phone) shows. `/fleet name <name>`,
  // `/fleet compact`, `/fleet select <agent or branch>`, `/fleet timeline`.
  on('command.run', { command: 'fleet' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()
    const fleet = async () => gather(await read($, view), await read($, self))

    if (verb === 'name') {
      await setSelf($, { name: clip(arg, 30) })
      return { text: arg ? `Other panes now call this session "${clip(arg, 30)}".` : 'Name cleared.' }
    }
    if (verb === 'compact') {
      const { compact } = await update($, ui, u => ({ ...u, compact: !u.compact }))
      return { text: compact ? 'Map only.' : 'Map and feed.' }
    }
    if (verb === 'timeline') return { text: timeline(await fleet()) }
    if (verb === 'select') {
      const f = await fleet()
      const row = findAgent(f.rows, arg)[0]
      if (!row) return { text: `No agent matches "${arg}".` }
      await update($, ui, u => ({ ...u, selected: row.key }))
      await $.ui.open({ id: PANE, title: 'Agent fleet' })
      return { text: `Selected ${row.agent.name}: its details and buttons are open in the pane.` }
    }

    await $.ui.open({ id: PANE, title: 'Agent fleet' })
    return { text: summary(await fleet()) }
  })

  // "@auth-worker stop after this file" is a message for that agent, not for
  // this session's model. Anything else, an @file mention included, goes on.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.command) return next(e)
    const routed = await route($, e.text)
    if (routed) return { drop: routed }
    const me = await read($, self)
    await setSelf($, { prompt: clip(e.text, 120), title: me.title || titleFrom(e.text) })
    return next(e)
  })

  // A message the person sent from another session's pane: their instruction.
  on('session.receive', async ($, e, next) => {
    const framed = await receive($, e.text)
    return next(framed ? { ...e, text: framed } : e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await setSelf($, { status: 'working', activity: 'thinking…' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { activity, path } = describe(e.tool, e)
    const asks = ASKS[e.tool]
    await setAgent(
      $,
      e.agentId,
      { status: asks ? 'waiting' : 'working', activity: asks ? `asks: ${asks}` : activity, ...(path ? { path } : {}) },
      asks ? 'wait' : sampleKind(e.tool),
    )
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
      await setAgent($, e.agentId, { status: 'waiting', activity: `ask: ${activity}` }, 'wait')
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) {
      await setAgent($, e.agentId, { status: 'idle', activity: 'turn finished' })
      return result
    }
    const reply = await noteReply($, result.text)
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

  // The phone places no pane: there /fleet's reply in the chat is the fleet
  // itself, live, redrawn as the sessions' files change.
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) =>
    e.props.command === 'fleet' && !e.props.args.trim() && e.surface === 'mobile' && !e.props.isErrored
      ? drawFleet($, e)
      : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => (await drawBand($, e)) ?? next(e))
}
