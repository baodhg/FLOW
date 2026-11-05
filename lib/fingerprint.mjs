import fs from 'node:fs';
import path from 'node:path';
import { familyOf } from './dup.mjs';
import { detectComment } from './hygiene.mjs';
import { declaredNames, namingFamily, namingSkipped, vietnameseHit } from './naming.mjs';
import { exists, git, matchAny, readText, toPosix } from './util.mjs';

const VN = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const CONVENTIONAL = /^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([^)]+\))?!?: \S/;
const TICKET = /\b([A-Z][A-Z0-9]{1,9})-\d+\b/;
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*:\s+\S/;
const SKIP = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/bin/**', '**/obj/**', '**/vendor/**', '**/generated/**', '**/migrations/**', '**/Migrations/**', '**/*.min.js', '**/*.d.ts', '**/.flow/**'];
const TESTS = ['**/*.test.*', '**/*.spec.*', '**/*_test.go', '**/test/**', '**/tests/**', '**/__tests__/**', '**/*Tests/**', '**/*.Tests/**', '**/*Tests.cs', '**/*Test.java', '**/test_*.py'];

const AGENT_FILES = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', '.clinerules', 'CONVENTIONS.md', '.github/copilot-instructions.md'];
const AGENT_DIRS = ['.cursor/rules', '.github/instructions', '.clinerules', '.claude/commands', '.claude/skills', '.agents/skills', '.agents/rules'];
const PR_TEMPLATES = ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'pull_request_template.md'];
const LINT = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', '.prettierrc', '.prettierrc.json', 'prettier.config.js', 'biome.json', '.editorconfig', '.golangci.yml', '.golangci.yaml', 'ruff.toml', '.flake8', 'Directory.Build.props', 'stylecop.json', '.stylelintrc', 'checkstyle.xml', 'detekt.yml', 'commitlint.config.js', '.commitlintrc', '.commitlintrc.json', '.husky/commit-msg', 'lefthook.yml'];
const CHECK_CMD = /\b(lint|test|tests|build|typecheck|type-check|tsc|vet|fmt|format|check|verify|pytest|ruff|mypy|mvn|gradle|cargo|dotnet (build|test|format)|go (build|test|vet)|npm (run|test)|pnpm|yarn|bun|make (test|lint|check))\b/i;
const NOT_CHECK = /\b(deploy|publish|docker (push|login)|kubectl|helm|ssh|scp|rsync|aws|az |gcloud|terraform apply|secrets|release|upload|curl|wget|echo|cat |cd |export )\b/i;
const DEPLOY_HINT = /\b(deploy|release|production|prod|kubectl|helm|ecs|cloud ?run|app ?service|vercel|netlify|fly(ctl)?|heroku)\b/i;

function lines(out) {
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function ratio(n, d) {
  return d ? Math.round((n / d) * 1000) / 1000 : 0;
}

function diacriticShare(text) {
  const words = String(text || '').split(/\s+/).filter((w) => /[A-Za-zÀ-ỹ]{2,}/.test(w));
  return ratio(words.filter((w) => VN.test(w)).length, words.length);
}

function gitStats(dir) {
  const commits = Number(git(dir, ['rev-list', '--count', 'HEAD']).out.trim() || 0);
  const first = lines(git(dir, ['log', '--max-parents=0', '--format=%cI']).out).pop() || '';
  const last = lines(git(dir, ['log', '-1', '--format=%cI']).out)[0] || '';
  const ageDays = first ? Math.floor((Date.now() - new Date(first).getTime()) / 86400000) : 0;
  const contributors90 = lines(git(dir, ['shortlog', '-sne', '--since=90.days', 'HEAD']).out).length;
  const contributorsAll = lines(git(dir, ['shortlog', '-sne', 'HEAD']).out).length;
  const tags = lines(git(dir, ['tag']).out).length;
  return { commits, first, last, ageDays, contributors90, contributorsAll, tags };
}

function remoteInfo(dir) {
  const remotes = lines(git(dir, ['remote']).out);
  const name = remotes.includes('origin') ? 'origin' : remotes[0];
  const url = name ? git(dir, ['remote', 'get-url', name]).out.trim().replace(/\/\/[^@/]+@/, '//') : '';
  const host = /github\.com/i.test(url) ? 'github' : /gitlab/i.test(url) ? 'gitlab' : /bitbucket/i.test(url) ? 'bitbucket' : /dev\.azure|visualstudio/i.test(url) ? 'azure' : url ? 'other' : 'none';
  const defaultBranch = name ? git(dir, ['symbolic-ref', '--short', `refs/remotes/${name}/HEAD`]).out.trim().replace(`${name}/`, '') : '';
  const strip = (s) => {
    for (const r of remotes) if (s.startsWith(`${r}/`)) return s.slice(r.length + 1);
    return s;
  };
  const branches = [...new Set(lines(git(dir, ['branch', '-a', '--format=%(refname:short)']).out).map(strip).filter((b) => b !== 'HEAD' && !b.endsWith('/HEAD')))];
  return { remote: name || '', url, host, defaultBranch, branches };
}

function branchConventions(branches, defaultBranch) {
  const longLived = ['main', 'master', 'develop', 'dev', 'staging', 'qc', 'uat', 'production', 'prod', 'product', 'release', 'hotfix', 'hot-fix'];
  const work = branches.filter((b) => !longLived.includes(b) && !/^release[/-]/.test(b));
  const prefixes = {};
  for (const b of work) {
    const m = /^([a-z]+)[/-]/i.exec(b);
    if (m) prefixes[m[1].toLowerCase()] = (prefixes[m[1].toLowerCase()] || 0) + 1;
  }
  const top = Object.entries(prefixes).sort((a, b) => b[1] - a[1])[0];
  const ticketInBranch = ratio(work.filter((b) => TICKET.test(b.toUpperCase()) && /[A-Z]+-\d+/i.test(b)).length, work.length);
  const protectedGuess = branches.filter((b) => [defaultBranch, 'main', 'master', 'production', 'prod', 'product', 'staging', 'release'].includes(b));
  if (branches.some((b) => /^release[/-]/.test(b))) protectedGuess.push('release/*');
  const integration = ['develop', 'dev', 'qc'].find((b) => branches.includes(b)) || defaultBranch || '';
  return {
    workBranches: work.length,
    prefixes,
    pattern: top && top[1] >= 2 ? `${top[0]}/${ticketInBranch >= 0.5 ? '<ticket>-' : ''}<slug>` : '',
    protectedGuess: [...new Set(protectedGuess.filter(Boolean))],
    integration,
  };
}

function commitConventions(dir) {
  const raw = git(dir, ['log', '-n', '300', '--no-merges', '--format=%x1e%s%x1f%b']).out;
  const entries = raw.split('\x1e').map((e) => e.trim()).filter(Boolean).map((e) => {
    const [subject = '', body = ''] = e.split('\x1f');
    return { subject: subject.trim(), body: body.trim() };
  });
  const n = entries.length;
  const prose = entries.filter((e) => e.body.split('\n').some((l) => l.trim() && !TRAILER.test(l.trim()) && !/^(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?)\s+#\d+/i.test(l.trim())));
  const tickets = {};
  for (const e of entries) {
    const m = TICKET.exec(e.subject);
    if (m) tickets[m[1]] = (tickets[m[1]] || 0) + 1;
  }
  const topTicket = Object.entries(tickets).sort((a, b) => b[1] - a[1])[0];
  const avgLen = n ? Math.round(entries.reduce((s, e) => s + e.subject.length, 0) / n) : 0;
  return {
    sample: n,
    conventional: ratio(entries.filter((e) => CONVENTIONAL.test(e.subject)).length, n),
    ticket: ratio(entries.filter((e) => TICKET.test(e.subject)).length, n),
    ticketKey: topTicket ? topTicket[0] : '',
    vietnamese: ratio(entries.filter((e) => VN.test(e.subject) || vietnameseHit(e.subject.replace(/[^A-Za-z ]/g, ' ').trim().replace(/\s+/g, '_'))).length, n),
    withProseBody: ratio(prose.length, n),
    signedOff: ratio(entries.filter((e) => /^Signed-off-by:/m.test(e.body)).length, n),
    coAuthoredAi: ratio(entries.filter((e) => /co-authored-by:.*(claude|anthropic|codex|openai|copilot|gemini)/i.test(e.body)).length, n),
    avgTitleLength: avgLen,
    examples: entries.slice(0, 5).map((e) => e.subject),
  };
}

function ciCommands(dir, files) {
  const ciFiles = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f) || /(^|\/)\.gitlab-ci\.ya?ml$/.test(f) || /^azure-pipelines\.ya?ml$/.test(f) || /^bitbucket-pipelines\.ya?ml$/.test(f) || /(^|\/)Jenkinsfile$/.test(f));
  const commands = [];
  let deploy = false;
  for (const f of ciFiles) {
    const text = readText(path.join(dir, f)) || '';
    if (DEPLOY_HINT.test(text)) deploy = true;
    const ls = text.split(/\r?\n/);
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      const run = /^\s*(?:-\s*)?run:\s*(.*)$/.exec(l);
      const script = /^\s*-\s+(?!name:|uses:|run:|with:|if:)(.+)$/.exec(l);
      if (run) {
        if (run[1] && !/^[|>]-?\s*$/.test(run[1])) commands.push({ file: f, cmd: run[1].trim() });
        else {
          const indent = l.search(/\S/);
          for (let j = i + 1; j < ls.length && (ls[j].trim() === '' || ls[j].search(/\S/) > indent); j++) if (ls[j].trim()) commands.push({ file: f, cmd: ls[j].trim() });
        }
      } else if (/gitlab-ci/.test(f) && script) commands.push({ file: f, cmd: script[1].trim().replace(/^["']|["']$/g, '') });
    }
    if (/Jenkinsfile$/.test(f)) {
      for (const m of text.matchAll(/\b(?:sh|bat|powershell)\s*\(?\s*(?:script:\s*)?(['"])((?:(?!\1).)+)\1/g)) commands.push({ file: f, cmd: m[2].trim() });
      for (const m of text.matchAll(/\b(?:sh|bat)\s*\(?\s*(?:script:\s*)?('''|""")([\s\S]*?)\1/g)) m[2].split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((cmd) => commands.push({ file: f, cmd }));
    }
  }
  const checks = commands.filter((c) => CHECK_CMD.test(c.cmd) && !NOT_CHECK.test(c.cmd) && c.cmd.length < 160);
  const uniq = [...new Map(checks.map((c) => [c.cmd, c])).values()];
  return { files: ciFiles, checks: uniq.slice(0, 20), deploy };
}

function codeSample(dir, files) {
  const code = files.filter((f) => familyOf(f) && !matchAny(SKIP, f) && !matchAny(TESTS, f));
  const step = Math.max(1, Math.floor(code.length / 400));
  const sample = code.filter((_, i) => i % step === 0).slice(0, 400);
  let total = 0;
  let commentLines = 0;
  let docBlocks = 0;
  let names = 0;
  let vnNames = 0;
  const vnExamples = [];
  for (const f of sample) {
    const text = readText(path.join(dir, f));
    if (text === null || text.length > 400000) continue;
    const ls = text.split(/\r?\n/);
    ls.forEach((l, i) => {
      if (!l.trim()) return;
      total++;
      if (detectComment(f, l, i + 1)) commentLines++;
      if (/^\s*(\/\*\*|\/\/\/\s|"""|''')/.test(l)) docBlocks++;
    });
    if (namingFamily(f) && !namingSkipped(f)) {
      for (const n of new Set(declaredNames(f, text))) {
        names++;
        if (vietnameseHit(n)) {
          vnNames++;
          if (vnExamples.length < 6) vnExamples.push(n);
        }
      }
    }
  }
  return {
    codeFiles: code.length,
    sampled: sample.length,
    commentDensity: ratio(commentLines, total),
    docBlocksPerKloc: total ? Math.round((docBlocks / total) * 1000 * 10) / 10 : 0,
    identifiers: names,
    vietnameseIdentifiers: ratio(vnNames, names),
    vietnameseExamples: vnExamples,
  };
}

function testConventions(files) {
  const tests = files.filter((f) => matchAny(TESTS, f) && !matchAny(SKIP, f));
  const inDir = tests.filter((f) => /(^|\/)(test|tests|__tests__)\/|\.Tests?\//.test(f)).length;
  const suffix = {};
  for (const f of tests) {
    const m = /(\.(test|spec)\.[a-z]+|_test\.go|Tests?\.(cs|java|kt))$/.exec(f);
    if (m) suffix[m[1]] = (suffix[m[1]] || 0) + 1;
  }
  return { count: tests.length, layout: !tests.length ? 'none' : inDir / tests.length >= 0.6 ? 'dir' : 'colocated', suffix: Object.entries(suffix).sort((a, b) => b[1] - a[1]).map(([s]) => s)[0] || '' };
}

const NO_COMMENTS = /(MÃ KHÔNG CHÚ THÍCH|không (được )?(viết |thêm )?chú thích( mới)?|mã không (có )?chú thích|no (code )?comments|do not (add|write) (code )?comments|comment-free code)/i;
const WHOLE_FILE = /(CẢ TỆP|cả tệp bị chạm|whole file|entire file)/i;
const TRAILERS_ONLY = /(thân commit[^\n]{0,60}(BỎ|chỉ (có )?trailer|không (một dòng )?văn xuôi)|commit body[^\n]{0,60}(trailers? only|no prose))/i;
const ENGLISH_CODE = /((tên|định danh)[^\n]{0,40}tiếng Anh|identifiers?[^\n]{0,40}English|code (must be )?in English)/i;

export function rootDeclaredRules(dir) {
  const files = [...AGENT_FILES, 'CONTRIBUTING.md'].filter((f) => exists(path.join(dir, f)));
  return declaredRules(dir, files, '');
}

function declaredRules(dir, agentFiles, contributing) {
  const texts = [...agentFiles, contributing]
    .filter((f) => f && /\.(md|mdc|txt)$|rules$/i.test(f))
    .map((f) => ({ f, text: (readText(path.join(dir, f)) || '').slice(0, 300000) }))
    .filter((x) => x.text);
  const find = (re) => texts.find((x) => re.test(x.text))?.f || '';
  const commentsFile = find(NO_COMMENTS);
  let comments = '';
  if (commentsFile) {
    const t = texts.find((x) => x.f === commentsFile).text;
    const at = t.search(NO_COMMENTS);
    const win = t.slice(Math.max(0, at - 200), at + 3000);
    comments = /(cả hàm|cả method|cả khai báo|whole function|entire function)/i.test(win) ? 'unit' : WHOLE_FILE.test(win) ? 'file' : 'unit';
  }
  return {
    comments,
    commentsSource: commentsFile,
    trailersOnly: find(TRAILERS_ONLY),
    englishCode: find(ENGLISH_CODE),
  };
}

export function fingerprintRepo(dir) {
  const files = lines(git(dir, ['ls-files']).out);
  const has = (p) => files.includes(p) || exists(path.join(dir, p));
  const stats = gitStats(dir);
  const remote = remoteInfo(dir);
  const branches = branchConventions(remote.branches, remote.defaultBranch);
  const commits = commitConventions(dir);
  const ci = ciCommands(dir, files);
  const code = codeSample(dir, files);
  const tests = testConventions(files);
  const prTemplate = PR_TEMPLATES.find(has) || files.find((f) => /^\.github\/PULL_REQUEST_TEMPLATE\/.+\.md$/i.test(f) || /^\.gitlab\/merge_request_templates\/.+\.md$/.test(f)) || '';
  const prText = prTemplate ? readText(path.join(dir, prTemplate)) || '' : '';
  const readme = ['README.md', 'readme.md', 'README'].find(has);
  const agentFiles = [...AGENT_FILES.filter(has), ...AGENT_DIRS.filter((d) => fs.existsSync(path.join(dir, d)))];
  const lint = LINT.filter(has);
  const prod = {
    dockerfiles: files.filter((f) => /(^|\/)Dockerfile[^/]*$/.test(f)).length,
    compose: files.some((f) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f)),
    infra: files.some((f) => /(^|\/)(k8s|kubernetes|helm|charts|deploy|infra|terraform)\//.test(f) || /\.tf$/.test(f)),
    deployCi: ci.deploy,
    envProd: files.some((f) => /\.env\.(prod|production)/.test(f)),
  };
  const prodSignals = [prod.dockerfiles > 0, prod.compose, prod.infra, prod.deployCi, prod.envProd].filter(Boolean).length;
  const legacyHarness = ['.context', '.context/invariants.md', 'docs/specs'].filter((p) => fs.existsSync(path.join(dir, p)));
  const contributingFile = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md'].find(has) || '';
  const declared = declaredRules(dir, agentFiles, contributingFile);
  let kind = 'existing';
  if (stats.commits <= 30 && stats.ageDays <= 90 && code.codeFiles < 60) kind = 'greenfield';
  else if (((stats.ageDays > 365 || stats.commits > 1500 || stats.tags >= 10) && (prodSignals >= 1 || stats.contributorsAll >= 3)) || (prodSignals >= 2 && (stats.ageDays > 180 || stats.commits > 500))) kind = 'legacy-prod';
  else if (stats.contributors90 >= 3) kind = 'team';
  return {
    dir: toPosix(dir),
    kind,
    stats,
    remote: { host: remote.host, url: remote.url, defaultBranch: remote.defaultBranch, branchCount: remote.branches.length },
    branches,
    commits,
    ci,
    code,
    tests,
    pr: { template: prTemplate, vietnamese: diacriticShare(prText) },
    readme: { file: readme || '', vietnamese: readme ? diacriticShare(readText(path.join(dir, readme))) : 0 },
    contributing: contributingFile,
    declared,
    codeowners: ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'].find(has) || '',
    agentFiles,
    lint,
    prod,
    prodSignals,
    legacyHarness,
  };
}
