import readline from 'node:readline';

export const CANCELLED = Symbol('cancelled');
export const WENT_BACK = Symbol('went-back');

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const UNICODE_SYMBOLS = { title: '◆', done: '◇', pointer: '❯', on: '[✓]', off: '[ ]', selected: '●', unselected: '○' };
const ASCII_SYMBOLS = { title: '*', done: '+', pointer: '>', on: '[x]', off: '[ ]', selected: '(*)', unselected: '( )' };

export function symbolsFor(env = {}, platform = process.platform) {
  if (platform !== 'win32') return env.TERM === 'linux' ? ASCII_SYMBOLS : UNICODE_SYMBOLS;
  const modern = env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuTask || env.TERMINUS_SUBLIME;
  return modern ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
}

export function actionFor(sequence, key = {}) {
  if (key.ctrl && key.name === 'c') return 'cancel';
  if (key.name === 'escape') return 'escape';
  if (key.name === 'left' || key.name === 'backspace') return 'back';
  if (key.name === 'up' || key.name === 'k') return 'up';
  if (key.name === 'down' || key.name === 'j') return 'down';
  if (key.name === 'space' || sequence === ' ') return 'toggle';
  if (key.name === 'return' || key.name === 'enter') return 'submit';
  if (key.name === 'a') return 'all';
  return null;
}

function move(state, step) {
  const size = state.options.length;
  return { ...state, index: (state.index + step + size) % size };
}

export function reduceSelect(state, action) {
  if (action === 'up') return move(state, -1);
  if (action === 'down') return move(state, 1);
  if (action === 'submit') return { ...state, done: true };
  return state;
}

export function selectValue(state) {
  return state.options[state.index].value;
}

export function reduceMulti(state, action) {
  if (action === 'up') return move(state, -1);
  if (action === 'down') return move(state, 1);
  if (action === 'toggle') {
    const options = state.options.map((o, i) => (i === state.index && !o.locked ? { ...o, checked: !o.checked } : o));
    return { ...state, options, error: false };
  }
  if (action === 'all') {
    const free = state.options.filter((o) => !o.locked);
    const target = !free.every((o) => o.checked);
    return { ...state, options: state.options.map((o) => (o.locked ? o : { ...o, checked: target })), error: false };
  }
  if (action === 'submit') {
    if (state.required && !state.options.some((o) => o.checked)) return { ...state, error: true };
    return { ...state, done: true };
  }
  return state;
}

export function multiValue(state) {
  return state.options.filter((o) => o.checked).map((o) => o.value);
}

export function visibleLength(line) {
  return String(line).replace(ANSI, '').length;
}

export function fitLine(line, width) {
  if (visibleLength(line) <= width) return line;
  return `${String(line).replace(ANSI, '').slice(0, Math.max(1, width - 1))}…`;
}

function palette(useColor) {
  const wrap = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { accent: wrap('36'), dim: wrap('2'), bold: wrap('1'), warn: wrap('33') };
}

function optionLine(option, focused, mark, symbols, paints) {
  const pointer = focused ? paints.accent(symbols.pointer) : ' '.repeat(symbols.pointer.length);
  const label = focused ? paints.bold(option.label) : option.label;
  const hint = option.hint ? ` ${paints.dim(option.hint)}` : '';
  return `  ${pointer} ${mark} ${label}${hint}`;
}

export function renderSelect(state, { title, help, symbols, useColor = true }) {
  const paints = palette(useColor);
  const lines = [`${paints.accent(symbols.title)} ${paints.bold(title)}`];
  state.options.forEach((option, i) => {
    const mark = i === state.index ? paints.accent(symbols.selected) : paints.dim(symbols.unselected);
    lines.push(optionLine(option, i === state.index, mark, symbols, paints));
  });
  if (help) lines.push(`  ${paints.dim(help)}`);
  return lines;
}

export function renderMulti(state, { title, help, requiredMessage, count, symbols, useColor = true }) {
  const paints = palette(useColor);
  const lines = [`${paints.accent(symbols.title)} ${paints.bold(title)}`];
  state.options.forEach((option, i) => {
    const mark = option.checked ? paints.accent(symbols.on) : paints.dim(symbols.off);
    lines.push(optionLine(option, i === state.index, mark, symbols, paints));
  });
  if (count) lines.push(`  ${paints.accent(count(multiValue(state).length, state.options.length))}`);
  lines.push(state.error ? `  ${paints.warn(requiredMessage)}` : `  ${paints.dim(help)}`);
  return lines;
}

export function renderAnswer({ title, answer, symbols, useColor = true }) {
  const paints = palette(useColor);
  return [`${paints.dim(symbols.done)} ${title} ${paints.dim(answer)}`];
}

export function runPrompt({ input, output, initial, reduce, render, renderDone, value, columns = 80, canGoBack = false, onLeave = () => {} }) {
  return new Promise((resolve) => {
    let state = initial;
    let drawn = 0;
    const width = Math.max(20, columns - 1);
    const draw = (lines) => {
      const clear = drawn ? `\x1b[${drawn}A\r\x1b[J` : '';
      const fitted = lines.map((line) => fitLine(line, width));
      output.write(`${clear}${fitted.length ? `${fitted.join('\n')}\n` : ''}`);
      drawn = fitted.length;
    };
    const finish = (result) => {
      input.off('keypress', onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      process.off('exit', restoreCursor);
      output.write(SHOW_CURSOR);
      resolve(result);
    };
    const restoreCursor = () => output.write(SHOW_CURSOR);
    function onKey(sequence, key) {
      const action = actionFor(sequence, key);
      if (action === 'cancel' || (action === 'escape' && !canGoBack)) {
        draw(renderDone(state, CANCELLED));
        finish(CANCELLED);
        return;
      }
      if (action === 'back' || action === 'escape') {
        if (!canGoBack) return;
        onLeave(state);
        draw([]);
        finish(WENT_BACK);
        return;
      }
      if (!action) return;
      state = reduce(state, action);
      if (state.done) {
        const result = value(state);
        onLeave(state);
        draw(renderDone(state, result));
        finish(result);
        return;
      }
      draw(render(state));
    }
    readline.emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
    process.on('exit', restoreCursor);
    output.write(HIDE_CURSOR);
    draw(render(state));
  });
}
