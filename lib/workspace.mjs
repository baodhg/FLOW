import fs from 'node:fs';
import path from 'node:path';
import { exists, git, gitRoot, isDir, matchAny, readText, realDir, toPosix } from './util.mjs';

export const FLOW_DIR = '.flow';

export const DEFAULT_MODULE_GLOBS = [
  'src/modules/*',
  'src/features/*',
  'src/domains/*',
  'src/app/*',
  'internal/*',
  'pkg/*',
  'cmd/*',
  'apps/*',
  'packages/*',
  'services/*',
  'libs/*',
  'src/*',
  'lib/*',
];

export const DEFAULT_PROFILE = {
  version: 1,
  name: '',
  mode: 'repo',
  trackHarness: false,
  language: { code: 'en', prose: 'vi' },
  layout: {
    moduleContext: 'CONTEXT.md',
    project: '.flow/PROJECT.md',
    rules: '.flow/rules',
    memory: '.flow/memory',
    plans: '.flow/plans',
    gates: '.flow/gates',
    contracts: '.flow/contracts.md',
    services: '.flow/services.md',
    coverage: '.flow/coverage.md',
    consumed: '.flow/consumed',
    reference: '.flow/reference',
    assets: '.flow/assets',
    handoff: '.flow/handoff',
    runs: '.flow/runs',
    legacy: [],
  },
  repos: [],
  modules: [],
  branches: {
    protected: ['main', 'master', 'production', 'prod', 'product', 'release'],
    workFrom: '',
    pattern: 'feat/<slug>',
    ownerOnly: [],
  },
  verify: [],
  hygiene: {
    comments: 'off',
    commitBody: 'free',
    naming: 'warn',
    leakPatterns: [],
    commentExempt: ['**/migrations/**', '**/generated/**', '**/*.d.ts', '**/vendor/**', '**/node_modules/**'],
    customChecks: [],
    dup: 'block',
  },
  canonical: {},
  autonomy: { level: 'local' },
  impact: { humanReviewAt: 6 },
  context: { staleDays: 30, maxLines: 400, maxRuleLines: 60, maxMemoryLines: 120 },
};

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function findFlowRoots(start) {
  const roots = [];
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, FLOW_DIR, 'profile.json'))) roots.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return roots;
}

export function loadProfile(root) {
  const file = path.join(root, FLOW_DIR, 'profile.json');
  const text = readText(file);
  if (text === null) throw new Error(`Không thấy ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} không phải JSON hợp lệ: ${e.message}`);
  }
  return deepMerge(DEFAULT_PROFILE, parsed);
}

function mainCheckoutOf(dir) {
  const r = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!r.ok) return null;
  const common = path.resolve(r.out.trim());
  return path.basename(common) === '.git' ? path.dirname(common) : null;
}

export function openFlow(requestedDir, { required = true } = {}) {
  const cwd = realDir(requestedDir);
  let roots = findFlowRoots(cwd);
  if (!roots.length) {
    const main = mainCheckoutOf(cwd);
    if (main && path.resolve(main) !== path.resolve(gitRoot(cwd) || '')) roots = findFlowRoots(main);
  }
  if (!roots.length) {
    if (required) {
      throw new Error('Không tìm thấy .flow/profile.json ở thư mục này hay thư mục cha. Chạy `flowctl init` trước.');
    }
    return null;
  }
  const root = roots[0];
  const profile = loadProfile(root);
  return makeFlow(root, profile, roots, cwd);
}

export function makeFlow(root, profile, roots = [root], cwd = root) {
  const abs = (p) => (path.isAbsolute(p) ? p : path.join(root, p));
  const layout = profile.layout;
  return {
    root,
    roots,
    cwd: path.resolve(cwd),
    profile,
    paths: {
      flowDir: path.join(root, FLOW_DIR),
      profile: path.join(root, FLOW_DIR, 'profile.json'),
      state: path.join(root, FLOW_DIR, 'state.json'),
      project: abs(layout.project),
      rules: abs(layout.rules),
      memory: abs(layout.memory),
      plans: abs(layout.plans),
      gates: abs(layout.gates),
      contracts: abs(layout.contracts),
      services: abs(layout.services || '.flow/services.md'),
      coverage: abs(layout.coverage || '.flow/coverage.md'),
      consumed: abs(layout.consumed || '.flow/consumed'),
      reference: abs(layout.reference || '.flow/reference'),
      assets: abs(layout.assets || '.flow/assets'),
      handoff: abs(layout.handoff),
      runs: abs(layout.runs),
      legacy: (layout.legacy || []).map((l) => ({ ...l, file: abs(l.file) })),
    },
  };
}

export function discoverRepos(flow) {
  const { root, profile } = flow;
  if (profile.repos && profile.repos.length) {
    return profile.repos
      .map((r) => (typeof r === 'string' ? { path: r } : r))
      .map((r) => ({ name: r.name || path.basename(path.resolve(root, r.path)), dir: path.resolve(root, r.path), ...r }))
      .filter((r) => isDir(r.dir));
  }
  const found = [];
  const top = gitRoot(root);
  if (top && path.resolve(top) === path.resolve(root)) found.push({ name: path.basename(root), dir: root, path: '.' });
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
    const dir = path.join(root, d.name);
    if (exists(path.join(dir, '.git'))) found.push({ name: d.name, dir, path: d.name });
  }
  if (!found.length && top) found.push({ name: path.basename(top), dir: top, path: toPosix(path.relative(root, top)) || '.' });
  return found;
}

export function scopeRepos(flow, { all = false } = {}) {
  const repos = discoverRepos(flow);
  if (all) return repos;
  const here = gitRoot(flow.cwd);
  if (here) {
    const hit = repos.find((r) => path.resolve(r.dir) === path.resolve(here));
    if (hit) return [hit];
    const main = mainCheckoutOf(here);
    const owner = main && repos.find((r) => path.resolve(r.dir) === path.resolve(main));
    if (owner) return [{ ...owner, dir: here, worktreeOf: owner.dir }];
    const inside = path.resolve(here).startsWith(path.resolve(flow.root));
    if (inside) return [{ name: path.basename(here), dir: here, path: toPosix(path.relative(flow.root, here)) }];
  }
  return repos;
}

export function harnessPatterns(flow) {
  const ctx = flow.profile.layout.moduleContext;
  return [`(^|/)\\${FLOW_DIR}/`, `(^|/)${ctx.replace(/[.]/g, '\\.')}$`];
}

const CODE_SKIP = [
  '**/*.md',
  '**/*.mdx',
  '**/*.txt',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/go.sum',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.svg',
  '**/*.ico',
  '**/*.webp',
  '**/*.pdf',
  '**/*.woff',
  '**/*.woff2',
  '**/.flow/**',
];

export function isCodeFile(file) {
  return !matchAny(CODE_SKIP, file);
}

export function changedFiles(repoDir, { staged = false, base = '' } = {}) {
  const files = new Set();
  const add = (out) =>
    out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((f) => files.add(f));
  if (staged) {
    add(git(repoDir, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']).out);
    return [...files];
  }
  if (base) {
    add(git(repoDir, ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]).out);
  }
  const hasHead = git(repoDir, ['rev-parse', '--verify', 'HEAD']).ok;
  if (hasHead) add(git(repoDir, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']).out);
  else add(git(repoDir, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']).out);
  add(git(repoDir, ['ls-files', '--others', '--exclude-standard']).out);
  return [...files];
}

export function addedLines(repoDir, { staged = false, base = '' } = {}) {
  const args = ['diff', '-U0', '--no-color', '--no-ext-diff'];
  if (staged) args.push('--cached');
  else if (base) args.push(`${base}...HEAD`);
  else if (git(repoDir, ['rev-parse', '--verify', 'HEAD']).ok) args.push('HEAD');
  else args.push('--cached');
  const out = git(repoDir, args).out;
  const result = [];
  let file = null;
  let line = 0;
  for (const raw of out.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ')) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      line = Number(h[1]);
      continue;
    }
    if (file && raw.startsWith('+')) {
      result.push({ file, line, text: raw.slice(1) });
      line++;
    }
  }
  if (!staged && !base) {
    const untracked = git(repoDir, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter(Boolean);
    for (const f of untracked) {
      const text = readText(path.join(repoDir, f));
      if (text === null || text.includes('\u0000')) continue;
      text.split(/\r?\n/).forEach((t, i) => result.push({ file: f, line: i + 1, text: t }));
    }
  }
  return result;
}

export function moduleOf(flow, repo, file) {
  const ctxName = flow.profile.layout.moduleContext;
  const absFile = path.join(repo.dir, file);
  const relFromRoot = toPosix(path.relative(flow.root, absFile));
  const relFromRepo = toPosix(file);
  const dirs = relFromRepo.split('/').slice(0, -1);
  const globs = (flow.profile.modules || []).map((m) => (typeof m === 'string' ? { glob: m } : m));
  let best = null;
  for (let i = dirs.length; i >= 1; i--) {
    const candRepo = dirs.slice(0, i).join('/');
    const candRoot = toPosix(path.relative(flow.root, path.join(repo.dir, candRepo)));
    const hitConf = globs.find((g) => matchAny([g.glob], candRoot) || matchAny([g.glob], candRepo));
    if (hitConf) {
      best = { dir: path.join(repo.dir, candRepo), stack: hitConf.stack || '', source: 'profile' };
      break;
    }
  }
  if (!best) {
    for (let i = dirs.length; i >= 1; i--) {
      const cand = path.join(repo.dir, dirs.slice(0, i).join('/'));
      if (exists(path.join(cand, ctxName))) {
        best = { dir: cand, stack: '', source: 'context' };
        break;
      }
    }
  }
  if (!best) {
    for (let i = dirs.length; i >= 1; i--) {
      const cand = dirs.slice(0, i).join('/');
      if (DEFAULT_MODULE_GLOBS.some((g) => matchAny([`/${g}`], cand))) {
        best = { dir: path.join(repo.dir, cand), stack: '', source: 'default' };
        break;
      }
    }
  }
  if (!best) best = { dir: repo.dir, stack: '', source: 'repo' };
  const contextFile = path.join(best.dir, ctxName);
  return {
    ...best,
    rel: toPosix(path.relative(flow.root, best.dir)) || '.',
    contextFile,
    hasContext: exists(contextFile),
    relFromRoot,
  };
}
