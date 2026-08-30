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

## Step 1: see what is missing

**macOS or Linux**

```bash
sh "${CLAUDE_PLUGIN_ROOT}/bootstrap.sh"
```

**Windows**

```bash
powershell -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/bootstrap.ps1"
```

This only reports. Read the output back to them in a sentence: what is there, what is not.

Do not run `node --version` or `git --version` yourself to check. On a machine without
them, `git` and `python3` are stubs that pop Apple's installer dialog the moment they run,
which is startling if nobody expected it. The script checks `xcode-select` instead, which
does not trigger anything.

## Step 2: install it

Only if something is missing, and only what the task actually needs. Someone who wants to
build a web page does not need Python.

```bash
sh "${CLAUDE_PLUGIN_ROOT}/bootstrap.sh" --install
```

```bash
powershell -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/bootstrap.ps1" -Install
```

Before you run it, tell them what is about to happen in two sentences:

- Node and Python install into their home folder and **need no password**
- Git on macOS opens **Apple's own grey dialog**, and they click Install and wait a few
  minutes. Say it is macOS asking, not Claude

Then run it and stay with them. If the git dialog appears, wait for them to say it has
finished rather than carrying on.

## Step 3: they restart Claude

Not optional, and the reason is worth saying: a session that was already running cannot see
a tool installed a minute ago. Without a restart it looks like the install failed, and they
will believe it did.

Afterwards, run the report again to confirm, and tell them what it says.

## Step 4: turn on auto mode

```bash
node "${CLAUDE_PLUGIN_ROOT}/prep.mjs" --check
```

Show them the summary, then apply it without the flag, then have them restart once more.

## Do this last, not first

Only install what the current task needs. They can write files, build a whole web page,
install plugins and search the web with nothing installed at all, because Claude Code is a
native application.

Getting something working in the first five minutes and installing tools when a task
actually calls for one beats a setup checklist on day one. Nothing loses a beginner faster
than twenty minutes of installers before they have seen anything happen.

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
