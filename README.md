# FLOW Harness

[![npm](https://img.shields.io/npm/v/flow-harness)](https://www.npmjs.com/package/flow-harness)
[![CI](https://github.com/baodhg/FLOW/actions/workflows/ci.yml/badge.svg)](https://github.com/baodhg/FLOW/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/flow-harness)](LICENSE)

English · [Tiếng Việt](README.vi.md)

A workflow skill pack and CLI for coding agents. FLOW Harness, or FLOW for short, takes an agent from explore through plan and execute to post, and keeps what it learns about each project inside that project.

It is neutral by design: it assumes no stack, language or commit style, and measures conventions from the repository instead.

Works with Claude Code, Codex and Gemini CLI. Requires Node.js 20 or later.

> **Language:** the skills and CLI messages are currently written in Vietnamese. Agents can follow them whatever language you chat in, but you will read Vietnamese output from the `flow` command. This project is at `0.x`, so behaviour may still change.

## Install

```bash
npm install -g flow-harness
flow install
```

`npm install` only places the package on your machine and runs no install scripts. `flow install` is the step that links the skills and adds an instruction block to your agents' global instruction files, so you can see exactly when your configuration changes. Files are backed up before the first write.

| `flow install` flag | Effect |
|---|---|
| `--dry` | Show what would change without writing anything |
| `--no-bridge` | Skip the block in the global instruction files |
| `--hooks` | Optional: add hooks that restore state after context compaction, and block writes to protected branches and direct reads of `.env` files |

## Get started

In a repository you want to use it with:

```bash
flow init
flow where
```

`flow init` measures the repository's conventions and creates `.flow/`. That directory stays on your machine: it is excluded through `.git/info/exclude`, so it never reaches a commit. Then work with your agent as usual; it loads the `flow` skill to learn what to read first.

## Upgrade and uninstall

```bash
npm install -g flow-harness@latest
flow install
```

To uninstall, run `flow uninstall` first. In the opposite order, the skills and the instruction block stay behind in your agent configuration.

```bash
flow uninstall
npm uninstall -g flow-harness
```

### Command name conflict

The Flow type checker (`flow-bin`) also provides a `flow` command, and both have `flow check`.

- In `package.json` scripts, `flow` resolves to the project's `node_modules/.bin`.
- In a shell, `flow` is whichever comes first on your `PATH`. Check with `flow --version`.
- If `flow-bin` is installed globally, `npm install -g` fails with `EEXIST`. Remove one of the two, because npm will not overwrite another package's command.

## How conventions are resolved

Every value in `.flow/profile.json` records its source in `_sources`. Later layers win:

1. The pack's neutral defaults
2. Your preferences in `~/.agent-flow/user.json`
3. Conventions measured from the repository, and its own instruction files
4. Decisions you make when asked

What your team can see follows the team, and what only you can see follows you. A blank project adopts your preferences as its conventions, while a repository with an existing team keeps the team's.

## Skills

| Skill | Purpose |
|---|---|
| `flow` | Entry point: orientation, reading order, task size, principles, conventions, asking the user |
| `flow-init` | Bring a project into the workflow |
| `flow-explore` | Investigate scope without changing code |
| `flow-plan` | Write the plan, split tasks, track status |
| `flow-execute` | Carry out an approved plan, with defined stopping points |
| `flow-post` | Close the work: verify, clean up, accept, review, update context, hand over |
| `flow-test` | Design tests that are able to fail |
| `flow-runbook` | Manual procedures whose results can be read |
| `flow-review` | Independent review by a fresh subagent |
| `flow-context` | Context documents for modules, services and shared standards |
| `flow-learn` | Record rules and memories, and the boundary with the pack |
| `flow-sync` | Bring context back in line with the code |
| `flow-worktree` | Run parallel work safely |
| `flow-secrets` | Find secrets and personal data without printing their values |

Invoke a skill with `/flow-x` in Claude Code, `/flow:x` in Gemini CLI and `/prompts:flow-x` in Codex.

## The `.flow/` directory

Each repository gets its own local copy. It is never committed and is not mentioned in code, commits or pull requests.

```
.flow/
  profile.json    machine-readable configuration
  PROJECT.md      project overview
  services.md     service map
  coverage.md     generated context coverage
  contracts.md    shared contracts
  consumed/       how this repo uses external services
  reference/      shared standards
  assets/         diagrams and reference images
  rules/          one rule per file, with a generated INDEX.md
  memory/         how to work here, with a generated INDEX.md
  plans/          active/ and shipped/
  gates/          checklists by type of change
  handoff/        runbooks and handover documents
  dup/            duplicate-code baseline
  secrets/        watched hashes and adjudications
  runs/           run results
```

Each module can also have a `CONTEXT.md` next to its code, which is not committed either.

## Commands

Run `flow help` for the full syntax. The main groups are:

| Group | Commands |
|---|---|
| Setup | `install`, `uninstall`, `fingerprint`, `onboard`, `user`, `where`, `init`, `exclude`, `doctor`, `reindex` |
| Knowledge | `rules`, `memory`, `context`, `gates`, `sync` |
| Secrets | `secrets scan`, `secrets env`, `secrets watch`, `secrets allow` |
| Duplicates | `dup find`, `dup check`, `dup baseline`, `dup report`, `dup allow` |
| Workflow | `plan`, `task`, `runbook`, `wt`, `verify`, `check`, `commitmsg`, `prmsg` |
| Hooks | `hook pretool`, `hook session` |
| Self-check | `selftest`, `provenance` |

## Projects teach, the pack generalises

Project-specific knowledge such as names, code, figures, incidents, domain terms and data stays in that project's `.flow/` and never enters the pack. Only a principle generalised into common practice may be added, rewritten in new words with examples from a fictional domain. Agents do not edit the pack during a task; they propose the change and wait for your approval. See the `flow-learn` skill.

## Contributing

From a clone, `node install.mjs` accepts the same flags as `flow install`, plus `--uninstall`.

```bash
npm test
node bin/flow.mjs selftest
node bin/flow.mjs provenance --against <project directory>
```

`selftest` checks the standards for skills, templates and gates. `provenance` measures verbatim overlap between the pack and the project you compare it with. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).

## Trademarks and third-party software

This is an independent project. It is not affiliated with, sponsored by or endorsed by Anthropic, OpenAI or Google. Claude and Claude Code are trademarks of Anthropic, Codex is a trademark of OpenAI, and Gemini is a trademark of Google; these names are used only to say which products the tool works with.

The package has no npm dependencies. `gitleaks` is an optional tool and is not bundled: if it is on your machine, `flow secrets scan` also calls it, and otherwise that layer is skipped.

## License

[MIT](LICENSE)
