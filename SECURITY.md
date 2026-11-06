# Security policy

[Tiếng Việt](#chính-sách-bảo-mật)

## Report a vulnerability

Please do not open a public issue. Report privately through [GitHub vulnerability reporting](https://github.com/baodhg/FLOW/security/advisories/new). Include the version, steps to reproduce and the impact. Do not send real keys or personal data in the report.

This project is maintained by one person in their spare time, so there is no guaranteed response time. Confirmed vulnerabilities are fixed in the latest release and noted in the [changelog](CHANGELOG.md). Please keep a report private until a fix is available, so that disclosure is coordinated.

## Supported versions

Only the latest release is supported.

## What this tool touches

- `npm install` runs no scripts from this package.
- `flow install` links skills into `~/.claude/skills` and `~/.agents/skills`, adds an instruction block to the global instruction files of Claude Code, Codex and Gemini CLI, and generates slash commands. Those files are backed up as `*.pre-agent-flow.bak` before the first write. Preview with `flow install --dry`.
- `flow install --scope project` works inside one repository instead. It only adds files listed in `.git/info/exclude` and never edits a file git tracks. It makes no backup, so that the repository stays clean.
- `flow install --hooks` adds hooks to your agent settings. A hook can block an agent's command, such as writing to a protected branch or reading a `.env` file.
- The package sends no data anywhere and has no telemetry.

## Limits

The secret scanner and hooks are a safety net, not a security boundary. They can miss things and can be bypassed. A clean result does not prove a repository holds no secrets.

## Chính sách bảo mật

Đừng mở issue công khai khi báo lỗ hổng. Hãy [báo riêng qua GitHub](https://github.com/baodhg/FLOW/security/advisories/new), kèm phiên bản, cách tái hiện và ảnh hưởng, và đừng gửi khoá hay dữ liệu thật.

Dự án do một người duy trì trong thời gian rảnh nên không cam kết thời gian phản hồi. Lỗ hổng được xác nhận sẽ được vá ở bản mới nhất và ghi trong [nhật ký thay đổi](CHANGELOG.md). Vui lòng giữ kín báo cáo cho tới khi có bản vá. Chỉ bản phát hành mới nhất được hỗ trợ.
