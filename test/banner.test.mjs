import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { MASCOT, renderBanner } from '../lib/banner.mjs';
import { pickLanguage } from '../lib/lang.mjs';

const ANSI = /\x1b\[/;
const CLI = path.join(import.meta.dirname, '..', 'bin', 'flow.mjs');
const terminal = { isTTY: true, columns: 120, env: {} };

test('output that is piped or running in CI never carries the banner', () => {
  assert.equal(renderBanner({ ...terminal, isTTY: false }), '');
  assert.equal(renderBanner({ ...terminal, env: { CI: 'true' } }), '');
  assert.equal(renderBanner({ ...terminal, env: { TERM: 'dumb' } }), '');
});

test('a terminal gets the coloured mascot beside the product details', () => {
  const banner = renderBanner({ ...terminal, version: '1.2.3', cwd: '/work/library' });
  assert.match(banner, ANSI);
  assert.match(banner, /FLOW Harness v1\.2\.3/);
  assert.match(banner, /Workflow skills for coding agents/);
  assert.match(banner, /\/work\/library/);
  const plain = renderBanner({ ...terminal, env: { NO_COLOR: '' }, version: '1.2.3' });
  assert.doesNotMatch(plain, ANSI);
  assert.ok(plain.includes(MASCOT[0].trimEnd()));
});

test('the mascot rows are even so the details stay aligned', () => {
  assert.equal(new Set(MASCOT.map((row) => row.length)).size, 1);
});

test('colour depth follows what the terminal supports', () => {
  assert.match(renderBanner({ ...terminal, env: { COLORTERM: 'truecolor' } }), /38;2;/);
  assert.match(renderBanner({ ...terminal, env: {} }), /38;5;/);
});

test('a narrow terminal falls back to one line and a long path never overflows', () => {
  const narrow = renderBanner({ ...terminal, columns: 30, version: '0.1.0', env: { NO_COLOR: '' } });
  assert.equal(narrow.trim().split('\n').length, 1);
  assert.match(narrow, /FLOW Harness v0\.1\.0/);
  const longPath = `/work/${'deep/'.repeat(40)}library`;
  const lines = renderBanner({ ...terminal, columns: 60, cwd: longPath, env: { NO_COLOR: '' } }).split('\n');
  assert.ok(lines.every((line) => line.length <= 60), lines.join('\n'));
  assert.ok(lines.some((line) => line.includes('library')));
});

test('the language follows the machine and can be forced', () => {
  assert.equal(pickLanguage({ LANG: 'vi_VN.UTF-8' }), 'vi');
  assert.equal(pickLanguage({ LANG: 'en_US.UTF-8' }, undefined, 'vi-VN'), 'en');
  assert.equal(pickLanguage({ LANG: 'C.UTF-8' }, undefined, 'vi-VN'), 'vi');
  assert.equal(pickLanguage({}, undefined, 'fr-FR'), 'en');
  assert.equal(pickLanguage({ LANG: 'vi_VN' }, 'en'), 'en');
  assert.equal(pickLanguage({ LANG: 'en_US' }, 'vi'), 'vi');
  assert.match(renderBanner({ ...terminal, lang: 'vi' }), /Quy trình cho coding agent/);
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
  assert.doesNotMatch(run.stdout, /[▄█▀]/);
  assert.doesNotMatch(run.stdout, ANSI);
});

test('running flow with no arguments outside a terminal prints help and never waits for input', () => {
  const run = spawnSync(process.execPath, [CLI], { encoding: 'utf8', input: '' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /flow setup|setup \[--lang/);
});

test('flow setup outside a terminal explains itself instead of hanging', () => {
  const run = spawnSync(process.execPath, [CLI, 'setup', '--lang', 'en'], { encoding: 'utf8', input: '' });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /needs an interactive terminal/);
});
