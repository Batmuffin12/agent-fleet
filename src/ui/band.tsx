// The band above the prompt: only when the pane is not on screen and
// something needs the person, an agent waiting on them or a predicted
// conflict. At most two lines, each with what to do about it.
import { atom, read } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import { gather } from '../model'
import { EMPTY_BEAT, EMPTY_VIEW } from '../state'
import { clip } from '../util'
import { sentence } from '../words'
import { PANE } from './pane'

const self = atom({ plugin: 'agent-fleet', key: 'self' } as const, EMPTY_BEAT, { shape: 'self-4' })
const view = atom({ plugin: 'agent-fleet', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-4' })

export async function drawBand($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  if (e.props.hasSurvey) return undefined
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(p => p.id === PANE && p.isShown && p.isPlaced)) return undefined

  const [v, me] = await Promise.all([read($, view), read($, self)])
  const f = gather(v, me)
  const waiting = f.needsYou.find(r => !r.isMe)
  const conflict = f.repos.flatMap(r => r.branches).find(b => b.warnings.some(w => w.kind === 'conflict'))
  if (!waiting && !conflict) return undefined

  const { Box, Text, Button } = $.ui.resolve(e)
  const open = () => void $.ui.open({ id: PANE, title: 'Agent fleet' })
  const reply = () => {
    if (waiting) void $.prompt.fill({ text: `@${waiting.handle} ` }).catch(() => undefined)
  }
  const more = f.needsYou.filter(r => !r.isMe).length - 1

  return (
    <Box flexDirection="column">
      {waiting ? (
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color="warning" bold>
              ! {waiting.agent.name}
            </Text>
            <Text dimColor> {waiting.tree?.branch ?? ''} </Text>
            {clip(sentence(waiting.agent.activity, waiting.agent.status), 70)}
            {more > 0 ? <Text dimColor> (+{more} more)</Text> : null}
          </Text>
          <Box flexDirection="row">
            <Box marginRight={1}>
              <Button key="band:reply" variant="primary" onPress={reply}>
                Reply
              </Button>
            </Box>
            <Button key="band:open" dimColor onPress={open}>
              Open fleet
            </Button>
          </Box>
        </Box>
      ) : null}
      {conflict ? (
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="error" wrap="truncate-end">
            ⚠ {conflict.tree.branch} {conflict.warnings.find(w => w.kind === 'conflict')?.text}
          </Text>
          {waiting ? null : (
            <Button key="band:show" dimColor onPress={open}>
              Show
            </Button>
          )}
        </Box>
      ) : null}
    </Box>
  )
}
