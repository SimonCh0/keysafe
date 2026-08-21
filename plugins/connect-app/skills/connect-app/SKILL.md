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

### 2. Walk them through getting the key

Tell them exactly where to click: "Monday.com → your avatar → Developers → My access
tokens". Mention gotchas — DataForSEO's API credentials differ from the dashboard login;
ClickUp tokens now expire after 90 days and need 2FA.

Where the provider offers a scoped or read-only key, tell them to use it. That is the
single biggest reduction in blast radius available, and it is usually one checkbox.

### 3. Run the tool with a spec

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

### 4. Afterwards

- **MCP routes:** tell them to restart Claude Code, then `/mcp` shows the server. A bad
  key shows as `failed` with the HTTP status.
- **`.env` route:** write code that reads `process.env.X` / `os.environ["X"]`.
  **Never** `cat` the `.env` or open it with a file tool. You do not need the value —
  the runtime substitutes it when the code runs.

Re-running simply overwrites, so fixing a wrong key is just running it again.

## Spec reference

| Field | Meaning |
|---|---|
| `service` | Display name, shown to the user |
| `route` | `mcp-stdio` \| `mcp-http` \| `env` |
| `id` | Server key in the config. MCP routes only. Letters, numbers, `-`, `_` |
| `command`, `args` | `mcp-stdio` only. `npx` is shimmed to `cmd /c npx` on Windows |
| `url`, `header`, `headerFormat` | `mcp-http` only. `{FIELD_NAME}` is substituted into **both** url and header, so a self-hosted endpoint can be user-supplied |
| `fields[]` | `name`, `label`, `secret`, `hint`, `where`, `multiline` |
| `revoke` | Link shown on the confirmation screen |
| `note` | Shown before they paste. Use for warnings and gotchas |

**Multi-part credentials** are just multiple fields. Mark only the genuinely secret ones
`"secret": true` — a username, workspace ID or region should stay visible so the user can
check it.

**`"multiline": true`** for credentials that genuinely span lines (PEM private keys,
service-account JSON). These automatically use a browser textarea, since an OS dialog is
single-line.

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

| Route | Destination | In git? |
|---|---|---|
| `mcp-stdio`, `mcp-http` | `~/.claude.json` — home folder, outside the project | No |
| `env` | `.env` in the project | No, gitignored automatically |
