---
name: setup
description: Set up this computer so Claude can do more than edit text — install Node, Git and Python if missing, and grant permission to act without asking before every step. Works on Mac and Windows. Use when someone is on a new computer, when Claude says it cannot do something or a command is not found, when Claude keeps asking permission for everything, when a project will not start, or when someone asks how to get set up.
---

# Setting up a new computer

The person running this is probably not technical. They may not know what a terminal is,
what Node is, or whether they have it. **Do not ask them to run commands, choose between
tools, or make decisions about versions.** Do it, and say what is happening in plain words.

Work out which platform you are on first. Everything below has a Mac path and a Windows
path; never ask them which they are using if you can detect it.

---

## Step 1 — See what is missing

**Mac or Linux**

```bash
sh "${CLAUDE_PLUGIN_ROOT}/bootstrap.sh"
```

**Windows**

```bash
powershell -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/bootstrap.ps1"
```

This only looks. Read the result back in one sentence.

**Do not check by running `node --version` or `git --version` yourself.** On a Mac with
nothing installed, `git` and `python3` exist as stubs that pop Apple's installer the moment
they run, which is alarming when nobody expected it. The script asks `xcode-select`
instead, which triggers nothing.

---

## Step 2 — Install what is missing

Tell them what is about to happen, in two sentences, before you run anything:

- **Node and Python install into their own folder and need no password.**
- **Git on a Mac opens a grey box from Apple.** They click Install and wait a few minutes.
  Say clearly that it is macOS asking, not Claude.

Then:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/bootstrap.sh" --install
```

```bash
powershell -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/bootstrap.ps1" -Install
```

If the Apple dialog appears, wait for them to say it has finished before continuing. Do not
carry on talking over a dialog they are still reading.

---

## Step 3 — Give Claude permission to work

No terminal and nothing installed needed for this: it is a settings file you edit yourself.

Read `~/.claude/settings.json` if it exists, then write it back with these added, **keeping
everything already in it**:

```json
{
  "permissions": {
    "defaultMode": "auto",
    "deny": [
      "Bash(rm *)", "Bash(rmdir *)", "Bash(sudo *)",
      "Bash(chmod *)", "Bash(chown *)",
      "Bash(ssh *)", "Bash(scp *)",
      "Bash(dd *)", "Bash(mkfs*)", "Bash(diskutil *)"
    ]
  }
}
```

Merge, never replace. If the file is not valid JSON, stop and say so rather than
overwriting it. If it does not exist, create it.

---

## Step 4 — They restart Claude

**Not optional, and say why:** a session already running cannot see a tool installed a
minute ago, and the new permissions do not apply until it restarts. Without this it looks
like nothing worked, and they will believe it.

After they restart, run step 1 again and tell them what it says. That is the proof it
worked, and it is worth showing them.

---

## What just changed

**Installed:** Node, so Claude can run what it builds. Git, so work can be saved and
mistakes undone. Python, if the work needs it.

**Permissions:** auto mode. Rather than matching command names against a list, Claude now
judges each action. It gets on with editing files in their project, reading, installing
what a project asks for, and pushing to a branch it is working on. It still stops at
deleting files it did not create, going outside the project, pushing to `main`, piping a
downloaded script into a shell, and anything that would expose credentials.

`claude auto-mode defaults` prints the full list if they ever want it.

**Say the trade in one sentence:** Claude can now change files and install things without
asking first, which is what makes it useful and is a real handover of control. Anything
irreversible still stops.

---

## Things that go wrong

**"It still says the command is not found."** They did not restart, or the restart did not
take. Check with step 1.

**Node installed but Claude cannot see it.** Same cause. `fnm` adds itself to their shell
profile, which a running session has not read.

**They are worried about what they just agreed to.** Tell them it can all be undone by
deleting `~/.claude/settings.json`, and that everything dangerous still asks.

---

## What this does not cover

**Pushing to GitHub needs an account and credentials on the machine, which this does not
set up.** Git being installed is not the same as being able to push. If they try and it
fails asking for a username or password, that is why, and it is a separate job.
