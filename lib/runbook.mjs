import path from 'node:path';
import { parseFrontmatter, withFrontmatter } from './frontmatter.mjs';
import { exists, listFiles, readText, slugify, today, writeText } from './util.mjs';

export const RUNBOOK_KINDS = ['acceptance', 'ops', 'data-op', 'release', 'handoff'];

export function createRunbook(dir, templatesDir, { kind, slug, title, plan = '' }) {
  if (!RUNBOOK_KINDS.includes(kind)) throw new Error(`Loại runbook: ${RUNBOOK_KINDS.join(' | ')}`);
  const s = slugify(slug || title, 60);
  if (!s) throw new Error('Thiếu slug.');
  const prefix = kind === 'handoff' ? 'HANDOFF' : 'RUNBOOK';
  const file = path.join(dir, `${prefix}--${today()}--${kind}--${s}.md`);
  if (exists(file)) throw new Error(`Đã có ${file}`);
  const tpl = readText(path.join(templatesDir, `${kind}.md`));
  const body = tpl.replace(/\{\{title\}\}/g, title || s).replace(/\{\{date\}\}/g, today()).replace(/\{\{plan\}\}/g, plan || '-');
  writeText(file, withFrontmatter({ kind, slug: s, title: title || s, plan, created: today() }, `\n${body}`));
  return { file, slug: s };
}

export function listRunbooks(dir) {
  return listFiles(dir, (n) => /^(RUNBOOK|HANDOFF)--.*\.md$/.test(n)).map((file) => {
    const { data } = parseFrontmatter(readText(file));
    return { file, kind: data.kind || '?', slug: data.slug || path.basename(file), title: data.title || '', created: data.created || '' };
  });
}

export function findRunbook(dir, key) {
  if (exists(key)) return key;
  const all = listRunbooks(dir).filter((r) => r.slug === key || path.basename(r.file).includes(key));
  if (all.length === 1) return all[0].file;
  if (!all.length) throw new Error(`Không thấy runbook "${key}".`);
  throw new Error(`"${key}" khớp nhiều runbook: ${all.map((r) => path.basename(r.file)).join(', ')}`);
}

function section(body, re) {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return null;
  const level = (lines[i].match(/^#+/) || ['##'])[0].length;
  let j = i + 1;
  while (j < lines.length && !(new RegExp(`^#{1,${level}} `).test(lines[j]))) j++;
  return lines.slice(i + 1, j).join('\n');
}

function tableRows(text) {
  return (text || '')
    .split('\n')
    .filter((l) => /^\|/.test(l.trim()) && !/^\|\s*-{3}/.test(l.trim()))
    .slice(1)
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
}

export function lintRunbook(text, { after = false } = {}) {
  const { data, body } = parseFrontmatter(text);
  const kind = data.kind || 'acceptance';
  const problems = [];
  const holders = [...body.matchAll(/<[^<>\n]{2,80}>/g)].map((m) => m[0]).filter((h) => !/^<\/?(br|details|summary|b|i|code|kbd)>$/i.test(h));
  if (holders.length) problems.push(`${holders.length} chỗ còn khung chưa điền, ví dụ: ${[...new Set(holders)].slice(0, 4).join(' ')}`);
  if (kind === 'acceptance') {
    const tcs = [...body.matchAll(/^#### (TC-\d+)[^\n]*$/gm)];
    if (!tcs.length) problems.push('Không có ca kiểm nào (#### TC-NN · …).');
    const chunks = body.split(/^#### /m).slice(1);
    for (const c of chunks) {
      const id = (c.match(/^(TC-\d+)/) || [])[1];
      if (!id) continue;
      if (!/\*\*Kỳ vọng:\*\*/.test(c)) problems.push(`${id} thiếu **Kỳ vọng:** (điều đo được khi đạt).`);
      if (!/giả thuyết sai/i.test(c)) problems.push(`${id} thiếu nhánh cho kết quả không khớp (giả thuyết sai, dừng lại).`);
    }
    if (tcs.length && !tcs.some((m) => /\[âm\]|đối chứng âm/i.test(m[0]))) problems.push('Không có ca đối chứng âm ([âm]) — không biết phép đo có phân biệt được đạt và không đạt.');
    if (!/không đổi trạng thái/i.test(body)) problems.push('Chưa xét trường hợp thao tác không đổi trạng thái mà vẫn báo thành công.');
    const results = tableRows(section(body, /^## 3\. Kết quả/));
    const ids = tcs.map((m) => m[1]);
    for (const id of ids) {
      const row = results.find((r) => r[0] === id);
      if (!row) problems.push(`Bảng kết quả thiếu hàng ${id}.`);
      else if (after && (!row[1] || !/^(pass|fail|n\/a)/i.test(row[1]))) problems.push(`${id}: ô kết quả trống hoặc không phải pass / fail / N/A.`);
    }
    if (!section(body, /^## 4\. Diễn giải/)) problems.push('Thiếu bảng "Diễn giải" viết trước khi chạy.');
  }
  if (kind === 'ops') {
    if (!/DỪNG/.test(section(body, /^## 0\./) || '')) problems.push('Mục "Đo trước" thiếu ngưỡng 🔴 DỪNG.');
    if (!(section(body, /^## 3\. Rollback/) || '').trim()) problems.push('Thiếu rollback.');
  }
  if (kind === 'data-op') {
    const sql = [...body.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
    if (!/\bBEGIN\b/i.test(sql)) problems.push('Script không mở transaction (BEGIN).');
    if (!/RAISE EXCEPTION|THROW\s+\d+/i.test(sql)) problems.push('Script không khẳng định trạng thái trước/sau (RAISE EXCEPTION / THROW).');
    if (!/\bbak_/i.test(sql)) problems.push('Script không sao lưu dòng bị sửa (bảng bak_*).');
    if (!/\bROLLBACK\b/i.test(sql)) problems.push('Bản diễn tập phải kết thúc bằng ROLLBACK.');
    if (!/SELECT/i.test(section(body, /^## 3\. Đọc lại/) || '')) problems.push('Thiếu truy vấn đọc lại sau commit.');
    if (/^\s*--(?!\s*\+)/m.test(sql)) problems.push('Script có chú thích SQL (--) — viết không chú thích.');
  }
  if (kind === 'release') {
    const doors = section(body, /^## 2\. Cửa một chiều/) || '';
    if (!tableRows(doors).some((r) => r[0]) && !/không có cửa một chiều/i.test(doors)) problems.push('Mục "Cửa một chiều" trống — liệt kê, hoặc ghi rõ "không có cửa một chiều" và vì sao.');
  }
  if (kind === 'handoff' && after) {
    const gate = section(body, /^## 0\./) || '';
    if (/- \[ \]/.test(gate)) problems.push('Điều kiện gửi chưa đủ bằng chứng (còn ô chưa tick) ⇒ CHƯA GỬI ĐƯỢC.');
  }
  return { kind, problems };
}
