#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBanner } from './lib/banner.mjs';

const HOME_DIR = path.dirname(fileURLToPath(import.meta.url));
const USER = os.homedir();
const args = new Set(process.argv.slice(2));
const UNINSTALL = args.has('--uninstall');
const NO_BRIDGE = args.has('--no-bridge');
const DRY = args.has('--dry');
const HOOKS = args.has('--hooks');

const HOOK_TARGETS = [
  { label: 'Claude Code', file: path.join(USER, '.claude', 'settings.json'), session: 'startup|clear|compact', pretool: 'Bash|PowerShell|Read|Edit|Write|MultiEdit' },
  { label: 'Codex', file: path.join(USER, '.codex', 'hooks.json'), session: '', pretool: '' },
];

const MARK = 'agent-flow command';

function skillDescription(src) {
  const text = fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8');
  const m = /^description:\s*(.*)$/m.exec(text);
  return (m ? m[1] : '').replace(/^["']|["']$/g, '').slice(0, 180);
}

function commandTargets(s) {
  const short = s.name === 'flow' ? 'start' : s.name.replace(/^flow-/, '');
  const desc = `${skillDescription(s.src).replace(/"/g, "'")} (${MARK})`;
  const ask = `Dùng skill \`${s.name}\` của FLOW (nếu chưa nạp: đọc ${path.join(s.src, 'SKILL.md').replace(/\\/g, '/')}) và làm đúng theo nó.`;
  return [
    {
      label: 'Gemini',
      root: path.join(USER, '.gemini'),
      file: path.join(USER, '.gemini', 'commands', 'flow', `${short}.toml`),
      body: `description = "${desc}"\nprompt = """\n${ask}\nYêu cầu của người dùng: {{args}}\n"""\n`,
    },
    {
      label: 'Codex',
      root: path.join(USER, '.codex'),
      file: path.join(USER, '.codex', 'prompts', `${s.name}.md`),
      body: `---\ndescription: "${desc}"\nargument-hint: "[yêu cầu]"\n---\n\n${ask}\n\nYêu cầu của người dùng: $ARGUMENTS\n`,
    },
  ];
}

function commands() {
  for (const s of skills()) {
    for (const t of commandTargets(s)) {
      if (!fs.existsSync(t.root)) continue;
      const cur = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : null;
      if (UNINSTALL) {
        if (cur !== null && cur.includes(MARK)) {
          if (!DRY) fs.rmSync(t.file);
          log(`  − ${t.label}: ${t.file}`);
        }
        continue;
      }
      if (cur !== null && !cur.includes(MARK)) {
        log(`  ! ${t.label}: ${t.file} đã tồn tại và không phải của FLOW — BỎ QUA`);
        continue;
      }
      if (cur === t.body) continue;
      if (!DRY) {
        fs.mkdirSync(path.dirname(t.file), { recursive: true });
        fs.writeFileSync(t.file, t.body);
      }
      log(`  + ${t.label}: ${t.file}`);
    }
  }
}

function hookCommand(sub) {
  return `node "${path.join(HOME_DIR, 'bin', 'flow.mjs').replace(/\\/g, '/')}" hook ${sub}`;
}

function isOurHook(h) {
  return typeof h?.command === 'string' && /flow(?:ctl)?\.mjs" hook (session|pretool)/.test(h.command);
}

function hooks() {
  for (const t of HOOK_TARGETS) {
    if (!fs.existsSync(path.dirname(t.file))) {
      log(`  · ${t.label}: không có ${path.dirname(t.file)} — bỏ qua`);
      continue;
    }
    const raw = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : '{}';
    let json;
    try {
      json = JSON.parse(raw || '{}');
    } catch {
      log(`  ! ${t.label}: ${t.file} không phải JSON hợp lệ — BỎ QUA, không ghi đè`);
      continue;
    }
    json.hooks = json.hooks || {};
    for (const ev of ['SessionStart', 'PreToolUse']) {
      const list = Array.isArray(json.hooks[ev]) ? json.hooks[ev] : [];
      const cleaned = list
        .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurHook(h)) }))
        .filter((g) => g.hooks.length);
      if (!UNINSTALL) {
        const matcher = ev === 'SessionStart' ? t.session : t.pretool;
        cleaned.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hookCommand(ev === 'SessionStart' ? 'session' : 'pretool'), timeout: 10 }] });
      }
      if (cleaned.length) json.hooks[ev] = cleaned;
      else delete json.hooks[ev];
    }
    const next = `${JSON.stringify(json, null, 2)}\n`;
    if (next === raw) {
      log(`  = ${t.label}: ${t.file}`);
      continue;
    }
    if (!DRY) {
      if (raw && raw !== '{}' && !fs.existsSync(`${t.file}.pre-agent-flow.bak`)) fs.writeFileSync(`${t.file}.pre-agent-flow.bak`, raw);
      fs.writeFileSync(t.file, next);
    }
    log(`  ${UNINSTALL ? '−' : '+'} ${t.label}: ${t.file}`);
  }
}

const SKILL_TARGETS = [
  { label: 'Claude Code', dir: path.join(USER, '.claude', 'skills') },
  { label: 'Codex + Gemini (~/.agents/skills)', dir: path.join(USER, '.agents', 'skills') },
];

const BRIDGE_FILES = [
  { label: 'Claude Code', file: path.join(USER, '.claude', 'CLAUDE.md') },
  { label: 'Codex', file: path.join(USER, '.codex', 'AGENTS.md') },
  { label: 'Gemini', file: path.join(USER, '.gemini', 'GEMINI.md') },
];

const BIN_DIR = path.join(USER, '.local', 'bin');
const VIA_PACKAGE_MANAGER = /[\\/]node_modules[\\/]/.test(HOME_DIR);
const BEGIN_PREFIX = '## agent-flow — quy trình toàn cục';
const BEGIN = `${BEGIN_PREFIX} (do flow install quản lý)`;
const END = '_(hết khối agent-flow)_';

const BRIDGE = `${BEGIN}

Bộ skill \`flow\`, \`flow-explore\`, \`flow-plan\`, \`flow-execute\`, \`flow-post\`, \`flow-context\`, \`flow-learn\`, \`flow-sync\`, \`flow-init\` nằm ở \`${HOME_DIR.replace(/\\/g, '/')}\`; công cụ \`flow\`.

- Thư mục làm việc (hoặc thư mục cha) có \`.flow/profile.json\` ⇒ trước khi sửa mã: nạp skill \`flow\`, chạy \`flow where\`, đọc \`.flow/PROJECT.md\`. Theo explore → plan → execute → post; người dùng sửa cách làm ⇒ \`flow-learn\` ngay.
- Không có \`.flow/\` ⇒ làm việc theo quy ước của repo; không tự khởi tạo — người dùng muốn join dự án thì dùng \`flow-init\` (đo quy ước bằng \`flow fingerprint\`, tự cấu hình theo đúng dự án).
- Quy ước mã / commit / PR / chú thích của một repo đọc từ \`.flow/profile.json\` (đã phân giải: chỉ dẫn & lệ của dự án > điều người dùng chốt > sở thích ở ~/.agent-flow/user.json) — KHÔNG mang từ repo khác sang.
- \`.flow/\` và \`CONTEXT.md\` module là local-only: không commit, không nhắc tên trong mã / commit / PR.
- Luật riêng của dự án (AGENTS.md / CLAUDE.md của repo) luôn thắng khi mâu thuẫn.

${END}
`;

const log = (...a) => console.log(...a);

function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function linkTarget(p) {
  try {
    return path.resolve(fs.readlinkSync(p));
  } catch {
    return null;
  }
}

function isCurrentLink(p, src) {
  const t = linkTarget(p);
  return !!t && t.toLowerCase() === path.resolve(src).toLowerCase();
}

function isStaleLink(p, name) {
  const t = linkTarget(p);
  if (!t || !name.startsWith('flow')) return false;
  return !fs.existsSync(t) || ['flow.mjs', 'flowctl.mjs'].some((entry) => fs.existsSync(path.join(t, '..', '..', 'bin', entry)));
}

function skills() {
  const dir = path.join(HOME_DIR, 'skills');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => ({ name: d.name, src: path.join(dir, d.name) }));
}

function linkSkills() {
  for (const t of SKILL_TARGETS) {
    if (!DRY) fs.mkdirSync(t.dir, { recursive: true });
    let unchanged = 0;
    let changed = 0;
    for (const s of skills()) {
      const dst = path.join(t.dir, s.name);
      const st = lstat(dst);
      const current = !!st && isCurrentLink(dst, s.src);
      const stale = !!st && !current && isStaleLink(dst, s.name);
      if (UNINSTALL) {
        if (current || stale) {
          if (!DRY) fs.rmSync(dst, { recursive: false, force: true });
          changed++;
        }
        continue;
      }
      if (current) {
        unchanged++;
        continue;
      }
      if (st && !stale) {
        log(`  ! ${t.label}: ${dst} đã tồn tại và không phải của FLOW — BỎ QUA (không ghi đè)`);
        continue;
      }
      if (stale && !DRY) fs.rmSync(dst, { recursive: false, force: true });
      if (!DRY) fs.symlinkSync(s.src, dst, 'junction');
      changed++;
    }
    if (UNINSTALL) log(`  − ${t.label}: gỡ ${changed} skill`);
    else log(`  ✓ ${t.label}: nối mới ${changed} · giữ nguyên ${unchanged} skill`);
  }
}

function removeRetiredShims() {
  for (const name of ['flowctl', 'flowctl.cmd']) {
    const file = path.join(BIN_DIR, name);
    if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes('flowctl.mjs')) continue;
    if (!DRY) fs.rmSync(file);
    log(`  − tên lệnh cũ ${file}`);
  }
}

function writeShims() {
  removeRetiredShims();
  const entry = path.join(HOME_DIR, 'bin', 'flow.mjs');
  const sh = path.join(BIN_DIR, 'flow');
  const cmd = path.join(BIN_DIR, 'flow.cmd');
  const shBody = `#!/bin/sh\nexec node "${entry.replace(/\\/g, '/')}" "$@"\n`;
  const cmdBody = `@node "${entry}" %*\r\n`;
  for (const [file, body] of [
    [sh, shBody],
    [cmd, cmdBody],
  ]) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (VIA_PACKAGE_MANAGER && !UNINSTALL) {
      if (cur !== null && cur.includes('flow.mjs')) {
        if (!DRY) fs.rmSync(file);
        log(`  − bản cũ ${file}`);
      }
      continue;
    }
    if (UNINSTALL) {
      if (cur !== null && cur.includes('flow.mjs')) {
        if (!DRY) fs.rmSync(file);
        log(`  − ${file}`);
      }
      continue;
    }
    if (cur !== null && !cur.includes('flow.mjs')) {
      log(`  ! ${file} đã tồn tại và không phải của FLOW — BỎ QUA`);
      continue;
    }
    if (cur === body) {
      log(`  = ${file}`);
      continue;
    }
    if (!DRY) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
      fs.writeFileSync(file, body);
      if (file === sh) fs.chmodSync(file, 0o755);
    }
    log(`  + ${file}`);
  }
  const onPath = (process.env.PATH || '').split(path.delimiter).some((p) => path.resolve(p).toLowerCase() === BIN_DIR.toLowerCase());
  if (!onPath && !UNINSTALL && !VIA_PACKAGE_MANAGER) log(`  ⚠️ ${BIN_DIR} chưa có trong PATH — thêm vào, hoặc gọi: node "${entry}"`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bridges() {
  const re = new RegExp(`\\n*${escapeRe(BEGIN_PREFIX)}[^\\n]*[\\s\\S]*?${escapeRe(END)}\\n?`);
  for (const b of BRIDGE_FILES) {
    if (!fs.existsSync(path.dirname(b.file))) {
      log(`  · ${b.label}: không có ${path.dirname(b.file)} — bỏ qua`);
      continue;
    }
    const cur = fs.existsSync(b.file) ? fs.readFileSync(b.file, 'utf8') : '';
    let next;
    if (UNINSTALL || NO_BRIDGE) {
      next = cur.replace(re, '\n');
      if (next.trim() === cur.trim()) continue;
      next = next.replace(/\n{3,}$/, '\n\n').replace(/\s+$/, '\n');
    } else if (re.test(cur)) {
      next = cur.replace(re, `\n\n${BRIDGE}`);
    } else {
      next = `${cur.replace(/\s+$/, '')}${cur.trim() ? '\n\n' : ''}${BRIDGE}`;
    }
    if (next === cur) {
      log(`  = ${b.label}: ${b.file}`);
      continue;
    }
    if (!DRY) {
      if (cur && !fs.existsSync(`${b.file}.pre-agent-flow.bak`)) fs.writeFileSync(`${b.file}.pre-agent-flow.bak`, cur);
      fs.writeFileSync(b.file, next);
    }
    log(`  ${UNINSTALL || NO_BRIDGE ? '−' : '+'} ${b.label}: ${b.file}`);
  }
}

const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(HOME_DIR, 'package.json'), 'utf8'));
const banner = UNINSTALL ? '' : renderBanner({ version: VERSION, isTTY: !!process.stdout.isTTY, columns: process.stdout.columns || 80, env: process.env });
if (banner) log(banner);
log(`${UNINSTALL ? 'Gỡ cài đặt' : 'Cài đặt'} từ ${HOME_DIR}${DRY ? ' (dry-run)' : ''}`);
log('Skill:');
linkSkills();
log('Lệnh flow:');
writeShims();
log('Lệnh slash (Gemini /flow:<x> · Codex /prompts:flow-<x>; Claude Code gọi thẳng /flow-<x>):');
commands();
log('Khối chỉ dẫn toàn cục:');
bridges();
if (HOOKS || UNINSTALL) {
  log('Hook (SessionStart nạp lại trạng thái · PreToolUse chặn ghi nhánh được bảo vệ):');
  hooks();
}
if (!UNINSTALL) {
  log('');
  log('Xong. Mở phiên CLI mới để thấy skill (Gemini: /skills reload). Kiểm: `flow help`.');
  if (!HOOKS) log('Hook chưa cài. Tự chạy: flow install --hooks (SessionStart nạp lại trạng thái sau nén · PreToolUse chặn ghi nhánh được bảo vệ, cho Claude Code + Codex).');
  if (VIA_PACKAGE_MANAGER) log('Trước khi gỡ gói: chạy flow uninstall, rồi npm uninstall -g flow-harness.');
}
