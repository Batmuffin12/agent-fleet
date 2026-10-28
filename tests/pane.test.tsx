import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-fleet',
  component: 'Pane',
  requestId: 'agent-fleet',
  props: {
    title: 'Agent fleet',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const tree = (over: Record<string, unknown>) => ({
  head: 'abc1234abc1234',
  dirty: 0,
  dirtyFiles: [],
  lastCommit: 'init',
  base: 'main',
  ahead: 0,
  behind: 0,
  conflicts: [],
  ...over,
})

const beat = (over: Record<string, unknown>) => ({
  v: 3,
  name: '',
  title: '',
  notifier: true,
  worktrees: [],
  worktreesAt: 0,
  subagents: [],
  events: [],
  prompt: '',
  updatedAt: 98_000,
  aliveAt: 99_000,
  ...over,
})

const VIEW = {
  checkedAt: 100_000,
  beats: [
    // Another session, in a worktree of app, sharing app's worktrees and their health.
    beat({
      sessionId: 'other-session',
      title: 'oauth login',
      cwd: 'C:\\code\\app-wt\\auth\\src',
      repoRoot: 'C:/code/app',
      worktrees: [
        tree({ path: 'C:/code/app', branch: 'main' }),
        tree({
          path: 'C:/code/app-wt/auth',
          branch: 'feat/auth',
          dirty: 1,
          dirtyFiles: ['src/config.ts'],
          ahead: 2,
          behind: 1,
          conflicts: [{ branch: 'fix/billing', files: ['README.md'] }],
        }),
        tree({
          path: 'C:/code/app-wt/billing',
          branch: 'fix/billing',
          dirty: 1,
          dirtyFiles: ['src/config.ts'],
          conflicts: [{ branch: 'feat/auth', files: ['README.md'] }],
        }),
      ],
      worktreesAt: 99_000,
      status: 'working',
      activity: 'Edit login.ts',
      prompt: 'add oauth login',
      events: [{ id: 'commit:auth:1', kind: 'commit', text: 'feat/auth: 2 new commits', at: 97_000 }],
    }),
    // A session in a second repo, stopped on a permission prompt.
    beat({
      sessionId: 'blocked-session',
      cwd: 'C:/code/site',
      repoRoot: 'C:/code/site',
      worktrees: [tree({ path: 'C:/code/site', branch: 'main' })],
      worktreesAt: 99_000,
      status: 'waiting',
      activity: 'ask: Bash npm publish',
    }),
  ],
}

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1]

/** Every session's files, as the pane has read them; the rest of $.state is the kit's. */
const seed = (on: On) => {
  on('state.get', (_, e, next) =>
    (e as unknown as { key: string }).key === 'view'
      ? { value: { value: { shape: 'view-3', value: VIEW }, version: 1 } }
      : next(e),
  )
  on('clock.now', () => ({ value: VIEW.checkedAt }))
  on('ui.toast', () => ({ value: undefined }))
}

test('the union of every session: by repo, then worktree, with health and a recap', async ($, on) => {
  seed(on)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /feat\/auth/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Editing login\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /add oauth login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Needs you \(1\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Wants your OK: Running "npm publish"/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑2 ahead · ↓1 behind main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Will conflict with fix\/billing in README\.md/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /also has unsaved changes to src\/config\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /While you were away/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /feat\/auth: 2 new commits/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pressing a name shows its buttons; a preset answers with what happened', async ($, on) => {
  seed(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'sel:other-session' })
  expect(await ui.find({ type: 'Button', key: 'act:u' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'act:msg' })).toBeDefined()

  await ui.press({ key: 'act:u' })
  expect(await ui.find({ type: 'Text', text: /Sent "Status\?" to oauth login|Couldn't reach oauth login/ })).toBeDefined()

  await ui.press({ key: 'act:close' })
  expect(await ui.find({ type: 'Button', key: 'act:u' })).toBeUndefined()
  await ui.unmount()
})

test('on the phone, /fleet answers in the chat with the fleet itself', async ($, on) => {
  seed(on)

  const ui = await $.ui.mount({
    plugin: 'agent-fleet',
    surface: 'mobile',
    component: 'CommandOutput',
    props: { command: 'fleet', args: '', text: 'text summary', isErrored: false },
  })
  expect(await ui.find({ type: 'Text', text: /Needs you \(1\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /feat\/auth/ })).toBeDefined()
  await ui.unmount()
})
