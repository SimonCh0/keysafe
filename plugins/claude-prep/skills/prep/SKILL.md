---
name: prep
description: Set up a new machine so Claude can actually work — make changes, install what it needs, and push to git — without stopping for permission at every step. Also checks the tools Claude relies on are installed. Use when someone has just installed Claude Code, says Claude keeps asking permission or says it cannot do something, is on a new computer, or is following a course that expects a working setup.
---

# Getting a new machine ready

The person running this is probably not technical. They may not know what a terminal is,
what npm is, or whether they have it. **Do not ask them to run commands, install things by
hand, or make judgement calls about tooling.** Do it, then tell them what you did.

## The distinction to explain once, briefly

Permissions are not instructions. A `CLAUDE.md` file tells Claude how to behave; it cannot
grant permission to do anything. That is why "I can't actually do that" is not fixed by
writing a better instruction file. One sentence is enough. Do not lecture.

## Step 1: check what is missing

```bash
node --version || echo NO_NODE
git --version || echo NO_GIT
```

**Node is the one that matters.** Claude Code itself is a native binary and does not need
it, so a new machine very often has no node at all. Plenty of useful things, including most
MCP servers and the `connect-app` key tool, do need it.

Git ships with macOS but the command triggers the Xcode developer tools install the first
time it is used, which shows a dialog the user will not expect.

## Step 2: install what is missing, without making it their problem

If node is missing, install it for them. On macOS, if Homebrew is present use it; if not,
download the official installer and run it, telling them a password prompt is coming and
that it is macOS asking, not you. On Windows use `winget install OpenJS.NodeJS`.

Say what you are installing and why in one sentence before you start. Do not present a
choice of package managers, versions, or install methods. Pick sensibly and proceed.

If an install genuinely fails, say plainly what did not work and what they can click.
Never leave them at a terminal error.

## Step 3: grant the permissions

```bash
node "${CLAUDE_PLUGIN_ROOT}/prep.mjs" --check
```

Show them the summary, then apply:

```bash
node "${CLAUDE_PLUGIN_ROOT}/prep.mjs"
```

Tell them to restart Claude Code.

## What this grants, and what it does not

**Granted**, because these are the things that otherwise make Claude useless:

- Reading and searching their files
- Editing and creating files without approving each one
- `git`, including **commit and push**, so work can actually be saved and published
- `npm`, `npx`, `node`, `python3`, so things can be installed and run
- Making folders, copying and moving files

**Still asks**, and these are the ones worth reading:

| Still asks | Why |
|---|---|
| `rm`, `rmdir` | Deleting is the one mistake that cannot be undone |
| `sudo` | An admin password should never be automated |
| `curl`, `wget` | Can send their files or keys somewhere |
| `chmod`, `chown` | How small mistakes turn into security problems |
| `ssh`, `scp` | Reach other machines |

If they ask why something still stops them, that table is the answer. The remaining
prompts are few enough to be worth reading, which is the point.

## Be straight about the trade

This is a real grant of access. Say so in a sentence: Claude can now change their files and
publish to their repositories without asking first, which is what makes it useful and is
also a genuine handover of control. Anything destructive still stops.

**`git push` is included deliberately.** It publishes. Warn them once that anything
committed to a public repository is public permanently, which is exactly why keys belong
in `.env` and never in a file that gets committed.

## Afterwards

Tell them what changed, that their previous settings were backed up, and that they can
undo it by deleting `~/.claude/settings.json`. Then get out of the way.
