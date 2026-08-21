#!/usr/bin/env node
/**
 * Windows-only checks. These need real PowerShell, so they run on a windows-latest
 * CI runner rather than a Mac. They deliberately avoid ShowDialog(), which needs an
 * interactive desktop session that CI does not have — everything up to the moment
 * the window would appear is still verified.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawn } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  PASS  ${n}`); pass++; };
const no = (n, d) => { console.log(`  FAIL  ${n}\n        ${d}`); fail++; };
const check = (n, c, d = '') => (c ? ok(n) : no(n, d));

const TOOL = new URL('../plugins/connect-app/connect.mjs', import.meta.url).pathname.replace(/^\//, '');

// 1 ── the encoded payload is accepted and executed by real PowerShell
const ps = `Write-Output "hello from powershell"`;
const b64 = Buffer.from(ps, 'utf16le').toString('base64');
try {
  const out = execFileSync('powershell',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { encoding: 'utf8' });
  check('-EncodedCommand round-trips through real PowerShell', out.includes('hello from powershell'), out);
} catch (e) { no('-EncodedCommand round-trips', String(e.message)); }

// 2 ── WinForms is available (the dialog would have something to render)
try {
  const load = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$t = New-Object Windows.Forms.TextBox
$t.UseSystemPasswordChar = $true
Write-Output "winforms-ok:$($t.UseSystemPasswordChar)"`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(load, 'utf16le').toString('base64')], { encoding: 'utf8' });
  check('WinForms loads and UseSystemPasswordChar applies', out.includes('winforms-ok:True'), out);
} catch (e) { no('WinForms loads', String(e.message)); }

// 3 ── a multi-line label survives the here-string
try {
  const label = "ClickUp  (step 1 of 2)\n\nAPI token\nSettings > Apps";
  const script = `$l = @'\n${label}\n'@\nWrite-Output $l.Length`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8' });
  check('multi-line label survives the here-string', Number(out.trim()) > 30, out);
} catch (e) { no('multi-line label', String(e.message)); }

// 4 ── npx really is npx.cmd here, which is why the shim exists
try {
  execFileSync('npx', ['--version'], { encoding: 'utf8' });
  no('bare npx spawn', 'expected ENOENT on Windows without a shell — shim may be unnecessary');
} catch {
  ok('bare npx spawn fails on Windows (confirms the cmd /c shim is needed)');
}
try {
  const v = execFileSync('cmd', ['/c', 'npx', '--version'], { encoding: 'utf8' });
  check('cmd /c npx works (the shim the tool writes)', /\d+\./.test(v), v);
} catch (e) { no('cmd /c npx works', String(e.message)); }

// 5 ── the tool writes a Windows-shaped config, with the npx shim applied
const dir = join(tmpdir(), `ksw-${Date.now()}`);
mkdirSync(join(dir, 'proj'), { recursive: true });
mkdirSync(join(dir, 'home'), { recursive: true });
const spec = { service: 'T', route: 'mcp-stdio', id: 't', command: 'npx', args: ['-y', 'x'],
  fields: [{ name: 'K', label: 'K', secret: true }] };
const child = spawn(process.execPath, [TOOL, '--browser'], {
  cwd: join(dir, 'proj'),
  env: { ...process.env, USERPROFILE: join(dir, 'home'), HOME: join(dir, 'home') },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdin.write(JSON.stringify(spec)); child.stdin.end();
let out = '';
child.stdout.on('data', (d) => (out += d));
const url = await new Promise((res) => {
  const t = setTimeout(() => res(null), 8000);
  child.stdout.on('data', () => {
    const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([a-f0-9]+)/);
    if (m) { clearTimeout(t); res({ base: `http://127.0.0.1:${m[1]}`, token: m[2] }); }
  });
});
if (url) {
  await fetch(`${url.base}/save?t=${url.token}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ K: 'winval' }) });
  await new Promise((r) => { const t = setTimeout(() => { child.kill(); r(); }, 4000); child.on('exit', () => { clearTimeout(t); r(); }); });
  const cfgPath = join(dir, 'home', '.claude.json');
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : null;
  const entry = cfg && Object.values(cfg.projects)[0].mcpServers.t;
  check('config written to the Windows home directory', !!entry, JSON.stringify(cfg));
  check('npx shimmed to cmd /c in the written config',
    entry?.command === 'cmd' && entry.args[0] === '/c' && entry.args[1] === 'npx',
    JSON.stringify(entry));
} else {
  no('tool started on Windows', out);
}
rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
