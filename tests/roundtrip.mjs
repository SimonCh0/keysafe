/** Round-trip audit: write via the tool, read back via BOTH .env consumers. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Windows locks a process's working directory, so a sandbox can still be busy for
 *  a moment after the child exits. Retry instead of crashing the whole run. */
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  catch { /* a leftover temp dir is harmless; the OS clears it */ }
}

const TOOL=new URL('../plugins/connect-app/connect.mjs',import.meta.url).pathname;
let pass=0,fail=0;
const ok=n=>{console.log(`  \x1b[32mOK  \x1b[0m ${n}`);pass++};
const bad=(n,d)=>{console.log(`  \x1b[31mFAIL\x1b[0m ${n}\n         ${d}`);fail++};

async function write(value, multiline=false, secret=true){
  const d=join(tmpdir(),`rt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(d,'home'),{recursive:true});mkdirSync(join(d,'proj'),{recursive:true});mkdirSync(join(d,'bin'),{recursive:true});
  for(const n of ['open','xdg-open'])writeFileSync(join(d,'bin',n),'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(join(d,'proj','.env'),'BEFORE=first\n');
  const spec={service:'RT',route:'env',fields:[{name:'K',label:'Key',secret,...(multiline?{multiline:true}:{})}]};
  const c=spawn(process.execPath,[TOOL,'--browser'],{cwd:join(d,'proj'),
    env:{...process.env,HOME:join(d,'home'),PATH:`${join(d,'bin')}:${process.env.PATH}`},stdio:['pipe','pipe','pipe']});
  c.stdin.write(JSON.stringify(spec));c.stdin.end();
  let out='';c.stdout.on('data',x=>out+=x);
  const url=await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('no server')),6000);
    c.stdout.on('data',()=>{const m=out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([a-f0-9]+)/);if(m){clearTimeout(t);res({base:`http://127.0.0.1:${m[1]}`,token:m[2]})}})});
  await fetch(`${url.base}/save?t=${url.token}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({K:value})});
  await new Promise(r=>{const t=setTimeout(()=>{c.kill();r()},4000);c.on('exit',()=>{clearTimeout(t);r()})});
  return {dir:d, env:readFileSync(join(d,'proj','.env'),'utf8'), path:join(d,'proj','.env')};
}

const CASES = [
  ['plain token','sk_abc123DEF'],
  ['with spaces (non-secret field)','hat pack team'],
  ['dollar + backtick','a$b`c'],
  ['single quote inside',"it's-a-key"],
  ['double quote inside','say"hello"'],
  ['backslash','path\\to\\key'],
  ['base64 padding','aGVsbG8+d29ybGQ/Zm9v=='],
  ['semicolon + pipe','a;b|c&d'],
  ['hash (comment char)','key#notacomment'],
  ['unicode','clé-café-日本'],
];

console.log('\n\x1b[1mRound-trip audit: does the value survive both .env parsers?\x1b[0m\n');
for (const [name,val] of CASES){
  // A secret containing a space is refused as a copy error, so spaced values are
  // exercised on a non-secret field, which is where they legitimately occur.
  const {dir,env,path}=await write(val, false, !/\s/.test(val));
  let shell=null,node=null;
  try{ shell=execFileSync('sh',['-c',`set -a; . "${path}"; printf %s "$K"`],{encoding:'utf8'}); }catch(e){ shell='<sourcing failed>'; }
  try{ node=execFileSync(process.execPath,['--env-file',path,'-e','process.stdout.write(process.env.K||"")'],{encoding:'utf8'}); }catch(e){ node='<parse failed>'; }
  const okShell=shell===val, okNode=node===val;
  const keptOther=/^BEFORE=first$/m.test(env);
  if(okShell&&okNode&&keptOther) ok(`${name}`);
  else bad(name, `shell=${JSON.stringify(shell)} node=${JSON.stringify(node)} expected=${JSON.stringify(val)} otherKeyKept=${keptOther}\n         line: ${JSON.stringify(env.split('\n').find(l=>l.startsWith('K=')))}`);
  cleanup(dir);
}

// multi-line + idempotency
const pem='-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----';
{
  const {dir,env,path}=await write(pem,true);
  let shell=null;
  try{ shell=execFileSync('sh',['-c',`set -a; . "${path}"; printf %s "$K"`],{encoding:'utf8'}); }catch(e){ shell='<failed>'; }
  const node=execFileSync(process.execPath,['--env-file',path,'-e','process.stdout.write(process.env.K||"")'],{encoding:'utf8'});
  (shell===pem&&node===pem) ? ok('multi-line PEM round-trips through both') : bad('multi-line PEM', `shell match=${shell===pem} node match=${node===pem}`);
  cleanup(dir);
}
console.log(`\n${fail===0?'\x1b[32m':'\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`);
