---
name: schema-migration
title: Thay đổi schema
when: ["**/migrations/**", "**/migration/**", "**/Migrations/**", "**/*.sql", "**/schema.prisma"]
tags: [schema, data]
---

## Explore

- [ ] Liệt kê mọi bên đọc bảng này, kể cả báo cáo và repo khác
- [ ] Phân loại thay đổi: additive hay phá vỡ
- [ ] Đo kích thước bảng và xem migration có khoá lâu không

## Execute

- [ ] Dùng công cụ migration của dự án, không sửa schema bằng tay
- [ ] Không sửa migration đã áp ở bất kỳ môi trường nào, viết migration mới
- [ ] Thay đổi phá vỡ đi theo expand-contract qua nhiều lần phát hành
- [ ] Điều phối số thứ tự migration khi có nhánh song song

## Post

- [ ] Xem trạng thái migration bằng lệnh của công cụ trên CSDL thật
- [ ] Chạy thử chiều lùi hoặc ghi rõ vì sao không lùi được
- [ ] Đo lại schema trên CSDL sau khi áp, không suy từ tệp migration
- [ ] Cập nhật `.flow/contracts.md` và `CONTEXT.md` của module sở hữu bảng
