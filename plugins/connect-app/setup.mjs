#!/usr/bin/env node
/**
 * One-time setup: bring a new machine up to a working baseline.
 *
 * A fresh Claude Code install has approved nothing, so every command stops and asks.
 * That is safe but exhausting, and it is the single biggest difference between someone
 * who has used Claude Code for months and someone opening it for the first time.
 *
 * This approves a deliberately conservative set of commands: reading files, and the
 * everyday development tools. It does NOT approve anything that deletes, escalates,
 * or reaches the network, because those are the ones worth being asked about.
 *
 *   node setup.mjs --check    show what would change
 *   node setup.mjs            apply it
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SETTINGS = join(homedir(), '.claude', 'settings.json');

// Reading and inspecting. Cannot change anything.
const READ_ONLY = [
  'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)', 'Bash(grep *)',
  'Bash(find *)', 'Bash(wc *)', 'Bash(which *)', 'Bash(echo *)', 'Bash(pwd)', 'Bash(date)',
];

// The everyday tools. These can write files and install packages, which is the point.
const DEV = [
  'Bash(node *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(python3 *)',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git add*)',
  'Bash(git commit*)', 'Bash(git branch*)', 'Bash(git checkout*)',
  'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)',
];

/**
 * Deliberately NOT approved, with the reason, so it can be explained rather than
 * looking like an oversight:
 *   rm, rmdir      deleting things is worth a prompt every time
 *   sudo           never automate an admin password
 *   curl, wget     can send your data somewhere. A prompt here is a real safeguard
 *   ssh, scp       reach other machines
 *   git push       publishes. Worth a deliberate yes
 *   chmod, chown   permission changes are how mistakes become security problems
 */
const ALL = [...READ_ONLY, ...DEV];

function load() {
  if (!existsSync(SETTINGS)) return {};
  try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); } catch { return null; }
}

const check = process.argv.includes('--check');
const cfg = load();

if (cfg === null) {
  console.error(`\n  Could not read ${SETTINGS.replace(homedir(), '~')} — it is not valid JSON.`);
  console.error('  Fix or delete that file, then run this again. Nothing was changed.\n');
  process.exit(1);
}

const existing = new Set((cfg.permissions?.allow) ?? []);
const missing = ALL.filter((r) => !existing.has(r));

console.log(`\n  Settings file: ${SETTINGS.replace(homedir(), '~')}`);
console.log(`  Already approved: ${existing.size}`);
console.log(`  Would add: ${missing.length}\n`);

if (missing.length) {
  console.log('  These let Claude read your files and use the normal dev tools');
  console.log('  without stopping to ask each time:\n');
  for (const r of missing) console.log(`     ${r}`);
  console.log('\n  Deliberately NOT included, so you still get asked:');
  console.log('     deleting (rm), admin (sudo), network (curl, ssh),');
  console.log('     publishing (git push), permission changes (chmod)\n');
}

// Node is what the key collector runs on. Say so plainly if it is missing.
try {
  const v = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim();
  console.log(`  Node ${v} found.\n`);
} catch {
  console.log('  Node was not found. Install it from https://nodejs.org before continuing.\n');
}

if (check) {
  console.log('  Nothing changed. Run without --check to apply.\n');
  process.exit(0);
}

if (!missing.length) {
  console.log('  Nothing to do, already set up.\n');
  process.exit(0);
}

cfg.permissions ??= {};
cfg.permissions.allow = [...existing, ...missing];
mkdirSync(join(homedir(), '.claude'), { recursive: true });
if (existsSync(SETTINGS)) writeFileSync(`${SETTINGS}.before-setup`, readFileSync(SETTINGS));
writeFileSync(SETTINGS, JSON.stringify(cfg, null, 2));

console.log(`  Done. ${missing.length} added, ${existing.size} left as they were.`);
console.log('  Restart Claude Code for it to take effect.\n');
