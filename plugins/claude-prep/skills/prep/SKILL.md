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

Find out which machine you are on first, then check only what applies.

**macOS**

```bash
command -v node || echo NO_NODE
xcode-select -p 2>/dev/null || echo NO_XCODE_TOOLS
```

**Windows**

```bash
where node || echo NO_NODE
where git || echo NO_GIT
```

Use `command -v` / `where` rather than `node --version`: on a machine without node the
version command prints a shell error that looks alarming to someone who has never seen one.

On macOS, check Xcode tools with `xcode-select -p` rather than by running `git` — running
`git` is itself what triggers the install dialog, which is startling if they were not
expecting it.

**Node is the one that matters.** Claude Code itself is a native binary and does not need
it, so a new machine very often has no node at all. Plenty of useful things, including most
MCP servers and the `connect-app` key tool, do need it.

Git ships with macOS but the command triggers the Xcode developer tools install the first
time it is used, which shows a dialog the user will not expect.

## Step 2: what you can and cannot install for them

Be honest with yourself about this. On a Mac that has never been developed on:

### macOS

**Stock, always present:** `sh`, `curl`, `osascript`, `open`, `installer`.

**Not present:** `node`, `npm`, Homebrew, and real `git` or `python3`. The `git` and
`python3` in `/usr/bin` are stubs that pop the Xcode Command Line Tools installer the first
time anything runs them.

**Nothing here installs silently.** Homebrew needs `sudo`, the Node installer is a `.pkg`
that prompts for an administrator password, and Xcode tools opens its own dialog. That is
macOS, not something you can engineer around.

- **Xcode tools, which gives them git:** run `xcode-select --install`. A system dialog
  appears. Tell them to click Install and that it takes a few minutes.
- **Node:** `open https://nodejs.org/en/download`, then tell them to download the macOS
  installer, double-click it, click through, and enter their Mac password when asked. Say
  the password prompt is macOS asking, not you, and that it is normal.

Do not offer a choice between Homebrew and the installer. Pick the installer: it is a
double-click rather than a terminal.

### Windows

Better news. `winget` ships with Windows 10 and 11, and these usually complete without a
password because winget handles elevation itself:

```bash
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

If `winget` is missing, it is an old build: send them to https://nodejs.org/en/download and
https://git-scm.com/download/win to download and double-click instead.

Windows has no Xcode tools step — git is a normal install. But git is genuinely absent by
default, where macOS at least has the stub, so check for it rather than assuming.

**Afterwards, on either platform, they must restart Claude Code.** A newly installed tool
is not on the PATH of an already-running session, so it will still look missing and you
will both be confused.

**Only install what is actually needed.** Do not put a beginner through installing node
just to edit some files. See the table below.

## What actually needs what

| They want to | Needs | macOS | Windows |
|---|---|---|---|
| Edit files, build a site, write anything | nothing | **Works** | **Works** |
| Install plugins | nothing | **Works** | **Works** |
| Search the web, read documentation | nothing | **Works** | **Works** |
| Save and publish with git, deploy to Railway | git | Xcode tools dialog | `winget install Git.Git` |
| Add an API key with `connect-app` | node | nodejs.org installer | `winget install OpenJS.NodeJS.LTS` |
| Use MCP servers that start with `npx` | node | same as above | same as above |

Claude Code is a native application and needs none of it. A beginner can do a great deal
before anything has to be installed, so let the task decide, not a setup checklist.

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
