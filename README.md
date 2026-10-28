# agent-fleet

A Claude Code mod: a side pane that shows every Claude session on this machine, grouped by repo and
then by git worktree (branch). Open it in any session and you see the same live picture everywhere.

```
✻ Agent fleet
✶ 5 working   ! 1 needs you   ⚠ 1 conflict   ✓ 1 done

▾ demo-repo  this repo
main
│  ✶ ship-auth        ▅▇▆▅▃▇▇  handing a task to "auth worker"
├─ feat/auth ●━● ↑2 ↓1 ±2 ⚠
│  ✶ auth-worker      ▁▅▇▇▆▇▇  editing config.ts
├─ fix/billing ● ↑1 ↓1 ±2 ⚠
│  ✓ billing-worker   ▇▇▆▇▃▁▁  finished
└─ chore/docs ↓1
   ! docs-worker      ▅▇▆▇▅▇▇  needs you

── feed · 3 new ──
! docs-worker chore/docs  Wants your OK: Running "git push".  [Reply] [Stop]
22:11 ↩ #72ba feat/auth is 2 commits ahead of main
22:09 ✓ billing-worker finished
```

- **One line sums it up**: how many agents work, need you, and which branches will conflict.
- **The git map**: each repo's branches with commits ahead/behind the main branch, unsaved files,
  and ⚠ for a predicted merge conflict (git's `merge-tree`, which touches no files), the same file
  changed on two branches, or two agents editing the same file. Each branch's agents sit under it.
- **Activity bars**: the last half hour of each agent, a block per 4 minutes. Height is how much it
  did; orange is editing, blue running or reading, yellow waiting on you, a flat red line is stuck.
- **The feed**: what needs you first (permission prompts, questions, plans to approve), then
  replies, finished work, new commits and stuck agents, newest first, repeats counted.
- **Talk to any agent from your prompt**: `@auth-worker stop after this file` goes to that agent,
  not to your own Claude. It arrives as your instruction; its answer shows in the feed and under it.
- **When the pane is closed**: a band above your prompt shows who needs you (Reply, Open fleet),
  and the status line shows `✻ fleet ✶5 !1 ⚠1`. One OS notification at a time for the whole
  machine, not one per session.

## Install

At the prompt of a Claude Code session:

```
/plugin install agent-fleet --marketplace Batmuffin12/agent-fleet
```

From a shell:

```
claude plugin install agent-fleet --marketplace Batmuffin12/agent-fleet
```

The repository is private: installing needs read access to it on GitHub, and a git credential for
github.com on your machine (`gh auth login`, then `gh auth setup-git`).

Every session you want to see in the pane needs the mod, so install it with the user scope. Each
machine's pane shows that machine's sessions only.

## Use

The pane opens by itself in a terminal at least 144 columns wide; otherwise type `/fleet`.

| Command | What it does |
| --- | --- |
| `/fleet` | Opens the pane, and replies with the whole fleet as text |
| `/fleet timeline` | The last half hour of every agent, a block a minute |
| `/fleet name <name>` | What other panes call this session |
| `/fleet compact` | The map alone, no feed |
| `/fleet select <agent or branch>` | Opens an agent's details and buttons |

**In the pane**: click a branch for its warnings and unsaved files; click an agent for what it is
doing, its task, your last exchange with it, and **Message** (puts `@its-name ` in your prompt) and
**Stop**; click a repo to fold it. From the keyboard, `ctrl+x tab` gives the pane the focus, then a
letter presses a button (`c` map only, `g` mark the feed seen, `m` message, `s` stop).

**Talking to agents.** Type `@handle your message` in any session's prompt, or from the phone. The
handle is the agent's name in lower case with dashes (`auth worker` → `@auth-worker`); a session's
id (`@#72ba`) or its branch (`@feat-auth`) work too. A prompt whose `@…` is no agent (an `@file`
mention) goes to your Claude as usual.

On the phone (Remote Control) the app shows no panes; `/fleet` answers in the chat instead.

## How it works

Each session writes one small file, `~/.claude/agent-fleet/v4/<session>.json`, every 2 seconds:
its status, its subagents, its activity of the last half hour, its repo's worktrees and their
health, and its recent events. Every session reads all the files and draws the union, so there is
no server and no file two sessions write at once. A session that stops writing shows as offline
after 30 seconds and disappears after 10 minutes; files older than a day are deleted.

| Part | Job |
| --- | --- |
| `hooks/register.tsx` | Wires the engine's events to the parts below |
| `src/beat.ts` | This session's file: status, activity, events; reading everyone's; notifications |
| `src/git.ts` | Worktrees, ahead/behind, predicted conflicts, new commits |
| `src/model.ts` | Every file turned into one picture of the fleet; pure, no engine calls |
| `src/talk.ts` | `@name` messages, delivering them as the person's, capturing replies |
| `src/ui/` | The pane, the band above the prompt, and the text versions |
| `src/words.ts` | How activity is worded, and the status colors and icons |
| `src/limits.ts` | Every timing in one place |

## Develop

```
claude --plugin-dir <this folder>      # the session reloads the mod whenever you save
claude plugin validate .
claude plugin test .                   # tests/model.test.ts, tests/pane.test.tsx
```

### Demo

`demo/` builds a throwaway repo with worktrees and fakes a fleet of agents, so every part of the
pane has something to show:

```
bash demo/setup.sh            # demo/repo + 3 worktrees, with a conflict and shared unsaved files
node demo/simulate.mjs        # fake sessions with half an hour of history; Ctrl+C removes them
cd demo/repo
claude --plugin-dir ../..     # a real session with the mod; open more in demo/worktrees/*
```
