import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { exists, git, matchAny, readText, toPosix } from './util.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const PLACEHOLDER_WORD = /(change[-_]?me|changeit|your[-_ ]|example|placeholder|dummy|sample|redacted|xxxx|\*\*\*|<[^>]*>|\{\{|\$\{|\$[A-Za-z_(]|%[A-Za-z_]+%|process\.env|os\.environ|getenv|configuration\[|secrets\.|vault:)/i;
const PLACEHOLDER_EXACT = /^(password|passwd|pass|pwd|secret|token|key|apikey|api_key|admin|root|user|username|test|tests|testing|guest|null|none|true|false|undefined|string|required|optional|bearer|local|localhost|dev|development|staging|production|default|empty|foo|bar|baz|abc|abc123|123456|12345678|1234|strong|strongpassword|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|rabbitmq|guest|sa|qwerty|letmein)$/i;

export function entropy(s) {
  const counts = {};
  for (const c of s) counts[c] = (counts[c] || 0) + 1;
  return -Object.values(counts).reduce((sum, n) => {
    const p = n / s.length;
    return sum + p * Math.log2(p);
  }, 0);
}

export function isPlaceholder(value) {
  const v = String(value).trim();
  if (!v) return true;
  if (PLACEHOLDER_EXACT.test(v) || PLACEHOLDER_WORD.test(v)) return true;
  if (/^(.)\1+$/.test(v)) return true;
  return false;
}

const WORDY = /^[A-Za-z]+(?:[-_. ][A-Za-z0-9]+)*$/;
const DEV_HINT = /(local|dev|development|test|design|sample|fake|dummy|only|insecure|not[-_]?secret|demo|fixture|mock)/i;
const TESTISH_FILE = /(^|\/)(tests?|__tests__|e2e|fixtures?|testdata|mocks?)\/|\.(test|spec)\.[^/]+$|Tests?\.(cs|java|kt)$|_test\.go$|\.(example|sample|template)$/i;

export function looksFake(value, file = '') {
  const f = toPosix(file);
  if (WORDY.test(value) && (TESTISH_FILE.test(f) || DEV_HINT.test(value))) return true;
  if (TESTISH_FILE.test(f) && (value.length <= 10 || /(test|fake|mock|dummy|sample|secret|example)/i.test(value))) return true;
  return false;
}

export function notAValue(value, file = '') {
  if (/^[A-Z]+(?:_[A-Z0-9]+)+$/.test(value)) return true;
  if (/^\.{0,2}\//.test(value)) return true;
  if (/[[\](){}^$|\\]/.test(value)) return true;
  if (/^[A-Z][a-z]+(?:[A-Z][a-z0-9]*)*$/.test(value) || /^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(value)) return true;
  if (/^[A-Za-z]{1,15}$/.test(value)) return true;
  if (/^[a-z]+(?:[-_][a-z0-9]+)+$/.test(value) && !/(^|\/)\.env|\.(ya?ml|toml|ini|cfg|conf|properties|tfvars)$/i.test(toPosix(file))) return true;
  return false;
}

const CONFIG_FILE =/(^|\/)(\.env[^/]*|[^/]*\.(ya?ml|toml|ini|cfg|conf|properties|json|env|tfvars|sh|bash|ps1|md|txt|sql|xml|config))$/i;
const SECRET_NAME = /(PASSWORD|PASSWD|PWD|SECRET|TOKEN|API[_-]?KEY|APIKEY|PRIVATE[_-]?KEY|SIGNING[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|CREDENTIAL|WEBHOOK[_-]?SECRET|DSN)/i;
const NOT_SECRET_NAME = /(ISSUER|AUDIENCE|EXPIR|TTL|LIFETIME|MINUTES|SECONDS|DAYS|LENGTH|_URL$|_URI$|_HOST$|_PORT$|_NAME$|_ID$|_ENV$|_MODE$|_TYPE$|_LEVEL$|_FORMAT$|_STRATEGY$|_HEADER$|_FIELD$|_PATH$|_FILE$|_ALGORITHM$|_COUNT$|_LIMIT$)/i;

const SHAPES = [
  { id: 'private-key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { id: 'gitlab-token', re: /\bgl(?:pat|dt|rt)-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { id: 'stripe-live-key', re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'sendgrid-key', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  { id: 'telegram-bot-token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{32,}\b/g },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
];

export const DB_URI_WITH_PASSWORD = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^\s:/@"'`]*:([^\s/"'`]+)@[^\s/"'`]+/gi;
const CONN_STRING_PASSWORD = /\b(?:password|pwd)\s*=\s*([^;"'`\s]{4,})/gi;
const ASSIGNMENT = /(?:^|[\s{,(["'`-])["'`]?([A-Za-z_][\w.-]*)["'`]?\s*(?::|=|:=|=>)\s*(["'`]?)([^\s"'`,;)]{6,})\2/g;

function pushFinding(out, l, rule, value, level = 'secret') {
  out.push({ rule, level, file: l.file, line: l.line, commit: l.commit || '', value });
}

export function scanSecretsInLine(l) {
  const out = [];
  const text = l.text;
  if (!text || text.length > 20000) return out;
  for (const r of SHAPES) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      if (r.id === 'private-key' && TESTISH_FILE.test(toPosix(l.file || '')) && !/[A-Za-z0-9+/]{64}/.test(text.slice(m.index + m[0].length))) continue;
      pushFinding(out, l, r.id, m[0]);
    }
  }
  for (const m of text.includes('://') ? text.matchAll(DB_URI_WITH_PASSWORD) : []) if (m[2].length >= 4 && !isPlaceholder(m[2]) && !looksFake(m[2], l.file) && !/[[\](){}^$|\\]/.test(m[2])) pushFinding(out, l, 'db-uri-with-password', m[2]);
  const mayHoldField = text.length <= 4000 && SECRET_NAME.test(text);
  for (const m of mayHoldField ? text.matchAll(CONN_STRING_PASSWORD) : []) if (!isPlaceholder(m[1]) && !looksFake(m[1], l.file) && /server\s*=|data source\s*=|user id\s*=|\buid\s*=|\bhost\s*=|database\s*=|initial catalog\s*=|PGPASSWORD/i.test(text)) pushFinding(out, l, 'connection-string-password', m[1]);
  const isConfig = CONFIG_FILE.test(l.file || '');
  for (const m of mayHoldField ? text.matchAll(ASSIGNMENT) : []) {
    const name = m[1];
    const quoted = m[2];
    const value = m[3];
    if (!SECRET_NAME.test(name) || NOT_SECRET_NAME.test(name)) continue;
    if (!isConfig && !quoted) continue;
    if (isPlaceholder(value) || looksFake(value, l.file) || notAValue(value, l.file)) continue;
    if (/[()]/.test(value) || /^[a-z]+[A-Z][A-Za-z]*$/.test(value) || /^\w+\.\w+/.test(value)) continue;
    if (value.length < 8 && !/\d/.test(value)) continue;
    if (entropy(value) < 2.5) continue;
    pushFinding(out, l, 'secret-field', value);
  }
  return out;
}

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_DOMAIN_OK = /@([a-z0-9.-]*\.(local|test|invalid|internal|localhost|example)|example\.[a-z.]+|anthropic\.com|openai\.com|github\.com|users\.noreply\.github\.com|sentry\.io|localhost|domain\.[a-z]+|email\.[a-z]+|company\.[a-z]+|acme\.[a-z]+|test\.[a-z]+|gmail\.example)$/i;
const ROLE_MAILBOX = 'no-?reply|do-?not-?reply|support|help|info|contact|admin(?:istrator)?|sales|hello';
const SAMPLE_MAILBOX = '(?:test|user|student|teacher|member)s?\\d*|example|sample|demo|dev|foo|bar|baz|abc|xxx|placeholder|someone|name|username|your|e?mail';
const EMAIL_USER_OK = new RegExp(`^(?:${ROLE_MAILBOX}|${SAMPLE_MAILBOX})$`, 'i');
const PHONE = /(?<![\d.-])(?:\+?84|0)(?:3|5|7|8|9)\d{8}(?![\d.-])/g;
const PHONE_FAKE = /^(?:\+?84|0)(\d)\1{8}$|^(?:\+?84|0)\d(\d)\2{7}$|^0(?:123456789|987654321)$|^0\d{2}0{5,}\d{0,2}$|^0\d{1,2}(?:1234567|7654321|0000000)\d?$/;
const VN_ID = /\b(?:cccd|cmnd|căn cước|citizen[_ -]?id|national[_ -]?id|id[_ -]?card)\b[^\d\n]{0,20}(\d{9}|\d{12})\b/gi;
const BANK = /\b(?:stk|số tài khoản|so tai khoan|bank[_ -]?account(?:[_ -]?(?:no|number))?|account[_ -]?(?:no|number)|acct[_ -]?no|vietqr)\b[^\d\n]{0,24}(\d{6,19})\b/gi;
const VIETQR_URL = /img\.vietqr\.io\/image\/[A-Za-z0-9]+-(\d{6,19})/gi;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

function luhn(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const PII_FILE_OK = /(^|\/)(CODEOWNERS|LICENSE[^/]*|AUTHORS[^/]*|CONTRIBUTORS[^/]*|CHANGELOG[^/]*|NOTICE[^/]*|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

export function scanPiiInLine(l, { knownEmails = new Set() } = {}) {
  const out = [];
  const text = l.text;
  if (!text || text.length > 4000 || PII_FILE_OK.test(l.file || '')) return out;
  for (const m of text.includes('@') ? text.matchAll(EMAIL) : []) {
    const email = m[0];
    const low = email.toLowerCase();
    if (knownEmails.has(low) || EMAIL_DOMAIN_OK.test(low) || EMAIL_USER_OK.test(low.split('@')[0])) continue;
    if (/\.(png|jpg|jpeg|svg|gif|webp|js|ts|css)$/i.test(low)) continue;
    pushFinding(out, l, 'email', email, 'pii');
  }
  for (const m of text.matchAll(PHONE)) if (!PHONE_FAKE.test(m[0])) pushFinding(out, l, 'phone-vn', m[0], 'pii');
  for (const m of text.matchAll(VN_ID)) pushFinding(out, l, 'national-id', m[1], 'pii');
  for (const m of text.matchAll(BANK)) pushFinding(out, l, 'bank-account', m[1], 'pii');
  for (const m of text.matchAll(VIETQR_URL)) pushFinding(out, l, 'bank-account', m[1], 'pii');
  for (const m of (text.match(/\d/g) || []).length >= 13 ? text.matchAll(CARD) : []) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits) && !/^(\d)\1+$/.test(digits) && /[ -]|card|thẻ|visa|master/i.test(`${m[0]} ${text}`)) pushFinding(out, l, 'card-number', digits, 'pii');
  }
  return [...new Map(out.map((f) => [`${f.rule}|${f.value}`, f])).values()];
}

export function mask(value) {
  return `***(${String(value).length})`;
}

export function fingerprintOf(rule, file, value) {
  return sha(`${rule}|${file}|${value}`).slice(0, 16);
}

export function publicFinding(f) {
  const { value, ...rest } = f;
  return { ...rest, masked: mask(value), fingerprint: fingerprintOf(f.rule, f.file, value), valueId: sha(value).slice(0, 10) };
}

const SENSITIVE_FILES = [
  { re: /(^|\/)\.env(\.[^/]+)?$/i, not: /\.(example|sample|template|dist|defaults?|tpl|schema)$/i, why: 'tệp môi trường' },
  { re: /\.(pem|key|p12|pfx|jks|keystore|ppk|asc)$/i, not: /(public|\.pub\.)/i, why: 'khoá / chứng chỉ' },
  { re: /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/, why: 'khoá SSH' },
  { re: /(^|\/)(credentials|service[-_]?account[^/]*|firebase[-_]?adminsdk[^/]*|gcp[-_]key[^/]*)\.json$/i, why: 'tệp credential' },
  { re: /(^|\/)(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd)$/i, why: 'tệp có thể chứa token' },
  { re: /(^|\/)(secrets?|vault)\.(ya?ml|json|toml)$/i, not: /\.(example|sample)\./i, why: 'tệp bí mật' },
  { re: /\.(dump|bak|sqlite3?|mdf|ldf)$/i, why: 'dữ liệu / bản sao lưu' },
];

export function sensitiveFile(file) {
  const f = toPosix(file);
  for (const s of SENSITIVE_FILES) if (s.re.test(f) && !(s.not && s.not.test(f))) return s.why;
  return null;
}

const SKIP_CONTENT = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/bin/**', '**/obj/**', '**/vendor/**', '**/.git/**', '**/*.lock', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/go.sum', '**/*.min.js', '**/*.map', '**/*.{png,jpg,jpeg,gif,webp,ico,pdf,docx,xlsx,pptx,zip,gz,tgz,7z,rar,exe,dll,so,dylib,woff,woff2,ttf,eot,mp4,mp3,mov,wasm,traineddata,bin}'];

export function scannableFile(file) {
  return !matchAny(SKIP_CONTENT, toPosix(file));
}

export function* treeLines(repoDir, files) {
  for (const f of files) {
    if (!scannableFile(f)) continue;
    const abs = path.join(repoDir, f);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    const text = readText(abs);
    if (text === null || text.includes('\u0000')) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) yield { file: toPosix(f), line: i + 1, text: lines[i] };
  }
}

export function historyLines(repoDir, onLine, { maxCount = 0 } = {}) {
  return new Promise((resolve) => {
    const args = ['log', '--all', '-p', '-U0', '--no-merges', '--no-color', '--no-ext-diff', '--format=%x01%H', '--diff-filter=AM'];
    if (maxCount) args.push(`-n${maxCount}`);
    const child = spawn('git', args, { cwd: repoDir, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let commit = '';
    let file = null;
    let line = 0;
    let commits = 0;
    rl.on('line', (raw) => {
      if (raw.startsWith('\u0001')) {
        commit = raw.slice(1, 10);
        commits++;
        return;
      }
      if (raw.startsWith('+++ ')) {
        const p = raw.slice(4).trim();
        file = p === '/dev/null' ? null : p.replace(/^b\//, '').replace(/^"b\//, '').replace(/"$/, '');
        return;
      }
      if (raw.startsWith('--- ')) return;
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (h) {
        line = Number(h[1]);
        return;
      }
      if (file && raw.startsWith('+')) {
        if (scannableFile(file)) onLine({ file, line, text: raw.slice(1), commit });
        line++;
      }
    });
    child.on('close', () => resolve({ commits }));
    child.on('error', () => resolve({ commits, failed: true }));
  });
}

const ENV_NAME = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;
const HARMLESS_VALUE = /^(true|false|null|undefined|none|disabled|enabled|localhost|\d+|development|production|staging|test|debug|info|warn|error)$/i;
const PRINTABLE_ENV = /^(NODE_ENV|ASPNETCORE_ENVIRONMENT|ENV|PORT|[A-Z0-9_]*_PORT|LOG_LEVEL|TZ|LANG|[A-Z0-9_]*_ENABLED|[A-Z0-9_]*_MODE|[A-Z0-9_]*_TIMEOUT[A-Z0-9_]*|VITE_APP_NAME|APP_NAME)$/i;

export function parseEnvText(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue;
    const m = ENV_NAME.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out.push({ key: m[1], value: v });
  }
  return out;
}

function strongEnoughToSearch(value) {
  if (value.length < 8 || HARMLESS_VALUE.test(value) || isPlaceholder(value)) return false;
  if (/^[a-z]+$/.test(value) || /^[A-Z]+$/.test(value) || /^\d+$/.test(value)) return false;
  return entropy(value) >= 2.5;
}

export function envSecretValues(text) {
  const values = new Map();
  for (const { key, value } of parseEnvText(text)) {
    const uriPass = /^[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:([^\s/]+)@/i.exec(value);
    if (uriPass && strongEnoughToSearch(uriPass[1])) values.set(uriPass[1], key);
    if (!SECRET_NAME.test(key) || NOT_SECRET_NAME.test(key)) continue;
    if (strongEnoughToSearch(value)) values.set(value, key);
  }
  return values;
}

export function safeEnvView(text) {
  return parseEnvText(text).map(({ key, value }) => {
    if (!value) return `${key}=<rỗng>`;
    if (PRINTABLE_ENV.test(key) && !SECRET_NAME.test(key)) return `${key}=${value}`;
    const uri = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
    if (uri) {
      const rest = value.slice(uri[0].length);
      const at = rest.lastIndexOf('@');
      const host = (at >= 0 ? rest.slice(at + 1) : rest).split(/[/?]/)[0];
      return `${key}=${uri[1]}://${at >= 0 ? '***@' : ''}${host}`;
    }
    return `${key}=<${value.length} ký tự>`;
  });
}

export function localEnvFiles(repoDir) {
  const ignored = git(repoDir, ['ls-files', '--others', '--ignored', '--exclude-standard']).out.split('\n');
  const untracked = git(repoDir, ['ls-files', '--others', '--exclude-standard']).out.split('\n');
  return [...new Set([...ignored, ...untracked])]
    .filter(Boolean)
    .filter((f) => !/(^|\/)(node_modules|dist|build|bin|obj|vendor)\//.test(f))
    .filter((f) => /(^|\/)\.env(\.[^/]+)?$/i.test(f) && !/\.(example|sample|template|dist|defaults?|tpl|schema)$/i.test(f));
}

const NGRAM_SPLIT = /[\s"'`,;:=()[\]{}<>|\\/]+/;

function ngrams(text, max = 4) {
  const toks = String(text).normalize('NFC').toLowerCase().split(NGRAM_SPLIT).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    let cur = '';
    for (let n = 0; n < max && i + n < toks.length; n++) {
      cur = n ? `${cur} ${toks[i + n]}` : toks[i];
      out.push(cur);
    }
  }
  return out;
}

export function watchHash(salt, value) {
  return sha(`${salt}|${String(value).normalize('NFC').toLowerCase().trim().split(NGRAM_SPLIT).filter(Boolean).join(' ')}`).slice(0, 32);
}

export function loadWatch(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { salt: crypto.randomBytes(16).toString('hex'), entries: [] };
  }
}

export function scanWatchInLine(l, watch) {
  if (!watch?.entries?.length || !l.text) return [];
  const index = new Map(watch.entries.map((e) => [e.hash, e.label]));
  const out = [];
  for (const g of ngrams(l.text)) {
    const h = watchHash(watch.salt, g);
    if (index.has(h)) out.push({ rule: `watch:${index.get(h)}`, level: 'secret', file: l.file, line: l.line, commit: l.commit || '', value: g });
  }
  return out;
}

export function scanEnvValuesInLine(l, values) {
  const out = [];
  if (!values?.size || !l.text) return out;
  for (const [value, key] of values) {
    let at = l.text.indexOf(value);
    while (at >= 0) {
      const before = l.text[at - 1] || '';
      const after = l.text[at + value.length] || '';
      if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) {
        out.push({ rule: `env-value:${key}`, level: 'secret', file: l.file, line: l.line, commit: l.commit || '', value });
        break;
      }
      at = l.text.indexOf(value, at + 1);
    }
  }
  return out;
}

export function scannerSelfCheck() {
  const fakeAws = `AKIA${'ABCDEFGHIJKLMNOP'}`;
  const fakeUri = `postgres://app:${'s3cr3t@Pa55w0rd'}@db.internal:5432/app`;
  const a = scanSecretsInLine({ file: 'probe.txt', line: 1, text: `key ${fakeAws}` });
  const b = scanSecretsInLine({ file: 'probe.txt', line: 1, text: fakeUri });
  const c = scanSecretsInLine({ file: 'probe.env', line: 1, text: `DB_PASSWORD=${'Xy7'}Qz9vLm2` });
  const d = scanPiiInLine({ file: 'probe.txt', line: 1, text: `gọi 09${'12478365'}` });
  return a.length > 0 && b.length > 0 && c.length > 0 && d.length > 0;
}

export function gitleaksAvailable() {
  return spawnSync('gitleaks', ['version'], { encoding: 'utf8', windowsHide: true }).status === 0;
}

export function runGitleaks(repoDir, { mode = 'history' } = {}) {
  const report = path.join(os.tmpdir(), `agent-flow-gitleaks-${process.pid}-${Date.now()}.json`);
  const args = mode === 'tree' ? ['dir', repoDir] : ['git', repoDir];
  if (mode === 'staged') args.push('--staged');
  args.push('--no-banner', '--redact', '--exit-code', '0', '--report-format', 'json', '--report-path', report);
  const r = spawnSync('gitleaks', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  let items = [];
  try {
    items = JSON.parse(fs.readFileSync(report, 'utf8'));
  } catch {
    return { ok: false, findings: [], error: (r.stderr || '').slice(0, 200) };
  } finally {
    if (exists(report)) fs.rmSync(report);
  }
  const findings = items.map((i) => ({
    rule: `gitleaks:${i.RuleID}`,
    level: 'secret',
    file: toPosix(mode === 'tree' ? path.relative(repoDir, i.File) : i.File),
    line: i.StartLine,
    commit: (i.Commit || '').slice(0, 9),
    masked: 'REDACTED',
    fingerprint: sha(`gitleaks|${i.RuleID}|${toPosix(mode === 'tree' ? path.relative(repoDir, i.File) : i.File)}`).slice(0, 16),
  }));
  const unique = [...new Map(findings.map((f) => [f.fingerprint, f])).values()];
  return { ok: true, findings: unique };
}

const READ_ENV = /(?:^|[;&|(]\s*|\n\s*)(?:sudo\s+)?(?:cat|type|less|more|head|tail|bat|nl|strings|xxd|od|gc|get-content|grep|rg|findstr|select-string|awk|sed|cut|sort|source\s+\S+\s*&&\s*env)\b[^\n;&|]*?(?:^|[\s"'/\\])\.env(?:\.(?!example|sample|template|dist|defaults?|tpl|schema)[\w.-]+)?(?=[\s"']|$)/i;
const PRINT_ENV = /(?:^|[;&|(]\s*|\n\s*)(?:printenv|env|export -p|declare -x|get-childitem\s+env:|gci\s+env:|dir\s+env:)(?=\s*(?:$|[;&|)\n]))/i;
const DOCKER_ENV = /\bdocker(?:\s+compose)?\s+(?:exec\s+[^\n;&|]*\s(?:env|printenv)\b|inspect\b[^\n;&|]*\.Config\.Env|compose\s+config\b)/i;
const ECHO_SECRET = /(?:^|[;&|(]\s*|\n\s*)(?:echo|printf|write-host|write-output)\b[^\n;&|]*\$(?:env:)?\{?[A-Za-z_]*(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|DATABASE_URL|DB_URL|REDIS_URL|DSN)/i;
const CLIENT_WITH_URI_VAR = /(?:^|[;&|(]\s*|\n\s*)(?:psql|pg_dump|pg_restore|mysql|mysqldump|mongosh|mongo|redis-cli|sqlcmd)\b[^\n;&|]*\$\{?[A-Za-z_]*(?:URL|URI|DSN|CONN|PASSWORD|PWD)/i;

export function decideSecretCommand(command) {
  const c = String(command);
  DB_URI_WITH_PASSWORD.lastIndex = 0;
  for (const m of c.matchAll(DB_URI_WITH_PASSWORD)) if (!isPlaceholder(m[2])) return 'Lệnh mang URI kết nối có mật khẩu — mật khẩu sẽ nằm trong lịch sử phiên. Tách credential ra biến riêng (PGHOST, PGUSER, PGPASSWORD…) nạp từ tệp, không in ra.';
  if (CLIENT_WITH_URI_VAR.test(c)) return 'Client CSDL nhận URI qua biến — khi lỗi, nó in lại URI gồm cả mật khẩu trong câu báo lỗi (đã rò thật hai lần). Tách host / user / mật khẩu ra biến riêng.';
  if (READ_ENV.test(c)) return 'Không đọc tệp .env thật qua shell — giá trị sẽ vào lịch sử phiên. Xem an toàn: flowctl secrets env <tệp> (tên khoá, độ dài, host).';
  if (PRINT_ENV.test(c)) return 'Không in toàn bộ biến môi trường — giá trị sẽ vào lịch sử phiên. Kiểm một biến có đặt chưa: test -n "$TEN" && echo set.';
  if (DOCKER_ENV.test(c)) return 'Không in biến môi trường của container — giá trị sẽ vào lịch sử phiên. Kiểm tên biến thay vì giá trị.';
  if (ECHO_SECRET.test(c)) return 'Không in giá trị bí mật ra terminal. Kiểm có đặt chưa: test -n "$TEN" && echo set.';
  return null;
}

export function isRealEnvFile(file) {
  const base = toPosix(String(file)).split('/').pop();
  return /^\.env(\.[^/]+)?$/i.test(base) && !/\.(example|sample|template|dist|defaults?|tpl|schema)$/i.test(base);
}

export function isKeyFile(file) {
  return /\.(pem|key|p12|pfx|jks|keystore|ppk)$|(^|[\\/])(id_rsa|id_ed25519|id_ecdsa)$/i.test(String(file));
}
