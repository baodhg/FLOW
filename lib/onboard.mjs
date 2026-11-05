import fs from 'node:fs';
import path from 'node:path';
import { applyAnswer, loadUserPrefs, resolveConventions, saveUserPrefs, userPrefsPath } from './conventions.mjs';
import { fingerprintRepo, rootDeclaredRules } from './fingerprint.mjs';
import { exists, readText, today, writeText } from './util.mjs';
import { discoverRepos, openFlow } from './workspace.mjs';

const log = (...a) => console.log(...a);
const pct = (x) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round((x || 0) * 100)}%`);
const KIND = { greenfield: 'dự án mới', existing: 'repo có sẵn', team: 'repo của đội đang hoạt động', 'legacy-prod': 'legacy đang chạy production' };

export function fingerprintReport(fps, res) {
  const md = [`# Dấu vân tay dự án — ${today()}`, '', `**Loại:** ${KIND[res.kind] || res.kind} · quy ước lấy từ repo lớn nhất: \`${res.main.dir.split('/').pop()}\``, ''];
  for (const f of fps) {
    md.push(`## ${f.dir.split('/').pop()} — ${KIND[f.kind] || f.kind}`, '');
    md.push('| Đo | Giá trị |', '|---|---|');
    md.push(`| Lịch sử | ${f.stats.commits} commit · ${f.stats.ageDays} ngày · ${f.stats.contributorsAll} người (${f.stats.contributors90} trong 90 ngày) · ${f.stats.tags} tag |`);
    md.push(`| Remote | ${f.remote.host} · nhánh mặc định \`${f.remote.defaultBranch || '?'}\` · ${f.remote.branchCount} nhánh |`);
    md.push(`| Nhánh | tích hợp \`${f.branches.integration || '?'}\` · bảo vệ (đoán) ${f.branches.protectedGuess.map((b) => `\`${b}\``).join(' ') || '-'} · mẫu \`${f.branches.pattern || '-'}\` |`);
    md.push(`| Commit (${f.commits.sample} mẫu) | conventional ${pct(f.commits.conventional)} · mã ticket ${pct(f.commits.ticket)}${f.commits.ticketKey ? ` (\`${f.commits.ticketKey}\`)` : ''} · tiếng Việt ${pct(f.commits.vietnamese)} · có thân văn xuôi ${pct(f.commits.withProseBody)} · DCO ${pct(f.commits.signedOff)} · AI đồng tác giả ${pct(f.commits.coAuthoredAi)} |`);
    md.push(`| Mã (${f.code.sampled}/${f.code.codeFiles} tệp mẫu) | chú thích ${pct(f.code.commentDensity)} dòng · ${f.code.docBlocksPerKloc} doc block / 1000 dòng · tên tiếng Việt ${pct(f.code.vietnameseIdentifiers)}${f.code.vietnameseExamples.length ? ` (${f.code.vietnameseExamples.slice(0, 3).join(', ')})` : ''} |`);
    md.push(`| Test | ${f.tests.count} tệp · ${f.tests.layout}${f.tests.suffix ? ` · \`${f.tests.suffix}\`` : ''} |`);
    md.push(`| CI | ${f.ci.files.join(', ') || '-'} · ${f.ci.checks.length} lệnh kiểm · deploy: ${f.ci.deploy ? 'có' : 'không'} |`);
    md.push(`| Production | Dockerfile ${f.prod.dockerfiles} · compose ${f.prod.compose ? 'có' : 'không'} · hạ tầng ${f.prod.infra ? 'có' : 'không'} · env prod ${f.prod.envProd ? 'có' : 'không'} |`);
    md.push(`| Quy ước đội | PR template ${f.pr.template ? `\`${f.pr.template}\` (${pct(f.pr.vietnamese)} tiếng Việt)` : '-'} · CONTRIBUTING ${f.contributing || '-'} · CODEOWNERS ${f.codeowners || '-'} · lint/format ${f.lint.join(', ') || '-'} |`);
    md.push(`| Chỉ dẫn agent sẵn có | ${f.agentFiles.join(', ') || '-'}${f.legacyHarness.length ? ` · harness cũ: ${f.legacyHarness.join(', ')}` : ''} |`);
    if (f.ci.checks.length) md.push('', 'Lệnh kiểm trong CI:', '', ...f.ci.checks.map((c) => `- \`${c.cmd}\` (${c.file})`));
    md.push('');
  }
  md.push('## Quy ước đã phân giải', '', '| Khoá | Giá trị | Nguồn |', '|---|---|---|');
  for (const [k, src] of Object.entries(res.sources)) {
    if (k === 'verify.fromCi') continue;
    const v = k.split('.').reduce((o, x) => (o ? o[x] : undefined), res.profile);
    md.push(`| \`${k}\` | ${Array.isArray(v) ? v.join(', ') || '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)} | ${src === 'pending' ? '⏸️ chờ chốt' : src} |`);
  }
  if (res.notes.length) md.push('', '## Ghi chú', '', ...res.notes.map((x) => `- ${x}`));
  return `${md.join('\n')}\n`;
}

function onboardingPath(flow) {
  return path.join(flow.paths.flowDir, 'onboarding.json');
}

export function loadOnboarding(flow) {
  try {
    return JSON.parse(fs.readFileSync(onboardingPath(flow), 'utf8'));
  } catch {
    return { decisions: [] };
  }
}

export function saveOnboarding(flow, data) {
  writeText(onboardingPath(flow), `${JSON.stringify(data, null, 2)}\n`);
}

export function pendingDecisionsText(decisions) {
  const open = decisions.filter((d) => d.answer === null);
  if (!open.length) return '';
  const out = [`${open.length} điều cần chốt khi vào dự án này — hỏi người dùng TRÊN CHAT (Claude Code: AskUserQuestion; CLI khác: dán khối dưới):`, ''];
  for (const d of open) {
    out.push(`**${d.id} · ${d.question}** — ${d.context}`);
    d.options.forEach((o, i) => out.push(`  ${i + 1}. ${o.label}${o.recommended ? ' (khuyến nghị)' : ''} — ${o.why}`));
    out.push('');
  }
  out.push(`Trả lời kiểu "${open.map((d) => `${d.id}=1`).join(', ')}" → ghi: flowctl onboard decide <Dn> <số lựa chọn>`);
  return out.join('\n');
}

export function runFingerprint(dirs, { root = '' } = {}) {
  const fps = dirs.map((d) => fingerprintRepo(d));
  const rootDeclared = root && !dirs.some((d) => path.resolve(d) === path.resolve(root)) ? rootDeclaredRules(root) : null;
  const res = resolveConventions(fps, loadUserPrefs(), { rootDeclared });
  return { fps, res };
}

export function cmdFingerprint(cwd, opts) {
  let dirs;
  if (typeof opts.path === 'string') dirs = [path.resolve(cwd, opts.path)];
  else {
    const flow = openFlow(cwd, { required: false });
    dirs = flow ? discoverRepos(flow).map((r) => r.dir) : [cwd];
  }
  const flowHere = typeof opts.path === 'string' ? null : openFlow(cwd, { required: false });
  const { fps, res } = runFingerprint(dirs, { root: flowHere ? flowHere.root : typeof opts.path === 'string' ? path.dirname(dirs[0]) : '' });
  if (opts.json) {
    log(JSON.stringify({ fps, res: { ...res, main: undefined } }, null, 2));
    return 0;
  }
  log(fingerprintReport(fps, res));
  const q = pendingDecisionsText(res.decisions);
  if (q) log(q);
  return 0;
}

export function cmdOnboard(cwd, sub, opts) {
  const flow = openFlow(cwd);
  const data = loadOnboarding(flow);
  if (sub === 'decide') {
    const [id, pick] = opts._;
    const d = data.decisions.find((x) => x.id.toUpperCase() === String(id || '').toUpperCase());
    if (!d) {
      log(`Không có ${id}. Có: ${data.decisions.map((x) => x.id).join(', ') || '(không có)'}`);
      return 1;
    }
    const idx = Number(pick) - 1;
    const opt = d.options[idx] || d.options.find((o) => o.value === pick || o.label === pick);
    if (!opt) {
      log(`Lựa chọn "${pick}" không hợp lệ: ${d.options.map((o, i) => `${i + 1}=${o.value}`).join(' · ')}`);
      return 1;
    }
    const profilePath = flow.paths.profile;
    const profile = JSON.parse(readText(profilePath));
    applyAnswer(profile, d.key, opt.value);
    profile._sources = { ...(profile._sources || {}), [d.key]: 'answer' };
    writeText(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    d.answer = { value: opt.value, label: opt.label, at: today() };
    saveOnboarding(flow, data);
    log(`✓ ${d.id} ${d.key} = ${opt.value} (${opt.label})`);
    return 0;
  }
  if (sub === 'refresh') {
    const { fps, res } = runFingerprint(discoverRepos(flow).map((r) => r.dir), { root: flow.root });
    writeText(path.join(flow.paths.flowDir, 'fingerprint.md'), fingerprintReport(fps, res));
    writeText(path.join(flow.paths.flowDir, 'fingerprint.json'), `${JSON.stringify(fps, null, 1)}\n`);
    const profile = JSON.parse(readText(flow.paths.profile));
    const drift = [];
    for (const [k, src] of Object.entries(res.sources)) {
      if (src !== 'project' || k === 'verify.fromCi') continue;
      const cur = k.split('.').reduce((o, x) => (o ? o[x] : undefined), profile);
      const now = k.split('.').reduce((o, x) => (o ? o[x] : undefined), res.profile);
      if ((profile._sources || {})[k] === 'project' && JSON.stringify(cur) !== JSON.stringify(now)) drift.push(`${k}: ${JSON.stringify(cur)} → ${JSON.stringify(now)}`);
    }
    log(drift.length ? `Quy ước của dự án đã đổi kể từ lần đo trước:\n${drift.map((x) => `  - ${x}`).join('\n')}\nCập nhật profile.json nếu đúng (hỏi người dùng nếu đổi luật).` : '✓ Quy ước dự án không đổi so với profile.');
    return 0;
  }
  const text = pendingDecisionsText(data.decisions);
  const done = data.decisions.filter((d) => d.answer);
  if (!text) log(`✓ Không còn điều gì cần chốt.${done.length ? ` Đã chốt: ${done.map((d) => `${d.id} ${d.key}=${d.answer.value}`).join(' · ')}` : ''}`);
  else log(text);
  return text ? 1 : 0;
}

export function cmdUser(cwd, sub, opts) {
  const prefs = loadUserPrefs();
  if (sub === 'set') {
    const [key, ...rest] = opts._;
    const raw = rest.join(' ');
    if (!key || !raw) {
      log('user set <khoá> <giá trị> — ví dụ: user set code.comments unit · user set language.user vi');
      return 1;
    }
    let value = raw;
    if (raw === 'true' || raw === 'false') value = raw === 'true';
    const parts = key.split('.');
    let o = prefs;
    for (const pp of parts.slice(0, -1)) o = o[pp] = o[pp] || {};
    o[parts[parts.length - 1]] = value;
    log(`✓ ${key} = ${JSON.stringify(value)} → ${saveUserPrefs(prefs)}`);
    return 0;
  }
  const { _file, ...show } = prefs;
  log(`Sở thích của bạn (lớp dưới quy ước của dự án) — ${_file ? userPrefsPath() : 'chưa có tệp, đang dùng mặc định trung tính'}:`);
  log(JSON.stringify(show, null, 2));
  return 0;
}

export function initOnboarding(flow, repos) {
  const { fps, res } = runFingerprint(repos.filter((r) => exists(path.join(r.dir, '.git'))).map((r) => r.dir));
  writeText(path.join(flow.paths.flowDir, 'fingerprint.md'), fingerprintReport(fps, res));
  writeText(path.join(flow.paths.flowDir, 'fingerprint.json'), `${JSON.stringify(fps, null, 1)}\n`);
  saveOnboarding(flow, { createdAt: today(), kind: res.kind, decisions: res.decisions });
  return { fps, res };
}
