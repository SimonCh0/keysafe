#!/usr/bin/env node
/**
 * "User got it slightly wrong" audit. Real paste accidents from non-technical users.
 * The question for each: does it BREAK anything, or just store a wrong value?
 * Storing a wrong value is recoverable (re-run). Corrupting a file is not.
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
let clean = 0, stored = 0, broke = 0;

function sandbox() {
  const d = join(tmpdir(), `msy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(d,'home'),{recursive:true}); mkdirSync(join(d,'proj'),{recursive:true}); mkdirSync(join(d,'bin'),{recursive:true});
  for (const n of ['open','xdg-open']) writeFileSync(join(d,'bin',n),'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(join(d,'proj','.env'), 'PRE_EXISTING=keepme\n');
  return d;
}

async function paste(value) {
  const d = sandbox();
  const spec = { service:'Test', route:'env', fields:[{name:'API_KEY',label:'API key',secret:true}] };
  const c = spawn(process.execPath,[TOOL,'--browser'],{cwd:join(d,'proj'),
    env:{...process.env,HOME:join(d,'home'),PATH:`${join(d,'bin')}:${process.env.PATH}`},stdio:['pipe','pipe','pipe']});
  c.stdin.write(JSON.stringify(spec)); c.stdin.end();
  let out=''; c.stdout.on('data',x=>out+=x);
  const url = await new Promise(res=>{const t=setTimeout(()=>res(null),6000);
    c.stdout.on('data',()=>{const m=out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([a-f0-9]+)/);if(m){clearTimeout(t);res({base:`http://127.0.0.1:${m[1]}`,token:m[2]})}})});
  let saved=null;
  if(url){ saved = await (await fetch(`${url.base}/save?t=${url.token}`,{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({API_KEY:value})})).json(); }
  await new Promise(r=>{const t=setTimeout(()=>{c.kill();r()},4000);c.on('exit',()=>{clearTimeout(t);r()})});
  const env = existsSync(join(d,'proj','.env')) ? readFileSync(join(d,'proj','.env'),'utf8') : null;
  cleanup(d);
  const line = env?.split('\n').find(l=>l.startsWith('API_KEY='));
  const kept = /^PRE_EXISTING=keepme$/m.test(env||'');
  return { saved, line, kept, env };
}

const GOOD='sk_live_abc123XYZ';
const CASES = [
  ['perfect paste',                 GOOD],
  ['trailing space',                GOOD+' '],
  ['leading + trailing spaces',     '  '+GOOD+'  '],
  ['tab either side',               '\t'+GOOD+'\t'],
  ['wrapped in straight quotes',    `"${GOOD}"`],
  ['wrapped in single quotes',      `'${GOOD}'`],
  ['smart quotes from a doc',       `“${GOOD}”`],
  ['pasted with the var name',      `API_KEY=${GOOD}`],
  ['pasted whole doc line',         `API Key: ${GOOD}`],
  ['pasted with Bearer prefix',     `Bearer ${GOOD}`],
  ['pasted twice by accident',      GOOD+GOOD],
  ['non-breaking space inside',     GOOD.slice(0,5)+' '+GOOD.slice(5)],
  ['zero-width char from web copy', GOOD.slice(0,5)+'​'+GOOD.slice(5)],
  ['trailing newline',              GOOD+'\n'],
  ['internal newline (two lines)',  GOOD+'\nsecondline'],
  ['empty',                         ''],
  ['only spaces',                   '    '],
];

console.log('\n\x1b[1mMessy-input audit — what happens when a person gets it wrong?\x1b[0m\n');
for (const [name, val] of CASES) {
  const r = await paste(val);
  const okSave = r.saved?.ok === true;
  const stored_val = r.line ? r.line.slice('API_KEY='.length) : null;
  const exact = stored_val === GOOD || stored_val === `'${GOOD}'` || stored_val === `"${GOOD}"`;
  if (!r.kept && r.env !== null) { console.log(`  \x1b[31mBROKE\x1b[0m ${name} — destroyed existing .env`); broke++; continue; }
  if (!okSave) { console.log(`  \x1b[33mREFUSED\x1b[0m ${name}\n          -> ${r.saved?.error}`); clean++; continue; }
  if (exact) { console.log(`  \x1b[32mCLEANED\x1b[0m ${name} -> stored correctly`); clean++; }
  else { console.log(`  \x1b[36mSTORED \x1b[0m ${name} -> ${JSON.stringify(stored_val)}`); stored++; }
}
console.log(`\n  \x1b[32m${clean} handled cleanly\x1b[0m · \x1b[36m${stored} stored as-typed\x1b[0m · \x1b[31m${broke} broke something\x1b[0m\n`);
