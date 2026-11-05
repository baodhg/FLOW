const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(v) {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter(Boolean);
  }
  return unquote(v);
}

export function parseFrontmatter(text) {
  const src = text || '';
  const m = FM.exec(src);
  if (!m) return { data: {}, body: src, has: false };
  const data = {};
  let parent = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nested && parent) {
      data[parent][nested[1]] = parseScalar(nested[2]);
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2].trim() === '' || kv[2].trim() === '>' || kv[2].trim() === '|') {
      parent = kv[1];
      data[parent] = {};
    } else {
      parent = null;
      data[kv[1]] = parseScalar(kv[2]);
    }
  }
  for (const k of Object.keys(data)) {
    if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]) && Object.keys(data[k]).length === 0) {
      data[k] = '';
    }
  }
  return { data, body: src.slice(m[0].length), has: true };
}

function quoteIfNeeded(v) {
  const s = String(v);
  if (s === '' || /[:#\[\]{},&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function stringifyValue(v) {
  if (Array.isArray(v)) return `[${v.map(quoteIfNeeded).join(', ')}]`;
  return quoteIfNeeded(v);
}

export function stringifyFrontmatter(data) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const [nk, nv] of Object.entries(v)) lines.push(`  ${nk}: ${stringifyValue(nv)}`);
    } else {
      lines.push(`${k}: ${stringifyValue(v)}`);
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

export function withFrontmatter(data, body) {
  return stringifyFrontmatter(data) + (body.startsWith('\n') ? body.slice(1) : body);
}

export function updateFrontmatter(text, patch) {
  const { data, body } = parseFrontmatter(text);
  return withFrontmatter({ ...data, ...patch }, body);
}
