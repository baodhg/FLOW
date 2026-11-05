import fs from 'node:fs';
import path from 'node:path';
import { git, readText, toPosix } from './util.mjs';

const WINDOW = 8;
const MIN_RUN = 12;
const MAX_BYTES = 3 * 1024 * 1024;
const TEXT = /\.(md|mdc|txt|mjs|cjs|js|jsx|ts|tsx|go|cs|java|kt|py|sql|sh|ps1|ya?ml|toml|json|prisma|proto|html|css)$/i;
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'bin', 'obj', 'vendor', 'coverage', '.git', '.next', '.turbo', '.cache', '.venv', '__pycache__', '.gradle', 'target', 'out', 'worktrees', 'TXM-worktrees', '.local-checkout', 'public']);
const SKIP_FILE = /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|go\.sum|\.env.*)$/i;
const IMPORT_LINE = /^\s*(?:import\s|export\s+\{[^}]*\}\s+from\s)/;

function tokens(text) {
  return String(text).normalize('NFC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}

const tokenCodes = new Map();

function tokenCode(token) {
  let code = tokenCodes.get(token);
  if (code === undefined) {
    code = 2166136261;
    for (let i = 0; i < token.length; i++) code = Math.imul(code ^ token.charCodeAt(i), 16777619);
    tokenCodes.set(token, code);
  }
  return code;
}

export function projectFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(abs);
      } else if (e.isFile() && TEXT.test(e.name) && !SKIP_FILE.test(e.name)) out.push(abs);
    }
  };
  walk(root);
  return out;
}

function readSource(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return null;
  } catch {
    return null;
  }
  const text = readText(file);
  return text === null || text.includes('\u0000') ? null : text;
}

function packTokens(text) {
  const toks = [];
  const lines = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (IMPORT_LINE.test(line)) return;
    for (const t of tokens(line)) {
      toks.push(t);
      lines.push(i + 1);
    }
  });
  return { toks, lines };
}

function shingleHashes(toks) {
  const codes = toks.map(tokenCode);
  const out = [];
  for (let i = 0; i + WINDOW <= codes.length; i++) {
    let h = 17;
    for (let j = i; j < i + WINDOW; j++) h = Math.imul(h ^ codes[j], 31) + 7;
    out.push(h >>> 0);
  }
  return out;
}

export function buildCorpus(dirs, wanted) {
  const index = new Map();
  const perRoot = [];
  for (const dir of dirs) {
    let files = 0;
    for (const abs of projectFiles(dir)) {
      const text = readSource(abs);
      if (text === null) continue;
      files++;
      const label = `${path.basename(dir)}/${toPosix(path.relative(dir, abs))}`;
      for (const h of shingleHashes(tokens(text))) {
        if ((!wanted || wanted.has(h)) && !index.has(h)) index.set(h, label);
      }
    }
    perRoot.push({ dir, files });
  }
  return { index, perRoot, files: perRoot.reduce((n, r) => n + r.files, 0) };
}

export function compareFile(text, corpus) {
  const { toks, lines } = packTokens(text);
  const hashes = shingleHashes(toks);
  const runs = [];
  let open = null;
  hashes.forEach((h, i) => {
    const source = corpus.index.get(h);
    if (source && open) open.end = i;
    else if (source) open = { start: i, end: i, source };
    else if (open) {
      runs.push(open);
      open = null;
    }
  });
  if (open) runs.push(open);
  const kept = runs
    .map((r) => ({ tokens: r.end - r.start + WINDOW, shingles: r.end - r.start + 1, line: lines[r.start], endLine: lines[r.end + WINDOW - 1], source: r.source }))
    .filter((r) => r.tokens >= MIN_RUN)
    .sort((a, b) => b.tokens - a.tokens);
  const matched = kept.reduce((n, r) => n + r.shingles, 0);
  return { total: hashes.length, share: hashes.length ? matched / hashes.length : 0, runs: kept };
}

export function packFiles(home) {
  const listed = git(home, ['ls-files', '--cached', '--others', '--exclude-standard']);
  const files = listed.ok ? listed.out.split('\n').filter(Boolean) : projectFiles(home).map((f) => path.relative(home, f));
  return files.map(toPosix).filter((f) => TEXT.test(f) && !SKIP_FILE.test(path.basename(f)) && f !== ALLOW_FILE);
}

const ALLOW_FILE = 'provenance-allow.json';

export function loadAllow(home) {
  const raw = readText(path.join(home, ALLOW_FILE));
  if (raw === null) return [];
  return JSON.parse(raw).filter((e) => e.file && e.match && e.reason);
}

function isAllowed(file, run, sourceLines, allow) {
  const span = sourceLines.slice(run.line - 1, run.endLine).join('\n');
  return allow.some((e) => e.file === file && span.includes(e.match));
}

export function provenanceReport(home, dirs) {
  const texts = new Map();
  const wanted = new Set();
  for (const f of packFiles(home)) {
    const text = readText(path.join(home, f));
    if (text === null) continue;
    texts.set(f, text);
    for (const h of shingleHashes(packTokens(text).toks)) wanted.add(h);
  }
  const corpus = buildCorpus(dirs, wanted);
  const allow = loadAllow(home);
  const rows = [];
  let allowed = 0;
  for (const [file, text] of texts) {
    const sourceLines = text.split(/\r?\n/);
    const result = compareFile(text, corpus);
    const runs = result.runs.filter((run) => !isAllowed(file, run, sourceLines, allow));
    allowed += result.runs.length - runs.length;
    if (runs.length) rows.push({ file, ...result, runs });
  }
  return { perRoot: corpus.perRoot, corpusFiles: corpus.files, packFiles: texts.size, allowed, rows: rows.sort((a, b) => b.share - a.share) };
}

export function cmdProvenance(home, opts) {
  const against = Array.isArray(opts.against) ? opts.against : typeof opts.against === 'string' ? [opts.against] : [];
  const dirs = against.map((d) => path.resolve(d));
  if (!dirs.length) {
    console.log('provenance --against <thư mục> [--against …] — đo đoạn văn và mã của bộ skill trùng nguyên văn với dự án (chỉ đọc).');
    return 1;
  }
  const report = provenanceReport(home, dirs);
  const empty = report.perRoot.filter((r) => !r.files);
  for (const r of report.perRoot) console.log(`  nguồn đối chiếu ${r.dir}: ${r.files} tệp`);
  if (empty.length || !report.packFiles) {
    console.log('🚨 Có nguồn đọc được 0 tệp — phép đo hỏng, KHÔNG có nghĩa là sạch.');
    return 3;
  }
  console.log(`${report.packFiles} tệp của gói · ${report.rows.length} tệp có đoạn trùng từ ${MIN_RUN} từ trở lên · ${report.allowed} đoạn đã phán xử trong ${ALLOW_FILE}`);
  const limit = Number(opts.limit) || 6;
  for (const row of report.rows) {
    console.log(`\n${row.file} — ${Math.round(row.share * 100)}% trùng · ${row.runs.length} đoạn`);
    for (const run of row.runs.slice(0, limit)) console.log(`  dòng ${run.line}-${run.endLine} · ${run.tokens} từ ⇐ ${run.source}`);
    if (row.runs.length > limit) console.log(`  … và ${row.runs.length - limit} đoạn nữa`);
  }
  return report.rows.length ? 1 : 0;
}
