#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBanner } from './lib/banner.mjs';
import { pickLanguage } from './lib/lang.mjs';
import { CORE_SKILLS, runsFromNpxCache } from './lib/wizard.mjs';

const HOME_DIR = path.dirname(fileURLToPath(import.meta.url));
const USER = os.homedir();
const argv = process.argv.slice(2);
const args = new Set(argv);
const UNINSTALL = args.has('--uninstall');
const NO_BRIDGE = args.has('--no-bridge');
const DRY = args.has('--dry');
const HOOKS = args.has('--hooks');
const KNOWN_AGENTS = ['claude', 'codex', 'gemini'];

function listFlag(name) {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3).split(',').filter(Boolean);
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = argv[at + 1];
  return value && !value.startsWith('--') ? value.split(',').filter(Boolean) : [];
}

const CHOSEN_AGENTS = listFlag('agents');
const CHOSEN_SKILLS = listFlag('skills');

function agentOn(name) {
  return UNINSTALL || !CHOSEN_AGENTS || CHOSEN_AGENTS.includes(name);
}

function anyAgentOn(names) {
  return names.some(agentOn);
}

function resolvedSkills() {
  if (!CHOSEN_SKILLS) return null;
  const expanded = CHOSEN_SKILLS.flatMap((name) => (name === 'core' ? CORE_SKILLS : [name]));
  return new Set(['flow', ...expanded]);
}

const HOOK_TARGETS = [
  { agent: 'claude', label: 'Claude Code', file: path.join(USER, '.claude', 'settings.json'), session: 'startup|clear|compact', pretool: 'Bash|PowerShell|Read|Edit|Write|MultiEdit' },
  { agent: 'codex', label: 'Codex', file: path.join(USER, '.codex', 'hooks.json'), session: '', pretool: '' },
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
      agent: 'gemini',
      label: 'Gemini',
      root: path.join(USER, '.gemini'),
      file: path.join(USER, '.gemini', 'commands', 'flow', `${short}.toml`),
      body: `description = "${desc}"\nprompt = """\n${ask}\nYêu cầu của người dùng: {{args}}\n"""\n`,
    },
    {
      agent: 'codex',
      label: 'Codex',
      root: path.join(USER, '.codex'),
      file: path.join(USER, '.codex', 'prompts', `${s.name}.md`),
      body: `---\ndescription: "${desc}"\nargument-hint: "[yêu cầu]"\n---\n\n${ask}\n\nYêu cầu của người dùng: $ARGUMENTS\n`,
    },
  ];
}

function commands() {
  const wanted = resolvedSkills();
  for (const s of skills()) {
    const removing = UNINSTALL || (wanted && !wanted.has(s.name));
    for (const t of commandTargets(s)) {
      if (!fs.existsSync(t.root) || !agentOn(t.agent)) continue;
      const cur = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : null;
      if (removing) {
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
    if (!agentOn(t.agent)) continue;
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
  { agents: ['claude'], label: 'Claude Code', dir: path.join(USER, '.claude', 'skills') },
  { agents: ['codex', 'gemini'], label: 'Codex + Gemini (~/.agents/skills)', dir: path.join(USER, '.agents', 'skills') },
];

const BRIDGE_FILES = [
  { agent: 'claude', label: 'Claude Code', file: path.join(USER, '.claude', 'CLAUDE.md') },
  { agent: 'codex', label: 'Codex', file: path.join(USER, '.codex', 'AGENTS.md') },
  { agent: 'gemini', label: 'Gemini', file: path.join(USER, '.gemini', 'GEMINI.md') },
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
  const wanted = resolvedSkills();
  for (const t of SKILL_TARGETS) {
    if (!anyAgentOn(t.agents)) continue;
    if (!DRY && !UNINSTALL) fs.mkdirSync(t.dir, { recursive: true });
    let unchanged = 0;
    let changed = 0;
    let removed = 0;
    for (const s of skills()) {
      const dst = path.join(t.dir, s.name);
      const st = lstat(dst);
      const current = !!st && isCurrentLink(dst, s.src);
      const stale = !!st && !current && isStaleLink(dst, s.name);
      if (UNINSTALL || (wanted && !wanted.has(s.name))) {
        if (current || stale) {
          if (!DRY) fs.rmSync(dst, { recursive: false, force: true });
          removed++;
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
    if (UNINSTALL) log(`  − ${t.label}: gỡ ${removed} skill`);
    else log(`  ✓ ${t.label}: nối mới ${changed} · giữ nguyên ${unchanged} · gỡ ${removed} skill`);
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
    if (!agentOn(b.agent)) continue;
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

function rejectBadInput() {
  const badAgents = (CHOSEN_AGENTS || []).filter((name) => !KNOWN_AGENTS.includes(name));
  const known = new Set(skills().map((s) => s.name));
  const badSkills = (CHOSEN_SKILLS || []).filter((name) => name !== 'core' && !known.has(name));
  const problems = [];
  if (CHOSEN_AGENTS && !CHOSEN_AGENTS.length) problems.push(`--agents cần ít nhất một trong: ${KNOWN_AGENTS.join(', ')}.`);
  if (badAgents.length) problems.push(`Agent lạ: ${badAgents.join(', ')}. Dùng: ${KNOWN_AGENTS.join(', ')}.`);
  if (CHOSEN_SKILLS && !CHOSEN_SKILLS.length) problems.push('--skills cần ít nhất một tên, hoặc core.');
  if (badSkills.length) problems.push(`Skill lạ: ${badSkills.join(', ')}.`);
  if (!UNINSTALL && !DRY && runsFromNpxCache(HOME_DIR)) {
    problems.push('Không nối skill từ cache của npx vì thư mục đó là tạm. Chạy npx flow-harness không kèm tham số, hoặc cài toàn cục: npm install -g flow-harness.');
  }
  for (const problem of problems) log(problem);
  return problems.length > 0;
}

if (rejectBadInput()) process.exit(2);

const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(HOME_DIR, 'package.json'), 'utf8'));
const banner = UNINSTALL ? '' : renderBanner({ lang: pickLanguage(process.env, undefined), version: VERSION, cwd: process.cwd(), isTTY: !!process.stdout.isTTY, columns: process.stdout.columns || 80, env: process.env });
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
