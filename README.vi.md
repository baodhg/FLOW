# FLOW Harness

[English](README.md) · Tiếng Việt

[![npm](https://img.shields.io/npm/v/flow-harness)](https://www.npmjs.com/package/flow-harness)
[![CI](https://github.com/baodhg/FLOW/actions/workflows/ci.yml/badge.svg)](https://github.com/baodhg/FLOW/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/baodhg/FLOW/badge)](https://scorecard.dev/viewer/?uri=github.com/baodhg/FLOW)
[![License: MIT](https://img.shields.io/npm/l/flow-harness)](LICENSE)

FLOW Harness, gọi tắt FLOW, là bộ skill quy trình cho coding agent, kèm công cụ dòng lệnh `flow`. Bộ này đưa agent đi qua điều tra, kế hoạch, thi hành, đóng việc, và giữ kiến thức của từng dự án ngay trong dự án đó.

Bộ skill trung tính: không gắn với stack, ngôn ngữ hay kiểu commit nào. Quy ước được đo từ dự án.

Dùng được với Claude Code, Codex và Gemini CLI. Cần Node.js 20 trở lên.

## Cài đặt

```bash
npx flow-harness
```

Trình hướng dẫn hỏi bạn dùng agent và skill nào, liệt kê mọi thay đổi và không ghi gì cho tới khi bạn xác nhận. Sau đó nó cài gói toàn cục để lệnh `flow` luôn dùng được. Nhấn `Ctrl+C` bất cứ lúc nào để thoát mà không đổi gì.

Muốn tự cài thì dùng cách dưới. `npm install` chỉ đặt gói lên máy và không chạy script cài đặt nào:

```bash
npm install -g flow-harness
flow setup
```

Với script và CI, `flow install` không hỏi gì:

```bash
flow install --agents claude,codex --skills core
```

| Cờ của `flow install` | Tác dụng |
|---|---|
| `--scope user\|project` | Toàn máy (mặc định) hoặc chỉ repo hiện tại. `--dir path` để chọn repo khác |
| `--agents a,b` | Chỉ các agent này: `claude`, `codex`, `gemini`. Mặc định: tất cả |
| `--skills a,b` | Chỉ các skill này, hoặc `core` cho quy trình chính. Luôn có `flow`, và skill không chọn sẽ bị gỡ. Mặc định: tất cả |
| `--dry` | Xem sẽ làm gì, không ghi |
| `--no-bridge` | Không ghi cầu nối vào tệp chỉ dẫn toàn cục của agent |
| `--hooks` | Tuỳ chọn: cài thêm hook nạp lại trạng thái và chặn ghi vào nhánh được bảo vệ, chặn đọc `.env` |

### Toàn máy hay một dự án

Mặc định skill có tác dụng ở mọi repo trên máy. Muốn chỉ dùng trong một repo, chọn **Chỉ dự án này** trong `flow setup`, hoặc chạy trong repo đó:

```bash
flow install --scope project
flow uninstall --scope project
```

Lệnh `flow` vẫn được cài trên máy ở cả hai phạm vi, vì skill cần gọi nó. Bản cài cho dự án là của riêng bạn: mọi tệp nó thêm đều nằm trong `.git/info/exclude`, nên `git status` vẫn sạch và đồng đội không thấy thay đổi gì. Nó không bao giờ sửa tệp mà git đang theo dõi.

| Công cụ | Skill | Chỉ dẫn | Hook |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `CLAUDE.local.md` | `.claude/settings.local.json` |
| Codex | `.agents/skills/` | không có | không có |
| Gemini CLI | `.agents/skills/`, chỉ nạp khi thư mục được tin cậy | không có | không có |

Codex và Gemini CLI không có khối chỉ dẫn ở phạm vi dự án, vì chúng không có tệp chỉ dẫn riêng nào mà vẫn giữ `AGENTS.md` hay `GEMINI.md` của đội có hiệu lực, và FLOW không sửa các tệp đó. Lệnh slash của hai công cụ này chỉ có khi cài toàn máy.

## Bắt đầu

Trong repo muốn áp dụng:

```bash
flow init
flow where
```

`flow init` đo quy ước của repo và tạo `.flow/`. Thư mục này chỉ nằm trên máy bạn và không vào commit. Sau đó bạn làm việc với agent như thường; agent nạp skill `flow` để biết phải đọc gì trước.

## Nâng cấp và gỡ

```bash
npm install -g flow-harness@latest
flow install
```

Khi gỡ, chạy `flow uninstall` trước. Làm ngược thứ tự thì skill và khối chỉ dẫn còn nằm lại trong cấu hình agent.

```bash
flow uninstall
npm uninstall -g flow-harness
```

### Trùng tên lệnh

Trình kiểm kiểu Flow (`flow-bin`) cũng dùng lệnh `flow`, và cả hai cùng có `flow check`.

- Trong script của `package.json`, `flow` là bản trong `node_modules/.bin` của dự án.
- Trong shell, `flow` là bản đứng trước trong `PATH`. Kiểm tra bằng `flow --version`.
- Đã cài `flow-bin` toàn cục thì `npm install -g` báo `EEXIST`. Gỡ một trong hai bản, vì npm không cài đè lệnh của gói khác.

## Mô hình trung tính theo lớp

Mỗi giá trị trong `.flow/profile.json` có nguồn ghi ở `_sources`. Lớp sau thắng lớp trước:

1. Mặc định trung tính của bộ skill
2. Sở thích người dùng ở `~/.agent-flow/user.json`
3. Quy ước đo được và tệp chỉ dẫn của dự án
4. Điều người dùng chốt

Thứ đội nhìn thấy theo đội, thứ chỉ người dùng thấy theo người dùng. Một dự án trắng nhận sở thích của bạn làm quy ước; một repo đã có đội giữ nguyên quy ước của đội.

## Các skill

| Skill | Việc |
|---|---|
| `flow` | Cửa vào: định vị, thứ tự đọc, cỡ task, nguyên tắc, quy ước, cách hỏi người dùng |
| `flow-init` | Đưa một dự án vào quy trình |
| `flow-explore` | Điều tra phạm vi, không sửa mã |
| `flow-plan` | Viết kế hoạch, chia task, vòng đời trạng thái |
| `flow-execute` | Thi hành plan đã duyệt, các điểm dừng |
| `flow-post` | Đóng việc: verify, vệ sinh, nghiệm thu, review, ngữ cảnh, giao |
| `flow-test` | Thiết kế test có khả năng thất bại |
| `flow-runbook` | Quy trình chạy tay đọc được kết quả |
| `flow-review` | Soát độc lập bằng subagent mới |
| `flow-context` | Tài liệu ngữ cảnh theo module, service và chuẩn chung |
| `flow-learn` | Ghi luật và memory, ranh giới với bộ skill |
| `flow-sync` | Đồng bộ ngữ cảnh với mã |
| `flow-worktree` | Làm song song an toàn |
| `flow-secrets` | Dò bí mật và thông tin cá nhân mà không in giá trị |

Gọi skill: Claude Code `/flow-x`, Gemini `/flow:x`, Codex `/prompts:flow-x`.

## Bố cục `.flow/`

Thư mục cục bộ của mỗi repo. Không commit, bỏ qua bằng `.git/info/exclude`, không nhắc tên trong mã, commit, PR.

```
.flow/
  profile.json    cấu hình máy đọc
  PROJECT.md      toàn cảnh dự án
  services.md     bản đồ service
  coverage.md     tự sinh, độ phủ ngữ cảnh
  contracts.md    hợp đồng dùng chung
  consumed/       cách repo dùng service ngoài
  reference/      chuẩn dùng chung
  assets/         sơ đồ, ảnh tham khảo
  rules/          mỗi luật một tệp, INDEX.md tự sinh
  memory/         điều về cách làm việc, INDEX.md tự sinh
  plans/          active/ và shipped/
  gates/          danh sách kiểm theo loại thay đổi
  handoff/        runbook và tài liệu bàn giao
  dup/            baseline trùng lặp
  secrets/        hash theo dõi, phán xử
  runs/           kết quả chạy
```

Mỗi module có thêm `CONTEXT.md` cạnh mã, cũng không commit.

Gate mẫu nằm ở `<gói>/presets/gates/`, khuôn tài liệu ở `<gói>/templates/`.

## Lệnh

Xem đủ cú pháp bằng `flow help`. Các nhóm chính:

| Nhóm | Lệnh |
|---|---|
| Khung | `setup`, `install`, `uninstall`, `fingerprint`, `onboard`, `user`, `where`, `init`, `exclude`, `doctor`, `reindex` |
| Tri thức | `rules`, `memory`, `context`, `gates`, `sync` |
| Bí mật | `secrets scan`, `secrets env`, `secrets watch`, `secrets allow` |
| DRY | `dup find`, `dup check`, `dup baseline`, `dup report`, `dup allow` |
| Quy trình | `plan`, `task`, `runbook`, `wt`, `verify`, `check`, `commitmsg`, `prmsg` |
| Hook | `hook pretool`, `hook session` |
| Tự kiểm | `selftest` |

## Ranh giới dự án ↔ bộ skill

Dự án là nơi học, bộ skill chỉ giữ nguyên lý chung.

- Kiến thức cụ thể của dự án (tên, mã, số liệu, sự cố, từ nghiệp vụ, dữ liệu) ở lại trong `.flow/` của dự án đó và không bao giờ đi vào bộ skill.
- Chỉ đưa vào bộ skill một nguyên lý đã khái quát thành thực hành chung: viết lại hoàn toàn bằng lời mới, không định danh, không số liệu, không chuyện cụ thể, ví dụ dùng miền hư cấu, áp dụng được cho một dự án xa lạ.
- Không chép mã, không chép câu từ của dự án.
- Agent không tự sửa bộ skill giữa task. Đề xuất cho người dùng trên chat ở bước post, kèm bản nháp đã khái quát; được đồng ý mới sửa.
- Từ riêng của một dự án khai trong `.flow/profile.json`.

Chi tiết ở skill `flow-learn`.

## Phát triển

Từ bản clone, `node install.mjs` nhận cùng các cờ của `flow install`, thêm `--uninstall`.

```bash
npm test
flow selftest
flow provenance --against <dự án>
```

Mọi thay đổi vào bộ skill phải qua cả ba. `selftest` kiểm chuẩn của skill, khuôn và gate. `provenance` kiểm nội dung không mang gì từ dự án được đối chiếu.

## Giấy phép

MIT, xem tệp `LICENSE`.

Các đóng góp theo `CONTRIBUTING.md`, báo lỗ hổng theo `SECURITY.md`, lịch sử phiên bản ở `CHANGELOG.md`.

## Nhãn hiệu và phần mềm bên thứ ba

Đây là dự án độc lập, không liên kết, không được bảo trợ hay xác nhận bởi Anthropic, OpenAI hay Google. Claude và Claude Code là nhãn hiệu của Anthropic, Codex là nhãn hiệu của OpenAI, Gemini là nhãn hiệu của Google; các tên này chỉ được dùng để nói công cụ tương thích với sản phẩm nào.

Gói không có phụ thuộc npm. `gitleaks` là công cụ tuỳ chọn, không đóng gói kèm: có trên máy thì `flow secrets scan` gọi thêm, không có thì bỏ qua lớp đó.
