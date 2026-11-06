import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decideSecretCommand, envSecretValues, mask, safeEnvView, scanEnvValuesInLine, scanPiiInLine, scanSecretsInLine, scannerSelfCheck, sensitiveFile } from '../lib/secrets.mjs';

const PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PACK, 'bin', 'flow.mjs');
const FAKE = {
  aws: `AKIA${'QWERTYUIOPASDFGH'}`,
  github: `ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`,
  gitlab: `glpat-${'Ab3dEf6hIj9lMn2pQr5t'}`,
  dbPass: `Xk9${'@vT2'}mQ7z`,
  field: `Zp4${'Lm8'}Qw2Rt6Yn`,
  prose: `Bn7${'Hq3'}Vx9Kd2`,
};

function sh(cwd, cmd, args, input) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, input, env: { ...process.env, AGENT_FLOW_USER: path.join(os.tmpdir(), 'no-such-user.json') } });
}

function repo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  sh(dir, 'git', ['config', 'user.email', 'dev@dev.invalid']);
  sh(dir, 'git', ['config', 'user.name', 'dev']);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# app\n');
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-qm', 'chore: start']);
  return dir;
}

const flow = (cwd, ...a) => sh(cwd, process.execPath, [CLI, ...a]);
const secretRules = (file, text) => scanSecretsInLine({ file, line: 1, text }).map((f) => f.rule);

test('scanner self-check holds and every known token shape is caught', () => {
  assert.ok(scannerSelfCheck());
  assert.deepEqual(secretRules('a.txt', `key ${FAKE.aws}`), ['aws-access-key']);
  assert.deepEqual(secretRules('a.txt', FAKE.github), ['github-token']);
  assert.deepEqual(secretRules('a.txt', FAKE.gitlab), ['gitlab-token']);
  assert.ok(secretRules('a.txt', `-----BEGIN RSA ${'PRIVATE'} KEY-----`).includes('private-key'));
  assert.ok(secretRules('a.ts', `const u = "postgres://app:${FAKE.dbPass}@10.0.0.5:5432/app"`).includes('db-uri-with-password'), 'password containing @');
  assert.ok(secretRules('a.cs', `"Server=db;Database=app;User Id=sa;Password=${FAKE.field};"`).includes('connection-string-password'));
  assert.ok(secretRules('.env', `API_KEY=${FAKE.field}`).includes('secret-field'));
  assert.ok(secretRules('a.ts', `const apiKey = "${FAKE.field}";`).includes('secret-field'));
});

test('placeholders, references and obvious fixtures are not secrets', () => {
  for (const [file, text] of [
    ['a.ts', 'password: dto.password,'],
    ['a.ts', 'const token = await getToken();'],
    ['.env.example', 'JWT_SIGNING_KEY=<at-least-32-random-characters>'],
    ['.env.example', 'API_KEY=change-me'],
    ['compose.yml', 'Jwt__SigningKey: ${JWT_SIGNING_KEY}'],
    ['a.ts', 'const k = process.env.API_KEY;'],
    ['a.md', 'postgres://localhost:5432/db'],
    ['a.md', 'redis://cache:6379'],
    ['a.md', 'postgres://user:password@localhost/db'],
    ['src/api.test.ts', "refreshToken: 'refresh-1',"],
    ['tests/Tokens.cs', 'const string SigningKey = "test-signing-key-long-enough-for-hmac";'],
    ['Data/Factory.cs', '"Server=.;Database=x;User Id=sa;Password=design-time-only;"'],
  ]) assert.deepEqual(secretRules(file, text), [], `${file}: ${text}`);
  assert.ok(secretRules('tests/Tokens.cs', `const string SigningKey = "${FAKE.field}";`).length, 'random value in a test file is still flagged');
});

test('personal data rules catch real shapes and ignore placeholders', () => {
  const pii = (text, file = 'a.ts') => scanPiiInLine({ file, line: 1, text }).map((f) => f.rule);
  assert.deepEqual(pii(`mail tới nguyen.an@${'congty.vn'}`), ['email']);
  assert.deepEqual(pii('a@example.com noreply@congty.vn'), []);
  assert.deepEqual(pii(`gọi 09${'12478365'}`), ['phone-vn']);
  assert.deepEqual(pii(`gọi 09${'11111111'} hoặc 0123456789`), []);
  assert.deepEqual(pii(`STK: 19${'03456789012'}`), ['bank-account']);
  assert.deepEqual(pii(`https://img.vietqr.io/image/VCB-19${'03456789012'}-compact.png`), ['bank-account'], 'bare VietQR URL shape');
  assert.deepEqual(pii(`CCCD 0790${'12345678'}`), ['national-id']);
  assert.deepEqual(pii(`the visa 4111 1111 ${'1111 1111'}`), ['card-number']);
  assert.deepEqual(pii('hello@team.vn', 'CODEOWNERS'), []);
  const own = `me@${'mine.vn'}`;
  assert.deepEqual(scanPiiInLine({ file: 'a.ts', line: 1, text: own }, { knownEmails: new Set([own]) }), []);
});

test('sensitive file names and env handling never expose values', () => {
  assert.ok(sensitiveFile('.env'));
  assert.ok(sensitiveFile('deploy/.env.production'));
  assert.equal(sensitiveFile('.env.example'), null);
  assert.ok(sensitiveFile('certs/server.pem'));
  assert.ok(sensitiveFile('id_rsa'));
  assert.equal(mask(FAKE.field), `***(${FAKE.field.length})`, 'not a single character of the value is shown');
  const env = [`REDIS_URL=redis://u:${FAKE.dbPass}@cache.internal:6379/0`, `DB_PASSWORD=${FAKE.field}`, 'NODE_ENV=production', 'JWT_ISSUER=lending-app'].join('\n');
  const view = safeEnvView(env).join('\n');
  assert.ok(!view.includes(FAKE.dbPass) && !view.includes(FAKE.field), view);
  assert.match(view, /REDIS_URL=redis:\/\/\*\*\*@cache\.internal:6379/, 'host taken after the LAST @');
  assert.match(view, /NODE_ENV=production/);
  assert.match(view, /JWT_ISSUER=<11 ký tự>/);
  const values = envSecretValues(env);
  assert.ok(values.has(FAKE.dbPass) && values.has(FAKE.field));
  assert.ok(!values.has('production') && !values.has('lending-app'));
});

test('regressions: real-looking values that are not secrets: weak dev values, ordinary code and PEM headers in examples', () => {
  const values = envSecretValues('DATABASE_URL=postgres://postgres:postgres@localhost:5432/app\nDB_PASSWORD=postgres\nAPI_TOKEN=abcdefghij\n');
  assert.equal(values.size, 0, 'a weak dev password must not be searched as a substring');
  assert.deepEqual(secretRules('prisma/schema.prisma', 'provider = "postgresql"'), []);
  assert.deepEqual(secretRules('src/route.ts', 'const password = body;'), [], 'ordinary code with a semicolon');
  assert.deepEqual(secretRules('src/route.ts', 'user.password = hashed;'), []);
  assert.deepEqual(secretRules('.env.example', `PRIVATE_KEY="-----BEGIN ${'PRIVATE'} KEY-----\\n...\\n-----END ${'PRIVATE'} KEY-----"`), [], 'header only in an example file');
  assert.ok(secretRules('config/app.pem', `-----BEGIN ${'PRIVATE'} KEY-----`).includes('private-key'), 'the same header in a real file still counts');
  assert.deepEqual(secretRules('src/ENV.ts', 'const u = "postgres://postgres:postgres@localhost:5432/app"'), []);
  for (const [file, text] of [
    ['CONTRACT.md', 'SIGNING_SECRET: PAYMENT_WEBHOOK_SECRET'],
    ['src/config/routes.ts', 'const resetPassword = "/reset-password";'],
    ['scripts/proof.ps1', '$m = [regex]::Match($url, "postgres://([^:]+):([^@]+)@")'],
    ['src/auth/options.ts', 'const tokenKey = "NextAuthSessionToken";'],
    ['src/auth/check.ts', 'const token = "next-auth";'],
    ['test/unit/users.spec.ts', 'password: "pass123",'],
    ['src/modules/x.spec.ts', 'const hashSecret = "TESTSECRET' + '0123456789ABCDEFGHIJKL";'],
    ['docker-compose.yml', 'POSTGRES_PASSWORD: ${DB_PASSWORD:-libraryapp}'],
  ]) assert.deepEqual(secretRules(file, text), [], `${file}: ${text}`);
  assert.ok(secretRules('src/config.ts', `const apiToken = "${FAKE.field}";`).length, 'a random value in production code is still flagged');
  assert.ok(secretRules('.env', 'DB_PASSWORD=correct-horse-battery').length, 'a word-like password in a real env file is still flagged');
  const strong = envSecretValues(`DB_PASSWORD=${FAKE.field}\n`);
  const hit = (text) => scanEnvValuesInLine({ file: 'a.md', line: 1, text }, strong).length;
  assert.equal(hit(`mật khẩu là ${FAKE.field} nhé`), 1);
  assert.equal(hit(`prefix${FAKE.field}suffix`), 0, 'must stand on its own, not as a substring');
});

test('check blocks a staged secret without printing it; allow records a verdict with a reason', () => {
  const dir = repo('af-sec-check-');
  try {
    flow(dir, 'init');
    fs.writeFileSync(path.join(dir, 'config.ts'), `export const apiKey = "${FAKE.field}";\n`);
    sh(dir, 'git', ['add', '-A']);
    const r = flow(dir, 'check', '--staged');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /SECRET secret-field/);
    assert.ok(!r.stdout.includes(FAKE.field), 'value must never be printed');
    const json = flow(dir, 'secrets', 'scan', '--staged', '--json', '--no-gitleaks');
    assert.ok(!json.stdout.includes(FAKE.field));
    const fp = /#([0-9a-f]{16})/.exec(r.stdout)[1];
    assert.equal(flow(dir, 'secrets', 'allow', fp).status, 1, 'reason is mandatory');
    assert.equal(flow(dir, 'secrets', 'allow', fp, '--reason', 'đã mở ra xem: giá trị mẫu').status, 0);
    assert.equal(flow(dir, 'check', '--staged').status, 0);
    const base = fs.readFileSync(path.join(dir, '.flow', 'secrets', 'baseline.json'), 'utf8');
    assert.ok(!base.includes(FAKE.field), 'baseline stores fingerprints only');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('value layer finds a live .env value sitting bare in prose, which shape rules miss', () => {
  const dir = repo('af-sec-value-');
  try {
    flow(dir, 'init');
    fs.writeFileSync(path.join(dir, '.env'), `DB_PASSWORD=${FAKE.prose}\n`);
    fs.writeFileSync(path.join(dir, 'notes.md'), `Mật khẩu staging hiện là ${FAKE.prose} nhé\n`);
    assert.deepEqual(secretRules('notes.md', `Mật khẩu staging hiện là ${FAKE.prose} nhé`), [], 'control: shape rules are blind here');
    sh(dir, 'git', ['add', 'notes.md']);
    const r = flow(dir, 'secrets', 'scan', '--staged', '--no-gitleaks');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /env-value:DB_PASSWORD/);
    assert.ok(!r.stdout.includes(FAKE.prose));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('history scan finds a secret deleted from the tree and reports the commit', () => {
  const dir = repo('af-sec-hist-');
  try {
    flow(dir, 'init');
    fs.writeFileSync(path.join(dir, 'config.ts'), `export const apiKey = "${FAKE.field}";\n`);
    sh(dir, 'git', ['add', 'config.ts']);
    sh(dir, 'git', ['commit', '-qm', 'feat: add config']);
    fs.writeFileSync(path.join(dir, 'config.ts'), 'export const apiKey = process.env.API_KEY;\n');
    sh(dir, 'git', ['add', 'config.ts']);
    sh(dir, 'git', ['commit', '-qm', 'fix: read key from env']);
    assert.equal(flow(dir, 'secrets', 'scan', '--no-gitleaks').status, 0);
    const h = flow(dir, 'secrets', 'scan', '--history', '--no-gitleaks');
    assert.equal(h.status, 1, h.stdout);
    assert.match(h.stdout, /config\.ts:1 .*@[0-9a-f]{9} chưa push/);
    assert.ok(!h.stdout.includes(FAKE.field));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('watch list stores only salted hashes and still catches the bare value', () => {
  const dir = repo('af-sec-watch-');
  try {
    flow(dir, 'init');
    const account = `19${'03456789012'}`;
    assert.equal(sh(dir, process.execPath, [CLI, 'secrets', 'watch', '--label', 'so-tk'], account).status, 0);
    const stored = fs.readFileSync(path.join(dir, '.flow', 'secrets', 'watch.json'), 'utf8');
    assert.ok(!stored.includes(account));
    fs.writeFileSync(path.join(dir, 'pay.md'), `Chuyển vào ${account} giúp\n`);
    sh(dir, 'git', ['add', 'pay.md']);
    const r = flow(dir, 'secrets', 'scan', '--staged', '--no-gitleaks', '--no-pii');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /watch:so-tk/);
    assert.ok(!r.stdout.includes(account));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('risky commands are blocked by shape, ordinary and quoted ones pass', () => {
  for (const c of [
    'cat .env',
    'cd app && cat .env.production',
    'grep JWT .env',
    'Get-Content .env',
    'printenv',
    'env | grep TOKEN',
    'psql "$DATABASE_URL" -c "select 1"',
    'x=1; psql "${PGURL%%\\?*}"',
    `psql postgres://app:${FAKE.dbPass}@10.0.0.5/app`,
    'echo $JWT_SECRET',
    'docker exec api printenv',
  ]) assert.ok(decideSecretCommand(c), c);
  for (const c of [
    'cat .env.example',
    'cat README.md',
    'env FOO=1 node app.js',
    'printenv PATH',
    'git commit -m "docs: explain why cat .env is forbidden"',
    'git commit -m "fix: stop running psql $DATABASE_URL in scripts"',
    'psql -h db -U app -c "select 1"',
    'test -n "$JWT_SECRET" && echo set',
    'redis-cli -h cache ping',
    'npm test',
  ]) assert.equal(decideSecretCommand(c), null, c);
});

test('hook blocks reading real env files and writing secrets, only in repos using the harness', () => {
  const dir = repo('af-sec-hook-');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'af-sec-none-'));
  const hook = (payload) => sh(dir, process.execPath, [CLI, 'hook', 'pretool'], JSON.stringify(payload));
  try {
    flow(dir, 'init');
    assert.equal(hook({ tool_name: 'Read', cwd: dir, tool_input: { file_path: path.join(dir, '.env') } }).status, 2);
    assert.equal(hook({ tool_name: 'Read', cwd: dir, tool_input: { file_path: path.join(dir, '.env.example') } }).status, 0);
    assert.equal(hook({ tool_name: 'Read', cwd: dir, tool_input: { file_path: path.join(dir, 'README.md') } }).status, 0);
    const w = hook({ tool_name: 'Write', cwd: dir, tool_input: { file_path: path.join(dir, 'a.ts'), content: `const k = "${FAKE.github}";\n` } });
    assert.equal(w.status, 2);
    assert.ok(!w.stderr.includes(FAKE.github));
    assert.equal(hook({ tool_name: 'Edit', cwd: dir, tool_input: { file_path: path.join(dir, 'README.md'), old_string: '# app', new_string: '# app\nrun with process.env.API_KEY' } }).status, 0);
    assert.equal(hook({ tool_name: 'PowerShell', cwd: dir, tool_input: { command: 'Get-Content .env' } }).status, 2);
    assert.equal(hook({ tool_name: 'Bash', cwd: outside, tool_input: { command: 'cat .env' } }).status, 0, 'no .flow: hook stays out');
    assert.equal(hook({ tool_name: 'Read', cwd: outside, tool_input: { file_path: path.join(outside, '.env') } }).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('commit messages and PR descriptions refuse secrets and personal data', () => {
  const dir = repo('af-sec-msg-');
  try {
    flow(dir, 'init', '--commit-body', 'free');
    const c = flow(dir, 'commitmsg', '--message', `fix: rotate key ${FAKE.aws}`);
    assert.notEqual(c.status, 0);
    assert.ok(!c.stdout.includes(FAKE.aws));
    const p = flow(dir, 'prmsg', '--message', `Summary: called the customer at 09${'12478365'} to confirm the refund.`);
    assert.notEqual(p.status, 0);
    assert.match(p.stdout, /thông tin cá nhân/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a scan that read nothing is reported as broken, never as clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-sec-empty-'));
  try {
    sh(dir, 'git', ['init', '-q', '-b', 'main']);
    const r = flow(dir, 'secrets', 'scan', '--path', '.', '--no-gitleaks');
    assert.equal(r.status, 3, r.stdout);
    assert.match(r.stdout, /phép đo hỏng/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the skill pack itself holds no secret or personal data', () => {
  const r = flow(PACK, 'secrets', 'scan', '--path', '.', '--no-gitleaks');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, / 0 secret · 0 PII/, r.stdout);
});
