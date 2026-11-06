# Nhật ký thay đổi

Theo định dạng [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) và đánh số theo [SemVer](https://semver.org/spec/v2.0.0.html). Trước 1.0.0, bản MINOR có thể chứa thay đổi phá vỡ và sẽ được ghi rõ ở đây.

## [0.3.2](https://github.com/baodhg/FLOW/compare/v0.3.1...v0.3.2) (2026-11-06)


### Bug Fixes

* stop the secret scanner from skipping random tokens ([609ff48](https://github.com/baodhg/FLOW/commit/609ff4816051c1caac947f532d2165dac1cbc748))

## [0.3.1](https://github.com/baodhg/FLOW/compare/v0.3.0...v0.3.1) (2026-11-06)


### Bug Fixes

* treat names and options as plain text when building patterns ([6934cfb](https://github.com/baodhg/FLOW/commit/6934cfba39f6254990cdd1b7d6fafc7950d62082))

## [0.3.0](https://github.com/baodhg/FLOW/compare/v0.2.0...v0.3.0) (2026-11-06)


### Features

* add a guided setup with a branded welcome ([8101ffa](https://github.com/baodhg/FLOW/commit/8101ffafaf65ddf7000d6ec66d3b48c4cd3ab7db))

## [0.2.0] - 2026-11-06

### Thay đổi

- Đổi tên gói npm từ `flowharness` thành `flow-harness`.
- `README.md` chuyển sang tiếng Anh, bản tiếng Việt ở `README.vi.md`.

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
