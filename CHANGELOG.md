# Changelog

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
