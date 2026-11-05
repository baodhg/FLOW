import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return {
    ok: r.status === 0,
    status: r.status,
    out: (r.stdout || '').replace(/\r\n/g, '\n'),
    err: (r.stderr || '').trim(),
  };
}

export function gitRoot(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.resolve(r.out.trim()) : null;
}

export function gitPath(cwd, name) {
  const r = git(cwd, ['rev-parse', '--git-path', name]);
  if (!r.ok) return null;
  return path.resolve(cwd, r.out.trim());
}

export function headCommit(cwd) {
  const r = git(cwd, ['rev-parse', 'HEAD']);
  return r.ok ? r.out.trim() : null;
}

export function currentBranch(cwd) {
  const r = git(cwd, ['branch', '--show-current']);
  return r.ok ? r.out.trim() : '';
}

export function run(command, cwd) {
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

export function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function listFiles(dir, predicate = () => true) {
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && predicate(d.name))
    .map((d) => path.join(dir, d.name))
    .sort();
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function rel(from, to) {
  return toPosix(path.relative(from, to)) || '.';
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function stamp(d = new Date()) {
  return `${today(d)}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

export function slugify(text, max = 60) {
  const s = String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const i = cut.lastIndexOf('-');
  return (i > max / 2 ? cut.slice(0, i) : s.slice(0, max)).replace(/-+$/g, '');
}

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function globToRegExp(glob, flags = '') {
  let g = glob.trim().replace(/\\/g, '/');
  if (g.startsWith('/')) g = g.slice(1);
  else if (!g.includes('/')) g = `**/${g}`;
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const slash = g[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end > i) {
        re += `(?:${g.slice(i + 1, end).split(',').map(escapeRe).join('|')})`;
        i = end;
      } else {
        re += '\\{';
      }
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp(`^${re}$`, flags);
}

export function matchAny(globs, file, { nocase = false } = {}) {
  const f = toPosix(file);
  return (globs || []).some((g) => globToRegExp(g, nocase ? 'i' : '').test(f));
}

export function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

export function truncate(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function table(rows, headers) {
  const all = [headers, ...rows].map((r) => r.map((c) => String(c ?? '')));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all
    .map((r, idx) => {
      const line = r.map((c, i) => c.padEnd(widths[i])).join('  ');
      return idx === 0 ? `${line}\n${widths.map((w) => '-'.repeat(w)).join('  ')}` : line;
    })
    .join('\n');
}
