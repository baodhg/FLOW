import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { CORE_SKILLS, describeChanges, detectAgents, installArgs, isSetUp, listSkills, runWizard, runsFromNpxCache, stringsFor } from '../lib/wizard.mjs';

const PACK = path.resolve(import.meta.dirname, '..');
const INSTALL = path.join(PACK, 'install.mjs');
const UP = '\x1b[A';
const DOWN = '\x1b[B';
const LEFT = '\x1b[D';
const BACKSPACE = '\u007f';
const SPACE = ' ';
const ENTER = '\r';
const CTRL_C = '\u0003';

function fakeHome(t, roots = ['.claude', '.codex', '.gemini']) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const root of roots) fs.mkdirSync(path.join(home, root));
  return home;
}

function homeEnv(home) {
  return { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '', CI: '' };
}

function realRunner(home) {
  const env = homeEnv(home);
  return {
    install: (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env }),
    installGlobal: () => assert.fail('must not install globally here'),
    globalRoot: () => assert.fail('must not query npm here'),
  };
}

async function play(keys, options) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (d) => (text += d));
  const run = runWizard({
    input,
    output,
    packageDir: PACK,
    version: '9.9.9',
    cwd: '/work/library',
    lang: 'en',
    columns: 100,
    viaNpx: false,
    interactive: true,
    ...options,
  });
  for (const key of keys) {
    await new Promise((r) => setTimeout(r, 15));
    input.write(key);
  }
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`wizard is still waiting for a key:\n${text}`)), 8000);
  });
  try {
    return { code: await Promise.race([run, stalled]), text };
  } finally {
    clearTimeout(timer);
  }
}

test('accepting the defaults installs every skill for the detected agents', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { code, text } = await play([ENTER, ENTER, ENTER, ENTER], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  const installed = fs.readdirSync(path.join(home, '.claude', 'skills')).sort();
  assert.deepEqual(installed, listSkills(PACK).slice().sort());
  assert.equal(fs.existsSync(path.join(home, '.agents')), false, 'an agent that is not selected is left alone');
  assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false, 'hooks stay off by default');
  assert.match(text, /FLOW Harness v9\.9\.9/);
  assert.match(text, /This will change:/);
  assert.match(text, /flow init/);
});

test('the first question picks the language, starting from the system language', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const env = { ...homeEnv(home), LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: '', LANGUAGE: '' };
  const { code, text } = await play([DOWN, ENTER, ENTER, ENTER, ENTER, ENTER], { home, env, runner: realRunner(home), lang: undefined });
  assert.equal(code, 0, text);
  assert.match(text, /Language \/ Ngôn ngữ/);
  assert.match(text, /Cài cho công cụ AI nào\?/);
  assert.match(text, /Đã chọn 1\/3/);
  assert.match(text, /Đã nối 14 skill/);
  assert.doesNotMatch(text, /This will change:/);
});

test('--lang skips the language question and several agents can be selected together', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { code, text } = await play([DOWN, SPACE, DOWN, SPACE, ENTER, ENTER, ENTER, ENTER], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  assert.doesNotMatch(text, /Language \/ Ngôn ngữ/);
  assert.match(text, /2 of 3 selected/);
  assert.match(text, /3 of 3 selected/);
  assert.match(text, /AI tools\s+Claude Code, Codex, Gemini CLI/);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'flow')));
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'flow')));
});

test('after pressing Enter on skills, going back lets you add the one you forgot', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const keys = [ENTER, UP, ENTER, ENTER, LEFT, DOWN, SPACE, ENTER, ENTER, ENTER];
  const { code, text } = await play(keys, { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  const installed = fs.readdirSync(path.join(home, '.claude', 'skills')).sort();
  assert.deepEqual(installed, [...CORE_SKILLS, 'flow-context'].sort());
});

test('going back keeps earlier choices and Backspace works like the left arrow', async (t) => {
  const home = fakeHome(t);
  const keys = [SPACE, ENTER, BACKSPACE, ENTER, ENTER, ENTER, ENTER];
  const { code, text } = await play(keys, { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false, 'the agent turned off stays off after going back');
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'flow')));
});

test('back from the review skips a question that no longer applies', async (t) => {
  const home = fakeHome(t, ['.gemini']);
  const keys = [ENTER, ENTER, LEFT, DOWN, ENTER, ENTER];
  const { code, text } = await play(keys, { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  assert.doesNotMatch(text, /automatic protection/);
  assert.deepEqual(fs.readdirSync(path.join(home, '.agents', 'skills')).sort(), [...CORE_SKILLS].sort());
});

test('turning off every agent that uses hooks after choosing them removes the hooks', async (t) => {
  const home = fakeHome(t, ['.claude', '.gemini']);
  const keys = [ENTER, ENTER, DOWN, ENTER, LEFT, LEFT, LEFT, SPACE, ENTER, ENTER, ENTER];
  const { code, text } = await play(keys, { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false);
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'flow')));
});

test('going back to the language question changes the language of later steps', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const env = { ...homeEnv(home), LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: '', LANGUAGE: '' };
  const keys = [DOWN, ENTER, LEFT, UP, ENTER, ENTER, ENTER, ENTER, ENTER];
  const { code, text } = await play(keys, { home, env, runner: realRunner(home), lang: undefined });
  assert.equal(code, 0, text);
  assert.match(text, /This will change:/);
  assert.doesNotMatch(text, /Sẽ thay đổi:/);
});

test('the first question has nowhere to go back to and does not offer it', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { code, text } = await play([LEFT, ENTER, ENTER, ENTER, LEFT, CTRL_C], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 130);
  assert.match(text, /Enter next\n/);
  assert.match(text, /Enter choose · ← back/);
});

test('each step shows its position, a plain explanation and what was already chosen', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { code, text } = await play([ENTER, ENTER, ENTER, CTRL_C], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 130);
  assert.match(text, /Step 1\/4 · AI tools/);
  assert.match(text, /Step 2\/4 · Skill set/);
  assert.match(text, /Step 3\/4 · Protection/);
  assert.match(text, /Step 4\/4 · Confirm/);
  assert.match(text, /write directly to a main branch/);
  assert.match(text, /Selected\n\s+AI tools\s+Claude Code\n\s+Skill set\s+Full \(recommended\)/);
});

test('choosing custom adds a step and the total updates', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { code, text } = await play([ENTER, UP, ENTER, CTRL_C], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 130);
  assert.match(text, /Step 3\/5 · Choose skills/);
});

test('a short window drops the summary so redraws never scroll out of reach', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { text } = await play([ENTER, ENTER, ENTER, CTRL_C], { home, env: homeEnv(home), runner: realRunner(home), rows: 12 });
  assert.match(text, /Step 4\/4 · Confirm/);
  assert.doesNotMatch(text, /Selected\n/);
});

test('every step replaces the previous one instead of stacking below it', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { text } = await play([ENTER, LEFT, CTRL_C], { home, env: homeEnv(home), runner: realRunner(home) });
  const erasures = text.match(/\x1b\[\d+A\r\x1b\[J/g) || [];
  assert.equal(erasures.length, 3);
});

test('cancelling at the final question changes nothing', async (t) => {
  const home = fakeHome(t);
  const before = fs.readdirSync(home).sort();
  const { code, text } = await play([ENTER, ENTER, ENTER, CTRL_C], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 130);
  assert.match(text, /Nothing was changed/);
  assert.deepEqual(fs.readdirSync(home).sort(), before);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false);
});

test('choosing Cancel from the menu also changes nothing', async (t) => {
  const home = fakeHome(t);
  const { code } = await play([ENTER, ENTER, ENTER, DOWN, ENTER], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 130);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false);
});

test('the core preset links only core skills and hooks can be turned on', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const { code, text } = await play([ENTER, DOWN, ENTER, DOWN, ENTER, ENTER], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'skills')).sort(), [...CORE_SKILLS].sort());
  assert.match(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), /hook pretool/);
});

test('a custom list keeps the required entry skill even if the user tries to remove it', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const keys = [ENTER, UP, ENTER, SPACE, ENTER, ENTER, ENTER];
  const { code, text } = await play(keys, { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  const installed = fs.readdirSync(path.join(home, '.claude', 'skills'));
  assert.ok(installed.includes('flow'));
  assert.deepEqual(installed.sort(), [...CORE_SKILLS].sort());
});

test('no agent can be left selected: the wizard waits until one is chosen', async (t) => {
  const home = fakeHome(t, []);
  const { code, text } = await play([ENTER, SPACE, ENTER, ENTER, ENTER, ENTER], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  assert.match(text, /Select at least one tool/);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'flow')));
});

test('from the npx cache it installs globally first and links from the global copy', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const calls = [];
  const root = path.join(home, 'global');
  const runner = {
    installGlobal: (version) => (calls.push(['global', version]), { status: 0 }),
    globalRoot: () => root,
    install: (script, args) => (calls.push(['install', script, args]), { status: 0, stdout: '' }),
  };
  const { code, text } = await play([ENTER, ENTER, ENTER, ENTER], { home, env: homeEnv(home), runner, viaNpx: true });
  assert.equal(code, 0, text);
  assert.deepEqual(calls[0], ['global', '9.9.9']);
  assert.equal(calls[1][1], path.join(root, 'flow-harness', 'install.mjs'));
  assert.match(text, /Install flow-harness@9\.9\.9 globally/);
});

test('a failed global install stops before touching any agent configuration', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const runner = {
    installGlobal: () => ({ status: 1, stderr: 'EEXIST flow' }),
    globalRoot: () => assert.fail('must stop first'),
    install: () => assert.fail('must stop first'),
  };
  const { code, text } = await play([ENTER, ENTER, ENTER, ENTER], { home, env: homeEnv(home), runner, viaNpx: true });
  assert.equal(code, 1);
  assert.match(text, /EEXIST flow/);
  assert.match(text, /npm install -g flow-harness@9\.9\.9/);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false);
});

test('files the pack does not own are reported instead of overwritten', async (t) => {
  const home = fakeHome(t, ['.claude']);
  const foreign = path.join(home, '.claude', 'skills', 'flow-plan');
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, 'mine.md'), 'keep');
  const { code, text } = await play([ENTER, ENTER, ENTER, ENTER], { home, env: homeEnv(home), runner: realRunner(home) });
  assert.equal(code, 0, text);
  assert.equal(fs.readFileSync(path.join(foreign, 'mine.md'), 'utf8'), 'keep');
  assert.match(text, /Left untouched because it is not ours/);
  assert.match(text, /flow-plan/);
});

test('every string exists in both languages', () => {
  const en = Object.keys(stringsFor('en')).sort();
  assert.deepEqual(Object.keys(stringsFor('vi')).sort(), en);
  assert.deepEqual(Object.keys(stringsFor('vi').skillHints).sort(), Object.keys(stringsFor('en').skillHints).sort());
  assert.deepEqual(Object.keys(stringsFor('en').skillHints).sort(), listSkills(PACK).slice().sort());
});

test('helpers describe the choices accurately', (t) => {
  const home = fakeHome(t, ['.claude']);
  assert.deepEqual(detectAgents(home).map((a) => [a.value, a.detected]), [['claude', true], ['codex', false], ['gemini', false]]);
  assert.equal(isSetUp(home), false);
  const all = ['flow', 'flow-plan'];
  assert.deepEqual(installArgs({ agents: ['claude'], skills: all, allSkills: all, hooks: false }), ['--agents', 'claude']);
  assert.deepEqual(installArgs({ agents: ['claude', 'codex'], skills: ['flow'], allSkills: all, hooks: true }), ['--agents', 'claude,codex', '--skills', 'flow', '--hooks']);
  const lines = describeChanges({ agents: ['claude', 'gemini'], skills: all, hooks: true }, { home, strings: stringsFor('en'), version: '1.0.0', viaNpx: false });
  assert.ok(lines.includes('Link 2 skills into ~/.claude/skills'));
  assert.ok(lines.includes('Link 2 skills into ~/.agents/skills'));
  assert.ok(lines.includes('Add hooks to ~/.claude/settings.json (backed up first)'));
  assert.equal(lines.some((l) => l.includes('GEMINI.md')), false, 'an agent without a config folder gets no instruction block');
  assert.equal(runsFromNpxCache('C:\\npm-cache\\_npx\\abc\\node_modules\\flow-harness'), true);
  assert.equal(runsFromNpxCache('/usr/lib/node_modules/flow-harness'), false);
});

function install(home, ...args) {
  return spawnSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8', env: homeEnv(home) });
}

test('install filters by agent and skill, and narrowing the list removes what it linked', (t) => {
  const home = fakeHome(t);
  assert.equal(install(home, '--agents', 'codex', '--skills', 'core').status, 0);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false, 'another agent is untouched');
  assert.equal(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')), false);
  assert.deepEqual(fs.readdirSync(path.join(home, '.agents', 'skills')).sort(), [...CORE_SKILLS].sort());
  assert.ok(fs.existsSync(path.join(home, '.codex', 'prompts', 'flow-plan.md')));
  assert.equal(fs.existsSync(path.join(home, '.codex', 'prompts', 'flow-test.md')), false);
  assert.equal(install(home, '--agents=codex', '--skills=flow-test').status, 0);
  assert.deepEqual(fs.readdirSync(path.join(home, '.agents', 'skills')).sort(), ['flow', 'flow-test'], 'the required skill is always kept');
  assert.equal(fs.existsSync(path.join(home, '.codex', 'prompts', 'flow-plan.md')), false, 'its slash command goes too');
});

test('uninstall removes everything even after a narrowed install', (t) => {
  const home = fakeHome(t);
  assert.equal(install(home, '--agents', 'claude', '--skills', 'core').status, 0);
  assert.equal(install(home).status, 0);
  assert.equal(install(home, '--uninstall').status, 0);
  assert.deepEqual(fs.readdirSync(path.join(home, '.claude', 'skills')), []);
  assert.deepEqual(fs.readdirSync(path.join(home, '.agents', 'skills')), []);
});

test('install rejects unknown names before changing anything', (t) => {
  const home = fakeHome(t);
  for (const args of [['--agents', 'copilot'], ['--agents'], ['--skills', 'flow-nothing'], ['--skills']]) {
    const run = install(home, ...args);
    assert.equal(run.status, 2, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false);
  assert.equal(fs.existsSync(path.join(home, '.agents')), false);
});

test('install refuses to link from the temporary npx cache', (t) => {
  const home = fakeHome(t);
  const copy = path.join(home, '_npx', 'abc', 'node_modules', 'flow-harness');
  fs.mkdirSync(copy, { recursive: true });
  for (const item of ['install.mjs', 'package.json', 'lib', 'skills']) fs.cpSync(path.join(PACK, item), path.join(copy, item), { recursive: true });
  const run = spawnSync(process.execPath, [path.join(copy, 'install.mjs')], { encoding: 'utf8', env: homeEnv(home) });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(run.stdout, /cache của npx/);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills')), false);
});
