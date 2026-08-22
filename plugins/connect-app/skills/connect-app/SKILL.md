---
name: connect-app
description: Connect any external app or service (Monday.com, Resend, Stripe, Notion, Cal.com, ClickUp, DataForSEO, any API) so Claude can use it, without the user pasting their API key into the chat. Use whenever the user wants to connect, hook up, integrate, or link a service, or says they have an API key, or asks where to put an API key, or pastes something that looks like a credential. Also use when a task needs a service that is not connected yet.
---

# Connecting an app to Claude, safely

## The rule

**Never accept an API key in the chat.** Once pasted, it is in the transcript forever.
Do not ask the user to paste one, and do not offer to write it into a file for them.

You work out *what* the service needs and *where* it goes. The tool collects the value.
You never see it.

## The flow

### 1. Work out how the service connects

Check, in this order:

1. **Is there an OAuth connector?** Best outcome, because there is no key to leak. Tell
   them to add it as a connector and approve the sign-in. **Stop here.** (Cal.com is one:
   `https://mcp.cal.com/mcp`, OAuth, no key at all.)
2. **Is there an official MCP server?** Search for it. Note whether it is local (`npx …`)
   or remote (a URL), and exactly which env vars or headers it wants.
3. **Neither?** The key goes in `.env` and you write code that reads it.

**Do not guess the variable names.** Check the provider's docs *and* the npm package
itself. This matters more than it sounds:

- ClickUp: one popular setup guide names a package that does not exist on npm
- Three real ClickUp MCP packages exist and disagree — one wants `CLICKUP_API_TOKEN`,
  two want `CLICKUP_API_KEY` plus `CLICKUP_TEAM_ID`
- A wrong name fails later as a confusing 401 that the user cannot debug

`npm view <package> readme` is a fast way to confirm the real variable names.

**Use the canonical variable name even on the `.env` route.** If the service has an
official MCP server or SDK, name the variable what *that* expects — `NOTION_TOKEN`, not
`NOTION_API_KEY`. Otherwise the user ends up with two copies of the same credential under
different names the first time they add the MCP server, and neither tool finds the other's.

**If an MCP server exists but the task only needs a script, say so.** Store the key for the
script, and tell them in one line that a ready-made Notion connection also exists if they
later want Claude to read their pages directly. Do not silently pick one and hide the other.

### 2. Walk them through getting the key

**Never tell them to delete the old key before the new one is proven.** If they are
rotating a credential, the order is: generate the new one, save it, verify it with a live
call, and only then revoke the old one. Reversed, a failure leaves them with nothing
working and no way back — and the cause is often not the key at all, so the old one was
fine.


Tell them exactly where to click: "Monday.com → your avatar → Developers → My access
tokens". Mention gotchas — DataForSEO's API credentials differ from the dashboard login;
ClickUp tokens now expire after 90 days and need 2FA.

Where the provider offers a scoped or read-only key, tell them to use it. That is the
single biggest reduction in blast radius available, and it is usually one checkbox.

### 3. First, check whether it is already connected

Before setting anything up, read `~/.claude/connected-apps.json` if it exists. It records
which apps are already connected, the variable names used, and where each one lives. It
contains **no values**, only names and paths.

If the service is already there, say so, verify the existing key still works, and use it.
Do not collect a second copy — that is the main way this gets messy.

**If you write to this file yourself** — which happens when a key already existed so the
tool never ran — use exactly this shape. A different key or different field names produces
two entries for the same app, which defeats the point:

```json
{
  "version": 1,
  "apps": {
    "notion": {
      "service": "Notion",
      "route": "env",
      "path": "/Users/you/project/.env",
      "fields": ["NOTION_TOKEN"],
      "revoke": "https://www.notion.so/profile/integrations",
      "verified": "2026-08-22"
    }
  }
}
```

The key is a lowercase slug of the service. `client` and `note` are optional extras and
are preserved. **Never put a value in this file.**

**If the existing variable name is not the canonical one** — say `NOTION_API_KEY` where the
official MCP server wants `NOTION_TOKEN` — keep using the existing name rather than
breaking working code, but tell them in one line that adding the MCP server later will not
find it under that name.

### 4. For the `.env` route, decide the location and state it

**Do not ask the user where to put it.** Someone connecting their first app has no basis
to answer, and the question just makes them anxious. Decide, then tell them in one line.

Decide in this order:

1. A file `~/.claude/connected-apps.json` already points at for this user's other keys
2. A `.env` that already exists in the current project
3. The current project folder

Then state it plainly: *"Saved to your project's `.env` file."* Only ask when there is a
genuine conflict, such as two existing key files and no way to tell which is current.

Pass the chosen location as `"path"` in the spec.

MCP routes need none of this — they go to `~/.claude.json` and work in every folder.

### 5. Run the tool with a spec

Pipe a JSON spec on stdin. The tool knows nothing about any service — you supply all of it.

```bash
echo '{
  "service": "Monday.com",
  "route": "mcp-stdio",
  "id": "monday",
  "command": "npx",
  "args": ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
  "fields": [
    { "name": "MONDAY_TOKEN", "label": "Monday.com API token", "secret": true,
      "hint": "Must be a Personal V2 API token",
      "where": "https://monday.com/developers/v2" }
  ],
  "revoke": "https://monday.com/developers/v2",
  "note": "Use a token from an account that only sees the boards Claude should see."
}' | node "${CLAUDE_PLUGIN_ROOT}/connect.mjs"
```

Run it from the user's project directory. A small OS dialog opens, they paste, it exits.

**Never** put a key in the spec, in a command argument, or anywhere else you can see.

### 6. Afterwards

- **MCP routes:** tell them to restart Claude Code, then `/mcp` shows the server. A bad
  key shows as `failed` with the HTTP status. Tell them whether it applies everywhere
  (the default) or only to this folder, so a missing server later is not a mystery.
- **`.env` route:** write code that reads `process.env.X` / `os.environ["X"]`.
  **Never** `cat` the `.env` or open it with a file tool. You do not need the value —
  the runtime substitutes it when the code runs.

Re-running simply overwrites, so fixing a wrong key is just running it again.

### 7. Prove it works

Do not stop at "saved". Check it, and tell them the result in plain language.

- **`.env` route:** make one cheap authenticated call, letting the *shell* substitute the
  value so it never reaches you:

  ```bash
  curl -s -o /dev/null -w '%{http_code}' https://api.notion.com/v1/users/me \
    -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28"
  ```

  `$VAR` is expanded by the shell at run time. Never echo the variable, never paste the
  value into a command, and never print the response body if it might contain the key.
- **MCP routes:** `/mcp` after a restart. `failed` with a 401 means the key; anything else
  usually means a setup step the provider still needs.

**A failure here is often not the key.** IP allowlists, unverified domains, plan gating and
unshared resources all produce authentication errors that a new key will not fix. Say what
the response actually indicates before suggesting they generate another one. Rotating a
credential to chase an error that was never about the credential costs them a working key.

A 200 that returns nothing is often *not* a failure — Notion integrations start with
access to no pages until the user shares one. Say which of the two it is, so they are not
left thinking the key is broken.

## Spec reference

| Field | Meaning |
|---|---|
| `service` | Display name, shown to the user |
| `route` | `mcp-stdio` \| `mcp-http` \| `env` |
| `id` | Server key in the config. MCP routes only. Letters, numbers, `-`, `_` |
| `scope` | `user` (default) or `project`. MCP routes only. See below |
| `command`, `args` | `mcp-stdio` only. `npx` is shimmed to `cmd /c npx` on Windows |
| `url`, `header`, `headerFormat` | `mcp-http` only. `{FIELD_NAME}` is substituted into **both** url and header, so a self-hosted endpoint can be user-supplied |
| `path` | `env` route only. Which `.env` to write. A folder gets `.env` appended. Defaults to the current folder |
| `fields[]` | `name`, `label`, `secret`, `hint`, `where`, `multiline` |
| `revoke` | Link shown on the confirmation screen |
| `note` | Shown before they paste. Use for warnings and gotchas |

**Multi-part credentials** are just multiple fields. Mark only the genuinely secret ones
`"secret": true` — a username, workspace ID or region should stay visible so the user can
check it.

**`"multiline": true`** for credentials that genuinely span lines (PEM private keys,
service-account JSON). These automatically use a browser textarea, since an OS dialog is
single-line.

**Scope.** Leave `scope` unset for almost everything. The default, `user`, makes the
connection work in every folder — which is what someone means when they say "connect my
Notion". Only set `"scope": "project"` when the credential genuinely belongs to one
codebase, such as a staging key for a specific app, and say so out loud when you do.

Run with **no spec at all** for a generic "name it and paste it" form that writes to `.env`.

## What the tool already handles, so you do not need to warn about it

It silently fixes: surrounding quotes (including smart quotes from documentation), a
pasted `NAME=value` assignment, a `Bearer ` prefix, zero-width characters from web copies,
and stray whitespace.

It refuses, with a plain-language reason: an empty value, a multi-line paste into a
single-line field, and a secret containing a space (which nearly always means they copied
a label like `API Key: sk_123`).

Nothing a user can type corrupts their existing config — worst case it stores a wrong
value, and re-running fixes it.

## If the user has already pasted a key in chat

Don't lecture them. Say this:

> That key is in our chat history now, so treat it as used up. Delete it at
> `<provider key page>` and make a new one, and I'll set the new one up so it never
> touches the chat. Takes about 30 seconds.

Then run the tool. Staying calm matters. A revoked key is a non-event.

## Where things end up

| Route | Destination | Applies to | In git? |
|---|---|---|---|
| `mcp-stdio`, `mcp-http` | `~/.claude.json`, top-level `mcpServers` | every folder (default) | No |
| same, with `"scope": "project"` | `~/.claude.json`, under that project path | that folder only | No |
| `env` | `.env` in the project | that project | No, gitignored automatically |

Either way the credential lands in your home folder or a gitignored file, never somewhere
it can be committed.

Every save is also recorded in `~/.claude/connected-apps.json` — service, variable names
and location, never values — so a later session in a different folder can find an existing
key instead of collecting a second copy of it.
