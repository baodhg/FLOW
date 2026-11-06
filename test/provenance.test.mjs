import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildCorpus, compareFile, projectFiles, provenanceReport } from '../lib/provenance.mjs';

const LENDING = 'a member may borrow a book only when the previous loan has been returned and the fine has been settled in full at the front desk of the library';
const UNRELATED = 'the weather station reports rainfall totals every hour and archives each reading before sending a daily digest to the regional office for review';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

test('a copied passage is found and an unrelated one is not', (t) => {
  const project = tempDir(t);
  write(project, 'docs/policy.md', LENDING);
  const corpus = buildCorpus([project]);
  assert.ok(compareFile(`intro\n${LENDING}\noutro`, corpus).runs.length, 'copied text must be reported');
  assert.equal(compareFile(UNRELATED, corpus).runs.length, 0);
});

test('comparison ignores case and punctuation so light edits do not hide a copy', (t) => {
  const project = tempDir(t);
  write(project, 'a.md', LENDING);
  const disguised = LENDING.toUpperCase().replaceAll(' ', ' — ');
  assert.ok(compareFile(disguised, buildCorpus([project])).runs.length);
});

test('nested repositories and untracked context files are part of the corpus', (t) => {
  const workspace = tempDir(t);
  write(workspace, 'service-a/.git/HEAD', 'ref: refs/heads/main');
  write(workspace, 'service-a/src/CONTEXT.md', LENDING);
  write(workspace, 'service-a/node_modules/pkg/readme.md', UNRELATED);
  write(workspace, 'service-a/.env.local', UNRELATED);
  const seen = projectFiles(workspace).map((f) => path.basename(f));
  assert.deepEqual(seen, ['CONTEXT.md']);
});

test('import lines are boilerplate and do not count as copied text', (t) => {
  const project = tempDir(t);
  const imports = "import fs from 'node:fs';\nimport path from 'node:path';\nimport os from 'node:os';\nimport { spawnSync } from 'node:child_process';\n";
  write(project, 'a.mjs', imports);
  assert.equal(compareFile(imports, buildCorpus([project])).runs.length, 0);
});

test('an adjudicated passage needs a reason and everything else stays reported', (t) => {
  const project = tempDir(t);
  write(project, 'a.md', `${LENDING}\n\n${UNRELATED}`);
  const pack = tempDir(t);
  write(pack, 'skill.md', `${LENDING}\n\nspacer words that keep both passages apart from one another here\n\n${UNRELATED}`);
  write(pack, 'provenance-allow.json', JSON.stringify([{ file: 'skill.md', match: 'a member may borrow', reason: 'public policy wording' }, { file: 'skill.md', match: 'weather station' }]));
  const report = provenanceReport(pack, [project]);
  assert.equal(report.allowed, 1);
  assert.equal(report.rows[0].runs.length, 1);
});

test('a source that yields no files is a broken measurement, not a clean result', (t) => {
  const pack = tempDir(t);
  const empty = tempDir(t);
  write(pack, 'skill.md', UNRELATED);
  const bin = path.join(import.meta.dirname, '..', 'bin', 'flow.mjs');
  const run = spawnSync(process.execPath, [bin, 'provenance', '--against', empty], { encoding: 'utf8' });
  assert.equal(run.status, 3);
  assert.match(run.stdout, /phép đo hỏng/);
});
