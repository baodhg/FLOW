#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderBanner } from '../lib/banner.mjs';
import { findCommand, renderAll, renderCommand, renderOverview, renderUnknown } from '../lib/help.mjs';
import { pickLanguage } from '../lib/lang.mjs';
import { cmdProvenance } from '../lib/provenance.mjs';
import { realDir } from '../lib/util.mjs';
import { isSetUp, runWizard, runsFromNpxCache } from '../lib/wizard.mjs';
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
import { cmdReport } from '../lib/report.mjs';
import { cmdSecrets } from '../lib/secretscmd.mjs';

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
  const cwd = realDir(process.cwd());
  const takesSub = new Set(['rules', 'memory', 'plan', 'context', 'hook', 'dup', 'task', 'runbook', 'wt', 'onboard', 'user', 'secrets', 'report']);
  let sub;
  let args = rest;
  if (takesSub.has(cmd) && rest[0] && !rest[0].startsWith('--')) {
    sub = rest[0];
    args = rest.slice(1);
  }
  const opts = normalize(parseArgs(args));
  if (cmd && findCommand(cmd) && (rest.includes('--help') || rest.includes('-h'))) return showHelp(cmd, opts);
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
    case 'report':
      return cmdReport(cwd, sub, opts);
    case 'dup':
      return cmdDup(cwd, sub, opts);
    case 'hook':
      return cmdHook(cwd, sub);
    case 'version':
    case '--version':
    case '-v':
      console.log(packageVersion());
      return 0;
    case 'setup':
      return runWizard({ packageDir: HOME, version: packageVersion(), cwd, lang: opts.lang });
    case undefined:
    case 'help':
    case '--help':
    case '-h': {
      const terminal = !!(process.stdin.isTTY && process.stdout.isTTY);
      if (cmd === undefined && terminal && (runsFromNpxCache(HOME) || !isSetUp(os.homedir()))) {
        return runWizard({ packageDir: HOME, version: packageVersion(), cwd, lang: opts.lang });
      }
      const topic = opts._[0];
      if (topic || opts.all) return showHelp(topic, opts);
      const banner = renderBanner({ lang: pickLanguage(process.env, opts.lang), version: packageVersion(), cwd, isTTY: !!process.stdout.isTTY, columns: process.stdout.columns || 80, env: process.env });
      if (banner) console.log(banner);
      return showHelp(undefined, opts);
    }
    default:
      console.log(renderUnknown(cmd, { lang: pickLanguage(process.env, opts.lang) }));
      return 1;
  }
}

function showHelp(topic, opts) {
  const style = {
    lang: pickLanguage(process.env, opts.lang),
    useColor: !!process.stdout.isTTY && !('NO_COLOR' in process.env),
    columns: process.stdout.columns || 80,
  };
  if (opts.all) {
    console.log(renderAll(style));
    return 0;
  }
  if (!topic) {
    console.log(renderOverview(style));
    return 0;
  }
  const command = findCommand(topic);
  if (!command) {
    console.log(renderUnknown(topic, style));
    return 1;
  }
  console.log(renderCommand(command, style));
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code || 0;
  })
  .catch((e) => {
    console.error(`flow: ${e.message}`);
    process.exitCode = 1;
  });
