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

**Node, without an administrator password.** Prefer this over the `.pkg` installer, because
it needs no password at all — it installs entirely inside their home folder:

```bash
curl -fsSL https://fnm.vercel.app/install | bash
```

Then start a new shell and `fnm install --lts`. Auto mode treats a piped install script as
worth asking about, so they will see one prompt. That is one click, against a password
prompt and a download they have to find in Finder. Tell them what the prompt is for.

If that fails, fall back to `open https://nodejs.org/en/download` and talk them through the
installer, which does need their Mac password.

**Python, without a password**, same idea — `uv` installs both itself and Python into the
home folder:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**Git is the awkward one.** There is no clean no-password route:

- `xcode-select --install` opens a system dialog. Simplest, and it is what most guides use.
- GitHub Desktop bundles its own git, but inside the app bundle and not on `PATH`, so it
  does **not** give Claude a usable `git` on its own. Do not assume it does.

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

## What this turns on

**Auto mode**, which is Anthropic's own feature for this, not something invented here.
Instead of matching command names against a list, it judges each action in context. That
matters because a list cannot tell the difference between deleting a file Claude just
created and deleting the user's only copy of something.

Allowed: editing files inside their project, reading and searching, installing what the
project's own manifest asks for, installing a language toolchain the project needs, and
pushing to a branch they are working on.

Stopped: deleting files that existed before the session, wandering outside the project into
their home folder or other repositories, pushing straight to `main`, force pushing, piping
a downloaded script into a shell, and putting credentials anywhere they become public.

It also screens tool output for prompt injection, which no allow list can do.

Show them `claude auto-mode defaults` if they want the full list. It is long, and that is
the point: it encodes judgement that a course cannot teach in an afternoon.

**Plus a small deny list** for the few things worth stopping unconditionally: `rm`, `sudo`,
`ssh`, `scp`, `chmod`, `chown`, `dd`, `diskutil`.

## Be straight about the trade

This is a real grant of access. Say so in a sentence: Claude can now change files in their
project and push to a branch without asking first, which is what makes it useful and is
also a genuine handover. Anything irreversible still stops.

**Set up git before turning this on, not after.** Git is the undo button that makes the
whole arrangement reasonable — a mistake inside a repository is recoverable, the same
mistake outside one is not. If they only ever install one thing, install git.

## Requires a recent Claude Code

Auto mode is newer than the permission system it sits on. If `--permission-mode auto` is
not accepted, their Claude Code is too old: tell them to update, and until then fall back
to `acceptEdits`, which stops the per-edit prompts but has none of the judgement.

## Afterwards

Tell them what changed, that their previous settings were backed up, and that they can
undo it by deleting `~/.claude/settings.json`. Then get out of the way.
