# agent-flow

Bộ skill quy trình cho coding agent, kèm công cụ dòng lệnh `flowctl`. Bộ này đưa agent đi qua điều tra, kế hoạch, thi hành, đóng việc, và giữ kiến thức của từng dự án ngay trong dự án đó.

Bộ skill trung tính: không gắn với stack, ngôn ngữ hay kiểu commit nào. Quy ước được đo từ dự án.

## Cài và gỡ

```
npm install -g github:baodhg/FLOW
flowctl install
flowctl install --hooks
```

Bước `npm install` chỉ đặt gói lên máy và không đụng tới cấu hình agent. `flowctl install` mới nối skill và chèn khối chỉ dẫn, nên bạn thấy rõ lúc nào cấu hình bị đổi.

| Cờ | Tác dụng |
|---|---|
| `--dry` | Xem sẽ làm gì, không ghi |
| `--no-bridge` | Không ghi cầu nối vào tệp chỉ dẫn toàn cục của agent |
| `--hooks` | Cài thêm hook |

Nâng cấp: chạy lại `npm install -g github:baodhg/FLOW` rồi `flowctl install`.

Gỡ: chạy `flowctl uninstall` trước, rồi `npm uninstall -g agent-flow`. Làm ngược thứ tự thì skill và khối chỉ dẫn còn nằm lại trong cấu hình agent.

Chạy từ bản clone: `node install.mjs` nhận cùng các cờ, thêm `--uninstall`.

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

## flowctl

Xem đủ cú pháp bằng `flowctl help`. Các nhóm chính:

| Nhóm | Lệnh |
|---|---|
| Khung | `fingerprint`, `onboard`, `user`, `where`, `init`, `exclude`, `doctor`, `reindex` |
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

```
npm test
flowctl selftest
flowctl provenance --against <dự án>
```

Mọi thay đổi vào bộ skill phải qua cả ba. `selftest` kiểm chuẩn của skill, khuôn và gate. `provenance` kiểm nội dung không mang gì từ dự án được đối chiếu.
