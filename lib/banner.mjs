export const PRODUCT_NAME = 'FLOW Harness';

export const TAGLINES = {
  en: 'Workflow skills for coding agents',
  vi: 'Quy trình cho coding agent',
};

export const MASCOT = [
  '   ▄██▄      ▄▄ ',
  ' ▄█▀  ▀█▄  ▄█▀  ',
  ' ▀      ▀██▀    ',
  '   ▄██▄      ▄▄ ',
  ' ▄█▀  ▀█▄  ▄█▀  ',
  ' ▀      ▀██▀    ',
];

const GRADIENT_START = [45, 212, 191];
const GRADIENT_END = [129, 140, 248];
const GAP = '   ';
const MIN_COLUMNS = 56;
const RESET = '\x1b[0m';

function mix(t) {
  return GRADIENT_START.map((from, i) => Math.round(from + (GRADIENT_END[i] - from) * t));
}

function colorCode([r, g, b], trueColor) {
  if (trueColor) return `\x1b[38;2;${r};${g};${b}m`;
  const level = (v) => Math.round((v / 255) * 5);
  return `\x1b[38;5;${16 + 36 * level(r) + 6 * level(g) + level(b)}m`;
}

function paint(row, width, trueColor) {
  let out = '';
  [...row].forEach((ch, column) => {
    out += ch === ' ' ? ch : `${colorCode(mix(column / Math.max(1, width - 1)), trueColor)}${ch}`;
  });
  return `${out}${RESET}`;
}

function supportsTrueColor(env) {
  return /truecolor|24bit/i.test(env.COLORTERM || '') || !!env.WT_SESSION || /iterm|vscode|wezterm|ghostty/i.test(env.TERM_PROGRAM || '');
}

function shorten(text, width) {
  const value = String(text);
  return value.length <= width ? value : `…${value.slice(value.length - width + 1)}`;
}

export function renderBanner({ lang = 'en', version = '', cwd = '', isTTY = false, columns = 80, env = {} } = {}) {
  if (!isTTY || env.CI || env.TERM === 'dumb') return '';
  const color = !('NO_COLOR' in env);
  const bold = (text) => (color ? `\x1b[1m${text}${RESET}` : text);
  const dim = (text) => (color ? `\x1b[2m${text}${RESET}` : text);
  const title = `${PRODUCT_NAME}${version ? ` v${version}` : ''}`;
  const tagline = TAGLINES[lang] || TAGLINES.en;
  if (columns < MIN_COLUMNS) return `${bold(title)} · ${tagline}\n`;
  const width = MASCOT[0].length;
  const room = columns - width - GAP.length - 1;
  const info = { 1: bold(shorten(title, room)), 2: dim(shorten(tagline, room)), 3: cwd ? dim(shorten(cwd, room)) : '' };
  const trueColor = supportsTrueColor(env);
  const rows = MASCOT.map((row, i) => `${color ? paint(row, width, trueColor) : row}${info[i] ? `${GAP}${info[i]}` : ''}`.trimEnd());
  return `\n${rows.join('\n')}\n`;
}
