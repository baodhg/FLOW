import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderBanner } from './banner.mjs';
import { pickLanguage } from './lang.mjs';
import { CANCELLED, multiValue, reduceMulti, reduceSelect, renderAnswer, renderMulti, renderSelect, runPrompt, selectValue, symbolsFor } from './prompts.mjs';

export const PACKAGE_NAME = 'flow-harness';
export const CORE_SKILLS = ['flow', 'flow-init', 'flow-explore', 'flow-plan', 'flow-execute', 'flow-post', 'flow-learn'];

const AGENTS = [
  { value: 'claude', label: 'Claude Code', root: '.claude' },
  { value: 'codex', label: 'Codex', root: '.codex' },
  { value: 'gemini', label: 'Gemini CLI', root: '.gemini' },
];

const STRINGS = {
  en: {
    agents: 'Which agents should get the skills?',
    detected: '(detected)',
    notFound: '(not found)',
    multiHelp: 'Up/Down to move · Space to select · a for all · Enter to continue',
    needOne: 'Select at least one agent with Space.',
    skillSet: 'Which skill set?',
    full: 'Full',
    fullHint: 'every skill, recommended',
    core: 'Core',
    coreHint: '7 skills for the main workflow',
    custom: 'Custom',
    customHint: 'choose one by one',
    pickSkills: 'Choose skills',
    required: '(required)',
    hooks: 'Add protective hooks?',
    hooksNo: 'No',
    hooksNoHint: 'you can add them later with flow install --hooks',
    hooksYes: 'Yes',
    hooksYesHint: 'restore state after compaction, block writes to protected branches and direct .env reads',
    review: 'This will change:',
    confirm: 'Apply these changes?',
    apply: 'Apply',
    cancel: 'Cancel',
    selected: (n) => `${n} selected`,
    skillCount: (n) => `${n} skills`,
    changeGlobal: (v) => `Install ${PACKAGE_NAME}@${v} globally with npm, so the flow command stays available`,
    changeSkills: (n, dir) => `Link ${n} skills into ${dir}`,
    changeBridge: (file) => `Add an instruction block to ${file} (backed up first)`,
    changeCommands: (dir) => `Add slash commands in ${dir}`,
    changeHooks: (file) => `Add hooks to ${file} (backed up first)`,
    cancelled: 'Cancelled. Nothing was changed.',
    installingGlobal: 'Installing the package globally...',
    globalFailed: 'The global install failed. Nothing else was changed.',
    globalManual: (v) => `Try it yourself: npm install -g ${PACKAGE_NAME}@${v}`,
    installFailed: 'Setup failed:',
    doneGlobal: 'Installed the package globally',
    doneSkills: (n) => `Linked ${n} skills`,
    doneAgents: (names) => `Configured ${names}`,
    doneHooks: 'Added hooks',
    skipped: 'Left untouched because it is not ours:',
    next: 'Next:',
    nextRestart: 'Restart your agent so it can see the skills',
    nextInit: 'In your repository, run: flow init',
    nextHelp: 'See all commands: flow help',
    needTerminal: 'flow setup needs an interactive terminal. For scripts, use: flow install --agents claude,codex --skills core',
    skillHints: {
      flow: 'entry point, always included',
      'flow-init': 'bring a project into the workflow',
      'flow-explore': 'investigate scope without changing code',
      'flow-plan': 'write the plan and split tasks',
      'flow-execute': 'carry out an approved plan',
      'flow-post': 'verify, review and hand over',
      'flow-test': 'design tests that can fail',
      'flow-runbook': 'manual procedures with readable results',
      'flow-review': 'independent review by a fresh subagent',
      'flow-context': 'context documents for modules',
      'flow-learn': 'record rules and memories',
      'flow-sync': 'bring context back in line with code',
      'flow-worktree': 'run parallel work safely',
      'flow-secrets': 'find secrets without printing them',
    },
  },
  vi: {
    agents: 'Cài skill cho agent nào?',
    detected: '(đã thấy)',
    notFound: '(chưa thấy)',
    multiHelp: 'Lên/Xuống để di chuyển · Cách để chọn · a để chọn hết · Enter để tiếp tục',
    needOne: 'Hãy chọn ít nhất một agent bằng phím Cách.',
    skillSet: 'Dùng bộ skill nào?',
    full: 'Đầy đủ',
    fullHint: 'mọi skill, khuyến nghị',
    core: 'Cốt lõi',
    coreHint: '7 skill cho quy trình chính',
    custom: 'Tự chọn',
    customHint: 'chọn từng skill',
    pickSkills: 'Chọn skill',
    required: '(bắt buộc)',
    hooks: 'Thêm hook bảo vệ?',
    hooksNo: 'Không',
    hooksNoHint: 'có thể thêm sau bằng flow install --hooks',
    hooksYes: 'Có',
    hooksYesHint: 'nạp lại trạng thái sau khi nén, chặn ghi nhánh được bảo vệ và đọc thẳng .env',
    review: 'Sẽ thay đổi:',
    confirm: 'Áp dụng các thay đổi này?',
    apply: 'Áp dụng',
    cancel: 'Huỷ',
    selected: (n) => `đã chọn ${n}`,
    skillCount: (n) => `${n} skill`,
    changeGlobal: (v) => `Cài ${PACKAGE_NAME}@${v} toàn cục bằng npm để lệnh flow luôn dùng được`,
    changeSkills: (n, dir) => `Nối ${n} skill vào ${dir}`,
    changeBridge: (file) => `Thêm khối chỉ dẫn vào ${file} (sao lưu trước)`,
    changeCommands: (dir) => `Thêm lệnh slash trong ${dir}`,
    changeHooks: (file) => `Thêm hook vào ${file} (sao lưu trước)`,
    cancelled: 'Đã huỷ. Chưa có gì thay đổi.',
    installingGlobal: 'Đang cài gói toàn cục...',
    globalFailed: 'Cài toàn cục thất bại. Không có gì khác bị thay đổi.',
    globalManual: (v) => `Tự chạy thử: npm install -g ${PACKAGE_NAME}@${v}`,
    installFailed: 'Cài đặt thất bại:',
    doneGlobal: 'Đã cài gói toàn cục',
    doneSkills: (n) => `Đã nối ${n} skill`,
    doneAgents: (names) => `Đã cấu hình ${names}`,
    doneHooks: 'Đã thêm hook',
    skipped: 'Giữ nguyên vì không phải của FLOW:',
    next: 'Tiếp theo:',
    nextRestart: 'Mở lại agent để nó nhận skill',
    nextInit: 'Trong repo của bạn, chạy: flow init',
    nextHelp: 'Xem mọi lệnh: flow help',
    needTerminal: 'flow setup cần terminal tương tác. Với script, dùng: flow install --agents claude,codex --skills core',
    skillHints: {
      flow: 'cửa vào, luôn có',
      'flow-init': 'đưa dự án vào quy trình',
      'flow-explore': 'điều tra phạm vi, không sửa mã',
      'flow-plan': 'viết kế hoạch và chia task',
      'flow-execute': 'thi hành plan đã duyệt',
      'flow-post': 'kiểm chứng, soát và bàn giao',
      'flow-test': 'thiết kế test có thể thất bại',
      'flow-runbook': 'quy trình chạy tay đọc được kết quả',
      'flow-review': 'soát độc lập bằng subagent mới',
      'flow-context': 'tài liệu ngữ cảnh theo module',
      'flow-learn': 'ghi luật và memory',
      'flow-sync': 'đồng bộ ngữ cảnh với mã',
      'flow-worktree': 'làm song song an toàn',
      'flow-secrets': 'dò bí mật mà không in giá trị',
    },
  },
};

export function stringsFor(lang) {
  return STRINGS[lang] || STRINGS.en;
}

export function runsFromNpxCache(dir) {
  return /[\\/]_npx[\\/]/.test(dir);
}

export function listSkills(packageDir) {
  const dir = path.join(packageDir, 'skills');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort((a, b) => (a === 'flow' ? -1 : b === 'flow' ? 1 : a.localeCompare(b)));
}

export function detectAgents(home) {
  return AGENTS.map((agent) => ({ ...agent, detected: fs.existsSync(path.join(home, agent.root)) }));
}

export function isSetUp(home) {
  return ['.claude', '.agents'].some((root) => {
    try {
      return !!fs.lstatSync(path.join(home, root, 'skills', 'flow'));
    } catch {
      return false;
    }
  });
}

export function installArgs({ agents, skills, allSkills, hooks }) {
  const args = ['--agents', agents.join(',')];
  if (skills.length !== allSkills.length) args.push('--skills', skills.join(','));
  if (hooks) args.push('--hooks');
  return args;
}

export function describeChanges({ agents, skills, hooks }, { home, strings, version, viaNpx }) {
  const has = (name) => agents.includes(name);
  const exists = (root) => fs.existsSync(path.join(home, root));
  const lines = [];
  if (viaNpx) lines.push(strings.changeGlobal(version));
  if (has('claude')) lines.push(strings.changeSkills(skills.length, '~/.claude/skills'));
  if (has('codex') || has('gemini')) lines.push(strings.changeSkills(skills.length, '~/.agents/skills'));
  if (has('claude') && exists('.claude')) lines.push(strings.changeBridge('~/.claude/CLAUDE.md'));
  if (has('codex') && exists('.codex')) lines.push(strings.changeBridge('~/.codex/AGENTS.md'), strings.changeCommands('~/.codex/prompts'));
  if (has('gemini') && exists('.gemini')) lines.push(strings.changeBridge('~/.gemini/GEMINI.md'), strings.changeCommands('~/.gemini/commands/flow'));
  if (hooks && has('claude') && exists('.claude')) lines.push(strings.changeHooks('~/.claude/settings.json'));
  if (hooks && has('codex') && exists('.codex')) lines.push(strings.changeHooks('~/.codex/hooks.json'));
  return lines;
}

function defaultRunner(env) {
  return {
    install(installScript, args) {
      return spawnSync(process.execPath, [installScript, ...args], { encoding: 'utf8', env });
    },
    installGlobal(version) {
      return spawnSync('npm', ['install', '-g', `${PACKAGE_NAME}@${version}`], { encoding: 'utf8', env, shell: true });
    },
    globalRoot() {
      const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', env, shell: true });
      return r.status === 0 ? r.stdout.trim() : null;
    },
  };
}

export async function runWizard({
  input = process.stdin,
  output = process.stdout,
  env = process.env,
  home = os.homedir(),
  packageDir,
  version,
  cwd = process.cwd(),
  lang,
  columns = process.stdout.columns || 80,
  viaNpx = runsFromNpxCache(packageDir),
  runner = defaultRunner(env),
  interactive = !!(input.isTTY && output.isTTY),
}) {
  const language = pickLanguage(env, lang);
  const t = stringsFor(language);
  const write = (text) => output.write(`${text}\n`);
  if (!interactive) {
    write(t.needTerminal);
    return 1;
  }
  const useColor = !('NO_COLOR' in env);
  const symbols = symbolsFor(env);
  const base = { input, output, columns };
  const cancelled = () => {
    write(t.cancelled);
    return 130;
  };
  const banner = renderBanner({ lang: language, version, cwd, isTTY: true, columns, env: { ...env, CI: undefined } });
  if (banner) write(banner);

  const detected = detectAgents(home);
  const agents = await runPrompt({
    ...base,
    initial: {
      index: 0,
      required: true,
      options: detected.map((a) => ({ value: a.value, label: a.label, hint: a.detected ? t.detected : t.notFound, checked: a.detected })),
    },
    reduce: reduceMulti,
    value: multiValue,
    render: (s) => renderMulti(s, { title: t.agents, help: t.multiHelp, requiredMessage: t.needOne, symbols, useColor }),
    renderDone: (s, r) => renderAnswer({ title: t.agents, answer: r === CANCELLED ? t.cancel : multiValue(s).map((v) => AGENTS.find((a) => a.value === v).label).join(', '), symbols, useColor }),
  });
  if (agents === CANCELLED) return cancelled();

  const allSkills = listSkills(packageDir);
  const presetOptions = [
    { value: 'full', label: t.full, hint: t.fullHint },
    { value: 'core', label: t.core, hint: t.coreHint },
    { value: 'custom', label: t.custom, hint: t.customHint },
  ];
  const preset = await runPrompt({
    ...base,
    initial: { index: 0, options: presetOptions },
    reduce: reduceSelect,
    value: selectValue,
    render: (s) => renderSelect(s, { title: t.skillSet, symbols, useColor }),
    renderDone: (s, r) => renderAnswer({ title: t.skillSet, answer: r === CANCELLED ? t.cancel : s.options[s.index].label, symbols, useColor }),
  });
  if (preset === CANCELLED) return cancelled();

  let skills = preset === 'full' ? allSkills : CORE_SKILLS.filter((name) => allSkills.includes(name));
  if (preset === 'custom') {
    const picked = await runPrompt({
      ...base,
      initial: {
        index: 0,
        options: allSkills.map((name) => ({
          value: name,
          label: name,
          hint: name === 'flow' ? t.required : t.skillHints[name] || '',
          checked: CORE_SKILLS.includes(name),
          locked: name === 'flow',
        })),
      },
      reduce: reduceMulti,
      value: multiValue,
      render: (s) => renderMulti(s, { title: t.pickSkills, help: t.multiHelp, requiredMessage: t.needOne, symbols, useColor }),
      renderDone: (s, r) => renderAnswer({ title: t.pickSkills, answer: r === CANCELLED ? t.cancel : t.selected(multiValue(s).length), symbols, useColor }),
    });
    if (picked === CANCELLED) return cancelled();
    skills = picked;
  }

  let hooks = false;
  if (agents.includes('claude') || agents.includes('codex')) {
    const answer = await runPrompt({
      ...base,
      initial: {
        index: 0,
        options: [
          { value: false, label: t.hooksNo, hint: t.hooksNoHint },
          { value: true, label: t.hooksYes, hint: t.hooksYesHint },
        ],
      },
      reduce: reduceSelect,
      value: selectValue,
      render: (s) => renderSelect(s, { title: t.hooks, symbols, useColor }),
      renderDone: (s, r) => renderAnswer({ title: t.hooks, answer: r === CANCELLED ? t.cancel : s.options[s.index].label, symbols, useColor }),
    });
    if (answer === CANCELLED) return cancelled();
    hooks = answer;
  }

  const answers = { agents, skills, hooks };
  write(`\n${t.review}`);
  for (const line of describeChanges(answers, { home, strings: t, version, viaNpx })) write(`  • ${line}`);
  write('');

  const confirmed = await runPrompt({
    ...base,
    initial: {
      index: 0,
      options: [
        { value: true, label: t.apply },
        { value: false, label: t.cancel },
      ],
    },
    reduce: reduceSelect,
    value: selectValue,
    render: (s) => renderSelect(s, { title: t.confirm, symbols, useColor }),
    renderDone: (s, r) => renderAnswer({ title: t.confirm, answer: r === CANCELLED ? t.cancel : s.options[s.index].label, symbols, useColor }),
  });
  if (confirmed === CANCELLED || confirmed === false) return cancelled();

  let installScript = path.join(packageDir, 'install.mjs');
  const done = [];
  if (viaNpx) {
    write(t.installingGlobal);
    const global = runner.installGlobal(version);
    const root = global.status === 0 ? runner.globalRoot() : null;
    if (!root) {
      write(t.globalFailed);
      if (global.stderr) write(global.stderr.trim());
      write(t.globalManual(version));
      return 1;
    }
    installScript = path.join(root, PACKAGE_NAME, 'install.mjs');
    done.push(t.doneGlobal);
  }

  const result = runner.install(installScript, installArgs({ ...answers, allSkills }));
  if (result.status !== 0) {
    write(t.installFailed);
    write(`${result.stdout || ''}${result.stderr || ''}`.trim());
    return result.status || 1;
  }
  done.push(t.doneSkills(skills.length), t.doneAgents(agents.map((v) => AGENTS.find((a) => a.value === v).label).join(', ')));
  if (hooks) done.push(t.doneHooks);
  write('');
  for (const line of done) write(`${useColor ? '\x1b[32m✓\x1b[0m' : '✓'} ${line}`);
  const skippedLines = (result.stdout || '').split('\n').filter((line) => /^\s*!/.test(line));
  if (skippedLines.length) {
    write(`\n${t.skipped}`);
    for (const line of skippedLines) write(`  ${line.trim().replace(/^!\s*/, '')}`);
  }
  write(`\n${t.next}`);
  for (const line of [t.nextRestart, t.nextInit, t.nextHelp]) write(`  → ${line}`);
  return 0;
}
