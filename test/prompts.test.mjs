import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  CANCELLED,
  WENT_BACK,
  actionFor,
  fitLine,
  multiValue,
  progressBar,
  reduceMulti,
  reduceSelect,
  renderMulti,
  renderSelect,
  runPrompt,
  selectValue,
  startSpinner,
  symbolsFor,
  visibleLength,
  wrapText,
} from '../lib/prompts.mjs';

const options = () => [
  { value: 'a', label: 'A', checked: true },
  { value: 'b', label: 'B', checked: false, locked: false },
  { value: 'c', label: 'C', checked: true, locked: true },
];
const modern = symbolsFor({ WT_SESSION: '1' }, 'win32');

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
  assert.ok(renderMulti(refused, { title: 'T', help: 'help', requiredMessage: 'pick one', symbols: modern, useColor: false }).includes('  pick one'));
  assert.equal(reduceMulti(reduceMulti(refused, 'toggle'), 'submit').done, true);
});

test('a multi-select shows each box and how many are selected', () => {
  const lines = renderMulti({ index: 1, options: options() }, { title: 'T', help: 'h', requiredMessage: 'r', count: (n, total) => `${n}/${total}`, symbols: modern, useColor: false });
  assert.ok(lines.some((line) => line.includes('[✓] A')));
  assert.ok(lines.some((line) => line.includes('[ ] B')));
  assert.ok(lines.includes('  2/3'));
});

test('options with a detail show it on their own wrapped lines under the label', () => {
  const state = { index: 0, options: [{ value: 1, label: 'One', detail: 'word '.repeat(30).trim() }, { value: 2, label: 'Two' }] };
  const lines = renderSelect(state, { title: 'Title', why: 'Why this matters', help: 'help', symbols: modern, useColor: false, width: 50 });
  assert.equal(lines[0], '  Title');
  assert.equal(lines[1], '  Why this matters');
  assert.ok(lines.some((line) => /^\s+❯ ● One$/.test(line)));
  assert.ok(lines.filter((line) => /^\s+word/.test(line)).length > 1);
  assert.ok(lines.every((line) => line.length <= 50), lines.join('\n'));
});

test('text wraps on words and the progress bar reflects the step', () => {
  assert.deepEqual(wrapText('one two three', 7), ['one two', 'three']);
  assert.equal(progressBar(1, 2, { symbols: modern, useColor: false, size: 4 }), '━━──');
  assert.equal(progressBar(2, 2, { symbols: modern, useColor: false, size: 4 }), '━━━━');
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

function capturedOutput() {
  const output = new PassThrough();
  let written = '';
  output.on('data', (d) => (written += d));
  return { output, text: () => written };
}

test('a spinner animates until it stops, then leaves one result line and the cursor back', async () => {
  const { output, text } = capturedOutput();
  const spinner = startSpinner({ output, label: 'Working', symbols: modern, useColor: false, interval: 5 });
  await new Promise((r) => setTimeout(r, 60));
  spinner.succeed('Finished');
  const frames = new Set(modern.spinner.filter((frame) => text().includes(`${frame} Working`)));
  assert.ok(frames.size >= 3, `saw ${frames.size} frames`);
  assert.ok(text().endsWith('\r\x1b[K  ✓ Finished\n\x1b[?25h'));
  const after = text().length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(text().length, after, 'nothing is drawn after stopping');
  assert.equal(process.listenerCount('SIGINT'), 0, 'the interrupt handler is removed');
});

test('a failed spinner marks the failure and consoles without Unicode still animate', async () => {
  const { output, text } = capturedOutput();
  const ascii = symbolsFor({}, 'win32');
  const spinner = startSpinner({ output, label: 'Working', symbols: ascii, useColor: false, interval: 5 });
  await new Promise((r) => setTimeout(r, 30));
  spinner.fail('Stopped');
  assert.match(text(), /[|/\\-] Working/);
  assert.ok(text().includes('  x Stopped\n'));
});

function promptHarness(initial, extra = {}) {
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
    ...extra,
  });
  return { input, done, text: () => written };
}

test('a prompt reads real key sequences, erases itself and restores the cursor', async () => {
  const h = promptHarness({ index: 0, options: options() });
  h.input.write('\x1b[B');
  await new Promise((r) => setTimeout(r, 10));
  h.input.write('\r');
  assert.equal(await h.done, 'b');
  assert.match(h.text(), /\x1b\[1A\r\x1b\[J\x1b\[\?25h$/);
});

test('Ctrl+C cancels a prompt and restores the cursor', async () => {
  const h = promptHarness({ index: 0, options: options() });
  h.input.write('\u0003');
  assert.equal(await h.done, CANCELLED);
  assert.ok(h.text().endsWith('\x1b[?25h'));
});

test('going back is ignored on the first step and reported on later ones', async () => {
  const first = promptHarness({ index: 0, options: options() });
  first.input.write('\x1b[D');
  await new Promise((r) => setTimeout(r, 10));
  first.input.write('\r');
  assert.equal(await first.done, 'a');
  let left;
  const later = promptHarness({ index: 0, options: options() }, { canGoBack: true, onLeave: (s) => (left = s) });
  later.input.write('\x1b[D');
  assert.equal(await later.done, WENT_BACK);
  assert.equal(left.index, 0);
});
