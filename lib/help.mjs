import { palette, wrapText } from './prompts.mjs';

const GROUPS = [
  { id: 'start', en: 'Get started', vi: 'Bắt đầu' },
  { id: 'daily', en: 'Everyday work', vi: 'Làm việc hằng ngày' },
  { id: 'knowledge', en: 'Project knowledge', vi: 'Tri thức dự án' },
  { id: 'quality', en: 'Safety and quality', vi: 'An toàn và chất lượng' },
  { id: 'install', en: 'Installation and settings', vi: 'Cài đặt và thiết lập' },
];

const form = (use, en, vi) => ({ use, en, vi });

export const COMMANDS = [
  {
    name: 'setup', group: 'start', en: 'Install step by step in the terminal', vi: 'Cài đặt từng bước trong terminal',
    forms: [form('flow setup [--lang en|vi]', 'Choose tools and skills, review the changes, then apply them', 'Chọn công cụ và skill, xem trước thay đổi rồi áp dụng')],
  },
  {
    name: 'init', group: 'start', en: 'Bring the current repository into FLOW', vi: 'Đưa repo hiện tại vào FLOW',
    forms: [form('flow init [--stack dotnet,react@src/web] [--gates a,b|all] [--comments off|no-new|unit|file] [--commit-body free|trailers-only] [--context CONTEXT.md] [--track-harness] [--name X] [--force]', 'Measure conventions and create the local .flow folder', 'Đo quy ước và tạo thư mục .flow cục bộ')],
  },
  {
    name: 'where', group: 'start', en: 'Show where you are and the current status', vi: 'Xem đang ở đâu và trạng thái hiện tại',
    forms: [form('flow where', 'Flow root, profile, repositories, counts of rules, memories and plans', 'Thư mục gốc, cấu hình, repo, số luật, memory và plan')],
  },
  {
    name: 'doctor', group: 'start', en: 'Find setup problems', vi: 'Tìm lỗi thiết lập',
    forms: [form('flow doctor', 'Check excludes, oversized files, stale indexes and misplaced plans', 'Kiểm tra exclude, tệp quá lớn, chỉ mục lệch và plan sai chỗ')],
  },
  {
    name: 'plan', group: 'daily', en: 'Create and track plans', vi: 'Tạo và theo dõi kế hoạch',
    forms: [
      form('flow plan new <slug> [--title "…"] [--branch b] [--repos a,b]', 'Create a plan', 'Tạo plan'),
      form('flow plan status <slug> <STATUS> [--force]', 'Change its status', 'Đổi trạng thái'),
      form('flow plan list [--all]', 'List plans', 'Liệt kê plan'),
      form('flow plan show <slug>', 'Show one plan', 'Xem một plan'),
      form('flow plan decisions <slug> [--json]', 'Show open decisions; exits 1 if any remain', 'Xem quyết định còn mở; trả về 1 nếu còn'),
      form('flow plan decide <slug> <Dn> "<choice>" [--by "…"]', 'Record the answer to a decision', 'Ghi câu trả lời cho một quyết định'),
    ],
  },
  {
    name: 'task', group: 'daily', en: 'See the next task and mark work done', vi: 'Xem việc kế tiếp và đánh dấu xong',
    forms: [
      form('flow task next <slug>', 'Show the next open task', 'Xem việc còn mở kế tiếp'),
      form('flow task list <slug>', 'List tasks', 'Liệt kê việc'),
      form('flow task done <slug> <Tn> [--commit sha]', 'Mark a task done', 'Đánh dấu một việc đã xong'),
      form('flow task add <slug> "…"', 'Add a task', 'Thêm việc'),
      form('flow task note <slug> "…" [--kind helper|friction|decision]', 'Add a note to the ledger', 'Ghi vào nhật ký plan'),
    ],
  },
  {
    name: 'check', group: 'daily', en: 'Check changes before you commit', vi: 'Kiểm tra thay đổi trước khi commit',
    forms: [form('flow check [--staged] [--base ref] [--all]', 'New comments, secrets, naming, duplicates, harness leaks and custom checks', 'Chú thích mới, bí mật, đặt tên, mã trùng, lộ harness và kiểm tra riêng')],
  },
  {
    name: 'verify', group: 'daily', en: "Run the project's verification commands", vi: 'Chạy các lệnh kiểm chứng của dự án',
    forms: [form('flow verify [--dry] [--full] [--only a,b] [--staged] [--all]', 'Run the commands in the profile', 'Chạy các lệnh trong cấu hình')],
  },
  {
    name: 'commitmsg', group: 'daily', en: 'Check a commit message', vi: 'Kiểm tra commit message',
    forms: [
      form('flow commitmsg [file]', 'Check a message from a file', 'Kiểm tra message trong tệp'),
      form('flow commitmsg --message "…"', 'Check a message directly', 'Kiểm tra message trực tiếp'),
    ],
  },
  {
    name: 'prmsg', group: 'daily', en: 'Check a pull request description', vi: 'Kiểm tra mô tả pull request',
    forms: [
      form('flow prmsg <file>', 'Check a description from a file', 'Kiểm tra mô tả trong tệp'),
      form('flow prmsg --message "…"', 'Check a description directly', 'Kiểm tra mô tả trực tiếp'),
    ],
  },
  {
    name: 'wt', group: 'daily', en: 'Run parallel work in worktrees', vi: 'Làm song song bằng worktree',
    forms: [
      form('flow wt new <slug> [--repo r] [--base ref]', 'Create a worktree and carry the local context over', 'Tạo worktree và mang theo ngữ cảnh cục bộ'),
      form('flow wt list', 'List worktrees', 'Liệt kê worktree'),
      form('flow wt context <slug>', 'Copy the context again', 'Chép lại ngữ cảnh'),
      form('flow wt done <slug> [--force]', 'Merge the context back and remove the worktree', 'Gộp ngữ cảnh về và gỡ worktree'),
    ],
  },
  {
    name: 'runbook', group: 'daily', en: 'Write manual procedures you can read results from', vi: 'Viết quy trình chạy tay đọc được kết quả',
    forms: [
      form('flow runbook new acceptance|ops|data-op|release|handoff <slug> [--plan p]', 'Create a runbook from a template', 'Tạo runbook từ khuôn mẫu'),
      form('flow runbook lint <slug> [--after]', 'Check that it is complete', 'Kiểm tra đã đủ chưa'),
      form('flow runbook list', 'List runbooks', 'Liệt kê runbook'),
    ],
  },
  {
    name: 'rules', group: 'knowledge', en: 'Rules this project must follow', vi: 'Luật dự án phải tuân theo',
    forms: [
      form('flow rules find [--path p]… [--changed|--staged] [--tag t] [--text q] [--json]', 'Find rules that apply', 'Tìm luật áp dụng'),
      form('flow rules new --title "…" [--type invariant|trap|convention|decision] [--severity critical|high|medium|low] [--scope "glob,glob"] [--tags a,b] [--origin "…"] [--enforced "…"]', 'Add a rule', 'Thêm luật'),
      form('flow rules list', 'List rules', 'Liệt kê luật'),
      form('flow rules show R-0001', 'Show one rule', 'Xem một luật'),
    ],
  },
  {
    name: 'memory', group: 'knowledge', en: 'Notes on how to work in this project', vi: 'Ghi chú về cách làm việc trong dự án',
    forms: [
      form('flow memory [--text q]', 'Search memories', 'Tìm memory'),
      form('flow memory new --type user|feedback|project|reference --name "…" --desc "…"', 'Add a memory', 'Thêm memory'),
    ],
  },
  {
    name: 'context', group: 'knowledge', en: 'Context documents for each module', vi: 'Tài liệu ngữ cảnh của từng module',
    forms: [
      form('flow context missing [--changed|--staged|--path p] [--strict]', 'Find modules without a document', 'Tìm module chưa có tài liệu'),
      form('flow context new <dir>', 'Create a document', 'Tạo tài liệu'),
      form('flow context stale', 'Find outdated documents', 'Tìm tài liệu nghi cũ'),
      form('flow context list', 'List documents', 'Liệt kê tài liệu'),
    ],
  },
  {
    name: 'gates', group: 'knowledge', en: 'Checklists for each type of change', vi: 'Danh sách kiểm theo loại thay đổi',
    forms: [form('flow gates [--path p]… [--changed] [--print explore|execute|post|all] [--all]', 'Show the checklists that apply', 'Xem danh sách kiểm áp dụng')],
  },
  {
    name: 'sync', group: 'knowledge', en: 'See which context fell behind the code', vi: 'Xem ngữ cảnh nào đã lệch so với mã',
    forms: [form('flow sync [--mark]', 'List modules changed since the last sync; --mark records a new sync point', 'Liệt kê module đổi từ lần đồng bộ trước; --mark ghi mốc mới')],
  },
  {
    name: 'reindex', group: 'knowledge', en: 'Rebuild generated indexes', vi: 'Sinh lại các chỉ mục tự động',
    forms: [form('flow reindex', 'Rebuild INDEX.md for rules, memories and plans', 'Sinh lại INDEX.md của luật, memory và plan')],
  },
  {
    name: 'secrets', group: 'quality', en: 'Find secrets and personal data without printing them', vi: 'Dò bí mật và dữ liệu cá nhân mà không in giá trị',
    forms: [
      form('flow secrets scan [--staged|--base r|--history|--local] [--path dir] [--env file] [--no-pii] [--no-gitleaks] [--json]', 'Scan the tree, staged changes or history', 'Quét cây mã, phần staged hoặc lịch sử'),
      form('flow secrets env <file>', 'View a .env file safely: key names, lengths, hosts', 'Xem .env an toàn: tên khoá, độ dài, host'),
      form('flow secrets watch --label x < file', 'Watch a value or a name; only its hash is stored', 'Theo dõi một giá trị hay tên riêng; chỉ lưu hash'),
      form('flow secrets allow <#code> --reason "…" [--debt]', 'Record a decision after inspecting a finding', 'Ghi phán xử sau khi đã mở ra xem'),
    ],
  },
  {
    name: 'dup', group: 'quality', en: 'Find code that already exists', vi: 'Tìm mã đã có sẵn',
    forms: [
      form('flow dup find <intent>', 'Search for a function by what it does', 'Tìm hàm theo việc nó làm'),
      form('flow dup check [--staged|--base r]', 'Block new duplicates compared with the baseline', 'Chặn bản trùng mới so với baseline'),
      form('flow dup baseline [--refresh]', 'Record existing duplicates as known debt', 'Ghi nợ trùng hiện có'),
      form('flow dup report [--path dir]', 'Report duplicates; works without .flow', 'Báo cáo trùng lặp; chạy được khi chưa có .flow'),
      form('flow dup allow <key> --reason "…"', 'Allow an exception with a reason', 'Cho phép ngoại lệ kèm lý do'),
    ],
  },
  {
    name: 'provenance', group: 'quality', en: 'Measure text copied from a project into the pack', vi: 'Đo đoạn chép từ dự án vào bộ skill',
    forms: [form('flow provenance --against <dir> [--against …] [--limit n]', 'Read only; finds verbatim overlap', 'Chỉ đọc; tìm đoạn trùng nguyên văn')],
  },
  {
    name: 'selftest', group: 'quality', en: 'Check the skill pack against its standards', vi: 'Tự kiểm bộ skill theo chuẩn',
    forms: [form('flow selftest', 'Descriptions, length, links and templates', 'Mô tả, độ dài, liên kết và khuôn mẫu')],
  },
  {
    name: 'install', group: 'install', en: 'Install without any questions, for scripts', vi: 'Cài không hỏi gì, dành cho script',
    forms: [form('flow install [--agents a,b] [--skills a,b|core] [--hooks] [--no-bridge] [--dry]', 'Link skills, add the instruction block and optional hooks', 'Nối skill, thêm khối chỉ dẫn và hook nếu chọn')],
  },
  {
    name: 'uninstall', group: 'install', en: 'Remove everything install added', vi: 'Gỡ mọi thứ đã cài',
    forms: [form('flow uninstall [--dry]', 'Run this before npm uninstall', 'Chạy lệnh này trước npm uninstall')],
  },
  {
    name: 'fingerprint', group: 'install', en: "Measure any project's conventions", vi: 'Đo quy ước của một dự án bất kỳ',
    forms: [form('flow fingerprint [--path dir] [--json]', 'Read only; works without .flow', 'Chỉ đọc; chạy được khi chưa có .flow')],
  },
  {
    name: 'onboard', group: 'install', en: 'Decide what is left after joining a project', vi: 'Chốt những điều còn lại khi vào dự án',
    forms: [
      form('flow onboard', 'Show what needs a decision', 'Xem điều cần chốt'),
      form('flow onboard decide <Dn> <number>', 'Record your choice', 'Ghi lựa chọn'),
      form('flow onboard refresh', 'Measure conventions again', 'Đo lại quy ước'),
    ],
  },
  {
    name: 'user', group: 'install', en: 'Your personal preferences', vi: 'Sở thích cá nhân của bạn',
    forms: [
      form('flow user', 'Show ~/.agent-flow/user.json; project conventions take priority', 'Xem ~/.agent-flow/user.json; quy ước dự án được ưu tiên'),
      form('flow user set <key> <value>', 'Change a preference', 'Đổi một sở thích'),
    ],
  },
  {
    name: 'exclude', group: 'install', en: 'Keep local files out of git', vi: 'Giữ tệp cục bộ ngoài git',
    forms: [form('flow exclude [--dry]', 'Write .git/info/exclude for every repository and check it', 'Ghi .git/info/exclude cho mọi repo và kiểm tra')],
  },
  {
    name: 'version', group: 'install', en: 'Print the version', vi: 'In phiên bản',
    forms: [form('flow version', 'Also accepts --version and -v', 'Cũng nhận --version và -v')],
  },
  {
    name: 'hook', hidden: true, en: 'Entry points called by agent hooks', vi: 'Điểm vào do hook của agent gọi',
    forms: [
      form('flow hook pretool', 'PreToolUse hook; reads JSON from stdin', 'Hook PreToolUse; đọc JSON từ stdin'),
      form('flow hook session', 'SessionStart hook; restores the plan, next task and open decisions', 'Hook SessionStart; nạp lại plan, việc kế và quyết định chờ'),
    ],
  },
];

const TEXT = {
  en: {
    usage: 'Usage',
    usageLine: 'flow <command> [options]',
    details: 'Details for one command:',
    detailsCommand: 'flow help <command>',
    everything: 'Every command in full:',
    scope: 'Commands act on the repository containing the current folder; --all covers the whole workspace.',
    unknown: (name) => `Unknown command: ${name}`,
    how: 'How to use it',
    related: 'All commands: flow help',
  },
  vi: {
    usage: 'Cách dùng',
    usageLine: 'flow <lệnh> [tuỳ chọn]',
    details: 'Xem chi tiết một lệnh:',
    detailsCommand: 'flow help <lệnh>',
    everything: 'Xem đầy đủ mọi lệnh:',
    scope: 'Lệnh tác động lên repo chứa thư mục hiện tại; --all áp dụng cho cả workspace.',
    unknown: (name) => `Không có lệnh: ${name}`,
    how: 'Cách dùng',
    related: 'Mọi lệnh: flow help',
  },
};

export function findCommand(name) {
  return COMMANDS.find((c) => c.name === name) || null;
}

export function renderOverview({ lang = 'en', useColor = false } = {}) {
  const t = TEXT[lang] || TEXT.en;
  const paints = palette(useColor);
  const visible = COMMANDS.filter((c) => !c.hidden);
  const width = Math.max(...visible.map((c) => c.name.length));
  const lines = [`${paints.bold(t.usage)}`, `  ${t.usageLine}`, ''];
  for (const group of GROUPS) {
    lines.push(paints.bold(group[lang] || group.en));
    for (const command of visible.filter((c) => c.group === group.id)) {
      lines.push(`  ${paints.accent(command.name.padEnd(width))}   ${command[lang] || command.en}`);
    }
    lines.push('');
  }
  lines.push(`${t.details} ${paints.accent(t.detailsCommand)}`);
  lines.push(`${t.everything} ${paints.accent('flow help --all')}`);
  return lines.join('\n');
}

function wrapUse(use, columns) {
  const words = wrapText(use, Math.max(30, columns - 6));
  return words.map((line, i) => `${i === 0 ? '  ' : '      '}${line}`);
}

export function renderCommand(command, { lang = 'en', useColor = false, columns = 80 } = {}) {
  const t = TEXT[lang] || TEXT.en;
  const paints = palette(useColor);
  const lines = [`${paints.bold(`flow ${command.name}`)} · ${command[lang] || command.en}`, '', paints.bold(t.how)];
  command.forms.forEach((entry, i) => {
    if (i > 0) lines.push('');
    for (const line of wrapUse(entry.use, columns)) lines.push(paints.accent(line));
    for (const line of wrapText(entry[lang] || entry.en, Math.max(30, columns - 6))) lines.push(`      ${paints.dim(line)}`);
  });
  return lines.join('\n');
}

export function renderAll({ lang = 'en', useColor = false, columns = 80 } = {}) {
  const t = TEXT[lang] || TEXT.en;
  const parts = [`${t.usage}: ${t.usageLine}`, t.scope];
  for (const command of COMMANDS) parts.push(renderCommand(command, { lang, useColor, columns }));
  return parts.join('\n\n');
}

export function renderUnknown(name, { lang = 'en' } = {}) {
  const t = TEXT[lang] || TEXT.en;
  return `${t.unknown(name)}\n${t.related}`;
}
