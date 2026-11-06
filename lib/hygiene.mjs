import path from 'node:path';
import { escapeRegExp, matchAny } from './util.mjs';

const C_LIKE = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'go', 'java', 'kt', 'kts', 'scala', 'cs', 'c', 'h', 'cc', 'cpp',
  'hpp', 'rs', 'swift', 'dart', 'php', 'scss', 'less', 'prisma', 'groovy', 'gradle', 'proto', 'jsonc', 'vue', 'svelte',
  'astro', 'zig', 'm', 'mm',
]);
const CSS_ONLY = new Set(['css']);
const HASH = new Set([
  'py', 'rb', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'r', 'pl',
  'tf', 'hcl', 'nix', 'cmake', 'mk', 'env',
]);
const SQL = new Set(['sql']);
const MARKUP = new Set(['html', 'htm', 'xml', 'xhtml', 'svg', 'ejs', 'hbs', 'njk', 'erb']);
const HASH_NAMES = [/^dockerfile/i, /^makefile$/i, /^\.env/, /^\.gitignore$/, /^\.dockerignore$/, /^\.npmrc$/, /^\.editorconfig$/, /^jenkinsfile$/i];

const DIRECTIVES = new RegExp(
  [
    '//go:', '//\\s?\\+build', '//export ', '//line ', '//nolint', 'eslint-disable', 'eslint-enable', '@ts-expect-error',
    '@ts-ignore', '@ts-nocheck', '@ts-check', '/// <reference', 'prettier-ignore', 'biome-ignore', '(istanbul|c8|v8) ignore',
    'webpackChunkName', 'webpackIgnore', 'webpackPrefetch', 'webpackPreload', '@vite-ignore', '@vitest-environment',
    '@jest-environment', '@jsxImportSource', '@jsx ', 'stylelint-disable', 'stylelint-enable', 'Code generated .*DO NOT EDIT',
    '-- \\+goose', '-- \\+migrate', '//\\s*@(Summary|Description|Tags|Accept|Produce|Param|Success|Failure|Router|Security|ID|Header|Deprecated|title|version|host|BasePath|securityDefinitions)\\b',
    'godoc$', '# syntax=', '# escape=', 'shellcheck ', 'yaml-language-server', '# type: ignore', '# noqa', '# pylint:',
    '# fmt: (on|off|skip)', '# -\\*- coding', '# pragma', 'rubocop:', '#region', '#endregion', '<!--\\s*\\[if', '<!\\[endif\\]',
    '@license', '@preserve', 'SPDX-License-Identifier', 'tslint:', 'jscpd:ignore', 'cspell:', 'sonar-ignore', 'NOSONAR',
    '#nosec', 'nosemgrep', 'gitleaks:allow', 'codespell:ignore', '@generated',
  ].join('|'),
);

export function commentFamily(file) {
  const base = path.basename(file);
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  if (HASH_NAMES.some((r) => r.test(base))) return 'hash';
  if (C_LIKE.has(ext)) return 'c';
  if (CSS_ONLY.has(ext)) return 'css';
  if (HASH.has(ext)) return 'hash';
  if (SQL.has(ext)) return 'sql';
  if (MARKUP.has(ext)) return 'markup';
  return null;
}

function stripStrings(text) {
  return text
    .replace(/\\./g, '__')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``');
}

export function detectComment(file, text, lineNo = 0) {
  const fam = commentFamily(file);
  if (!fam) return null;
  if (lineNo === 1 && text.startsWith('#!')) return null;
  const t = text.trimStart();
  if (!t) return null;
  if (DIRECTIVES.test(text)) return null;
  const s = stripStrings(text);
  const st = s.trimStart();
  if (fam === 'c') {
    if (/^\/\/\s*$/.test(t)) return null;
    if (st.startsWith('//') || st.startsWith('/*') || st.startsWith('{/*') || /^\*(\s|\/|$)/.test(st)) return 'line';
    if (/\s\/\/\s/.test(s) || /[;,{})\]]\s*\/\//.test(s) || /\s\/\*/.test(s)) return 'trailing';
    if (/^<!--/.test(st)) return 'line';
    return null;
  }
  if (fam === 'css') {
    if (st.startsWith('/*') || /^\*(\s|\/|$)/.test(st)) return 'line';
    if (/\s\/\*/.test(s)) return 'trailing';
    return null;
  }
  if (fam === 'hash') {
    if (/^#(?!!)/.test(st)) return 'line';
    if (/\s#\s/.test(s)) return 'trailing';
    return null;
  }
  if (fam === 'sql') {
    if (st.startsWith('--') || st.startsWith('/*') || /^\*(\s|\/|$)/.test(st)) return 'line';
    if (/\s--\s/.test(s) || /\s\/\*/.test(s)) return 'trailing';
    return null;
  }
  if (fam === 'markup') {
    if (/<!--/.test(s)) return 'line';
    return null;
  }
  return null;
}

export function findComments(lines, { exempt = [] } = {}) {
  const hits = [];
  for (const l of lines) {
    if (matchAny(exempt, l.file)) continue;
    const kind = detectComment(l.file, l.text, l.line);
    if (kind) hits.push({ ...l, kind });
  }
  return hits;
}

export function defaultLeakPatterns(profile) {
  if (profile.trackHarness) return [];
  const ctx = escapeRegExp(profile.layout.moduleContext);
  return [
    '\\.flow/',
    `(?<![\\w.])${ctx}(?![\\w])`,
    '\\b(AGENTS|CLAUDE|GEMINI)\\.md\\b',
    '\\bPLAN--',
    '\\bR-\\d{4}\\b',
    '\\bflowctl\\b',
    '`flow [a-z]+',
    '\\bflow (doctor|commitmsg|prmsg|selftest|onboard|fingerprint|reindex|provenance)\\b',
    '\\bflow-(explore|plan|execute|post|learn|context|sync|init)\\b',
  ];
}

export function findLeaks(lines, patterns) {
  if (!patterns.length) return [];
  const re = new RegExp(patterns.join('|'), 'i');
  return lines.filter((l) => re.test(l.text));
}

const TRAILER = /^[A-Za-z][A-Za-z0-9-]*(-[A-Za-z0-9]+)*:\s+\S.*$/;
const ISSUE_REF = /^(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?|related|see)\s+([\w.-]+\/[\w.-]+)?#\d+(\s*,\s*#\d+)*\.?$/i;

export function checkCommitMessage(text, policy = 'trailers-only') {
  const lines = String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !l.startsWith('#'));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const problems = [];
  const title = (lines[0] || '').trim();
  if (!title) problems.push('Thiếu tiêu đề commit.');
  if (title.length > 100) problems.push(`Tiêu đề dài ${title.length} ký tự (>100).`);
  if (policy !== 'trailers-only') return problems;
  if (lines.length > 1 && lines[1].trim()) problems.push('Dòng 2 phải để trống.');
  lines.slice(2).forEach((l, i) => {
    const s = l.trim();
    if (!s) return;
    if (TRAILER.test(s) || ISSUE_REF.test(s)) return;
    problems.push(`Dòng ${i + 3} là văn xuôi, chỉ được phép trailer: "${s.slice(0, 80)}"`);
  });
  return problems;
}
