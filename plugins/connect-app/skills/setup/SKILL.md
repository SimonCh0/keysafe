---
name: setup
description: One-time setup for a new machine. Approves a conservative set of everyday commands so Claude Code stops asking permission for routine things, and checks Node is installed. Use when someone has just installed Claude Code, says every command keeps asking permission, asks how to get set up, or is following a course that expects a working baseline.
---

# Getting a new machine to a working baseline

A fresh Claude Code install has approved nothing, so every single command stops and asks.
That is safe, and it is also the biggest difference between someone who has used Claude
Code for months and someone opening it for the first time. Most of what looks like "it
doesn't work for me" is really "it asked me something I didn't understand."

## Run it

Show them what will change first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/setup.mjs" --check
```

Then apply it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/setup.mjs"
```

Tell them to restart Claude Code afterwards.

## What it approves, and what it deliberately does not

Approved: reading files (`ls`, `cat`, `grep`, `find`), and the everyday tools
(`node`, `npm`, `npx`, `python3`, everyday `git`, `mkdir`, `cp`, `mv`).

**Not** approved, on purpose, so they still get asked:

| Not approved | Why it is worth a prompt |
|---|---|
| `rm` | Deleting should never be silent |
| `sudo` | Never automate an admin password |
| `curl`, `wget` | Can send data off the machine |
| `ssh`, `scp` | Reach other machines |
| `git push` | Publishes. Worth a deliberate yes |
| `chmod` | Permission changes are how mistakes become security problems |

If they ask why something still prompts, this table is the answer. The prompt is the
feature, not a gap in the setup.

## Say what you did

Existing approvals are kept, never replaced, and the previous file is copied to
`settings.json.before-setup` first. Say that, because a beginner reasonably worries that a
setup script has overwritten something.

Be plain about the trade: this makes Claude able to act without interrupting, which is
convenient and is also a real grant of access. Anyone uneasy can run `--check`, read the
list, and decide.

## If Node is missing

The key collector runs on Node, so it has to be there. Point them at
https://nodejs.org and stop; do not attempt to install it for them.
