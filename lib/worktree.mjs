import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { exists, git, isDir, readText, slugify, toPosix, today, writeText } from './util.mjs';

export function commonDir(dir) {
  const r = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return r.ok ? path.resolve(r.out.trim()) : null;
}

export function mainWorktreeOf(dir) {
  const c = commonDir(dir);
  if (!c) return null;
  return path.basename(c) === '.git' ? path.dirname(c) : null;
}

function hash(text) {
  return crypto.createHash('sha1').update(text || '').digest('hex').slice(0, 16);
}

function manifestPath(flow) {
  return path.join(flow.paths.flowDir, 'worktrees.json');
}

export function loadManifest(flow) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(flow), 'utf8'));
  } catch {
    return { worktrees: [] };
  }
}

function saveManifest(flow, m) {
  writeText(manifestPath(flow), `${JSON.stringify(m, null, 2)}\n`);
}

export function localKnowledgeFiles(repoDir, contextName) {
  const base = contextName.replace(/\.md$/i, '');
  const names = new Set([contextName, `${base}.history.md`]);
  const out = git(repoDir, ['ls-files', '--others', '--ignored', '--exclude-standard'])
    .out.split('\n')
    .filter(Boolean)
    .filter((f) => names.has(path.basename(f)) && !/(^|\/)(node_modules|dist|build|bin|obj)\//.test(f));
  return out;
}

export function worktreeRoot(flow) {
  const configured = flow.profile.worktrees?.root;
  if (configured) return path.resolve(flow.root, configured);
  return path.join(path.dirname(flow.root), `${path.basename(flow.root)}-worktrees`);
}

export function createWorktree(flow, repo, { slug, base, branch }) {
  const s = slugify(slug, 50);
  if (!s) throw new Error('Thiếu slug cho worktree.');
  const pattern = flow.profile.branches.pattern || 'feat/<slug>';
  const br = branch || pattern.replace('<slug>', s);
  git(repo.dir, ['fetch', '--quiet', '--prune']);
  let start = base || flow.profile.branches.workFrom || '';
  if (!start) start = git(repo.dir, ['branch', '--show-current']).out.trim() || 'HEAD';
  const remoteRef = `origin/${start}`;
  const resolved = git(repo.dir, ['rev-parse', '--verify', '--quiet', remoteRef]).ok ? remoteRef : start;
  if (!git(repo.dir, ['rev-parse', '--verify', '--quiet', resolved]).ok) throw new Error(`Không thấy ref gốc "${start}".`);
  const dest = path.join(worktreeRoot(flow), `${repo.name}-${s}`);
  if (exists(dest)) throw new Error(`Đã có ${dest}.`);
  const exists_ = git(repo.dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${br}`]).ok;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const add = exists_ ? git(repo.dir, ['worktree', 'add', dest, br]) : git(repo.dir, ['worktree', 'add', '-b', br, dest, resolved]);
  if (!add.ok) throw new Error(`git worktree add lỗi: ${add.err}`);
  const ctxName = flow.profile.layout.moduleContext;
  const copied = {};
  for (const f of localKnowledgeFiles(repo.dir, ctxName)) {
    const src = path.join(repo.dir, f);
    const text = readText(src);
    if (text === null) continue;
    writeText(path.join(dest, f), text);
    copied[toPosix(f)] = hash(text);
  }
  const m = loadManifest(flow);
  m.worktrees = m.worktrees.filter((w) => path.resolve(w.path) !== path.resolve(dest));
  m.worktrees.push({ slug: s, repo: repo.name, repoDir: repo.dir, path: dest, branch: br, base: resolved, created: today(), contexts: copied });
  saveManifest(flow, m);
  return { path: dest, branch: br, base: resolved, copied: Object.keys(copied).length };
}

export function findWorktree(flow, key) {
  const m = loadManifest(flow);
  const hit = m.worktrees.filter((w) => w.slug === key || path.resolve(w.path) === path.resolve(key) || path.basename(w.path) === key);
  if (hit.length === 1) return hit[0];
  if (!hit.length) throw new Error(`Không thấy worktree "${key}" trong sổ (${m.worktrees.map((w) => w.slug).join(', ') || 'trống'}).`);
  throw new Error(`"${key}" khớp nhiều worktree.`);
}

export function reconcileContexts(flow, wt, { apply = false } = {}) {
  const ctxName = flow.profile.layout.moduleContext;
  const files = new Set([...Object.keys(wt.contexts || {}), ...localKnowledgeFiles(wt.path, ctxName).map(toPosix)]);
  const result = { back: [], conflict: [], same: [], gone: [] };
  for (const f of files) {
    const wText = readText(path.join(wt.path, f));
    const mFile = path.join(wt.repoDir, f);
    const mText = readText(mFile);
    const orig = wt.contexts?.[f];
    if (wText === null) {
      result.gone.push(f);
      continue;
    }
    const wH = hash(wText);
    const mH = mText === null ? null : hash(mText);
    if (wH === orig || wH === mH) {
      result.same.push(f);
      continue;
    }
    const mainUntouched = (orig && mH === orig) || (!orig && mH === null);
    if (mainUntouched) {
      result.back.push(f);
      if (apply) writeText(mFile, wText);
    } else {
      result.conflict.push(f);
      if (apply) writeText(path.join(flow.paths.handoff, `wt-${wt.slug}`, f), wText);
    }
  }
  return result;
}

export function findJunctions(dir, depth = 4) {
  const out = [];
  const walk = (d, level) => {
    if (level > depth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      let st;
      try {
        st = fs.lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        out.push(p);
        continue;
      }
      if (st.isDirectory() && e.name !== 'node_modules') walk(p, level + 1);
      if (st.isDirectory() && e.name === 'node_modules') {
        for (const sub of fs.readdirSync(p, { withFileTypes: true })) {
          const sp = path.join(p, sub.name);
          try {
            if (fs.lstatSync(sp).isSymbolicLink()) out.push(sp);
          } catch {
            continue;
          }
        }
      }
    }
  };
  walk(dir, 0);
  return out.sort((a, b) => b.length - a.length);
}

export function removeLink(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    fs.rmdirSync(p);
  }
}

export function worktreeStatus(wt) {
  const dirty = git(wt.path, ['status', '--porcelain']).out.split('\n').filter(Boolean).length;
  const branch = git(wt.path, ['branch', '--show-current']).out.trim();
  const upstream = git(wt.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  let ahead = null;
  if (upstream.ok) ahead = Number(git(wt.path, ['rev-list', '--count', '@{u}..HEAD']).out.trim() || 0);
  const local = Number(git(wt.path, ['rev-list', '--count', `${wt.base}..HEAD`]).out.trim() || 0);
  return { exists: isDir(wt.path), dirty, branch, upstream: upstream.ok ? upstream.out.trim() : '', ahead, commits: local };
}

export function finishWorktree(flow, wt, { force = false } = {}) {
  const st = worktreeStatus(wt);
  const blockers = [];
  if (!st.exists) blockers.push('thư mục worktree không còn');
  if (st.dirty) blockers.push(`${st.dirty} thay đổi chưa commit`);
  if (st.commits > 0 && !st.upstream) blockers.push(`${st.commits} commit chưa push (nhánh chưa có upstream)`);
  if (st.ahead > 0) blockers.push(`${st.ahead} commit chưa push`);
  if (blockers.length && !force) return { done: false, blockers, status: st };
  const ctx = st.exists ? reconcileContexts(flow, wt, { apply: true }) : { back: [], conflict: [], same: [], gone: [] };
  const links = st.exists ? findJunctions(wt.path) : [];
  for (const l of links) removeLink(l);
  if (st.exists) {
    const rm = git(wt.repoDir, ['worktree', 'remove', ...(force ? ['--force'] : []), wt.path]);
    if (!rm.ok) return { done: false, blockers: [`git worktree remove lỗi: ${rm.err}`], status: st, ctx, links };
  }
  git(wt.repoDir, ['worktree', 'prune']);
  const m = loadManifest(flow);
  m.worktrees = m.worktrees.filter((w) => path.resolve(w.path) !== path.resolve(wt.path));
  saveManifest(flow, m);
  return { done: true, status: st, ctx, links };
}
