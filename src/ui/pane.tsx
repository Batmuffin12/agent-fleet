// The pane: one line summing the fleet up, the git map (each repo's branches
// with their health, each branch's agents with an activity bar), the details
// of whatever is selected, and the feed. Also what /fleet draws on the phone.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import type { FleetUi } from '../../types'
import { BEAT_MS } from '../limits'
import { bar, gather } from '../model'
import type { Branch, Row } from '../model'
import { EMPTY_BEAT, EMPTY_UI, EMPTY_VIEW } from '../state'
import { STOP_TEXT, sendTo } from '../talk'
import { ago, clip, clock, norm, pad, tail } from '../util'
import { EVENT, SPARK, STATUS, sentence } from '../words'
import { aheadBehind, commits, doing, totals, unsaved } from './text'

const self = atom({ plugin: 'agent-fleet', key: 'self' } as const, EMPTY_BEAT, { shape: 'self-4' })
const ui = atom({ plugin: 'agent-fleet', key: 'ui' } as const, EMPTY_UI, { shape: 'ui-2' })
const view = atom({ plugin: 'agent-fleet', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-4' })

export const PANE = 'agent-fleet'

export async function drawFleet($: EngineInterface, e: RenderInput<'Pane' | 'CommandOutput'>, width?: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const [v, me, u] = await Promise.all([read($, view), read($, self), read($, ui)])
  const f = gather(v, me)
  const { now } = f
  const tick = Math.floor(now / BEAT_MS)

  const setUi = (fn: (s: FleetUi) => FleetUi) => void update($, ui, fn)
  const select = (key: string) => setUi(s => ({ ...s, selected: s.selected === key ? '' : key }))
  const message = async (r: Row) => {
    const filled = await $.prompt.fill({ text: `@${r.handle} ` }).catch(() => undefined)
    $.ui.toast(filled?.isFilled ? `Type your message to ${r.agent.name}, then Enter` : `Type @${r.handle} and your message`)
  }
  const stop = (r: Row) => void sendTo($, r, STOP_TEXT).then(({ msg }) => $.ui.toast(msg))

  const button = (key: string, label: string, onPress: () => void, primary = false, hotkey?: string) => (
    <Box marginRight={1}>
      <Button key={key} hotkey={hotkey} variant={primary ? 'primary' : undefined} onPress={onPress}>
        {label}
      </Button>
    </Box>
  )

  // ── One agent on the map, and its details when selected ──
  const agentLine = (r: Row, lead: string, i: number) => {
    const s = STATUS[r.agent.status]
    const icon = r.agent.status === 'working' ? (SPARK[(tick + i * 3) % SPARK.length] ?? s.icon) : s.icon
    const isSelected = u.selected === r.key
    const cells = bar(r.agent, now)
    const isStuck = cells.some(c => c.color === 'error')
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>{lead}</Text>
          <Text color={isStuck ? 'error' : s.color} bold>
            {icon}{' '}
          </Text>
          <Button key={`sel:${r.key}`} plain onPress={() => select(r.key)}>
            <Text bold={isSelected || r.agent.status === 'waiting'}>{pad(r.agent.name, 15)}</Text>
          </Button>
          <Text> </Text>
          {cells.map(c => (
            <Text color={c.color}>{c.ch}</Text>
          ))}
          <Text
            wrap="truncate-end"
            color={r.agent.status === 'waiting' ? 'warning' : isStuck ? 'error' : undefined}
            dimColor={r.agent.status !== 'waiting' && !isStuck}
          >
            {'  '}
            {isStuck ? `no progress ${ago(now - r.agent.updatedAt)}` : doing(r, now)}
          </Text>
        </Box>
        {isSelected ? agentDetails(r, lead) : null}
      </Box>
    )
  }

  const agentDetails = (r: Row, lead: string) => {
    const last = u.lastAction && now - u.lastAction.at < 60_000 ? u.lastAction : null
    const talk = r.isSub ? null : r.beat.inbox && now - r.beat.inbox.at < 30 * 60_000 ? r.beat : null
    const answer = talk?.reply && talk.inbox && talk.reply.at >= talk.inbox.at ? talk.reply : null
    return (
      <Box flexDirection="row">
        <Text dimColor>{lead}</Text>
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexGrow={1}>
          <Text wrap="wrap">{sentence(r.agent.activity, r.agent.status)}</Text>
          {r.task ? (
            <Text dimColor wrap="truncate-end">
              Task: <Text italic>{r.task}</Text>
            </Text>
          ) : null}
          {talk?.inbox ? (
            <Text dimColor wrap="truncate-end">
              → you: {talk.inbox.text} · {ago(now - talk.inbox.at)}
            </Text>
          ) : null}
          {answer ? (
            <Text color="success" wrap="wrap">
              ↩ {answer.text}
            </Text>
          ) : talk ? (
            <Text dimColor italic>
              waiting for its answer…
            </Text>
          ) : null}
          {r.isMe ? (
            <Text dimColor>This is you.</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
              {button('act:msg', 'Message (m)', () => void message(r), true, 'm')}
              {button('act:stop', 'Stop (s)', () => stop(r), false, 's')}
              <Text dimColor> @{r.handle}</Text>
            </Box>
          )}
          {last ? (
            <Text color={last.ok ? 'success' : 'error'} wrap="truncate-end">
              {last.ok ? '✓ ' : '✗ '}
              {last.text}
            </Text>
          ) : null}
        </Box>
      </Box>
    )
  }

  // ── One branch: its line, its details when selected, its agents ──
  const branchBlock = (b: Branch, i: number, count: number, startAt: number) => {
    const t = b.tree
    const isBase = t.branch === t.base
    const isLast = i === count - 1
    const key = `branch:${norm(t.path)}`
    const isSelected = u.selected === key
    const hasConflict = b.warnings.some(w => w.kind === 'conflict')
    const lead = isBase || !isLast ? '│  ' : '   '
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>{isBase ? '' : isLast ? '└─ ' : '├─ '}</Text>
          <Button key={`br:${norm(t.path)}`} plain onPress={() => select(key)}>
            <Text color="claude" bold>
              {t.branch}
            </Text>
          </Button>
          <Text wrap="truncate-end">
            <Text color="claude"> {commits(t)}</Text>
            <Text dimColor> {aheadBehind(t)}</Text>
            <Text color="warning"> {unsaved(t)}</Text>
            {hasConflict ? <Text color="error"> ⚠</Text> : b.warnings.length ? <Text color="warning"> ⚠</Text> : null}
          </Text>
        </Box>
        {isSelected ? (
          <Box flexDirection="row">
            <Text dimColor>{lead}</Text>
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexGrow={1}>
              <Text dimColor wrap="truncate-start">
                {tail(t.path, 2)}
                {t.lastCommit ? ` · ${t.lastCommit}` : ''}
              </Text>
              {b.warnings.length === 0 ? <Text color="success">No conflicts with other branches.</Text> : null}
              {b.warnings.map(w => (
                <Text color={w.kind === 'conflict' ? 'error' : 'warning'} wrap="wrap">
                  ⚠ {w.text}
                </Text>
              ))}
              {t.dirtyFiles.length ? (
                <Text dimColor wrap="truncate-end">
                  Unsaved: {t.dirtyFiles.slice(0, 5).join(', ')}
                </Text>
              ) : null}
            </Box>
          </Box>
        ) : null}
        {b.agents.map((r, j) => agentLine(r, lead, startAt + j))}
      </Box>
    )
  }

  let agentIndex = 0
  const map = f.repos.map(repo => {
    const isFolded = u.folded.includes(repo.key)
    const fold = () =>
      setUi(s => ({
        ...s,
        folded: isFolded ? s.folded.filter(k => k !== repo.key) : [...s.folded, repo.key],
      }))
    const agents = repo.branches.reduce((n, b) => n + b.agents.length, 0) + repo.unplaced.length
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Button key={`fold:${repo.key}`} plain onPress={fold}>
            <Text bold>
              {isFolded ? '▸ ' : '▾ '}
              {repo.name}
            </Text>
          </Button>
          <Text dimColor>
            {repo.isMine ? '  this repo' : ''}
            {isFolded ? `  ${agents} agents` : ''}
          </Text>
        </Box>
        {isFolded
          ? null
          : repo.branches.map((b, i) => {
              const start = agentIndex
              agentIndex += b.agents.length
              return branchBlock(b, i, repo.branches.length, start)
            })}
        {isFolded ? null : repo.unplaced.map((r, j) => agentLine(r, '   ', agentIndex + j))}
        {!isFolded && repo.hidden ? (
          <Text dimColor>
            {'   '}+ {repo.hidden} more without agents
          </Text>
        ) : null}
      </Box>
    )
  })

  // ── The feed: what needs the person first, then the news, newest first ──
  const isNew = (at: number) => at > u.seenAt
  const fresh = f.feed.filter(x => isNew(x.at)).length
  const feed = (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>── feed {fresh ? `· ${fresh} new ` : ''}──</Text>
        {fresh ? (
          <Button key="seen" hotkey="g" dimColor onPress={() => setUi(s => ({ ...s, seenAt: now }))}>
            Seen (g)
          </Button>
        ) : null}
      </Box>
      {f.needsYou.map(r => (
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
          <Text wrap="wrap">
            <Text color="warning" bold>
              ! {r.agent.name}
            </Text>
            <Text dimColor> {r.tree?.branch ?? ''} </Text>
            {sentence(r.agent.activity, r.agent.status)}
          </Text>
          {r.isMe ? null : (
            <Box flexDirection="row">
              {button(`need:${r.key}:reply`, 'Reply', () => void message(r), true)}
              {button(`need:${r.key}:stop`, 'Stop', () => stop(r))}
            </Box>
          )}
        </Box>
      ))}
      {f.feed.slice(0, 8).map(x => (
        <Text wrap="truncate-end" dimColor={!isNew(x.at)}>
          <Text dimColor>{clock(x.at)} </Text>
          <Text color={EVENT[x.kind].color}>{EVENT[x.kind].icon} </Text>
          {x.n > 1 ? <Text bold>{x.n}× </Text> : null}
          <Text bold={isNew(x.at)}>{x.who}</Text> {clip(x.text, 80)}
        </Text>
      ))}
      {f.feed.length === 0 && f.needsYou.length === 0 ? <Text dimColor>Nothing new.</Text> : null}
    </Box>
  )

  const sum = totals(f)
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="claude" bold>
          ✻ Agent fleet
        </Text>
        <Button key="compact" hotkey="c" dimColor onPress={() => setUi(s => ({ ...s, compact: !s.compact }))}>
          {u.compact ? 'Feed (c)' : 'Map only (c)'}
        </Button>
      </Box>
      <Text wrap="truncate-end">
        {sum.length ? null : <Text dimColor>Nothing running.</Text>}
        {sum.map(part => (
          <Text
            color={
              part.startsWith('✶')
                ? 'claude'
                : part.startsWith('!')
                  ? 'warning'
                  : part.startsWith('⚠')
                    ? 'error'
                    : part.startsWith('✓')
                      ? 'success'
                      : 'inactive'
            }
            bold={part.startsWith('!')}
          >
            {part}
            {'   '}
          </Text>
        ))}
      </Text>
      {map}
      {f.loose.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>outside any repo</Text>
          {f.loose.map((r, j) => agentLine(r, '   ', agentIndex + j))}
        </Box>
      ) : null}
      {u.compact ? null : feed}
      {e.surface === 'terminal' ? (
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            @name message: talk to an agent · click a name or branch for details
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
