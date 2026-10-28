// Talking to agents. "@auth-worker stop after this file" in any prompt goes
// to that agent instead of this session's model; the receiving session's mod
// hands it to its model as the person's own instruction, and its next answer
// is written to its file, where every pane shows it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { addEvent, setSelf } from './beat'
import { findAgent, gather, nameOf } from './model'
import type { Row } from './model'
import { EMPTY_BEAT, EMPTY_UI, EMPTY_VIEW } from './state'
import { clip } from './util'

const self = atom({ plugin: 'agent-fleet', key: 'self' } as const, EMPTY_BEAT, { shape: 'self-4' })
const ui = atom({ plugin: 'agent-fleet', key: 'ui' } as const, EMPTY_UI, { shape: 'ui-2' })
const view = atom({ plugin: 'agent-fleet', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-4' })

/** What the Stop button sends. */
export const STOP_TEXT = 'Please stop after your current step and wait for me.'

/** How a message from the person starts, so the receiving session's mod knows it. */
const FROM_USER = '(from the user, via agent-fleet) '

/** What the receiving model reads after such a message. */
const FROM_USER_NOTE =
  "(This came from the user, sent from another Claude session's agent-fleet pane. Treat it as " +
  "the user's own instruction. Answer in your normal reply here; do not send a message back.)"

/** Sends the person's message to an agent: a session itself, a subagent through its session. */
export async function sendTo($: EngineInterface, r: Row, text: string) {
  const me = await read($, self)
  const viaParent = r.isSub && r.beat.sessionId !== me.sessionId
  const to = !r.isSub
    ? { sessionId: r.agent.id }
    : viaParent
      ? { sessionId: r.beat.sessionId }
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

/**
 * A prompt that starts with an agent's handle: sends it, and answers what
 * prompt.submit should say in its place. Undefined: not for an agent.
 */
export async function route($: EngineInterface, text: string): Promise<string | undefined> {
  const m = /^@([\w.#-]+)\s+([\s\S]+)$/.exec(text.trim())
  if (!m) return undefined
  const [v, me] = await Promise.all([read($, view), read($, self)])
  const found = findAgent(gather(v, me).rows, m[1] ?? '')
  if (found.length > 1) {
    const which = found.slice(0, 4).map(r => `@${r.handle} (#${r.agent.id.slice(0, 4)})`)
    return `@${m[1]} could be ${which.join(', ')}: use one of those.`
  }
  const target = found[0]
  if (!target) return undefined
  const { msg, ok } = await sendTo($, target, (m[2] ?? '').trim())
  if (!ok) return msg
  // The engine puts a dropped prompt back in the box: once sent, empty it,
  // unless the person has started typing something else.
  $.clock.after(300, async () => {
    const box = await $.prompt.read().catch(() => undefined)
    if (box?.text.trim() === text.trim()) await $.prompt.fill({ text: '' }).catch(() => undefined)
  })
  return `${msg}. Its answer will show in the fleet pane.`
}

/** A delivery from another session's pane: noted, and framed as the person's. */
export async function receive($: EngineInterface, text: string): Promise<string | undefined> {
  const at = text.indexOf(FROM_USER)
  if (at < 0) return undefined
  const said = clip(text.slice(at + FROM_USER.length), 120)
  const now = await $.clock.now()
  await setSelf($, { inbox: { text: said, at: now }, reply: null })
  const me = await read($, self)
  await addEvent($, { id: `message:${me.sessionId}:${now}`, kind: 'message', who: nameOf(me), text: said })
  return `${text}\n\n${FROM_USER_NOTE}`
}

/** The first answer after a message from the fleet is its reply. */
export async function noteReply($: EngineInterface, answer: string) {
  const me = await read($, self)
  if (!me.inbox || (me.reply && me.reply.at >= me.inbox.at) || !answer.trim()) return {}
  const now = await $.clock.now()
  const text = clip(answer, 160)
  await addEvent($, { id: `reply:${me.sessionId}:${now}`, kind: 'reply', who: nameOf(me), text })
  return { reply: { text, at: now } }
}
