# agent-fleet

A Claude Code mod: a side pane that shows every Claude session on this machine, grouped by repo and
then by git worktree (branch). Open it in any session and you see the same live picture everywhere.

- **What every agent is doing**, in one plain sentence ("Editing auth.ts.", "Running "npm test".",
  "Wants your OK: …"), with Claude's ✻ as the status icon, animated while the agent works.
- **Branch health** on every branch: commits ahead/behind main, a predicted merge conflict with
  another branch (git's `merge-tree`, which touches no files), the same file changed on two
  branches, and two agents editing the same file.
- **While you were away**: a recap of what happened (new commits, agents that finished, agents
  that need you, agents stuck with no progress for 10 minutes), plus one OS notification at a
  time for the whole machine, not one per session.
- **Needs you**: agents stopped on a permission prompt, a question or a plan to approve.
- **Talk to any agent from your prompt**: `@auth-worker stop after this file` goes to that agent,
  not to your own Claude. It arrives as your instruction, and its answer shows under it in the pane
  (`→ you: …` / `↩ …`), in every session's pane, instead of landing in your chat.
- Click an agent's name for **Message** (puts `@its-name ` in your prompt) and **Stop**.
- Compact mode, foldable branches, sessions named after what they were started for.

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

Every session you want to see in the pane needs the mod, so install it with the user scope.

## Use

The pane opens by itself in a terminal at least 144 columns wide; otherwise type `/fleet`.

| Command | What it does |
| --- | --- |
| `/fleet` | Opens the pane, and replies with the whole fleet as text |
| `/fleet name <name>` | What other panes call this session |
| `/fleet compact` | One line per agent |
| `/fleet select <agent or branch>` | Selects an agent so its buttons show |

**Talking to agents.** Every agent in the pane shows its handle, like `@auth-worker`. Type
`@handle your message` in any session's prompt (or from the phone). You can also use a session's id
(`@#72ba`) or its branch (`@feat-auth`). The pane shows what you sent and the agent's answer under
it. A prompt whose `@…` is not an agent's handle (an `@file` mention) goes to your Claude as usual.

In the pane: click a name for **Message** and **Stop**, ▾ to fold a branch. From the keyboard,
`ctrl+x tab` gives the pane the focus, then a letter presses a button (`c` compact, `g` dismiss
the recap, `m` message, `s` stop, `x` close).

On the phone (Remote Control) the app shows no panes; `/fleet` answers in the chat instead.

## How it works

Each session writes one small file, `~/.claude/agent-fleet/v3/<session>.json`, every 2 seconds:
its status, its subagents, its repo's worktrees and their health, and its recent events. Every
session reads all the files and draws the union, so there is no server and no shared file two
sessions write at once. A session that stops writing shows as offline after 30 seconds and
disappears after 10 minutes; files older than a day are deleted.

## Develop

```
claude --plugin-dir <this folder>      # the session reloads the mod whenever you save
claude plugin validate .
claude plugin test .                   # tests/pane.test.tsx
```

### Demo

`demo/` builds a throwaway repo with worktrees and fakes a fleet of agents, so every part of the
pane has something to show:

```
bash demo/setup.sh            # demo/repo + 3 worktrees, with a conflict and shared unsaved files
node demo/simulate.mjs        # fake sessions and subagents; Ctrl+C removes them
cd demo/repo
claude --plugin-dir ../..     # a real session with the mod; open more in demo/worktrees/*
```
