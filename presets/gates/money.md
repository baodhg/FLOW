---
name: money
title: Tiền, số dư và thanh toán
when: ["**/*payment*", "**/*Payment*", "**/*invoice*", "**/*Invoice*", "**/*balance*", "**/*Balance*", "**/*wallet*", "**/*Wallet*", "**/*refund*", "**/*Refund*", "**/*webhook*", "**/*Webhook*"]
tags: [money, critical]
---

## Explore

- [ ] Xác định bên sở hữu từng trường tiền và ai được ghi
- [ ] Kiểm kiểu số ở mọi đầu: dùng decimal hoặc số nguyên đơn vị nhỏ nhất, không dùng số thực nhị phân
- [ ] Ghi đơn vị tiền tệ và quy tắc làm tròn đang áp dụng
- [ ] Xem webhook có thể đến trùng, đến muộn hay đảo thứ tự không

## Execute

- [ ] Hỏi duyệt plan trước khi sửa, kể cả thay đổi nhỏ
- [ ] Làm thao tác ghi idempotent bằng khoá nghiệp vụ duy nhất
- [ ] Ghi số dư và bút toán trong cùng transaction
- [ ] Viết test đỏ trước cho mọi nhánh tính tiền

## Post

- [ ] Chạy ca biên: bằng không, âm, rất lớn, làm tròn, gửi trùng
- [ ] Đối soát tổng trước và sau bằng truy vấn độc lập với mã vừa sửa
- [ ] Sửa dữ liệu tiền thì đi qua runbook `data-op` của skill `flow-runbook`
- [ ] Không log số thẻ hay thông tin định danh người trả
