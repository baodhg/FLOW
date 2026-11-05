# Nghiệm thu: {{title}}

Ngày: {{date}} · Plan: {{plan}}

## 0. Bằng chứng hiện có

| Trạng thái | Nội dung | Bằng chứng |
|---|---|---|
| Đã đo | <…> | <lệnh hoặc ảnh chụp> |
| Suy ra | <…> | <lập luận dựa trên gì> |
| Chưa làm | <…> | <vì sao, ai làm> |

## 1. Chuẩn bị

- Môi trường và địa chỉ: <…>
- Tài khoản và quyền cần có: <…>
- Bản đang chạy, cách xác nhận: <…>

Dữ liệu tiền đề, các ca bên dưới chỉ dùng ký hiệu:

| Ký hiệu | Ý nghĩa | Cách lấy | Giá trị |
|---|---|---|---|
| `M1` | Thành viên còn một `Loan` quá hạn | <…> | <…> |
| `B1` | `Book` đang có sẵn | <…> | <…> |

Lưu ý: một thao tác không đổi trạng thái vẫn có thể báo thành công. Vì vậy mỗi hành vi phải thử cả hai chiều và đọc lại kết quả trên hệ đang chạy.

## 2. Các ca kiểm

Chạy ca âm trước. Ca âm không đỏ thì phép đo chưa phân biệt được gì.

#### TC-01 · <tên> [âm]

**Bước:** <làm gì, với ký hiệu nào>

**Kỳ vọng:** <điều đo được khi hệ từ chối đúng>

**Nếu khác kỳ vọng:** giả thuyết sai, dừng lại và ghi đúng điều đã thấy.

#### TC-02 · <tên> [dương]

**Bước:** <làm gì, với ký hiệu nào>

**Kỳ vọng:** <điều đo được khi hệ làm đúng, gồm nội dung phản hồi và trạng thái đọc lại>

**Nếu khác kỳ vọng:** giả thuyết sai, dừng lại và ghi đúng điều đã thấy.

## 3. Kết quả

Ca bỏ qua ghi `N/A` kèm lý do, không để ô trống.

| TC | Kết quả | Quan sát | Người chạy |
|---|---|---|---|
| TC-01 | <…> | <…> | <…> |
| TC-02 | <…> | <…> | <…> |

## 4. Diễn giải

Viết bảng này trước khi chạy.

| Kết quả | Nghĩa là | Việc tiếp |
|---|---|---|
| TC-01 từ chối, TC-02 thành công | Thay đổi có tác dụng đúng chiều | Đóng nghiệm thu |
| Cả hai cùng thành công | Phép kiểm không phân biệt được, có thể thao tác không đổi trạng thái | Xem lại ca âm |
| Cả hai cùng thất bại | Môi trường hoặc dữ liệu tiền đề chưa đúng | Soát mục 1 |
| Không khớp hàng nào | giả thuyết sai | Dừng, báo người phụ trách |
