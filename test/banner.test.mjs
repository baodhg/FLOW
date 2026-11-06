import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { artRows, renderBanner } from '../lib/banner.mjs';

const ANSI = /\x1b\[/;
const CLI = path.join(import.meta.dirname, '..', 'bin', 'flow.mjs');
const terminal = { isTTY: true, columns: 120, env: {} };

test('output that is piped or running in CI never carries the banner', () => {
  assert.equal(renderBanner({ ...terminal, isTTY: false }), '');
  assert.equal(renderBanner({ ...terminal, env: { CI: 'true' } }), '');
  assert.equal(renderBanner({ ...terminal, env: { TERM: 'dumb' } }), '');
});

test('a terminal gets coloured art and NO_COLOR removes every colour code', () => {
  const coloured = renderBanner(terminal);
  assert.match(coloured, ANSI);
  assert.match(coloured, /██/);
  const plain = renderBanner({ ...terminal, env: { NO_COLOR: '' } });
  assert.doesNotMatch(plain, ANSI);
  assert.match(plain, /██/);
});

test('colour depth follows what the terminal supports', () => {
  assert.match(renderBanner({ ...terminal, env: { COLORTERM: 'truecolor' } }), /38;2;/);
  assert.match(renderBanner({ ...terminal, env: {} }), /38;5;/);
});

test('a narrow terminal or a name the font cannot draw falls back to one plain line', () => {
  const narrow = renderBanner({ ...terminal, columns: 20, version: '0.1.0' });
  assert.doesNotMatch(narrow, /██/);
  assert.match(narrow, /FLOW/);
  assert.match(narrow, /v0\.1\.0/);
  assert.doesNotMatch(renderBanner({ ...terminal, brand: 'Flow_1' }), /██/);
});

test('any brand drawn from the supported letters renders as five even rows', () => {
  for (const brand of ['FLOW', 'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789', 'A-B C']) {
    const rows = artRows(brand);
    assert.equal(rows.length, 5, brand);
    assert.equal(new Set(rows.map((r) => r.length)).size, 1, brand);
  }
  assert.equal(artRows('FLÔW'), null);
});

test('the version command reports the package version', () => {
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const flag of ['--version', '-v', 'version']) {
    const run = spawnSync(process.execPath, [CLI, flag], { encoding: 'utf8' });
    assert.equal(run.status, 0, flag);
    assert.equal(run.stdout.trim(), version, flag);
  }
});

test('install stays free of art and colour when its output is captured', () => {
  const run = spawnSync(process.execPath, [CLI, 'install', '--dry'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.doesNotMatch(run.stdout, /██/);
  assert.doesNotMatch(run.stdout, ANSI);
});
