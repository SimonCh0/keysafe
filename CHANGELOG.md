# Changelog

## 1.7.0

**One index shape, so the same app cannot appear twice.**

Real use surfaced this: when a key already exists the tool never runs, so Claude writes
`connected-apps.json` itself — and invented a different shape. The next tool save would
have added a second entry for the same app under a different key.

- The schema is now documented in the skill, and the tool writes exactly that shape
- Entries are keyed on a lowercase slug, so `Notion` and `notion` are one entry
- A differently-cased existing entry is merged, keeping extras Claude added such as
  `client` and `note`, rather than being overwritten
- When an existing key uses a non-canonical variable name, the skill keeps it rather than
  breaking working code, but says that adding the MCP server later will not find it

## 1.6.0

**Your other sessions can now find what you connected.**

An MCP server works in every folder. A `.env` key does not — it belongs to one project and
is invisible from anywhere else, which is how the same credential ends up stored twice
under two names.

- Every save is recorded in `~/.claude/connected-apps.json`: service, variable names, and
  location. **Never values.** A later session in any folder reads it and reuses the
  existing key instead of collecting another copy
- The skill checks that file first and says so if an app is already connected
- **It no longer asks where to save.** Someone connecting their first app has no basis to
  answer. It decides — an existing keys file, else an existing `.env`, else the current
  project — and states the result in one line

## 1.5.0

**The `.env` route no longer guesses which folder you meant.**

It wrote to whatever folder the session happened to be in. That is right for someone with
one project and wrong for anyone with several — a key in `projectA/.env` is invisible to
code in `projectB`, so the same credential ends up stored twice under different names.

- New optional spec field `"path"`: name the `.env` to write. A folder gets `.env`
  appended. Still defaults to the current folder when omitted
- `.gitignore` is now created **beside the target file**, not in the current folder
- The confirmation reports the real destination, not a generic "this project"
- A missing folder is reported in plain language instead of a raw filesystem error
- The bare-folder guard still applies to an explicitly named path

The skill now looks for where your keys already live, states where it is about to write,
and lets you redirect it before anything is saved.

## 1.4.0

Skill guidance only; the tool is unchanged.

Two real runs connected Notion two different ways — one via the official MCP server as
`NOTION_TOKEN`, one via the REST API as `NOTION_API_KEY`. Both worked, but the same
credential under two names means neither tool finds the other's copy.

- Use the canonical variable name the official SDK or MCP server expects, even when
  storing to `.env`
- When an MCP server exists but the task only needs a script, store the key *and* mention
  the connection option in one line, rather than silently picking one
- New step: prove the key works. A single authenticated call with `$VAR` expanded by the
  shell, so the value never reaches the model. Distinguish "auth failed" from "auth fine,
  nothing shared yet", which is the normal first state for a Notion integration

## 1.3.0

**Fixed: nothing could hang forever any more.**

Neither entry path had a timeout. If a student closed the browser tab, never opened it, or
walked away from the dialog, the process ran indefinitely and whatever launched it waited
indefinitely too.

- The browser now gives up after ten minutes with a message saying to run it again
- The OS dialog does the same. On macOS, AppleScript's own "giving up" is treated as a
  timeout rather than an empty box, so it fails once instead of re-asking three times
- Windows and Linux dialogs get a hard child-process timeout as a backstop
- Override with `KEYSAFE_TIMEOUT_MS` if ten minutes is wrong for you

Verified that a normal OK still saves: AppleScript reports `gave up:false` on a real
click, which the timeout check correctly ignores.

## 1.2.0

**Fixed: a save failure in native mode silently reopened a browser instead of saying
what was wrong.** Any rejected value — a bad key, a bad destination — fell through to the
browser fallback and re-asked, hiding the reason. Dialog failures still fall back; value
failures now report plainly.

**Added: the `.env` route refuses to write into Desktop, Documents, Downloads or your
home folder.** A `.env` belongs inside a project. Running from the Desktop used to scatter
`.env` and `.gitignore` there and put the key somewhere nothing would read it. MCP routes
are unaffected, since they always write to `~/.claude.json`.

## 1.1.0

**Fixed: connections were only working in the folder you were standing in.**

Installing an MCP server wrote it under the current project path, so "connect my Notion"
from your Desktop meant Notion existed only on your Desktop. It now defaults to user
scope, which applies everywhere.

- New optional spec field `"scope": "user"` (default) or `"project"`
- The confirmation screen now states which one applied, so a server missing from another
  folder later is not a mystery
- `SKILL.md` documents the field, the default, and when to override it

Found by an end-to-end test rather than the test suite, which shared the same assumption.

## 1.0.0

First release.
