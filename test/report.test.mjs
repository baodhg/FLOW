import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { collectPullRequests, collectReport, renderSummary, resolveWindow } from '../lib/report.mjs';

const PACK = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PACK, 'bin', 'flow.mjs');
const NOW = new Date(2026, 10, 9, 18, 0);
const ME = { GIT_AUTHOR_NAME: 'Dev One', GIT_AUTHOR_EMAIL: 'dev@example.test', GIT_COMMITTER_NAME: 'Dev One', GIT_COMMITTER_EMAIL: 'dev@example.test' };
const noGh = () => {
  throw new Error('gh must not run for this repository');
};
const local = (hour, minute = 0, day = 9) => new Date(2026, 10, day, hour, minute);

function git(cwd, args, env = {}) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
}

function sandbox(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'report-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}

function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Dev One']);
  git(dir, ['config', 'user.email', 'dev@example.test']);
  return dir;
}

function commit(repo, subject, { at = local(10), committedAt = at, identity = {} } = {}) {
  const name = `f${fs.readdirSync(repo).length}-${Math.abs(subject.length * at.getTime()) % 100000}.txt`;
  fs.writeFileSync(path.join(repo, name), `${subject}\n${committedAt.getTime()}\n`);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', subject], { ...ME, GIT_AUTHOR_DATE: at.toISOString(), GIT_COMMITTER_DATE: committedAt.toISOString(), ...identity });
  return git(repo, ['rev-parse', 'HEAD']);
}

function collect(cwd, options = {}) {
  return collectReport({ cwd, now: NOW, gh: noGh, ...options });
}

function subjects(report, index = 0) {
  return report.repos[index].commits.map((item) => item.subject);
}

function makeFlow(root, { excluded = true } = {}) {
  fs.mkdirSync(path.join(root, '.flow', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, '.flow', 'profile.json'), JSON.stringify({ name: 'demo' }));
  if (excluded) fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), '\n.flow/\n');
}

function writePlan(root, slug, status, body) {
  fs.writeFileSync(path.join(root, '.flow', 'plans', 'active', `${slug}.md`), `---\nslug: ${slug}\ntitle: Plan ${slug}\nstatus: ${status}\nbranch: feat/${slug}\n---\n\n${body}\n`);
}

function snapshot(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((item) => !item.startsWith(`.git${path.sep}`)).sort();
}

test('today runs from local midnight to now', () => {
  const window = resolveWindow({ since: 'today', now: NOW });
  assert.deepEqual([window.start, window.end], [local(0), NOW]);
});

test('a Monday standup reaches back to Friday and includes the weekend', () => {
  const window = resolveWindow({ since: 'last-workday', now: NOW });
  assert.deepEqual([window.start, window.end], [local(0, 0, 6), local(0)]);
});

test('on a Tuesday the last workday is Monday only', () => {
  const window = resolveWindow({ since: 'last-workday', now: local(9, 0, 10) });
  assert.deepEqual([window.start, window.end], [local(0, 0, 9), local(0, 0, 10)]);
});

test('work after midnight can still belong to the previous day', () => {
  const window = resolveWindow({ since: 'today', dayStartsAt: 4, now: local(1, 30, 10) });
  assert.deepEqual([window.start, window.end], [local(4, 0, 9), local(1, 30, 10)]);
});

test('a week starts on Monday, even when asked on Sunday', () => {
  const sunday = resolveWindow({ since: 'week', now: local(20, 0, 15) });
  assert.deepEqual(sunday.start, local(0, 0, 9));
  assert.deepEqual(resolveWindow({ since: 'week', now: NOW }).start, local(0));
});

test('explicit dates cover whole local days', () => {
  const single = resolveWindow({ since: '2026-11-03', now: NOW });
  assert.deepEqual([single.start, single.end], [local(0, 0, 3), local(0, 0, 4)]);
  const range = resolveWindow({ since: '2026-11-03', until: '2026-11-05', now: NOW });
  assert.deepEqual([range.start, range.end], [local(0, 0, 3), local(0, 0, 6)]);
});

test('impossible periods are refused instead of guessed', () => {
  for (const since of ['soon', '2026-02-30', '2026-13-01', '2030-01-01']) {
    assert.throws(() => resolveWindow({ since, now: NOW }), Error, since);
  }
  assert.throws(() => resolveWindow({ since: '2026-11-05', until: '2026-11-03', now: NOW }));
  assert.throws(() => resolveWindow({ since: 'today', until: '2026-11-03', now: NOW }));
  assert.throws(() => resolveWindow({ since: 'today', dayStartsAt: 25, now: NOW }));
});

test('since-last starts at the previous report and says when there was none', () => {
  const after = resolveWindow({ since: 'since-last', previousAt: local(17, 30, 6), now: NOW });
  assert.deepEqual([after.start, after.fallback], [local(17, 30, 6), false]);
  const none = resolveWindow({ since: 'since-last', now: NOW });
  assert.deepEqual([none.start, none.end, none.fallback], [local(0, 0, 6), NOW, true]);
});

test('every named period is ordered and ends no later than now', () => {
  fc.assert(
    fc.property(
      fc.date({ min: new Date(2020, 0, 1), max: new Date(2035, 0, 1), noInvalidDate: true }),
      fc.constantFrom('today', 'yesterday', 'last-workday', 'week', 'since-last'),
      fc.integer({ min: 0, max: 12 }),
      (now, since, dayStartsAt) => {
        const window = resolveWindow({ since, dayStartsAt, now });
        assert.ok(window.start <= window.end);
        assert.ok(window.end <= now);
      },
    ),
  );
});

test('only the reporting person is counted, and other people are listed apart', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: mine');
  commit(repo, 'feat: a teammate', { identity: { GIT_AUTHOR_NAME: 'Other', GIT_AUTHOR_EMAIL: 'other@example.test' } });
  commit(repo, 'chore: release', { identity: { GIT_AUTHOR_NAME: 'github-actions[bot]', GIT_AUTHOR_EMAIL: 'bot@example.test' } });
  const report = collect(repo);
  assert.deepEqual(subjects(report), ['feat: mine']);
  assert.deepEqual(report.repos[0].otherAuthors, [{ name: 'Other', email: 'other@example.test', commits: 1 }]);
});

test('a second identity of the same person is added with --author', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: from the laptop');
  commit(repo, 'feat: from the old config', { identity: { GIT_AUTHOR_NAME: 'Old Name', GIT_AUTHOR_EMAIL: 'old@example.test' } });
  assert.deepEqual(subjects(collect(repo)), ['feat: from the laptop']);
  const widened = collect(repo, { author: 'OLD@example.test' });
  assert.deepEqual(subjects(widened).sort(), ['feat: from the laptop', 'feat: from the old config']);
  assert.deepEqual(widened.repos[0].otherAuthors, []);
});

test('commits count on the day they were written, not the day they were rebased', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: old work rebased today', { at: local(10, 0, 2), committedAt: local(11) });
  commit(repo, 'feat: written today');
  assert.deepEqual(subjects(collect(repo)), ['feat: written today']);
});

test('a commit written yesterday stays in yesterday even if rebased today', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: yesterday', { at: local(15, 0, 8), committedAt: local(11) });
  commit(repo, 'feat: written today', { at: local(11, 30) });
  assert.deepEqual(subjects(collect(repo, { since: 'yesterday' })), ['feat: yesterday']);
  assert.deepEqual(subjects(collect(repo, { since: 'today' })), ['feat: written today']);
});

test('work on every local branch is seen, and stashes are not mistaken for commits', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: base');
  git(repo, ['checkout', '-q', '-b', 'feat/side']);
  commit(repo, 'feat: on a side branch', { at: local(11) });
  git(repo, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(repo, 'wip.txt'), 'wip\n');
  git(repo, ['add', '-A']);
  git(repo, ['stash', '-q'], { ...ME, GIT_AUTHOR_DATE: local(12).toISOString(), GIT_COMMITTER_DATE: local(12).toISOString() });
  const report = collect(repo);
  assert.deepEqual(subjects(report), ['feat: base', 'feat: on a side branch']);
  assert.equal(report.repos[0].commits[1].ref, 'feat/side');
  assert.equal(report.repos[0].stashes, 1);
});

test('the same commit rewritten by a rebase is reported once, as the pushed copy', (t) => {
  const base = sandbox(t);
  const remote = path.join(base, 'remote.git');
  git(base, ['init', '-q', '--bare', remote]);
  const repo = makeRepo(path.join(base, 'repo'));
  git(repo, ['remote', 'add', 'origin', remote]);
  commit(repo, 'feat: base', { at: local(9) });
  git(repo, ['push', '-q', 'origin', 'main']);
  git(repo, ['checkout', '-q', '-b', 'feat/x']);
  const original = commit(repo, 'feat: rebased', { at: local(10) });
  git(repo, ['push', '-q', 'origin', 'feat/x']);
  git(repo, ['reset', '-q', '--hard', 'main']);
  fs.writeFileSync(path.join(repo, 'same.txt'), 'x\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'feat: rebased'], { ...ME, GIT_AUTHOR_DATE: local(10).toISOString(), GIT_COMMITTER_DATE: local(12).toISOString() });
  const copies = collect(repo).repos[0].commits.filter((item) => item.subject === 'feat: rebased');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].pushed, true);
  assert.ok(original.startsWith(copies[0].hash));
});

test('a squash merge and the branch commit it came from count once', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: base');
  git(repo, ['checkout', '-q', '-b', 'feat/x']);
  commit(repo, 'feat: renew once', { at: local(10, 30) });
  git(repo, ['checkout', '-q', 'main']);
  commit(repo, 'feat: renew once (#7)', { at: local(12) });
  commit(repo, 'wip', { at: local(13) });
  commit(repo, 'wip', { at: local(14) });
  const report = collect(repo);
  assert.deepEqual(subjects(report), ['feat: base', 'feat: renew once (#7)', 'wip', 'wip']);
  assert.equal(report.repos[0].commits[1].pr, 7);
});

test('unpushed work is flagged and a squash merge keeps its pull request number', (t) => {
  const base = sandbox(t);
  const remote = path.join(base, 'remote.git');
  git(base, ['init', '-q', '--bare', remote]);
  const repo = makeRepo(path.join(base, 'repo'));
  git(repo, ['remote', 'add', 'origin', remote]);
  commit(repo, 'feat: shipped (#42)', { at: local(9) });
  git(repo, ['push', '-q', 'origin', 'main']);
  commit(repo, 'feat: only here', { at: local(10) });
  const [shipped, local_] = collect(repo).repos[0].commits;
  assert.deepEqual([shipped.pushed, shipped.pr], [true, 42]);
  assert.deepEqual([local_.pushed, local_.pr], [false, null]);
});

test('uncommitted work is found in every worktree', (t) => {
  const base = sandbox(t);
  const repo = makeRepo(path.join(base, 'repo'));
  commit(repo, 'feat: base');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat/other', path.join(base, 'other')]);
  fs.writeFileSync(path.join(repo, 'here.txt'), 'x\n');
  fs.writeFileSync(path.join(base, 'other', 'there.txt'), 'x\n');
  const seen = collect(repo).repos[0].worktrees;
  assert.deepEqual(seen.map((item) => [item.branch, item.files]).sort(), [['feat/other', ['there.txt']], ['main', ['here.txt']]]);
});

test('secrets in commit text are hidden and counted', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  const secret = `AKIA${'Q7XK2M9PLW3RT8VN'}`;
  commit(repo, `fix: rotate ${secret} after the incident`);
  assert.ok(git(repo, ['log', '-1', '--format=%s']).includes(secret), 'the raw log holds the value, so hiding it below is a real check');
  const report = collect(repo);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.redacted, 1);
  assert.match(subjects(report)[0], /\*\*\*\(20\)/);
});

test('a repository without FLOW still reports, and nothing is written', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: plain repo');
  const before = snapshot(repo);
  const report = collect(repo);
  assert.deepEqual(subjects(report), ['feat: plain repo']);
  assert.deepEqual([report.flow, report.saveDir, report.plans], [false, null, []]);
  assert.deepEqual(snapshot(repo), before);
});

test('a folder of repositories reports each of them', (t) => {
  const base = sandbox(t);
  commit(makeRepo(path.join(base, 'api')), 'feat: api work');
  commit(makeRepo(path.join(base, 'web')), 'feat: web work');
  fs.mkdirSync(path.join(base, 'notes'));
  const report = collect(base);
  assert.deepEqual(report.repos.map((item) => [item.name, item.commits.length]).sort(), [['api', 1], ['web', 1]]);
});

test('a brand new repository and a folder with no repository are handled', (t) => {
  const base = sandbox(t);
  const empty = makeRepo(path.join(base, 'empty'));
  assert.deepEqual(subjects(collect(empty)), []);
  const none = path.join(base, 'nothing');
  fs.mkdirSync(none);
  assert.throws(() => collect(none), /git/);
});

test('plans give dated progress, open work and decisions', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: base');
  makeFlow(repo);
  writePlan(repo, 'invoices', 'EXECUTING', [
    '## 0. Quyết định', '', '- [ ] **D1** Which format? — lựa chọn: A / B', '',
    '## 2. Tasks', '', '- [x] **T1** Old step ✓ 2026-11-02 · aaa', '- [x] **T2** Today step ✓ 2026-11-09 · bbb', '- [ ] **T3** Next step', '',
    '## 9. Ledger', '', '- 2026-11-01 [decision] too old', '- 2026-11-09 [friction] waiting for access',
  ].join('\n'));
  writePlan(repo, 'finished', 'DONE', '## 2. Tasks\n\n- [x] **T1** Long ago ✓ 2026-10-01');
  const report = collect(repo);
  assert.deepEqual(report.plans.map((plan) => plan.slug), ['invoices']);
  const [plan] = report.plans;
  assert.deepEqual([plan.done, plan.total], [2, 3]);
  assert.deepEqual(plan.doneInWindow, [{ id: 'T2', body: 'Today step', commit: 'bbb' }]);
  assert.deepEqual(plan.open, [{ id: 'T3', body: 'Next step' }]);
  assert.deepEqual(plan.notes, [{ date: '2026-11-09', kind: 'friction', text: 'waiting for access' }]);
  assert.deepEqual(plan.openDecisions.map((item) => item.id), ['D1']);
});

test('a finished plan appears when its last task was done in the period', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: base');
  makeFlow(repo);
  writePlan(repo, 'finished', 'DONE', '## 2. Tasks\n\n- [x] **T1** Today ✓ 2026-11-09');
  assert.deepEqual(collect(repo).plans.map((plan) => plan.slug), ['finished']);
});

test('reports are saved only where git cannot pick them up', (t) => {
  const base = sandbox(t);
  const hidden = makeRepo(path.join(base, 'hidden'));
  commit(hidden, 'feat: base');
  makeFlow(hidden);
  const report = collect(hidden);
  assert.equal(path.resolve(report.saveDir), path.join(hidden, '.flow', 'reports'));
  assert.equal(report.saveStem, '2026-11-09-1800');
  const shared = makeRepo(path.join(base, 'shared'));
  commit(shared, 'feat: base');
  makeFlow(shared, { excluded: false });
  assert.equal(collect(shared).saveDir, null);
});

test('the latest saved report is offered and anchors since-last', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: before the report', { at: local(10, 0, 8) });
  commit(repo, 'feat: after the report', { at: local(19, 0, 8) });
  makeFlow(repo);
  const dir = path.join(repo, '.flow', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['2026-11-06-1700-daily.md', '2026-11-08-1730-daily.md', 'notes.md']) fs.writeFileSync(path.join(dir, name), 'x\n');
  const report = collect(repo, { since: 'since-last' });
  assert.equal(path.basename(report.previous.file), '2026-11-08-1730-daily.md');
  assert.deepEqual(subjects(report), ['feat: after the report']);
});

test('pull requests are unknown, not zero, when they cannot be read', (t) => {
  const base = sandbox(t);
  const repo = makeRepo(path.join(base, 'repo'));
  commit(repo, 'feat: base');
  const window = resolveWindow({ since: 'today', now: NOW });
  assert.deepEqual(collectPullRequests(repo, window, noGh), { available: false, reason: 'no-remote' });
  git(repo, ['remote', 'add', 'origin', 'https://gitlab.example.test/a/b.git']);
  assert.deepEqual(collectPullRequests(repo, window, noGh), { available: false, reason: 'not-github' });
  git(repo, ['remote', 'set-url', 'origin', 'git@github.com:a/b.git']);
  assert.deepEqual(collectPullRequests(repo, window, () => ({ ok: false, missing: true, out: '' })), { available: false, reason: 'gh-missing' });
  assert.deepEqual(collectPullRequests(repo, window, () => ({ ok: false, missing: false, out: '' })), { available: false, reason: 'gh-failed' });
  assert.deepEqual(collectPullRequests(repo, window, () => ({ ok: true, out: 'not json' })), { available: false, reason: 'gh-failed' });
});

test('merged pull requests are placed by instant, whatever the time zone', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: base');
  git(repo, ['remote', 'add', 'origin', 'https://github.com/a/b.git']);
  const window = resolveWindow({ since: 'today', now: NOW });
  const minute = 60000;
  const before = new Date(window.start.getTime() - minute).toISOString();
  const inside = new Date(window.start.getTime() + minute).toISOString();
  const calls = [];
  const gh = (cwd, args) => {
    calls.push(args.join(' '));
    if (args.includes('open')) return { ok: true, out: JSON.stringify([{ number: 5, title: 'still open', updatedAt: before }]) };
    if (args.includes('merged')) return { ok: true, out: JSON.stringify([{ number: 1, title: 'before midnight', mergedAt: before }, { number: 2, title: 'after midnight', mergedAt: inside }]) };
    return { ok: true, out: JSON.stringify([{ number: 7, title: 'reviewed', updatedAt: inside }, { number: 8, title: 'stale review', updatedAt: before }]) };
  };
  const result = collectPullRequests(repo, window, gh);
  assert.equal(result.available, true);
  assert.deepEqual(result.merged.map((item) => item.number), [2]);
  assert.deepEqual(result.open.map((item) => [item.number, item.touched]), [[5, false]]);
  assert.deepEqual(result.reviewed.map((item) => item.number), [7]);
  assert.equal(calls.length, 3);
  assert.ok(calls.some((call) => call.includes(`merged:>=${window.start.toISOString().slice(0, 10)}`)), calls.join('\n'));
});

test('the summary tells unknown pull requests apart from none', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: base');
  const text = renderSummary(collect(repo));
  assert.match(text, /1 commit/);
  assert.match(text, /PR: không đọc được \(no-remote\)/);
});

test('the command prints machine-readable data and refuses unknown actions', (t) => {
  const repo = makeRepo(path.join(sandbox(t), 'repo'));
  commit(repo, 'feat: dated', { at: local(10, 0, 3) });
  const run = spawnSync(process.execPath, [CLI, 'report', 'collect', '--since', '2026-11-03', '--json'], { cwd: repo, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.repos[0].commits.map((item) => item.subject), ['feat: dated']);
  assert.equal(spawnSync(process.execPath, [CLI, 'report', 'send'], { cwd: repo, encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [CLI, 'report', 'collect', '--since', 'soon'], { cwd: repo, encoding: 'utf8' }).status, 1);
});

test('the skill covers the agreed behaviour and its templates exist', () => {
  const skill = fs.readFileSync(path.join(PACK, 'skills', 'flow-report', 'SKILL.md'), 'utf8');
  const templates = fs.readFileSync(path.join(PACK, 'skills', 'flow-report', 'references', 'templates.md'), 'utf8');
  for (const needle of ['flow report collect', 'On-going', 'Done', 'Pending', 'otherAuthors', 'saveDir', 'references/templates.md']) assert.ok(skill.includes(needle), needle);
  for (const kind of ['daily', 'oral', 'review', 'standup', 'weekly']) assert.match(templates, new RegExp(`^## ${kind}\\b`, 'm'), kind);
});
