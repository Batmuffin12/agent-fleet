# agent-fleet

**See every Claude Code session on your machine in one pane: which branch each agent works on,
what it is doing right now, which branches will conflict, and who needs you. Talk to any agent
from any prompt.**

agent-fleet is a Claude Code mod. Install it once, and every Claude session you open shows the
same live pane beside the chat. It is built for working with many agents at once, especially
across git worktrees.

```
✻ Agent fleet                                        Map only (c)
✶ 5 working   ! 1 needs you   ⚠ 1 conflict   ✓ 1 done

▾ demo-repo  this repo
main
│  ✶ ship-auth        ▅▇▆▅▃▇▇  handing a task to "auth worker"
│  ✻ you              ▁▃▁▁▅▁▃  idle 2m
├─ feat/auth ●━● ↑2 ↓1 ±2 ⚠
│  ✶ auth-worker      ▁▅▇▇▆▇▇  editing config.ts
│  ✻ #72ba            ▁▁▁▁▁▃▁  idle 4m
├─ fix/billing ● ↑1 ↓1 ±2 ⚠
│  ✓ billing-worker   ▇▇▆▇▃▁▁  finished
└─ chore/docs ↓1
   ! docs-worker      ▅▇▆▇▅▇▇  needs you

▾ site
└─ feat/redesign ●━●━● ↑5 ↓12 ±4
   ✶ landing-page     ▇▆▅▁▁▁▁  no progress 14m

── feed · 3 new ──                                       Seen (g)
╭──────────────────────────────────────────────────────────────╮
│ ! docs-worker chore/docs  Wants your OK: Running "git push". │
│ [ Reply ] [ Stop ]                                           │
╰──────────────────────────────────────────────────────────────╯
22:11 ↩ #72ba feat/auth is 2 commits ahead of main
22:09 ✓ billing-worker finished
22:05 ● feat/redesign 2 new commits
21:58 ⚠ landing-page no progress for 12m

@name message: talk to an agent · click a name or branch for details
```

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Update and uninstall](#update-and-uninstall)
- [Using the pane](#using-the-pane)
- [Talking to agents](#talking-to-agents)
- [When the pane is closed](#when-the-pane-is-closed)
- [On the phone](#on-the-phone)
- [Commands](#commands)
- [Keyboard](#keyboard)
- [What the symbols and colors mean](#what-the-symbols-and-colors-mean)
- [How it works](#how-it-works)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Develop](#develop)
- [Demo](#demo)
- [Project layout](#project-layout)

---

## Features

### See everything at a glance
- **One summary line** at the top: how many agents are working, how many need you, how many
  branch pairs will conflict, how many finished, how many went offline.
- **Every session on the machine**, not just this one. Each session that runs the mod shares what
  it is doing; every pane shows all of them.
- **Grouped by repo, then by branch.** Each git worktree is a branch in the map. The repo you are
  in comes first and shows all its branches; other repos show only the branches with agents or
  problems ("+ 2 more without agents").
- **Subagents** sit under the branch they work in, even when the session that started them works
  elsewhere.
- **What each agent is doing, in plain words**: "editing config.ts", "running "npm test"",
  "searching the code for "session"", "needs you", "idle 4m", "finished".
- **Sessions named after their task.** A session is called by its first prompt ("oauth login"),
  or the name you give it with `/fleet name`. Your own session shows as "you".

### Branch health
- **Ahead and behind**: `↑2 ↓1` commits compared with the main worktree's branch, and `●━●` dots
  for new commits on the branch.
- **Unsaved changes**: `±2` files changed and not committed.
- **Predicted merge conflicts**: `⚠` on both branches when merging them would conflict, with the
  files that clash. Checked with git's `merge-tree`, which never touches your files.
- **The same file changed on two branches**: a warning before it becomes a conflict.
- **Two agents editing the same file**, even from different worktrees.

### Activity bars
- A small bar beside each agent shows **its last half hour**, one block per 4 minutes.
- The block's **height** is how much the agent did; its **color** is what kind of work: editing,
  running commands or reading, waiting on you.
- An agent that is supposedly working but has done **nothing for 10 minutes** turns into a flat red
  line and reads "no progress 14m": it is probably stuck.
- `/fleet timeline` shows the full half hour per agent, one block per minute.

### The feed
- **What needs you comes first**, in a yellow box with **Reply** and **Stop**: permission prompts,
  questions (AskUserQuestion), plans waiting for approval.
- Then the news, newest first: **replies** from agents you messaged, agents that **finished**, **new
  commits** on any branch, agents **stuck** with no progress, messages you sent.
- **New since you last looked** is bold; **Seen** marks everything as read.
- **Repeats are counted** ("7× docs-worker needs you") instead of filling the feed.

### Talk to any agent
- Type **`@auth-worker stop after this file`** in any session's prompt. The message goes to that
  agent, **not to your own Claude**, so it costs nothing and does not interrupt your conversation.
- It arrives **as your instruction**: the agent treats it like something you typed to it.
- Its **answer shows in the feed** and in its details in every pane, not in your chat.
- Buttons do the same: **Message** puts `@its-name ` in your prompt, **Stop** asks it to stop after
  its current step.

### Out of the way until needed
- **A band above your prompt** when the pane is closed and something needs you: who, why, and
  **Reply** / **Open fleet**. A predicted conflict shows there too.
- **A status line entry** all the time: `✻ fleet ✶5 !1 ⚠1`.
- **One desktop notification for the whole machine** when an agent finishes, needs you or gets
  stuck: not one per session, and at most one every 30 seconds, gathering what came in meanwhile.

### Works where you are
- **Terminal** and **VS Code**: the pane docks beside the chat.
- **Phone (Remote Control)**: `/fleet` answers in the chat with the whole fleet.
- **Compact mode**: the map alone, without the feed.

---

## Requirements

- **Claude Code** with mod support (hooks modules). Built and tested on Claude Code 2.1.312.
- **git 2.38 or newer** for conflict prediction (`git merge-tree --write-tree`). Everything else
  works with any git.
- **Windows, macOS or Linux.**
- For installing from this repository while it is private: **read access to it on GitHub**, and
  the GitHub CLI signed in (see below).

---

## Install

**1. Give git access to GitHub** (once per machine, needed while the repository is private):

```
gh auth login
gh auth setup-git
```

**2. Install the mod.** At the prompt of any Claude Code session:

```
/plugin install agent-fleet --marketplace Batmuffin12/agent-fleet
```

Answer `y` to add the marketplace, then choose the **user** scope so the mod runs in every
session on the machine. Every session you want to see in the pane needs the mod.

Or from a shell:

```
claude plugin install agent-fleet --marketplace Batmuffin12/agent-fleet
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `Batmuffin12/agent-fleet`, then **Add plugin**.

**3. Open the pane.** It opens by itself in a terminal at least 144 columns wide. Otherwise type
`/fleet`.

---

## Update and uninstall

Update to the newest version:

```
claude plugin update agent-fleet
```

then type `/reload-plugins` in any open session.

Uninstall:

```
claude plugin uninstall agent-fleet
```

The shared files stay in `~/.claude/agent-fleet/`; delete that folder to remove them too.

---

## Using the pane

From top to bottom:

1. **The header**: `✻ Agent fleet` and the **Map only / Feed** switch.
2. **The summary line**: working, needs you, conflicts, done, offline.
3. **The map**, one block per repo:
   - **The repo's name.** Click it to fold or unfold the repo.
   - **One line per branch**: its name, new commits `●━●`, ahead/behind `↑2 ↓1`, unsaved files
     `±2`, and `⚠` when it has a warning (red for a predicted conflict, yellow otherwise).
   - **Under each branch, its agents**: status icon, name, activity bar, and a few words on what
     it is doing.
4. **The feed**: what needs you, then the news.
5. **A hint line**: how to talk to an agent.

**Click a branch** to open its details:
- its folder and last commit,
- every warning in full ("will conflict with fix/billing in README.md", "fix/billing also changed
  src/config.ts", "auth worker and billing worker are both editing src/config.ts"),
- its unsaved files.

**Click an agent** to open its details:
- what it is doing, as a full sentence,
- its task (the session's latest prompt),
- your last message to it and its answer (`→ you: …` / `↩ …`), or "waiting for its answer…",
- **Message** and **Stop**, and its `@handle`,
- whether your last message reached it (`✓ Sent to …` or `✗ Couldn't reach …`).

Click the same name again to close the details.

**Finished subagents** stay listed for 5 minutes. **A session that closes** disappears after 30
seconds; **one that stops responding** shows as offline after 30 seconds and disappears after 10
minutes.

---

## Talking to agents

Type `@` and the agent's handle at the start of any prompt, then your message:

```
@auth-worker stop after this file and commit
@#72ba how many commits ahead of main are you?
@feat-auth run the tests again
```

**The handle** is the agent's name in lower case with dashes: `auth worker` → `@auth-worker`,
`Ship auth, billing and docs` → `@ship-auth-billing-and-docs` (up to 24 characters). Every agent
shows its handle in its details. You can also use:
- **the start of the handle**: `@auth` finds `auth-worker` when nothing else starts that way,
- **a session's id**: `@#72ba` (the first 4 characters),
- **a session's branch**: `@feat-auth` for the session working in `feat/auth`.

**What happens:**
1. Your own Claude never sees the prompt. Claude Code shows "Prompt dropped by a hook: Sent to
   auth worker: "…"" (that wording is Claude Code's own), and the prompt box empties.
2. The agent receives it as your instruction, from you, and answers in its own session.
3. Its first answer after your message shows in the feed (`↩`) and in its details, in every pane.

**When the handle matches several agents**, nothing is sent and you are told which handles to
use. **When it matches none**, the prompt goes to your own Claude as usual, so `@file` mentions
keep working.

**Subagents**: a message to a subagent of another session goes through that session, which
passes it on; the answer then shows on the session.

---

## When the pane is closed

- **Band above the prompt.** When something needs you and the pane is not on screen, a line above
  your prompt names who and why, with **Reply** (puts `@its-name ` in your prompt) and **Open
  fleet**. A predicted conflict gets a second line. The band is gone as soon as nothing needs you.
- **Status line.** Always shows `✻ fleet ✶5 !1 ⚠1`: working, needs you, conflicts.
- **Notifications.** One session on the machine sends desktop notifications for agents that
  finish, need you or get stuck, at most one every 30 seconds. They go through Claude Code's own
  notification setting, so turning notifications off there turns these off too.

---

## On the phone

Through Remote Control, the Claude app shows no side panes. Send `/fleet` from the phone: the
reply in the chat is the whole fleet (the summary, the map with activity bars, and the latest of
the feed), with each agent's `@handle` so you can message it from the phone too. Where the app
draws mod content, that reply is the live view with working buttons.

---

## Commands

| Command | What it does |
| --- | --- |
| `/fleet` | Opens the pane, and replies with the whole fleet as text |
| `/fleet timeline` | The last half hour of every agent, one block a minute |
| `/fleet name <name>` | What other panes call this session (`/fleet name` alone clears it) |
| `/fleet compact` | Switches between the map alone and map plus feed |
| `/fleet select <agent or branch>` | Opens that agent's details and buttons in the pane |

---

## Keyboard

Click anything in the pane, or give it the keyboard with `ctrl+x tab` and press:

| Key | Does |
| --- | --- |
| `c` | Map only / map and feed |
| `g` | Mark the feed as seen |
| `m` | Message the selected agent |
| `s` | Stop the selected agent |
| `Tab`, `Enter` | Move between buttons and names, press one |
| `Esc` | Give the keyboard back to the prompt |

---

## What the symbols and colors mean

**Agents**

| Icon | Color | Status |
| --- | --- | --- |
| `✶` (animated) | orange | working |
| `!` | yellow | needs you: a permission prompt, a question or a plan to approve |
| `✻` | blue | idle, waiting for its next message |
| `✓` | green | finished |
| `✻` | red | offline: its session stopped responding |

**Activity bars** (last half hour, oldest on the left)

| Block | Means |
| --- | --- |
| orange | editing files |
| blue | running commands or reading |
| yellow | waiting on you |
| grey `▁` | nothing happened |
| red `▁` | stuck: working, but nothing for 10 minutes |

Taller blocks mean more activity in those 4 minutes.

**Branches**

| Mark | Means |
| --- | --- |
| `●━●` | new commits on the branch (up to 3 dots) |
| `↑2 ↓1` | 2 commits ahead of, 1 behind the main worktree's branch |
| `±2` | 2 files changed and not committed |
| red `⚠` | merging it with another branch will conflict |
| yellow `⚠` | a file changed on two branches, or two agents editing one file |

**Feed**

| Icon | Event |
| --- | --- |
| `!` | an agent needs you |
| `↩` | an agent's answer to your message |
| `→` | a message you sent |
| `✓` | an agent finished |
| `●` | new commits on a branch |
| `⚠` | an agent with no progress |

---

## How it works

Each session running the mod writes one small file every 2 seconds:

```
~/.claude/agent-fleet/v4/<session id>.json
```

It holds the session's status, what it is doing, its subagents, its activity of the last half
hour, its repo's worktrees and their health, and its recent events. Every session reads all the
files and draws the union. There is **no server**, and **no file two sessions write at once**.

| What | When |
| --- | --- |
| Each session writes its file and reads everyone's | every 2 s |
| Each session re-reads its repo's worktrees and health | every 8 s |
| A session that stops writing shows as offline | after 30 s |
| …and disappears | after 10 min |
| A closed session disappears | after 30 s |
| A working agent with no activity is stuck | after 10 min |
| A finished subagent stays listed | 5 min |
| The feed keeps events | 1 h |
| The activity bars cover | the last 28 min |
| Files of sessions gone a day are deleted | at the next session start |
| At most one notification per machine | every 30 s |

**Git**: each session runs `git worktree list`, `git status`, `git log` and `git rev-list` in its
own repo, and `git merge-tree --write-tree` for each pair of worktrees (up to 8), cached per pair
of commits. None of these change anything. A session shares its repo's results in its file, so a
pane can show other repos without running git there.

**Messages** go through Claude Code's own session messaging (`$.session.send`), the same channel
as its SendMessage tool.

---

## Privacy

- **Everything stays on your machine.** The shared files are in your home folder; the mod sends
  nothing to any server.
- The files hold: each session's id, folder and repo path, branch names, the first line of its
  first prompt and its latest prompt (cut to 120 characters), file names it touched, tool names
  and short arguments (like a command it ran), and the events in the feed.
- Anyone who can read your home folder can read them, like the rest of `~/.claude`.
- Delete `~/.claude/agent-fleet/` at any time; sessions write fresh files on their next beat.

---

## Troubleshooting

**The pane does not open by itself.** It only opens unasked in a terminal 144 columns wide or
more. Type `/fleet`, or widen the window.

**`/fleet` says unknown command.** The mod did not load in that session. Look for a dim line
starting `agent-fleet:` near the top of the session, which says why. Check `claude plugin list`.

**A session is missing from the pane.** Only sessions running the mod show up. Install it with the
**user** scope so every session has it, or start that session with `--plugin-dir`.

**Two machines don't see each other.** By design: the files are local, so each machine shows its
own sessions.

**No colors (everything grey).** A Claude session started from inside another Claude session
inherits variables that turn colors off (`CLAUDECODE`, `AI_AGENT`). Start it from a normal
terminal, or set `FORCE_COLOR=3`.

**No conflict warnings.** Conflict prediction needs git 2.38 or newer (`git --version`).

**An agent shows as stuck but is fine.** It has been "working" for 10 minutes without a tool call,
for example during one long command. It clears at its next action.

**My `@message` went to my own Claude.** The handle matched no agent. Check the handle in the
agent's details; agents in sessions without the mod cannot be reached.

---

## Limitations

- Only sessions that run the mod appear; a plain Claude session is invisible to it.
- One machine at a time: sessions on other machines are not shared.
- The phone shows `/fleet`'s reply in the chat, not a live side pane.
- The band's conflict line stays while the conflict exists; there is no dismiss yet.
- Claude Code words a routed message as "Prompt dropped by a hook"; the mod cannot change that.
- A reply is the receiving agent's first answer after your message; if it was mid-turn, that
  answer may cover what it was already doing as well.

---

## Develop

```
git clone https://github.com/Batmuffin12/agent-fleet
cd agent-fleet
claude --plugin-dir .          # a session with the mod; it reloads whenever you save
claude plugin validate .       # what the engine sees and would refuse
claude plugin test .           # tests/model.test.ts and tests/pane.test.tsx
```

Type-check with `npx -p typescript tsc -p . --noEmit` after a session has loaded the mod once (it
writes the engine's types to `.claude-plugin/types/`).

Two engine rules to know when changing the code:
- A function that receives `$` from another file must be a `function` declaration, not an arrow
  function.
- A file that reads or writes the mod's state declares its own `atom(...)` for it; the starting
  values are shared from `src/state.ts`.

---

## Demo

`demo/` builds a throwaway repo and fakes a fleet of agents, so every part of the pane has
something to show: a predicted conflict, files changed on two branches, a subagent that keeps
asking for your OK, one that finishes and restarts, a stuck agent, a second repo, and half an
hour of history for the activity bars.

```
bash demo/setup.sh            # demo/repo + 3 worktrees (on Windows: Git Bash)
node demo/simulate.mjs        # the fake agents; Ctrl+C removes them
cd demo/repo
claude --plugin-dir ../..     # a real session with the mod
```

To try messaging, open a second real session in `demo/worktrees/feat-auth` with
`claude --plugin-dir ../../..` and send it `@` plus its name from the first session.
The fake agents cannot answer messages.

---

## Project layout

| Path | What it holds |
| --- | --- |
| `hooks/register.tsx` | Wires Claude Code's events to the parts below |
| `src/beat.ts` | This session's file: status, activity, events; reading everyone's; notifications |
| `src/git.ts` | Worktrees, ahead/behind, predicted conflicts, new commits |
| `src/model.ts` | Every file turned into one picture of the fleet; pure, no engine calls |
| `src/talk.ts` | `@name` messages: sending, delivering as the person's, capturing replies |
| `src/ui/pane.tsx` | The pane |
| `src/ui/band.tsx` | The band above the prompt |
| `src/ui/text.ts` | The text versions: `/fleet`, the status line, `/fleet timeline` |
| `src/words.ts` | How activity is worded; status colors and icons |
| `src/limits.ts` | Every timing in one place |
| `src/state.ts` | Starting values of what the session keeps |
| `src/util.ts` | Small text and path helpers |
| `types/index.d.ts` | The shared file format and the mod's state |
| `tests/` | Model tests, pane tests, shared fixtures |
| `demo/` | The demo repo builder and the fake fleet |
| `.claude-plugin/` | The mod's manifest and the marketplace file that makes it installable |
