# {{title}}

Lập ngày: {{date}}

Mục tiêu: <một câu nói kết quả người dùng nhận được>

## 0. Quyết định

Câu hỏi dành cho người dùng được hỏi trên chat, mục này chỉ là biên bản. Ghi câu trả lời bằng `flowctl plan decide`. Không còn gì để hỏi thì xoá dòng mẫu.

- [ ] **D1** <câu hỏi> — lựa chọn: <A (khuyến nghị)> / <B> — ảnh hưởng: <…>

## 1. Pre-flight

Điều kế hoạch giả định là đúng, kèm lệnh đo và kết quả thật. Chưa có bằng chứng thì chưa được dựa vào.

| Giả định | Lệnh đo | Kết quả | Nguồn `tệp:dòng` |
|---|---|---|---|
| <…> | <…> | <…> | <…> |

## 2. Tasks — mỗi task một kết quả kiểm được, một commit

- [ ] **T1** <việc> — tệp: <…> — test đỏ trước: <…> — tái dùng: <…>

## 3. Schema

Mặc định chỉ thêm, không phá. Thay đổi phá vỡ đi theo expand-contract: thêm mới, ghi cả hai, chuyển bên đọc, rồi mới gỡ cũ.

- Bảng / trường đổi: <…>
- Kiểu thay đổi: <additive hoặc expand-contract>
- Bên đang đọc: <…>

## 4. Hợp đồng và ngữ cảnh

- Hợp đồng đổi và bên tiêu thụ: <…>
- `CONTEXT.md` cần cập nhật: <…>
- Luật cần thêm hoặc sửa: <…>

## 5. Thứ tự triển khai

| Bước | Thành phần | Lý do đứng ở vị trí này |
|---|---|---|
| 1 | <…> | <…> |

## 6. Kiểm chứng

- Lệnh verify: <…>
- Gate khớp: <…>
- Nghiệm thu thật: <runbook hoặc cách đo ở đầu nhận>

## 7. Rollback

- Cách lùi từng bước: <…>
- Điểm không lùi được: <…>

## 8. Nhánh và việc còn lại

- Nhánh: <…>
- Ngoài phạm vi, để sau: <…>

## 9. Ledger

Nhật ký trong lúc làm: helper mới, ma sát, quyết định nhỏ. Ghi bằng `flowctl task note`.
