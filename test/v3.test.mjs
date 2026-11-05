import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { commitTitleProblems, prDescriptionProblems } from '../lib/commands.mjs';
import { declaredNames, newVietnameseNames, vietnameseHit, vietnameseMessages } from '../lib/naming.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'flowctl.mjs');

function sh(cwd, cmd, args, input) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, input });
}

function tempRepo(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir);
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  sh(dir, 'git', ['config', 'user.email', 't@t']);
  sh(dir, 'git', ['config', 'user.name', 't']);
  return { root, dir };
}

test('Vietnamese identifiers are caught in TS, C#, Go; English ones and legacy names pass', () => {
  for (const bad of ['coTaiKhoan', 'ngayTraSach', 'lamTronTienPhat', 'tongTien', 'HoaDonService', 'dsThanhVien', 'tên']) assert.ok(vietnameseHit(bad), bad);
  for (const ok of ['normalizePhone', 'location', 'memberName', 'formatDueDate', 'handleSubmit', 'getUser', 'loc', 'congestion']) assert.equal(vietnameseHit(ok), null, ok);
  assert.deepEqual(declaredNames('a.cs', 'public class ThuVienService {\n  public async Task<int> MuonSach(Guid id) {\n    var soLuong = 1;\n  }\n}').sort(), ['MuonSach', 'ThuVienService', 'ThuVienService', 'soLuong'].sort());
  assert.deepEqual(declaredNames('x.go', 'func (r *Repo) TimSach(id string) error {\n tenSach := "a"\n}'), ['TimSach', 'tenSach']);
  const before = 'const khachHang = 1;\n';
  const after = 'const khachHang = 1;\nconst tongTien = 2;\nconst total = 3;\n';
  assert.deepEqual(newVietnameseNames('src/a.ts', before, after).map((h) => h.name), ['tongTien']);
  assert.deepEqual(newVietnameseNames('src/locales/vi.ts', '', 'const tongTien = 1;'), []);
  assert.deepEqual(vietnameseMessages('throw new Error("Không tìm thấy sách"); logger.error("Khong tim thay nguoi muon"); throw new Error("Book not found.")'), ['Không tìm thấy sách', 'Khong tim thay nguoi muon']);
});

test('flowctl check blocks new Vietnamese names, Vietnamese file names and Vietnamese error messages', () => {
  const { root, dir } = tempRepo('agent-flow-naming-');
  const run = (...a) => sh(dir, process.execPath, [CLI, ...a]);
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const khachHang = 1;\n');
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'i']);
    run('init', '--comments', 'unit', '--naming', 'block');
    fs.appendFileSync(path.join(dir, 'src', 'cart.ts'), 'export const total = 2;\n');
    sh(dir, 'git', ['add', '-A']);
    const clean = run('check', '--staged');
    assert.equal(clean.status, 0, clean.stdout);
    fs.appendFileSync(path.join(dir, 'src', 'cart.ts'), 'export function tinhTongTien(a: number) {\n  if (a < 0) throw new Error("Số tiền không hợp lệ");\n  return a;\n}\n');
    fs.writeFileSync(path.join(dir, 'src', 'don-hang.ts'), 'export const orderTotal = 1;\n');
    sh(dir, 'git', ['add', '-A']);
    const bad = run('check', '--staged');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /tinhTongTien/);
    assert.match(bad.stdout, /Số tiền không hợp lệ/);
    assert.match(bad.stdout, /tên tệp\s+src\/don-hang\.ts/);
    assert.doesNotMatch(bad.stdout, /`khachHang`/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('commit titles must be English, conventional and human-readable; PR descriptions short Vietnamese prose', () => {
  assert.deepEqual(commitTitleProblems('feat(orders): keep the order total when a coupon is removed'), []);
  assert.ok(commitTitleProblems('fix: sửa lỗi tính tiền').some((p) => /tiếng Anh/.test(p)));
  assert.ok(commitTitleProblems('refactor(cart): update calcTotal() in src/cart/total.ts').some((p) => /người đọc/.test(p)));
  assert.ok(commitTitleProblems('update stuff').some((p) => /Conventional/.test(p)));
  assert.deepEqual(prDescriptionProblems('## Thay đổi\n- Khi khách bỏ mã giảm giá, tổng đơn không còn về 0.\n## Đã kiểm\n- Chạy toàn bộ test, thử trên QC.'), []);
  const tech = prDescriptionProblems('Sua `calcTotal()` `useCartStore` `applyCoupon()` `removeCoupon()` `CartTotalDto` `OrderService.recalc()` `x` don hang tong tien khach hang');
  assert.ok(tech.some((p) => /CÓ DẤU/.test(p)));
  assert.ok(tech.some((p) => /Quá kỹ thuật/.test(p)));
});

test('worktree carries local context, finds the main .flow, never deletes through a junction, never overwrites a context both sides edited', () => {
  const { root, dir } = tempRepo('agent-flow-wt-');
  const run = (cwd, ...a) => sh(cwd, process.execPath, [CLI, ...a]);
  try {
    fs.mkdirSync(path.join(dir, 'src', 'pay'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'pay', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'i']);
    run(dir, 'init');
    run(dir, 'context', 'new', 'src/pay');
    const shared = path.join(root, 'shared-target');
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, 'keep.txt'), 'must survive');
    const created = run(dir, 'wt', 'new', 'one', '--base', 'main');
    assert.equal(created.status, 0, created.stdout + created.stderr);
    const wt = path.join(root, 'app-worktrees', 'app-one');
    assert.ok(fs.existsSync(path.join(wt, 'src', 'pay', 'CONTEXT.md')), 'context copied into worktree');
    assert.match(run(wt, 'where').stdout, new RegExp(`Flow root : ${dir.replace(/[\\]/g, '\\\\')}`));
    fs.symlinkSync(shared, path.join(wt, 'node_modules'), 'junction');
    fs.appendFileSync(path.join(wt, 'src', 'pay', 'CONTEXT.md'), '\nworktree note\n');
    const done = run(dir, 'wt', 'done', 'one');
    assert.equal(done.status, 0, done.stdout);
    assert.ok(fs.existsSync(path.join(shared, 'keep.txt')), 'junction target untouched');
    assert.match(fs.readFileSync(path.join(dir, 'src', 'pay', 'CONTEXT.md'), 'utf8'), /worktree note/);
    assert.ok(!fs.existsSync(wt));
    run(dir, 'wt', 'new', 'two', '--base', 'main');
    const wt2 = path.join(root, 'app-worktrees', 'app-two');
    fs.appendFileSync(path.join(wt2, 'src', 'pay', 'CONTEXT.md'), '\nfrom worktree two\n');
    fs.appendFileSync(path.join(dir, 'src', 'pay', 'CONTEXT.md'), '\nnewer on main\n');
    const clash = run(dir, 'wt', 'done', 'two');
    assert.equal(clash.status, 1);
    assert.match(clash.stdout, /XUNG ĐỘT/);
    const mainText = fs.readFileSync(path.join(dir, 'src', 'pay', 'CONTEXT.md'), 'utf8');
    assert.match(mainText, /newer on main/);
    assert.doesNotMatch(mainText, /from worktree two/);
    assert.ok(fs.existsSync(path.join(dir, '.flow', 'handoff', 'wt-two', 'src', 'pay', 'CONTEXT.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
