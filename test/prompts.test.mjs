import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  CANCELLED,
  actionFor,
  fitLine,
  multiValue,
  reduceMulti,
  reduceSelect,
  renderMulti,
  runPrompt,
  selectValue,
  symbolsFor,
  visibleLength,
} from '../lib/prompts.mjs';

const options = () => [
  { value: 'a', label: 'A', checked: true },
  { value: 'b', label: 'B', checked: false, locked: false },
  { value: 'c', label: 'C', checked: true, locked: true },
];

test('keys map to actions, including cancel, back and Escape', () => {
  assert.equal(actionFor('\u0003', { ctrl: true, name: 'c' }), 'cancel');
  assert.equal(actionFor('\u001b', { name: 'escape' }), 'escape');
  assert.equal(actionFor(undefined, { name: 'left' }), 'back');
  assert.equal(actionFor('\u007f', { name: 'backspace' }), 'back');
  assert.equal(actionFor(undefined, { name: 'up' }), 'up');
  assert.equal(actionFor('j', { name: 'j' }), 'down');
  assert.equal(actionFor(' ', { name: 'space' }), 'toggle');
  assert.equal(actionFor('\r', { name: 'return' }), 'submit');
  assert.equal(actionFor('z', { name: 'z' }), null);
});

test('moving wraps around both ends of a list', () => {
  const start = { index: 0, options: options() };
  assert.equal(reduceSelect(start, 'up').index, 2);
  assert.equal(reduceSelect({ ...start, index: 2 }, 'down').index, 0);
  assert.equal(selectValue(reduceSelect(start, 'down')), 'b');
});

test('toggling changes a free option and never a locked one', () => {
  const start = { index: 1, options: options() };
  assert.deepEqual(multiValue(reduceMulti(start, 'toggle')), ['a', 'b', 'c']);
  assert.deepEqual(multiValue(reduceMulti({ ...start, index: 2 }, 'toggle')), ['a', 'c']);
});

test('select all selects everything, then clears all but locked options', () => {
  const all = reduceMulti({ index: 0, options: options() }, 'all');
  assert.deepEqual(multiValue(all), ['a', 'b', 'c']);
  assert.deepEqual(multiValue(reduceMulti(all, 'all')), ['c']);
});

test('a required list refuses to submit empty and shows why', () => {
  const empty = { index: 0, required: true, options: [{ value: 'a', label: 'A', checked: false }] };
  const refused = reduceMulti(empty, 'submit');
  assert.equal(refused.done, undefined);
  assert.equal(refused.error, true);
  const symbols = symbolsFor({ WT_SESSION: '1' }, 'win32');
  assert.ok(renderMulti(refused, { title: 'T', help: 'help', requiredMessage: 'pick one', symbols, useColor: false }).includes('  pick one'));
  assert.equal(reduceMulti(reduceMulti(refused, 'toggle'), 'submit').done, true);
});

test('a multi-select shows each box and how many are selected', () => {
  const symbols = symbolsFor({ WT_SESSION: '1' }, 'win32');
  const lines = renderMulti({ index: 1, options: options() }, { title: 'T', help: 'h', requiredMessage: 'r', count: (n, total) => `${n}/${total}`, symbols, useColor: false });
  assert.ok(lines.some((line) => line.includes('[✓] A')));
  assert.ok(lines.some((line) => line.includes('[ ] B')));
  assert.ok(lines.includes('  2/3'));
});

test('symbols fall back to ASCII on consoles that may not draw them', () => {
  assert.equal(symbolsFor({}, 'win32').on, '[x]');
  assert.equal(symbolsFor({ WT_SESSION: 'x' }, 'win32').on, '[✓]');
  assert.equal(symbolsFor({ TERM: 'xterm' }, 'linux').on, '[✓]');
  assert.equal(symbolsFor({ TERM: 'linux' }, 'linux').on, '[x]');
});

test('long lines are cut to the terminal width so redraws stay on one row', () => {
  const line = `\x1b[36m${'x'.repeat(100)}\x1b[0m`;
  assert.equal(visibleLength(line), 100);
  assert.ok(visibleLength(fitLine(line, 40)) <= 40);
  assert.equal(fitLine('short', 40), 'short');
});

function promptHarness(initial) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (d) => (written += d));
  const done = runPrompt({
    input,
    output,
    initial,
    reduce: reduceSelect,
    value: selectValue,
    render: (s) => [`at ${s.index}`],
    renderDone: (s, r) => [r === CANCELLED ? 'cancelled' : `chose ${selectValue(s)}`],
  });
  return { input, done, text: () => written };
}

test('a prompt reads real key sequences and restores the cursor when done', async () => {
  const h = promptHarness({ index: 0, options: options() });
  h.input.write('\x1b[B');
  await new Promise((r) => setTimeout(r, 10));
  h.input.write('\r');
  assert.equal(await h.done, 'b');
  assert.match(h.text(), /chose b/);
  assert.ok(h.text().endsWith('\x1b[?25h'));
});

test('Ctrl+C cancels a prompt and restores the cursor', async () => {
  const h = promptHarness({ index: 0, options: options() });
  h.input.write('\u0003');
  assert.equal(await h.done, CANCELLED);
  assert.ok(h.text().endsWith('\x1b[?25h'));
});
