// The fleet as plain text: the status line, /fleet's answer (what the phone
// shows), and /fleet timeline. Shares its pieces with the pane.
import type { FleetWorktree } from '../../types'
import { bar } from '../model'
import type { Fleet, Row } from '../model'
import { ago, clip, clock, pad, plural } from '../util'
import { EVENT, STATUS, phrase } from '../words'

/** "●━●" for commits ahead of the base branch, at most three dots. */
export const commits = (t: FleetWorktree) =>
  t.branch === t.base ? '' : Array.from({ length: Math.min(Math.max(t.ahead, 1), 3) }, () => '●').join('━')

/** "↑2 ↓1", or "" when even with the base branch. */
export const aheadBehind = (t: FleetWorktree) =>
  t.branch === t.base ? '' : [t.ahead ? `↑${t.ahead}` : '', t.behind ? `↓${t.behind}` : ''].filter(Boolean).join(' ')

/** "±2" unsaved files, or "". */
export const unsaved = (t: FleetWorktree) => (t.dirty ? `±${t.dirty}` : '')

/** The words beside an agent on the map: "editing config.ts", "idle 4m". */
export const doing = (r: Row, now: number) => phrase(r.agent.activity, r.agent.status, ago(now - r.agent.updatedAt))

/** The one line that sums the fleet up. */
export function totals(f: Fleet): string[] {
  return [
    f.count('working') ? `✶ ${f.count('working')} working` : '',
    f.needsYou.length ? `! ${f.needsYou.length} needs you` : '',
    f.conflicts ? `⚠ ${plural(f.conflicts, 'conflict')}` : '',
    f.count('done') ? `✓ ${f.count('done')} done` : '',
    f.count('offline') ? `${f.count('offline')} offline` : '',
  ].filter(Boolean)
}

/** The status line entry: "✻ fleet ✶5 !1 ⚠1". */
export function statusLine(f: Fleet): string {
  const parts = [
    `✶${f.count('working')}`,
    f.needsYou.length ? `!${f.needsYou.length}` : '',
    f.conflicts ? `⚠${f.conflicts}` : '',
  ].filter(Boolean)
  return `✻ fleet ${parts.join(' ')}`
}

const agentLine = (f: Fleet, r: Row, lead: string) =>
  `${lead}${STATUS[r.agent.status].icon} ${pad(r.agent.name, 16)} ` +
  `${bar(r.agent, f.now).map(c => c.ch).join('')}  ${doing(r, f.now)}`

/** /fleet's answer: the summary, the map and the latest of the feed. */
export function summary(f: Fleet): string {
  const out = [`✻ Agent fleet — ${totals(f).join(' · ') || 'nothing running'}`]
  for (const repo of f.repos) {
    out.push('', repo.name + (repo.isMine ? ' (this repo)' : ''))
    repo.branches.forEach((b, i) => {
      const last = i === repo.branches.length - 1
      const t = b.tree
      const isBase = t.branch === t.base
      out.push(
        `${isBase ? '' : last ? '└─ ' : '├─ '}${t.branch} ${commits(t)}  ${aheadBehind(t)} ${unsaved(t)}`.trimEnd(),
      )
      const lead = isBase ? '│  ' : last ? '   ' : '│  '
      for (const w of b.warnings) out.push(`${lead}⚠ ${w.text}`)
      for (const r of b.agents) out.push(agentLine(f, r, lead))
    })
    for (const r of repo.unplaced) out.push(agentLine(f, r, '   '))
    if (repo.hidden) out.push(`   + ${plural(repo.hidden, 'more branch')} with no agent`)
  }
  if (f.loose.length) out.push('', 'outside any repo', ...f.loose.map(r => agentLine(f, r, '   ')))

  const feed = f.feed.slice(0, 6)
  if (feed.length || f.needsYou.length) out.push('', '── feed ──')
  for (const r of f.needsYou) out.push(`now    ! ${r.agent.name} @${r.handle}: ${clip(doing(r, f.now), 60)}`)
  for (const x of feed) {
    out.push(`${clock(x.at)}  ${EVENT[x.kind].icon} ${x.n > 1 ? `${x.n}× ` : ''}${x.who} ${clip(x.text, 70)}`)
  }
  out.push('', 'Talk to an agent: @its-name your message')
  return out.join('\n')
}

/** /fleet timeline: one lane per agent over the last half hour, a block a minute. */
export function timeline(f: Fleet): string {
  const kind: Record<string, string> = { claude: '█', suggestion: '▓', warning: '!', error: '_', inactive: '·' }
  const lanes = f.rows.map(r => `${pad(r.agent.name, 16)} ${bar(r.agent, f.now, 28).map(c => kind[c.color] ?? '·').join('')}`)
  return [
    `${pad('', 16)} −28m          −14m         now`,
    ...lanes,
    '',
    '█ editing   ▓ running or reading   ! waiting on you   _ stuck   · idle',
  ].join('\n')
}
