// The repo's worktrees and their health: unsaved files, commits ahead of and
// behind the main worktree's branch, and the branches each would clash with
// on a merge (git merge-tree, which touches no worktree).
import type { EngineInterface } from 'claude-code'

import type { FleetWorktree } from '../types'
import { addEvent } from './beat'
import { norm, plural } from './util'

const MAX_CONFLICT_TREES = 8

/** The last HEAD seen per worktree, to tell new commits. */
const lastHeads = new Map<string, string>()
/** merge-tree's answer per pair of commits: the clashing files, [] when clean. */
const clashCache = new Map<string, string[]>()

async function git($: EngineInterface, cwd: string, ...args: string[]) {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : ''
}

/** The files two commits would clash on if merged. */
async function clashes($: EngineInterface, root: string, a: string, b: string) {
  if (a === b) return []
  const key = [a, b].sort().join(':')
  const known = clashCache.get(key)
  if (known) return known
  const r = await $.process
    .run(['git', 'merge-tree', '--write-tree', '--name-only', '--no-messages', a, b], {
      cwd: root,
      timeoutMs: 10_000,
    })
    .catch(() => undefined)
  if (!r || (r.exitCode !== 0 && r.exitCode !== 1)) return []
  const files = r.exitCode === 1 ? r.stdout.split(/\r?\n/).slice(1).filter(Boolean) : []
  clashCache.set(key, files)
  return files
}

export async function readWorktrees($: EngineInterface, root: string): Promise<FleetWorktree[]> {
  const out = await git($, root, 'worktree', 'list', '--porcelain')
  const listed = out
    .split(/\r?\n\r?\n/)
    .filter(b => b.trim())
    .map(block => {
      const lines = block.split(/\r?\n/)
      const field = (k: string) => lines.find(l => l.startsWith(k + ' '))?.slice(k.length + 1) ?? ''
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
      return { ...blank, dirty: dirtyFiles.length, dirtyFiles, lastCommit: log.trim(), ahead: ahead || 0, behind: behind || 0 }
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
export async function noteCommits($: EngineInterface, root: string, trees: FleetWorktree[]) {
  for (const t of trees) {
    const key = norm(t.path)
    const prev = lastHeads.get(key)
    lastHeads.set(key, t.head)
    if (!prev || !t.head || prev === t.head) continue
    const n = Number((await git($, root, 'rev-list', '--count', `${prev}..${t.head}`)).trim()) || 0
    const text = n > 0 ? plural(n, 'new commit') : `moved to ${t.head.slice(0, 7)}`
    await addEvent($, { id: `commit:${key}:${t.head}`, kind: 'commit', who: t.branch, text })
  }
}
