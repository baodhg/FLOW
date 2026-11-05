import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, updateFrontmatter, withFrontmatter } from './frontmatter.mjs';
import { exists, listFiles, matchAny, readText, slugify, today, toPosix, truncate, writeText } from './util.mjs';

export const RULE_TYPES = ['invariant', 'trap', 'convention', 'decision'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
export const PLAN_STATUSES = ['DRAFT', 'APPROVED', 'EXECUTING', 'VERIFYING', 'DONE', 'PARKED', 'ABANDONED'];
const CLOSED = new Set(['DONE', 'ABANDONED']);

const sevRank = (s) => {
  const i = SEVERITIES.indexOf(String(s).toLowerCase());
  return i < 0 ? SEVERITIES.length : i;
};

function asList(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readRules(dir) {
  return listFiles(dir, (n) => /^R-\d{4}.*\.md$/.test(n)).map((file) => {
    const text = readText(file);
    const { data, body } = parseFrontmatter(text);
    return {
      file,
      id: data.id || path.basename(file).slice(0, 6),
      type: data.type || 'invariant',
      severity: data.severity || 'medium',
      title: data.title || '',
      scope: asList(data.scope),
      tags: asList(data.tags),
      status: data.status || 'active',
      enforced: data.enforced || 'manual',
      created: data.created || '',
      body,
      lines: text.split('\n').length,
    };
  });
}

export function nextRuleId(dir) {
  const ids = readRules(dir).map((r) => Number(String(r.id).replace(/\D/g, '')) || 0);
  const n = (ids.length ? Math.max(...ids) : 0) + 1;
  return `R-${String(n).padStart(4, '0')}`;
}

export function createRule(dir, { type = 'invariant', title, severity = 'high', scope = [], tags = [], origin = '', enforced = 'manual' }) {
  if (!title) throw new Error('Thiếu --title.');
  if (!RULE_TYPES.includes(type)) throw new Error(`--type phải là một trong: ${RULE_TYPES.join(', ')}`);
  if (!SEVERITIES.includes(severity)) throw new Error(`--severity phải là một trong: ${SEVERITIES.join(', ')}`);
  const id = nextRuleId(dir);
  const file = path.join(dir, `${id}--${slugify(title, 50) || 'rule'}.md`);
  const data = {
    id,
    type,
    severity,
    title,
    scope: asList(scope),
    tags: asList(tags),
    status: 'active',
    enforced,
    created: today(),
    origin,
  };
  const body = [
    '',
    '## Luật',
    '',
    '<một câu khẳng định: PHẢI / KHÔNG BAO GIỜ ...>',
    '',
    '## Vì sao',
    '',
    '🔑 <hậu quả cụ thể nếu vi phạm — con số, sự cố, ngày>',
    '',
    '## Cách kiểm',
    '',
    '<lệnh, phép đo hoặc chỗ cần đọc để biết luật còn được giữ — kèm đối chứng dương nếu kết quả mong đợi là 0>',
    '',
    '## Sự cố gốc',
    '',
    '🪤 <chuyện đã xảy ra: ngày · triệu chứng · nguyên nhân thật · vì sao các cổng không bắt được>',
    '',
  ].join('\n');
  writeText(file, withFrontmatter(data, body));
  return { id, file };
}

export function findRules(rules, { files = [], tags = [], text = '', includeGlobal = true, includeRetired = false }) {
  const q = text ? text.toLowerCase() : '';
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const out = [];
  for (const r of rules) {
    if (!includeRetired && r.status !== 'active') continue;
    const reasons = [];
    if (files.length && r.scope.length) {
      const hit = files.find((f) => matchAny(r.scope, f));
      if (hit) reasons.push(`scope:${hit}`);
    }
    if (includeGlobal && !r.scope.length && (r.severity === 'critical' || r.severity === 'high')) reasons.push('global');
    if (tagSet.size && r.tags.some((t) => tagSet.has(t.toLowerCase()))) reasons.push('tag');
    if (q && `${r.title}\n${r.body}\n${r.tags.join(' ')}`.toLowerCase().includes(q)) reasons.push('text');
    if (reasons.length) out.push({ ...r, reasons });
  }
  return out.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.id.localeCompare(b.id));
}

export function grepLegacy(legacy, { text = '', files = [] }) {
  const needles = [];
  if (text) needles.push(text.toLowerCase());
  for (const f of files) {
    const parts = toPosix(f).split('/');
    const base = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    if (base.length >= 4) needles.push(base.toLowerCase());
    if (parts.length >= 2 && parts[parts.length - 2].length >= 4) needles.push(parts[parts.length - 2].toLowerCase());
  }
  const uniq = [...new Set(needles)];
  const hits = [];
  if (!uniq.length) return hits;
  for (const l of legacy) {
    const content = readText(l.file);
    if (content === null) continue;
    content.split('\n').forEach((line, i) => {
      const low = line.toLowerCase();
      const n = uniq.find((x) => low.includes(x));
      if (!n) return;
      const at = low.indexOf(n);
      const start = Math.max(0, at - 120);
      hits.push({ file: l.file, label: l.label || path.basename(l.file), line: i + 1, needle: n, snippet: truncate(line.slice(start, start + 360), 360) });
    });
  }
  return hits;
}

export function readMemories(dir) {
  return listFiles(dir, (n) => n.endsWith('.md') && n !== 'INDEX.md').map((file) => {
    const text = readText(file);
    const { data } = parseFrontmatter(text);
    const type = data.type || data.metadata?.type || path.basename(file).split('--')[0] || 'project';
    return {
      file,
      name: data.name || path.basename(file, '.md'),
      description: data.description || '',
      type,
      updated: data.updated || data.metadata?.modified || data.created || '',
      lines: text.split('\n').length,
    };
  });
}

export function createMemory(dir, { type = 'project', name, description = '', body = '' }) {
  if (!MEMORY_TYPES.includes(type)) throw new Error(`--type phải là một trong: ${MEMORY_TYPES.join(', ')}`);
  if (!name) throw new Error('Thiếu --name.');
  const slug = slugify(name, 60);
  const file = path.join(dir, `${type}--${slug}.md`);
  if (exists(file)) throw new Error(`Đã có ${file} — sửa tệp đó thay vì tạo trùng.`);
  const template =
    type === 'feedback' || type === 'project'
      ? '\n<sự thật / luật — một ý>\n\n**Vì sao:** <lý do người dùng đưa ra hoặc sự cố>\n\n**Áp dụng:** <khi nào và làm gì khác đi>\n'
      : '\n<sự thật — một ý>\n';
  writeText(
    file,
    withFrontmatter({ name: slug, description, type, created: today(), updated: today() }, body ? `\n${body.trim()}\n` : template),
  );
  return { file, name: slug };
}

export function planDirs(plansDir) {
  return { active: path.join(plansDir, 'active'), shipped: path.join(plansDir, 'shipped'), index: path.join(plansDir, 'INDEX.md') };
}

export function readPlans(plansDir) {
  const d = planDirs(plansDir);
  const load = (dir, bucket) =>
    listFiles(dir, (n) => n.endsWith('.md')).map((file) => {
      const { data } = parseFrontmatter(readText(file));
      return {
        file,
        bucket,
        slug: data.slug || path.basename(file, '.md'),
        title: data.title || path.basename(file, '.md'),
        status: data.status || 'DRAFT',
        created: data.created || '',
        updated: data.updated || '',
        branch: data.branch || '',
        repos: asList(data.repos),
        impact: data.impact ?? '',
      };
    });
  return [...load(d.active, 'active'), ...load(d.shipped, 'shipped')];
}

export function findPlan(plansDir, slug) {
  const all = readPlans(plansDir);
  const exact = all.filter((p) => p.slug === slug);
  if (exact.length === 1) return exact[0];
  const fuzzy = all.filter((p) => p.slug.includes(slug) || path.basename(p.file).includes(slug));
  if (fuzzy.length === 1) return fuzzy[0];
  if (!fuzzy.length) throw new Error(`Không thấy plan "${slug}".`);
  throw new Error(`"${slug}" khớp nhiều plan: ${fuzzy.map((p) => p.slug).join(', ')}`);
}

export function createPlan(plansDir, { slug, title, branch = '', repos = [], template }) {
  const s = slugify(slug || title, 60);
  if (!s) throw new Error('Thiếu slug.');
  const d = planDirs(plansDir);
  if (readPlans(plansDir).some((p) => p.slug === s)) throw new Error(`Đã có plan slug "${s}".`);
  const file = path.join(d.active, `PLAN--${today()}--${s}.md`);
  const data = {
    slug: s,
    title: title || s,
    status: 'DRAFT',
    created: today(),
    updated: today(),
    branch: branch || '',
    repos: asList(repos),
    impact: '',
  };
  writeText(file, withFrontmatter(data, template.replace(/\{\{title\}\}/g, title || s).replace(/\{\{date\}\}/g, today())));
  return { file, slug: s };
}

const DECISION = /^(\s*)- \[( |x|X)\] \*\*(D\d+)\*\*\s*(.*)$/;

export function parseDecisions(text) {
  return String(text || '')
    .split('\n')
    .map((line, i) => {
      const m = DECISION.exec(line);
      if (!m) return null;
      const body = m[4].trim();
      const placeholder = /<câu hỏi>|<A \(khuyến nghị\)>/.test(body);
      return { id: m[3], open: m[2] === ' ', line: i, body, placeholder };
    })
    .filter(Boolean);
}

export function planDecisions(plansDir, slug) {
  const plan = findPlan(plansDir, slug);
  return { plan, decisions: parseDecisions(readText(plan.file)) };
}

export function decidePlan(plansDir, slug, id, answer, by = 'người dùng') {
  if (!answer) throw new Error('Thiếu câu trả lời: flowctl plan decide <slug> <Dn> "<lựa chọn>"');
  const { plan, decisions } = planDecisions(plansDir, slug);
  const d = decisions.find((x) => x.id.toUpperCase() === String(id).toUpperCase());
  if (!d) throw new Error(`Plan ${plan.slug} không có ${id}. Có: ${decisions.map((x) => x.id).join(', ') || '(không có)'}`);
  if (d.placeholder) throw new Error(`${d.id} vẫn là dòng mẫu — viết câu hỏi thật hoặc xoá dòng đó.`);
  const lines = readText(plan.file).split('\n');
  const m = DECISION.exec(lines[d.line]);
  lines[d.line] = `${m[1]}- [x] **${d.id}** ${m[4].replace(/\s*→ \*\*.*$/, '')} → **${answer}** (${by} chốt ${today()})`;
  writeText(plan.file, updateFrontmatter(lines.join('\n'), { updated: today() }));
  return { plan, id: d.id, answer };
}

export function setPlanStatus(plansDir, slug, status, { force = false } = {}) {
  const st = String(status).toUpperCase();
  if (!PLAN_STATUSES.includes(st)) throw new Error(`Trạng thái phải là một trong: ${PLAN_STATUSES.join(', ')}`);
  const plan = findPlan(plansDir, slug);
  if (st === 'DONE' && !force) {
    const open = parseTasks(readText(plan.file)).filter((x) => x.open && !x.placeholder);
    if (open.length) throw new Error(`Plan ${plan.slug} còn ${open.length} task mở (${open.map((x) => x.id).join(', ')}). Còn nợ ⇒ PARKED (ghi §8), không phải DONE.`);
  }
  if (['APPROVED', 'EXECUTING'].includes(st) && !force) {
    const open = parseDecisions(readText(plan.file)).filter((d) => d.open);
    if (open.length) {
      const tpl = open.filter((d) => d.placeholder).map((d) => d.id);
      throw new Error(
        `Plan ${plan.slug} còn ${open.length} quyết định mở (${open.map((d) => d.id).join(', ')}). Hỏi người dùng TRÊN CHAT kèm lựa chọn (\`flowctl plan decisions ${plan.slug}\`), ghi bằng \`flowctl plan decide\`, rồi mới ${st}.${tpl.length ? ` ${tpl.join(', ')} là dòng mẫu — xoá nếu không có quyết định nào.` : ''}`,
      );
    }
  }
  const text = updateFrontmatter(readText(plan.file), { status: st, updated: today() });
  const d = planDirs(plansDir);
  const target = CLOSED.has(st) ? path.join(d.shipped, path.basename(plan.file)) : path.join(d.active, path.basename(plan.file));
  writeText(target, text);
  if (path.resolve(target) !== path.resolve(plan.file)) fs.rmSync(plan.file);
  return { ...plan, status: st, file: target, moved: path.resolve(target) !== path.resolve(plan.file) };
}

function mdRow(cells) {
  return `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
}

export function writeIndexes(paths) {
  const out = [];
  const rules = readRules(paths.rules).sort((a, b) => a.id.localeCompare(b.id));
  const rulesIndex = [
    '# Rules — sổ luật & bẫy (tự sinh bởi `flowctl reindex`, đừng sửa tay)',
    '',
    `_${rules.length} mục · cập nhật ${today()}_`,
    '',
    mdRow(['id', 'loại', 'mức', 'trạng thái', 'tiêu đề', 'scope', 'thi hành']),
    mdRow(['---', '---', '---', '---', '---', '---', '---']),
    ...rules.map((r) =>
      mdRow([
        `[${r.id}](${path.basename(r.file)})`,
        r.type,
        r.severity,
        r.status,
        truncate(r.title, 140),
        r.scope.length ? truncate(r.scope.join(', '), 80) : '*',
        r.enforced,
      ]),
    ),
    '',
  ].join('\n');
  writeText(path.join(paths.rules, 'INDEX.md'), rulesIndex);
  out.push(['rules', rules.length]);

  const mems = readMemories(paths.memory);
  const groups = MEMORY_TYPES.map((t) => [t, mems.filter((m) => m.type === t)]).filter(([, l]) => l.length);
  const other = mems.filter((m) => !MEMORY_TYPES.includes(m.type));
  if (other.length) groups.push(['khác', other]);
  const memIndex = [
    '# Memory — trí nhớ dùng chung mọi agent (tự sinh bởi `flowctl reindex`)',
    '',
    `_${mems.length} mục · cập nhật ${today()}_`,
    '',
    ...groups.flatMap(([t, list]) => [
      `## ${t}`,
      '',
      ...list.map((m) => `- [${m.name}](${path.basename(m.file)}) — ${truncate(m.description, 180)}`),
      '',
    ]),
  ].join('\n');
  writeText(path.join(paths.memory, 'INDEX.md'), memIndex);
  out.push(['memory', mems.length]);

  const plans = readPlans(paths.plans).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const d = planDirs(paths.plans);
  const planIndex = [
    '# Plans — sổ cái (tự sinh bởi `flowctl reindex`)',
    '',
    `_${plans.filter((p) => p.bucket === 'active').length} đang mở · ${plans.filter((p) => p.bucket === 'shipped').length} đã đóng · cập nhật ${today()}_`,
    '',
    mdRow(['trạng thái', 'slug', 'tiêu đề', 'nhánh', 'repo', 'impact', 'tạo', 'cập nhật']),
    mdRow(['---', '---', '---', '---', '---', '---', '---', '---']),
    ...plans.map((p) =>
      mdRow([
        p.status,
        `[${p.slug}](${toPosix(path.relative(paths.plans, p.file))})`,
        truncate(p.title, 100),
        p.branch,
        p.repos.join(', '),
        p.impact,
        p.created,
        p.updated,
      ]),
    ),
    '',
  ].join('\n');
  writeText(d.index, planIndex);
  out.push(['plans', plans.length]);
  return out;
}

const TASK = /^(\s*)- \[( |x|X)\] \*\*(T\d+)\*\*\s*(.*)$/;

export function parseTasks(text) {
  return String(text || '')
    .split('\n')
    .map((line, i) => {
      const m = TASK.exec(line);
      if (!m) return null;
      return { id: m[3], open: m[2] === ' ', line: i, body: m[4].trim(), placeholder: /^<việc>/.test(m[4].trim()) };
    })
    .filter(Boolean);
}

export function planTasks(plansDir, slug) {
  const plan = findPlan(plansDir, slug);
  const text = readText(plan.file);
  const ledgerAt = text.indexOf('\n## 9. Ledger');
  const ledger = ledgerAt < 0 ? [] : text.slice(ledgerAt).split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2} \[/.test(l));
  return { plan, tasks: parseTasks(text), ledger };
}

function savePlanLines(plan, lines) {
  writeText(plan.file, updateFrontmatter(lines.join('\n'), { updated: today() }));
}

export function doneTask(plansDir, slug, id, commit = '') {
  const { plan, tasks } = planTasks(plansDir, slug);
  const t = tasks.find((x) => x.id.toUpperCase() === String(id).toUpperCase());
  if (!t) throw new Error(`Plan ${plan.slug} không có ${id}. Có: ${tasks.map((x) => x.id).join(', ') || '(không có)'}`);
  if (t.placeholder) throw new Error(`${t.id} vẫn là dòng mẫu — viết task thật trước.`);
  const lines = readText(plan.file).split('\n');
  const m = TASK.exec(lines[t.line]);
  lines[t.line] = `${m[1]}- [x] **${t.id}** ${m[4].replace(/\s*✓ \d{4}-\d{2}-\d{2}.*$/, '')} ✓ ${today()}${commit ? ` · ${commit}` : ''}`;
  savePlanLines(plan, lines);
  return { plan, id: t.id, commit };
}

export function addTask(plansDir, slug, body) {
  if (!body) throw new Error('Thiếu nội dung task.');
  const { plan, tasks } = planTasks(plansDir, slug);
  const lines = readText(plan.file).split('\n');
  const real = tasks.filter((x) => !x.placeholder);
  const n = (real.length ? Math.max(...real.map((x) => Number(x.id.slice(1)))) : 0) + 1;
  const entry = `- [ ] **T${n}** ${body}`;
  const placeholder = tasks.find((x) => x.placeholder);
  if (placeholder) lines[placeholder.line] = entry;
  else if (tasks.length) lines.splice(tasks[tasks.length - 1].line + 1, 0, entry);
  else {
    const at = lines.findIndex((l) => l.startsWith('## 2.'));
    lines.splice(at < 0 ? lines.length : at + 2, 0, entry);
  }
  savePlanLines(plan, lines);
  return { plan, id: `T${n}` };
}

export function noteLedger(plansDir, slug, kind, text) {
  if (!text) throw new Error('Thiếu nội dung ghi sổ.');
  const plan = findPlan(plansDir, slug);
  let content = readText(plan.file);
  const entry = `- ${today()} [${kind}] ${text}`;
  const at = content.indexOf('\n## 9. Ledger');
  if (at < 0) content = `${content.replace(/\s*$/, '')}\n\n## 9. Ledger\n\n${entry}\n`;
  else {
    const after = content.indexOf('\n## ', at + 5);
    const end = after < 0 ? content.length : after;
    const block = content.slice(at, end).replace(/\s*$/, '');
    content = `${content.slice(0, at)}${block}\n${entry}\n${content.slice(end)}`;
  }
  writeText(plan.file, updateFrontmatter(content, { updated: today() }));
  return { plan, entry };
}
