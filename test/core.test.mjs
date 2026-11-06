import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decideBash } from '../lib/commands.mjs';
import { parseFrontmatter, stringifyFrontmatter, updateFrontmatter } from '../lib/frontmatter.mjs';
import { checkCommitMessage, detectComment } from '../lib/hygiene.mjs';
import { globToRegExp, matchAny, slugify } from '../lib/util.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'flow.mjs');

test('glob matching', () => {
  assert.ok(matchAny(['src/modules/billing/**'], 'src/modules/billing/a/b.ts'));
  assert.ok(matchAny(['*.ts'], 'deep/dir/x.ts'));
  assert.ok(matchAny(['**/*.{ts,tsx}'], 'a.tsx'));
  assert.ok(!matchAny(['src/*'], 'src/a/b.ts'));
  assert.ok(globToRegExp('/src/*').test('src/x'));
  assert.ok(matchAny(['**/*payment*'], 'api/src/payments/payment.service.ts'));
});

test('slugify strips Vietnamese diacritics and cuts at word boundary', () => {
  assert.equal(slugify('Đường dẫn Thanh toán'), 'duong-dan-thanh-toan');
  assert.equal(slugify('Webhook thanh toán phải idempotent theo mã giao dịch', 50), 'webhook-thanh-toan-phai-idempotent-theo-ma-giao');
});

test('frontmatter round trip with arrays and nested maps', () => {
  const text = stringifyFrontmatter({ id: 'R-0001', scope: ['a/**', 'b'], title: 'x: y', metadata: { type: 'feedback' } }) + '\nbody\n';
  const { data, body } = parseFrontmatter(text);
  assert.deepEqual(data.scope, ['a/**', 'b']);
  assert.equal(data.title, 'x: y');
  assert.equal(data.metadata.type, 'feedback');
  assert.equal(body.trim(), 'body');
  assert.equal(parseFrontmatter(updateFrontmatter(text, { status: 'DONE' })).data.status, 'DONE');
});

test('comment detection keeps directives and ignores strings', () => {
  const yes = [
    ['a.ts', '// note'],
    ['a.ts', 'const a = 1; // why'],
    ['a.ts', '/* block */'],
    ['a.ts', ' * jsdoc line'],
    ['a.tsx', '{/* jsx */}'],
    ['a.py', '# python note'],
    ['a.yml', 'key: v # trailing'],
    ['a.sql', '-- note'],
    ['Dockerfile', '# build stage'],
    ['a.css', '/* style */'],
    ['a.html', '<!-- x -->'],
  ];
  const no = [
    ['a.ts', 'const u = "http://x.y";'],
    ['a.ts', "const s = 'a // b';"],
    ['a.ts', '// eslint-disable-next-line no-console'],
    ['a.ts', '// @ts-expect-error'],
    ['a.go', '//go:build linux'],
    ['a.go', '//nolint:errcheck'],
    ['a.sql', '-- +goose Up'],
    ['a.py', 'x = 1  # noqa'],
    ['a.ts', 'const x = a * b;'],
    ['a.md', '# Title'],
    ['a.json', '{"a": "#b"}'],
    ['a.ts', 'const r = 10 / 2;'],
  ];
  for (const [f, t] of yes) assert.ok(detectComment(f, t, 5), `should flag ${f}: ${t}`);
  for (const [f, t] of no) assert.equal(detectComment(f, t, 5), null, `should not flag ${f}: ${t}`);
  assert.equal(detectComment('run.sh', '#!/usr/bin/env bash', 1), null);
});

test('commit message trailers-only policy', () => {
  assert.deepEqual(checkCommitMessage('feat: x\n\nCo-Authored-By: A <a@b>\nCloses #3'), []);
  assert.equal(checkCommitMessage('feat: x\n\nBecause reasons.').length, 1);
  assert.equal(checkCommitMessage('feat: x\nno blank').length, 1);
  assert.deepEqual(checkCommitMessage('feat: x\n\nprose ok', 'free'), []);
});

test('protected branch decisions', () => {
  const ctx = { protectedBranches: ['main', 'product'], currentBranchOf: () => 'feat/a' };
  assert.ok(decideBash('git push origin main', ctx));
  assert.ok(decideBash('git push origin HEAD:product', ctx));
  assert.ok(decideBash('git push -f origin +main', ctx));
  assert.ok(decideBash('gh pr create --base main -t x', ctx));
  assert.ok(decideBash('glab mr create --target-branch=product', ctx));
  assert.ok(decideBash('git push origin --delete main', ctx));
  assert.equal(decideBash('git push origin feat/a', ctx), null);
  assert.equal(decideBash('git push', ctx), null);
  assert.ok(decideBash('git push', { ...ctx, currentBranchOf: () => 'main' }));
  assert.equal(decideBash('echo "git push origin main"', ctx), null);
  assert.equal(decideBash('gh pr create --base dev', ctx), null);
});

function sh(cwd, cmd, args) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
}

test('init → exclude → check end to end in a temp repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-'));
  try {
    sh(dir, 'git', ['init', '-q', '-b', 'main']);
    sh(dir, 'git', ['config', 'user.email', 't@t']);
    sh(dir, 'git', ['config', 'user.name', 't']);
    fs.mkdirSync(path.join(dir, 'src', 'modules', 'pay'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'modules', 'pay', 'a.ts'), 'export const a = 1;\n');
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'init']);
    const init = sh(dir, process.execPath, [CLI, 'init', '--comments', 'unit', '--naming', 'block']);
    assert.equal(init.status, 0, init.stdout + init.stderr);
    assert.ok(fs.existsSync(path.join(dir, '.flow', 'profile.json')));
    assert.equal(sh(dir, 'git', ['status', '--porcelain']).stdout.trim(), '');
    const ctx = sh(dir, process.execPath, [CLI, 'context', 'new', 'src/modules/pay']);
    assert.equal(ctx.status, 0, ctx.stdout);
    assert.equal(sh(dir, 'git', ['status', '--porcelain']).stdout.trim(), '');
    fs.appendFileSync(path.join(dir, 'src', 'modules', 'pay', 'a.ts'), 'export const b = 2; // explain\n');
    sh(dir, 'git', ['add', '-A']);
    const check = sh(dir, process.execPath, [CLI, 'check', '--staged']);
    assert.equal(check.status, 1, check.stdout);
    assert.match(check.stdout, /a\.ts:2/);
    const staged = sh(dir, 'git', ['diff', '--cached', '--name-only']).stdout;
    assert.doesNotMatch(staged, /CONTEXT\.md|\.flow/);
    const doctor = sh(dir, process.execPath, [CLI, 'doctor']);
    assert.equal(doctor.status, 0, doctor.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detects nested dotnet solution and nested package.json', async () => {
  const { detectStacks } = await import('../lib/detect.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-detect-'));
  try {
    sh(dir, 'git', ['init', '-q']);
    fs.mkdirSync(path.join(dir, 'src', 'web'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'Api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'App.sln'), '');
    fs.writeFileSync(path.join(dir, 'src', 'Api', 'Api.csproj'), '<Project/>');
    fs.writeFileSync(path.join(dir, 'src', 'web', 'package.json'), JSON.stringify({ dependencies: { react: '18' }, scripts: { lint: 'eslint .', build: 'vite build' } }));
    const r = detectStacks(dir);
    assert.ok(r.stacks.includes('dotnet') && r.stacks.includes('react'), JSON.stringify(r.stacks));
    const build = r.verify.find((v) => v.name === 'dotnet-build');
    assert.match(build.run, /dotnet build App\.sln/);
    const lint = r.verify.find((v) => v.name === 'web:lint');
    assert.equal(lint.cwd, 'src/web');
    assert.ok(lint.when.every((g) => g.startsWith('src/web/')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('planned stacks are skipped visibly, never reported green', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-plan-'));
  try {
    sh(dir, 'git', ['init', '-q', '-b', 'main']);
    sh(dir, 'git', ['config', 'user.email', 't@t']);
    sh(dir, 'git', ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'i']);
    const init = sh(dir, process.execPath, [CLI, 'init', '--stack', 'dotnet,react@src/web']);
    assert.equal(init.status, 0, init.stdout);
    const v = sh(dir, process.execPath, [CLI, 'verify', '--full']);
    assert.equal(v.status, 0, v.stdout);
    assert.match(v.stdout, /BỎ QUA/);
    assert.doesNotMatch(v.stdout, /✓/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gate triggers ignore case so PascalCase files still match', () => {
  assert.ok(!matchAny(['**/*consumer*'], 'src/Jobs/GroupEventsConsumer.cs'));
  assert.ok(matchAny(['**/*consumer*'], 'src/Jobs/GroupEventsConsumer.cs', { nocase: true }));
});

test('plan approval is refused while decisions are open, accepted once decided in the record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-dec-'));
  const run = (...a) => sh(dir, process.execPath, [CLI, ...a]);
  try {
    sh(dir, 'git', ['init', '-q', '-b', 'main']);
    sh(dir, 'git', ['config', 'user.email', 't@t']);
    sh(dir, 'git', ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    sh(dir, 'git', ['add', '-A']);
    sh(dir, 'git', ['commit', '-qm', 'i']);
    assert.equal(run('init').status, 0);
    const created = run('plan', 'new', 'cap-lock', '--title', 'Capacity lock');
    const file = created.stdout.trim();
    let t = fs.readFileSync(file, 'utf8');
    assert.equal(run('plan', 'status', 'cap-lock', 'APPROVED').status, 1, 'template placeholder D1 must block');
    t = t.replace(/- \[ \] \*\*D1\*\*.*\n/, '- [ ] **D1** Khoá sức chứa bằng cách nào — lựa chọn: UPDATE có điều kiện (khuyến nghị) / UPDLOCK / rowversion — ảnh hưởng: §2 tệp repository\n- [ ] **D2** Có hỗ trợ rời nhóm không — lựa chọn: Có / Không (khuyến nghị)\n');
    fs.writeFileSync(file, t);
    const asked = run('plan', 'decisions', 'cap-lock');
    assert.equal(asked.status, 1);
    assert.match(asked.stdout, /\*\*D1 · Khoá sức chứa bằng cách nào\*\*/);
    assert.match(asked.stdout, /1\. UPDATE có điều kiện \(khuyến nghị\)/);
    assert.match(asked.stdout, /4\. Khác/);
    const blocked = run('plan', 'status', 'cap-lock', 'APPROVED');
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /2 quyết định mở \(D1, D2\)/);
    assert.equal(run('plan', 'decide', 'cap-lock', 'D1', 'UPDATE có điều kiện').status, 0);
    assert.equal(run('plan', 'decide', 'cap-lock', 'D2', 'Không').status, 0);
    assert.match(fs.readFileSync(file, 'utf8'), /- \[x\] \*\*D1\*\* .* → \*\*UPDATE có điều kiện\*\* \(người dùng chốt \d{4}-\d{2}-\d{2}\)/);
    assert.equal(run('plan', 'decisions', 'cap-lock').status, 0);
    assert.equal(run('plan', 'status', 'cap-lock', 'APPROVED').status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
