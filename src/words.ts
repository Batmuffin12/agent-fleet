// How the mod words what an agent is doing, and the colors and icons it uses
// for each status. Pure: no engine calls.
import type { AgentStatusWord, FleetEvent, Sample } from '../types'
import { clip, tail } from './util'

/** "Edit auth.ts", "Bash npm test", "Grep TODO": what a tool call is doing. */
export function describe(tool: string, input: unknown): { activity: string; path?: string } {
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
export const ASKS: Record<string, string> = {
  AskUserQuestion: 'asking you a question',
  ExitPlanMode: 'waiting for you to approve a plan',
}

const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

/** What kind of work a tool call is, for the activity bars. */
export const sampleKind = (tool: string): Sample['kind'] => (EDITS.has(tool) ? 'edit' : 'run')

/** An agent list status, as the pane words it. */
export function agentStatus(s: string): AgentStatusWord {
  if (s === 'running') return 'working'
  if (s === 'pending' || s === 'waiting') return 'waiting'
  if (s === 'idle') return 'idle'
  return 'done'
}

/** Claude's spark, cycling while an agent works. */
export const SPARK = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢']

export const STATUS: Record<AgentStatusWord, { label: string; icon: string; color: string }> = {
  working: { label: 'working', icon: '✶', color: 'claude' },
  waiting: { label: 'needs you', icon: '!', color: 'warning' },
  idle: { label: 'idle', icon: '✻', color: 'suggestion' },
  done: { label: 'finished', icon: '✓', color: 'success' },
  offline: { label: 'offline', icon: '✻', color: 'error' },
}

export const SAMPLE_COLOR: Record<Sample['kind'] | 'idle' | 'stuck', string> = {
  edit: 'claude',
  run: 'suggestion',
  wait: 'warning',
  idle: 'inactive',
  stuck: 'error',
}

export const EVENT: Record<FleetEvent['kind'], { icon: string; color: string }> = {
  needs: { icon: '!', color: 'warning' },
  done: { icon: '✓', color: 'success' },
  commit: { icon: '●', color: 'claude' },
  stuck: { icon: '⚠', color: 'error' },
  message: { icon: '→', color: 'inactive' },
  reply: { icon: '↩', color: 'success' },
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
export function sentence(activity: string, status: AgentStatusWord): string {
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

/** The few words the map shows beside an agent: "editing config.ts", "idle 4m". */
export function phrase(activity: string, status: AgentStatusWord, quiet: string): string {
  if (status === 'waiting') return 'needs you'
  if (status === 'done') return 'finished'
  if (status === 'offline') return `offline ${quiet}`
  if (status === 'idle') return `idle ${quiet}`
  return sentence(activity, status).replace(/\.$/, '').replace(/^./, c => c.toLowerCase())
}
