---
name: flow-report
description: Dùng khi người dùng cần báo cáo công việc đã làm — cuối ngày, standup sáng, cuối tuần, báo cáo miệng với cấp trên, hoặc tự xem lại một ngày đã làm gì. Chạy được cả ở repo chưa có `.flow/`. Người dùng hay nói "báo cáo", "report", "hôm nay làm gì", "daily", "standup", "on-going done pending", "tổng kết tuần".
---

# flow-report — báo cáo công việc

Máy gom dữ liệu, bạn viết thành lời, người dùng chọn nội dung. Bước này không sửa mã, không tự gửi báo cáo đi đâu.

## Luật

- Mỗi dòng phải truy được về nguồn: commit, PR, task, hoặc lời người dùng. Việc chỉ có lời người dùng thì đánh dấu là tự khai trong lúc nháp.
- Không đoán giờ làm từ commit. Giờ làm chỉ lấy khi người dùng khai.
- Tiến độ chỉ ghi bằng số đếm thật, ví dụ 3/5 task. Không tự ước phần trăm.
- Chỉ báo cáo việc của chính người dùng. Không đưa tên hay việc của đồng nghiệp từ `otherAuthors` vào báo cáo.
- Viết theo kết quả người đọc nhận được, không chép tiêu đề commit.
- Không in bí mật. Không nhắc tên quy trình hay công cụ này trong báo cáo.

## 1. Đọc trước khi hỏi

```
flow report collect --json
flow report collect --json --since yesterday
flow report collect --json --all
```

`--since` nhận `today`, `yesterday`, `last-workday`, `week`, `since-last`, hoặc `YYYY-MM-DD`, có thể kèm `--until YYYY-MM-DD`. `--all` đọc mọi repo trong workspace. `--day-starts-at 4` tính việc làm trước 4 giờ sáng vào ngày hôm trước.

Đọc kết quả:

| Trường | Cách xử lý |
|---|---|
| `repos[].commits` | Việc đã viết, tính theo giờ viết và giờ máy người dùng; `pushed: false` là chưa đẩy lên |
| `repos[].worktrees`, `stashes` | Việc dở chưa commit |
| `repos[].pullRequests` | `available: false` nghĩa là chưa biết, không phải bằng 0; nêu `reason` cho người dùng |
| `repos[].otherAuthors` | Người khác, hoặc chính người dùng với danh tính khác |
| `plans` | Tiến độ, việc còn mở, quyết định chờ, ghi chú theo ngày |
| `previous` | Báo cáo gần nhất; đọc phần hẹn ngày mai để đối chiếu |
| `redacted` | Lớn hơn 0 thì báo người dùng có giá trị giống bí mật trong commit |

Đọc diff của từng cụm việc bằng `git show --stat <hash>`, rồi `git show <hash>` với cụm chưa rõ, để hiểu việc đó tạo ra kết quả gì.

## 2. Gom thành việc

- Gom commit, PR, task cùng mục đích thành một việc, kể cả khi nằm ở nhiều repo hay worktree.
- Commit trên nhánh và commit squash có `pr` trùng nhau là một việc.
- Commit phát hành và commit cấu hình phụ thì gộp vào việc chính hoặc bỏ.

## 3. Hỏi một lượt

Theo mục "Hỏi người dùng" ở skill `flow`. Mỗi lựa chọn kèm số liệu thật. Đã rõ từ lời người dùng thì không hỏi lại.

| Câu | Lựa chọn |
|---|---|
| Mục đích | Báo cáo ngày, báo cáo miệng, tự xem lại, standup, báo cáo tuần |
| Khoảng thời gian | Mặc định theo mục đích; ghi số commit và PR của từng khoảng |
| Tiêu chí | Chọn nhiều, chỉ hiện mục có dữ liệu; ba nhóm On-going, Done, Pending chọn sẵn |
| Việc đưa vào | Chọn nhiều, liệt kê các việc đã gom ở bước 2 |

Khoảng mặc định: báo cáo ngày, miệng, tự xem lại dùng `today`; standup dùng `last-workday`; báo cáo tuần dùng `week`.

Tiêu chí có thể chọn: Blocker và cần hỗ trợ, Kế hoạch ngày mai, Bằng chứng (PR, commit, test), Tiến độ, Giờ làm do người dùng khai, Việc ngoài code, Rủi ro, Quyết định đã chốt.

Nhiều việc hơn số lựa chọn công cụ cho phép thì tách thành nhiều câu, hoặc hỏi tiếp một lượt nữa. `otherAuthors` trông giống chính người dùng thì hỏi, rồi chạy lại với `--author <tên hoặc email>`.

Luôn hỏi thêm phần code không thể hiện: họp, hỗ trợ người khác, đang chờ ai, từ ngày nào.

### Khi người dùng đưa sẵn ngữ cảnh

Ví dụ `/flow-report xong API thanh toán, mai QA test`. Vẫn chạy bước 1, coi lời họ là nguồn chính, không hỏi lại điều đã nói, chỉ hỏi mục đích và tiêu chí còn thiếu. Lời kể lệch với dữ liệu thì nêu cả hai để họ quyết, ví dụ họ nói xong nhưng PR còn mở.

## 4. Xếp nhóm

| Nhóm | Điều kiện |
|---|---|
| Done | PR đã merge thì tự xếp vào đây. Mọi việc khác phải hỏi người dùng đã xong chưa |
| On-going | Đang có hoạt động và người dùng nói chưa xong: PR đang mở, thay đổi chưa commit, plan đang chạy |
| Pending | Việc đang kẹt hoặc chưa bắt đầu. Mỗi dòng ghi lý do: chờ ai và từ ngày nào, hoặc "chưa bắt đầu" |

Hỏi Done trong một lượt, gom các việc chưa merge vào câu chọn nhiều "Việc nào đã xong?"; việc không được chọn vào On-going. Không có lý do của Pending thì hỏi, không tự nghĩ ra.

## 5. Viết

Dùng khuôn của mục đích đã chọn trong [templates](references/templates.md). Ngôn ngữ theo `language.user` nếu có, không thì theo ngôn ngữ người dùng đang viết. Cho người dùng xem bản nháp và sửa đến khi họ ưng.

Có `previous` thì so với điều đã hẹn; việc đã hẹn mà chưa làm thì nêu trong lúc nháp để người dùng quyết có đưa vào không.

## 6. Lưu

`saveDir` khác `null` thì lưu vào `<saveDir>/<saveStem>-<kiểu>.md`, với kiểu là `daily`, `oral`, `review`, `standup`, `weekly`, rồi báo đường dẫn. Thư mục này chỉ nằm trên máy.

`saveDir` là `null` thì chỉ đưa báo cáo ra chat, không tạo `.flow/`, không tạo tệp trong repo.

## Ca khó

- Không có commit: không viết "không làm gì". Báo khoảng, danh tính và repo đã đọc, rồi hỏi họ đã làm gì. Có thể sai khoảng hoặc sai danh tính.
- `identities.missing` là `true`: hỏi tên hoặc email rồi chạy lại với `--author`.
- `window.fallback` là `true`: chưa có báo cáo trước, nói rõ khoảng đang dùng.
- Làm qua nửa đêm: có commit sát đầu ngày thì hỏi có tính vào ngày trước không, rồi chạy lại với `--day-starts-at`.
