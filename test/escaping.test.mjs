import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultLeakPatterns, findLeaks } from '../lib/hygiene.mjs';
import { mdRow } from '../lib/store.mjs';
import { escapeRegExp } from '../lib/util.mjs';
import { harnessPatterns } from '../lib/workspace.mjs';

const CLI = path.join(import.meta.dirname, '..', 'bin', 'flow.mjs');
const TRICKY_NAME = 'notes+c[1]\\x.md';

test('escapeRegExp makes any text match only itself', () => {
  for (const text of ['a.b', 'c++', '[x', '(y)', 'a|b', '^$', 'a\\b', '{1}', '?*']) {
    assert.ok(new RegExp(`^${escapeRegExp(text)}$`).test(text), text);
  }
  assert.equal(new RegExp(`^${escapeRegExp('a.b')}$`).test('axb'), false);
});

test('a module context name with regex characters is matched literally', () => {
  const profile = { trackHarness: false, layout: { moduleContext: TRICKY_NAME } };
  const patterns = harnessPatterns({ profile }).map((p) => new RegExp(p));
  assert.ok(patterns.some((re) => re.test(`src/${TRICKY_NAME}`)));
  assert.equal(patterns.some((re) => re.test('src/notessc1x.md')), false);
});

test('leak checks accept a tricky context name and still find it', () => {
  const profile = { trackHarness: false, layout: { moduleContext: 'c++.md' } };
  const patterns = defaultLeakPatterns(profile);
  assert.equal(findLeaks([{ text: 'see c++.md for details' }], patterns).length, 1);
  assert.equal(findLeaks([{ text: 'see ccc.md for details' }], patterns).length, 0);
});

test('table cells escape backslashes as well as pipes', () => {
  assert.equal(mdRow(['a|b']), '| a\\|b |');
  assert.equal(mdRow(['a\\|b']), '| a\\\\\\|b |');
  assert.equal(mdRow(['path\\to']), '| path\\\\to |');
});

test('an unusual --print value for gates is treated as text and does not crash', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'escape-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, AGENT_FLOW_USER: path.join(repo, 'none.json') } });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
  assert.equal(run('init', '--gates', 'all').status, 0);
  for (const odd of ['(', '([', '.*']) {
    const result = run('gates', '--all', '--print', odd);
    assert.equal(result.status, 0, `${odd}: ${result.stderr}`);
    assert.match(result.stdout, /không có mục ##/, odd);
    assert.doesNotMatch(result.stdout, /- \[ \]/, `${odd} must not print a checklist`);
  }
  const normal = run('gates', '--all', '--print', 'explore');
  assert.equal(normal.status, 0, normal.stderr);
  assert.match(normal.stdout, /- \[ \]/);
});
