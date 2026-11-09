import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mask, scanSecretsInLine } from './secrets.mjs';
import { parseDecisions, parseTasks, readPlans } from './store.mjs';
import { exists, git, gitRoot, headCommit, isDir, pad2, readText, today, toPosix, truncate } from './util.mjs';
import { openFlow, scopeRepos } from './workspace.mjs';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const REPORT_FILE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})-.+\.md$/;
const NOTE = /^- (\d{4}-\d{2}-\d{2}) \[([^\]]+)\] (.*)$/;
const SQUASH_SUFFIX = /\s*\(#(\d+)\)\s*$/;
const DONE_MARK = /\s*✓ (\d{4}-\d{2}-\d{2})(?: · (\S+))?\s*$/;
const FIELD = '\x1f';
const RECORD = '\x1e';
const BODY_END = '\x1d';
const LOG_FORMAT = `--format=${RECORD}${['%H', '%S', '%an', '%ae', '%aI', '%s', '%b'].join(FIELD)}${BODY_END}`;
const PR_FIELDS = 'number,title,url,isDraft,createdAt,updatedAt,mergedAt,headRefName,reviewDecision,statusCheckRollup';
const TICKET_KEY = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g;
const ISSUE_REF = /(?<![\w/&])#(\d+)\b/g;
const NOT_TICKET_KEYS = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'MD', 'CVE', 'GPT', 'ES', 'UTC', 'GMT', 'AES', 'RSA', 'ARM', 'BASE', 'X86', 'IPV', 'CP', 'WIN']);
const FAILED_CHECKS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PASSED_CHECKS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const PR_LIMIT = '50';
const GH_TIMEOUT_MS = 20000;
const MAX_LISTED_FILES = 30;
const MAX_TEXT = 200;
const MAX_DAY_START = 12;
const LIVE_PLAN_STATUSES = new Set(['DRAFT', 'APPROVED', 'EXECUTING', 'VERIFYING', 'PARKED']);
const NAMED_PERIODS = ['today', 'yesterday', 'last-workday', 'week', 'since-last'];

function dayAt(date, offsetDays, hour) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays, hour);
}

function currentDayStart(now, hour) {
  const start = dayAt(now, 0, hour);
  return now < start ? dayAt(now, -1, hour) : start;
}

function lastWorkdayStart(current, hour) {
  const stepsBack = { 0: 2, 1: 3 }[current.getDay()] ?? 1;
  return dayAt(current, -stepsBack, hour);
}

function parseDay(text, hour) {
  const match = DATE.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function validDayStart(value) {
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > MAX_DAY_START) throw new Error(`--day-starts-at phải là số giờ từ 0 đến ${MAX_DAY_START}.`);
  return hour;
}

function namedWindow(since, current, hour, now, previousAt) {
  switch (since) {
    case 'today':
      return { start: current, end: now };
    case 'yesterday':
      return { start: dayAt(current, -1, hour), end: current };
    case 'last-workday':
      return { start: lastWorkdayStart(current, hour), end: current };
    case 'week':
      return { start: dayAt(current, -((current.getDay() + 6) % 7), hour), end: now };
    default:
      return previousAt && previousAt <= now ? { start: previousAt, end: now } : { start: lastWorkdayStart(current, hour), end: now, fallback: true };
  }
}

function datedWindow(since, until, hour, now) {
  const first = parseDay(since, hour);
  if (!first) throw new Error(`Không hiểu khoảng "${since}". Dùng ${NAMED_PERIODS.join(', ')} hoặc YYYY-MM-DD.`);
  if (first > now) throw new Error(`${since} nằm trong tương lai.`);
  const last = until ? parseDay(until, hour) : first;
  if (!last) throw new Error(`Không hiểu ngày "${until}". Dùng YYYY-MM-DD.`);
  if (last < first) throw new Error('--until phải từ --since trở đi.');
  return { start: first, end: dayAt(last, 1, hour) };
}

export function resolveWindow({ since = 'today', until, dayStartsAt = 0, now = new Date(), previousAt = null }) {
  const hour = validDayStart(dayStartsAt);
  const named = NAMED_PERIODS.includes(since);
  if (named && until) throw new Error('--until chỉ dùng cùng một ngày cụ thể ở --since.');
  const range = named ? namedWindow(since, currentDayStart(now, hour), hour, now, previousAt) : datedWindow(since, until, hour, now);
  return { label: since, fallback: false, ...range };
}

function createRedactor() {
  const state = { count: 0 };
  const clean = (text) => {
    let output = String(text ?? '');
    for (const finding of scanSecretsInLine({ file: 'report.txt', line: 1, text: output })) {
      output = output.split(finding.value).join(mask(finding.value));
      state.count++;
    }
    return output;
  };
  return { clean, state };
}

function splitList(value) {
  return [value]
    .flat()
    .filter((item) => typeof item === 'string')
    .flatMap((item) => item.split(','))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function configValue(dir, key) {
  const result = git(dir, ['config', key]);
  return result.ok ? result.out.trim() : '';
}

function resolveIdentities(repos, author) {
  const values = new Set(splitList(author));
  const shown = { names: new Set(), emails: new Set() };
  for (const repo of repos) {
    const name = configValue(repo.dir, 'user.name');
    const email = configValue(repo.dir, 'user.email');
    if (name) shown.names.add(name);
    if (email) shown.emails.add(email);
    for (const value of [name, email]) if (value) values.add(value.toLowerCase());
  }
  return { values, names: [...shown.names], emails: [...shown.emails], extra: splitList(author) };
}

function parseCommitLog(text) {
  return text
    .split(RECORD)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const bodyEnd = chunk.indexOf(BODY_END);
      const [hash, source, name, email, at, subject, ...body] = chunk.slice(0, bodyEnd).split(FIELD);
      const stats = chunk.slice(bodyEnd + 1).split('\n').filter(Boolean).map((line) => line.split('\t'));
      return {
        body: body.join(FIELD),
        hash,
        ref: source.replace(/^refs\/(heads|remotes)\//, ''),
        name,
        email,
        at,
        subject,
        files: stats.map((parts) => parts[2]).filter(Boolean),
        added: stats.reduce((sum, parts) => sum + (Number(parts[0]) || 0), 0),
        removed: stats.reduce((sum, parts) => sum + (Number(parts[1]) || 0), 0),
      };
    });
}

function ticketsIn(...texts) {
  const found = new Set();
  for (const text of texts) {
    const plain = String(text ?? '').replace(SQUASH_SUFFIX, '');
    for (const match of plain.matchAll(TICKET_KEY)) if (!NOT_TICKET_KEYS.has(match[1])) found.add(match[0]);
    for (const match of plain.matchAll(ISSUE_REF)) found.add(match[0]);
  }
  return [...found].sort();
}

function checkState(rollup) {
  if (!rollup?.length) return 'none';
  const states = rollup.map((check) => check.conclusion || check.state || check.status || '');
  if (states.some((state) => FAILED_CHECKS.has(state))) return 'failing';
  return states.every((state) => PASSED_CHECKS.has(state)) ? 'passing' : 'pending';
}

function isBot(commit) {
  return /\[bot\]/i.test(commit.name) || /\[bot\]/i.test(commit.email);
}

function readCommits(dir, window) {
  if (!headCommit(dir)) return [];
  const since = `--since=${window.start.toISOString()}`;
  const result = git(dir, ['log', '--branches', '--remotes', 'HEAD', '--no-merges', '--source', since, LOG_FORMAT, '--numstat']);
  if (!result.ok) throw new Error(`Không đọc được lịch sử git ở ${dir}: ${result.err}`);
  return parseCommitLog(result.out).filter((commit) => {
    const at = new Date(commit.at);
    return at >= window.start && at < window.end;
  });
}

function unpushedHashes(dir, window) {
  if (!headCommit(dir)) return new Set();
  const result = git(dir, ['rev-list', '--branches', 'HEAD', '--not', '--remotes', `--since=${window.start.toISOString()}`]);
  return new Set(result.ok ? result.out.split('\n').filter(Boolean) : []);
}

function defaultBranchOf(dir) {
  const remoteHead = git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead.ok) return remoteHead.out.trim();
  return ['origin/main', 'origin/master', 'main', 'master'].find((name) => git(dir, ['rev-parse', '--verify', '-q', name]).ok) || 'HEAD';
}

function hashesOn(dir, branch, window) {
  if (!headCommit(dir)) return new Set();
  const result = git(dir, ['rev-list', branch, `--since=${window.start.toISOString()}`]);
  return new Set(result.ok ? result.out.split('\n').filter(Boolean) : []);
}

function releasesIn(dir, branch, window, clean) {
  if (!headCommit(dir)) return [];
  const listed = git(dir, ['for-each-ref', 'refs/tags', `--merged=${branch}`, `--format=%(refname:short)${FIELD}%(creatordate:iso-strict)`]);
  if (!listed.ok) return [];
  return listed.out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(FIELD))
    .filter(([, at]) => new Date(at) >= window.start && new Date(at) < window.end)
    .map(([tag, at]) => ({ tag: clean(tag), at }));
}

function copyScore(commit) {
  return (commit.onDefault ? 2 : 0) + (commit.pushed ? 1 : 0);
}

function keepBestCopy(commits) {
  const byWork = new Map();
  for (const commit of commits) {
    const key = `${commit.at}|${commit.subject}`;
    const seen = byWork.get(key);
    if (!seen || copyScore(commit) > copyScore(seen)) byWork.set(key, commit);
  }
  return [...byWork.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
}

function dropMergedCopies(commits) {
  const bare = (commit) => commit.subject.replace(SQUASH_SUFFIX, '');
  const merged = new Set(commits.filter((commit) => commit.onDefault).map(bare));
  return commits.filter((commit) => commit.onDefault || !merged.has(bare(commit)));
}

function pullRequestOf(commit, subject, branch, pullRequests) {
  const numbered = Number(SQUASH_SUFFIX.exec(commit.subject)?.[1]);
  if (numbered) return numbered;
  if (!pullRequests.available) return null;
  const known = [...pullRequests.merged, ...pullRequests.open];
  const found = known.find((item) => item.title === subject) || (commit.onDefault ? undefined : known.find((item) => item.headRefName === branch));
  return found?.number ?? null;
}

function otherAuthorsOf(commits, identities) {
  const counted = new Map();
  for (const commit of commits) {
    const key = commit.email.toLowerCase();
    const entry = counted.get(key) || { name: commit.name, email: commit.email, commits: 0 };
    entry.commits++;
    counted.set(key, entry);
  }
  return [...counted.values()].filter((entry) => !identities.values.has(entry.email.toLowerCase()) && !identities.values.has(entry.name.toLowerCase()));
}

function parseWorktrees(text) {
  return text
    .split('\n\n')
    .map((block) => ({
      dir: /^worktree (.+)$/m.exec(block)?.[1],
      branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] || '',
    }))
    .filter((entry) => entry.dir && isDir(entry.dir));
}

function readWorktrees(dir, clean) {
  const listed = git(dir, ['worktree', 'list', '--porcelain']);
  if (!listed.ok) return [];
  return parseWorktrees(listed.out).flatMap((entry) => {
    const status = git(entry.dir, ['status', '--porcelain=v1']);
    const lines = status.ok ? status.out.split('\n').filter(Boolean) : [];
    if (!lines.length) return [];
    return [{ path: toPosix(entry.dir), branch: clean(entry.branch), changed: lines.length, files: lines.slice(0, MAX_LISTED_FILES).map((line) => line.slice(3)) }];
  });
}

function runGh(cwd, args) {
  const result = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, missing: result.error?.code === 'ENOENT', out: result.stdout || '' };
}

function readPrList(dir, gh, args) {
  const result = gh(dir, ['pr', 'list', ...args, '--limit', PR_LIMIT, '--json', PR_FIELDS]);
  if (!result.ok) return { error: result.missing ? 'gh-missing' : 'gh-failed' };
  try {
    return { items: JSON.parse(result.out) };
  } catch {
    return { error: 'gh-failed' };
  }
}

function pullRequestView({ statusCheckRollup, ...item }, clean) {
  return {
    ...item,
    title: clean(item.title),
    headRefName: item.headRefName === undefined ? undefined : clean(item.headRefName),
    tickets: ticketsIn(item.title, item.headRefName),
    checks: checkState(statusCheckRollup),
  };
}

export function collectPullRequests(dir, window, gh = runGh, clean = (text) => text) {
  const remote = git(dir, ['remote', 'get-url', 'origin']);
  if (!remote.ok) return { available: false, reason: 'no-remote' };
  if (!/github\.com[:/]/i.test(remote.out)) return { available: false, reason: 'not-github' };
  const fromDay = window.start.toISOString().slice(0, 10);
  const open = readPrList(dir, gh, ['--author', '@me', '--state', 'open']);
  const merged = readPrList(dir, gh, ['--author', '@me', '--state', 'merged', '--search', `merged:>=${fromDay}`]);
  const reviewed = readPrList(dir, gh, ['--state', 'all', '--search', `reviewed-by:@me -author:@me updated:>=${fromDay}`]);
  const failed = [open, merged, reviewed].find((list) => list.error);
  if (failed) return { available: false, reason: failed.error };
  const within = (value) => new Date(value) >= window.start && new Date(value) < window.end;
  return {
    available: true,
    open: open.items.map((item) => ({ ...pullRequestView(item, clean), touched: within(item.updatedAt) })),
    merged: merged.items.filter((item) => within(item.mergedAt)).map((item) => pullRequestView(item, clean)),
    reviewed: reviewed.items.filter((item) => new Date(item.updatedAt) >= window.start).map((item) => pullRequestView(item, clean)),
  };
}

function collectRepo(repo, window, identities, gh, clean) {
  const unpushed = unpushedHashes(repo.dir, window);
  const written = readCommits(repo.dir, window).filter((commit) => !isBot(commit));
  const mine = written.filter((commit) => identities.values.has(commit.email.toLowerCase()) || identities.values.has(commit.name.toLowerCase()));
  const defaultBranch = defaultBranchOf(repo.dir);
  const defaultName = defaultBranch.replace(/^origin\//, '');
  const onDefault = hashesOn(repo.dir, defaultBranch, window);
  const pullRequests = collectPullRequests(repo.dir, window, gh, clean);
  const located = mine.map((commit) => ({ ...commit, pushed: !unpushed.has(commit.hash), onDefault: onDefault.has(commit.hash) }));
  const commits = dropMergedCopies(keepBestCopy(located)).map((commit) => {
    const subject = clean(commit.subject);
    const branch = commit.onDefault ? defaultName : clean(commit.ref.replace(/^origin\//, ''));
    return {
      hash: commit.hash.slice(0, 12),
      ref: branch,
      at: commit.at,
      subject,
      pr: pullRequestOf(commit, subject, branch, pullRequests),
      tickets: ticketsIn(commit.subject, commit.body, commit.onDefault ? '' : commit.ref),
      onDefault: commit.onDefault,
      pushed: commit.pushed,
      files: commit.files.slice(0, MAX_LISTED_FILES),
      fileCount: commit.files.length,
      added: commit.added,
      removed: commit.removed,
    };
  });
  const stashes = git(repo.dir, ['stash', 'list']);
  return {
    name: repo.name,
    path: toPosix(repo.dir),
    branch: clean(git(repo.dir, ['branch', '--show-current']).out.trim()),
    commits,
    otherAuthors: otherAuthorsOf(written, identities),
    worktrees: readWorktrees(repo.dir, clean),
    stashes: stashes.ok ? stashes.out.split('\n').filter(Boolean).length : 0,
    releases: releasesIn(repo.dir, defaultBranch, window, clean),
    pullRequests,
  };
}

function ledgerNotes(text) {
  const at = text.indexOf('\n## 9. Ledger');
  if (at < 0) return [];
  return text
    .slice(at)
    .split('\n')
    .map((line) => NOTE.exec(line))
    .filter(Boolean)
    .map((match) => ({ date: match[1], kind: match[2], text: match[3].trim() }));
}

function collectPlans(flow, window, clean) {
  if (!flow) return [];
  const firstDay = today(window.start);
  const lastDay = today(new Date(window.end.getTime() - 1));
  const inPeriod = (day) => day >= firstDay && day <= lastDay;
  const shortText = (text) => clean(truncate(text, MAX_TEXT));
  return readPlans(flow.paths.plans).flatMap((plan) => {
    const text = readText(plan.file) || '';
    const tasks = parseTasks(text).filter((task) => !task.placeholder);
    const doneInWindow = tasks.flatMap((task) => {
      const mark = task.open ? null : DONE_MARK.exec(task.body);
      return mark && inPeriod(mark[1]) ? [{ id: task.id, body: shortText(task.body.replace(DONE_MARK, '')), commit: mark[2] || '' }] : [];
    });
    const notes = ledgerNotes(text).filter((note) => inPeriod(note.date)).map((note) => ({ ...note, text: shortText(note.text) }));
    if (!LIVE_PLAN_STATUSES.has(plan.status) && !doneInWindow.length && !notes.length) return [];
    return [{
      slug: plan.slug,
      title: clean(plan.title),
      status: plan.status,
      branch: clean(plan.branch),
      done: tasks.filter((task) => !task.open).length,
      total: tasks.length,
      doneInWindow,
      open: tasks.filter((task) => task.open).map((task) => ({ id: task.id, body: shortText(task.body) })),
      openDecisions: parseDecisions(text).filter((item) => item.open && !item.placeholder).map((item) => ({ id: item.id, body: shortText(item.body) })),
      notes,
    }];
  });
}

function repoTargets(cwd, flow, all) {
  if (flow) return scopeRepos(flow, { all });
  const root = gitRoot(cwd);
  if (root) return [{ name: path.basename(root), dir: root }];
  return fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && exists(path.join(cwd, entry.name, '.git')))
    .map((entry) => ({ name: entry.name, dir: path.join(cwd, entry.name) }));
}

function latestReport(dir) {
  if (!dir || !isDir(dir)) return null;
  const newest = fs.readdirSync(dir).filter((name) => REPORT_FILE.test(name)).sort().at(-1);
  if (!newest) return null;
  const [year, month, day, hour, minute] = REPORT_FILE.exec(newest).slice(1).map(Number);
  return { file: toPosix(path.join(dir, newest)), at: new Date(year, month - 1, day, hour, minute) };
}

function reportsStayLocal(flow) {
  if (flow.profile.trackHarness) return false;
  if (!gitRoot(flow.root)) return true;
  return git(flow.root, ['check-ignore', '-q', '--no-index', '.flow/reports/probe.md']).ok;
}

function localIso(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${pad2(Math.floor(Math.abs(offset) / 60))}:${pad2(Math.abs(offset) % 60)}`;
  return `${today(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${zone}`;
}

export function collectReport({ cwd, since = 'today', until, author, all = false, dayStartsAt = 0, now = new Date(), gh = runGh }) {
  const flow = openFlow(cwd, { required: false });
  const repos = repoTargets(cwd, flow, all);
  if (!repos.length) throw new Error('Không thấy repo git nào ở thư mục này.');
  const reportsDir = flow ? path.join(flow.paths.flowDir, 'reports') : null;
  const previous = latestReport(reportsDir);
  const window = resolveWindow({ since, until, dayStartsAt, now, previousAt: previous?.at });
  const identities = resolveIdentities(repos, author);
  const { clean, state } = createRedactor();
  const collected = repos.map((repo) => collectRepo(repo, window, identities, gh, clean));
  const plans = collectPlans(flow, window, clean);
  return {
    window: { label: window.label, start: localIso(window.start), end: localIso(window.end), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, fallback: window.fallback, includesNow: window.end >= now },
    identities: { names: identities.names, emails: identities.emails, extra: identities.extra, missing: identities.values.size === 0 },
    flow: Boolean(flow),
    language: flow ? flow.profile.language : null,
    repos: collected,
    plans,
    previous: previous ? { file: previous.file, at: localIso(previous.at) } : null,
    saveDir: flow && reportsStayLocal(flow) ? toPosix(reportsDir) : null,
    saveStem: `${today(now)}-${pad2(now.getHours())}${pad2(now.getMinutes())}`,
    redacted: state.count,
  };
}

function pullRequestLine(pullRequests) {
  if (!pullRequests.available) return `PR: không đọc được (${pullRequests.reason})`;
  return `PR: ${pullRequests.merged.length} đã merge · ${pullRequests.open.length} đang mở · ${pullRequests.reviewed.length} đã review`;
}

export function renderSummary(report) {
  const uncommitted = (repo) => repo.worktrees.reduce((sum, worktree) => sum + worktree.changed, 0);
  const lines = [
    `Khoảng: ${report.window.label} · ${report.window.start} → ${report.window.end}${report.window.fallback ? ' (chưa có báo cáo trước, tính từ ngày làm việc gần nhất)' : ''}`,
    `Danh tính: ${[...report.identities.names, ...report.identities.emails, ...report.identities.extra].join(', ') || '(chưa có, thêm bằng --author)'}`,
    ...report.repos.map((repo) => {
      const others = repo.otherAuthors.length ? ` · ${repo.otherAuthors.length} tác giả khác` : '';
      return `${repo.name}: ${repo.commits.length} commit · ${uncommitted(repo)} tệp chưa commit · ${repo.stashes} stash · ${pullRequestLine(repo.pullRequests)}${others}`;
    }),
    ...report.plans.map((plan) => `Plan ${plan.slug}: ${plan.status} · ${plan.done}/${plan.total} task · ${plan.doneInWindow.length} xong trong khoảng · ${plan.openDecisions.length} quyết định mở`),
  ];
  if (report.redacted) lines.push(`Đã che ${report.redacted} giá trị giống bí mật.`);
  return lines.join('\n');
}

export function cmdReport(cwd, sub, opts) {
  if (sub !== 'collect') throw new Error('Dùng: flow report collect [--since …] [--json]');
  const report = collectReport({ cwd, since: opts.since, until: opts.until, author: opts.author, all: opts.all === true, dayStartsAt: opts['day-starts-at'] });
  console.log(opts.json ? JSON.stringify(report, null, 2) : renderSummary(report));
  return 0;
}
