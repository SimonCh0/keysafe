# Changelog

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
