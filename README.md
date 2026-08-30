# KeySafe

Connect any app to Claude without your API key ever entering the chat.

## Install

Type these two lines into Claude Code, one at a time. They start with a slash, which means
Claude Code runs them itself — nothing to approve, and no GitHub account needed.

```
/plugin marketplace add https://github.com/SimonCh0/keysafe
```

```
/plugin install connect-app@keysafe
```

Restart Claude Code.

**If this is a new machine**, one more line gets you to a working baseline. A fresh
Claude Code install has approved nothing, so it stops and asks before every command:

```
/connect-app:setup
```

It shows you exactly what it will allow before changing anything, keeps whatever you have
already approved, and deliberately leaves deleting, `sudo`, network access and publishing
still asking. Restart again afterwards.

Then just ask, in plain English:

> connect my Resend account

Claude works out what the service needs, walks you through getting the key, and opens a
small window on your own computer where you paste it. The key goes straight to where it
belongs. It never appears in the chat.

> Two details that matter on a fresh machine:
>
> **Type the slash commands yourself.** Asking Claude to run the installer for you does
> not work, even with permissions relaxed.
>
> **Use the full `https://` address.** The `owner/repo` shorthand tries SSH first, which
> fails without a GitHub SSH key. It does then retry over HTTPS and succeed, so the
> shorthand is not broken — it just prints an alarming failure line on the way.

## Why

Pasting an API key into a chat puts it in the transcript permanently, and Claude will
usually tell you it is compromised, which is alarming and unhelpful after the fact.

This makes the safe path the easy path.

## Where keys go

| Situation | Destination | Can it be committed to git? |
|---|---|---|
| The service has an OAuth connector | Nowhere — no key needed | n/a |
| Local MCP server | `~/.claude.json`, your home folder | No |
| Remote MCP server | `~/.claude.json`, your home folder | No |
| No MCP server | `.env`, gitignored automatically | No |

## What it handles

Multi-part credentials (login + password, client ID + secret), masking only the parts that
are actually secret. Multi-line keys such as PEM private keys. Self-hosted endpoints.

It quietly fixes the usual paste accidents — smart quotes copied from documentation, a
`NAME=value` assignment, a `Bearer ` prefix, invisible characters from web pages — and
refuses, in plain language, when something looks like more than just the key.

## Known limits

**The read-back block is written but its enforcement is unverified.** On the `.env` route
the tool adds `Read(./.env)` deny rules to the project's `.claude/settings.json`. Whether
Claude Code always honours those is not something this project has been able to test, and
there are open reports suggesting it may not be reliable. Treat it as one layer, not a
guarantee, and don't let it change how you'd otherwise handle a key.

Keys are stored in plain files (`600`, outside git), not in the OS keychain. That matches
the threat this tool addresses — accidental disclosure through a transcript or a commit —
and not local disk compromise.

## Trust

Zero dependencies. No network access of any kind: the tool cannot send your key anywhere
even in principle. The window runs on `127.0.0.1`, gated by a single-use token, and shuts
down as soon as you are done. Your key is never printed, logged, or passed as a command
argument, and Claude never sees the value.

Prefer not to use a browser at all? It uses your operating system's own dialog by default,
so no browser extension can read the field. The browser is only a fallback.

## Development

```bash
./run-audits.sh
```

Four rounds, 118 assertions: behaviour and security, credential shape coverage, `.env`
round-trip through both parsers, and messy human input. CI runs them on macOS, Windows
and Linux.
