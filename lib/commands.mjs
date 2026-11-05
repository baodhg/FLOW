import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineOf, checkChanged, clusterize, loadBaseline, scanRepo, searchFuncs } from './dup.mjs';
import { RUNBOOK_KINDS, createRunbook, findRunbook, lintRunbook, listRunbooks } from './runbook.mjs';
import { namingFamily, namingSkipped, newVietnameseNames, vietnameseFileName, vietnameseHit, vietnameseMessages } from './naming.mjs';
import { decideSecretCommand, isKeyFile, isRealEnvFile, scanSecretsInLine, mask, scannerSelfCheck } from './secrets.mjs';
import { checkLines, quickTreeSummary, runSecretsCheck, textProblems } from './secretscmd.mjs';
import { fingerprintReport, loadOnboarding, pendingDecisionsText, runFingerprint, saveOnboarding } from './onboard.mjs';
import { describeRepo, detectBranches, detectStacks, plannedEntries } from './detect.mjs';
import { ensureExcludes, verifyExcludes } from './excludes.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { checkCommitMessage, defaultLeakPatterns, findComments, findLeaks } from './hygiene.mjs';
import {
  createMemory,
  createPlan,
  addTask,
  createRule,
  decidePlan,
  doneTask,
  noteLedger,
  planTasks,
  findPlan,
  parseDecisions,
  parseTasks,
  planDecisions,
  findRules,
  grepLegacy,
  readMemories,
  readPlans,
  readRules,
  setPlanStatus,
  writeIndexes,
} from './store.mjs';
import {
  currentBranch,
  exists,
  git,
  gitRoot,
  globToRegExp,
  headCommit,
  isDir,
  lineCount,
  listFiles,
  matchAny,
  readText,
  rel,
  run,
  slugify,
  stamp,
  table,
  today,
  toPosix,
  truncate,
  writeText,
  realDir,
} from './util.mjs';
import {
  DEFAULT_MODULE_GLOBS,
  DEFAULT_PROFILE,
  FLOW_DIR,
  addedLines,
  changedFiles,
  discoverRepos,
  harnessPatterns,
  isCodeFile,
  makeFlow,
  moduleOf,
  openFlow,
  scopeRepos,
} from './workspace.mjs';

export const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = path.join(HOME, 'templates');
const PRESET_GATES = path.join(HOME, 'presets', 'gates');

const log = (...a) => console.log(...a);

function list(v) {
  if (v === undefined || v === true) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
}

function targetFiles(flow, opts) {
  const out = [];
  const repos = scopeRepos(flow, { all: !!opts.all });
  for (const p of list(opts.path)) {
    const abs = path.resolve(flow.cwd, p);
    const repo = repos.find((r) => abs.startsWith(path.resolve(r.dir) + path.sep)) || discoverRepos(flow).find((r) => abs.startsWith(path.resolve(r.dir) + path.sep));
    out.push({ repo: repo || null, file: repo ? toPosix(path.relative(repo.dir, abs)) : toPosix(path.relative(flow.root, abs)), abs });
  }
  if (opts.changed || opts.staged || opts.base) {
    for (const repo of repos) {
      for (const f of changedFiles(repo.dir, { staged: !!opts.staged, base: opts.base || '' })) {
        out.push({ repo, file: f, abs: path.join(repo.dir, f) });
      }
    }
  }
  return out;
}

function bothForms(flow, items) {
  const s = new Set();
  for (const it of items) {
    s.add(toPosix(it.file));
    s.add(toPosix(path.relative(flow.root, it.abs)));
  }
  return [...s];
}

export function cmdWhere(cwd) {
  const flow = openFlow(cwd, { required: false });
  if (!flow) {
    log('Chưa có .flow/ ở đây hay thư mục cha. Repo này chưa dùng agent-flow.');
    log('Khởi tạo: `flowctl init` (repo đơn) — hoặc chạy ở thư mục cha chứa nhiều repo (workspace).');
    return 0;
  }
  const p = flow.profile;
  log(`Flow root : ${flow.root}${flow.roots.length > 1 ? `  (cha: ${flow.roots.slice(1).join(' · ')})` : ''}`);
  log(`Dự án     : ${p.name || path.basename(flow.root)} · mode=${p.mode} · trackHarness=${p.trackHarness}`);
  log(`Ngữ cảnh  : ${rel(flow.root, flow.paths.project)} · module=${p.layout.moduleContext}`);
  log(`Vệ sinh   : comments=${p.hygiene.comments} · commitBody=${p.hygiene.commitBody}`);
  log(`Bảo vệ    : ${p.branches.protected.join(', ') || '-'}${p.branches.workFrom ? ` · cắt từ ${p.branches.workFrom}` : ''}`);
  const rules = readRules(flow.paths.rules);
  const mems = readMemories(flow.paths.memory);
  const plans = readPlans(flow.paths.plans);
  const gates = listFiles(flow.paths.gates, (n) => n.endsWith('.md'));
  log(`Kho       : ${rules.length} rules · ${mems.length} memory · ${plans.filter((x) => x.bucket === 'active').length} plan mở · ${gates.length} gate`);
  if (flow.paths.legacy.length) log(`Legacy    : ${flow.paths.legacy.map((l) => rel(flow.root, l.file)).join(' · ')}`);
  const rows = discoverRepos(flow).map((r) => {
    const dirty = git(r.dir, ['status', '--porcelain']).out.split('\n').filter(Boolean).length;
    return [r.name, rel(flow.root, r.dir), currentBranch(r.dir) || '-', (headCommit(r.dir) || '').slice(0, 9), dirty];
  });
  log('');
  log(table(rows, ['repo', 'path', 'branch', 'HEAD', 'dirty']));
  return 0;
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

export function cmdInit(cwd, opts) {
  const target = realDir(path.resolve(cwd, typeof opts.dir === 'string' ? opts.dir : '.'));
  const profileFile = path.join(target, FLOW_DIR, 'profile.json');
  if (exists(profileFile) && !opts.force) {
    log(`Đã có ${profileFile}. Dùng \`flowctl doctor\` để kiểm, hoặc --force để sinh lại khung (không xoá rules/memory/plans).`);
    return 1;
  }
  const top = gitRoot(target);
  const isRepoRoot = top && path.resolve(top) === target;
  const children = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && exists(path.join(target, d.name, '.git')))
    .map((d) => d.name);
  if (!isRepoRoot && !children.length) {
    if (top) {
      log(`${target} nằm trong repo ${top} nhưng không phải gốc repo. Chạy init ở gốc repo, hoặc dùng --force để đặt .flow ở đây.`);
      if (!opts.force) return 1;
    } else {
      log(`${target} không phải git repo và không chứa repo con nào.`);
      if (!opts.force) return 1;
    }
  }
  const mode = children.length ? 'workspace' : 'repo';
  const repos = [];
  if (isRepoRoot) repos.push({ name: path.basename(target), dir: target, path: '.' });
  for (const c of children) repos.push({ name: c, dir: path.join(target, c), path: c });

  const verify = [];
  const protectedSet = new Set();
  let workFrom = '';
  const repoLines = [];
  for (const r of repos) {
    const { stacks, verify: v } = detectStacks(r.dir);
    for (const item of v) verify.push(mode === 'workspace' ? { repo: r.path, ...item } : item);
    const b = detectBranches(r.dir);
    b.protected.forEach((x) => protectedSet.add(x));
    if (!workFrom && b.workFrom) workFrom = b.workFrom;
    const d = describeRepo(target, r);
    repoLines.push(`| ${d.name} | \`${d.path}\` | ${stacks.join(', ') || '?'} | ${d.remote || '-'} | <vai trò> |`);
  }
  for (const spec of list(opts.stack)) {
    const [stack, cwd = '.'] = spec.split('@');
    const planned = plannedEntries(stack, cwd);
    if (!planned.length) {
      log(`stack    ${spec}: không có khuôn (có: dotnet, node, react, go, python)`);
      continue;
    }
    for (const item of planned) {
      if (verify.some((v) => v.name === item.name && (v.cwd || '.') === (item.cwd || '.'))) continue;
      verify.push(mode === 'workspace' && repos[0] ? { repo: repos[0].path, ...item } : item);
    }
    repoLines.push(`| _(dự kiến)_ | \`${cwd}\` | ${stack} | - | <vai trò> |`);
  }
  const protectedBranches = protectedSet.size ? [...protectedSet] : DEFAULT_PROFILE.branches.protected;
  const gitRepos = repos.filter((r) => exists(path.join(r.dir, '.git')));
  const { fps, res } = gitRepos.length ? runFingerprint(gitRepos.map((r) => r.dir), { root: target }) : { fps: [], res: null };
  const rp = res?.profile || {};
  const sources = { ...(res?.sources || {}) };
  const pick = (flag, allowed, detected, key) => {
    if (allowed.includes(opts[flag])) {
      sources[key] = 'answer';
      return opts[flag];
    }
    return detected;
  };
  const comments = pick('comments', ['off', 'no-new', 'unit', 'file'], rp.hygiene?.comments || 'off', 'hygiene.comments');
  const commitBody = pick('commit-body', ['free', 'trailers-only'], rp.commit?.body || 'free', 'commit.body');
  const ciVerify = rp.verify?.fromCi || [];
  const verifyAll = ciVerify.length ? [...ciVerify, ...verify.map((v) => ({ ...v, optional: true, source: 'manifest' }))] : verify.map((v) => ({ ...v, source: v.requires ? 'planned' : 'manifest' }));
  const profile = {
    version: 1,
    name: opts.name || path.basename(target),
    mode,
    trackHarness: !!opts['track-harness'],
    project: { kind: res?.kind || 'greenfield', detectedAt: today() },
    language: { code: 'en', team: rp.language?.team || 'en', user: rp.language?.user || 'en', prose: rp.language?.team || 'en' },
    layout: { moduleContext: opts.context || 'CONTEXT.md', legacy: [] },
    repos: mode === 'workspace' ? repos.map((r) => ({ name: r.name, path: r.path })) : [],
    modules: [],
    instructions: rp.instructions || [],
    branches: {
      protected: rp.branches?.protected?.length ? rp.branches.protected : protectedBranches,
      workFrom: rp.branches?.workFrom || workFrom,
      pattern: rp.branches?.pattern || 'feat/<slug>',
      ownerOnly: [],
    },
    verify: verifyAll,
    commit: {
      style: rp.commit?.style || 'conventional',
      language: rp.commit?.language || 'en',
      ticketKey: rp.commit?.ticketKey || '',
      body: commitBody,
      signoff: !!rp.commit?.signoff,
    },
    hygiene: {
      comments,
      commitBody,
      naming: pick('naming', ['off', 'warn', 'block'], rp.hygiene?.naming || 'warn', 'hygiene.naming'),
      leakPatterns: [],
      commentExempt: DEFAULT_PROFILE.hygiene.commentExempt,
      customChecks: [],
      dup: 'block',
    },
    tests: rp.tests || {},
    autonomy: { level: rp.autonomy?.level || 'local' },
    impact: { humanReviewAt: 6 },
    context: DEFAULT_PROFILE.context,
    _sources: sources,
  };
  const existing = exists(profileFile) ? JSON.parse(readText(profileFile)) : null;
  writeText(profileFile, `${JSON.stringify(existing || profile, null, 2)}\n`);
  const flow = makeFlow(target, openFlow(target).profile, [target], target);
  if (res) {
    writeText(path.join(flow.paths.flowDir, 'fingerprint.md'), fingerprintReport(fps, res));
    writeText(path.join(flow.paths.flowDir, 'fingerprint.json'), `${JSON.stringify(fps, null, 1)}\n`);
    if (!existing) saveOnboarding(flow, { createdAt: today(), kind: res.kind, decisions: res.decisions });
  }

  const ex = ensureExcludes(flow);
  for (const e of ex) log(`exclude  ${e.repo}: ${e.patterns ? (e.changed ? 'đã ghi ' : 'đã có ') + e.patterns.join(' ') : e.status}`);

  for (const d of [flow.paths.consumed, flow.paths.reference, flow.paths.assets, flow.paths.rules, flow.paths.memory, path.join(flow.paths.plans, 'active'), path.join(flow.paths.plans, 'shipped'), flow.paths.gates, flow.paths.handoff, flow.paths.runs]) {
    fs.mkdirSync(d, { recursive: true });
  }
  if (!exists(flow.paths.project) || opts.force) {
    if (!exists(flow.paths.project)) {
      const verifyText = verify.length
        ? verify.map((v) => `- ${v.repo ? `\`${v.repo}\` ` : ''}**${v.name}**: \`${v.run}\``).join('\n')
        : '- <chưa nhận diện được — điền tay vào `.flow/profile.json` → `verify`>';
      writeText(
        flow.paths.project,
        fill(readText(path.join(TEMPLATES, 'PROJECT.md')), {
          name: profile.name,
          date: today(),
          repos: ['| Repo | Đường dẫn | Stack | Remote | Vai trò |', '|---|---|---|---|---|', ...repoLines].join('\n'),
          protected: protectedBranches.map((b) => `\`${b}\``).join(', '),
          workFrom: workFrom ? `\`${workFrom}\`` : '<nhánh>',
          pattern: profile.branches.pattern,
          codeLang: { en: 'tiếng Anh', vi: 'tiếng Việt' }[flow.profile.language.code] || flow.profile.language.code,
          proseLang: { en: 'tiếng Anh', vi: 'tiếng Việt có dấu' }[flow.profile.language.team] || flow.profile.language.team,
          teamLang: { en: 'tiếng Anh', vi: 'tiếng Việt có dấu' }[flow.profile.language.team] || flow.profile.language.team,
          userLang: { en: 'tiếng Anh', vi: 'tiếng Việt có dấu' }[flow.profile.language.user] || flow.profile.language.user,
          kind: flow.profile.project?.kind || '?',
          instructions: (flow.profile.instructions || []).map((x) => `\`${x}\``).join(', ') || 'không có',
          naming: flow.profile.hygiene.naming,
          comments: flow.profile.hygiene.comments,
          commitStyle: `${flow.profile.commit?.style || 'conventional'}${flow.profile.commit?.ticketKey ? ` (${flow.profile.commit.ticketKey}-…)` : ''}`,
          commitLang: { en: 'tiếng Anh', vi: 'tiếng Việt có dấu' }[flow.profile.commit?.language] || flow.profile.commit?.language,
          commitBody: flow.profile.commit?.body || flow.profile.hygiene.commitBody,
          tests: flow.profile.tests?.layout ? `${flow.profile.tests.layout}${flow.profile.tests.suffix ? ` · \`${flow.profile.tests.suffix}\`` : ''}` : '<chưa có test>',
          verify: verifyText,
        }),
      );
    }
  }
  if (!exists(flow.paths.services)) {
    const stubs = repos
      .map((r) => {
        const d = describeRepo(target, r);
        return [
          `## ${d.name}`,
          '',
          '- **Vai trò:** <1 câu>',
          `- **Repo / đường dẫn:** \`${d.path}\` · remote ${d.remote || '-'}`,
          `- **Stack:** ${d.stacks.join(', ') || '<?>'} · **cổng:** <…> · **DB:** <…>`,
          '- **Đọc trước:** <…>',
          '- **Module mức 1:** <…>',
          '- **Phụ thuộc:** gọi <…> · bị gọi bởi <…>',
          '',
        ].join('\n');
      })
      .join('\n');
    const tpl = readText(path.join(TEMPLATES, 'services.md')).replace(/\n## <tên service>[\s\S]*$/, '\n');
    writeText(flow.paths.services, fill(tpl, { date: today(), services: stubs }));
  }
  if (mode === 'workspace' && !exists(flow.paths.contracts)) {
    writeText(
      flow.paths.contracts,
      [
        '# Contracts — hợp đồng xuyên repo',
        '',
        '_Một dòng một hợp đồng. Đổi hợp đồng ⇒ sửa dòng ở đây trong CÙNG phiên. Hợp đồng chết ⇒ gạch bỏ có ngày, không xoá._',
        '',
        '## HTTP / RPC',
        '',
        '| Endpoint | Producer (file:line) | Consumer (file:line) | Auth | Ghi chú |',
        '|---|---|---|---|---|',
        '',
        '## Event / queue',
        '',
        '| Topic / event | Producer | Consumer | Định dạng | Ghi chú |',
        '|---|---|---|---|---|',
        '',
        '## Biến môi trường / secret phải khớp hai đầu',
        '',
        '| Tên | Repo A | Repo B | Ghi chú |',
        '|---|---|---|---|',
        '',
      ].join('\n'),
    );
  }
  const gates = list(opts.gates);
  const all = gates.includes('all') ? listFiles(PRESET_GATES).map((f) => path.basename(f, '.md')) : gates;
  for (const g of all) {
    const src = path.join(PRESET_GATES, `${g}.md`);
    if (!exists(src)) {
      log(`gate     ${g}: không có preset (có: ${listFiles(PRESET_GATES).map((f) => path.basename(f, '.md')).join(', ')})`);
      continue;
    }
    const dst = path.join(flow.paths.gates, `${g}.md`);
    if (!exists(dst)) fs.copyFileSync(src, dst);
    log(`gate     ${g}: ${rel(target, dst)}`);
  }
  if (!exists(flow.paths.state)) writeText(flow.paths.state, `${JSON.stringify({ repos: {} }, null, 2)}\n`);
  writeCoverage(flow);
  const db = writeDupBaseline(flow);
  log(`dup      ${db.skipped ? 'baseline đã có' : `baseline: ${db.clusters} cụm trùng hiện có (${db.funcs} hàm) — chỉ chặn bản trùng MỚI`}`);
  writeIndexes(flow.paths);
  const v = verifyExcludes(flow);
  for (const r of v) {
    const bad = r.ignored.filter((x) => !x.ignored);
    log(`kiểm     ${r.repo}: ${bad.length ? `CHƯA bị bỏ qua: ${bad.map((b) => b.probe).join(', ')}` : 'harness đã bị git bỏ qua'}${r.tracked.length ? ` · ⚠️ đang được track: ${r.tracked.slice(0, 5).join(', ')}` : ''}`);
  }
  log('');
  log(`Đã khởi tạo agent-flow ở ${target} (mode=${mode}).`);
  if (res) {
    const KIND = { greenfield: 'dự án mới — sở thích của bạn thành quy ước', existing: 'repo có sẵn', team: 'repo của đội', 'legacy-prod': 'đang chạy production' };
    const ps = flow.profile;
    log(`Loại: ${KIND[res.kind] || res.kind} · chú thích ${ps.hygiene.comments} · tên ${ps.hygiene.naming} · commit ${ps.commit.style}/${ps.commit.language}/${ps.commit.body}${ps.commit.ticketKey ? ` (${ps.commit.ticketKey}-…)` : ''} · PR ${ps.language.team} · tự chủ ${ps.autonomy.level}`);
    res.notes.forEach((x) => log(`  · ${x}`));
    const leak = quickTreeSummary(flow, gitRepos);
    if (leak.secrets || leak.pii) log(`  · 🔐 Cây hiện tại có ${leak.secrets} nghi bí mật · ${leak.pii} nghi thông tin cá nhân (không in giá trị) — flowctl secrets scan rồi phán xử; lịch sử: --history. Không làm chặn commit mới.`);
    log(`Chi tiết đo: ${rel(cwd, path.join(flow.paths.flowDir, 'fingerprint.md'))}`);
    const pending = pendingDecisionsText(loadOnboarding(flow).decisions);
    if (pending) {
      log('');
      log(pending);
    }
  }
  log('');
  log('Tiếp theo: skill `flow-init` — hỏi các điều cần chốt ở trên (nếu có), điền PROJECT.md / services.md, sinh CONTEXT.md cho module chính.');
  return 0;
}

export function cmdExclude(cwd, opts) {
  const flow = openFlow(cwd);
  const rep = ensureExcludes(flow, { dryRun: !!opts.dry });
  for (const e of rep) log(`${e.repo}: ${e.patterns ? `${e.changed ? (opts.dry ? 'sẽ ghi' : 'đã ghi') : 'đã có'} → ${e.patterns.join(' ')}` : e.status}`);
  let bad = 0;
  for (const r of verifyExcludes(flow)) {
    for (const p of r.ignored) {
      if (!p.ignored) {
        bad++;
        log(`  ✗ ${r.repo}: "${p.probe}" chưa bị bỏ qua`);
      }
    }
    if (r.tracked.length) {
      bad++;
      log(`  ⚠️ ${r.repo}: ${r.tracked.length} tệp harness ĐANG ĐƯỢC TRACK (exclude không gỡ được): ${r.tracked.slice(0, 8).join(', ')}`);
      log('     Gỡ khỏi index nhưng giữ trên đĩa: `git rm --cached <tệp>` trong repo đó — HỎI người dùng trước.');
    }
  }
  if (!bad) log('✓ Mọi repo: harness bị git bỏ qua, không tệp harness nào được track.');
  return bad ? 1 : 0;
}

export function cmdRules(cwd, sub, opts) {
  const flow = openFlow(cwd);
  if (sub === 'new') {
    const r = createRule(flow.paths.rules, {
      type: opts.type || 'invariant',
      title: opts.title,
      severity: opts.severity || 'high',
      scope: list(opts.scope),
      tags: list(opts.tags),
      origin: opts.origin || '',
      enforced: opts.enforced || 'manual',
    });
    writeIndexes(flow.paths);
    log(`${r.id} → ${r.file}`);
    log('Mở tệp và điền 4 mục: Luật · Vì sao · Cách kiểm · Sự cố gốc. Giữ dưới ~40 dòng.');
    return 0;
  }
  if (sub === 'list' || sub === 'find' || !sub) {
    const rules = readRules(flow.paths.rules);
    const items = targetFiles(flow, opts);
    const files = bothForms(flow, items);
    const found =
      sub === 'list' || (!files.length && !opts.tag && !opts.text)
        ? rules.filter((r) => opts.retired || r.status === 'active').map((r) => ({ ...r, reasons: ['all'] }))
        : findRules(rules, { files, tags: list(opts.tag), text: typeof opts.text === 'string' ? opts.text : '', includeGlobal: !opts['no-global'], includeRetired: !!opts.retired });
    if (opts.json) {
      log(JSON.stringify(found.map(({ body, ...r }) => r), null, 2));
      return 0;
    }
    if (!found.length) log('Không có luật nào khớp.');
    for (const r of found) {
      log(`${r.id}  [${r.severity}/${r.type}]  ${r.title}`);
      log(`        ${rel(flow.cwd, r.file)}  · ${r.reasons.join(', ')}${r.enforced && r.enforced !== 'manual' ? ` · thi hành: ${r.enforced}` : ''}`);
    }
    if (flow.paths.legacy.length && (files.length || opts.text)) {
      const hits = grepLegacy(flow.paths.legacy, { text: typeof opts.text === 'string' ? opts.text : '', files: items.map((i) => i.file) });
      const limit = Number(opts.limit) || 25;
      if (hits.length) {
        log('');
        log(`Legacy (${hits.length} dòng khớp, hiện ${Math.min(limit, hits.length)}):`);
        for (const h of hits.slice(0, limit)) log(`  ${h.label}:${h.line} [${h.needle}] ${h.snippet}`);
      }
    }
    return 0;
  }
  if (sub === 'show') {
    const id = opts._[0];
    const r = readRules(flow.paths.rules).find((x) => x.id === id || x.id === `R-${String(id).padStart(4, '0')}`);
    if (!r) {
      log(`Không thấy ${id}`);
      return 1;
    }
    log(readText(r.file));
    return 0;
  }
  log('rules: list | find [--path p] [--changed|--staged] [--tag t] [--text q] | new --title ... | show <id>');
  return 1;
}

export function cmdMemory(cwd, sub, opts) {
  const flow = openFlow(cwd);
  if (sub === 'new') {
    const m = createMemory(flow.paths.memory, { type: opts.type || 'project', name: opts.name, description: opts.desc || opts.description || '', body: opts.body || '' });
    writeIndexes(flow.paths);
    log(m.file);
    return 0;
  }
  const mems = readMemories(flow.paths.memory);
  const q = typeof opts.text === 'string' ? opts.text.toLowerCase() : '';
  const hits = q ? mems.filter((m) => `${m.name} ${m.description} ${readText(m.file)}`.toLowerCase().includes(q)) : mems;
  for (const m of hits) log(`${m.type.padEnd(9)} ${m.name} — ${truncate(m.description, 140)}  (${rel(flow.cwd, m.file)})`);
  if (!hits.length) log('Không có memory nào khớp.');
  return 0;
}

export function cmdReindex(cwd) {
  const flow = openFlow(cwd);
  for (const [k, n] of writeIndexes(flow.paths)) log(`${k}: ${n}`);
  return 0;
}

export function cmdPlan(cwd, sub, opts) {
  const flow = openFlow(cwd);
  if (sub === 'new') {
    const slug = opts._[0] || opts.slug;
    const tpl = readText(path.join(TEMPLATES, 'plan.md'));
    const p = createPlan(flow.paths.plans, { slug, title: opts.title || slug, branch: opts.branch || '', repos: list(opts.repos), template: tpl });
    writeIndexes(flow.paths);
    log(p.file);
    return 0;
  }
  if (sub === 'decisions') {
    const { plan, decisions } = planDecisions(flow.paths.plans, opts._[0]);
    const open = decisions.filter((d) => d.open && !d.placeholder);
    const tpl = decisions.filter((d) => d.open && d.placeholder);
    const done = decisions.filter((d) => !d.open);
    if (opts.json) {
      log(JSON.stringify({ plan: plan.slug, open, done }, null, 2));
      return 0;
    }
    if (!open.length) log(`✓ ${plan.slug}: không còn quyết định mở${tpl.length ? ` (còn dòng mẫu ${tpl.map((d) => d.id).join(', ')} — xoá đi)` : ''}.`);
    else {
      log(`${open.length} quyết định cần hỏi người dùng TRÊN CHAT (Claude Code: AskUserQuestion; CLI khác: dán khối dưới):\n`);
      for (const d of open) {
        const [q, rest = ''] = d.body.split(/\s+—\s+lựa chọn:\s*/);
        const [choices = '', impact = ''] = rest.split(/\s+—\s+ảnh hưởng:\s*/);
        log(`**${d.id} · ${q.trim()}**${impact ? ` — ảnh hưởng: ${impact.trim()}` : ''}`);
        choices
          .split(/\s+\/\s+/)
          .filter(Boolean)
          .forEach((c, i) => log(`  ${i + 1}. ${c.trim()}`));
        log(`  ${choices ? choices.split(/\s+\/\s+/).filter(Boolean).length + 1 : 1}. Khác: …\n`);
      }
      log(`Trả lời kiểu: "${open.map((d) => `${d.id}=1`).join(', ')}" → ghi: flowctl plan decide ${plan.slug} <Dn> "<lựa chọn>"`);
    }
    if (done.length) log(`\nĐã chốt: ${done.map((d) => `${d.id} ${d.body.replace(/^.*→ /, '→ ')}`).join(' · ')}`);
    return open.length ? 1 : 0;
  }
  if (sub === 'decide') {
    const [slug, id, ...answer] = opts._;
    const r = decidePlan(flow.paths.plans, slug, id, answer.join(' ') || opts.answer, opts.by || 'người dùng');
    writeIndexes(flow.paths);
    log(`${r.plan.slug} ${r.id} → ${r.answer}`);
    return 0;
  }
  if (sub === 'status') {
    const [slug, status] = opts._;
    const p = setPlanStatus(flow.paths.plans, slug, status, { force: !!opts.force });
    writeIndexes(flow.paths);
    log(`${p.slug}: ${p.status}${p.moved ? ` → ${rel(flow.cwd, p.file)}` : ''}`);
    return 0;
  }
  if (sub === 'show') {
    const p = findPlan(flow.paths.plans, opts._[0]);
    log(p.file);
    return 0;
  }
  const plans = readPlans(flow.paths.plans).filter((p) => (opts.all ? true : p.bucket === 'active'));
  if (!plans.length) log(opts.all ? 'Chưa có plan nào.' : 'Không có plan đang mở.');
  else log(table(plans.map((p) => [p.status, p.slug, truncate(p.title, 50), p.branch, p.updated]), ['status', 'slug', 'title', 'branch', 'updated']));
  return 0;
}

function moduleReport(flow, items) {
  const mods = new Map();
  for (const it of items) {
    if (!it.repo || !isCodeFile(it.file)) continue;
    const m = moduleOf(flow, it.repo, it.file);
    const cur = mods.get(m.rel) || { ...m, files: [] };
    cur.files.push(it.file);
    mods.set(m.rel, cur);
  }
  return [...mods.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

function contextFilesOf(flow, repo) {
  const name = flow.profile.layout.moduleContext;
  const a = git(repo.dir, ['ls-files', '--', `*${name}`, name]).out.split('\n');
  const b = git(repo.dir, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', `*${name}`, name]).out.split('\n');
  const c = git(repo.dir, ['ls-files', '--others', '--exclude-standard', '--', `*${name}`, name]).out.split('\n');
  return [...new Set([...a, ...b, ...c])]
    .filter(Boolean)
    .filter((f) => path.basename(f) === name && !/(^|\/)(node_modules|vendor|dist|build)\//.test(f));
}

export function cmdContext(cwd, sub, opts) {
  const flow = openFlow(cwd);
  if (sub === 'missing' || sub === 'for') {
    const items = targetFiles(flow, { ...opts, changed: opts.changed || (!opts.path && !opts.staged && !opts.base) });
    const mods = moduleReport(flow, items);
    if (!mods.length) {
      log('Không có tệp mã nào trong phạm vi.');
      return 0;
    }
    let missing = 0;
    for (const m of mods) {
      if (!m.hasContext) missing++;
      log(`${m.hasContext ? '✓' : '✗'} ${m.rel}  (${m.files.length} tệp${m.source === 'repo' ? ', module = cả repo — cân nhắc khai `modules` trong profile' : ''})${m.hasContext ? `  → ${rel(flow.cwd, m.contextFile)}` : '  → CHƯA CÓ ngữ cảnh: `flowctl context new ' + rel(flow.cwd, m.dir) + '`'}`);
    }
    if (missing) log(`\n${missing} module chưa có ${flow.profile.layout.moduleContext}. Sinh trong phiên này (skill flow-context), đừng để sau.`);
    return missing && opts.strict ? 1 : 0;
  }
  if (sub === 'new') {
    const dir = path.resolve(flow.cwd, opts._[0] || '.');
    if (!isDir(dir)) {
      log(`Không phải thư mục: ${dir}`);
      return 1;
    }
    ensureExcludes(flow);
    const file = path.join(dir, flow.profile.layout.moduleContext);
    if (exists(file)) {
      log(`Đã có ${file} — cập nhật nó thay vì sinh mới.`);
      return 1;
    }
    const repoRoot = gitRoot(dir);
    const commit = repoRoot ? `${currentBranch(repoRoot) || 'HEAD'}@${(headCommit(repoRoot) || '').slice(0, 9)}` : '-';
    writeText(file, fill(readText(path.join(TEMPLATES, 'CONTEXT.md')), { module: rel(flow.root, dir), date: today(), commit }));
    writeCoverage(flow);
    const ig = repoRoot ? git(repoRoot, ['check-ignore', '-q', file]).status === 0 : true;
    log(file);
    if (!flow.profile.trackHarness && !ig) {
      log('⚠️ Tệp này CHƯA bị git bỏ qua — chạy `flowctl exclude` rồi kiểm lại trước khi làm gì khác.');
      return 1;
    }
    return 0;
  }
  if (sub === 'coverage') {
    const r = writeCoverage(flow);
    log(`${r.covered}/${r.total} module có ngữ cảnh · ${r.stale} nghi cũ → ${rel(flow.cwd, r.file)}`);
    return 0;
  }
  if (sub === 'consumed' || sub === 'ref') {
    const name = opts._[0];
    if (!name) {
      log(sub === 'consumed' ? 'context consumed <service> — bối cảnh TIÊU THỤ một service ngoài phạm vi sửa (identity, media, cổng thanh toán…)' : 'context ref <slug> [--title "…"] — tài liệu chuẩn / quy ước / sổ phân loại dùng chung');
      return 1;
    }
    const dir = sub === 'consumed' ? flow.paths.consumed : flow.paths.reference;
    const file = path.join(dir, `${slugify(name, 60)}.md`);
    if (exists(file)) {
      log(`Đã có ${file} — cập nhật nó.`);
      return 1;
    }
    const tpl = readText(path.join(TEMPLATES, sub === 'consumed' ? 'consumed.md' : 'reference.md'));
    writeText(file, fill(tpl, { name, title: typeof opts.title === 'string' ? opts.title : name, date: today() }));
    log(file);
    return 0;
  }
  if (sub === 'stale' || sub === 'list') {
    const rows = [];
    const staleDays = Number(flow.profile.context.staleDays) || 30;
    const maxLines = Number(flow.profile.context.maxLines) || 400;
    for (const repo of scopeRepos(flow, { all: true })) {
      for (const f of contextFilesOf(flow, repo)) {
        const abs = path.join(repo.dir, f);
        const st = fs.statSync(abs);
        const dir = path.dirname(f) || '.';
        const since = st.mtime.toISOString();
        const commits = git(repo.dir, ['log', `--since=${since}`, '--format=%h', '--', dir, `:(exclude)${f}`]).out.split('\n').filter(Boolean).length;
        const age = Math.floor((Date.now() - st.mtimeMs) / 86400000);
        const lines = lineCount(readText(abs));
        const flags = [];
        if (commits > 0) flags.push(`${commits} commit sau lần cập nhật`);
        if (age > staleDays) flags.push(`${age} ngày`);
        if (lines > maxLines) flags.push(`${lines} dòng > ${maxLines}`);
        if (sub === 'list' || flags.length) rows.push([flags.length ? '!' : '✓', rel(flow.root, abs), age, commits, lines, flags.join(' · ')]);
      }
    }
    if (!rows.length) log(sub === 'list' ? 'Chưa có tệp ngữ cảnh module nào.' : 'Không có ngữ cảnh nào cũ.');
    else log(table(rows, ['', 'tệp', 'ngày', 'commit sau', 'dòng', 'lý do']));
    return 0;
  }
  log('context: missing [--changed|--staged|--path p] [--strict] | new <dir> | coverage | stale | list | consumed <service> | ref <slug>');
  return 1;
}

export function cmdGates(cwd, opts) {
  const flow = openFlow(cwd);
  const files = bothForms(flow, targetFiles(flow, opts));
  const gates = listFiles(flow.paths.gates, (n) => n.endsWith('.md')).map((file) => {
    const text = readText(file);
    const { data, body } = parseFrontmatter(text);
    const when = Array.isArray(data.when) ? data.when : data.when ? [data.when] : [];
    return { file, name: data.name || path.basename(file, '.md'), title: data.title || '', when, body, tags: data.tags || [] };
  });
  const tags = list(opts.tag);
  const hits = gates.filter(
    (g) => opts.all || (!g.when.length && !files.length) || files.some((f) => matchAny(g.when, f, { nocase: true })) || (tags.length && [].concat(g.tags).some((t) => tags.includes(t))),
  );
  if (!gates.length) {
    log('Repo chưa có gate tuỳ chọn nào (.flow/gates/). Preset: `flowctl init --force --gates ui-change,event-contract,...`');
    return 0;
  }
  if (!hits.length) {
    log(`Không gate nào khớp (${gates.length} gate có sẵn: ${gates.map((g) => g.name).join(', ')}).`);
    return 0;
  }
  const phase = typeof opts.print === 'string' ? opts.print.toLowerCase() : opts.print ? 'all' : '';
  for (const g of hits) {
    log(`▶ ${g.name} — ${g.title}  (${rel(flow.cwd, g.file)})`);
    if (!phase) continue;
    if (phase === 'all') {
      log(g.body.trim());
    } else {
      const m = new RegExp(`^## ${phase}\\s*$([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'im').exec(g.body);
      const intro = g.body.split(/^## /m)[0].trim();
      if (intro) log(intro);
      log(m ? m[1].trim() : `(gate này không có mục ## ${phase})`);
    }
    log('');
  }
  return 0;
}

export function cmdCheck(cwd, opts) {
  const flow = openFlow(cwd);
  const p = flow.profile;
  const staged = !!opts.staged;
  let problems = 0;
  const leakPatterns = [...defaultLeakPatterns(p), ...(p.hygiene.leakPatterns || [])];
  const hp = harnessPatterns(flow).map((s) => new RegExp(s));
  for (const repo of scopeRepos(flow, { all: !!opts.all })) {
    const lines = addedLines(repo.dir, { staged, base: opts.base || '' });
    const files = changedFiles(repo.dir, { staged, base: opts.base || '' });
    const out = [];
    if (p.hygiene.comments !== 'off') {
      const code = lines.filter((l) => isCodeFile(l.file) && !hp.some((r) => r.test(l.file)));
      for (const h of findComments(code, { exempt: p.hygiene.commentExempt })) out.push(`  chú thích  ${h.file}:${h.line}  ${truncate(h.text, 120)}`);
    }
    const leakScope = lines.filter((l) => !hp.some((r) => r.test(l.file)) && !/(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/.test(l.file));
    for (const h of findLeaks(leakScope, leakPatterns)) out.push(`  lộ harness ${h.file}:${h.line}  ${truncate(h.text, 120)}`);
    if (!p.trackHarness) {
      for (const f of files) if (hp.some((r) => r.test(f))) out.push(`  tệp harness sắp vào git: ${f}`);
    }
    for (const c of p.hygiene.customChecks || []) {
      const item = typeof c === 'string' ? { run: c } : c;
      if (item.repo && item.repo !== repo.path && item.repo !== repo.name) continue;
      const cmd = item.run.replace('{mode}', staged ? '--staged' : '');
      const r = run(cmd, repo.dir);
      if (r.status !== 0) out.push(`  custom     \`${cmd}\` exit ${r.status}\n${r.out.trim().split('\n').slice(-15).map((x) => `             ${x}`).join('\n')}`);
    }
    log(`${out.length ? '✗' : '✓'} ${repo.name}  (${staged ? 'staged' : 'working tree'} · ${files.length} tệp · ${lines.length} dòng thêm)`);
    out.forEach((o) => log(o));
    problems += out.length;
  }
  if (p.hygiene.secrets !== 'off') {
    let secretTotal = 0;
    let piiTotal = 0;
    for (const repo of scopeRepos(flow, { all: !!opts.all })) {
      const r = runSecretsCheck(flow, repo, { staged, base: opts.base || '' });
      if (r.secrets.length || r.pii.length) {
        log(`${r.secrets.length ? '✗' : '⚠️'} Bí mật / thông tin cá nhân · ${repo.name}`);
        checkLines([...r.secrets, ...r.pii], repo).forEach((x) => log(x));
      }
      secretTotal += r.secrets.length;
      piiTotal += r.pii.length;
    }
    if (!secretTotal && !piiTotal) log('✓ Bí mật / thông tin cá nhân');
    else log('  ⇒ Secret thật: báo người dùng, xoay khoá trước (skill flow-secrets). Dương tính giả: flowctl secrets allow <#mã> --reason "đã mở ra xem: …".');
    problems += secretTotal;
    if (p.hygiene.pii === 'block') problems += piiTotal;
  }
  if (p.hygiene.naming !== 'off' && (p.language?.code || 'en') === 'en') {
    let namingProblems = 0;
    for (const repo of scopeRepos(flow, { all: !!opts.all })) {
      const out = runNamingCheck(repo, { staged, base: opts.base || '' });
      if (out.length) {
        log(`✗ Tiếng Anh trong mã · ${repo.name}`);
        out.forEach((o) => log(o));
      }
      namingProblems += out.length;
    }
    if (!namingProblems) log('✓ Tiếng Anh trong mã (tên mới · tên tệp mới · thông điệp lỗi / log)');
    else log('  ⇒ Mã (biến, hàm, kiểu, tệp, message lỗi, log): tiếng Anh. Tiếng Việt có dấu chỉ ở tài liệu, chuỗi giao diện qua i18n, tên ca test. Mã nghiệp vụ không dịch (enum DB) giữ nguyên CHUỖI, không làm tên biến.');
    if (p.hygiene.naming === 'block') problems += namingProblems;
  }
  if (p.hygiene.dup !== 'off') {
    const r = runDupCheck(flow, { staged, base: opts.base || '', all: !!opts.all });
    const blocks = r.findings.filter((f) => f.level === 'block').length;
    log(`${blocks ? '✗' : '✓'} DRY  (${r.funcs} hàm quét · ${blocks} bản trùng mới · ${r.findings.length - blocks} cảnh báo${r.baseline ? '' : ' · CHƯA có baseline'})`);
    printDupFindings(r.findings).forEach((l) => log(l));
    if (p.hygiene.dup === 'block') problems += blocks;
  }
  if (p.hygiene.comments === 'unit') log('\nCòn vế MẮT: đọc `git diff --cached -U20` — mọi hàm/khai báo bị chạm phải sạch chú thích cũ (lệnh chỉ thấy dòng thêm).');
  if (p.hygiene.comments === 'file') log('\nCòn vế MẮT: tệp nào bị chạm phải sạch chú thích CẢ TỆP (kể cả dòng cũ).');
  if (problems) log(`\n${problems} vấn đề. Chỉ dẫn máy đọc (go:build, eslint-disable, @ts-expect-error, goose…) thì giữ; còn lại sửa.`);
  return problems ? 1 : 0;
}

export function cmdCommitMsg(cwd, opts) {
  const flow = openFlow(cwd);
  const text = typeof opts.message === 'string' ? opts.message : readText(path.resolve(cwd, opts._[0] || '.git/COMMIT_EDITMSG'));
  if (text === null) {
    log('Không đọc được thông điệp commit.');
    return 1;
  }
  const cc = flow.profile.commit || {};
  const problems = checkCommitMessage(text, cc.body || flow.profile.hygiene.commitBody);
  if (cc.signoff && !/^Signed-off-by: /m.test(text)) problems.push('Đội ký DCO — thêm trailer `Signed-off-by: Tên <email>` (git commit -s).');
  const title = (String(text).replace(/\r\n/g, '\n').split('\n').find((l) => l.trim() && !l.startsWith('#')) || '').trim();
  if (title) problems.push(...commitTitleProblems(title, cc));
  problems.push(...textProblems(text, 'commit'));
  const leaks = findLeaks(text.split('\n').map((t, i) => ({ file: 'commit', line: i + 1, text: t })), [...defaultLeakPatterns(flow.profile), ...(flow.profile.hygiene.leakPatterns || [])]);
  leaks.forEach((l) => problems.push(`Dòng ${l.line} nhắc harness: "${truncate(l.text, 80)}"`));
  if (!problems.length) {
    log('✓ Thông điệp commit hợp lệ.');
    return 0;
  }
  problems.forEach((x) => log(`✗ ${x}`));
  return 1;
}

export function cmdVerify(cwd, opts) {
  const flow = openFlow(cwd);
  const entries = flow.profile.verify || [];
  if (!entries.length) {
    log('profile.json chưa khai `verify`. Thêm lệnh kiểm chứng của từng stack trước.');
    return 1;
  }
  const repos = scopeRepos(flow, { all: !!opts.all });
  const plan = [];
  for (const repo of repos) {
    const changed = opts.full ? null : changedFiles(repo.dir, { staged: !!opts.staged, base: opts.base || '' });
    for (const e of entries) {
      if (e.repo && e.repo !== repo.path && e.repo !== repo.name) continue;
      if (!e.repo && flow.profile.mode === 'workspace' && repos.length > 1 && path.resolve(repo.dir) !== path.resolve(flow.root)) continue;
      if (e.optional && !opts.full && !list(opts.only).includes(e.name)) continue;
      if (list(opts.only).length && !list(opts.only).includes(e.name)) continue;
      if (changed && e.when && e.when.length && !changed.some((f) => matchAny(e.when, f))) continue;
      plan.push({ ...e, repo });
    }
  }
  if (!plan.length) {
    log('Không lệnh verify nào khớp thay đổi hiện tại. `--full` để chạy tất cả.');
    return 0;
  }
  if (opts.dry) {
    log(table(plan.map((x) => [x.repo.name, x.name, x.cwd || '.', x.run]), ['repo', 'name', 'cwd', 'run']));
    return 0;
  }
  fs.mkdirSync(flow.paths.runs, { recursive: true });
  const logFile = path.join(flow.paths.runs, `verify-${stamp()}.log`);
  const rows = [];
  let failed = 0;
  let skipped = 0;
  for (const x of plan) {
    const dir = path.resolve(x.repo.dir, x.cwd || '.');
    const missing = !isDir(dir) ? `${x.cwd} chưa tồn tại` : x.requires && !requirementMet(dir, x.requires) ? `chưa có ${x.requires} trong ${x.cwd || '.'}` : '';
    if (missing) {
      skipped++;
      fs.appendFileSync(logFile, `\n===== ${x.repo.name} · ${x.name} · BỎ QUA: ${missing}\n`);
      rows.push(['⏭', x.repo.name, x.name, '-', `bỏ qua: ${missing}`]);
      continue;
    }
    const t0 = Date.now();
    const r = run(x.run, dir);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const empty = !r.out.trim();
    const ok = r.status === 0 && (!x.expectEmpty || empty);
    if (!ok) failed++;
    fs.appendFileSync(logFile, `\n===== ${x.repo.name} · ${x.name} · ${x.run} · exit ${r.status} · ${secs}s\n${r.out}\n`);
    rows.push([ok ? '✓' : '✗', x.repo.name, x.name, `${secs}s`, ok ? '' : truncate(r.out.trim().split('\n').slice(-1)[0] || `exit ${r.status}`, 80)]);
  }
  log(table(rows, ['', 'repo', 'check', 'time', 'lỗi cuối']));
  if (skipped) log(`\n${skipped} lệnh BỊ BỎ QUA vì chưa có mã/manifest — đó không phải "xanh". Ghi rõ trong báo cáo post.`);
  log(`\nLog đầy đủ: ${logFile}`);
  return failed ? 1 : 0;
}

function requirementMet(dir, pattern) {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
  try {
    return fs.readdirSync(dir).some((n) => re.test(n));
  } catch {
    return false;
  }
}

export function cmdSync(cwd, opts) {
  const flow = openFlow(cwd);
  const state = JSON.parse(readText(flow.paths.state) || '{"repos":{}}');
  state.repos = state.repos || {};
  const rules = readRules(flow.paths.rules);
  for (const repo of scopeRepos(flow, { all: true })) {
    const key = toPosix(path.relative(flow.root, repo.dir)) || '.';
    const head = headCommit(repo.dir);
    const last = state.repos[key]?.commit;
    if (opts.mark) {
      state.repos[key] = { commit: head, at: new Date().toISOString(), branch: currentBranch(repo.dir) };
      log(`✓ ${repo.name}: mốc = ${(head || '').slice(0, 9)}`);
      continue;
    }
    if (!last) {
      log(`○ ${repo.name}: chưa có mốc đồng bộ — đọc ngữ cảnh hiện có, kiểm nó với mã, rồi \`flowctl sync --mark\`.`);
      continue;
    }
    if (last === head) {
      log(`✓ ${repo.name}: ngữ cảnh đã khớp HEAD ${(head || '').slice(0, 9)}`);
      continue;
    }
    const known = git(repo.dir, ['cat-file', '-e', `${last}^{commit}`]).ok;
    if (!known) {
      log(`⚠️ ${repo.name}: mốc ${last.slice(0, 9)} không còn trong lịch sử (rebase/force-push?) — đồng bộ lại toàn bộ module đang dùng.`);
      continue;
    }
    const count = git(repo.dir, ['rev-list', '--count', `${last}..HEAD`]).out.trim();
    const files = git(repo.dir, ['diff', '--name-only', `${last}`, 'HEAD']).out.split('\n').filter(Boolean);
    const items = files.map((f) => ({ repo, file: f, abs: path.join(repo.dir, f) }));
    const mods = moduleReport(flow, items);
    log(`△ ${repo.name}: ${count} commit · ${files.length} tệp đổi kể từ ${last.slice(0, 9)}`);
    for (const m of mods) log(`    ${m.hasContext ? 'cập nhật' : 'THIẾU   '} ${m.rel} (${m.files.length} tệp)`);
    const hit = findRules(rules, { files: bothForms(flow, items), includeGlobal: false });
    if (hit.length) log(`    luật cần soát lại: ${hit.map((r) => r.id).join(', ')}`);
  }
  if (opts.mark) writeText(flow.paths.state, `${JSON.stringify(state, null, 2)}\n`);
  return 0;
}

export function cmdDoctor(cwd) {
  const flow = openFlow(cwd);
  const p = flow.profile;
  const issues = [];
  const warn = [];
  for (const r of verifyExcludes(flow)) {
    for (const x of r.ignored) if (!x.ignored) issues.push(`${r.repo}: "${x.probe}" chưa bị git bỏ qua → \`flowctl exclude\``);
    if (r.tracked.length) warn.push(`${r.repo}: ${r.tracked.length} tệp harness đang được track (${r.tracked.slice(0, 3).join(', ')}…)`);
  }
  if (!exists(flow.paths.project)) issues.push(`thiếu ${rel(flow.root, flow.paths.project)}`);
  else if (/<[^>\n]{3,80}>/.test(readText(flow.paths.project) || '') && /<vai trò>|<1–3 câu/.test(readText(flow.paths.project))) warn.push('PROJECT.md còn mục <...> chưa điền');
  const pj = loadOnboarding(flow).decisions.filter((d) => d.answer === null);
  if (pj.length) warn.push(`${pj.length} điều cần chốt khi vào dự án chưa được hỏi — flowctl onboard`);
  if (!(p.verify || []).length) warn.push('profile.verify trống — flow-post sẽ không có lệnh kiểm chứng');
  const rules = readRules(flow.paths.rules);
  for (const r of rules) {
    if (r.lines > (p.context.maxRuleLines || 60)) warn.push(`${r.id} dài ${r.lines} dòng — tách hoặc rút gọn`);
    if (/<một câu khẳng định|<hậu quả cụ thể/.test(r.body)) warn.push(`${r.id} còn khung chưa điền`);
  }
  const ids = rules.map((r) => r.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) issues.push(`trùng id luật: ${[...new Set(dup)].join(', ')}`);
  for (const m of readMemories(flow.paths.memory)) if (m.lines > (p.context.maxMemoryLines || 120)) warn.push(`memory ${m.name} dài ${m.lines} dòng — một memory một ý`);
  const idxRules = readText(path.join(flow.paths.rules, 'INDEX.md')) || '';
  const idxCount = (idxRules.match(/^\| \[R-\d{4}\]/gm) || []).length;
  if (idxCount !== rules.length) issues.push(`rules/INDEX.md lệch (${idxCount} dòng vs ${rules.length} tệp) → \`flowctl reindex\``);
  for (const pl of readPlans(flow.paths.plans)) {
    if (pl.bucket === 'active' && ['DONE', 'ABANDONED'].includes(pl.status)) warn.push(`plan ${pl.slug} ${pl.status} nhưng còn ở active/`);
    if (pl.bucket === 'shipped' && !['DONE', 'ABANDONED'].includes(pl.status)) issues.push(`plan ${pl.slug} ${pl.status} nhưng nằm ở shipped/ — chôn một plan còn sống`);
    const openD = parseDecisions(readText(pl.file)).filter((d) => d.open && !d.placeholder);
    if (openD.length && ['APPROVED', 'EXECUTING', 'VERIFYING'].includes(pl.status)) issues.push(`plan ${pl.slug} ${pl.status} nhưng còn quyết định mở ${openD.map((d) => d.id).join(', ')} — hỏi người dùng trên chat`);
    else if (openD.length) warn.push(`plan ${pl.slug}: ${openD.length} quyết định chờ hỏi trên chat (\`flowctl plan decisions ${pl.slug}\`)`);
  }
  for (const l of flow.paths.legacy) {
    if (!exists(l.file)) issues.push(`legacy không tồn tại: ${l.file}`);
    else {
      const size = fs.statSync(l.file).size;
      if (size > 200 * 1024) warn.push(`legacy ${path.basename(l.file)} ${(size / 1024).toFixed(0)}KB — quá lớn để agent đọc trọn; tách dần sang .flow/rules`);
    }
  }
  const maxLines = p.context.maxLines || 400;
  for (const repo of discoverRepos(flow)) {
    for (const f of contextFilesOf(flow, repo)) {
      const n = lineCount(readText(path.join(repo.dir, f)));
      if (n > maxLines) warn.push(`${repo.name}/${f} ${n} dòng > ${maxLines} — dời lịch sử sang ${p.layout.moduleContext.replace(/\.md$/, '')}.history.md`);
    }
  }
  for (const v of p.verify || []) if (v.repo && !discoverRepos(flow).some((r) => r.path === v.repo || r.name === v.repo)) issues.push(`verify "${v.name}" trỏ tới repo không tồn tại: ${v.repo}`);
  issues.forEach((x) => log(`✗ ${x}`));
  warn.slice(0, 40).forEach((x) => log(`⚠️ ${x}`));
  if (warn.length > 40) log(`⚠️ … và ${warn.length - 40} cảnh báo nữa`);
  if (!issues.length && !warn.length) log('✓ agent-flow khoẻ.');
  else log(`\n${issues.length} lỗi · ${warn.length} cảnh báo`);
  return issues.length ? 1 : 0;
}

function splitShell(cmd) {
  return cmd
    .split(/&&|\|\||;|\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function decideBash(command, { protectedBranches, currentBranchOf }) {
  const isProt = (b) => protectedBranches.some((p) => (p.includes('*') ? globToRegExp(`/${p}`).test(b) : p === b));
  for (const seg of splitShell(command)) {
    const toks = seg.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const words = toks.map((t) => t.replace(/^["']|["']$/g, ''));
    const gi = words.indexOf('git');
    if (gi >= 0) {
      let i = gi + 1;
      let dir = '';
      while (i < words.length && words[i].startsWith('-')) {
        if (words[i] === '-C') {
          dir = words[i + 1];
          i += 2;
        } else i++;
      }
      if (words[i] === 'push') {
        const args = words.slice(i + 1);
        const pos = args.filter((a) => !a.startsWith('-'));
        if (args.some((a) => a === '--delete' || a === '-d')) {
          const target = pos.slice(1).find((b) => isProt(b));
          if (target) return `Xoá nhánh được bảo vệ "${target}" bị chặn.`;
        }
        const refs = pos.slice(1);
        for (const r of refs) {
          const dst = r.includes(':') ? r.split(':').pop() : r;
          const name = dst.replace(/^\+/, '').replace(/^refs\/heads\//, '');
          if (isProt(name)) return `Push lên nhánh được bảo vệ "${name}" bị chặn — chỉ chủ dự án tự làm.`;
        }
        if (!refs.length && !args.includes('--tags')) {
          const cur = currentBranchOf(dir);
          if (cur && isProt(cur)) return `Đang đứng trên nhánh được bảo vệ "${cur}" — \`git push\` không refspec sẽ ghi lên nó.`;
        }
      }
    }
    const ghi = words.indexOf('gh');
    const gli = words.indexOf('glab');
    const ci = ghi >= 0 ? ghi : gli;
    if (ci >= 0) {
      const rest = words.slice(ci + 1);
      const isCreate = (rest[0] === 'pr' || rest[0] === 'mr') && (rest[1] === 'create' || rest[1] === 'edit');
      if (isCreate) {
        for (const flag of ['--base', '-B', '--target-branch', '-b']) {
          const k = rest.indexOf(flag);
          if (k >= 0 && isProt(rest[k + 1])) return `Mở/sửa PR/MR nhắm "${rest[k + 1]}" (nhánh được bảo vệ) bị chặn.`;
        }
        const eq = rest.find((a) => /^--(base|target-branch)=/.test(a));
        if (eq && isProt(eq.split('=')[1])) return `Mở/sửa PR/MR nhắm "${eq.split('=')[1]}" (nhánh được bảo vệ) bị chặn.`;
      }
    }
  }
  return null;
}

export async function cmdHook(cwd, sub) {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  if (sub === 'session') {
    try {
      const input = JSON.parse(raw || '{}');
      const text = sessionContext(input.cwd || cwd);
      if (text) process.stdout.write(`${text}\n`);
    } catch {
      return 0;
    }
    return 0;
  }
  try {
    const input = JSON.parse(raw || '{}');
    const tool = input.tool_name || input.toolName || '';
    if (tool === 'Read') return guardRead(input, cwd);
    if (/^(Edit|Write|MultiEdit)$/.test(tool)) return guardSecretEdit(input, cwd) || guardEdit(input, cwd);
    const command = input.tool_input?.command || input.toolInput?.command || '';
    if (!command || !/^(Bash|PowerShell|shell|run_shell_command|exec_command)$/i.test(tool)) return 0;
    const base = input.cwd || cwd;
    const flow = openFlow(base, { required: false });
    if (flow && flow.profile.hygiene.secrets !== 'off') {
      const secretReason = decideSecretCommand(command);
      if (secretReason) {
        process.stderr.write(`agent-flow: ${secretReason}\n`);
        return 2;
      }
    }
    const protectedBranches = flow ? [...new Set([...(flow.profile.branches.protected || []), ...(flow.profile.branches.ownerOnly || [])])] : [];
    if (!protectedBranches.length) return 0;
    const reason = decideBash(command, { protectedBranches, currentBranchOf: (d) => currentBranch(path.resolve(base, d || '.')) });
    if (!reason) return 0;
    process.stderr.write(`agent-flow: ${reason} Dừng lại và báo người dùng; không viết lại lệnh để đi vòng.\n`);
    return 2;
  } catch {
    return 0;
  }
}

function dupPaths(flow) {
  const dir = path.join(flow.paths.flowDir, 'dup');
  return { dir, baseline: path.join(dir, 'baseline.json'), allow: path.join(dir, 'allow.json') };
}

function dupRepos(flow, opts) {
  return flow.profile.mode === 'workspace' || opts.all ? discoverRepos(flow) : scopeRepos(flow, { all: false });
}

function fnLoc(f) {
  return `${f.repo}/${f.file}:${f.line}`;
}

export function writeDupBaseline(flow, { refresh = false } = {}) {
  const p = dupPaths(flow);
  if (exists(p.baseline) && !refresh) return { skipped: true, file: p.baseline };
  const funcs = discoverRepos(flow).flatMap((r) => scanRepo(r));
  const clusters = clusterize(funcs);
  writeText(p.baseline, `${JSON.stringify(baselineOf(clusters), null, 1)}\n`);
  return { file: p.baseline, clusters: clusters.length, funcs: funcs.length };
}

export function runDupCheck(flow, opts = {}) {
  const repos = dupRepos(flow, opts);
  const funcs = repos.flatMap((r) => scanRepo(r));
  const clusters = clusterize(funcs);
  const changed = [];
  for (const r of scopeRepos(flow, { all: !!opts.all || flow.profile.mode === 'workspace' })) {
    for (const f of changedFiles(r.dir, { staged: !!opts.staged, base: opts.base || '' })) changed.push(`${r.name}/${toPosix(f)}`);
  }
  const p = dupPaths(flow);
  const baseline = loadBaseline(p.baseline);
  const allow = loadBaseline(p.allow) || {};
  const findings = checkChanged({ funcs, clusters, changed, baseline, allow, canonical: flow.profile.canonical || {} });
  return { findings, baseline: !!baseline, funcs: funcs.length, changed: changed.length };
}

export function printDupFindings(findings) {
  const lines = [];
  for (const f of findings) {
    if (f.kind === 'new' || f.kind === 'grew') {
      const c = f.cluster;
      lines.push(`  ${f.level === 'block' ? '✗' : '⚠️'} trùng ${c.kind === 'exact' ? 'Y HỆT' : 'CÙNG CẤU TRÚC (đổi tên biến)'} · ${c.tokens} token · ${c.files} tệp${f.kind === 'grew' ? ' (cụm cũ vừa thêm bản)' : ''} — key ${c.key}`);
      for (const t of f.touched) lines.push(`      mới/sửa: \`${t.name}\` ${fnLoc(t)}`);
      for (const o of f.others.slice(0, 5)) lines.push(`      đã có:   \`${o.name}\` ${fnLoc(o)}`);
      lines.push('      ⇒ dùng / mở rộng bản đã có (hoặc trích ra chỗ dùng chung). Thật sự phải tách? `flowctl dup allow <key> --reason "…"`');
    } else if (f.kind === 'canonical') {
      lines.push(`  ✗ \`${f.fn.name}\` ${fnLoc(f.fn)} — đã có NGUỒN CHUẨN ${f.canonical} (profile.canonical): import nó, đừng định nghĩa lại`);
    } else if (f.kind === 'same-name') {
      lines.push(`  ⚠️ \`${f.fn.name}\` ${fnLoc(f.fn)} — cùng tên đã có ở: ${f.others.map(fnLoc).join(' · ')} — kiểm xem có phải viết lại không`);
    }
  }
  return lines;
}

export function cmdDup(cwd, sub, opts) {
  if (sub === 'report') {
    let repos;
    if (typeof opts.path === 'string') {
      const dir = path.resolve(cwd, opts.path);
      repos = [{ name: path.basename(dir), dir }];
    } else {
      const flow = openFlow(cwd);
      repos = opts.all || flow.profile.mode === 'workspace' ? discoverRepos(flow) : scopeRepos(flow);
    }
    const funcs = repos.flatMap((r) => scanRepo(r));
    const clusters = clusterize(funcs);
    const intra = clusters.filter((c) => c.repos === 1);
    const extra = clusters.reduce((s, c) => s + c.list.length - 1, 0);
    log(`${repos.length} repo · ${funcs.length} hàm · ${clusters.length} cụm trùng (${intra.length} trong cùng repo, ${clusters.length - intra.length} xuyên repo) · ~${extra} bản thừa`);
    const limit = opts.limit !== undefined ? Number(opts.limit) : 20;
    for (const c of clusters.slice(0, limit)) {
      log(`\n${c.list.length} bản · ${c.files} tệp · ${c.tokens} token · ${c.kind === 'exact' ? 'y hệt' : 'đổi tên biến'}`);
      for (const f of c.list.slice(0, 6)) log(`  \`${f.name}\` ${fnLoc(f)}`);
    }
    return 0;
  }
  const flow = openFlow(cwd);
  const p = dupPaths(flow);
  if (sub === 'baseline') {
    const r = writeDupBaseline(flow, { refresh: !!opts.refresh });
    if (r.skipped) {
      log(`Đã có baseline (${r.file}). Baseline chỉ nên THU NHỎ khi nợ được trả; ghi lại toàn bộ: --refresh.`);
      return 1;
    }
    log(`✓ baseline: ${r.clusters} cụm trùng hiện có (${r.funcs} hàm) → ${rel(flow.cwd, r.file)}. Từ giờ chỉ chặn bản trùng MỚI.`);
    return 0;
  }
  if (sub === 'allow') {
    const key = opts._[0];
    if (!key || typeof opts.reason !== 'string') {
      log('dup allow <key> --reason "<vì sao phải giữ hai bản>"');
      return 1;
    }
    const allow = loadBaseline(p.allow) || {};
    allow[key] = { reason: opts.reason, at: today() };
    writeText(p.allow, `${JSON.stringify(allow, null, 1)}\n`);
    log(`✓ cho phép ${key}: ${opts.reason}`);
    return 0;
  }
  if (sub === 'find') {
    const q = opts._.join(' ');
    if (!q) {
      log('dup find <ý đồ, ví dụ "format date" | "normalize phone" | "submit lock">');
      return 1;
    }
    const funcs = dupRepos(flow, opts).flatMap((r) => scanRepo(r));
    const hits = searchFuncs(funcs, q).slice(0, Number(opts.limit) || 15);
    if (!hits.length) log(`Không thấy hàm nào khớp "${q}" (${funcs.length} hàm đã quét). Thử từ đồng nghĩa hoặc tên API cốt lõi.`);
    for (const h of hits) log(`  ${h.score.toFixed(1)}  \`${h.name}\` ${fnLoc(h)}  (${h.tokens} token${h.calls.length ? ` · gọi ${h.calls.slice(0, 5).join(', ')}` : ''})`);
    return 0;
  }
  if (sub === 'check' || !sub) {
    const r = runDupCheck(flow, opts);
    if (!r.baseline) log('⚠️ chưa có baseline — mọi cụm chạm tệp đổi đều bị báo. Chạy `flowctl dup baseline` một lần.');
    const lines = printDupFindings(r.findings);
    const blocks = r.findings.filter((f) => f.level === 'block').length;
    log(`${blocks ? '✗' : '✓'} dup: ${r.changed} tệp đổi · ${r.funcs} hàm quét · ${blocks} chặn · ${r.findings.length - blocks} cảnh báo`);
    lines.forEach((l) => log(l));
    return blocks && flow.profile.hygiene.dup !== 'warn' ? 1 : 0;
  }
  log('dup: find <ý đồ> | check [--staged|--base ref] | baseline [--refresh] | report [--path dir] [--limit n] | allow <key> --reason "…"');
  return 1;
}

export function cmdTask(cwd, sub, opts) {
  const flow = openFlow(cwd);
  const slug = opts._[0];
  if (!slug) {
    log('task: list|next <slug> | done <slug> <Tn> [--commit sha] | add <slug> "<việc — tệp — test đỏ trước — tái dùng>" | note <slug> "<…>" [--kind helper|friction|decision|note]');
    return 1;
  }
  if (sub === 'done') {
    let commit = typeof opts.commit === 'string' ? opts.commit : '';
    if (!commit) {
      const top = gitRoot(flow.cwd);
      if (top) commit = `${path.basename(top)}@${(headCommit(top) || '').slice(0, 9)}`;
    }
    const r = doneTask(flow.paths.plans, slug, opts._[1], commit);
    writeIndexes(flow.paths);
    log(`✓ ${r.plan.slug} ${r.id}${r.commit ? ` · ${r.commit}` : ''}`);
    return cmdTask(cwd, 'next', { _: [slug] });
  }
  if (sub === 'add') {
    const r = addTask(flow.paths.plans, slug, opts._.slice(1).join(' '));
    log(`+ ${r.plan.slug} ${r.id}`);
    return 0;
  }
  if (sub === 'note') {
    const kind = typeof opts.kind === 'string' ? opts.kind : 'note';
    const r = noteLedger(flow.paths.plans, slug, kind, opts._.slice(1).join(' '));
    log(`ledger ${r.plan.slug}: ${r.entry}`);
    return 0;
  }
  const { plan, tasks, ledger } = planTasks(flow.paths.plans, slug);
  const real = tasks.filter((t) => !t.placeholder);
  const done = real.filter((t) => !t.open);
  if (sub === 'list') {
    for (const t of tasks) log(`${t.open ? '[ ]' : '[x]'} ${t.id} ${truncate(t.body, 160)}${t.placeholder ? '  ← dòng mẫu' : ''}`);
    log(`\n${done.length}/${real.length} xong · plan ${plan.status}`);
    return 0;
  }
  const next = real.find((t) => t.open);
  log(`Plan ${plan.slug} · ${plan.status} · ${done.length}/${real.length} task xong`);
  if (!real.length) {
    log('Chưa có task thật trong §2 — `flowctl task add` trước khi execute.');
    return 1;
  }
  if (!['APPROVED', 'EXECUTING', 'VERIFYING'].includes(plan.status)) log(`⚠️ plan đang ${plan.status} — chưa được tự đi trọn (cần APPROVED).`);
  if (next) {
    log(`\nTiếp theo: ${next.id} ${next.body}`);
    log('Vòng mỗi task: test ĐỎ → mã (tái dùng trước — flowctl dup find) → test XANH → flowctl check --staged → commit → flowctl task done.');
  } else {
    log('\nHết task. Sang flow-post: verify · nghiệm thu thật · review · cập nhật ngữ cảnh · mở PR.');
  }
  const helpers = ledger.filter((l) => /\[helper\]/.test(l));
  if (helpers.length) {
    log('\nĐã tạo trong plan này (dùng lại, đừng viết lại):');
    helpers.slice(-10).forEach((l) => log(`  ${l}`));
  }
  const rest = ledger.filter((l) => !/\[helper\]/.test(l));
  if (rest.length) {
    log('\nLedger gần nhất:');
    rest.slice(-5).forEach((l) => log(`  ${l}`));
  }
  return 0;
}

export function cmdRunbook(cwd, sub, opts) {
  const flow = openFlow(cwd);
  const dir = flow.paths.handoff;
  if (sub === 'new') {
    const [kind, slug] = opts._;
    const r = createRunbook(dir, path.join(TEMPLATES, 'runbooks'), { kind, slug, title: typeof opts.title === 'string' ? opts.title : slug, plan: typeof opts.plan === 'string' ? opts.plan : '' });
    log(r.file);
    log('Điền mọi chỗ <…> rồi `flowctl runbook lint <slug>`; chạy xong điền kết quả rồi `flowctl runbook lint <slug> --after`.');
    return 0;
  }
  if (sub === 'lint') {
    const file = findRunbook(dir, opts._[0] || '');
    const { kind, problems } = lintRunbook(readText(file), { after: !!opts.after });
    if (!problems.length) {
      log(`✓ ${path.basename(file)} (${kind})${opts.after ? ' — kết quả đủ' : ' — cấu trúc đủ'}`);
      return 0;
    }
    log(`✗ ${path.basename(file)} (${kind}) — ${problems.length} vấn đề:`);
    problems.forEach((p) => log(`  - ${p}`));
    return 1;
  }
  const all = listRunbooks(dir);
  if (!all.length) log(`Chưa có runbook. Loại: ${RUNBOOK_KINDS.join(', ')} → flowctl runbook new <loại> <slug> [--plan slug]`);
  for (const r of all) log(`${r.created}  ${r.kind.padEnd(10)} ${r.slug}  ${rel(flow.cwd, r.file)}`);
  return 0;
}

export function sessionContext(cwd) {
  const flow = openFlow(cwd, { required: false });
  if (!flow) return '';
  const p = flow.profile;
  const lines = [
    `agent-flow đang bật cho thư mục này (.flow ở ${flow.root}). Trước khi đọc hay sửa mã: nạp skill \`flow\` và đọc .flow/PROJECT.md.`,
    `Nhánh được bảo vệ (không push / merge / PR vào): ${[...new Set([...(p.branches.protected || []), ...(p.branches.ownerOnly || [])])].join(', ') || '-'} · tự chủ: ${p.autonomy?.level || 'pr'} · DRY: ${p.hygiene.dup || 'block'}.`,
  ];
  const pendingJoin = loadOnboarding(flow).decisions.filter((d) => d.answer === null);
  if (pendingJoin.length) lines.push(`Còn ${pendingJoin.length} điều cần chốt khi vào dự án (${pendingJoin.map((d) => d.question).join(' · ')}) — chạy flowctl onboard và hỏi người dùng TRÊN CHAT trước khi sửa mã.`);
  if (flow.profile.instructions?.length) lines.push(`Tệp chỉ dẫn của dự án THẮNG khi mâu thuẫn: ${flow.profile.instructions.join(', ')}.`);
  const plans = readPlans(flow.paths.plans).filter((x) => x.bucket === 'active');
  for (const pl of plans.slice(0, 5)) {
    const text = readText(pl.file);
    const open = parseDecisions(text).filter((d) => d.open && !d.placeholder);
    const tasks = parseTasks(text).filter((t) => !t.placeholder);
    const next = tasks.find((t) => t.open);
    lines.push(`Plan ${pl.slug} · ${pl.status} · ${tasks.filter((t) => !t.open).length}/${tasks.length} task${next ? ` · tiếp: ${next.id} ${truncate(next.body, 90)}` : ''}${open.length ? ` · ${open.length} quyết định CHỜ HỎI TRÊN CHAT` : ''}`);
  }
  if (plans.some((x) => ['APPROVED', 'EXECUTING'].includes(x.status))) lines.push('Đang thi hành ⇒ nạp `flow-execute`, chạy `flowctl task next <slug>` để tiếp đúng chỗ.');
  return lines.join('\n');
}

export function cmdSelftest() {
  const skillsDir = path.join(HOME, 'skills');
  const problems = [];
  const names = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const n of names) {
    const file = path.join(skillsDir, n, 'SKILL.md');
    const text = readText(file);
    if (text === null) {
      problems.push(`${n}: thiếu SKILL.md`);
      continue;
    }
    const { data, body } = parseFrontmatter(text);
    if (data.name !== n) problems.push(`${n}: name "${data.name}" khác tên thư mục`);
    if (!/^[a-z0-9-]{1,64}$/.test(data.name || '')) problems.push(`${n}: name sai định dạng (a-z0-9-, ≤64)`);
    const desc = String(data.description || '');
    if (!desc) problems.push(`${n}: thiếu description`);
    if (desc.length > 1024) problems.push(`${n}: description ${desc.length} ký tự > 1024`);
    if (!/^Dùng\b/.test(desc)) problems.push(`${n}: description nên mở bằng "Dùng khi…" (nói khi nào dùng, không tóm tắt quy trình)`);
    if (/<[a-z][^>]*>/i.test(desc)) problems.push(`${n}: description có thẻ XML`);
    const lines = body.split('\n').length;
    if (lines > 500) problems.push(`${n}: thân ${lines} dòng > 500 — tách sang references/`);
    for (const m of body.matchAll(/\]\(((?!https?:)[^)#\s]+)\)/g)) {
      const target = path.join(skillsDir, n, m[1]);
      if (!exists(target)) problems.push(`${n}: liên kết hỏng ${m[1]}`);
      else {
        const ref = readText(target) || '';
        if (ref.split('\n').length > 100 && !/^## (Mục lục|Contents)/m.test(ref)) problems.push(`${n}: ${m[1]} > 100 dòng mà không có mục lục`);
        if (/\]\(((?!https?:)[^)#\s]+\.md)\)/.test(ref)) problems.push(`${n}: ${m[1]} lại trỏ tiếp sang tệp khác (chỉ nên sâu một cấp)`);
      }
    }
    if (/[A-Za-z]:\\[A-Za-z]|\\[a-z]+\\/.test(body)) problems.push(`${n}: có đường dẫn kiểu Windows (dấu gạch ngược) — dùng /`);
    for (const m of body.matchAll(/skill `(flow[-a-z]*)`/g)) if (!names.includes(m[1])) problems.push(`${n}: nhắc skill không tồn tại ${m[1]}`);
  }
  for (const k of RUNBOOK_KINDS) if (!exists(path.join(TEMPLATES, 'runbooks', `${k}.md`))) problems.push(`thiếu khuôn runbook ${k}`);
  if (!scannerSelfCheck()) problems.push('bộ quét bí mật không bắt được mẫu đối chứng — phép đo hỏng');
  for (const g of listFiles(PRESET_GATES, (f) => f.endsWith('.md'))) {
    const { data } = parseFrontmatter(readText(g));
    if (!data.when || !data.name) problems.push(`gate ${path.basename(g)}: thiếu name / when`);
  }
  if (problems.length) {
    problems.forEach((x) => log(`✗ ${x}`));
    log(`\n${problems.length} vấn đề trong bộ skill (${names.length} skill).`);
    return 1;
  }
  log(`✓ ${names.length} skill · ${RUNBOOK_KINDS.length} khuôn runbook · gate preset hợp lệ — đạt chuẩn tự kiểm.`);
  return 0;
}

function fileAt(repoDir, ref, file) {
  const r = git(repoDir, ['show', `${ref}:${file}`]);
  return r.ok ? r.out : '';
}

export function runNamingCheck(repo, { staged = false, base = '' } = {}) {
  const out = [];
  const added = new Set(
    git(repo.dir, staged ? ['diff', '--cached', '--name-only', '--diff-filter=A'] : ['diff', '--name-only', '--diff-filter=A', base ? `${base}...HEAD` : 'HEAD'])
      .out.split('\n')
      .filter(Boolean),
  );
  if (!staged && !base) git(repo.dir, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter(Boolean).forEach((f) => added.add(f));
  const lines = addedLines(repo.dir, { staged, base });
  const byFile = new Map();
  for (const l of lines) {
    if (!byFile.has(l.file)) byFile.set(l.file, []);
    byFile.get(l.file).push(l.text);
  }
  for (const [file, texts] of byFile) {
    if (!namingFamily(file) || namingSkipped(file)) continue;
    const beforeRef = base || 'HEAD';
    const before = added.has(file) ? '' : fileAt(repo.dir, beforeRef, file);
    const after = staged ? fileAt(repo.dir, '', file) || texts.join('\n') : readText(path.join(repo.dir, file)) || texts.join('\n');
    for (const h of newVietnameseNames(file, before, after)) out.push(`  tên tiếng Việt  ${file}: \`${h.name}\` (âm tiết "${h.syllable}")`);
    for (const msg of vietnameseMessages(texts.join('\n'))) out.push(`  message / log  ${file}: "${truncate(msg, 80)}" — câu tiếng Anh đầy đủ (client dịch theo mã lỗi)`);
  }
  for (const f of added) {
    if (!namingFamily(f) || namingSkipped(f)) continue;
    const hit = vietnameseFileName(f);
    if (hit) out.push(`  tên tệp        ${f} (âm tiết "${hit}")`);
  }
  return out;
}

const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([\w./-]+\))?!?: \S/;

export function commitTitleProblems(title, conf = {}) {
  const style = conf.style || 'conventional';
  const language = conf.language || 'en';
  const problems = [];
  if (style === 'conventional' && !CONVENTIONAL.test(title)) problems.push('Tiêu đề theo Conventional Commits: `<type>(<scope>): <điều thay đổi>` — type ∈ feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert.');
  if (style === 'ticket') {
    const key = conf.ticketKey || '[A-Z][A-Z0-9]{1,9}';
    if (!new RegExp(`\\b${key}-\\d+\\b`).test(title)) problems.push(`Đội gắn mã ticket trong tiêu đề — thêm \`${conf.ticketKey || 'KEY'}-<số>\`.`);
  }
  if (title.length > 72) problems.push(`Tiêu đề ${title.length} ký tự > 72 — nói một điều, ngắn.`);
  const subject = title.replace(CONVENTIONAL, (m) => m.slice(-1)).replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b:?/g, ' ');
  const words = subject.split(/[^A-Za-zÀ-ỹ]+/).filter(Boolean);
  const looksVi = /[À-ỹ]/.test(subject) || words.some((w) => vietnameseHit(w)) || vietnameseHit(words.join('_'));
  if (language === 'en' && looksVi) problems.push('Tiêu đề commit bằng tiếng Anh (quy ước của repo này).');
  if (language === 'vi' && !/[À-ỹ]/.test(subject) && words.some((w) => vietnameseHit(w))) problems.push('Đội viết commit tiếng Việt — viết CÓ DẤU, không bỏ dấu.');
  if (/[\w-]+\/[\w./-]+|\.\w{2,4}\b/.test(subject) || /\b[a-z]+[A-Z]\w*\b/.test(subject) || /\w+\(\)/.test(subject)) problems.push('Tiêu đề nói THAY ĐỔI cho người đọc, không phải tên tệp / tên hàm / chi tiết cài đặt.');
  if (style === 'conventional' && /^[A-Z][a-z]/.test(subject.trim())) problems.push('Sau dấu ":" viết thường chữ đầu (Conventional Commits).');
  if (/\.$/.test(title)) problems.push('Tiêu đề không kết thúc bằng dấu chấm.');
  return problems;
}

export function prDescriptionProblems(text, { maxLines = 25, language = 'vi' } = {}) {
  const problems = [];
  const body = String(text).replace(/\r\n/g, '\n').trim();
  const lines = body.split('\n').filter((l) => l.trim());
  if (!body) problems.push('Mô tả trống.');
  if (lines.length > maxLines) problems.push(`${lines.length} dòng > ${maxLines} — mô tả cho người đọc: thay đổi gì, vì sao, đã kiểm thế nào, cần lưu ý gì. Chi tiết kỹ thuật để trong mã / CONTEXT.md.`);
  const prose = body.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const noDiacritic = prose.split(/[^A-Za-zÀ-ỹ_]+/).filter((w) => /^[a-z]+$/.test(w) && vietnameseHit(w));
  if (language === 'vi') {
    if (!/[À-ỹ]/.test(body)) problems.push('Đội viết mô tả PR bằng tiếng Việt — viết CÓ DẤU.');
    if (noDiacritic.length >= 3) problems.push(`Có tiếng Việt KHÔNG DẤU (${[...new Set(noDiacritic)].slice(0, 4).join(', ')}) — viết có dấu.`);
  } else if (language === 'en') {
    const vnWords = prose.split(/\s+/).filter((w) => /[À-ỹ]/.test(w)).length;
    if (vnWords >= 3 || noDiacritic.length >= 3) problems.push('Đội viết mô tả PR bằng tiếng Anh — viết lại bằng tiếng Anh (chat với người dùng vẫn theo ngôn ngữ của họ).');
  }
  const codeSpans = (body.match(/`[^`]+`/g) || []).length;
  const idents = (prose.match(/\b[a-z]+[A-Z]\w+\b|\b\w+\(\)|[\w-]+\/[\w./-]+\.\w{1,5}\b/g) || []).length;
  if (codeSpans + idents > Math.max(6, lines.length)) problems.push(`Quá kỹ thuật (${codeSpans} đoạn mã · ${idents} tên hàm / đường dẫn) — kể bằng lời thường điều người dùng / đồng đội thấy được.`);
  if (/```/.test(body) && (body.match(/```/g) || []).length >= 2 && body.split('```')[1].split('\n').length > 8) problems.push('Khối mã dài trong mô tả — bỏ ra, dẫn tới commit / tệp nếu cần.');
  return problems;
}

export function cmdPrMsg(cwd, opts) {
  const flow = openFlow(cwd);
  const text = typeof opts.message === 'string' ? opts.message : readText(path.resolve(cwd, opts._[0] || ''));
  if (text === null) {
    log('prmsg <tệp> | prmsg --message "…" — kiểm mô tả PR/MR trước khi mở.');
    return 1;
  }
  const problems = prDescriptionProblems(text, { maxLines: Number(flow.profile.hygiene.prMaxLines) || 25, language: flow.profile.language?.team || flow.profile.language?.prose || 'vi' });
  problems.push(...textProblems(text, 'pr'));
  const leaks = findLeaks(text.split('\n').map((t, i) => ({ file: 'pr', line: i + 1, text: t })), [...defaultLeakPatterns(flow.profile), ...(flow.profile.hygiene.leakPatterns || [])]);
  leaks.forEach((l) => problems.push(`Dòng ${l.line} nhắc harness: "${truncate(l.text, 80)}"`));
  if (!problems.length) {
    log('✓ Mô tả PR ngắn, cho người đọc, đúng ngôn ngữ.');
    return 0;
  }
  problems.forEach((x) => log(`✗ ${x}`));
  log(`\nKhuôn gợi ý: ${path.join(TEMPLATES, 'pr-description.md')} (repo có .github/pull_request_template.md thì theo khuôn của repo).`);
  return 1;
}

function expandModuleGlob(baseDir, glob) {
  const segs = glob.replace(/^\/+/, '').split('/').filter(Boolean);
  let dirs = [baseDir];
  for (const seg of segs) {
    const next = [];
    for (const d of dirs) {
      if (seg === '**') return [];
      if (seg.includes('*')) {
        const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        let entries = [];
        try {
          entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          entries = [];
        }
        for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'bin', 'obj', 'dist', 'build', 'test', 'tests', '__tests__'].includes(e.name) && re.test(e.name)) next.push(path.join(d, e.name));
      } else if (isDir(path.join(d, seg))) next.push(path.join(d, seg));
    }
    dirs = next;
  }
  return dirs;
}

export function computeCoverage(flow) {
  const ctx = flow.profile.layout.moduleContext;
  const staleDays = Number(flow.profile.context.staleDays) || 30;
  const repos = [];
  for (const repo of discoverRepos(flow)) {
    const mods = new Map();
    const globs = (flow.profile.modules || []).map((m) => (typeof m === 'string' ? m : m.glob));
    for (const g of globs) {
      const relToRepo = toPosix(path.relative(repo.dir, path.join(flow.root, g)));
      const candidates = relToRepo.startsWith('..') ? expandModuleGlob(repo.dir, g) : [...expandModuleGlob(repo.dir, relToRepo), ...expandModuleGlob(repo.dir, g)];
      for (const d of candidates) mods.set(path.resolve(d), { dir: d, source: 'profile' });
    }
    if (!globs.length) {
      for (const g of DEFAULT_MODULE_GLOBS.slice(0, 11)) for (const d of expandModuleGlob(repo.dir, g)) mods.set(path.resolve(d), { dir: d, source: 'default' });
    }
    for (const f of contextFilesOf(flow, repo)) {
      const d = path.dirname(path.join(repo.dir, f));
      mods.set(path.resolve(d), { dir: d, source: 'context' });
    }
    const rows = [];
    for (const m of [...mods.values()].sort((a, b) => a.dir.localeCompare(b.dir))) {
      const file = path.join(m.dir, ctx);
      const has = exists(file);
      let updated = '';
      let commits = 0;
      let lines = 0;
      if (has) {
        const st = fs.statSync(file);
        updated = today(st.mtime);
        lines = lineCount(readText(file));
        const rd = toPosix(path.relative(repo.dir, m.dir)) || '.';
        commits = git(repo.dir, ['log', `--since=${st.mtime.toISOString()}`, '--format=%h', '--', rd, `:(exclude)${rd}/${ctx}`]).out.split('\n').filter(Boolean).length;
      }
      const age = updated ? Math.floor((Date.now() - new Date(updated).getTime()) / 86400000) : 0;
      rows.push({ module: rel(flow.root, m.dir), has, updated, commits, lines, stale: has && (commits > 0 || age > staleDays) });
    }
    repos.push({ name: repo.name, rows });
  }
  return repos;
}

export function writeCoverage(flow) {
  const repos = computeCoverage(flow);
  const total = repos.reduce((s, r) => s + r.rows.length, 0);
  const covered = repos.reduce((s, r) => s + r.rows.filter((x) => x.has).length, 0);
  const stale = repos.reduce((s, r) => s + r.rows.filter((x) => x.stale).length, 0);
  const md = [
    `# Coverage — sổ phủ ${flow.profile.layout.moduleContext} (tự sinh bởi \`flowctl context coverage\`, đừng sửa tay)`,
    '',
    `_${today()} · ${covered}/${total} module có ngữ cảnh · ${stale} nghi cũ (có commit sau lần cập nhật, hoặc > ${flow.profile.context.staleDays || 30} ngày)_`,
    '',
  ];
  for (const r of repos) {
    const c = r.rows.filter((x) => x.has).length;
    md.push(`## ${r.name} — ${c}/${r.rows.length}`, '', '| Module | Ngữ cảnh | Cập nhật | Commit sau | Dòng |', '|---|---|---|---|---|');
    for (const x of r.rows) md.push(`| \`${x.module}\` | ${x.has ? (x.stale ? '⚠️ nghi cũ' : '✓') : '✗ chưa có'} | ${x.updated || '-'} | ${x.has ? x.commits : '-'} | ${x.has ? x.lines : '-'} |`);
    md.push('');
  }
  writeText(flow.paths.coverage, md.join('\n'));
  return { total, covered, stale, file: flow.paths.coverage };
}

export function editedContent(tool, input, before) {
  if (tool === 'Write') return typeof input?.content === 'string' ? input.content : null;
  const steps = tool === 'MultiEdit' ? input?.edits : [input];
  if (!Array.isArray(steps)) return null;
  return steps.reduce((text, step) => (text === null ? null : applyEdit(text, step)), before);
}

function applyEdit(text, edit) {
  const { old_string: find, new_string: replacement, replace_all: everywhere } = edit ?? {};
  if (typeof find !== 'string' || typeof replacement !== 'string') return null;
  if (find === '') return replacement;
  const at = text.indexOf(find);
  if (at < 0) return null;
  if (everywhere) return text.replaceAll(find, () => replacement);
  return text.slice(0, at) + replacement + text.slice(at + find.length);
}

function guardRead(input, cwd) {
  const file = input.tool_input?.file_path;
  if (typeof file !== 'string') return 0;
  if (!isRealEnvFile(file) && !isKeyFile(file)) return 0;
  const flow = openFlow(input.cwd || path.dirname(file) || cwd, { required: false });
  if (!flow || flow.profile.hygiene.secrets === 'off') return 0;
  process.stderr.write(isRealEnvFile(file) ? `agent-flow: không đọc thẳng tệp .env — giá trị sẽ vào lịch sử phiên. Xem an toàn: flowctl secrets env "${file}" (tên khoá, độ dài, host).\n` : 'agent-flow: không đọc tệp khoá riêng — nội dung sẽ vào lịch sử phiên.\n');
  return 2;
}

function guardSecretEdit(input, cwd) {
  const file = input.tool_input?.file_path;
  if (typeof file !== 'string' || isRealEnvFile(file)) return 0;
  const flow = openFlow(input.cwd || path.dirname(file) || cwd, { required: false });
  if (!flow || flow.profile.hygiene.secrets === 'off') return 0;
  const ti = input.tool_input || {};
  const chunks = input.tool_name === 'Write' ? [ti.content] : input.tool_name === 'MultiEdit' ? (ti.edits || []).map((e) => e.new_string) : [ti.new_string];
  const hits = [];
  for (const c of chunks) {
    if (typeof c !== 'string') continue;
    c.split(/\r?\n/).forEach((t, i) => {
      for (const f of scanSecretsInLine({ file: toPosix(file), line: i + 1, text: t })) hits.push(f);
    });
  }
  if (!hits.length) return 0;
  const lines = ['agent-flow: nội dung sắp ghi có bí mật — không ghi giá trị thật vào tệp.'];
  hits.slice(0, 5).forEach((h) => lines.push(`  ${h.rule}: ${mask(h.value)}`));
  lines.push('Đọc từ biến môi trường / secret manager; khai tên biến ở .env.example. Tài liệu thì dùng placeholder như <password>. Không ghi tệp qua shell để đi vòng.');
  process.stderr.write(`${lines.join('\n')}\n`);
  return 2;
}

function guardEdit(input, cwd) {
  const file = input.tool_input?.file_path;
  if (typeof file !== 'string' || !namingFamily(file) || namingSkipped(toPosix(file))) return 0;
  const flow = openFlow(input.cwd || path.dirname(file) || cwd, { required: false });
  if (!flow || flow.profile.hygiene.naming === 'off' || (flow.profile.language?.code || 'en') !== 'en') return 0;
  const before = readText(file) || '';
  const after = editedContent(input.tool_name, input.tool_input, before);
  if (after === null) return 0;
  const hits = newVietnameseNames(toPosix(file), before, after);
  const fresh = vietnameseMessages(after).filter((m) => !vietnameseMessages(before).includes(m));
  const fileHit = !before && vietnameseFileName(toPosix(file));
  if (!hits.length && !fresh.length && !fileHit) return 0;
  const lines = ['agent-flow: mã phải bằng tiếng Anh.'];
  hits.slice(0, 5).forEach((h) => lines.push(`  tên tiếng Việt mới: \`${h.name}\` (âm tiết "${h.syllable}")`));
  fresh.slice(0, 3).forEach((m) => lines.push(`  message / log tiếng Việt: "${truncate(m, 80)}" — câu tiếng Anh đầy đủ`));
  if (fileHit) lines.push(`  tên tệp tiếng Việt: ${path.basename(file)}`);
  lines.push('Đặt lại bằng tiếng Anh (thuật ngữ ngành, không phiên âm). Tiếng Việt có dấu chỉ ở tài liệu, chuỗi giao diện qua i18n, tên ca test. Không ghi tệp qua shell để đi vòng.');
  process.stderr.write(`${lines.join('\n')}\n`);
  return 2;
}
