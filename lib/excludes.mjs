import path from 'node:path';
import { exists, git, gitPath, readText, toPosix, writeText } from './util.mjs';
import { FLOW_DIR, discoverRepos } from './workspace.mjs';

const BEGIN = '# >>> agent-flow (local-only harness, managed by flowctl)';
const END = '# <<< agent-flow';

export function excludePatterns(flow, repo) {
  const ctx = flow.profile.layout.moduleContext;
  const pats = new Set();
  const flowRel = toPosix(path.relative(repo.dir, flow.root));
  const flowInside = !flowRel.startsWith('..') && !path.isAbsolute(flowRel);
  if (flow.profile.trackHarness) {
    if (flowInside) {
      const prefix = flowRel && flowRel !== '' ? `/${flowRel}` : '';
      pats.add(`${prefix}/${FLOW_DIR}/runs/`);
      pats.add(`${prefix}/${FLOW_DIR}/state.json`);
    }
    return [...pats];
  }
  pats.add(`/${FLOW_DIR}/`);
  if (flowInside && flowRel) pats.add(`/${flowRel}/${FLOW_DIR}/`);
  pats.add(ctx);
  pats.add(`${ctx.replace(/\.md$/i, '')}.history.md`);
  return [...pats];
}

export function ensureExcludes(flow, { dryRun = false } = {}) {
  const report = [];
  for (const repo of discoverRepos(flow)) {
    const file = gitPath(repo.dir, 'info/exclude');
    if (!file) {
      report.push({ repo: repo.name, status: 'không phải git repo' });
      continue;
    }
    const wanted = excludePatterns(flow, repo);
    const current = readText(file) || '';
    const re = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}\\n?`);
    const block = `${BEGIN}\n${wanted.join('\n')}\n${END}\n`;
    let next;
    if (re.test(current)) next = current.replace(re, block);
    else next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}${block}`;
    const changed = next !== current;
    if (changed && !dryRun) writeText(file, next);
    report.push({ repo: repo.name, file, patterns: wanted, changed });
  }
  return report;
}

export function verifyExcludes(flow) {
  const ctx = flow.profile.layout.moduleContext;
  const results = [];
  for (const repo of discoverRepos(flow)) {
    if (!exists(path.join(repo.dir, '.git'))) continue;
    const probes = [];
    if (!flow.profile.trackHarness) {
      probes.push(`some/module/${ctx}`);
      const flowRel = toPosix(path.relative(repo.dir, flow.root));
      if (!flowRel.startsWith('..')) probes.push(`${flowRel ? `${flowRel}/` : ''}${FLOW_DIR}/profile.json`);
    }
    const ignored = probes.map((p) => ({ probe: p, ignored: git(repo.dir, ['check-ignore', '-q', '--no-index', p]).status === 0 }));
    const trackedOut = git(repo.dir, ['ls-files']).out.split('\n').filter(Boolean);
    const leakRe = new RegExp(`(^|/)\\${FLOW_DIR}/|(^|/)${ctx.replace(/\./g, '\\.')}$`);
    const tracked = flow.profile.trackHarness ? [] : trackedOut.filter((f) => leakRe.test(f));
    results.push({ repo: repo.name, ignored, tracked });
  }
  return results;
}
