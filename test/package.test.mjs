import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

function packedFiles() {
  const run = spawnSync('npm pack --dry-run --json --ignore-scripts', { cwd: ROOT, encoding: 'utf8', shell: true });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout)[0].files.map((file) => file.path);
}

test('the package ships exactly one readme, so npm shows the English page', () => {
  const readmes = packedFiles().filter((file) => /^readme/i.test(path.basename(file)) && !file.includes('/'));
  assert.deepEqual(readmes, ['README.md']);
});

test('the package carries what users need and nothing from development', () => {
  const files = packedFiles();
  for (const required of ['bin/flow.mjs', 'install.mjs', 'LICENSE', 'SECURITY.md', 'skills/flow/SKILL.md', 'templates/plan.md', 'lib/wizard.mjs']) {
    assert.ok(files.includes(required), required);
  }
  for (const prefix of ['test/', '.github/', 'node_modules/', '.flow/']) {
    assert.equal(files.some((file) => file.startsWith(prefix)), false, prefix);
  }
  assert.equal(files.includes('package-lock.json'), false);
});
