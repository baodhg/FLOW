#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderBanner } from '../lib/banner.mjs';
import { cmdProvenance } from '../lib/provenance.mjs';
import {
  HOME,
  cmdCheck,
  cmdCommitMsg,
  cmdContext,
  cmdDoctor,
  cmdDup,
  cmdTask,
  cmdRunbook,
  cmdSelftest,
  cmdPrMsg,
  cmdExclude,
  cmdGates,
  cmdHook,
  cmdInit,
  cmdMemory,
  cmdPlan,
  cmdReindex,
  cmdRules,
  cmdSync,
  cmdVerify,
  cmdWhere,
} from '../lib/commands.mjs';
import { cmdWorktree } from '../lib/wtcmd.mjs';
import { cmdFingerprint, cmdOnboard, cmdUser } from '../lib/onboard.mjs';
import { cmdSecrets } from '../lib/secretscmd.mjs';

const HELP = `flowctl — công cụ của bộ skill agent-flow (nguồn: ${HOME})

Khung
  fingerprint [--path dir] [--json]   đo quy ước của MỘT dự án bất kỳ (chỉ đọc, không cần .flow)
  onboard · onboard decide <Dn> <số> · onboard refresh   điều cần chốt khi join / đo lại quy ước
  user · user set <khoá> <giá trị>      sở thích của bạn (~/.agent-flow/user.json) — lớp DƯỚI quy ước dự án
  where                         flow root, profile, repo, số rules/memory/plan
  init [--stack dotnet,react@src/web] [--gates a,b|all] [--comments off|no-new|unit|file] [--commit-body free|trailers-only]
       [--context CONTEXT.md] [--track-harness] [--name X] [--force]
  exclude [--dry]               ghi .git/info/exclude cho mọi repo + kiểm check-ignore
  doctor                        sức khoẻ: exclude, tệp quá lớn, index lệch, plan sai chỗ
  reindex                       sinh lại INDEX.md của rules / memory / plans

Tri thức
  rules find [--path p]… [--changed|--staged] [--tag t] [--text q] [--json]
  rules new --title "…" [--type invariant|trap|convention|decision] [--severity critical|high|medium|low]
            [--scope "glob,glob"] [--tags a,b] [--origin "…"] [--enforced "…"]
  rules list | rules show R-0001
  memory [--text q] | memory new --type user|feedback|project|reference --name "…" --desc "…"
  context missing [--changed|--staged|--path p] [--strict] | context new <dir> | context stale | context list
  gates [--path p]… [--changed] [--print explore|execute|post|all] [--all]
  sync [--mark]                 module nào cần cập nhật ngữ cảnh kể từ mốc đồng bộ

Cài đặt
  version                                   in phiên bản (cũng nhận --version, -v)
  install [--hooks] [--no-bridge] [--dry]   nối skill vào các agent CLI, chèn khối chỉ dẫn, cài hook nếu chọn
  uninstall [--dry]                         gỡ mọi thứ install đã thêm (chạy trước npm uninstall)

Ranh giới dự án và bộ skill
  provenance --against <thư mục> [--against …] [--limit n]   đo đoạn trùng nguyên văn với dự án (chỉ đọc)

Bí mật & thông tin cá nhân (không bao giờ in giá trị)
  secrets scan [--staged|--base r|--history|--local] [--path dir] [--env tệp] [--no-pii] [--no-gitleaks] [--json]
  secrets env <tệp>             xem .env an toàn: tên khoá, độ dài, host
  secrets watch --label x < tệp theo dõi giá trị / tên riêng (chỉ lưu hash)
  secrets allow <#mã> --reason "…" [--debt]   phán xử sau khi đã MỞ RA XEM

DRY
  dup find <ý đồ>               đã có hàm nào làm việc này chưa (tên đồng nghĩa + API cốt lõi)
  dup check [--staged|--base r] chặn bản trùng MỚI so với baseline (cũng chạy trong flowctl check)
  dup baseline [--refresh]      ghi nợ trùng hiện có — chỉ chặn cái mới
  dup report [--path dir]       tầm soát (chạy được trên repo chưa có .flow)
  dup allow <key> --reason "…"   ngoại lệ có lý do

Quy trình
  plan new <slug> [--title "…"] [--branch b] [--repos a,b] | plan status <slug> <STATUS> [--force] | plan list [--all] | plan show <slug>
  plan decisions <slug> [--json]   quyết định đang mở, in sẵn dạng hỏi trên chat (exit 1 nếu còn)
  plan decide <slug> <Dn> "<lựa chọn>" [--by "…"]   ghi câu trả lời vào biên bản §0
  task next|list <slug> · task done <slug> <Tn> [--commit sha] · task add <slug> "…" · task note <slug> "…" [--kind helper|friction|decision]
  runbook new acceptance|ops|data-op|release|handoff <slug> [--plan p] · runbook lint <slug> [--after] · runbook list
  wt new <slug> [--repo r] [--base ref] · wt list · wt context <slug> · wt done <slug> [--force]   một việc song song = một worktree
  verify [--dry] [--full] [--only a,b] [--staged] [--all]
  check [--staged] [--base ref] [--all]    chú thích mới · lộ harness · tệp harness sắp vào git · customChecks
  commitmsg [file] | commitmsg --message "…"   tiêu đề Conventional Commits tiếng Anh cho người đọc · thân chỉ trailer
  prmsg <tệp> | prmsg --message "…"          mô tả PR/MR: tiếng Việt có dấu, ngắn, không kỹ thuật, không lộ harness
  hook pretool                  PreToolUse hook (stdin JSON) chặn ghi lên nhánh được bảo vệ
  hook session                  SessionStart hook: nạp lại trạng thái flow (plan, task kế, quyết định chờ) sau khởi động / nén
  selftest                      tự kiểm bộ skill theo chuẩn (description, độ dài, liên kết một cấp, khuôn)

Phạm vi mặc định: repo chứa thư mục hiện tại; --all = mọi repo của workspace.`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let val;
      if (eq > 0) val = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i];
      else val = true;
      if (opts[key] === undefined) opts[key] = val;
      else opts[key] = [].concat(opts[key], val);
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

const BOOL = new Set(['history', 'local', 'debt', 'no-gitleaks', 'no-pii', 'after', 'refresh', 'changed', 'staged', 'all', 'dry', 'full', 'force', 'json', 'strict', 'mark', 'retired', 'track-harness', 'no-global']);

function normalize(opts) {
  for (const k of Object.keys(opts)) {
    if (BOOL.has(k) && typeof opts[k] === 'string') {
      opts._.push(opts[k]);
      opts[k] = true;
    }
  }
  return opts;
}

function packageVersion() {
  return JSON.parse(readFileSync(path.join(HOME, 'package.json'), 'utf8')).version;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  const takesSub = new Set(['rules', 'memory', 'plan', 'context', 'hook', 'dup', 'task', 'runbook', 'wt', 'onboard', 'user', 'secrets']);
  let sub;
  let args = rest;
  if (takesSub.has(cmd) && rest[0] && !rest[0].startsWith('--')) {
    sub = rest[0];
    args = rest.slice(1);
  }
  const opts = normalize(parseArgs(args));
  switch (cmd) {
    case 'where':
      return cmdWhere(cwd);
    case 'init':
      return cmdInit(cwd, opts);
    case 'exclude':
      return cmdExclude(cwd, opts);
    case 'doctor':
      return cmdDoctor(cwd);
    case 'reindex':
      return cmdReindex(cwd);
    case 'rules':
      return cmdRules(cwd, sub, opts);
    case 'memory':
      return cmdMemory(cwd, sub, opts);
    case 'plan':
      return cmdPlan(cwd, sub, opts);
    case 'context':
      return cmdContext(cwd, sub, opts);
    case 'gates':
      return cmdGates(cwd, opts);
    case 'sync':
      return cmdSync(cwd, opts);
    case 'verify':
      return cmdVerify(cwd, opts);
    case 'check':
      return cmdCheck(cwd, opts);
    case 'commitmsg':
      return cmdCommitMsg(cwd, opts);
    case 'fingerprint':
      return cmdFingerprint(cwd, opts);
    case 'onboard':
      return cmdOnboard(cwd, sub, opts);
    case 'user':
      return cmdUser(cwd, sub, opts);
    case 'secrets':
      return cmdSecrets(cwd, sub, opts);
    case 'provenance':
      return cmdProvenance(HOME, opts);
    case 'install':
    case 'uninstall': {
      const flags = cmd === 'uninstall' ? ['--uninstall', ...rest] : rest;
      return spawnSync(process.execPath, [path.join(HOME, 'install.mjs'), ...flags], { stdio: 'inherit' }).status ?? 1;
    }
    case 'wt':
      return cmdWorktree(cwd, sub, opts);
    case 'prmsg':
      return cmdPrMsg(cwd, opts);
    case 'selftest':
      return cmdSelftest();
    case 'runbook':
      return cmdRunbook(cwd, sub, opts);
    case 'task':
      return cmdTask(cwd, sub, opts);
    case 'dup':
      return cmdDup(cwd, sub, opts);
    case 'hook':
      return cmdHook(cwd, sub);
    case 'version':
    case '--version':
    case '-v':
      console.log(packageVersion());
      return 0;
    case 'help':
    case '--help':
    case '-h':
    case undefined: {
      const banner = renderBanner({ version: packageVersion(), isTTY: !!process.stdout.isTTY, columns: process.stdout.columns || 80, env: process.env });
      if (banner) console.log(banner);
      console.log(HELP);
      return 0;
    }
    default:
      console.log(`Lệnh lạ: ${cmd}\n`);
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code || 0;
  })
  .catch((e) => {
    console.error(`flowctl: ${e.message}`);
    process.exitCode = 1;
  });
