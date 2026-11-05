---
name: auth-secret
title: Xác thực, phân quyền và bí mật
when: ["**/*auth*", "**/*Auth*", "**/*token*", "**/*Token*", "**/*session*", "**/*Session*", "**/*permission*", "**/*Permission*", "**/.env*"]
tags: [auth, secret, critical]
---

## Explore

- [ ] So khớp hai đầu: bên phát và bên kiểm dùng cùng thuật toán, audience, tên claim, tên quyền
- [ ] Xác định hành vi khi thiếu cấu hình hoặc không có quyền: phải là từ chối
- [ ] Xem thông báo lỗi có để lộ tài khoản tồn tại hay không

## Execute

- [ ] Mặc định từ chối, cho phép phải là khai báo tường minh
- [ ] Trả cùng một phản hồi cho sai mật khẩu và không có tài khoản
- [ ] Không in, không log, không commit giá trị secret; dùng skill `flow-secrets` khi cần xem
- [ ] Đọc secret từ biến môi trường hoặc kho bí mật, không viết trong mã

## Post

- [ ] Chạy ca âm: không token, token hết hạn, sai chữ ký, sai quyền
- [ ] Chạy ca âm trước ca dương để biết phép đo phân biệt được
- [ ] Chạy `flowctl secrets scan --base <nhánh gốc>`
- [ ] Cập nhật `.flow/contracts.md` khi đổi claim hay tên quyền
