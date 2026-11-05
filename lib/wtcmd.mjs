import path from 'node:path';
import { gitRoot, rel, table } from './util.mjs';
import { discoverRepos, openFlow, scopeRepos } from './workspace.mjs';
import { createWorktree, findWorktree, finishWorktree, loadManifest, reconcileContexts, worktreeRoot, worktreeStatus } from './worktree.mjs';

const log = (...a) => console.log(...a);

function pickRepo(flow, opts) {
  const repos = discoverRepos(flow);
  if (typeof opts.repo === 'string') {
    const r = repos.find((x) => x.name === opts.repo || x.path === opts.repo);
    if (!r) throw new Error(`Không thấy repo "${opts.repo}". Có: ${repos.map((x) => x.name).join(', ')}`);
    return r;
  }
  const here = scopeRepos(flow)[0];
  if (here?.worktreeOf) return repos.find((r) => path.resolve(r.dir) === path.resolve(here.worktreeOf));
  if (here && gitRoot(flow.cwd)) return here;
  if (repos.length === 1) return repos[0];
  throw new Error(`Workspace có ${repos.length} repo — chỉ rõ --repo <tên>.`);
}

export function cmdWorktree(cwd, sub, opts) {
  const flow = openFlow(cwd);
  if (sub === 'new') {
    const slug = opts._[0];
    const repo = pickRepo(flow, opts);
    const r = createWorktree(flow, repo, { slug, base: typeof opts.base === 'string' ? opts.base : '', branch: typeof opts.branch === 'string' ? opts.branch : '' });
    log(`✓ worktree ${r.path}`);
    log(`  nhánh ${r.branch} ← ${r.base} · mang theo ${r.copied} tệp ngữ cảnh local (CONTEXT.md bị git bỏ qua nên không tự theo sang)`);
    log('');
    log('Trước khi làm trong worktree:');
    log(`  1. Mọi lệnh: cd "${r.path}" && … (lệnh chạy nền KHÔNG tin cwd cũ).`);
    log('  2. Cài phụ thuộc RIÊNG (npm ci / pnpm i / dotnet restore / go mod download). Không junction node_modules từ cây chính: pnpm workspace sẽ chạy mã của cây chính, prisma generate sẽ ghi đè client của cây chính.');
    log('  3. Dùng chung DB / broker với cây khác ⇒ tắt consumer / job nền ở worktree phụ (tránh rút cạn outbox chéo nhánh). Migration đánh số ⇒ ghi số đã chiếm vào ledger của plan.');
    log('  4. Dev server đang chạy ở cây khác — sửa ở đây mà F5 không đổi là bình thường.');
    log(`Xong việc: flowctl wt done ${r.path.split(/[\\/]/).pop()}  (đối chiếu ngữ cảnh, gỡ junction, rồi mới gỡ worktree)`);
    return 0;
  }
  if (sub === 'done' || sub === 'remove') {
    const wt = findWorktree(flow, opts._[0] || '');
    const r = finishWorktree(flow, wt, { force: !!opts.force });
    if (!r.done) {
      log(`✗ Chưa gỡ ${wt.path}:`);
      r.blockers.forEach((b) => log(`  - ${b}`));
      log('  Commit + push trước (hoặc --force nếu chắc chắn bỏ). Ngữ cảnh chưa bị đụng.');
      return 1;
    }
    log(`✓ đã gỡ ${wt.path}`);
    log(`  ngữ cảnh: ${r.ctx.back.length} tệp chép về cây chính · ${r.ctx.same.length} không đổi · ${r.ctx.conflict.length} XUNG ĐỘT`);
    r.ctx.back.forEach((f) => log(`    ↩ ${f}`));
    if (r.ctx.conflict.length) {
      log(`  ⚠️ Cả hai cây đều sửa — KHÔNG ghi đè. Bản của worktree để ở ${rel(flow.cwd, path.join(flow.paths.handoff, `wt-${wt.slug}`))}; gộp tay:`);
      r.ctx.conflict.forEach((f) => log(`    ⚡ ${f}`));
    }
    if (r.links.length) log(`  gỡ ${r.links.length} junction/symlink TRƯỚC khi remove (không đi xuyên vào thư mục đích)`);
    return r.ctx.conflict.length ? 1 : 0;
  }
  if (sub === 'context') {
    const wt = findWorktree(flow, opts._[0] || '');
    const r = reconcileContexts(flow, wt, { apply: false });
    log(`${wt.slug}: ${r.back.length} sẽ chép về · ${r.same.length} không đổi · ${r.conflict.length} xung đột`);
    r.back.forEach((f) => log(`  ↩ ${f}`));
    r.conflict.forEach((f) => log(`  ⚡ ${f}`));
    return 0;
  }
  const m = loadManifest(flow);
  if (!m.worktrees.length) {
    log(`Chưa có worktree nào. Gốc: ${worktreeRoot(flow)} · tạo: flowctl wt new <slug> [--repo r] [--base ref]`);
    return 0;
  }
  const rows = m.worktrees.map((w) => {
    const s = worktreeStatus(w);
    return [w.slug, w.repo, s.branch || w.branch, s.exists ? s.dirty : 'mất', s.commits, s.upstream ? (s.ahead ? `${s.ahead} chưa push` : 'đã push') : 'chưa push', w.created, w.path];
  });
  log(table(rows, ['slug', 'repo', 'nhánh', 'dirty', 'commit', 'remote', 'tạo', 'đường dẫn']));
  return 0;
}
