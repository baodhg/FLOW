import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { COMMANDS, findCommand, renderAll, renderCommand, renderOverview } from '../lib/help.mjs';

const CLI = path.join(import.meta.dirname, '..', 'bin', 'flow.mjs');

function flow(...args) {
  return spawnSync(process.execPath, [CLI, ...args, '--lang', 'en'], { encoding: 'utf8', input: '' });
}

test('every command the CLI handles is documented and nothing documented is missing', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  const handled = [...source.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]).filter((name) => name !== 'help');
  assert.deepEqual([...new Set(handled)].sort(), COMMANDS.map((c) => c.name).sort());
});

test('the overview stays short: one line per command, no option syntax', () => {
  for (const lang of ['en', 'vi']) {
    const text = renderOverview({ lang });
    const lines = text.split('\n');
    assert.ok(lines.length <= 50, `${lang}: ${lines.length} lines`);
    assert.ok(lines.every((line) => line.length <= 80), lines.find((line) => line.length > 80));
    assert.doesNotMatch(text, /\[--/);
    assert.doesNotMatch(text, /\bhook\b/);
  }
});

test('every command has a summary and usage in both languages', () => {
  for (const command of COMMANDS) {
    assert.ok(command.en && command.vi, command.name);
    assert.ok(command.forms.length > 0, command.name);
    for (const entry of command.forms) {
      assert.ok(entry.use.startsWith(`flow ${command.name}`), entry.use);
      assert.ok(entry.en && entry.vi, entry.use);
    }
    if (!command.hidden) assert.ok(command.group, command.name);
  }
});

test('details wrap long syntax to the terminal and stay readable', () => {
  const lines = renderCommand(findCommand('rules'), { lang: 'vi', columns: 60 }).split('\n');
  assert.ok(lines.every((line) => line.length <= 60), lines.join('\n'));
  assert.equal(lines[0], 'flow rules · Luật dự án phải tuân theo');
  assert.ok(lines.includes('      Thêm luật'));
});

test('help --all keeps the full syntax for agents, including hooks', () => {
  const text = renderAll({ lang: 'en' });
  for (const command of COMMANDS) assert.ok(text.includes(`flow ${command.name}`), command.name);
  assert.match(text, /--commit-body free\|trailers-only/);
  assert.match(text, /flow hook pretool/);
});

test('the CLI routes every way of asking for help', () => {
  assert.match(flow('help').stdout, /Everyday work/);
  assert.match(flow('--help').stdout, /Everyday work/);
  const detail = flow('help', 'plan');
  assert.equal(detail.status, 0);
  assert.match(detail.stdout, /flow plan new <slug>/);
  assert.doesNotMatch(detail.stdout, /Everyday work/);
  assert.match(flow('plan', '--help').stdout, /flow plan new <slug>/);
  assert.match(flow('help', '--all').stdout, /flow wt done/);
});

test('an unknown command says so briefly and points at help', () => {
  for (const args of [['nothing-here'], ['help', 'nothing-here']]) {
    const run = flow(...args);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /Unknown command: nothing-here/);
    assert.ok(run.stdout.split('\n').length <= 3);
  }
});
