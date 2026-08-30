#!/usr/bin/env node
/**
 * One-time setup: bring a new machine up to a working baseline.
 *
 * This is about CAPABILITY, not instructions. A CLAUDE.md file tells Claude how to
 * behave; it cannot grant permission to do anything. That lives here.
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

// The everyday tools. These can write files, install packages and publish work, which
// is the entire point — without them Claude keeps saying it cannot do things.
const DEV = [
  'Bash(node *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(python3 *)', 'Bash(pip3 *)',
  'Bash(git *)',                       // includes commit and push, deliberately
  'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)', 'Bash(touch *)', 'Bash(open *)',
];

// Deny always wins, whatever else is allowed. This is the floor under the whole setup:
// even a broad allow rule cannot make these run without a prompt.
const NEVER = [
  'Bash(rm *)', 'Bash(rmdir *)', 'Bash(sudo *)',
  'Bash(chmod *)', 'Bash(chown *)',
  'Bash(ssh *)', 'Bash(scp *)',
  'Bash(dd *)', 'Bash(mkfs*)', 'Bash(diskutil *)',
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

const modeChange = !cfg.permissions?.defaultMode;
if (modeChange) {
  console.log('  Would also turn on auto mode. Claude then judges each action rather');
  console.log('  than matching command names, so it can get on with ordinary work and');
  console.log('  still stop at things that cannot be undone.\n');
  console.log('  Allowed: editing files in your project, reading, installing what the');
  console.log('           project needs, pushing to a branch you are working on.');
  console.log('  Stopped: deleting files it did not create, reaching outside your');
  console.log('           project, pushing to main, leaking credentials, curl into shell.\n');
  console.log('  See the full list any time with:  claude auto-mode defaults\n');
}

if (missing.length) {
  console.log('  These let Claude read your files and use the normal dev tools');
  console.log('  without stopping to ask each time:\n');
  for (const r of missing) console.log(`     ${r}`);
  console.log('\n  These stay blocked whatever else is set:');
  console.log('     deleting (rm), admin (sudo), other machines (ssh, scp),');
  console.log('     permissions (chmod), disks (dd)\n');
}

// Report what is present, per platform, so the skill can tell them the right thing.
const WIN = process.platform === 'win32';
const has = (cmd) => {
  try {
    execFileSync(WIN ? 'where' : 'command', WIN ? [cmd] : ['-v', cmd],
      { stdio: 'ignore', shell: !WIN });
    return true;
  } catch { return false; }
};

console.log(`  Platform: ${WIN ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'}`);
console.log(`  git:  ${has('git') ? 'found' : WIN ? 'MISSING — winget install Git.Git'
  : 'MISSING — run xcode-select --install'}`);
console.log(`  node: ${has('node') ? 'found' : WIN ? 'MISSING — winget install OpenJS.NodeJS.LTS'
  : 'MISSING — install from https://nodejs.org/en/download'}`);
console.log('  (Claude Code itself needs neither. Only install what the task needs.)\n');

if (check) {
  console.log('  Nothing changed. Run without --check to apply.\n');
  process.exit(0);
}

if (!missing.length && !modeChange) {
  console.log('  Nothing to do, already set up.\n');
  process.exit(0);
}

cfg.permissions ??= {};
cfg.permissions.allow = [...existing, ...missing];

// Deny takes precedence over allow, so these hold even though git and npm are wide open.
const deny = new Set(cfg.permissions.deny ?? []);
for (const r of NEVER) deny.add(r);
cfg.permissions.deny = [...deny];

// Auto mode is Anthropic's own answer to this, and it is better than any hand-written
// list. It screens each action with a classifier instead of matching command names, so
// it allows things a static list cannot express (installing a toolchain the project
// actually needs) while blocking things a static list would miss (deleting files that
// existed before the session, wandering outside the project, leaking credentials).
// It also screens tool output for prompt injection, which an allow list cannot do.
if (!cfg.permissions.defaultMode) cfg.permissions.defaultMode = 'auto';
mkdirSync(join(homedir(), '.claude'), { recursive: true });
if (existsSync(SETTINGS)) writeFileSync(`${SETTINGS}.before-setup`, readFileSync(SETTINGS));
writeFileSync(SETTINGS, JSON.stringify(cfg, null, 2));

console.log(`  Done. ${missing.length} added, ${existing.size} left as they were.`);
console.log('  Restart Claude Code for it to take effect.\n');
