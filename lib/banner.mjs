export const BRAND = 'FLOW';
export const TAGLINE = 'quy trình cho coding agent';

const GLYPHS = {
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000'],
  G: ['01111', '10000', '10011', '10001', '01111'],
  H: ['10001', '10001', '11111', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '11111'],
  J: ['00111', '00001', '00001', '10001', '01110'],
  K: ['10001', '10010', '11100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '11110', '10000', '10000'],
  Q: ['01110', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '11110', '10010', '10001'],
  S: ['01111', '10000', '01110', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100'],
  Z: ['11111', '00010', '00100', '01000', '11111'],
  0: ['01110', '10011', '10101', '11001', '01110'],
  1: ['00100', '01100', '00100', '00100', '01110'],
  2: ['11110', '00001', '01110', '10000', '11111'],
  3: ['11110', '00001', '01110', '00001', '11110'],
  4: ['10010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '11110'],
  6: ['01111', '10000', '11110', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '00100'],
  8: ['01110', '10001', '01110', '10001', '01110'],
  9: ['01110', '10001', '01111', '00001', '11110'],
  '-': ['00000', '00000', '11111', '00000', '00000'],
  ' ': ['000', '000', '000', '000', '000'],
};

const GRADIENT_START = [45, 212, 191];
const GRADIENT_END = [129, 140, 248];
const GUTTER = 2;

export function artRows(brand) {
  const glyphs = [...String(brand).toUpperCase()].map((c) => GLYPHS[c]);
  if (!glyphs.length || glyphs.some((g) => !g)) return null;
  return [0, 1, 2, 3, 4].map((row) =>
    glyphs.map((g) => g[row].replaceAll('1', '██').replaceAll('0', '  ')).join(' '.repeat(GUTTER)),
  );
}

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
  let lastColumn = -1;
  [...row].forEach((ch, column) => {
    if (ch === ' ') {
      out += ch;
      return;
    }
    if (lastColumn !== column - 1 || column % 2 === 0) out += colorCode(mix(column / Math.max(1, width - 1)), trueColor);
    out += ch;
    lastColumn = column;
  });
  return `${out}\x1b[0m`;
}

function supportsTrueColor(env) {
  return /truecolor|24bit/i.test(env.COLORTERM || '') || !!env.WT_SESSION || /iterm|vscode|wezterm|ghostty/i.test(env.TERM_PROGRAM || '');
}

export function renderBanner({ brand = BRAND, tagline = TAGLINE, version = '', isTTY = false, columns = 80, env = {} } = {}) {
  if (!isTTY || env.CI || env.TERM === 'dumb') return '';
  const caption = [tagline, version && `v${version}`].filter(Boolean).join(' · ');
  const color = !('NO_COLOR' in env);
  const rows = artRows(brand);
  const width = rows ? Math.max(...rows.map((r) => r.length)) : Infinity;
  if (!rows || width + 2 > columns) return `${color ? '\x1b[1m' : ''}${brand}${color ? '\x1b[0m' : ''} · ${caption}\n`;
  const trueColor = supportsTrueColor(env);
  const art = rows.map((r) => `  ${color ? paint(r, width, trueColor) : r}`).join('\n');
  const dim = color ? ['\x1b[2m', '\x1b[0m'] : ['', ''];
  return `\n${art}\n\n  ${dim[0]}${caption}${dim[1]}\n`;
}
