#!/usr/bin/env node
/**
 * KeySafe — collect credentials without them passing through the chat.
 *
 * Claude works out WHAT a service needs and WHERE it goes, then hands this tool a
 * spec on stdin. This tool has no knowledge of any service: it renders the fields
 * it is given, collects the values, and writes them where it is told.
 *
 *   echo '<spec json>' | node connect.mjs
 *   node connect.mjs            # generic mode, asks for one name/value pair
 *
 * Zero dependencies. Nothing here can reach the network.
 *
 * SPEC
 * ────
 * {
 *   "service":  "Monday.com",              // display name
 *   "route":    "mcp-stdio" | "mcp-http" | "env",
 *   "id":       "monday",                  // server key, mcp routes only
 *   "command":  "npx", "args": [...],      // mcp-stdio
 *   "url":      "https://…",               // mcp-http
 *   "header":   "Authorization",           // mcp-http
 *   "headerFormat": "Bearer {MONDAY_TOKEN}",  // {NAME} substituted from fields
 *   "fields": [
 *     { "name":"MONDAY_TOKEN", "label":"API token", "secret":true,
 *       "hint":"Admin → API", "where":"https://…" }
 *   ],
 *   "revoke": "https://…",
 *   "note":   "shown to the user before they paste"
 * }
 *
 * PRIME DIRECTIVE: a secret value is never printed, logged, echoed, or put on a
 * command line. It goes from the browser field to its destination and nowhere else.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, copyFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLAUDE_JSON = join(homedir(), '.claude.json');
const PROJECT = process.cwd();
const TOKEN = randomBytes(24).toString('hex');
const ROUTES = new Set(['mcp-stdio', 'mcp-http', 'env']);

// ─── spec ────────────────────────────────────────────────────────────────────

const GENERIC = {
  service: 'an API key',
  route: 'env',
  fields: [{ name: '', label: 'Name for this key', secret: false, editable: true, hint: 'e.g. MONDAY_TOKEN' },
           { name: '__value', label: 'The key itself', secret: true }],
  generic: true,
};

function readStdinSpec() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return null; }
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

/** Reject a malformed spec loudly, before a user pastes anything into it. */
function validateSpec(s) {
  if (!s || typeof s !== 'object') throw new Error('spec must be a JSON object');
  if (!ROUTES.has(s.route)) throw new Error(`route must be one of: ${[...ROUTES].join(', ')}`);
  if (!Array.isArray(s.fields) || !s.fields.length) throw new Error('spec needs at least one field');
  for (const f of s.fields) {
    if (!f.editable && !VALID_NAME.test(f.name || '')) {
      throw new Error(`field name "${f.name}" must be letters, numbers and underscores`);
    }
  }
  const names = s.fields.filter((f) => !f.editable).map((f) => f.name);
  if (new Set(names).size !== names.length) throw new Error('spec has duplicate field names');
  for (const n of names) {
    if (UNSAFE_NAMES.has(n)) throw new Error(`field name "${n}" is reserved`);
  }
  if (s.route === 'mcp-stdio' && !s.command) throw new Error('mcp-stdio needs a command');
  if (s.route === 'mcp-http' && !s.url) throw new Error('mcp-http needs a url');
  if (s.route !== 'env' && !s.id) throw new Error('mcp routes need an id');
  if (s.route !== 'env' && (!/^[A-Za-z0-9_-]+$/.test(s.id) || UNSAFE_NAMES.has(s.id))) {
    throw new Error('server id must be letters, numbers, dashes or underscores');
  }
  if (s.header && /[\r\n:]/.test(s.header)) throw new Error('header name is malformed');
  return s;
}

// ─── validation of user input ────────────────────────────────────────────────

/**
 * A value containing a newline is the dangerous case: `KEY=abc\nOTHER=evil` written
 * into a .env silently overwrites an existing variable and injects new ones. Trailing
 * newlines are extremely common when copying a key, so this is a realistic accident.
 *
 * Errors name the FIELD, never the VALUE.
 */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names that break a plain object: assigning __proto__ sets the prototype and
 *  the value silently disappears. Reachable in generic mode, where the user types
 *  the name themselves. */
const UNSAFE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Undo the copy-and-paste accidents a non-technical person actually makes.
 * Every rule here fixes something that is never legitimately part of a credential,
 * so tidying is safe and silent. Anything ambiguous is refused instead, because a
 * silently-wrong key fails later as a confusing 401, while a refusal costs 5 seconds.
 */
function tidy(value, isSecret) {
  let v = String(value);

  // Invisible characters picked up from web pages and PDFs.
  v = v.replace(/[\u200B-\u200D\uFEFF]/g, '');   // zero-width
  v = v.replace(/\u00A0/g, ' ');                   // non-breaking space
  v = v.trim();

  // Surrounding quotes copied from documentation, including smart quotes.
  const pairs = [['"', '"'], ["'", "'"], ['\u201C', '\u201D'], ['\u2018', '\u2019']];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of pairs) {
      if (v.length > 1 && v.startsWith(a) && v.endsWith(b)) { v = v.slice(1, -1).trim(); changed = true; }
    }
  }

  // "API_KEY=sk_123" — they copied the whole assignment.
  v = v.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, '');
  // "Bearer sk_123" — the scheme is added by the config, never part of the key.
  v = v.replace(/^Bearer\s+/i, '');
  // Re-strip quotes that were inside the assignment: API_KEY="sk_123"
  for (const [a, b] of pairs) {
    if (v.length > 1 && v.startsWith(a) && v.endsWith(b)) v = v.slice(1, -1).trim();
  }

  return v.trim();
}

function clean(values, multiline = new Set(), secrets = new Set()) {
  const out = Object.create(null);   // no prototype, so no name is special
  for (const [rawName, rawValue] of Object.entries(values)) {
    const name = String(rawName).trim();
    if (UNSAFE_NAMES.has(name)) {
      throw new Error(`"${name}" is a reserved word. Please pick a different name.`);
    }
    if (!VALID_NAME.test(name)) {
      throw new Error(`"${name}" is not a valid name. Use letters, numbers and underscores, starting with a letter.`);
    }
    const isSecret = secrets.has(name);
    const value = multiline.has(name) ? String(rawValue).trim() : tidy(rawValue, isSecret);
    if (!value) throw new Error(`${name} is empty.`);
    // Whitespace inside a secret almost always means they copied a label or a
    // whole sentence, not just the key. Say so rather than storing it and failing later.
    if (value.includes('\0')) throw new Error(`${name} contains an invalid character.`);
    // Newlines are rejected by default, because a stray one silently rewrites a .env.
    // Genuinely multi-line credentials (PEM keys, service-account JSON) opt in.
    // Checked before the whitespace rule so the message names the real problem.
    if (/[\r\n]/.test(value) && !multiline.has(name)) {
      throw new Error(`${name} looks like more than one line. Copy just the key itself, with no extra lines.`);
    }
    // Multi-line credentials (PEM, service-account JSON) are whitespace by nature.
    if (isSecret && !multiline.has(name) && /\s/.test(value)) {
      throw new Error(`${name} has a space in it, so it looks like more than just the key got copied. Copy only the key itself.`);
    }
    out[name] = value;
  }
  if (!Object.keys(out).length) throw new Error('Nothing to save.');
  return { ...out };
}

// ─── file helpers ────────────────────────────────────────────────────────────

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw); // deliberately throws — better to stop than clobber
}

/** writeFileSync's `mode` only applies on create, so chmod explicitly. No-op on Windows. */
function lockDown(path) {
  if (process.platform === 'win32') return;
  try { chmodSync(path, 0o600); } catch {}
}

function writeJsonSafely(path, data) {
  if (existsSync(path)) {
    copyFileSync(path, `${path}.keysafe-backup`);
    lockDown(`${path}.keysafe-backup`);
  }
  const tmp = `${path}.keysafe-tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  lockDown(tmp);
  writeFileSync(path, readFileSync(tmp));
  lockDown(path);
  try { unlinkSync(tmp); } catch {}
}

/** Update one key in .env, preserving comments, order, and existing line endings. */
function upsertEnv(path, key, value) {
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw ? raw.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  // A .env is read by dotenv-style parsers AND sometimes by `source .env`, so the
  // quoting has to satisfy both.
  //   plain        -> bare
  //   has specials -> single quotes, which the shell does NOT expand
  //   has a quote  -> double quotes, escaping everything the shell would expand
  // Double quotes alone are wrong: `KEY="a$b"` expands $b when sourced.
  const safe = /^[A-Za-z0-9_.\-:/@+]*$/.test(value)
    ? value
    : !value.includes("'")
      ? `'${value}'`
      : `"${value.replace(/[\\"$`]/g, (c) => '\\' + c)}"`;

  const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
  if (idx >= 0) {
    // An existing value may be a quoted block spanning several lines (a PEM key).
    // Replace the whole span, otherwise the tail is orphaned into the file.
    let end = idx;
    const opener = lines[idx].slice(lines[idx].indexOf('=') + 1).trim()[0];
    if (opener === "'" || opener === '"') {
      const rest = lines[idx].slice(lines[idx].indexOf('=') + 1).trim().slice(1);
      let closed = rest.endsWith(opener) && rest.length > 0;
      while (!closed && end + 1 < lines.length) {
        end++;
        if (lines[end].endsWith(opener)) closed = true;
      }
    }
    lines.splice(idx, end - idx + 1, `${key}=${safe}`);
  } else {
    lines.push(`${key}=${safe}`);
  }
  writeFileSync(path, lines.join(eol) + eol, { mode: 0o600 });
  lockDown(path);
}

function ensureGitignored(entry) {
  const path = join(PROJECT, '.gitignore');
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  if (lines.some((l) => l.trim() === entry)) return false;
  lines.push(entry, '');
  writeFileSync(path, lines.join('\n'));
  return true;
}

// ─── native OS dialogs (--native) ────────────────────────────────────────────

/**
 * Ask for one value using the operating system's own dialog. No browser, so no
 * browser extension can read the field, and nothing renders a web page at all.
 *
 * The value is captured inside this process and never written to stdout, so it
 * does not reach the calling agent's context.
 *
 * macOS   AppleScript `display dialog … with hidden answer`
 * Windows a WinForms box with UseSystemPasswordChar
 *
 * Trade-off vs the browser: one field per dialog on macOS, and no clickable
 * "where to find it" links. Better for a single secret, worse for a long form.
 */
class CancelledError extends Error {
  constructor() { super('Cancelled — nothing was saved.'); }
}

/** Build the prompt text. Pure, so it can be unit tested. */
export function promptLabel(field, service, step, total, retry) {
  const counter = total > 1 ? `  (step ${step} of ${total})` : '';
  return `${service}${counter}\n\n${field.label}`
    + (field.hint ? `\n${field.hint}` : '')
    + (retry ? `\n\nThis one is still needed.` : '');
}

function promptNative(field, service, step = 1, total = 1, retry = false) {
  const label = promptLabel(field, service, step, total, retry);

  if (process.platform === 'darwin') {
    const script = `display dialog ${q(label)} default answer "" `
      + `${field.secret ? 'with hidden answer ' : ''}`
      + `with title ${q('Add your key safely')} with icon note`;
    let out;
    try {
      out = execFileSync('osascript', ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      // Clicking Cancel exits non-zero. Anything else is a real failure worth showing.
      const msg = String(err.stderr || '');
      // -128 is AppleScript's canonical "user cancelled" code. Match on that
      // rather than the message, which is spelled both "canceled" and
      // "cancelled" depending on system locale.
      if (msg.includes('-128') || /user cancell?ed/i.test(msg)) throw new CancelledError();
      throw new Error(`Could not show the dialog: ${msg.trim() || 'unknown error'}`);
    }
    const m = out.match(/text returned:([\s\S]*?)(?:, gave up:.*)?\s*$/);
    return m ? m[1].trim() : '';
  }

  if (process.platform === 'win32') {
    // A here-string ends at a line that is exactly '@ — so a label containing that
    // at column 0 would break out and the rest would execute as code. Neutralise it.
    const safeLabel = label.replace(/^'@/gm, " '@");
    // -EncodedCommand avoids every layer of PowerShell quoting trouble.
    const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$f = New-Object Windows.Forms.Form
$f.Text = 'Add your key safely'
$f.Size = New-Object Drawing.Size(460,220)
$f.StartPosition = 'CenterScreen'
$f.TopMost = $true
$l = New-Object Windows.Forms.Label
$l.Text = @'
${safeLabel}
'@
$l.SetBounds(12,12,420,90)
$t = New-Object Windows.Forms.TextBox
$t.SetBounds(12,110,420,26)
${field.secret ? '$t.UseSystemPasswordChar = $true' : ''}
$ok = New-Object Windows.Forms.Button
$ok.Text = 'Save'; $ok.SetBounds(340,148,92,28); $ok.DialogResult = 'OK'
$f.AcceptButton = $ok
$f.Controls.AddRange(@($l,$t,$ok))
if ($f.ShowDialog() -eq 'OK') { [Console]::Out.Write($t.Text) } else { exit 1 }`;
    try {
      return execFileSync('powershell', [
        '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(ps, 'utf16le').toString('base64'),
      ], { encoding: 'utf8' }).trim();
    } catch {
      throw new Error('Cancelled.');
    }
  }

  // Linux: zenity is the closest common equivalent.
  try {
    return execFileSync('zenity', [
      '--entry', `--title=Add your key safely`, `--text=${label}`,
      ...(field.secret ? ['--hide-text'] : []),
    ], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('No native dialog available on this system. Run without --native.');
  }
}

/** Show a plain confirmation dialog. Contains no secret, only where it went. */
function notify(message) {
  if (process.platform === 'darwin') {
    execFileSync('osascript', ['-e',
      `display dialog ${q(message)} with title ${q('All set')} buttons {"Done"} default button "Done" with icon note`,
    ], { stdio: 'ignore' });
    return;
  }
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms
[Windows.Forms.MessageBox]::Show(@'
${String(message).replace(/^'@/gm, " '@")}
'@, 'All set') | Out-Null`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(ps, 'utf16le').toString('base64')], { stdio: 'ignore' });
    return;
  }
  execFileSync('zenity', ['--info', `--text=${message}`], { stdio: 'ignore' });
}

/** Quote a string for AppleScript. */
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

// ─── windows quirks ──────────────────────────────────────────────────────────

/**
 * On Windows `npx` is `npx.cmd`, a batch script, so {command:"npx"} fails with ENOENT.
 * This is the most common reason stdio MCP servers break on Windows.
 */
function winCommand(command, args) {
  const shim = process.platform === 'win32'
    && ['npx', 'npm', 'yarn', 'pnpm', 'bunx'].includes(command);
  return shim ? { command: 'cmd', args: ['/c', command, ...args] } : { command, args };
}

function openBrowser(url) {
  const opts = { stdio: 'ignore', detached: true };
  let child;
  if (process.platform === 'win32') {
    // `start` treats a lone quoted arg as a window title, hence the "" placeholder.
    child = spawn('cmd', ['/c', 'start', '""', url], { ...opts, windowsVerbatimArguments: true });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [url], opts);
  } else {
    child = spawn('xdg-open', [url], opts);
  }
  child.on('error', () => {});
  child.unref();
}

// ─── writing ─────────────────────────────────────────────────────────────────

function save(spec, rawValues) {
  let values = rawValues;

  // Fields opt into accepting newlines (PEM keys, service-account JSON).
  const multiline = new Set((spec.fields || []).filter((f) => f.multiline).map((f) => f.name));

  // Generic mode: the user named the variable themselves.
  if (spec.generic) {
    const name = String(rawValues[''] ?? '').trim();
    values = { [name]: rawValues.__value };
  }
  const secrets = new Set((spec.fields || []).filter((f) => f.secret).map((f) => f.name));
  values = clean(values, multiline, secrets);

  if (spec.route === 'env') {
    const envPath = join(PROJECT, '.env');
    for (const [k, v] of Object.entries(values)) upsertEnv(envPath, k, v);
    const added = ensureGitignored('.env');
    return {
      where: `.env in this project`,
      why: added ? 'Added .env to .gitignore so it cannot be committed.' : '.env was already gitignored.',
      next: `Ask Claude to use ${Object.keys(values).join(' and ')} from your .env file.`,
    };
  }

  const cfg = readJson(CLAUDE_JSON, {});
  cfg.projects ??= {};
  cfg.projects[PROJECT] ??= {};
  cfg.projects[PROJECT].mcpServers ??= {};
  if (UNSAFE_NAMES.has(spec.id)) throw new Error('server id is reserved');

  if (spec.route === 'mcp-stdio') {
    cfg.projects[PROJECT].mcpServers[spec.id] = {
      ...winCommand(spec.command, spec.args ?? []),
      env: values,
    };
  } else {
    // {NAME} placeholders are filled from the collected fields. They are allowed in
    // the url as well as the header, so a self-hosted or per-tenant endpoint can be
    // supplied by the user rather than hardcoded in the spec.
    const fill = (t) => String(t).replace(/\{(\w+)\}/g, (m, n) => values[n] ?? m);

    const url = fill(spec.url);
    // The url can now contain user-supplied text, so check it is actually a web
    // address before it is written into the config as something Claude will call.
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('That server address is not a valid URL.'); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('The server address must start with https://');
    }

    const headerValue = fill(spec.headerFormat ?? '{TOKEN}');
    // CRLF in a header value is header injection. Multi-line fields opt out of the
    // newline check, so re-assert it here where it actually matters.
    if (/[\r\n]/.test(headerValue)) {
      throw new Error('That credential cannot be used in a request header because it spans multiple lines.');
    }

    cfg.projects[PROJECT].mcpServers[spec.id] = {
      type: 'http',
      url,
      headers: { [spec.header ?? 'Authorization']: headerValue },
    };
  }

  writeJsonSafely(CLAUDE_JSON, cfg);
  return {
    where: '~/.claude.json',
    why: 'Your home folder, outside this project. It cannot be committed to git by accident.',
    next: `Restart Claude Code, then run /mcp to check "${spec.id}" is connected.`,
  };
}

// ─── ui ──────────────────────────────────────────────────────────────────────

const page = (spec) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Add your key</title><style>
*{box-sizing:border-box}
:root{--bg:#faf9f7;--fg:#1a1a18;--mut:#6b6862;--line:#e3e0da;--card:#fff;--acc:#c96442;--ok:#2d7a4f}
@media(prefers-color-scheme:dark){:root{--bg:#1a1a18;--fg:#f0eee9;--mut:#9a958c;--line:#33322e;--card:#232320;--acc:#e08363;--ok:#5cba85}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:40px 20px}
.w{max-width:520px;margin:0 auto}
h1{font-size:25px;margin:0 0 6px}
.sub{color:var(--mut);margin:0 0 26px}
label{display:block;font-weight:600;margin:20px 0 5px;font-size:14px}
.hint{font-weight:400;color:var(--mut);font-size:13px;margin:0 0 7px}
input{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);font-size:15px;font-family:ui-monospace,SFMono-Regular,monospace}
input:focus-visible,textarea:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
textarea{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);font-size:13px;font-family:ui-monospace,SFMono-Regular,monospace;resize:vertical}
button{width:100%;padding:14px;background:var(--acc);color:#fff;border:0;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;margin-top:26px}
button:disabled{opacity:.5;cursor:default}
button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
a{color:var(--acc)}
.note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--ok);border-radius:8px;padding:14px;font-size:14px;color:var(--mut);margin-top:22px}
.note b{color:var(--fg)}
.big{font-size:42px;margin:0 0 8px}
.err{color:#c0392b;font-size:14px;margin-top:12px;min-height:1em}
</style></head><body><div class="w" id="app"></div>
<script>
const T=${JSON.stringify(TOKEN)}, S=${JSON.stringify(spec)};
const app=document.getElementById('app');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function form(){
  app.innerHTML='<h1>Add your '+esc(S.service)+' key</h1>'
  +'<p class="sub">This page is running on your own computer. It cannot send your key anywhere, and it never goes into the chat.</p>'
  +(S.note?'<div class="note">'+esc(S.note)+'</div>':'')
  +S.fields.map((f,i)=>'<label for="f'+i+'">'+esc(f.label)
      +(f.where?' &middot; <a href="'+esc(f.where)+'" target="_blank" rel="noreferrer">where to find it</a>':'')+'</label>'
      +(f.hint?'<p class="hint">'+esc(f.hint)+'</p>':'')
      +(f.multiline
         ? '<textarea id="f'+i+'" rows="6" autocomplete="off" spellcheck="false" placeholder="paste the whole key, including the BEGIN and END lines"></textarea>'
         : '<input id="f'+i+'" type="'+(f.secret?'password':'text')+'" autocomplete="off" autocapitalize="off"'
           +' spellcheck="false" placeholder="'+(f.secret?'paste here':esc(f.name||''))+'">')).join('')
  +'<button id="go">Save it safely</button><div class="err" id="err"></div>';

  document.getElementById('go').onclick=async e=>{
    const vals={},err=document.getElementById('err');err.textContent='';
    S.fields.forEach((f,i)=>{
      const v=document.getElementById('f'+i).value;
      vals[f.editable?'':f.name]=v;
      if(f.editable)vals['']=v;
    });
    // generic mode sends {'': name, __value: secret}
    if(S.generic){vals['']=document.getElementById('f0').value;vals.__value=document.getElementById('f1').value;}
    if(Object.values(vals).some(v=>!String(v).trim()))return err.textContent='Please fill in every box.';
    e.target.disabled=true;e.target.textContent='Saving…';
    let d;
    try{
      const r=await fetch('/save?t='+T,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(vals)});
      d=await r.json();
    }catch(x){d={ok:false,error:'Could not reach the local helper.'}}
    S.fields.forEach((f,i)=>document.getElementById('f'+i).value='');   // clear from the page
    if(d.ok)return done(d);
    err.textContent=d.error;e.target.disabled=false;e.target.textContent='Save it safely';
  };
  document.getElementById('f0')?.focus();
}

function done(d){
  app.innerHTML='<p class="big">&#9989;</p><h1>'+esc(S.service)+' is set up</h1>'
  +'<p class="sub">Your key went straight to where it is needed. It never appeared in the chat.</p>'
  +'<div class="note"><b>Where it went</b><br>'+esc(d.where)
  +'<br><br><b>Why that is safe</b><br>'+esc(d.why)
  +'<br><br><b>What happens next</b><br>'+esc(d.next)
  +(S.revoke?'<br><br><b>If it ever leaks</b><br>Delete it at <a href="'+esc(S.revoke)+'" target="_blank" rel="noreferrer">'+esc(S.revoke)+'</a> and run this again. Takes 30 seconds.':'')
  +'</div><p class="sub" style="margin-top:24px">You can close this tab.</p>';
}
form();
</script></body></html>`;

// ─── server ──────────────────────────────────────────────────────────────────

let spec;
try {
  spec = validateSpec(readStdinSpec() ?? GENERIC);
} catch (err) {
  console.error(`\n  Bad spec: ${err.message}\n`);
  process.exit(1);
}

let saved = null;

// ─── native mode: no server, no browser, no web page at all ──────────────────

/**
 * Native dialogs are the default: no browser, so no extension can read the field.
 * If the OS dialog cannot run — PowerShell locked down, no zenity, headless, an
 * untested Windows edge case — fall through to the browser, which is plain HTTP
 * and HTML and behaves the same everywhere.
 *
 * An explicit Cancel is a decision, not a failure, so it never falls back.
 */
const needsTextarea = spec.fields.some((f) => f.multiline);
if (needsTextarea && !process.argv.includes('--browser')) {
  console.log('\n  This credential spans multiple lines, which an OS dialog cannot accept.');
  console.log('  Opening a browser window with a proper text box instead.');
}

if (!process.argv.includes('--browser') && !needsTextarea) {
  const values = {};
  const total = spec.fields.length;
  try {
    for (const [i, f] of spec.fields.entries()) {
      // An empty box means "they hit OK too early", not "abort everything".
      // Only an explicit Cancel stops the run.
      let v = '', tries = 0;
      while (!v && tries < 3) {
        v = promptNative(f, spec.service, i + 1, total, tries > 0);
        tries++;
      }
      if (!v) throw new CancelledError();
      values[f.editable ? '' : f.name] = v;
      if (spec.generic && f.editable) values[''] = v;
    }
    if (spec.generic) {
      // generic mode collects {'' : name, __value: secret} in field order
      const [name, secret] = Object.values(values);
      Object.keys(values).forEach((k) => delete values[k]);
      values[''] = name; values.__value = secret;
    }
    const summary = save(spec, values);

    // Confirm in a dialog too, so the user sees it without reading the terminal.
    const done = `${spec.service} is set up.\n\n`
      + `Where it went:\n${summary.where}\n\n`
      + `Why that's safe:\n${summary.why}\n\n`
      + `Next:\n${summary.next}`;
    try { notify(done); } catch { /* confirmation is a nicety, never fatal */ }

    console.log(`\n  ${spec.service} is set up.`);
    console.log(`  Where it went: ${summary.where}`);
    console.log(`  Why that's safe: ${summary.why}`);
    console.log(`  Next: ${summary.next}`);
    console.log(spec.revoke ? `  If it ever leaks, delete it at ${spec.revoke}\n` : '');
    process.exit(0);
  } catch (err) {
    if (err instanceof CancelledError) {
      console.error(`\n  ${err.message}\n`);   // names the problem, never the value
      process.exit(1);
    }
    // The dialog itself could not run. Don't strand the user — use the browser.
    console.log(`\n  Native dialog unavailable (${err.message})`);
    console.log('  Falling back to a browser window instead.');
  }
}

const server = createServer((req, res) => {
  // Defence in depth against DNS rebinding: only accept loopback Host headers.
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return void res.writeHead(403).end('forbidden');

  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.searchParams.get('t') !== TOKEN) return void res.writeHead(403).end('forbidden');

  if (req.method === 'GET' && url.pathname === '/') {
    return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(spec));
  }

  if (req.method === 'POST' && url.pathname === '/save') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let payload;
      try {
        payload = { ok: true, ...save(spec, JSON.parse(body)) };
        saved = payload;
      } catch (err) {
        // Deliberately does not echo the body — it holds the secret.
        payload = { ok: false, error: err.message };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      if (payload.ok) setTimeout(() => { server.close(); process.exit(0); }, 1200);
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/?t=${TOKEN}`;
  console.log(`\n  Opening a window to add your ${spec.service} key safely.`);
  console.log(`  If it does not open, go to:\n  ${url}\n`);
  openBrowser(url);
});

process.on('exit', () => {
  if (saved) console.log(`  Saved to ${saved.where}\n`);
});
