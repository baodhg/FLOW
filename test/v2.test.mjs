import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clusterize, scanText } from '../lib/dup.mjs';
import { lintRunbook } from '../lib/runbook.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'flow.mjs');

function sh(cwd, cmd, args, input) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, input });
}

function tempRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  sh(dir, 'git', ['config', 'user.email', 't@t']);
  sh(dir, 'git', ['config', 'user.name', 't']);
  return dir;
}

const CS_A = [
  'namespace App.Billing;',
  'public static class Money {',
  '  public static string FormatVnd(decimal value, bool withSymbol) {',
  '    var safe = Math.Round(value, 0);',
  '    var text = safe.ToString("N0", new System.Globalization.CultureInfo("vi-VN"));',
  '    if (!withSymbol) { return text.Trim(); }',
  '    return safe < 0 ? "(" + text + " đ)" : text + " đ";',
  '  }',
  '}',
].join('\n');

const CS_B = [
  'namespace App.Orders;',
  'public class PriceLabel {',
  '  public string ToLabel(decimal amount, bool showUnit) {',
  '    var n = Math.Round(amount, 0);',
  '    var output = n.ToString("N0", new System.Globalization.CultureInfo("vi-VN"));',
  '    if (!showUnit) { return output.Trim(); }',
  '    return n < 0 ? "(" + output + " đ)" : output + " đ";',
  '  }',
  '}',
].join('\n');

const CS_C = [
  'namespace App.Orders;',
  'public class Totals {',
  '  public decimal Sum(System.Collections.Generic.List<decimal> items) {',
  '    decimal total = 0;',
  '    foreach (var it in items) { if (it > 0) { total += it * 2; } }',
  '    return System.Math.Max(0, total) + items.Count * 0 + (items.Count > 100 ? 1 : 0);',
  '  }',
  '}',
].join('\n');

test('dup engine finds renamed C# clone, ignores different logic, decorators and Go receivers', () => {
  const funcs = [
    ...scanText('a/Money.cs', CS_A).map((f) => ({ repo: 'r', ...f })),
    ...scanText('b/PriceLabel.cs', CS_B).map((f) => ({ repo: 'r', ...f })),
    ...scanText('b/Totals.cs', CS_C).map((f) => ({ repo: 'r', ...f })),
  ];
  assert.deepEqual(funcs.map((f) => f.name).sort(), ['FormatVnd', 'Sum', 'ToLabel']);
  const cl = clusterize(funcs);
  assert.equal(cl.length, 1);
  assert.deepEqual(cl[0].list.map((f) => f.name).sort(), ['FormatVnd', 'ToLabel']);
  const deco = scanText('g.ts', "@Gateway({ ns: 'x' })\nexport class G {\n  @Sub('join')\n  handleJoin(client: any, room: string) {\n    client.join(room);\n    return { ok: true, room, at: Date.now() };\n  }\n}");
  assert.deepEqual(deco.map((f) => f.name), ['handleJoin']);
  const go = scanText('x.go', 'package x\nfunc (r *Repo) Get(ctx context.Context, id string) (*Item, error) {\n\treturn r.load(ctx, id)\n}\n');
  assert.deepEqual(go.map((f) => f.name), ['Get']);
  const arrow = scanText('h.ts', 'export const useLock = () => {\n  const a = 1;\n  return a;\n};\nconst typed = async (x: number): Promise<number> => {\n  return x + 1;\n};');
  assert.deepEqual(arrow.map((f) => f.name), ['useLock', 'typed']);
});

test('dup check blocks only NEW duplicates, honours baseline, allow list and canonical source', () => {
  const dir = tempRepo('agent-flow-dup-');
  const run = (...a) => sh(dir, process.execPath, [CLI, ...a]);
  try {
    for (const d of ['a', 'b', 'c']) fs.mkdirSync(path.join(dir, 'src', d), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a', 'Money.cs'), CS_A);
    fs.writeFileSync(path.join(dir, 'src', 'c', 'Totals.cs'), CS_C);
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'i']);
    const init = run('init', '--comments', 'off');
    assert.match(init.stdout, /baseline: 0 cụm/);
    fs.writeFileSync(path.join(dir, 'src', 'b', 'PriceLabel.cs'), CS_B);
    sh(dir, 'git', ['add', '-A']);
    const blocked = run('check', '--staged');
    assert.equal(blocked.status, 1, blocked.stdout);
    assert.match(blocked.stdout, /mới\/sửa: `ToLabel`/);
    assert.match(blocked.stdout, /đã có: {3}`FormatVnd`/);
    const key = /key (alpha:[0-9a-f]+)/.exec(blocked.stdout)[1];
    assert.equal(run('dup', 'allow', key, '--reason', 'tách module có chủ đích').status, 0);
    assert.equal(run('dup', 'check', '--staged').status, 0);
    assert.match(run('dup', 'find', 'format', 'money').stdout, /FormatVnd/);
    const p = path.join(dir, '.flow', 'profile.json');
    const prof = JSON.parse(fs.readFileSync(p, 'utf8'));
    prof.canonical = { FormatVnd: 'src/a/Money.cs' };
    fs.writeFileSync(p, JSON.stringify(prof));
    fs.writeFileSync(path.join(dir, 'src', 'c', 'Again.cs'), 'public class Again { public string FormatVnd(decimal v) { var a = v + 1; var b = a * 2; var c = b - 3; return (a + b + c).ToString() + "x" + v.ToString(); } }');
    sh(dir, 'git', ['add', '-A']);
    const canon = run('dup', 'check', '--staged');
    assert.equal(canon.status, 1, canon.stdout);
    assert.match(canon.stdout, /NGUỒN CHUẨN src\/a\/Money\.cs/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('existing duplicates recorded in the baseline are not blocked when their files are touched', () => {
  const dir = tempRepo('agent-flow-dupbase-');
  const run = (...a) => sh(dir, process.execPath, [CLI, ...a]);
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'Money.cs'), CS_A);
    fs.writeFileSync(path.join(dir, 'src', 'PriceLabel.cs'), CS_B);
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'i']);
    assert.match(run('init', '--comments', 'off').stdout, /baseline: 1 cụm/);
    fs.appendFileSync(path.join(dir, 'src', 'PriceLabel.cs'), '\n');
    sh(dir, 'git', ['add', '-A']);
    assert.equal(run('dup', 'check', '--staged').status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tasks drive execution: next, done with commit, helper ledger, DONE refused while tasks open', () => {
  const dir = tempRepo('agent-flow-task-');
  const run = (...a) => sh(dir, process.execPath, [CLI, ...a]);
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'i']);
    run('init');
    const file = run('plan', 'new', 'p1').stdout.trim();
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/- \[ \] \*\*D1\*\*.*\n/, ''));
    assert.equal(run('task', 'next', 'p1').status, 1);
    run('task', 'add', 'p1', 'Viết hook khoá submit — test đỏ trước: bấm 2 lần ⇒ 1 lời gọi — tái dùng: mới');
    run('task', 'add', 'p1', 'Dùng hook ở form mượn sách — tái dùng: useHoldRequest');
    assert.equal(run('plan', 'status', 'p1', 'APPROVED').status, 0);
    run('task', 'note', 'p1', 'useHoldRequest ở src/hooks/use-hold-request.ts', '--kind', 'helper');
    const next = run('task', 'next', 'p1');
    assert.match(next.stdout, /Tiếp theo: T1/);
    assert.match(next.stdout, /dùng lại, đừng viết lại[\s\S]*useHoldRequest/);
    const done = run('task', 'done', 'p1', 'T1');
    assert.match(done.stdout, /✓ p1 T1 · .*@[0-9a-f]+/);
    assert.match(done.stdout, /Tiếp theo: T2/);
    const refused = run('plan', 'status', 'p1', 'DONE');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /còn 1 task mở \(T2\)/);
    run('task', 'done', 'p1', 'T2');
    assert.equal(run('plan', 'status', 'p1', 'DONE').status, 0);
    const hook = sh(dir, process.execPath, [CLI, 'hook', 'session'], JSON.stringify({ cwd: dir }));
    assert.match(hook.stdout, /FLOW đang bật/);
    const none = sh(os.tmpdir(), process.execPath, [CLI, 'hook', 'session'], JSON.stringify({ cwd: os.tmpdir() }));
    assert.equal(none.stdout, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runbook lint enforces negative control, misdiagnosis branch, SQL assertions and filled results', () => {
  const acc = [
    '---', 'kind: acceptance', '---', '## 2. Ca kiểm', '#### TC-01 · mở trang [dương]', '1. bấm',
    '**Kỳ vọng:** `GET /api/x` → **200**.', '## 3. Kết quả', '| TC | Kết quả |', '|---|---|', '| TC-01 | |', '## 4. Diễn giải', '| a | b |', '',
  ].join('\n');
  const r = lintRunbook(acc).problems.join(' | ');
  assert.match(r, /giả thuyết sai/);
  assert.match(r, /đối chứng âm/);
  assert.match(r, /không đổi trạng thái/);
  const fixed = acc.replace('[dương]', '[âm]').replace('**200**.', '**200**. Nội dung khác nghĩa là giả thuyết sai, dừng lại. Đã xét trường hợp không đổi trạng thái.');
  assert.deepEqual(lintRunbook(fixed).problems, []);
  assert.match(lintRunbook(fixed, { after: true }).problems.join(' '), /ô kết quả trống/);
  assert.deepEqual(lintRunbook(fixed.replace('| TC-01 | |', '| TC-01 | pass |'), { after: true }).problems, []);
  const sql = ['---', 'kind: data-op', '---', '## 2. Script', '```sql', 'BEGIN;', 'UPDATE t SET a = 1;', 'COMMIT;', '```', '## 3. Đọc lại', 'SELECT 1;', ''].join('\n');
  const s = lintRunbook(sql).problems.join(' | ');
  assert.match(s, /RAISE EXCEPTION/);
  assert.match(s, /bak_/);
  assert.match(s, /ROLLBACK/);
});

test('every shipped runbook template only misses the blanks a writer must fill', () => {
  for (const kind of ['acceptance', 'ops', 'data-op', 'release', 'handoff']) {
    const template = fs.readFileSync(new URL(`../templates/runbooks/${kind}.md`, import.meta.url), 'utf8');
    const { problems } = lintRunbook(`---\nkind: ${kind}\n---\n${template}`);
    assert.deepEqual(problems.filter((p) => !/khung chưa điền/.test(p)), [], kind);
  }
});

test('skill pack passes its own selftest', () => {
  const r = sh(process.cwd(), process.execPath, [CLI, 'selftest']);
  assert.equal(r.status, 0, r.stdout);
});
