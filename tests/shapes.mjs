#!/usr/bin/env node
/**
 * Shape-coverage audit. Throws a wide variety of REAL credential shapes at the
 * tool to find which ones it cannot express. Failures here are design gaps,
 * not bugs — the point is to discover them deliberately.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Windows locks a process's working directory, so a sandbox can still be busy for
 *  a moment after the child exits. Retry instead of crashing the whole run. */
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch { /* a leftover temp dir is harmless; the OS clears it */ }
}


const TOOL = new URL('../plugins/connect-app/connect.mjs', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, x='') => { console.log(`  \x1b[32mOK  \x1b[0m ${n}${x?'  '+x:''}`); pass++; };
const gap = (n, d) => { console.log(`  \x1b[31mGAP \x1b[0m ${n}\n         ${d}`); fail++; };

function sandbox() {
  const d = join(tmpdir(), `sh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(d,'home'),{recursive:true}); mkdirSync(join(d,'proj'),{recursive:true}); mkdirSync(join(d,'bin'),{recursive:true});
  for (const n of ['open','xdg-open','zenity','powershell']) writeFileSync(join(d,'bin',n),'#!/bin/sh\nexit 0\n',{mode:0o755});
  return d;
}

/**
 * Drive the tool with canned answers. Values are written to FILES and the stub
 * cats them, so no value ever passes through shell quoting — earlier versions of
 * this harness mangled metacharacters and reported false gaps.
 */
async function run(spec, values) {
  const d = sandbox();
  const browser = spec.fields.some((f) => f.multiline);

  spec.fields.forEach((f, i) => writeFileSync(join(d, `v${i}`), values[f.name] ?? ''));
  const cases = spec.fields.map((f, i) =>
    `  *'${f.label}'*) printf 'button returned:OK, text returned:%s\\n' "$(cat ${join(d, `v${i}`)})" ;;`).join('\n');
  writeFileSync(join(d, 'bin', 'osascript'),
    `#!/bin/sh\ncase "$*" in\n${cases}\n  *) echo "button returned:OK, text returned:x" ;;\nesac\n`, { mode: 0o755 });

  const args = browser ? [TOOL, '--browser'] : [TOOL];
  const c = spawn(process.execPath, args, { cwd: join(d, 'proj'),
    env: { ...process.env, HOME: join(d, 'home'), PATH: `${join(d, 'bin')}:${process.env.PATH}` },
    stdio: ['pipe', 'pipe', 'pipe'] });
  c.stdin.write(JSON.stringify(spec)); c.stdin.end();
  let out = ''; c.stdout.on('data', x => out += x); c.stderr.on('data', x => out += x);

  if (browser) {
    // Multi-line fields use the browser textarea, so POST the values directly.
    const url = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no server')), 6000);
      c.stdout.on('data', () => {
        const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([a-f0-9]+)/);
        if (m) { clearTimeout(t); res({ base: `http://127.0.0.1:${m[1]}`, token: m[2] }); }
      });
    }).catch(() => null);
    if (url) {
      const body = {}; spec.fields.forEach(f => body[f.name] = values[f.name]);
      await fetch(`${url.base}/save?t=${url.token}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
  }

  const code = await new Promise(r => { const t = setTimeout(() => { c.kill(); r('timeout'); }, 6000); c.on('exit', x => { clearTimeout(t); r(x); }); });
  const rd = p => existsSync(p) ? readFileSync(p, 'utf8') : null;
  const cfg = rd(join(d, 'home', '.claude.json'));
  const res = { code, out, cfg: cfg ? JSON.parse(cfg) : null, env: rd(join(d, 'proj', '.env')), dir: d };
  cleanup(d);
  return res;
}
const server = r => r.cfg ? Object.values(r.cfg.mcpServers || Object.values(r.cfg.projects || {})[0]?.mcpServers || {})[0] : null;

console.log('\n\x1b[1mShape coverage audit\x1b[0m\n');

// 1 ── single secret token
let r = await run({service:'Monday',route:'mcp-stdio',id:'m',command:'npx',args:['-y','x'],
  fields:[{name:'MONDAY_TOKEN',label:'Token',secret:true}]}, {MONDAY_TOKEN:'tok_abc123'});
server(r)?.env?.MONDAY_TOKEN==='tok_abc123' ? ok('single secret token') : gap('single secret token', r.out.trim());

// 2 ── secret + non-secret
r = await run({service:'ClickUp',route:'mcp-stdio',id:'c',command:'npx',args:['-y','x'],
  fields:[{name:'K',label:'Key',secret:true},{name:'TEAM',label:'Team',secret:false}]}, {K:'sk_1',TEAM:'90210'});
server(r)?.env?.TEAM==='90210' ? ok('secret + non-secret pair') : gap('secret + non-secret pair', r.out.trim());

// 3 ── both parts secret (OAuth client credentials)
r = await run({service:'OAuth app',route:'mcp-stdio',id:'o',command:'npx',args:['-y','x'],
  fields:[{name:'CLIENT_ID',label:'Client ID',secret:true},{name:'CLIENT_SECRET',label:'Client secret',secret:true}]},
  {CLIENT_ID:'cid_1',CLIENT_SECRET:'csec_1'});
server(r)?.env?.CLIENT_SECRET==='csec_1' ? ok('two secrets (client id + secret)') : gap('two secrets', r.out.trim());

// 4 ── three parts (Twilio style)
r = await run({service:'Twilio',route:'mcp-stdio',id:'t',command:'npx',args:['-y','x'],
  fields:[{name:'ACCOUNT_SID',label:'Account SID',secret:false},{name:'AUTH_TOKEN',label:'Auth token',secret:true},
          {name:'FROM_NUMBER',label:'From number',secret:false}]},
  {ACCOUNT_SID:'AC123',AUTH_TOKEN:'tok',FROM_NUMBER:'+61400000000'});
Object.keys(server(r)?.env||{}).length===3 ? ok('three-part credential') : gap('three-part credential', r.out.trim());

// 5 ── custom header name, non-Bearer format
r = await run({service:'Custom',route:'mcp-http',id:'h',url:'https://api.example.com/mcp',
  header:'X-Api-Key',headerFormat:'{API_KEY}',fields:[{name:'API_KEY',label:'API key',secret:true}]},{API_KEY:'raw_key_1'});
server(r)?.headers?.['X-Api-Key']==='raw_key_1' ? ok('custom header, raw (non-Bearer) format') : gap('custom header', JSON.stringify(server(r)));

// 6 ── header composed from TWO fields
r = await run({service:'Two-in-header',route:'mcp-http',id:'h2',url:'https://x/mcp',
  header:'Authorization',headerFormat:'Basic {USER}:{PASS}',
  fields:[{name:'USER',label:'User',secret:false},{name:'PASS',label:'Pass',secret:true}]},{USER:'u1',PASS:'p1'});
server(r)?.headers?.Authorization==='Basic u1:p1' ? ok('header built from two fields') : gap('two-field header', JSON.stringify(server(r)));

// 7 ── long JWT
const jwt = 'eyJ'+'a'.repeat(1800)+'.sig';
r = await run({service:'JWT',route:'env',fields:[{name:'JWT',label:'JWT',secret:true}]},{JWT:jwt});
r.env?.includes(jwt) ? ok('very long token', `${jwt.length} chars`) : gap('very long token', r.out.trim());

// 8 ── base64 characters (= + /)
r = await run({service:'B64',route:'env',fields:[{name:'B64',label:'Base64 key',secret:true}]},{B64:'aGVsbG8+d29ybGQ/Zm9v=='});
r.env?.includes('aGVsbG8+d29ybGQ/Zm9v==') ? ok('base64 chars = + /') : gap('base64 chars', JSON.stringify(r.env));

// 9 ── shell metacharacters in a key
r = await run({service:'Meta',route:'env',fields:[{name:'M',label:'Key',secret:true}]},{M:'a$b`c;d&e|f'});
r.env?.match(/^M=/m) ? ok('shell metacharacters', JSON.stringify(r.env.match(/^M=.*/m)[0])) : gap('shell metacharacters', JSON.stringify(r.env));

// 10 ── user-supplied ENDPOINT (self-hosted server)
r = await run({service:'Self-hosted',route:'mcp-http',id:'s',url:'{ENDPOINT}',header:'Authorization',headerFormat:'Bearer {TOKEN}',
  fields:[{name:'ENDPOINT',label:'Server URL',secret:false},{name:'TOKEN',label:'Token',secret:true}]},
  {ENDPOINT:'https://mcp.mycompany.com',TOKEN:'t1'});
server(r)?.url==='https://mcp.mycompany.com'
  ? ok('user-supplied endpoint URL')
  : gap('user-supplied endpoint URL', `url stored as ${JSON.stringify(server(r)?.url)} — {ENDPOINT} not substituted into url`);

// 11 ── multi-line PEM / service-account key
const pem='-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\nkqhkiG9w0BAQ==\n-----END PRIVATE KEY-----';
r = await run({service:'GCP',route:'env',fields:[{name:'PRIVATE_KEY',label:'Private key',secret:true,multiline:true}]},{PRIVATE_KEY:pem});
r.env?.includes('BEGIN PRIVATE KEY')
  ? ok('multi-line PEM private key')
  : gap('multi-line PEM private key', 'rejected by the newline guard — real shape for Google service accounts');

console.log(`\n${fail===0?'\x1b[32m':'\x1b[33m'}${pass} shapes handled, ${fail} gaps\x1b[0m\n`);
