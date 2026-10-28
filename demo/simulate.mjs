// Fakes several Claude sessions by writing the same files the agent-fleet mod
// writes (~/.claude/agent-fleet/v4/<session>.json). Run it after setup.sh,
// then open a session with the mod inside demo/repo and watch the pane.
//
//   node demo/simulate.mjs            run until Ctrl+C (removes its files on exit)
//   node demo/simulate.mjs --once     write one snapshot and exit
//
// What it plays, so every part of the pane gets exercised:
//   - an orchestrator in main running 3 subagents, one per worktree
//   - a subagent that finishes then resumes, and one that keeps stopping for your OK
//   - two subagents editing the same file from different worktrees
//   - a session that stops heartbeating (offline after 30s)
//   - a session in a second repo that is stuck, and one outside any repo
//   - half an hour of history for the activity bars, and events for the feed
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const slash = p => p.split(path.sep).join('/')
const repo = slash(path.join(here, 'repo'))
const wt = name => slash(path.join(here, 'worktrees', name))
const otherRepo = slash(path.join(here, 'other-repo'))

const dir = path.join(os.homedir(), '.claude', 'agent-fleet', 'v4')
fs.mkdirSync(dir, { recursive: true })

const scripts = {
  auth: ['Read auth.ts', 'Grep "session"', 'Edit config.ts', 'Bash npm test -- auth', 'thinking…', 'Write oauth.ts'],
  billing: ['Bash git diff', 'Edit config.ts', 'Write refund.ts', 'Bash npm run lint'],
  docs: ['Read README.md', 'Edit README.md', 'thinking…'],
  site: ['Read index.html', 'Edit styles.css', 'Bash npm run build'],
  orchestrate: ['thinking…', 'Agent auth worker', 'Agent billing worker', 'Agent docs worker', 'TaskList', 'thinking…'],
}
const kindOf = line => (/^(Edit|Write)/.test(line) ? 'edit' : 'run')

// A second repo's worktrees, shared in its session's file: the pane draws
// them without running git there.
const tree = (p, branch, over = {}) => ({
  path: p, branch, head: 'a1b2c3d4e5f6', dirty: 0, dirtyFiles: [], lastCommit: '',
  base: 'main', ahead: 0, behind: 0, conflicts: [], ...over,
})
const otherTrees = [
  tree(otherRepo, 'main', { lastCommit: 'launch page (2 days ago)' }),
  tree(`${otherRepo}-wt/redesign`, 'feat/redesign', {
    head: 'e4f5a6b7c8d9', dirty: 4, dirtyFiles: ['index.html', 'styles.css', 'logo.svg', 'nav.ts'],
    lastCommit: 'new header (1 hour ago)', ahead: 5, behind: 12,
  }),
]

const started = Date.now()
const MIN = 60_000

/** Half an hour of made-up activity: `busy` of every 10 slots active, `wait` of them waiting. */
function history(script, { busy = 7, wait = 0, until = started } = {}) {
  const out = []
  for (let t = started - 28 * MIN; t < until; t += 40_000) {
    const slot = Math.floor((t - started) / 40_000) % 10
    if (Math.abs(slot) >= busy) continue
    const line = scripts[script][Math.abs(slot) % scripts[script].length]
    out.push({ at: t, kind: Math.abs(slot) < wait ? 'wait' : kindOf(line) })
  }
  return out
}

const sessions = [
  {
    id: 'demo-main-0000', cwd: repo, repoRoot: repo, script: 'orchestrate',
    title: 'Ship auth, billing and docs', prompt: 'ship auth, billing fix and docs in parallel',
    trail: history('orchestrate', { busy: 5 }),
    subs: [
      { id: 'sub-auth', name: 'auth worker', cwd: wt('feat-auth'), script: 'auth', file: 'src/config.ts', trail: history('auth', { busy: 8 }) },
      // finishes for 3 ticks every 9, then is "resumed" with a new message
      { id: 'sub-billing', name: 'billing worker', cwd: wt('fix-billing'), script: 'billing', doneEvery: 9, file: 'src/config.ts', trail: history('billing', { busy: 6 }) },
      // waits for your OK for 2 ticks every 6
      { id: 'sub-docs', name: 'docs worker', cwd: wt('chore-docs'), script: 'docs', askEvery: 6, trail: history('docs', { busy: 6, wait: 2 }) },
    ],
  },
  { id: 'demo-dies-0004', cwd: repo, repoRoot: repo, title: 'Bump dependencies', prompt: 'bump dependencies', script: 'docs', diesAfter: 4, trail: history('docs', { busy: 3 }) },
  {
    id: 'demo-site-0006', cwd: `${otherRepo}-wt/redesign`, repoRoot: otherRepo, worktrees: otherTrees,
    title: 'Landing page redesign', prompt: 'redesign the landing page', script: 'site',
    // stuck: nothing for the last 14 minutes, still "working"
    stuckSince: started - 14 * MIN,
    trail: history('site', { busy: 8, until: started - 14 * MIN }),
    events: [
      { id: 'demo-commit-site', kind: 'commit', who: 'feat/redesign', text: '2 new commits', at: started - 20 * MIN },
    ],
  },
  { id: 'demo-lost-0005', cwd: slash(os.tmpdir()), repoRoot: '', title: 'Scratch experiment', prompt: 'scratch experiment', script: 'docs', trail: history('docs', { busy: 2 }) },
]

const file = s => path.join(dir, `${s.id}.json`)
let tick = 0
const events = new Map() // session id -> its events

function note(s, id, kind, who, text) {
  const list = events.get(s.id) ?? [...(s.events ?? [])]
  if (!list.some(x => x.id === id)) list.push({ id, kind, who, text, at: Date.now() })
  events.set(s.id, list.slice(-20))
}

/** The agent's trail with this tick's activity added; the last half hour only. */
function step(agent, kind) {
  const now = Date.now()
  if (kind) agent.trail.push({ at: now, kind })
  agent.trail = agent.trail.filter(x => now - x.at < 28 * MIN)
  return agent.trail
}

function subBeat(s, sub, now) {
  const lines = scripts[sub.script]
  const done = sub.doneEvery && tick % sub.doneEvery >= sub.doneEvery - 3
  const asks = sub.askEvery && tick % sub.askEvery >= sub.askEvery - 2
  const cycle = Math.floor(tick / (sub.doneEvery || sub.askEvery || 1))
  const line = lines[tick % lines.length]
  if (done) note(s, `done:${sub.id}:${cycle}`, 'done', sub.name, 'finished')
  if (asks) note(s, `needs:${sub.id}:${cycle}`, 'needs', sub.name, 'Wants your OK: Running "git push".')
  return {
    id: sub.id, name: sub.name, updatedAt: now,
    // a path inside the worktree is what the pane uses to place the subagent
    path: `${sub.cwd}/${sub.file ?? 'src'}`,
    status: done ? 'done' : asks ? 'waiting' : 'working',
    activity: done ? 'completed' : asks ? 'ask: Bash git push origin chore/docs' : line,
    trail: step(sub, done ? undefined : asks ? 'wait' : kindOf(line)),
  }
}

function beat(s) {
  const now = Date.now()
  const line = scripts[s.script][tick % scripts[s.script].length]
  const subagents = (s.subs ?? []).map(sub => subBeat(s, sub, now))
  const stuck = !!s.stuckSince
  return {
    v: 4,
    sessionId: s.id, cwd: s.cwd, repoRoot: s.repoRoot, name: '', title: s.title, notifier: false,
    prompt: s.prompt, worktrees: s.worktrees ?? [], worktreesAt: s.worktrees ? now : 0,
    subagents, events: events.get(s.id) ?? s.events ?? [],
    status: 'working', activity: stuck ? 'Bash npm run build' : line,
    trail: step(s, stuck ? undefined : kindOf(line)),
    updatedAt: stuck ? s.stuckSince : now, aliveAt: now,
  }
}

function write() {
  for (const s of sessions) {
    if (s.diesAfter !== undefined && tick >= s.diesAfter) continue // stops heartbeating
    fs.writeFileSync(file(s), JSON.stringify(beat(s)))
  }
  console.log(`tick ${tick} → ${dir}`)
  tick++
}

function cleanup() {
  for (const s of sessions) fs.rmSync(file(s), { force: true })
  console.log('removed demo files')
  process.exit(0)
}

write()
if (!process.argv.includes('--once')) {
  setInterval(write, 2000)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}
