---
name: permissions
description: Stop Claude asking permission before every action, by turning on auto mode and setting sensible rules. Use when someone says Claude keeps interrupting to ask, that it will not do things without approval, that it says it cannot do something, or when they want Claude to work on their behalf without babysitting every step. Also use after installing the foundations on a new machine.
---

# Letting Claude act without asking every time

## What this actually is

Permissions are not instructions. A `CLAUDE.md` file tells Claude how to behave; it cannot
grant permission to do anything. That is why "I can't actually do that" is never fixed by
writing a better instruction file. Say this once, in a sentence, and move on.

**This needs no terminal and no tools installed.** It is a settings file you edit directly.

## Do it

Read `~/.claude/settings.json` if it exists. Then write it back with these changes, keeping
everything already there:

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

**Merge, never replace.** If they already have `allow` or `deny` entries, keep them and add
to them. If the file does not exist, create it with just the above. If it is not valid JSON,
stop and say so rather than overwriting it.

Then tell them to quit Claude and open it again.

## What auto mode does

It is Anthropic's own feature, not something invented here. Rather than matching command
names against a list, it judges each action in context. A list cannot tell the difference
between deleting a file Claude just made and deleting someone's only copy of something.

**Allowed:** editing files inside their project, reading and searching, installing what the
project's own manifest asks for, installing a language toolchain the project needs, and
pushing to a branch they are working on.

**Stopped:** deleting files that existed before the session, wandering out of the project
into their home folder or other repositories, pushing straight to `main`, force pushing,
piping a downloaded script into a shell, and putting credentials anywhere public.

It also screens tool output for prompt injection, which no list of allowed commands can do.

`claude auto-mode defaults` prints the full set if they want to read it.

The extra `deny` entries above are the few things worth refusing outright, whatever else is
allowed. Deny always wins.

## Say what the trade is

One sentence, not a lecture: Claude can now change files in their project and push to a
branch without asking first, which is what makes it useful, and is a real handover of
control. Anything irreversible still stops and asks.

**Git matters more than these settings.** A mistake inside a git repository can be undone;
the same mistake outside one cannot. If they have not set up git yet, say that this is more
comfortable once they have, and point them at `/claude-prep:foundations`.

## If auto mode is not recognised

Their Claude Code is too old. Tell them to update. Until then use `"defaultMode": "acceptEdits"`,
which stops the prompt before every file edit but has none of the judgement.

## Afterwards

Tell them what changed and that they can undo all of it by deleting
`~/.claude/settings.json`. Then get out of the way and let them work.
