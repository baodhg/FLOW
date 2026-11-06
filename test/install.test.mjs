import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const PACK = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PACK, 'bin', 'flow.mjs');
const SKILL = path.join(PACK, 'skills', 'flow');

function fakeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const d of ['.claude', '.codex', '.gemini']) fs.mkdirSync(path.join(home, d));
  return home;
}

function flow(home, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
}

test('upgrading from the old command name replaces its shims and hooks and keeps foreign files', (t) => {
  const home = fakeHome(t);
  const binDir = path.join(home, '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'flowctl'), '#!/bin/sh\nexec node "/old/bin/flowctl.mjs" "$@"\n');
  fs.writeFileSync(path.join(binDir, 'flowctl.cmd'), 'someone else\n');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "/old/bin/flowctl.mjs" hook pretool' }] }] } }));
  assert.equal(flow(home, 'install', '--hooks').status, 0);
  assert.equal(fs.existsSync(path.join(binDir, 'flowctl')), false);
  assert.equal(fs.readFileSync(path.join(binDir, 'flowctl.cmd'), 'utf8'), 'someone else\n');
  assert.ok(fs.existsSync(path.join(binDir, 'flow')));
  const settings = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.equal(settings.includes('flowctl.mjs'), false);
  assert.match(settings, /bin\/flow\.mjs/);
});

test('hooks installed under the old entry file keep working', () => {
  const run = spawnSync(process.execPath, [path.join(PACK, 'bin', 'flowctl.mjs'), '--version'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^\d+\.\d+\.\d+/);
});

test('install links skills and uninstall removes everything it added', (t) => {
  const home = fakeHome(t);
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# mine\n');
  assert.equal(flow(home, 'install').status, 0);
  const link = path.join(home, '.claude', 'skills', 'flow');
  assert.ok(fs.existsSync(path.join(link, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'flow-post', 'SKILL.md')));
  assert.match(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), /flow install/);
  assert.equal(flow(home, 'uninstall').status, 0);
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8').trim(), '# mine');
  assert.ok(fs.existsSync(SKILL), 'the pack itself is untouched');
});

test('a previous install location is replaced and an unrelated skill is left alone', (t) => {
  const home = fakeHome(t);
  const oldPack = path.join(home, 'old-pack');
  fs.mkdirSync(path.join(oldPack, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(oldPack, 'bin', 'flow.mjs'), '');
  fs.mkdirSync(path.join(oldPack, 'skills', 'flow'), { recursive: true });
  const skillsDir = path.join(home, '.claude', 'skills');
  fs.mkdirSync(skillsDir);
  fs.symlinkSync(path.join(oldPack, 'skills', 'flow'), path.join(skillsDir, 'flow'), 'junction');
  fs.mkdirSync(path.join(skillsDir, 'flow-plan'));
  fs.writeFileSync(path.join(skillsDir, 'flow-plan', 'mine.md'), 'keep');
  assert.equal(flow(home, 'install').status, 0);
  assert.equal(path.resolve(fs.readlinkSync(path.join(skillsDir, 'flow'))).toLowerCase(), SKILL.toLowerCase());
  assert.equal(fs.readFileSync(path.join(skillsDir, 'flow-plan', 'mine.md'), 'utf8'), 'keep');
});

test('a link left dangling by removing the package is repaired', (t) => {
  const home = fakeHome(t);
  const gone = path.join(home, 'gone', 'skills', 'flow');
  fs.mkdirSync(gone, { recursive: true });
  const skillsDir = path.join(home, '.claude', 'skills');
  fs.mkdirSync(skillsDir);
  fs.symlinkSync(gone, path.join(skillsDir, 'flow'), 'junction');
  fs.rmSync(path.join(home, 'gone'), { recursive: true, force: true });
  assert.equal(flow(home, 'install').status, 0);
  assert.ok(fs.existsSync(path.join(skillsDir, 'flow', 'SKILL.md')));
});

test('init works when the repo is reached through a linked or aliased path', (t) => {
  const home = fakeHome(t);
  const repo = path.join(home, 'real-repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const alias = path.join(home, 'alias-repo');
  fs.symlinkSync(repo, alias, 'junction');
  const run = spawnSync(process.execPath, [CLI, 'init', '--name', 'demo'], { cwd: alias, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(fs.existsSync(path.join(repo, '.flow', 'profile.json')));
});

test('the bridge block from an older header is replaced, not duplicated', (t) => {
  const home = fakeHome(t);
  const file = path.join(home, '.claude', 'CLAUDE.md');
  fs.writeFileSync(file, '# mine\n\n## agent-flow — quy trình toàn cục (do một đường dẫn cũ quản lý)\n\nnội dung cũ\n\n_(hết khối agent-flow)_\n');
  assert.equal(flow(home, 'install').status, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.match(/quy trình toàn cục/g).length, 1);
  assert.equal(text.includes('nội dung cũ'), false);
});
