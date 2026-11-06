import fs from 'node:fs';
import path from 'node:path';
import {
  envSecretValues,
  fingerprintOf,
  gitleaksAvailable,
  historyLines,
  loadWatch,
  localEnvFiles,
  mask,
  publicFinding,
  runGitleaks,
  safeEnvView,
  scanEnvValuesInLine,
  scanPiiInLine,
  scanSecretsInLine,
  scanWatchInLine,
  scannerSelfCheck,
  sensitiveFile,
  treeLines,
  watchHash,
} from './secrets.mjs';
import { exists, git, gitRoot, isDir, readText, rel, toPosix, today, truncate, writeText } from './util.mjs';
import { addedLines, changedFiles, discoverRepos, openFlow, scopeRepos } from './workspace.mjs';

const log = (...a) => console.log(...a);

function paths(flow) {
  const dir = path.join(flow.paths.flowDir, 'secrets');
  return { dir, baseline: path.join(dir, 'baseline.json'), watch: path.join(dir, 'watch.json') };
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function authorEmails(repoDir) {
  return new Set(
    git(repoDir, ['log', '--all', '--format=%ae%n%ce', '-n', '5000'])
      .out.split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function envValues(repoDir, flowRoot, extra = []) {
  const values = new Map();
  const files = localEnvFiles(repoDir).map((f) => path.join(repoDir, f));
  if (flowRoot && !files.length) for (const n of ['.env', 'BE.env', 'FE.env', 'PS.env']) if (exists(path.join(flowRoot, n))) files.push(path.join(flowRoot, n));
  for (const f of [...files, ...extra]) {
    const text = readText(f);
    if (text === null) continue;
    for (const [v, k] of envSecretValues(text)) values.set(v, k);
  }
  return { values, files: files.length + extra.length };
}

function collector({ env, watch, knownEmails, wantPii = true }) {
  const seen = new Map();
  const add = (f) => {
    const p = publicFinding(f);
    const key = `${p.rule}|${p.file}|${p.valueId}`;
    const cur = seen.get(key);
    if (!cur) seen.set(key, { ...p, occurrences: 1 });
    else cur.occurrences++;
  };
  return {
    line(l) {
      for (const f of scanSecretsInLine(l)) add(f);
      for (const f of scanEnvValuesInLine(l, env)) add(f);
      for (const f of scanWatchInLine(l, watch)) add(f);
      if (wantPii) for (const f of scanPiiInLine(l, { knownEmails })) add(f);
    },
    file(file) {
      const why = sensitiveFile(file);
      if (why) add({ rule: 'sensitive-file', level: 'secret', file: toPosix(file), line: 0, commit: '', value: toPosix(file) });
    },
    results: () => [...seen.values()],
  };
}

function dedupeSameLine(list) {
  const shapes = list.filter((f) => !f.rule.startsWith('gitleaks:'));
  const located = new Set(shapes.map((f) => `${f.file}:${f.line}`));
  const envHits = new Set(shapes.filter((f) => f.rule.startsWith('env-value:')).map((f) => `${f.file}:${f.line}|${f.valueId}`));
  return list.filter((f) => {
    if (f.rule.startsWith('gitleaks:')) return !located.has(`${f.file}:${f.line}`);
    if (f.rule === 'secret-field' && envHits.has(`${f.file}:${f.line}|${f.valueId}`)) return false;
    return true;
  });
}

function applyBaseline(list, baseline) {
  const known = baseline?.fingerprints || {};
  const fresh = [];
  const debt = [];
  const allowed = [];
  for (const f of list) {
    const k = known[f.fingerprint];
    if (!k) fresh.push(f);
    else if (k.verdict === 'debt') debt.push({ ...f, reason: k.reason, at: k.at });
    else allowed.push(f);
  }
  return { fresh, debt, allowed };
}

function printFindings(list, { repoDir = null } = {}) {
  const byRule = {};
  for (const f of list) (byRule[f.rule] = byRule[f.rule] || []).push(f);
  const pushedCache = new Map();
  const pushed = (c) => {
    if (!c || !repoDir) return '';
    if (!pushedCache.has(c)) pushedCache.set(c, git(repoDir, ['branch', '-r', '--contains', c]).out.trim() ? 'ĐÃ LÊN REMOTE' : 'chưa push');
    return pushedCache.get(c);
  };
  for (const [rule, items] of Object.entries(byRule)) {
    log(`  ${rule} — ${items.length}`);
    for (const f of items.slice(0, 15)) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      log(`    ${where}  ${f.masked}${f.occurrences > 1 ? ` ×${f.occurrences}` : ''}${f.commit ? `  @${f.commit} ${pushed(f.commit)}` : ''}  #${f.fingerprint}`);
    }
    if (items.length > 15) log(`    … và ${items.length - 15} chỗ nữa (--json để xem hết)`);
  }
}

async function scanRepo(repo, opts) {
  const { flow, mode, watch } = opts;
  const { values: env, files: envFiles } = envValues(repo.dir, flow?.root, opts.envExtra || []);
  const c = collector({ env, watch, knownEmails: authorEmails(repo.dir), wantPii: opts.pii !== false });
  let scanned = 0;
  if (mode === 'history') {
    const r = await historyLines(repo.dir, (l) => {
      scanned++;
      c.line(l);
    });
    git(repo.dir, ['log', '--all', '--name-only', '--format=', '--diff-filter=A']).out.split('\n').filter(Boolean).forEach((f) => c.file(f));
    if (!r.commits) scanned = 0;
  } else if (mode === 'staged' || mode === 'base') {
    for (const l of addedLines(repo.dir, { staged: mode === 'staged', base: opts.base || '' })) {
      scanned++;
      c.line(l);
    }
    changedFiles(repo.dir, { staged: mode === 'staged', base: opts.base || '' }).forEach((f) => c.file(f));
  } else {
    const files = git(repo.dir, ['ls-files']).out.split('\n').filter(Boolean);
    const untracked = git(repo.dir, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter(Boolean);
    const all = [...new Set([...files, ...untracked])];
    all.forEach((f) => c.file(f));
    for (const l of treeLines(repo.dir, all)) {
      scanned++;
      c.line(l);
    }
  }
  let list = c.results();
  let gl = null;
  if (opts.gitleaks && (mode === 'history' || mode === 'tree' || mode === 'staged')) {
    gl = runGitleaks(repo.dir, { mode });
    if (gl.ok) {
      const inRepo = mode === 'tree' ? new Set([...git(repo.dir, ['ls-files']).out.split('\n'), ...git(repo.dir, ['ls-files', '--others', '--exclude-standard']).out.split('\n')].filter(Boolean)) : null;
      const kept = gl.findings.filter((f) => !inRepo || inRepo.has(f.file));
      list = [...list, ...kept.map((f) => ({ ...f, valueId: f.fingerprint, occurrences: 1 }))];
    }
  }
  return { list: dedupeSameLine(list), scanned, envFiles, envValues: env.size, gitleaks: gl };
}

function localFiles(flow) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['runs', 'dup', 'secrets'].includes(e.name)) walk(p);
      } else if (!/fingerprint\.json$/.test(e.name)) out.push(p);
    }
  };
  if (isDir(flow.paths.flowDir)) walk(flow.paths.flowDir);
  const ctx = flow.profile.layout.moduleContext;
  for (const repo of discoverRepos(flow)) {
    git(repo.dir, ['ls-files', '--others', '--ignored', '--exclude-standard'])
      .out.split('\n')
      .filter((f) => f && path.basename(f) === ctx && !/(^|\/)node_modules\//.test(f))
      .forEach((f) => out.push(path.join(repo.dir, f)));
  }
  return out;
}

function scanLocal(flow, watch) {
  const env = new Map();
  for (const repo of discoverRepos(flow)) for (const [v, k] of envValues(repo.dir, flow.root).values) env.set(v, k);
  const c = collector({ env, watch, knownEmails: new Set(), wantPii: false });
  let scanned = 0;
  for (const abs of localFiles(flow)) {
    const text = readText(abs);
    if (text === null) continue;
    text.split(/\r?\n/).forEach((t, i) => {
      scanned++;
      c.line({ file: rel(flow.root, abs), line: i + 1, text: t });
    });
  }
  return { list: c.results(), scanned };
}

export async function cmdSecrets(cwd, sub, opts) {
  if (!scannerSelfCheck()) {
    log('🚨 PHÉP ĐO HỎNG: bộ quét không bắt được chính mẫu đối chứng. Không được coi kết quả là "sạch".');
    return 3;
  }
  if (sub === 'env') {
    const file = path.resolve(cwd, opts._[0] || '.env');
    const text = readText(file);
    if (text === null) {
      log(`Không đọc được ${file}`);
      return 1;
    }
    log(`${file} — chỉ hiện tên khoá, độ dài, host; không hiện giá trị:`);
    safeEnvView(text).forEach((l) => log(`  ${l}`));
    return 0;
  }
  const flow = typeof opts.path === 'string' ? null : openFlow(cwd, { required: false });
  const p = flow ? paths(flow) : null;
  const baseline = p ? loadJson(p.baseline, { fingerprints: {} }) : { fingerprints: {} };
  const watch = p ? loadWatch(p.watch) : null;

  if (sub === 'watch') {
    if (!flow) throw new Error('secrets watch cần .flow/.');
    const label = typeof opts.label === 'string' ? opts.label : 'nhạy-cảm';
    let value = '';
    try {
      value = fs.readFileSync(0, 'utf8').trim();
    } catch {
      value = '';
    }
    if (!value) {
      log('Nạp giá trị qua stdin (KHÔNG qua tham số dòng lệnh, để không vào lịch sử shell): flow secrets watch --label so-tk < tệp');
      return 1;
    }
    watch.entries.push({ label, hash: watchHash(watch.salt, value), at: today() });
    writeText(p.watch, `${JSON.stringify(watch, null, 1)}\n`);
    log(`✓ theo dõi "${label}" (chỉ lưu hash có salt, không lưu giá trị) — ${watch.entries.length} mục.`);
    return 0;
  }
  if (sub === 'allow') {
    if (!flow) throw new Error('secrets allow cần .flow/.');
    const fp = opts._[0];
    if (!fp || typeof opts.reason !== 'string') {
      log('secrets allow <#mã> --reason "<đã MỞ RA XEM và vì sao>" [--debt]');
      log('  không --debt: dương tính giả. --debt: secret thật, chờ xoay khoá — vẫn nhắc mỗi lần quét.');
      return 1;
    }
    baseline.fingerprints[fp.replace(/^#/, '')] = { verdict: opts.debt ? 'debt' : 'false-positive', reason: opts.reason, at: today() };
    writeText(p.baseline, `${JSON.stringify(baseline, null, 1)}\n`);
    log(`✓ ${fp}: ${opts.debt ? 'nợ — chờ xoay khoá' : 'dương tính giả'} — ${opts.reason}`);
    return 0;
  }

  const mode = opts.staged ? 'staged' : opts.base ? 'base' : opts.history ? 'history' : opts.local ? 'local' : 'tree';
  const useGl = !opts['no-gitleaks'] && mode !== 'base' && mode !== 'local' && gitleaksAvailable();

  if (mode === 'local') {
    if (!flow) throw new Error('--local cần .flow/.');
    const { list, scanned } = scanLocal(flow, watch);
    const { fresh, debt } = applyBaseline(list, baseline);
    log(`Bộ não local (.flow/, ${flow.profile.layout.moduleContext}) · ${scanned} dòng · ${fresh.length} nghi secret`);
    printFindings(fresh);
    if (debt.length) log(`  nợ đã ghi: ${debt.length}`);
    if (fresh.length) log('\nTệp local cũng được đọc vào lịch sử phiên và có thể bị chia sẻ — thay bằng tên biến / mô tả, không ghi giá trị thật.');
    return fresh.length ? 1 : 0;
  }

  const repos = typeof opts.path === 'string' ? [{ name: path.basename(path.resolve(cwd, opts.path)), dir: path.resolve(cwd, opts.path) }] : flow ? (opts.all || flow.profile.mode === 'workspace' ? discoverRepos(flow) : scopeRepos(flow)) : [{ name: path.basename(gitRoot(cwd) || cwd), dir: gitRoot(cwd) || cwd }];
  const envExtra = (Array.isArray(opts.env) ? opts.env : typeof opts.env === 'string' ? [opts.env] : []).map((f) => path.resolve(cwd, f));
  let secretCount = 0;
  let piiCount = 0;
  let broken = false;
  const jsonOut = [];
  for (const repo of repos) {
    const r = await scanRepo(repo, { flow, mode, watch, base: opts.base, gitleaks: useGl, pii: !opts['no-pii'], envExtra });
    if (mode !== 'staged' && mode !== 'base' && r.scanned === 0) {
      log(`🚨 ${repo.name}: quét 0 dòng — phép đo hỏng hoặc repo trống, KHÔNG phải "sạch".`);
      broken = true;
      continue;
    }
    const { fresh, debt, allowed } = applyBaseline(r.list, baseline);
    const secrets = fresh.filter((f) => f.level === 'secret');
    const pii = fresh.filter((f) => f.level === 'pii');
    secretCount += secrets.length;
    piiCount += pii.length;
    jsonOut.push({ repo: repo.name, secrets, pii, debt, allowed: allowed.length });
    if (opts.json) continue;
    log(`${secrets.length ? '✗' : '✓'} ${repo.name} · ${mode} · ${r.scanned} dòng · ${r.envValues} giá trị từ ${r.envFiles} tệp env · gitleaks ${r.gitleaks ? (r.gitleaks.ok ? 'có' : 'lỗi') : 'không'} · ${secrets.length} secret · ${pii.length} PII${allowed.length ? ` · ${allowed.length} đã phán xử` : ''}`);
    if (secrets.length) printFindings(secrets, { repoDir: mode === 'history' ? repo.dir : null });
    if (pii.length) {
      log('  — thông tin cá nhân —');
      printFindings(pii, { repoDir: mode === 'history' ? repo.dir : null });
    }
    if (debt.length) log(`  🟠 nợ chưa xoay khoá: ${debt.length} (${debt.slice(0, 3).map((d) => `${d.rule} ${d.file}`).join(' · ')})`);
    const ignored = git(repo.dir, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter((f) => f && /(^|\/)\.env(\.[^/]+)?$/i.test(f) && !/\.(example|sample|template|dist|defaults?)$/i.test(f));
    if (ignored.length) log(`  ⚠️ .env chưa bị git bỏ qua, sắp lọt: ${ignored.join(', ')}`);
  }
  if (opts.json) {
    log(JSON.stringify(jsonOut, null, 1));
    return secretCount ? 1 : 0;
  }
  if (secretCount) {
    log('\nMở từng chỗ ra xem rồi chọn MỘT (skill flow-secrets):');
    log('  - Secret thật: báo người dùng ngay; XOAY KHOÁ TRƯỚC, xoá khỏi mã sau; đã lên remote thì xoá mã chưa đủ. Chưa xoay được: secrets allow <#mã> --debt --reason "…"');
    log('  - Dương tính giả: secrets allow <#mã> --reason "đã mở ra xem: …"');
    log('  KHÔNG phán xử theo tên luật + tên tệp mà chưa mở ra xem.');
  } else if (!opts.history && mode === 'tree') {
    log('\nCây hiện tại sạch — chưa nói gì về lịch sử: secrets scan --history.');
  }
  if (broken) return 3;
  return secretCount ? 1 : 0;
}

export function runSecretsCheck(flow, repo, { staged = false, base = '' } = {}) {
  const p = paths(flow);
  const baseline = loadJson(p.baseline, { fingerprints: {} });
  const watch = loadWatch(p.watch);
  const { values: env } = envValues(repo.dir, flow.root);
  const c = collector({ env, watch, knownEmails: authorEmails(repo.dir), wantPii: true });
  for (const l of addedLines(repo.dir, { staged, base })) c.line(l);
  changedFiles(repo.dir, { staged, base }).forEach((f) => c.file(f));
  const { fresh } = applyBaseline(c.results(), baseline);
  return { secrets: fresh.filter((f) => f.level === 'secret'), pii: fresh.filter((f) => f.level === 'pii') };
}

export function checkLines(findings, repo) {
  return findings.map((f) => `  ${f.level === 'pii' ? 'PII   ' : 'SECRET'} ${f.rule}  ${f.line ? `${f.file}:${f.line}` : f.file}  ${f.masked}  #${f.fingerprint}`);
}

export function textProblems(text, label) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((t, i) => {
    for (const f of [...scanSecretsInLine({ file: `${label}.txt`, line: i + 1, text: t }), ...scanPiiInLine({ file: `${label}.txt`, line: i + 1, text: t })]) {
      out.push(`Dòng ${i + 1} có ${f.level === 'pii' ? 'thông tin cá nhân' : 'bí mật'} (${f.rule}): ${mask(f.value)} — bỏ ra.`);
    }
  });
  return out;
}

export function quickTreeSummary(flow, repos) {
  let secrets = 0;
  let pii = 0;
  for (const repo of repos) {
    const files = git(repo.dir, ['ls-files']).out.split('\n').filter(Boolean);
    const c = collector({ env: new Map(), watch: null, knownEmails: authorEmails(repo.dir), wantPii: true });
    files.forEach((f) => c.file(f));
    for (const l of treeLines(repo.dir, files)) c.line(l);
    for (const f of c.results()) {
      if (f.level === 'secret') secrets++;
      else pii++;
    }
  }
  return { secrets, pii };
}

export { fingerprintOf, truncate };
