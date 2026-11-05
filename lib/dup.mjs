import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { git, matchAny, readText, toPosix } from './util.mjs';

const FAMILY = {
  ts: 'c', tsx: 'c', js: 'c', jsx: 'c', mjs: 'c', cjs: 'c', mts: 'c', cts: 'c',
  cs: 'c', java: 'c', kt: 'c', kts: 'c', go: 'c', swift: 'c', dart: 'c', php: 'c', scala: 'c', rs: 'c',
  py: 'py',
};

const SKIP = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/bin/**', '**/obj/**', '**/coverage/**', '**/.next/**',
  '**/vendor/**', '**/generated/**', '**/__generated__/**', '**/migrations/**', '**/Migrations/**', '**/*.d.ts',
  '**/*.min.js', '**/*.designer.cs', '**/*.Designer.cs', '**/*.g.cs', '**/*.pb.go', '**/*_pb2.py', '**/.flow/**',
  '**/wwwroot/lib/**', '**/public/**',
];
const TEST = ['**/*.test.*', '**/*.spec.*', '**/*_test.go', '**/test/**', '**/tests/**', '**/__tests__/**', '**/*.Tests/**', '**/*Tests.cs', '**/e2e/**', '**/fixtures/**', '**/testdata/**'];

const KEYWORDS = new Set(`
abstract as async await base bool boolean break byte case catch char checked class const continue debugger decimal default
defer delegate delete do double dynamic else enum event explicit export extends extern false final finally fixed float for
foreach from func function get go goto if implements implicit import in instanceof int interface internal is let lock long
map namespace native new nil null object of operator out override package params private protected public range readonly ref
return sbyte sealed select set short sizeof stackalloc static string struct super switch synchronized this throw throws
true try type typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while with yield chan
fallthrough elif except lambda def pass raise None True False and or not del global nonlocal assert
`.split(/\s+/).filter(Boolean));

const KEEP = new Set(['Math', 'Intl', 'Date', 'DateTime', 'DateTimeOffset', 'TimeSpan', 'String', 'Number', 'JSON', 'Object', 'Array', 'Promise', 'Task',
  'console', 'process', 'Buffer', 'RegExp', 'Regex', 'Error', 'Exception', 'Map', 'Set', 'List', 'Dictionary', 'Guid', 'Convert', 'Enumerable',
  'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'undefined', 'NaN',
  'Boolean', 'BigInt', 'Symbol', 'window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'URL', 'URLSearchParams', 'crypto',
  'dayjs', 'moment', 'axios', 'strings', 'strconv', 'fmt', 'time', 'errors', 'context', 'json', 'http', 'sql', 'os', 're', 'datetime',
  'StringBuilder', 'CultureInfo', 'Encoding', 'File', 'Path', 'Thread', 'CancellationToken', 'ILogger', 'HttpClient']);

const CONTROL = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'return', 'typeof', 'sizeof', 'nameof',
  'await', 'new', 'else', 'do', 'try', 'finally', 'fixed', 'checked', 'unchecked', 'when', 'select', 'func', 'function', 'throw',
  'super', 'base', 'this', 'elif', 'with', 'match', 'yield', 'default', 'case', 'in', 'of', 'and', 'or', 'not', 'is', 'as']);

export function familyOf(file) {
  const ext = file.split('.').pop().toLowerCase();
  return FAMILY[ext] || null;
}

function stripComments(text, fam) {
  if (fam === 'py') return text.replace(/(^|[^\\'"])#[^\n]*/g, '$1');
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const chunk = text.slice(i, end < 0 ? n : end + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      let j = i + 1;
      const verbatim = q === '"' && text[i - 1] === '@';
      while (j < n && text[j] !== q) {
        if (text[j] === '\\' && !verbatim) j++;
        if (text[j] === '\n' && q !== '`' && !verbatim) break;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const TOKEN = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|\d[\w.]*|[A-Za-z_$][\w$]*|=>|\?\.|\?\?|::|->|<-|:=|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\S/g;

function tokenize(text) {
  const toks = [];
  let line = 1;
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    for (let k = last; k < m.index; k++) if (text.charCodeAt(k) === 10) line++;
    last = m.index;
    const t = m[0];
    const kind = /^["'`]/.test(t) ? 'str' : /^\d/.test(t) ? 'num' : /^[A-Za-z_$]/.test(t) ? (KEYWORDS.has(t) ? 'kw' : 'id') : 'p';
    toks.push({ t, kind, line });
  }
  return toks;
}

function matchClose(toks, i, open, close) {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].t === open) depth++;
    else if (toks[j].t === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function fingerprint(body) {
  const exact = body.map((x) => x.t).join(' ');
  const names = new Map();
  const alpha = body
    .map((x, i) => {
      if (x.kind === 'str') return 'S';
      if (x.kind === 'num') return 'N';
      if (x.kind !== 'id') return x.t;
      const prev = body[i - 1];
      if (prev && (prev.t === '.' || prev.t === '?.' || prev.t === '::' || prev.t === '->')) return x.t;
      if (KEEP.has(x.t)) return x.t;
      if (!names.has(x.t)) names.set(x.t, `v${names.size}`);
      return names.get(x.t);
    })
    .join(' ');
  const h = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
  const calls = new Set();
  body.forEach((x, i) => {
    if (x.kind === 'id' && body[i + 1]?.t === '(') calls.add(x.t);
    if (x.kind === 'id' && (body[i - 1]?.t === '.' || body[i - 1]?.t === '?.')) calls.add(x.t);
  });
  return { exact: h(exact), alpha: h(alpha), calls: [...calls].slice(0, 40) };
}

function extractC(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    let name = null;
    let bodyStart = -1;
    if (tk.kind === 'id' && toks[i + 1]?.t === '(' && !CONTROL.has(tk.t) && toks[i - 1]?.t !== '.' && toks[i - 1]?.t !== 'new' && toks[i - 1]?.t !== '@') {
      const close = matchClose(toks, i + 1, '(', ')');
      if (close < 0) continue;
      for (let j = close + 1; j < Math.min(toks.length, close + 60); j++) {
        const t = toks[j].t;
        if (t === '(') {
          const k = matchClose(toks, j, '(', ')');
          if (k < 0) break;
          j = k;
          continue;
        }
        if (t === '{') {
          bodyStart = j;
          break;
        }
        if (t === ';' || t === '}' || t === ')' || t === ',' || t === '@' || (t === '=' && toks[j + 1]?.t !== '>')) break;
        if (['class', 'interface', 'struct', 'enum', 'record', 'namespace'].includes(t)) break;
        if (toks[j].kind === 'id' && toks[j + 1]?.t === '(') break;
        if (t === '=>' && toks[j + 1]?.t !== '{') break;
      }
      if (bodyStart >= 0) name = tk.t;
    } else if (tk.kind === 'id' && toks[i + 1]?.t === '=' && !CONTROL.has(tk.t)) {
      let j = i + 2;
      if (toks[j]?.t === 'async') j++;
      if (toks[j]?.t === '(') {
        const close = matchClose(toks, j, '(', ')');
        if (close < 0) continue;
        j = close + 1;
        if (toks[j]?.t === ':') while (j < toks.length && toks[j].t !== '=>' && j < close + 30) j++;
      } else if (toks[j]?.kind === 'id') j++;
      else continue;
      if (toks[j]?.t === '=>' && toks[j + 1]?.t === '{') {
        name = tk.t;
        bodyStart = j + 1;
      } else if (toks[j]?.t === 'function') {
        const p = toks.findIndex((x, k) => k > j && x.t === '(');
        const close = p > 0 ? matchClose(toks, p, '(', ')') : -1;
        if (close > 0 && toks[close + 1]?.t === '{') {
          name = tk.t;
          bodyStart = close + 1;
        }
      }
    }
    if (bodyStart < 0) continue;
    const end = matchClose(toks, bodyStart, '{', '}');
    if (end < 0) continue;
    let owner = null;
    for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
      if (toks[k].t === '.' && toks[k - 1]?.kind === 'id') owner = toks[k - 1].t;
    }
    out.push({ name, owner, line: tk.line, body: toks.slice(bodyStart, end + 1) });
  }
  return out;
}

function extractPy(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > indent)) j++;
    const body = tokenize(lines.slice(i + 1, j).join('\n'));
    out.push({ name: m[2], owner: null, line: i + 1, body });
  }
  return out;
}

export function scanText(file, text) {
  const fam = familyOf(file);
  if (!fam || text.length > 600000) return [];
  const clean = stripComments(text, fam);
  const raw = fam === 'py' ? extractPy(clean) : extractC(tokenize(clean));
  return raw.map((f) => ({ file: toPosix(file), name: f.name, line: f.line, tokens: f.body.length, ...fingerprint(f.body) }));
}

export function sourceFiles(repoDir, { includeTests = false } = {}) {
  const tracked = git(repoDir, ['ls-files']).out.split('\n');
  const untracked = git(repoDir, ['ls-files', '--others', '--exclude-standard']).out.split('\n');
  return [...new Set([...tracked, ...untracked])]
    .filter(Boolean)
    .filter((f) => familyOf(f) && !matchAny(SKIP, f) && (includeTests || !matchAny(TEST, f)));
}

export function scanRepo(repo, opts = {}) {
  const funcs = [];
  for (const f of sourceFiles(repo.dir, opts)) {
    const text = readText(path.join(repo.dir, f));
    if (text === null || text.includes('\u0000')) continue;
    try {
      for (const fn of scanText(f, text)) funcs.push({ repo: repo.name, ...fn });
    } catch {
      continue;
    }
  }
  return funcs;
}

const MIN_EXACT = 40;
const MIN_ALPHA = 60;

export function clusterize(funcs) {
  const groups = new Map();
  for (const f of funcs) {
    if (f.tokens >= MIN_EXACT) {
      const k = `exact:${f.exact}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    if (f.tokens >= MIN_ALPHA) {
      const k = `alpha:${f.alpha}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
  }
  const clusters = [];
  const seen = new Set();
  for (const [key, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    const files = new Set(list.map((x) => `${x.repo}/${x.file}`));
    if (files.size < 2) continue;
    const sig = list.map((x) => `${x.repo}/${x.file}:${x.line}`).sort().join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    clusters.push({ key, kind: key.split(':')[0], list, files: files.size, repos: new Set(list.map((x) => x.repo)).size, tokens: list[0].tokens });
  }
  return clusters.sort((a, b) => b.files * b.tokens - a.files * a.tokens);
}

const SYN = [
  ['format', 'fmt', 'display', 'render', 'pretty', 'label', 'text', 'tostring', 'stringify', 'show'],
  ['normalize', 'normalise', 'clean', 'sanitize', 'canonical', 'canon', 'standardize', 'chuan', 'chuanhoa'],
  ['phone', 'sdt', 'msisdn', 'mobile', 'tel', 'telephone', 'sodienthoai'],
  ['date', 'time', 'datetime', 'ts', 'timestamp', 'day', 'ngay'],
  ['money', 'currency', 'price', 'amount', 'vnd', 'cost', 'tien', 'gia'],
  ['diacritic', 'diacritics', 'accent', 'accents', 'tone', 'dau', 'bodau', 'unaccent', 'fold', 'ascii'],
  ['slug', 'slugify', 'kebab', 'urlsafe'],
  ['sleep', 'delay', 'wait', 'pause', 'timeout'],
  ['retry', 'backoff', 'attempt', 'retries'],
  ['chunk', 'batch', 'split', 'partition', 'group'],
  ['page', 'paged', 'paginate', 'pagination', 'paging', 'limit', 'offset'],
  ['submit', 'lock', 'inflight', 'busy', 'pending', 'guard'],
  ['user', 'account', 'profile', 'me', 'current'],
  ['parse', 'read', 'decode', 'extract', 'from'],
  ['validate', 'valid', 'check', 'verify', 'is', 'assert'],
];
const SYN_INDEX = new Map();
SYN.forEach((g, i) => g.forEach((w) => SYN_INDEX.set(w, `syn${i}`)));

export function words(name) {
  const spaced = String(name).replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, ' ');
  return spaced.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

function concepts(ws) {
  return new Set(ws.map((w) => SYN_INDEX.get(w) || w));
}

export function searchFuncs(funcs, query) {
  const q = concepts(words(query));
  const qCalls = new Set(words(query));
  const scored = [];
  for (const f of funcs) {
    const fc = concepts(words(f.name));
    let s = 0;
    for (const c of q) if (fc.has(c)) s += 3;
    for (const c of f.calls || []) if (qCalls.has(c.toLowerCase()) || q.has(SYN_INDEX.get(c.toLowerCase()))) s += 1;
    if (s > 0) scored.push({ ...f, score: s / Math.max(1, q.size) });
  }
  return scored.sort((a, b) => b.score - a.score || a.tokens - b.tokens);
}

export function loadBaseline(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function baselineOf(clusters) {
  const keys = {};
  for (const c of clusters) keys[c.key] = c.files;
  return { createdAt: new Date().toISOString(), clusters: clusters.length, keys };
}

export function checkChanged({ funcs, clusters, changed, baseline, allow = {}, canonical = {} }) {
  const changedSet = new Set(changed);
  const inChanged = (f) => changedSet.has(`${f.repo}/${f.file}`);
  const findings = [];
  for (const c of clusters) {
    const touched = c.list.filter(inChanged);
    if (!touched.length || allow[c.key]) continue;
    const before = baseline?.keys?.[c.key];
    if (before && c.files <= before) continue;
    findings.push({
      level: 'block',
      kind: before ? 'grew' : 'new',
      cluster: c,
      touched,
      others: c.list.filter((x) => !touched.includes(x)),
    });
  }
  const byName = new Map();
  for (const f of funcs) {
    if (f.tokens < 15) continue;
    const k = f.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(f);
  }
  const canonLower = Object.fromEntries(Object.entries(canonical).map(([k, v]) => [k.toLowerCase(), v]));
  const seen = new Set();
  for (const f of funcs.filter(inChanged)) {
    const k = f.name.toLowerCase();
    if (seen.has(`${f.repo}/${f.file}:${k}`)) continue;
    seen.add(`${f.repo}/${f.file}:${k}`);
    const canon = canonLower[k];
    if (canon && !f.file.startsWith(canon.split('#')[0])) {
      findings.push({ level: 'block', kind: 'canonical', fn: f, canonical: canon });
      continue;
    }
    const same = (byName.get(k) || []).filter((x) => x.file !== f.file || x.repo !== f.repo);
    if (same.length && f.tokens >= 15 && !['constructor', 'render', 'main', 'tostring', 'equals', 'gethashcode', 'dispose', 'configure', 'configureservices', 'up', 'down', 'handle', 'execute', 'executeasync', 'invoke', 'invokeasync', 'onmodelcreating', 'get', 'post', 'put', 'delete', 'index', 'init', 'setup', 'handler', 'default', 'run', 'start', 'stop'].includes(k)) {
      findings.push({ level: 'warn', kind: 'same-name', fn: f, others: same.slice(0, 5) });
    }
  }
  return findings;
}
