import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderBanner } from './banner.mjs';
import { pickLanguage } from './lang.mjs';
import { CANCELLED, WENT_BACK, multiValue, palette, progressBar, reduceMulti, reduceSelect, renderMulti, renderSelect, runPrompt, selectValue, startSpinner, symbolsFor, wrapText } from './prompts.mjs';
import { gitRoot } from './util.mjs';

export const PACKAGE_NAME = 'flow-harness';
export const CORE_SKILLS = ['flow', 'flow-init', 'flow-explore', 'flow-plan', 'flow-execute', 'flow-post', 'flow-learn'];

const AGENTS = [
  { value: 'claude', label: 'Claude Code', root: '.claude' },
  { value: 'codex', label: 'Codex', root: '.codex' },
  { value: 'gemini', label: 'Gemini CLI', root: '.gemini' },
];

const STRINGS = {
  en: {
    step: 'Step',
    stepNames: { language: 'Language', scope: 'Where', agents: 'AI tools', preset: 'Skill set', custom: 'Choose skills', hooks: 'Protection', confirm: 'Confirm' },
    selectedTitle: 'Selected',
    summaryLabels: { language: 'Language', scope: 'Where', agents: 'AI tools', preset: 'Skill set', custom: 'Skills', hooks: 'Protection' },
    scopeTitle: 'Where should the skills work?',
    scopeWhy: 'The flow command is installed on this machine either way. This choice is about where your AI tools see the skills.',
    scopeUser: 'Everywhere on this machine (recommended)',
    scopeUserDetail: 'Every repository you open gets the skills. Nothing is added to any repository.',
    scopeProject: 'Only this project',
    scopeProjectDetail: (root) => `Only ${root}. Kept out of git, so your team sees no change.`,
    selectHelp: 'Up/Down move · Enter choose',
    multiHelp: 'Up/Down move · Space on/off · a all · Enter next',
    backHint: '← back',
    agentsTitle: 'Which AI coding tools should get the skills?',
    agentsWhy: 'FLOW adds its skills to the tools you select. You can select more than one.',
    detected: 'found on this machine',
    notFound: 'not found',
    picked: (n, total) => `${n} of ${total} selected`,
    needOne: 'Select at least one tool with Space.',
    presetTitle: 'Which skills do you want?',
    presetWhy: 'Skills are instructions your agent follows to investigate, plan, build and check its work.',
    full: 'Full (recommended)',
    fullDetail: (n) => `All ${n} skills, including testing, code review and secret scanning.`,
    core: 'Core',
    coreDetail: (n) => `${n} skills for the main workflow only.`,
    custom: 'Custom',
    customDetail: 'Turn each skill on or off in the next step.',
    customTitle: 'Choose your skills',
    customWhy: 'The flow skill is required because the others start from it.',
    skillTotal: (n) => `${n} skills`,
    hooksTitle: 'Turn on automatic protection?',
    hooksWhy: 'Stops your agent when it tries to write directly to a main branch or read a .env file holding passwords.',
    hooksNo: 'Not now',
    hooksNoDetail: 'Adds nothing. Turn it on any time with: flow install --hooks',
    hooksYes: 'Turn on',
    hooksYesDetail: 'Adds hooks for Claude Code and Codex, the tools that support them. Settings are backed up first.',
    hooksYesProjectDetail: 'Adds hooks for Claude Code in this project only, in your personal settings file.',
    changeLocalBridge: (file) => `Add an instruction block to ${file}, your private file`,
    changeLocalHooks: (file) => `Add hooks to ${file}, your private file`,
    changeExclude: 'Keep all of this out of git using .git/info/exclude',
    noteCodex: 'Codex gets the skills only: it has no private instruction file that leaves your team\'s AGENTS.md in effect',
    noteGemini: 'Gemini CLI gets the skills only, and loads them only when you trust this folder',
    undoProject: 'Remove from this project: flow uninstall --scope project',
    nextInitProject: 'In this repository, run: flow init',
    confirmTitle: 'Apply these changes?',
    review: 'This will change:',
    apply: 'Apply',
    cancel: 'Cancel',
    changeGlobal: (v) => `Install ${PACKAGE_NAME}@${v} globally with npm, so the flow command stays available`,
    changeSkills: (n, dir) => `Link ${n} skills into ${dir}`,
    changeBridge: (file) => `Add an instruction block to ${file} (backed up first)`,
    changeCommands: (dir) => `Add slash commands in ${dir}`,
    changeHooks: (file) => `Add hooks to ${file} (backed up first)`,
    cancelled: 'Cancelled. Nothing was changed.',
    installingGlobal: 'Installing the package globally...',
    applying: 'Linking skills and updating settings...',
    globalFailed: 'The global install failed. Nothing else was changed.',
    globalManual: (v) => `Try it yourself: npm install -g ${PACKAGE_NAME}@${v}`,
    installFailed: 'Setup failed:',
    doneGlobal: 'Installed the package globally',
    doneSkills: (n) => `Linked ${n} skills`,
    doneAgents: (names) => `Configured ${names}`,
    doneHooks: 'Turned on automatic protection',
    skipped: 'Left untouched because it is not ours:',
    next: 'Next:',
    nextRestart: 'Restart your AI tool so it can see the skills',
    nextInit: 'In your repository, run: flow init',
    nextHelp: 'See all commands: flow help',
    needTerminal: 'flow setup needs an interactive terminal. For scripts, use: flow install --agents claude,codex --skills core',
    skillHints: {
      flow: 'required, the entry point',
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
    step: 'Bước',
    stepNames: { language: 'Ngôn ngữ', scope: 'Phạm vi', agents: 'Công cụ AI', preset: 'Bộ skill', custom: 'Chọn skill', hooks: 'Lớp bảo vệ', confirm: 'Xác nhận' },
    selectedTitle: 'Đã chọn',
    summaryLabels: { language: 'Ngôn ngữ', scope: 'Phạm vi', agents: 'Công cụ AI', preset: 'Bộ skill', custom: 'Skill', hooks: 'Lớp bảo vệ' },
    scopeTitle: 'Skill có tác dụng ở đâu?',
    scopeWhy: 'Lệnh flow luôn được cài trên máy. Câu này chỉ quyết định công cụ AI thấy skill ở đâu.',
    scopeUser: 'Toàn máy (khuyến nghị)',
    scopeUserDetail: 'Repo nào mở ra cũng có skill. Không thêm gì vào repo nào.',
    scopeProject: 'Chỉ dự án này',
    scopeProjectDetail: (root) => `Chỉ ${root}. Được giữ ngoài git nên đồng đội không thấy thay đổi gì.`,
    selectHelp: 'Lên/Xuống di chuyển · Enter chọn',
    multiHelp: 'Lên/Xuống di chuyển · Phím cách bật/tắt · a chọn hết · Enter tiếp',
    backHint: '← quay lại',
    agentsTitle: 'Cài cho công cụ AI nào?',
    agentsWhy: 'FLOW thêm skill vào các công cụ bạn chọn. Chọn được nhiều công cụ.',
    detected: 'đã có trên máy',
    notFound: 'chưa thấy trên máy',
    picked: (n, total) => `Đã chọn ${n}/${total}`,
    needOne: 'Hãy chọn ít nhất một công cụ bằng phím cách.',
    presetTitle: 'Cài những skill nào?',
    presetWhy: 'Skill là hướng dẫn để agent điều tra, lập kế hoạch, làm và tự kiểm tra công việc.',
    full: 'Đầy đủ (khuyến nghị)',
    fullDetail: (n) => `Cả ${n} skill, gồm viết test, soát mã và dò bí mật.`,
    core: 'Cốt lõi',
    coreDetail: (n) => `${n} skill cho quy trình chính.`,
    custom: 'Tự chọn',
    customDetail: 'Bật hoặc tắt từng skill ở bước sau.',
    customTitle: 'Chọn skill bạn muốn',
    customWhy: 'Skill flow là bắt buộc vì các skill khác bắt đầu từ nó.',
    skillTotal: (n) => `${n} skill`,
    hooksTitle: 'Bật lớp bảo vệ tự động?',
    hooksWhy: 'Chặn agent khi nó định ghi thẳng vào nhánh chính hoặc đọc tệp .env chứa mật khẩu.',
    hooksNo: 'Để sau',
    hooksNoDetail: 'Không thêm gì. Bật lúc nào cũng được bằng: flow install --hooks',
    hooksYes: 'Bật ngay',
    hooksYesDetail: 'Thêm hook cho Claude Code và Codex, hai công cụ hỗ trợ tính năng này. Cấu hình được sao lưu trước.',
    hooksYesProjectDetail: 'Chỉ thêm hook cho Claude Code trong dự án này, vào tệp cấu hình riêng của bạn.',
    changeLocalBridge: (file) => `Thêm khối chỉ dẫn vào ${file}, tệp riêng của bạn`,
    changeLocalHooks: (file) => `Thêm hook vào ${file}, tệp riêng của bạn`,
    changeExclude: 'Giữ tất cả ngoài git bằng .git/info/exclude',
    noteCodex: 'Codex chỉ nhận skill: nó không có tệp chỉ dẫn riêng nào mà vẫn giữ AGENTS.md của đội có hiệu lực',
    noteGemini: 'Gemini CLI chỉ nhận skill, và chỉ nạp khi bạn tin cậy thư mục này',
    undoProject: 'Gỡ khỏi dự án này: flow uninstall --scope project',
    nextInitProject: 'Trong repo này, chạy: flow init',
    confirmTitle: 'Áp dụng các thay đổi này?',
    review: 'Sẽ thay đổi:',
    apply: 'Áp dụng',
    cancel: 'Huỷ',
    changeGlobal: (v) => `Cài ${PACKAGE_NAME}@${v} toàn cục bằng npm để lệnh flow luôn dùng được`,
    changeSkills: (n, dir) => `Nối ${n} skill vào ${dir}`,
    changeBridge: (file) => `Thêm khối chỉ dẫn vào ${file} (sao lưu trước)`,
    changeCommands: (dir) => `Thêm lệnh slash trong ${dir}`,
    changeHooks: (file) => `Thêm hook vào ${file} (sao lưu trước)`,
    cancelled: 'Đã huỷ. Chưa có gì thay đổi.',
    installingGlobal: 'Đang cài gói toàn cục...',
    applying: 'Đang nối skill và cập nhật cấu hình...',
    globalFailed: 'Cài toàn cục thất bại. Không có gì khác bị thay đổi.',
    globalManual: (v) => `Tự chạy thử: npm install -g ${PACKAGE_NAME}@${v}`,
    installFailed: 'Cài đặt thất bại:',
    doneGlobal: 'Đã cài gói toàn cục',
    doneSkills: (n) => `Đã nối ${n} skill`,
    doneAgents: (names) => `Đã cấu hình ${names}`,
    doneHooks: 'Đã bật lớp bảo vệ tự động',
    skipped: 'Giữ nguyên vì không phải của FLOW:',
    next: 'Tiếp theo:',
    nextRestart: 'Mở lại công cụ AI để nó nhận skill',
    nextInit: 'Trong repo của bạn, chạy: flow init',
    nextHelp: 'Xem mọi lệnh: flow help',
    needTerminal: 'flow setup cần terminal tương tác. Với script, dùng: flow install --agents claude,codex --skills core',
    skillHints: {
      flow: 'bắt buộc, cửa vào',
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

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
];

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

export function installArgs({ agents, skills, allSkills, hooks, scope = 'user', root }) {
  const args = ['--agents', agents.join(',')];
  if (skills.length !== allSkills.length) args.push('--skills', skills.join(','));
  if (hooks) args.push('--hooks');
  if (scope === 'project') args.push('--scope', 'project', '--dir', root);
  return args;
}

export function describeChanges({ agents, skills, hooks, scope = 'user' }, { home, strings, version, viaNpx }) {
  const has = (name) => agents.includes(name);
  const exists = (root) => fs.existsSync(path.join(home, root));
  const lines = [];
  if (viaNpx) lines.push(strings.changeGlobal(version));
  if (scope === 'project') {
    if (has('claude')) lines.push(strings.changeSkills(skills.length, '.claude/skills'), strings.changeLocalBridge('CLAUDE.local.md'));
    if (has('codex') || has('gemini')) lines.push(strings.changeSkills(skills.length, '.agents/skills'));
    if (hooks && has('claude')) lines.push(strings.changeLocalHooks('.claude/settings.local.json'));
    lines.push(strings.changeExclude);
    if (has('codex')) lines.push(strings.noteCodex);
    if (has('gemini')) lines.push(strings.noteGemini);
    return lines;
  }
  if (has('claude')) lines.push(strings.changeSkills(skills.length, '~/.claude/skills'));
  if (has('codex') || has('gemini')) lines.push(strings.changeSkills(skills.length, '~/.agents/skills'));
  if (has('claude') && exists('.claude')) lines.push(strings.changeBridge('~/.claude/CLAUDE.md'));
  if (has('codex') && exists('.codex')) lines.push(strings.changeBridge('~/.codex/AGENTS.md'), strings.changeCommands('~/.codex/prompts'));
  if (has('gemini') && exists('.gemini')) lines.push(strings.changeBridge('~/.gemini/GEMINI.md'), strings.changeCommands('~/.gemini/commands/flow'));
  if (hooks && has('claude') && exists('.claude')) lines.push(strings.changeHooks('~/.claude/settings.json'));
  if (hooks && has('codex') && exists('.codex')) lines.push(strings.changeHooks('~/.codex/hooks.json'));
  return lines;
}

function capture(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (error) => resolve({ status: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function defaultRunner(env) {
  return {
    install: (installScript, args) => capture(process.execPath, [installScript, ...args], { env }),
    installGlobal: (version) => capture(`npm install -g ${PACKAGE_NAME}@${version}`, [], { env, shell: true }),
    async globalRoot() {
      const r = await capture('npm root -g', [], { env, shell: true });
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
  rows = process.stdout.rows || 0,
  viaNpx = runsFromNpxCache(packageDir),
  runner = defaultRunner(env),
  interactive = !!(input.isTTY && output.isTTY),
}) {
  const systemLanguage = pickLanguage(env, lang);
  let t = stringsFor(systemLanguage);
  const write = (text) => output.write(`${text}\n`);
  if (!interactive) {
    write(t.needTerminal);
    return 1;
  }
  const useColor = !('NO_COLOR' in env);
  const symbols = symbolsFor(env);
  const paints = palette(useColor);
  const width = Math.max(20, columns - 1);
  const cancelled = () => {
    write(t.cancelled);
    return 130;
  };
  const banner = renderBanner({ lang: systemLanguage, version, cwd, isTTY: true, columns, env: { ...env, CI: undefined } });
  if (banner) write(banner);

  const allSkills = listSkills(packageDir);
  const detected = detectAgents(home);
  const coreSkills = CORE_SKILLS.filter((name) => allSkills.includes(name));
  const projectRoot = gitRoot(cwd);
  const chosen = {};
  const scopeFor = () => (chosen.scope === 'project' ? 'project' : 'user');
  const selectedAgents = () => chosen.agents || detected.filter((a) => a.detected).map((a) => a.value);
  const usesHooks = () => selectedAgents().some((name) => name === 'claude' || (name === 'codex' && scopeFor() === 'user'));
  const skillsFor = () => {
    if (chosen.preset === 'full') return allSkills;
    if (chosen.preset === 'custom') return chosen.custom;
    return coreSkills;
  };
  const hooksWanted = () => usesHooks() && chosen.hooks === true;
  const helpFor = (help, canGoBack) => (canGoBack ? `${help} · ${t.backHint}` : help);
  const labelOf = (value) => AGENTS.find((a) => a.value === value).label;

  const selectStep = ({ id, when, title, why, notes, options, summary, defaultIndex = 0 }) => ({
    id,
    when,
    summary,
    spec: (saved, canGoBack, frame) => ({
      initial: { index: saved ? saved.index : defaultIndex, options: options() },
      reduce: reduceSelect,
      value: selectValue,
      render: (s) => frame(renderSelect(s, { title: title(), why: why?.(), notes: notes?.() || [], help: helpFor(t.selectHelp, canGoBack), symbols, useColor, width })),
    }),
  });

  const multiStep = ({ id, when, title, why, options, required, summary }) => ({
    id,
    when,
    summary,
    spec: (saved, canGoBack, frame) => ({
      initial: {
        index: saved ? saved.index : 0,
        required,
        options: options().map((option) => {
          const previous = saved?.options.find((p) => p.value === option.value);
          return previous ? { ...option, checked: previous.checked } : option;
        }),
      },
      reduce: reduceMulti,
      value: multiValue,
      render: (s) => frame(renderMulti(s, { title: title(), why: why(), help: helpFor(t.multiHelp, canGoBack), requiredMessage: t.needOne, count: t.picked, symbols, useColor, width })),
    }),
  });

  const presetOptions = () => [
    { value: 'full', label: t.full, detail: t.fullDetail(allSkills.length) },
    { value: 'core', label: t.core, detail: t.coreDetail(coreSkills.length) },
    { value: 'custom', label: t.custom, detail: t.customDetail },
  ];
  const hookOptions = () => [
    { value: false, label: t.hooksNo, detail: t.hooksNoDetail },
    { value: true, label: t.hooksYes, detail: scopeFor() === 'project' ? t.hooksYesProjectDetail : t.hooksYesDetail },
  ];
  const scopeOptions = () => [
    { value: 'user', label: t.scopeUser, detail: t.scopeUserDetail },
    { value: 'project', label: t.scopeProject, detail: t.scopeProjectDetail(projectRoot) },
  ];

  const steps = [
    selectStep({
      id: 'language',
      when: () => lang !== 'en' && lang !== 'vi',
      title: () => 'Language / Ngôn ngữ',
      options: () => LANGUAGES,
      defaultIndex: LANGUAGES.findIndex((l) => l.value === systemLanguage),
      summary: () => LANGUAGES.find((l) => l.value === chosen.language).label,
    }),
    selectStep({
      id: 'scope',
      when: () => !!projectRoot,
      title: () => t.scopeTitle,
      why: () => t.scopeWhy,
      options: scopeOptions,
      summary: () => scopeOptions().find((o) => o.value === chosen.scope).label,
    }),
    multiStep({
      id: 'agents',
      required: true,
      title: () => t.agentsTitle,
      why: () => t.agentsWhy,
      options: () => detected.map((a) => ({ value: a.value, label: a.label, hint: a.detected ? t.detected : t.notFound, checked: a.detected })),
      summary: () => chosen.agents.map(labelOf).join(', '),
    }),
    selectStep({
      id: 'preset',
      title: () => t.presetTitle,
      why: () => t.presetWhy,
      options: presetOptions,
      summary: () => presetOptions().find((o) => o.value === chosen.preset).label,
    }),
    multiStep({
      id: 'custom',
      when: () => chosen.preset === 'custom',
      title: () => t.customTitle,
      why: () => t.customWhy,
      options: () =>
        allSkills.map((name) => ({
          value: name,
          label: name,
          hint: t.skillHints[name] || '',
          checked: CORE_SKILLS.includes(name),
          locked: name === 'flow',
        })),
      summary: () => t.skillTotal(chosen.custom.length),
    }),
    selectStep({
      id: 'hooks',
      when: usesHooks,
      title: () => t.hooksTitle,
      why: () => t.hooksWhy,
      options: hookOptions,
      summary: () => hookOptions().find((o) => o.value === chosen.hooks).label,
    }),
    selectStep({
      id: 'confirm',
      title: () => t.confirmTitle,
      notes: () => [
        `  ${paints.bold(t.review)}`,
        ...describeChanges({ agents: chosen.agents, skills: skillsFor(), hooks: hooksWanted(), scope: scopeFor() }, { home, strings: t, version, viaNpx }).flatMap((change) =>
          wrapText(change, width - 6).map((line, i) => `  ${i === 0 ? `${symbols.bullet} ` : '  '}${line}`),
        ),
      ],
      options: () => [
        { value: true, label: t.apply },
        { value: false, label: t.cancel },
      ],
    }),
  ];

  const lastStates = {};
  const walked = [];
  const summaryBlock = () => {
    const rowsOfAnswers = walked
      .map((position) => steps[position])
      .filter((step) => step.summary)
      .map((step) => [t.summaryLabels[step.id], step.summary()]);
    if (!rowsOfAnswers.length) return [];
    const labelWidth = Math.max(...rowsOfAnswers.map(([label]) => label.length));
    return [
      `  ${paints.dim(t.selectedTitle)}`,
      ...rowsOfAnswers.map(([label, value]) => `    ${paints.dim(label.padEnd(labelWidth))}   ${value}`),
      '',
    ];
  };

  let position = 0;
  while (position < steps.length) {
    const step = steps[position];
    if (step.when && !step.when()) {
      position++;
      continue;
    }
    const remaining = steps.slice(position + 1).filter((s) => !s.when || s.when()).length;
    const current = walked.length + 1;
    const total = current + remaining;
    const frame = (body) => {
      const head = ['', `  ${paints.accent(`${t.step} ${current}/${total}`)} · ${paints.bold(t.stepNames[step.id])}`, `  ${progressBar(current, total, { symbols, useColor })}`, ''];
      const full = [...head, ...summaryBlock(), ...body];
      return rows && full.length >= rows ? [...head, ...body] : full;
    };
    const canGoBack = walked.length > 0;
    const result = await runPrompt({
      input,
      output,
      columns,
      canGoBack,
      ...step.spec(lastStates[step.id], canGoBack, frame),
      onLeave: (state) => {
        lastStates[step.id] = state;
      },
    });
    if (result === CANCELLED) return cancelled();
    if (result === WENT_BACK) {
      position = walked.pop();
      continue;
    }
    chosen[step.id] = result;
    if (step.id === 'language') t = stringsFor(result);
    walked.push(position);
    position++;
  }
  if (chosen.confirm === false) return cancelled();

  const answers = { agents: chosen.agents, skills: skillsFor(), hooks: hooksWanted(), scope: scopeFor(), root: projectRoot };
  const { agents, skills, hooks } = answers;

  const spin = (label) => startSpinner({ output, label, symbols, useColor });
  write('');
  let installScript = path.join(packageDir, 'install.mjs');
  if (viaNpx) {
    const spinner = spin(t.installingGlobal);
    const global = await runner.installGlobal(version);
    const root = global.status === 0 ? await runner.globalRoot() : null;
    if (!root) {
      spinner.fail(t.globalFailed);
      if (global.stderr) write(global.stderr.trim());
      write(t.globalManual(version));
      return 1;
    }
    spinner.succeed(t.doneGlobal);
    installScript = path.join(root, PACKAGE_NAME, 'install.mjs');
  }

  const spinner = spin(t.applying);
  const result = await runner.install(installScript, installArgs({ ...answers, allSkills }));
  if (result.status !== 0) {
    spinner.fail(t.installFailed);
    write(`${result.stdout || ''}${result.stderr || ''}`.trim());
    return result.status || 1;
  }
  spinner.succeed(t.doneSkills(skills.length));
  const done = [t.doneAgents(agents.map(labelOf).join(', '))];
  if (hooks) done.push(t.doneHooks);
  for (const line of done) write(`  ${paints.good(symbols.success)} ${line}`);
  const skippedLines = (result.stdout || '').split('\n').filter((line) => /^\s*!/.test(line));
  if (skippedLines.length) {
    write(`\n  ${t.skipped}`);
    for (const line of skippedLines) write(`    ${line.trim().replace(/^!\s*/, '')}`);
  }
  write(`\n  ${paints.bold(t.next)}`);
  const nextSteps = answers.scope === 'project' ? [t.nextRestart, t.nextInitProject, t.undoProject, t.nextHelp] : [t.nextRestart, t.nextInit, t.nextHelp];
  for (const line of nextSteps) write(`    → ${line}`);
  write('');
  return 0;
}
