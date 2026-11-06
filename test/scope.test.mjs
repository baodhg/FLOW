import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { describeChanges, installArgs, runWizard, stringsFor } from '../lib/wizard.mjs';

const PACK = path.resolve(import.meta.dirname, '..');
const INSTALL = path.join(PACK, 'install.mjs');
const TEAM_FILES = { 'AGENTS.md': 'team agents\n', 'GEMINI.md': 'team gemini\n', 'CLAUDE.md': 'team claude\n', 'src/index.js': 'export {};\n' };
const ENTER = '\r';
const DOWN = '\x1b[B';
const CTRL_C = '\u0003';

function sandbox(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scope-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const repo = path.join(base, 'repo');
  for (const dir of ['.claude', '.codex', '.gemini']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  for (const [name, text] of Object.entries(TEAM_FILES)) fs.writeFileSync(path.join(repo, name), text);
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return { home, repo, env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '', CI: '' } };
}

function git(cwd, ...args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function install(box, ...args) {
  return spawnSync(process.execPath, [INSTALL, ...args], { cwd: box.repo, encoding: 'utf8', env: box.env });
}

function assertTeamFilesUntouched(repo) {
  for (const [name, text] of Object.entries(TEAM_FILES)) assert.equal(fs.readFileSync(path.join(repo, name), 'utf8'), text, name);
}

test('a project install leaves git completely clean and changes no team file', (t) => {
  const box = sandbox(t);
  const run = install(box, '--scope', 'project', '--hooks');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(fs.existsSync(path.join(box.repo, '.claude', 'skills', 'flow', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(box.repo, '.agents', 'skills', 'flow', 'SKILL.md')));
  assert.match(fs.readFileSync(path.join(box.repo, 'CLAUDE.local.md'), 'utf8'), /flow where/);
  assert.match(fs.readFileSync(path.join(box.repo, '.claude', 'settings.local.json'), 'utf8'), /hook pretool/);
  assert.equal(git(box.repo, 'status', '--porcelain'), '');
  assertTeamFilesUntouched(box.repo);
});

test('a project install does not touch anything in the home folder', (t) => {
  const box = sandbox(t);
  const before = fs.readdirSync(box.home, { recursive: true }).sort();
  assert.equal(install(box, '--scope', 'project', '--hooks').status, 0);
  assert.deepEqual(fs.readdirSync(box.home, { recursive: true }).sort(), before);
});

test('uninstalling from a project removes every trace and only that', (t) => {
  const box = sandbox(t);
  const excludeFile = path.join(box.repo, '.git', 'info', 'exclude');
  const excludeBefore = fs.readFileSync(excludeFile, 'utf8');
  assert.equal(install(box, '--scope', 'project', '--hooks').status, 0);
  const run = install(box, '--uninstall', '--scope', 'project');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const gone of ['.claude', '.agents', 'CLAUDE.local.md']) assert.equal(fs.existsSync(path.join(box.repo, gone)), false, gone);
  assert.equal(fs.readFileSync(excludeFile, 'utf8'), excludeBefore);
  assert.equal(git(box.repo, 'status', '--porcelain'), '');
  assertTeamFilesUntouched(box.repo);
});

test('your own private notes and settings survive install and uninstall', (t) => {
  const box = sandbox(t);
  const notes = path.join(box.repo, 'CLAUDE.local.md');
  const settings = path.join(box.repo, '.claude', 'settings.local.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(notes, '# my notes\n');
  fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
  assert.equal(install(box, '--scope', 'project', '--hooks').status, 0);
  assert.equal(install(box, '--uninstall', '--scope', 'project').status, 0);
  assert.equal(fs.readFileSync(notes, 'utf8').trim(), '# my notes');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { permissions: { allow: ['Bash(ls)'] } });
});

test('a private-named file the team actually tracks is left alone and reported', (t) => {
  const box = sandbox(t);
  fs.writeFileSync(path.join(box.repo, 'CLAUDE.local.md'), 'tracked by the team\n');
  git(box.repo, 'add', '-A');
  git(box.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'team file');
  const run = install(box, '--scope', 'project');
  assert.equal(run.status, 0);
  assert.equal(fs.readFileSync(path.join(box.repo, 'CLAUDE.local.md'), 'utf8'), 'tracked by the team\n');
  assert.match(run.stdout, /đang được git theo dõi/);
  assert.equal(git(box.repo, 'status', '--porcelain'), '');
});

test('choosing only Codex adds its skills and no Claude files or hooks', (t) => {
  const box = sandbox(t);
  assert.equal(install(box, '--scope', 'project', '--agents', 'codex', '--hooks').status, 0);
  assert.ok(fs.existsSync(path.join(box.repo, '.agents', 'skills', 'flow')));
  for (const absent of ['.claude', 'CLAUDE.local.md', 'AGENTS.override.md']) assert.equal(fs.existsSync(path.join(box.repo, absent)), false, absent);
  assert.equal(git(box.repo, 'status', '--porcelain'), '');
});

test('project scope works from a subfolder and targets the repository root', (t) => {
  const box = sandbox(t);
  const run = spawnSync(process.execPath, [INSTALL, '--scope', 'project'], { cwd: path.join(box.repo, 'src'), encoding: 'utf8', env: box.env });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(fs.existsSync(path.join(box.repo, '.agents', 'skills', 'flow')));
  assert.equal(fs.existsSync(path.join(box.repo, 'src', '.agents')), false);
});

test('project scope outside a repository and unknown scopes stop before changing anything', (t) => {
  const box = sandbox(t);
  const outside = path.join(path.dirname(box.repo), 'plain-folder');
  fs.mkdirSync(outside);
  const noRepo = spawnSync(process.execPath, [INSTALL, '--scope', 'project'], { cwd: outside, encoding: 'utf8', env: box.env });
  assert.equal(noRepo.status, 2);
  assert.match(noRepo.stdout, /cần chạy trong một git repo/);
  assert.deepEqual(fs.readdirSync(outside), []);
  const unknown = install(box, '--scope', 'galaxy');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /--scope chỉ nhận/);
  assert.equal(fs.existsSync(path.join(box.home, '.claude', 'skills')), false);
});

test('a machine-wide uninstall does not reach into a project install', (t) => {
  const box = sandbox(t);
  assert.equal(install(box, '--scope', 'project').status, 0);
  assert.equal(install(box, '--uninstall').status, 0);
  assert.ok(fs.existsSync(path.join(box.repo, '.agents', 'skills', 'flow', 'SKILL.md')));
});

async function play(keys, options) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (d) => (text += d));
  const run = runWizard({ input, output, packageDir: PACK, version: '9.9.9', lang: 'en', columns: 100, viaNpx: false, interactive: true, ...options });
  for (const key of keys) {
    await new Promise((r) => setTimeout(r, 15));
    input.write(key);
  }
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`wizard is still waiting for a key:\n${text}`)), 8000);
  });
  try {
    return { code: await Promise.race([run, stalled]), text };
  } finally {
    clearTimeout(timer);
  }
}

test('the wizard offers the current project and installs only there', async (t) => {
  const box = sandbox(t);
  const { code, text } = await play([DOWN, ENTER, ENTER, ENTER, ENTER, ENTER], { home: box.home, env: box.env, cwd: path.join(box.repo, 'src') });
  assert.equal(code, 0, text);
  assert.match(text, /Where should the skills work\?/);
  assert.ok(text.includes(`Only ${box.repo}`) || text.includes('Only this project'));
  assert.match(text, /Keep all of this out of git/);
  assert.match(text, /Remove from this project: flow uninstall --scope project/);
  assert.ok(fs.existsSync(path.join(box.repo, '.claude', 'skills', 'flow')));
  assert.equal(fs.existsSync(path.join(box.home, '.claude', 'skills')), false);
  assert.equal(git(box.repo, 'status', '--porcelain'), '');
  assertTeamFilesUntouched(box.repo);
});

test('the wizard defaults to machine-wide and skips the question outside a repository', async (t) => {
  const box = sandbox(t);
  const inside = await play([ENTER, ENTER, ENTER, ENTER, ENTER], { home: box.home, env: box.env, cwd: box.repo });
  assert.equal(inside.code, 0, inside.text);
  assert.ok(fs.existsSync(path.join(box.home, '.claude', 'skills', 'flow')));
  assert.equal(fs.existsSync(path.join(box.repo, '.claude')), false);
  const outside = await play([ENTER, ENTER, ENTER, CTRL_C], { home: box.home, env: box.env, cwd: path.dirname(box.repo) });
  assert.doesNotMatch(outside.text, /Where should the skills work\?/);
});

test('with only Gemini in a project the hooks question disappears and the limits are stated', async (t) => {
  const box = sandbox(t);
  fs.rmSync(path.join(box.home, '.claude'), { recursive: true });
  fs.rmSync(path.join(box.home, '.codex'), { recursive: true });
  const { code, text } = await play([DOWN, ENTER, ENTER, ENTER, ENTER], { home: box.home, env: box.env, cwd: box.repo });
  assert.equal(code, 0, text);
  assert.doesNotMatch(text, /automatic protection/);
  assert.match(text, /only when you trust this folder/);
});

test('helpers carry the scope through', () => {
  assert.deepEqual(installArgs({ agents: ['claude'], skills: ['flow'], allSkills: ['flow'], hooks: false, scope: 'project', root: '/r' }), ['--agents', 'claude', '--scope', 'project', '--dir', '/r']);
  const lines = describeChanges({ agents: ['claude', 'codex'], skills: ['flow'], hooks: true, scope: 'project' }, { home: '/none', strings: stringsFor('en'), version: '1.0.0', viaNpx: false });
  assert.ok(lines.includes('Add hooks to .claude/settings.local.json, your private file'));
  assert.ok(lines.some((l) => l.includes('Codex gets the skills only')));
  assert.equal(lines.some((l) => l.includes('~/')), false);
});
