#!/usr/bin/env node
/**
 * Audit suite for the spec-driven design.
 * Run: node tests/audit.mjs
 *
 * Fake HOME and fake sentinel keys throughout. Never touches real config.
 */

import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'plugins', 'connect-app', 'connect.mjs');
const SENTINEL = 'sk_SENTINEL_DO_NOT_USE_7QX9Z';
const WIN = process.platform === 'win32';

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  \x1b[32mPASS\x1b[0m  ${n}`); pass++; };
const no = (n, d) => { console.log(`  \x1b[31mFAIL\x1b[0m  ${n}\n        ${d}`); fail++; };
const check = (n, cond, detail = '') => (cond ? ok(n) : no(n, detail));

const SPEC = {
  stdio: {
    service: 'Monday.com', route: 'mcp-stdio', id: 'monday',
    command: 'npx', args: ['-y', '@mondaydotcomorg/monday-api-mcp'],
    fields: [{ name: 'MONDAY_TOKEN', label: 'API token', secret: true }],
  },
  http: {
    service: 'GitHub', route: 'mcp-http', id: 'github',
    url: 'https://api.githubcopilot.com/mcp/',
    header: 'Authorization', headerFormat: 'Bearer {GITHUB_TOKEN}',
    fields: [{ name: 'GITHUB_TOKEN', label: 'Token', secret: true }],
  },
  env: {
    service: 'Some API', route: 'env',
    fields: [{ name: 'MY_KEY', label: 'Key', secret: true }],
  },
  twoPart: {
    service: 'DataForSEO', route: 'mcp-stdio', id: 'dataforseo',
    command: 'npx', args: ['-y', 'dataforseo-mcp-server'],
    fields: [
      { name: 'DATAFORSEO_USERNAME', label: 'API login', secret: false },
      { name: 'DATAFORSEO_PASSWORD', label: 'API password', secret: true },
    ],
  },
};

function sandbox() {
  const dir = join(tmpdir(), `ks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'home'), { recursive: true });
  mkdirSync(join(dir, 'proj'), { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  // Stub every way the tool could open a window, so the audit never pops a real
  // dialog or browser on the machine running it. Native tests overwrite osascript.
  for (const n of ['open', 'xdg-open', 'osascript', 'zenity', 'powershell']) {
    writeFileSync(join(dir, 'bin', n), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  return dir;
}

/** Windows locks a process's working directory, so a sandbox can still be busy for
 *  a moment after the child exits. Retry instead of crashing the whole run. */
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch { /* a leftover temp dir is harmless; the OS clears it */ }
}

async function run(dir, spec, values, { preEnv, preConfig, preGitignore } = {}) {
  const home = join(dir, 'home'), proj = join(dir, 'proj');
  if (preEnv !== undefined) writeFileSync(join(proj, '.env'), preEnv);
  if (preConfig !== undefined) writeFileSync(join(home, '.claude.json'), preConfig);
  if (preGitignore !== undefined) writeFileSync(join(proj, '.gitignore'), preGitignore);

  // --browser explicitly: native is the default now, and without this the audit
  // would pop real OS dialogs on the machine running it.
  const child = spawn(process.execPath, [TOOL, '--browser'], {
    cwd: proj,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (spec) child.stdin.write(JSON.stringify(spec));
  child.stdin.end();

  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));

  let url = null;
  try {
    url = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no server')), 6000);
      child.on('exit', () => { clearTimeout(t); rej(new Error('exited early')); });
      child.stdout.on('data', () => {
        const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([a-f0-9]+)/);
        if (m) { clearTimeout(t); res({ base: `http://127.0.0.1:${m[1]}`, token: m[2] }); }
      });
    });
  } catch { /* spec rejected — expected in some tests */ }

  const statuses = {};
  let saved = null;
  if (url) {
    statuses.none = (await fetch(`${url.base}/`)).status;
    statuses.bad = (await fetch(`${url.base}/?t=deadbeef`)).status;
    statuses.good = (await fetch(`${url.base}/?t=${url.token}`)).status;
    // fetch() treats Host as a forbidden header and silently drops it, so a
    // rebinding test must go through node:http where the header can be set.
    statuses.rebind = await new Promise((res) => {
      const port = Number(url.base.split(':')[2]);
      const r = httpRequest({ host: '127.0.0.1', port, path: `/?t=${url.token}`,
        headers: { Host: 'evil.com' } }, (x) => { x.resume(); res(x.statusCode); });
      r.on('error', () => res(0));
      r.end();
    });
    if (values) {
      saved = await (await fetch(`${url.base}/save?t=${url.token}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      })).json();
    }
  }

  await new Promise((r) => { child.on('exit', r); setTimeout(() => { child.kill(); r(); }, 2500); });
  const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  return {
    started: !!url, statuses, saved, stdout: out,
    config: rd(join(home, '.claude.json')), env: rd(join(proj, '.env')),
    gitignore: rd(join(proj, '.gitignore')),
    backup: existsSync(join(home, '.claude.json.keysafe-backup')),
    leftoverTmp: existsSync(join(home, '.claude.json.keysafe-tmp')),
    envMode: existsSync(join(proj, '.env')) ? statSync(join(proj, '.env')).mode & 0o777 : null,
    cfgMode: existsSync(join(home, '.claude.json')) ? statSync(join(home, '.claude.json')).mode & 0o777 : null,
  };
}

console.log('\n\x1b[1mKeySafe audit — spec-driven\x1b[0m\n');
const src = readFileSync(TOOL, 'utf8');

// ── A. Static ────────────────────────────────────────────────────────────────
console.log('\x1b[1mA. Static analysis\x1b[0m');
const imports = [...src.matchAll(/^import .*? from '(.+?)';/gm)].map((m) => m[1]);
check('zero third-party dependencies', imports.every((i) => i.startsWith('node:')),
  imports.filter((i) => !i.startsWith('node:')).join(', '));
const serverOnly = src.split('const page =')[0] + src.split('// ─── server')[1];
check('no outbound network primitives server-side',
  !/fetch\(|https?\.request|net\.connect|dns\./.test(serverOnly));
check('binds 127.0.0.1 only', /listen\(0, '127\.0\.0\.1'/.test(src));
check('session token required', /searchParams\.get\('t'\) !== TOKEN/.test(src));
check('Host header restricted to loopback',
  /host !== '127\.0\.0\.1' && host !== 'localhost'/.test(src));
check('secret fields render as password inputs', /f\.secret\?'password'/.test(src));
check('no catalogue file dependency (spec-driven)',
  !/catalogue\.json/.test(src), 'still reads a hardcoded service list');
check('external links carry rel=noreferrer',
  (src.match(/target="_blank"/g) || []).length === (src.match(/target="_blank" rel="noreferrer"/g) || []).length);
check('page sends no-referrer meta', /referrer" content="no-referrer/.test(src));

// ── B. Windows ───────────────────────────────────────────────────────────────
console.log('\n\x1b[1mB. Windows portability\x1b[0m');
check('npx shimmed through cmd.exe', /'cmd', args: \['\/c', command/.test(src));
check('browser opener has win32 branch', /'cmd', \['\/c', 'start'/.test(src));
check('chmod no-op on win32', /platform === 'win32'\) return;/.test(src));
check('uses os.homedir(), not $HOME', /homedir\(\)/.test(src) && !/process\.env\.HOME/.test(src));
check('CRLF preserved in .env', /raw\.includes\('\\r\\n'\)/.test(src));

// ── C. Spec handling ─────────────────────────────────────────────────────────
console.log('\n\x1b[1mC. Spec handling\x1b[0m');
for (const [label, bad] of [
  ['unknown route', { route: 'nope', fields: [{ name: 'A' }] }],
  ['no fields', { route: 'env', fields: [] }],
  ['stdio without command', { route: 'mcp-stdio', id: 'x', fields: [{ name: 'A' }] }],
  ['http without url', { route: 'mcp-http', id: 'x', fields: [{ name: 'A' }] }],
  ['mcp without id', { route: 'mcp-stdio', command: 'npx', fields: [{ name: 'A' }] }],
  ['invalid field name', { route: 'env', fields: [{ name: 'A=1\nB' }] }],
]) {
  const d = sandbox();
  const r = await run(d, bad, null);
  check(`rejects bad spec: ${label}`, !r.started, 'server started with an invalid spec');
  cleanup(d);
}

// ── D. Routes ────────────────────────────────────────────────────────────────
console.log('\n\x1b[1mD. Routes\x1b[0m');

const d1 = sandbox();
const r1 = await run(d1, SPEC.stdio, { MONDAY_TOKEN: SENTINEL },
  { preConfig: JSON.stringify({ autoUpdates: true, projects: { '/other': { mcpServers: { keep: { command: 'x' } } } } }) });
check('token gate: none → 403', r1.statuses.none === 403);
check('token gate: wrong → 403', r1.statuses.bad === 403);
check('token gate: right → 200', r1.statuses.good === 200);
check('DNS rebinding: foreign Host → 403', r1.statuses.rebind === 403, `got ${r1.statuses.rebind}`);
check('mcp-stdio writes server entry', r1.saved?.ok && /monday/.test(r1.config));
check('mcp-stdio stores key in env block',
  JSON.parse(r1.config).mcpServers.monday.env.MONDAY_TOKEN === SENTINEL);
check('existing config preserved',
  JSON.parse(r1.config).autoUpdates === true && !!JSON.parse(r1.config).projects['/other']);
check('backup written', r1.backup);
check('temp file cleaned', !r1.leftoverTmp);
check('secret never printed to stdout', !r1.stdout.includes(SENTINEL), 'KEY LEAKED TO TERMINAL');
if (!WIN) check('~/.claude.json locked to 600', r1.cfgMode === 0o600, `${r1.cfgMode?.toString(8)}`);
cleanup(d1);

const d2 = sandbox();
const r2 = await run(d2, SPEC.http, { GITHUB_TOKEN: SENTINEL });
const httpEntry = JSON.parse(r2.config).mcpServers.github;
check('mcp-http builds the header from headerFormat',
  httpEntry.headers.Authorization === `Bearer ${SENTINEL}`, JSON.stringify(httpEntry.headers));
check('mcp-http sets type and url', httpEntry.type === 'http' && !!httpEntry.url);
cleanup(d2);

const d3 = sandbox();
const r3 = await run(d3, SPEC.env, { MY_KEY: SENTINEL },
  { preEnv: '# notes\nEXISTING=keep\n', preGitignore: 'node_modules\n' });
check('env route writes .env', /MY_KEY=/.test(r3.env));
check('env route preserves comments', r3.env.includes('# notes'));
check('env route preserves existing keys', r3.env.includes('EXISTING=keep'));
check('env route gitignores .env', r3.gitignore.split('\n').includes('.env'));
check('env route preserves gitignore', r3.gitignore.includes('node_modules'));
cleanup(d3);

// ── E. Multi-part ────────────────────────────────────────────────────────────
console.log('\n\x1b[1mE. Multi-part credentials\x1b[0m');
const d4 = sandbox();
const r4 = await run(d4, SPEC.twoPart,
  { DATAFORSEO_USERNAME: 'api-user@example.com', DATAFORSEO_PASSWORD: SENTINEL });
const two = JSON.parse(r4.config).mcpServers.dataforseo;
check('both parts stored', two.env.DATAFORSEO_USERNAME === 'api-user@example.com'
  && two.env.DATAFORSEO_PASSWORD === SENTINEL, JSON.stringify(two.env));
check('mixed secret/non-secret spec accepted', r4.saved?.ok === true);
check('secret part not echoed', !r4.stdout.includes(SENTINEL));
cleanup(d4);

// ── F. Injection ─────────────────────────────────────────────────────────────
console.log('\n\x1b[1mF. Injection / untrusted input\x1b[0m');
const d5 = sandbox();
const r5 = await run(d5, SPEC.env, { MY_KEY: 'abc\nEXISTING=HIJACKED\nADMIN=true' },
  { preEnv: 'EXISTING=original\n' });
check('newline in value rejected', r5.saved?.ok === false);
check('.env not corrupted', r5.env === 'EXISTING=original\n', JSON.stringify(r5.env));
check('no variable hijacked', !/HIJACKED/.test(r5.env || ''));
check('error names the field, not the value',
  JSON.stringify(r5.saved).includes('MY_KEY') && !JSON.stringify(r5.saved).includes('abc'));
cleanup(d5);

const d6 = sandbox();
check('carriage return rejected',
  (await run(d6, SPEC.env, { MY_KEY: 'a\r\nEVIL=1' })).saved?.ok === false);
cleanup(d6);

const d7 = sandbox();
check('whitespace-only value rejected',
  (await run(d7, SPEC.env, { MY_KEY: '   ' })).saved?.ok === false);
cleanup(d7);

const d8 = sandbox();
const r8 = await run(d8, SPEC.env, { MY_KEY: '  padded  ' });
check('value trimmed', /^MY_KEY=padded$/m.test(r8.env || ''), JSON.stringify(r8.env));
cleanup(d8);

// Real bug found in live testing: a value with a space broke `source .env`.
const dQ = sandbox();
// Spaces are legitimate only in a NON-secret field (a workspace name, a region).
// A secret containing a space is refused as a likely copy error — see round 4.
const SPACED = { service: 'Spaced', route: 'env',
  fields: [{ name: 'MY_KEY', label: 'Workspace', secret: false }] };
const rQ = await run(dQ, SPACED, { MY_KEY: 'hat pack' });
check('value with a space is quoted in .env',
  /^MY_KEY='hat pack'$/m.test(rQ.env || ''), JSON.stringify(rQ.env));
check('.env with a spaced value survives shell sourcing',
  await (async () => {
    const { execFileSync } = await import('node:child_process');
    try {
      const out = execFileSync('sh', ['-c', `set -a; . "${join(dQ, 'proj', '.env')}"; printf %s "$MY_KEY"`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return out === 'hat pack';
    } catch { return false; }
  })(), 'sourcing the generated .env failed');
check('a spaced value in a SECRET field is refused as a copy error',
  (await run(sandbox(), SPEC.env, { MY_KEY: 'API Key: sk_123' })).saved?.ok === false,
  'a secret containing a space was accepted');
check('simple values stay unquoted',
  (await run(sandbox(), SPEC.env, { MY_KEY: 'sk-abc_123' })).env.includes('MY_KEY=sk-abc_123'));
check('single quotes used so the shell does not expand $ or backticks',
  /^MY_KEY='a\$b'$/m.test((await run(sandbox(), SPEC.env, { MY_KEY: 'a$b' })).env || ''),
  'double quotes would let the shell expand the value on `source .env`');
check('value containing a single quote falls back to escaped double quotes',
  /^MY_KEY="it's"$/m.test((await run(sandbox(), SPEC.env, { MY_KEY: "it's" })).env || ''));
cleanup(dQ);

const d9 = sandbox();
const r9 = await run(d9, SPEC.stdio, { MONDAY_TOKEN: SENTINEL }, { preConfig: '{ not json' });
check('malformed config fails safe', r9.saved?.ok === false && r9.config === '{ not json');
check('failure message does not leak the key', !JSON.stringify(r9.saved).includes(SENTINEL));
cleanup(d9);

if (!WIN) {
  const d10 = sandbox();
  writeFileSync(join(d10, 'proj', '.env'), 'A=1\n'); chmodSync(join(d10, 'proj', '.env'), 0o644);
  const r10 = await run(d10, SPEC.env, { MY_KEY: SENTINEL });
  check('existing 644 .env hardened to 600', r10.envMode === 0o600, `${r10.envMode?.toString(8)}`);
  cleanup(d10);
}

const d11 = sandbox();
await run(d11, SPEC.env, { MY_KEY: 'first' });
const r11 = await run(d11, SPEC.env, { MY_KEY: SENTINEL });
check('idempotent: replaces, does not duplicate',
  (r11.env.match(/^MY_KEY=/gm) || []).length === 1);
check('idempotent: gitignore not duplicated',
  (r11.gitignore.match(/^\.env$/gm) || []).length === 1);
cleanup(d11);

// ── G. Native dialog mode ────────────────────────────────────────────────────
console.log('\n\x1b[1mG. Native dialog mode\x1b[0m');

// The tool is a script with top-level side effects, so importing it would run it.
// Assert on what the dialog is actually asked to display instead, via the stub.

const MAC = process.platform === 'darwin';

/** Run native mode with a stubbed osascript, so no real dialog appears.
 *  osascript is macOS-only; on Linux the tool calls zenity instead, so these
 *  assertions only apply on a Mac. */
async function runNative(dir, spec, behaviour) {
  const home = join(dir, 'home'), proj = join(dir, 'proj'), bin = join(dir, 'bin');
  writeFileSync(join(bin, 'osascript'), behaviour, { mode: 0o755 });
  const child = spawn(process.execPath, [TOOL], {
    cwd: proj,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}:${process.env.PATH}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.write(JSON.stringify(spec)); child.stdin.end();
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  // The fallback path starts a browser server that waits for a POST that never
  // comes, so the harness must not wait forever for an exit.
  const code = await new Promise((r) => {
    const t = setTimeout(() => { child.kill(); r('timeout'); }, 6000);
    child.on('exit', (c) => { clearTimeout(t); r(c); });
  });
  const rd = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  return { code, out, config: rd(join(home, '.claude.json')), env: rd(join(proj, '.env')) };
}

if (MAC) {
  // Happy path: the stub returns a value in osascript's real output format.
  const g1 = sandbox();
  const rG1 = await runNative(g1, SPEC.twoPart,
    `#!/bin/sh\ncase "$*" in *"API login"*) echo "button returned:OK, text returned:api-user";; *) echo "button returned:OK, text returned:${SENTINEL}";; esac\n`);
  check('native mode saves without a browser', rG1.code === 0, rG1.out.trim());
  const cfgN = rG1.config ? JSON.parse(rG1.config) : null;
  const entN = cfgN && cfgN.mcpServers.dataforseo;
  check('native mode collects every field of a multi-part key',
    entN?.env?.DATAFORSEO_USERNAME === 'api-user' && entN?.env?.DATAFORSEO_PASSWORD === SENTINEL,
    JSON.stringify(entN?.env));
  check('native mode never prints the secret', !rG1.out.includes(SENTINEL), 'SECRET LEAKED');
  cleanup(g1);

  // Capture what the dialogs were actually asked to show.
  const gT = sandbox();
  const log = join(gT, 'dialogs.txt');
  await runNative(gT, SPEC.twoPart,
    `#!/bin/sh\nprintf '%s\\n---\\n' "$*" >> ${log}\necho "button returned:OK, text returned:v"\n`);
  const shown = existsSync(log) ? readFileSync(log, 'utf8') : '';
  check('multi-part prompt shows a step counter', /step 1 of 2/.test(shown), shown.slice(0, 200));
  check('secret field asks with hidden answer',
    /API password[\s\S]*?hidden answer|hidden answer[\s\S]*?API password/.test(shown));
  check('non-secret field is NOT hidden',
    shown.split('---').some((d) => /API login/.test(d) && !/hidden answer/.test(d)),
    'the plain field was masked too');
  cleanup(gT);

  // Single-field key should not say "step 1 of 1".
  const gS = sandbox();
  const logS = join(gS, 'd.txt');
  await runNative(gS, SPEC.stdio,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${logS}\necho "button returned:OK, text returned:v"\n`);
  check('single-field prompt omits the step counter',
    !/step/.test(existsSync(logS) ? readFileSync(logS, 'utf8') : ''));
  cleanup(gS);

  // Cancel: AppleScript error -128.
  const g2 = sandbox();
  const rG2 = await runNative(g2, SPEC.env,
    `#!/bin/sh\necho "0:151: execution error: User cancelled. (-128)" >&2\nexit 1\n`);
  check('native mode detects cancel (spelling-independent, via -128)',
    /Cancelled/.test(rG2.out), rG2.out.trim());
  check('nothing written when cancelled', rG2.env === null);
  cleanup(g2);

  // A real failure must fall back to the browser, not strand the user.
  const g3 = sandbox();
  writeFileSync(join(g3, 'bin', 'open'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const rG3 = await runNative(g3, SPEC.env,
    `#!/bin/sh\necho "some other applescript failure" >&2\nexit 1\n`);
  check('dialog failure falls back to the browser',
    /Falling back to a browser/.test(rG3.out), rG3.out.trim());
  check('fallback actually starts the browser server',
    /http:\/\/127\.0\.0\.1:\d+/.test(rG3.out), rG3.out.trim());
  check('fallback explains why, without a scary stack trace',
    /Native dialog unavailable/.test(rG3.out) && !/at Object|at Module/.test(rG3.out));
  cleanup(g3);

  // Empty input should re-ask rather than abort.
  const g4 = sandbox();
  const rG4 = await runNative(g4, SPEC.env, `#!/bin/sh
C=/tmp/ks-retry-$PPID
N=$(cat $C 2>/dev/null || echo 0); N=$((N+1)); echo $N > $C
if [ "$N" -lt 2 ]; then echo "button returned:OK, text returned:"; else echo "button returned:OK, text returned:${SENTINEL}"; rm -f $C; fi
`);
  check('empty box re-asks instead of aborting', rG4.code === 0 && /MY_KEY=/.test(rG4.env || ''),
    rG4.out.trim());
  cleanup(g4);
}

check('secret fields get hidden answer, plain fields do not',
  /\$\{field\.secret \? 'with hidden answer ' : ''\}/.test(src),
  'masking is not tied to the secret flag');
check('native is the default, browser is opt-in',
  /!process\.argv\.includes\('--browser'\)/.test(src), 'browser still appears to be default');
check('Windows path uses EncodedCommand to avoid quoting bugs',
  /-EncodedCommand/.test(src));
check('Windows masks input via UseSystemPasswordChar',
  /UseSystemPasswordChar/.test(src));


// ── H. Substituted URL and header hardening ──────────────────────────────────
console.log('\n\x1b[1mH. URL / header hardening\x1b[0m');

const SELF = {
  service: 'Self-hosted', route: 'mcp-http', id: 'self',
  url: '{ENDPOINT}', header: 'Authorization', headerFormat: 'Bearer {TOKEN}',
  fields: [{ name: 'ENDPOINT', label: 'Server URL', secret: false },
           { name: 'TOKEN', label: 'Token', secret: true }],
};

const h1 = sandbox();
const rH1 = await run(h1, SELF, { ENDPOINT: 'https://mcp.example.com/mcp', TOKEN: SENTINEL });
const srvH = rH1.config && JSON.parse(rH1.config).mcpServers.self;
check('user-supplied endpoint is substituted into the url',
  srvH?.url === 'https://mcp.example.com/mcp', JSON.stringify(srvH?.url));
cleanup(h1);

for (const [label, endpoint] of [
  ['javascript: scheme', 'javascript:alert(1)'],
  ['file: scheme', 'file:///etc/passwd'],
  ['not a url at all', 'just some text'],
]) {
  const d = sandbox();
  const r = await run(d, SELF, { ENDPOINT: endpoint, TOKEN: SENTINEL });
  check(`rejects ${label} as an endpoint`, r.saved?.ok === false, JSON.stringify(r.saved));
  cleanup(d);
}

// A multi-line credential must not reach a request header (CRLF injection).
const h2 = sandbox();
const rH2 = await run(h2, {
  ...SELF, url: 'https://x/mcp',
  fields: [{ name: 'ENDPOINT', label: 'E', secret: false },
           { name: 'TOKEN', label: 'T', secret: true, multiline: true }],
}, { ENDPOINT: 'https://x/mcp', TOKEN: 'abc\r\nX-Injected: evil' });
check('multi-line credential rejected for an http header (CRLF injection)',
  rH2.saved?.ok === false, JSON.stringify(rH2.saved));
check('header-injection rejection does not echo the value',
  !JSON.stringify(rH2.saved).includes('X-Injected'));
cleanup(h2);


// ── I. Reserved names and spec integrity ─────────────────────────────────────
console.log('\n\x1b[1mI. Reserved names / spec integrity\x1b[0m');

for (const bad of ['__proto__', 'constructor', 'prototype']) {
  const d = sandbox();
  const r = await run(d, { ...SPEC.env, fields: [{ name: 'OK_NAME', label: 'K', secret: true }] },
    { [bad]: 'x' });
  check(`rejects a field named ${bad}`, r.saved?.ok === false, JSON.stringify(r.saved));
  cleanup(d);
}

{
  const d = sandbox();
  const r = await run(d, {
    service: 'Dup', route: 'env',
    fields: [{ name: 'SAME', label: 'a', secret: true }, { name: 'SAME', label: 'b', secret: true }],
  }, null);
  check('rejects a spec with duplicate field names', !r.started);
  cleanup(d);
}

for (const [label, id] of [['path traversal', '../evil'], ['prototype', '__proto__'], ['spaces', 'my server']]) {
  const d = sandbox();
  const r = await run(d, { ...SPEC.stdio, id }, null);
  check(`rejects a malformed server id (${label})`, !r.started);
  cleanup(d);
}

{
  const d = sandbox();
  const r = await run(d, { ...SPEC.http, header: 'X-Bad\r\nInjected' }, null);
  check('rejects a header name containing CRLF', !r.started);
  cleanup(d);
}

{
  // A value whose NAME is fine but which lands on a null-prototype accumulator.
  const d = sandbox();
  const r = await run(d, { ...SPEC.env, fields: [{ name: 'toString', label: 'K', secret: true }] },
    { toString: 'val123' });
  check('a field named toString still stores its value',
    r.saved?.ok === true && /^toString=val123$/m.test(r.env || ''), JSON.stringify(r.env));
  cleanup(d);
}


// ── J. Scope ─────────────────────────────────────────────────────────────────
console.log('\n\x1b[1mJ. Install scope\x1b[0m');

{
  // Default must be user scope: "connect my Notion" means everywhere, not just the
  // folder the user happened to be in. Found by a real end-to-end test.
  const d = sandbox();
  const r = await run(d, SPEC.stdio, { MONDAY_TOKEN: SENTINEL });
  const cfg = JSON.parse(r.config);
  check('defaults to user scope (top-level mcpServers)',
    !!cfg.mcpServers?.monday, JSON.stringify(Object.keys(cfg)));
  check('does not write a project entry by default',
    !cfg.projects || !Object.values(cfg.projects).some((p) => p.mcpServers?.monday));
  check('confirmation says it applies everywhere',
    /all your projects/.test(r.saved?.where || ''), r.saved?.where);
  cleanup(d);
}

{
  const d = sandbox();
  const r = await run(d, { ...SPEC.stdio, scope: 'project' }, { MONDAY_TOKEN: SENTINEL });
  const cfg = JSON.parse(r.config);
  check('scope:project writes under the project path',
    Object.values(cfg.projects || {}).some((p) => p.mcpServers?.monday),
    JSON.stringify(cfg));
  check('scope:project does not write user scope', !cfg.mcpServers?.monday);
  check('confirmation says this project only',
    /this project only/.test(r.saved?.where || ''), r.saved?.where);
  cleanup(d);
}

{
  const d = sandbox();
  check('rejects an unknown scope value',
    !(await run(d, { ...SPEC.stdio, scope: 'global' }, null)).started);
  cleanup(d);
}

{
  // Existing user-scope servers must survive.
  const d = sandbox();
  const r = await run(d, SPEC.stdio, { MONDAY_TOKEN: SENTINEL },
    { preConfig: JSON.stringify({ mcpServers: { existing: { command: 'keep' } } }) });
  const cfg = JSON.parse(r.config);
  check('preserves other user-scope servers',
    !!cfg.mcpServers?.existing && !!cfg.mcpServers?.monday, JSON.stringify(cfg.mcpServers));
  cleanup(d);
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
