# Nhật ký thay đổi

Theo định dạng [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) và đánh số theo [SemVer](https://semver.org/spec/v2.0.0.html). Trước 1.0.0, bản MINOR có thể chứa thay đổi phá vỡ và sẽ được ghi rõ ở đây.

## [Chưa phát hành]

## [0.1.1] - 2026-11-06

### Sửa

- README trên npm hướng dẫn cài bằng `npm install -g flowharness`, thêm phần bắt đầu dùng, nâng cấp và gỡ.

## [0.1.0] - 2026-11-06

Bản phát hành đầu tiên.

### Thêm

- 14 skill cho quy trình explore, plan, execute, post, kèm khuôn mẫu plan và runbook, gate tuỳ chọn.
- Công cụ `flow`: quản lý ngữ cảnh cục bộ `.flow/`, plan và task, luật, kiểm tra trước commit, phát hiện mã trùng, worktree.
- Rà soát bí mật và thông tin cá nhân, không in giá trị ra màn hình.
- Tự đo quy ước của repo khi vào dự án và ghi nguồn gốc của từng cấu hình.
- `flow install` và `flow uninstall` cho Claude Code, Codex, Gemini CLI.
- `flow provenance`: đo đoạn trùng nguyên văn giữa bộ skill và một thư mục dự án.

### Đã biết

- Lệnh `flow` trùng tên với trình kiểm kiểu Flow (`flow-bin`). Xem mục "Trùng tên lệnh" trong README.
