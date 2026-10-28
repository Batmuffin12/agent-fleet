import { expect, test } from 'claude-code/testing'

import { NOW, VIEW } from './fixtures'

const PANE = {
  plugin: 'agent-fleet',
  component: 'Pane',
  requestId: 'agent-fleet',
  props: {
    title: 'Agent fleet',
    isFocused: false,
    bodyColumns: 64,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

type On = Parameters<Extract<Parameters<typeof test>[1], (...a: never[]) => unknown>>[1]

/** Every session's files, as the pane has read them; the rest of $.state is the kit's. */
const seed = (on: On) => {
  on('state.get', (_, e, next) =>
    (e as unknown as { key: string }).key === 'view'
      ? { value: { value: { shape: 'view-4', value: VIEW }, version: 1 } }
      : next(e),
  )
  on('clock.now', () => ({ value: NOW }))
  on('ui.toast', () => ({ value: undefined }))
}

test('the pane: a summary line, the git map with health, and the feed', async ($, on) => {
  seed(on)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /! 1 needs you/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⚠ 1 conflict/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /feat\/auth/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↑2 ↓1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /oauth login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /editing login\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 new commits/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Wants your OK: Running "npm publish"/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a branch opens its warnings; an agent opens its details, exchange and buttons', async ($, on) => {
  seed(on)
  on('session.send', () => ({ isDelivered: true }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'br:c:/code/app-wt/auth' })
  expect(await ui.find({ type: 'Text', text: /will conflict with fix\/billing in README\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /fix\/billing also changed src\/config\.ts/ })).toBeDefined()

  await ui.press({ key: 'sel:other-session' })
  expect(await ui.find({ type: 'Text', text: /Task: .*add oauth login/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /→ you: stop after login\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↩ Stopping after login\.ts, then committing\./ })).toBeDefined()

  await ui.press({ key: 'act:stop' })
  expect(await ui.find({ type: 'Text', text: /✓ Sent to oauth login: "Please stop after/ })).toBeDefined()

  await ui.press({ key: 'sel:other-session' })
  expect(await ui.find({ type: 'Button', key: 'act:stop' })).toBeUndefined()
  await ui.unmount()
})

test('compact shows the map alone; a repo folds', async ($, on) => {
  seed(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'compact' })
  expect(await ui.find({ type: 'Text', text: /2 new commits/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /feat\/auth/ })).toBeDefined()
  await ui.press({ key: 'fold:c:/code/app' })
  expect(await ui.find({ type: 'Text', text: /feat\/auth/ })).toBeUndefined()
  await ui.unmount()
})

test('"@handle message" in the prompt goes to that agent, not to this model', async ($, on) => {
  seed(on)
  const sent: unknown[] = []
  on('session.send', (_, e) => {
    sent.push(e)
    return { isDelivered: true }
  })
  // The engine beneath: a prompt that reaches it enters as typed.
  on('prompt.submit', (_, e) => ({ text: e.text }))

  const routed = await $.prompt.submit({ text: '@oauth-login stop after login.ts' } as never)
  expect(routed).toMatchObject({ drop: expect.stringMatching(/Sent to oauth login/) })
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({
    to: 'other-session',
    text: '(from the user, via agent-fleet) stop after login.ts',
  })

  const passed = await $.prompt.submit({ text: '@src/app.ts explain this' } as never)
  expect(passed).not.toHaveProperty('drop')
  expect(sent).toHaveLength(1)
})

test('on the phone, /fleet answers in the chat with the fleet itself', async ($, on) => {
  seed(on)
  const ui = await $.ui.mount({
    plugin: 'agent-fleet',
    surface: 'mobile',
    component: 'CommandOutput',
    props: { command: 'fleet', args: '', text: 'text summary', isErrored: false },
  })
  expect(await ui.find({ type: 'Text', text: /! 1 needs you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /feat\/auth/ })).toBeDefined()
  await ui.unmount()
})

test('the band above the prompt names who needs the person', async ($, on) => {
  seed(on)
  on('ui.panes', () => ({ value: [] }))
  const ui = await $.ui.mount({
    plugin: 'agent-fleet',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 } },
  } as never)
  expect(await ui.find({ type: 'Text', text: /! site deploy/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'band:reply' })).toBeDefined()
  await ui.unmount()
})
