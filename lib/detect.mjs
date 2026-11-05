import path from 'node:path';
import { exists, git, readText, toPosix } from './util.mjs';

const JS_EXT = '**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,vue,svelte}';
const DOTNET_GLOBS = ['**/*.cs', '**/*.csproj', '**/*.sln', '**/*.slnx', '**/*.props', '**/*.proto', '**/appsettings*.json'];
const MANIFEST = /(^|\/)(package\.json|go\.mod|pyproject\.toml|requirements\.txt|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml|[^/]+\.slnx?|[^/]+\.csproj)$/;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|bin|obj|\.git|\.flow|examples?|samples?|fixtures?|testdata)\//;

function pkgRunner(dir) {
  if (exists(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(dir, 'bun.lockb')) || exists(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

function scriptCmd(runner, name) {
  if (runner === 'npm') return name === 'test' ? 'npm test' : `npm run ${name}`;
  return `${runner} ${name}`;
}

function scoped(sub, globs) {
  if (!sub || sub === '.') return globs;
  return globs.map((g) => `${sub}/${g}`);
}

function entry(sub, item) {
  const out = { ...item, when: scoped(sub, item.when) };
  if (sub && sub !== '.') out.cwd = sub;
  return out;
}

function nodeEntries(dir, sub) {
  const stacks = [];
  const verify = [];
  let pkg = {};
  try {
    pkg = JSON.parse(readText(path.join(dir, 'package.json')) || '{}');
  } catch {
    pkg = {};
  }
  if (pkg.workspaces && sub !== '.') return { stacks, verify };
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const kind = deps['@nestjs/core']
    ? 'nestjs'
    : deps.next
      ? 'nextjs'
      : deps.react || deps['react-native']
        ? 'react'
        : deps.vue
          ? 'vue'
          : deps.express || deps.fastify || deps.hono
            ? 'node-api'
            : 'node';
  stacks.push(kind);
  const runner = pkgRunner(dir);
  const scripts = pkg.scripts || {};
  const pick = (names) => names.find((n) => scripts[n]);
  const globs = [JS_EXT, 'package.json', '**/tsconfig*.json'];
  const lint = pick(['lint', 'lint:check', 'eslint']);
  const types = pick(['typecheck', 'type-check', 'tsc', 'check-types', 'types']);
  const test = pick(['test', 'test:unit', 'vitest', 'jest']);
  const build = pick(['build']);
  const tag = sub === '.' ? '' : `${path.basename(sub)}:`;
  if (lint) verify.push(entry(sub, { name: `${tag}lint`, when: globs, run: scriptCmd(runner, lint) }));
  if (types) verify.push(entry(sub, { name: `${tag}typecheck`, when: globs, run: scriptCmd(runner, types) }));
  else if (exists(path.join(dir, 'tsconfig.json'))) verify.push(entry(sub, { name: `${tag}typecheck`, when: globs, run: 'npx tsc --noEmit' }));
  if (test && !/no test specified/.test(scripts[test])) verify.push(entry(sub, { name: `${tag}test`, when: globs, run: scriptCmd(runner, test) }));
  if (build) verify.push(entry(sub, { name: `${tag}build`, when: globs, run: scriptCmd(runner, build), optional: true }));
  const prisma = ['prisma/schema.prisma', 'schema.prisma'].find((p) => exists(path.join(dir, p)));
  if (prisma) {
    stacks.push('prisma');
    verify.push(entry(sub, { name: `${tag}prisma-validate`, when: ['**/*.prisma', '**/migrations/**'], run: 'npx prisma validate' }));
  }
  return { stacks, verify };
}

export function dotnetEntries(target, sub = '.') {
  const t = target ? ` ${target}` : '';
  return [
    entry(sub, { name: 'dotnet-build', when: DOTNET_GLOBS, run: `dotnet build${t} --nologo -clp:ErrorsOnly`, requires: target || '*.sln*' }),
    entry(sub, { name: 'dotnet-test', when: DOTNET_GLOBS, run: `dotnet test${t} --nologo`, requires: target || '*.sln*' }),
    entry(sub, { name: 'dotnet-format', when: ['**/*.cs'], run: `dotnet format${t} --verify-no-changes`, requires: target || '*.sln*', optional: true }),
  ];
}

export function plannedEntries(stack, cwd = '.') {
  if (stack === 'dotnet') return dotnetEntries('', cwd);
  if (stack === 'node' || stack === 'react') {
    const globs = [JS_EXT, 'package.json', '**/tsconfig*.json'];
    const tag = cwd === '.' ? '' : `${path.basename(cwd)}:`;
    return [
      entry(cwd, { name: `${tag}lint`, when: globs, run: 'npm run lint', requires: 'package.json' }),
      entry(cwd, { name: `${tag}typecheck`, when: globs, run: 'npx tsc --noEmit', requires: 'tsconfig.json' }),
      entry(cwd, { name: `${tag}test`, when: globs, run: 'npm test', requires: 'package.json' }),
      entry(cwd, { name: `${tag}build`, when: globs, run: 'npm run build', requires: 'package.json', optional: true }),
    ];
  }
  if (stack === 'go') return [entry(cwd, { name: 'go-build', when: ['**/*.go'], run: 'go build ./...', requires: 'go.mod' }), entry(cwd, { name: 'go-test', when: ['**/*.go'], run: 'go test ./...', requires: 'go.mod' })];
  if (stack === 'python') return [entry(cwd, { name: 'pytest', when: ['**/*.py'], run: 'pytest -q', requires: 'pyproject.toml' })];
  return [];
}

function manifestFiles(repoDir) {
  const tracked = git(repoDir, ['ls-files']).out.split('\n');
  const untracked = git(repoDir, ['ls-files', '--others', '--exclude-standard']).out.split('\n');
  return [...new Set([...tracked, ...untracked])]
    .filter(Boolean)
    .filter((f) => MANIFEST.test(f) && !SKIP_DIR.test(f) && f.split('/').length <= 4);
}

export function detectStacks(repoDir) {
  const stacks = new Set();
  const verify = [];
  const files = manifestFiles(repoDir);
  const dirOf = (f) => toPosix(path.dirname(f)) || '.';
  const sln = files.filter((f) => /\.slnx?$/.test(f)).sort((a, b) => a.split('/').length - b.split('/').length);
  const csproj = files.filter((f) => f.endsWith('.csproj'));
  if (sln.length) {
    stacks.add('dotnet');
    const top = sln[0];
    verify.push(...dotnetEntries(path.basename(top), dirOf(top)));
  } else if (csproj.length) {
    stacks.add('dotnet');
    for (const p of csproj.slice(0, 8)) verify.push(...dotnetEntries(path.basename(p), dirOf(p)).map((e) => ({ ...e, name: `${path.basename(p, '.csproj')}:${e.name}` })));
  }
  const pkgDirs = files.filter((f) => f.endsWith('package.json')).map(dirOf).sort((a, b) => a.split('/').length - b.split('/').length);
  for (const d of pkgDirs) {
    const r = nodeEntries(path.join(repoDir, d), d);
    r.stacks.forEach((s) => stacks.add(s));
    verify.push(...r.verify);
  }
  for (const f of files.filter((x) => x.endsWith('go.mod'))) {
    const d = dirOf(f);
    stacks.add('go');
    verify.push(entry(d, { name: 'gofmt', when: ['**/*.go'], run: 'gofmt -l .', expectEmpty: true }));
    verify.push(entry(d, { name: 'go-build', when: ['**/*.go', 'go.mod'], run: 'go build ./...' }));
    verify.push(entry(d, { name: 'go-vet', when: ['**/*.go'], run: 'go vet ./...' }));
    verify.push(entry(d, { name: 'go-test', when: ['**/*.go'], run: 'go test ./...' }));
  }
  for (const f of files.filter((x) => /(pyproject\.toml|requirements\.txt)$/.test(x))) {
    const d = dirOf(f);
    if (verify.some((v) => v.name === 'pytest' && (v.cwd || '.') === d)) continue;
    stacks.add('python');
    const py = readText(path.join(repoDir, d, 'pyproject.toml')) || '';
    if (/ruff/.test(py)) verify.push(entry(d, { name: 'ruff', when: ['**/*.py'], run: 'ruff check .' }));
    if (/mypy/.test(py)) verify.push(entry(d, { name: 'mypy', when: ['**/*.py'], run: 'mypy .' }));
    verify.push(entry(d, { name: 'pytest', when: ['**/*.py'], run: 'pytest -q' }));
  }
  for (const f of files.filter((x) => x.endsWith('Cargo.toml'))) {
    const d = dirOf(f);
    stacks.add('rust');
    verify.push(entry(d, { name: 'cargo-check', when: ['**/*.rs', 'Cargo.toml'], run: 'cargo check' }));
    verify.push(entry(d, { name: 'cargo-test', when: ['**/*.rs'], run: 'cargo test' }));
  }
  for (const f of files.filter((x) => x.endsWith('pom.xml'))) {
    stacks.add('maven');
    verify.push(entry(dirOf(f), { name: 'mvn-verify', when: ['**/*.java', 'pom.xml'], run: 'mvn -q verify' }));
  }
  for (const f of files.filter((x) => /build\.gradle(\.kts)?$/.test(x))) {
    const d = dirOf(f);
    stacks.add('gradle');
    const w = exists(path.join(repoDir, d, 'gradlew')) ? './gradlew' : 'gradle';
    verify.push(entry(d, { name: 'gradle-check', when: ['**/*.{java,kt,kts,gradle}'], run: `${w} check` }));
  }
  for (const f of files.filter((x) => x.endsWith('pubspec.yaml'))) {
    stacks.add('flutter');
    verify.push(entry(dirOf(f), { name: 'dart-analyze', when: ['**/*.dart'], run: 'dart analyze' }));
  }
  return { stacks: [...stacks], verify };
}

export function detectBranches(repoDir) {
  const remotes = git(repoDir, ['remote']).out.split('\n').map((s) => s.trim()).filter(Boolean);
  const strip = (s) => {
    for (const r of remotes) if (s.startsWith(`${r}/`)) return s.slice(r.length + 1);
    return s;
  };
  const names = new Set(
    git(repoDir, ['branch', '-a', '--format=%(refname:short)'])
      .out.split('\n')
      .map((s) => strip(s.trim()))
      .filter((s) => s && s !== 'HEAD'),
  );
  const head = strip(git(repoDir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).out.trim());
  const protectedCandidates = ['main', 'master', 'production', 'prod', 'product', 'release', 'staging'];
  const protectedFound = protectedCandidates.filter((b) => names.has(b));
  const workFrom = ['dev', 'develop', 'qc', 'staging'].find((b) => names.has(b)) || head || '';
  return { protected: protectedFound, workFrom, defaultBranch: head };
}

export function describeRepo(root, repo) {
  const { stacks } = detectStacks(repo.dir);
  const remotes = git(repo.dir, ['remote']).out.split('\n').map((s) => s.trim()).filter(Boolean);
  const name = remotes.includes('origin') ? 'origin' : remotes[0];
  const remote = name ? git(repo.dir, ['remote', 'get-url', name]).out.trim().replace(/\/\/[^@/]+@/, '//') : '';
  return { name: repo.name, path: toPosix(path.relative(root, repo.dir)) || '.', stacks, remote };
}
