---
name: event-contract
title: Sự kiện và hàng đợi
when: ["**/*event*", "**/*Event*", "**/*consumer*", "**/*Consumer*", "**/*producer*", "**/*Producer*", "**/*queue*", "**/*Queue*", "**/*outbox*", "**/*Outbox*"]
tags: [event, contract, async]
---

## Explore

- [ ] Liệt kê mọi bên tiêu thụ sự kiện, kể cả ở repo khác
- [ ] So định dạng ở hai đầu bằng dữ liệu thật: tên trường, kiểu, cách mã hoá
- [ ] Ước lượng lưu lượng và điều xảy ra khi đầu nhận chậm
- [ ] Soát thông tin cá nhân trong payload

## Execute

- [ ] Ghi sự kiện qua outbox trong cùng transaction với thay đổi dữ liệu
- [ ] Làm consumer idempotent, vì hàng đợi có thể giao lại cùng một thông điệp
- [ ] Chỉ thêm trường theo hướng tương thích, đổi nghĩa thì tạo phiên bản mới
- [ ] Ghi rõ thứ tự triển khai: thường là consumer trước, producer sau

## Post

- [ ] Đo ở đầu nhận, không coi việc gửi thành công là đã xong
- [ ] Soát hàng đợi lỗi (DLQ) trước và sau khi chạy
- [ ] Gửi trùng một thông điệp để xác nhận kết quả không đổi
- [ ] Cập nhật `.flow/contracts.md`
