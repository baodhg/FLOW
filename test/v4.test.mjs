import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'flowctl.mjs');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-flow-neutral-'));
const USER_FILE = path.join(ROOT, 'user.json');
fs.writeFileSync(
  USER_FILE,
  JSON.stringify({
    language: { user: 'vi', team: 'vi' },
    code: { language: 'en', comments: 'unit', naming: 'block' },
    commit: { style: 'conventional', language: 'en', body: 'trailers-only' },
    pr: { language: 'vi' },
    autonomy: 'pr',
  }),
);

function sh(cwd, cmd, args, env = {}) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, AGENT_FLOW_USER: USER_FILE, ...env } });
}

function flowctl(cwd, ...args) {
  return sh(cwd, process.execPath, [CLI, ...args]);
}

function companyRepo() {
  const dir = path.join(ROOT, 'shop-api');
  fs.mkdirSync(path.join(dir, 'src', 'orders'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'k8s'), { recursive: true });
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, '.github', 'pull_request_template.md'), '## Summary\nDescribe the change.\n\n## How was it tested\n- [ ] unit tests\n\n## Risks\nNone.\n');
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm run lint\n      - run: npm test\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: kubectl apply -f k8s/\n');
  fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM node:20\n');
  fs.writeFileSync(path.join(dir, 'k8s', 'deploy.yaml'), 'kind: Deployment\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'shop-api', scripts: { lint: 'eslint .', test: 'jest' } }));
  const authors = [['Ann Lee', 'ann@shop.example'], ['Bo Tran', 'bo@shop.example'], ['Cy Park', 'cy@shop.example']];
  for (let i = 0; i < 40; i++) {
    const body = [
      '/**',
      ` * Computes the order total for version ${i}.`,
      ' * @param items order lines',
      ' * @returns the total in minor units',
      ' */',
      `export function orderTotal${i}(items) {`,
      '  // sum of positive lines only',
      '  return items.reduce((s, x) => s + Math.max(0, x), 0);',
      '}',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'src', 'orders', `total${i}.js`), body);
    sh(dir, 'git', ['add', '-A']);
    const [name, email] = authors[i % 3];
    const date = new Date(Date.now() - (800 - i * 10) * 86400000).toISOString();
    sh(dir, 'git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `SHOP-${100 + i} Add order total rule ${i}`, '-m', 'Explains why the rounding changed for partners.'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
  for (let t = 0; t < 12; t++) sh(dir, 'git', ['tag', `v1.${t}.0`]);
  sh(dir, 'git', ['branch', 'develop']);
  sh(dir, 'git', ['branch', 'feature/SHOP-200-refunds']);
  sh(dir, 'git', ['branch', 'feature/SHOP-201-coupons']);
  sh(dir, 'git', ['branch', 'release/1.12']);
  return dir;
}

function newProject() {
  const dir = path.join(ROOT, 'my-new-app');
  fs.mkdirSync(dir, { recursive: true });
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  sh(dir, 'git', ['config', 'user.email', 'me@me']);
  sh(dir, 'git', ['config', 'user.name', 'me']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# My new app\n');
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-qm', 'chore: start']);
  return dir;
}

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('joining a company legacy repo adopts the TEAM conventions and asks only where your preferences conflict', () => {
  const dir = companyRepo();
  const init = flowctl(dir, 'init');
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const p = JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'profile.json'), 'utf8'));
  assert.equal(p.project.kind, 'legacy-prod');
  assert.equal(p.commit.style, 'ticket');
  assert.equal(p.commit.ticketKey, 'SHOP');
  assert.equal(p.commit.language, 'en');
  assert.equal(p.language.team, 'en', 'PR template is English ⇒ team prose English');
  assert.equal(p.language.user, 'vi', 'chat and .flow stay in the user language');
  assert.ok(p.branches.protected.includes('main') && p.branches.protected.includes('release/*'));
  assert.equal(p.branches.workFrom, 'develop');
  assert.match(p.branches.pattern, /^feature\/<ticket>-<slug>$/);
  assert.ok(p.verify.some((v) => v.run === 'npm run lint' && v.source === 'ci'));
  assert.ok(!p.verify.some((v) => /kubectl/.test(v.run)), 'deploy commands are never verify steps');
  const keys = JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'onboarding.json'), 'utf8')).decisions.map((d) => d.key).sort();
  assert.deepEqual(keys, ['autonomy.level', 'commit.body', 'hygiene.comments']);
  assert.match(init.stdout, /hỏi người dùng TRÊN CHAT/);
  assert.equal(flowctl(dir, 'onboard').status, 1);
  const dc = JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'onboarding.json'), 'utf8')).decisions.find((d) => d.key === 'hygiene.comments');
  const keepTeam = dc.options.findIndex((o) => o.value === 'no-new') + 1;
  assert.equal(flowctl(dir, 'onboard', 'decide', dc.id, String(keepTeam)).status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'profile.json'), 'utf8'));
  assert.equal(after.hygiene.comments, 'no-new');
  assert.equal(after._sources['hygiene.comments'], 'answer');
  assert.notEqual(flowctl(dir, 'commitmsg', '--message', 'feat(orders): keep totals positive').status, 0, 'ticket key required');
  assert.equal(flowctl(dir, 'commitmsg', '--message', 'SHOP-300 Keep order totals positive\n\nPartners reported negative totals.').status, 0, flowctl(dir, 'commitmsg', '--message', 'SHOP-300 Keep order totals positive\n\nPartners reported negative totals.').stdout);
  assert.notEqual(flowctl(dir, 'prmsg', '--message', '## Thay đổi\n- Giữ tổng đơn không âm khi đối tác trả hàng.\n## Đã kiểm\n- Chạy toàn bộ test.').status, 0, 'team writes PRs in English');
  assert.equal(flowctl(dir, 'prmsg', '--message', '## Summary\n- Order totals no longer go negative when a partner returns items.\n## How was it tested\n- Ran the whole test suite.').status, 0);
  const session = sh(dir, process.execPath, [CLI, 'hook', 'session']);
  assert.ok(true, session.stdout);
});

test('a brand-new project takes YOUR preferences as its conventions, with nothing to ask', () => {
  const dir = newProject();
  const init = flowctl(dir, 'init');
  assert.equal(init.status, 0, init.stdout);
  const p = JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'profile.json'), 'utf8'));
  assert.equal(p.project.kind, 'greenfield');
  assert.equal(p.hygiene.comments, 'unit');
  assert.equal(p.hygiene.naming, 'block');
  assert.equal(p.commit.body, 'trailers-only');
  assert.equal(p.commit.style, 'conventional');
  assert.equal(p.language.team, 'vi');
  assert.equal(p.autonomy.level, 'pr');
  assert.equal(p._sources['hygiene.comments'], 'user');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'onboarding.json'), 'utf8')).decisions, []);
  assert.equal(flowctl(dir, 'onboard').status, 0);
});

test('rules DECLARED in the project instructions win over measured habits, with no question asked', () => {
  const dir = path.join(ROOT, 'declared');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Luật\n\n## MÃ KHÔNG CHÚ THÍCH\nChạm tệp nào xoá sạch chú thích CẢ TỆP bị chạm.\n\nThân commit: BỎ — chỉ trailer.\n');
  const authors = [['A', 'a@x'], ['B', 'b@x'], ['C', 'c@x']];
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(dir, 'src', `m${i}.js`), `/** doc ${i} */\nexport const v${i} = ${i};\n// note\n`);
    sh(dir, 'git', ['add', '-A']);
    const [n, e] = authors[i % 3];
    const date = new Date(Date.now() - (500 - i * 5) * 86400000).toISOString();
    sh(dir, 'git', ['-c', `user.name=${n}`, '-c', `user.email=${e}`, 'commit', '-q', '-m', `feat: add value ${i}`, '-m', 'Long explanation of why.'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  }
  assert.equal(flowctl(dir, 'init').status, 0);
  const p = JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'profile.json'), 'utf8'));
  assert.equal(p.hygiene.comments, 'file');
  assert.equal(p.commit.body, 'trailers-only');
  assert.equal(p._sources['hygiene.comments'], 'project');
  const keys = JSON.parse(fs.readFileSync(path.join(dir, '.flow', 'onboarding.json'), 'utf8')).decisions.map((d) => d.key);
  assert.ok(!keys.includes('hygiene.comments') && !keys.includes('commit.body'), keys.join(','));
});

test('fingerprint is read-only and works on a repo without .flow', () => {
  const dir = path.join(ROOT, 'shop-api');
  const before = sh(dir, 'git', ['status', '--porcelain']).stdout;
  const r = flowctl(ROOT, 'fingerprint', '--path', dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /legacy đang chạy production/);
  assert.equal(sh(dir, 'git', ['status', '--porcelain']).stdout, before);
});
