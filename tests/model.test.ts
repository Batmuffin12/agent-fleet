import { expect, test } from 'claude-code/testing'

import { bar, findAgent, gather } from '../src/model'
import { STUCK_AFTER_MS } from '../src/limits'
import { summary, timeline } from '../src/ui/text'
import { ME, NOW, VIEW } from './fixtures'

test('the fleet groups agents by repo and branch, this repo first', () => {
  const f = gather(VIEW, ME)
  expect(f.repos.map(r => r.name)).toEqual(['app', 'site'])
  const app = f.repos[0]!
  expect(app.branches.map(b => b.tree.branch)).toEqual(['main', 'feat/auth', 'fix/billing'])
  expect(app.branches[1]!.agents.map(r => r.agent.name)).toEqual(['oauth login'])
  expect(app.branches[2]!.agents.map(r => r.agent.name)).toEqual(['billing worker'])
  expect(f.conflicts).toBe(1)
  expect(f.needsYou.map(r => r.agent.name)).toEqual(['site deploy'])
})

test('a branch warns about conflicts and files changed elsewhere too', () => {
  const auth = gather(VIEW, ME).repos[0]!.branches[1]!
  expect(auth.warnings.map(w => w.text)).toEqual([
    'will conflict with fix/billing in README.md',
    'fix/billing also changed src/config.ts',
  ])
})

test('@handles find agents by name, session id or branch, never this session', () => {
  const { rows } = gather(VIEW, ME)
  expect(findAgent(rows, 'oauth-login').map(r => r.key)).toEqual(['other-session'])
  expect(findAgent(rows, '#bloc').map(r => r.key)).toEqual(['blocked-session'])
  expect(findAgent(rows, 'feat-auth').map(r => r.key)).toEqual(['other-session'])
  expect(findAgent(rows, 'billing').map(r => r.agent.name)).toEqual(['billing worker'])
  expect(findAgent(rows, 'my-work')).toEqual([])
})

test('an activity bar shows recent work, waiting, and a stuck agent in red', () => {
  const busy = gather(VIEW, ME).rows.find(r => r.key === 'other-session')!
  const cells = bar(busy.agent, NOW)
  expect(cells).toHaveLength(7)
  expect(cells[6]).toMatchObject({ color: 'claude' })
  expect(cells[0]).toMatchObject({ ch: '▁', color: 'inactive' })

  const waiting = { ...busy.agent, status: 'waiting' as const }
  expect(bar(waiting, NOW)[6]).toMatchObject({ ch: '▇', color: 'warning' })

  const stuck = { ...busy.agent, updatedAt: NOW - STUCK_AFTER_MS - 60_000, trail: [{ at: NOW - STUCK_AFTER_MS - 60_000, kind: 'edit' as const }] }
  expect(bar(stuck, NOW).slice(-2).every(c => c.color === 'error')).toBe(true)
})

test('the text version has the summary, the map and the feed', () => {
  const text = summary(gather(VIEW, ME))
  expect(text).toMatch(/! 1 needs you/)
  expect(text).toMatch(/⚠ 1 conflict/)
  expect(text).toMatch(/├─ feat\/auth ●━● {2}↑2 ↓1 ±1/)
  expect(text).toMatch(/⚠ will conflict with fix\/billing in README\.md/)
  expect(text).toMatch(/2 new commits/)
  expect(text).toMatch(/! site deploy @site-deploy/)
  expect(timeline(gather(VIEW, ME))).toMatch(/oauth login/)
})
