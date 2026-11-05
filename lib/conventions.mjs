import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plannedEntries } from './detect.mjs';

export const NEUTRAL_USER = {
  version: 1,
  language: { user: 'en', team: 'en' },
  code: { language: 'en', comments: 'off', naming: 'warn' },
  commit: { style: 'conventional', language: 'en', body: 'free' },
  pr: { language: 'en' },
  autonomy: 'local',
};

export function userPrefsPath() {
  return process.env.AGENT_FLOW_USER || path.join(os.homedir(), '.agent-flow', 'user.json');
}

export function loadUserPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(userPrefsPath(), 'utf8'));
    return {
      ...NEUTRAL_USER,
      ...raw,
      language: { ...NEUTRAL_USER.language, ...(raw.language || {}) },
      code: { ...NEUTRAL_USER.code, ...(raw.code || {}) },
      commit: { ...NEUTRAL_USER.commit, ...(raw.commit || {}) },
      pr: { ...NEUTRAL_USER.pr, ...(raw.pr || {}) },
      _file: true,
    };
  } catch {
    return { ...NEUTRAL_USER, _file: false };
  }
}

export function saveUserPrefs(prefs) {
  const file = userPrefsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { _file, ...clean } = prefs;
  fs.writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`);
  return file;
}

const KIND_RANK = { greenfield: 0, existing: 1, team: 2, 'legacy-prod': 3 };

export function dominant(fps) {
  return [...fps].sort((a, b) => b.code.codeFiles - a.code.codeFiles)[0];
}

export function workspaceKind(fps) {
  return fps.reduce((k, f) => (KIND_RANK[f.kind] > KIND_RANK[k] ? f.kind : k), 'greenfield');
}

function decision(id, key, question, context, options) {
  return { id, key, question, context, options, answer: null };
}

const LANG_LABEL = { vi: 'tiếng Việt có dấu', en: 'tiếng Anh' };

export function resolveConventions(fps, user, { rootDeclared = null } = {}) {
  const main = dominant(fps);
  const declared = {};
  for (const src of [rootDeclared, main.declared, ...fps.map((f) => f.declared)]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) if (v && !declared[k]) declared[k] = v;
  }
  const kind = workspaceKind(fps);
  const fresh = kind === 'greenfield';
  const sources = {};
  const decisions = [];
  const notes = [];
  const set = (obj, key, value, source) => {
    const parts = key.split('.');
    let o = obj;
    for (const p of parts.slice(0, -1)) o = o[p] = o[p] || {};
    o[parts[parts.length - 1]] = value;
    sources[key] = source;
  };
  const p = {};
  let n = 0;
  const next = () => `D${++n}`;

  set(p, 'project.kind', kind, 'project');
  set(p, 'language.user', user.language.user, user._file ? 'user' : 'default');

  const cm = main.commits;
  const teamCommits = cm.sample >= 15;
  const commitVi = teamCommits && cm.vietnamese >= 0.3;
  const prTemplateLang = main.pr.template ? (main.pr.vietnamese >= 0.25 ? 'vi' : main.pr.vietnamese < 0.05 ? 'en' : '') : '';
  let team = '';
  let teamSource = 'project';
  if (prTemplateLang) team = prTemplateLang;
  else if (teamCommits) team = commitVi ? 'vi' : 'en';
  else if (main.readme.file && !fresh) team = main.readme.vietnamese >= 0.25 ? 'vi' : 'en';
  if (!team || fresh) {
    team = user.language.team || user.pr.language;
    teamSource = user._file ? 'user' : 'default';
  }
  set(p, 'language.team', team, teamSource);
  if (!fresh && teamSource === 'project' && team !== user.pr.language) notes.push(`Đội viết PR / tài liệu chung bằng ${LANG_LABEL[team] || team} (đo từ ${prTemplateLang ? main.pr.template : 'commit'}) — mô tả PR, tên ca test theo đội; chat và \`.flow/\` vẫn theo ngôn ngữ của bạn.`);

  const vnIds = main.code.vietnameseIdentifiers;
  set(p, 'language.code', 'en', 'default');
  if (declared.englishCode) {
    set(p, 'hygiene.naming', 'block', 'project');
    notes.push(`\`${declared.englishCode}\` tuyên bố mã bằng tiếng Anh — chặn tên mới không phải tiếng Anh.`);
  } else if (!fresh && vnIds >= 0.03 && user.code.naming !== 'off') {
    decisions.push(decision(next(), 'hygiene.naming', 'Tên trong mã mới: bắt buộc tiếng Anh?', `Repo đang có ${Math.round(vnIds * 100)}% tên định danh tiếng Việt (ví dụ: ${main.code.vietnameseExamples.slice(0, 3).join(', ')}).`, [
      { label: 'Tên MỚI tiếng Anh, tên cũ giữ nguyên', value: 'block', recommended: true, why: 'chỉ chặn tên mới; chạm hàm nào thì đổi tên hàm đó' },
      { label: 'Theo lệ repo', value: 'off', why: 'không kiểm tên' },
    ]));
    set(p, 'hygiene.naming', 'block', 'pending');
  } else set(p, 'hygiene.naming', user.code.naming, user._file ? 'user' : 'default');

  const dense = main.code.commentDensity >= 0.06 || main.code.docBlocksPerKloc >= 5;
  if (declared.comments) {
    set(p, 'hygiene.comments', declared.comments, 'project');
    notes.push(`\`${declared.commentsSource}\` tuyên bố luật mã không chú thích (${declared.comments === 'file' ? 'chạm tệp xoá cả tệp' : 'chạm hàm xoá cả hàm'}) — áp theo luật của dự án; chú thích còn trong mã là nợ cũ.`);
  } else if (!fresh && dense && ['unit', 'file', 'no-new'].includes(user.code.comments)) {
    decisions.push(decision(next(), 'hygiene.comments', 'Chú thích trong mã ở repo này?', `Repo đang dùng chú thích khá nhiều (${Math.round(main.code.commentDensity * 100)}% dòng là chú thích, ${main.code.docBlocksPerKloc} doc block / 1000 dòng). Sở thích của bạn: \`${user.code.comments}\`.`, [
      { label: 'Không thêm mới, không xoá của người khác', value: 'no-new', recommended: KIND_RANK[kind] >= 2, why: 'tôn trọng lệ của đội, không gây diff rác' },
      { label: 'Theo bạn — chạm hàm nào xoá sạch chú thích hàm đó', value: user.code.comments === 'file' ? 'file' : 'unit', recommended: KIND_RANK[kind] < 2, why: 'mã sạch dần theo luật đụng-tới' },
      { label: 'Theo lệ repo — được viết chú thích', value: 'off', why: 'agent viết doc comment như đội đang làm' },
    ]));
    set(p, 'hygiene.comments', KIND_RANK[kind] >= 2 ? 'no-new' : user.code.comments, 'pending');
  } else {
    set(p, 'hygiene.comments', user.code.comments, user._file ? 'user' : 'default');
    if (!fresh && !dense) notes.push(`Repo gần như không chú thích (${Math.round(main.code.commentDensity * 100)}% dòng) — khớp sở thích \`${user.code.comments}\`.`);
  }

  if (teamCommits && cm.ticket >= 0.5) {
    set(p, 'commit.style', 'ticket', 'project');
    set(p, 'commit.ticketKey', cm.ticketKey, 'project');
    notes.push(`Commit của đội gắn mã ticket \`${cm.ticketKey}-123\` (${Math.round(cm.ticket * 100)}%) — agent sẽ đòi mã ticket trong tiêu đề.`);
  } else if (teamCommits && cm.conventional >= 0.6) set(p, 'commit.style', 'conventional', 'project');
  else if (teamCommits && cm.conventional < 0.2 && user.commit.style === 'conventional') {
    decisions.push(decision(next(), 'commit.style', 'Định dạng tiêu đề commit?', `Đội không dùng Conventional Commits (${Math.round(cm.conventional * 100)}%). Ví dụ gần đây: ${cm.examples.slice(0, 2).map((e) => `"${e}"`).join(' · ')}.`, [
      { label: 'Theo đội', value: 'free', recommended: true, why: 'lịch sử commit đồng nhất' },
      { label: 'Conventional Commits', value: 'conventional', why: 'theo sở thích của bạn' },
    ]));
    set(p, 'commit.style', 'free', 'pending');
  } else set(p, 'commit.style', user.commit.style, user._file ? 'user' : 'default');

  if (teamCommits && commitVi && user.commit.language === 'en') {
    decisions.push(decision(next(), 'commit.language', 'Ngôn ngữ tiêu đề commit?', `${Math.round(cm.vietnamese * 100)}% commit của đội viết tiếng Việt.`, [
      { label: 'Theo đội — tiếng Việt có dấu', value: 'vi', recommended: true, why: 'đồng nhất lịch sử' },
      { label: 'Tiếng Anh', value: 'en', why: 'theo sở thích của bạn' },
    ]));
    set(p, 'commit.language', 'vi', 'pending');
  } else set(p, 'commit.language', teamCommits ? (commitVi ? 'vi' : 'en') : user.commit.language, teamCommits ? 'project' : user._file ? 'user' : 'default');

  if (declared.trailersOnly) {
    set(p, 'commit.body', 'trailers-only', 'project');
    notes.push(`\`${declared.trailersOnly}\` tuyên bố thân commit chỉ có trailer — áp theo luật của dự án.`);
  } else if (teamCommits && cm.withProseBody >= 0.3 && user.commit.body === 'trailers-only') {
    decisions.push(decision(next(), 'commit.body', 'Thân commit?', `${Math.round(cm.withProseBody * 100)}% commit của đội có đoạn giải thích trong thân.`, [
      { label: 'Theo đội — được viết thân ngắn', value: 'free', recommended: true, why: 'đội đọc lịch sử qua thân commit' },
      { label: 'Chỉ trailer', value: 'trailers-only', why: 'theo sở thích của bạn — giải thích để trong CONTEXT.md' },
    ]));
    set(p, 'commit.body', 'free', 'pending');
  } else set(p, 'commit.body', teamCommits && cm.withProseBody >= 0.3 ? 'free' : user.commit.body, teamCommits && cm.withProseBody >= 0.3 ? 'project' : user._file ? 'user' : 'default');
  set(p, 'commit.signoff', teamCommits && cm.signedOff >= 0.5, teamCommits ? 'project' : 'default');
  if (teamCommits && cm.signedOff >= 0.5) notes.push('Đội ký DCO (`Signed-off-by:`) — agent thêm trailer này.');

  const br = main.branches;
  set(p, 'branches.protected', br.protectedGuess.length ? br.protectedGuess : ['main', 'master'], br.protectedGuess.length ? 'project' : 'default');
  set(p, 'branches.workFrom', br.integration || main.remote.defaultBranch || '', 'project');
  set(p, 'branches.pattern', br.pattern || 'feat/<slug>', br.pattern ? 'project' : 'default');

  if (kind === 'legacy-prod') {
    decisions.push(decision(next(), 'autonomy.level', 'Sau khi plan được duyệt, agent tự làm tới đâu?', `Repo có dấu hiệu production (${[main.prod.dockerfiles ? 'Dockerfile' : '', main.prod.infra ? 'hạ tầng / k8s' : '', main.prod.deployCi ? 'CI deploy' : '', main.stats.tags ? `${main.stats.tags} tag` : ''].filter(Boolean).join(', ')}) · ${main.stats.contributorsAll} người đóng góp · ${main.stats.ageDays} ngày tuổi.`, [
      { label: 'Chỉ commit local, tôi tự push', value: 'local', recommended: true, why: 'tuần đầu vào hệ của người khác' },
      { label: 'Tới mở PR / MR', value: 'pr', why: 'khi đã quen luồng review của đội' },
    ]));
    set(p, 'autonomy.level', 'local', 'pending');
  } else set(p, 'autonomy.level', user.autonomy || 'local', user._file ? 'user' : 'default');

  const ciVerify = [];
  for (const f of fps) {
    for (const c of f.ci.checks) {
      ciVerify.push({ name: `ci:${c.cmd.split(/\s+/).slice(0, 3).join(' ')}`.slice(0, 40), run: c.cmd, when: [], source: 'ci', file: c.file });
    }
  }
  set(p, 'verify.fromCi', ciVerify, 'project');
  set(p, 'tests', { layout: main.tests.layout, suffix: main.tests.suffix }, 'project');
  set(p, 'instructions', [...new Set(fps.flatMap((f) => f.agentFiles))], 'project');
  if (p.instructions.length) notes.push(`Dự án có tệp chỉ dẫn agent riêng (${p.instructions.join(', ')}) — chúng THẮNG khi mâu thuẫn; đọc trước, chuyển luật kiểm được sang \`.flow/rules\`.`);
  if (fps.some((f) => f.legacyHarness.length)) notes.push(`Có harness cũ (${[...new Set(fps.flatMap((f) => f.legacyHarness))].join(', ')}) — nhận nuôi qua \`layout.legacy\`, không di chuyển.`);
  if (main.contributing) notes.push(`Đọc \`${main.contributing}\` — quy ước của đội nằm ở đó.`);
  if (main.pr.template) notes.push(`PR theo khuôn \`${main.pr.template}\`.`);
  return { kind, profile: p, sources, decisions, notes, main };
}

export function applyAnswer(profile, key, value) {
  const parts = key.split('.');
  let o = profile;
  for (const part of parts.slice(0, -1)) o = o[part] = o[part] || {};
  o[parts[parts.length - 1]] = value;
  if (key === 'commit.body') {
    profile.hygiene = profile.hygiene || {};
    profile.hygiene.commitBody = value;
  }
  return profile;
}

export function plannedFor(stacks) {
  return stacks.flatMap((s) => plannedEntries(s));
}
