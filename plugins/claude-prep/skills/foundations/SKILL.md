---
name: foundations
description: Install the tools Claude needs to do more than edit text — Node, Git and Python — on a computer that has none of them. Use when Claude cannot run something because a tool is missing, when someone is on a brand new computer, when a command fails with "command not found", when a project will not start, or when someone asks what they need to install. Handles macOS and Windows, and requires no terminal knowledge from the user.
---

# Installing the foundations

The person running this is probably not technical. They may not know what a terminal is,
or what Node is, or whether they have it. **Do not ask them to run commands or make
choices about tooling.** Do it, and tell them what is happening in plain words.

Claude Code is a native application and needs none of this to edit files, build a web page,
install plugins or search the web. These tools are for *running* what gets built, *saving*
it, and connecting things to it.

The person running this is probably not technical. They may not know what a terminal is,
what npm is, or whether they have it. **Do not ask them to run commands, install things by
hand, or make judgement calls about tooling.** Do it, then tell them what you did.

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

## Do this last, not first

Only install what the current task needs. They can write files, build a whole web page,
install plugins and search the web with nothing installed at all, because Claude Code is a
native application.

Getting something working in the first five minutes and installing tools when a task
actually calls for one beats a setup checklist on day one. Nothing loses a beginner faster
than twenty minutes of installers before they have seen anything happen.

## After the tools are in

Setting up permissions is a separate step, and it is the one that stops Claude asking
before every action. Point them at it once the tools are working:

```
/claude-prep:permissions
```

Do not do both in one go. Installing tools already involves a restart and a dialog; adding
a permissions conversation on top is more than anyone can follow at once.
