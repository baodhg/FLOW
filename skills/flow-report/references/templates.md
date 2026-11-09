# Khuôn báo cáo

Giữ thứ tự các mục. Mục người dùng không chọn thì bỏ. Nội dung ví dụ chỉ để minh hoạ, thay bằng dữ liệu thật. Mã ticket, hạn, QA và deploy chỉ ghi khi có nguồn.

## Mục lục

- Vị trí tiêu chí và định dạng
- `daily`: báo cáo ngày
- `oral`: báo cáo miệng
- `review`: tự xem lại
- `standup`: họp đầu ngày
- `weekly`: báo cáo tuần

## Vị trí tiêu chí

Tiêu chí thêm đặt ở:

| Tiêu chí | daily, standup | oral | review | weekly |
|---|---|---|---|---|
| Blocker | Dưới Pending, hoặc Đang vướng | Câu thứ ba | Mất thời gian vì | Rủi ro |
| Ngày mai | Mục Ngày mai | Câu cuối | Việc đầu tiên ngày mai | Tuần tới |
| Tiến độ, Bằng chứng | Trong dòng của việc | Bỏ bằng chứng | Trong dòng của việc | Tiến độ so với mục tiêu |
| Rủi ro, Quyết định đã chốt | Mục riêng cuối báo cáo | Dự phòng khi bị hỏi | Mục riêng | Mục đã có sẵn |
| Việc phát sinh, Việc ngoài code, Review và hỗ trợ, Giờ làm | Mục riêng cuối báo cáo | Một câu nếu quan trọng | Mục riêng | Một dòng tổng hợp |

Định dạng: văn bản thường giữ dấu gạch đầu dòng, bỏ in đậm, tiêu đề `#` và bảng; email thêm dòng tiêu đề và lời chào.

Phần ví dụ thuộc tiêu chí chưa chọn thì bỏ: số PR thuộc Bằng chứng, x/y task thuộc Tiến độ. Trạng thái PR chờ review hay CI đỏ thì luôn giữ, vì là lý do việc chưa xong.

## daily

Báo cáo ngày trong nhóm chat. Mỗi việc một dòng, không giải thích kỹ thuật. Mỗi nhóm tối đa 5 dòng, nhiều hơn thì gộp việc gần nhau.

```
Báo cáo 09/11 - <tên>

Done
- [LIB-12] Gia hạn sách một lần: đã merge (#42)

On-going
- [LIB-15] Xuất phiếu mượn PDF: 3/5 task, PR #45 chờ review, hạn <người dùng nêu>

Pending
- Đồng bộ kho sách: chờ đối tác cấp quyền API từ 07/11, cần trước 12/11, trễ thì lùi phát hành
- Thống kê mượn trả: chưa bắt đầu, làm sau phiếu mượn PDF

Ngày mai
- Hoàn tất phiếu mượn PDF
```

## oral

Báo cáo miệng. Viết để đọc thành tiếng trong khoảng 45 giây: câu ngắn, nói kết quả trước, không đọc mã PR hay mã ticket. Xưng hô theo cách người dùng hay dùng, không biết thì hỏi.

```
"Hôm nay em đã merge tính năng gia hạn sách.
Phiếu mượn PDF xong 3 trên 5 phần, đang chờ review.
Đồng bộ kho sách đang kẹt quyền API từ đối tác, cần có trước ngày 12, em cần hỗ trợ giục đối tác."

Nếu bị hỏi:
- Có ảnh hưởng ngày phát hành không? <trả lời, kèm căn cứ>
- Đối tác hẹn khi nào? <người dùng điền>
```

Câu hỏi dự phòng tối đa 3, chọn từ việc đang kẹt, việc trễ so với hẹn, và rủi ro. Không có căn cứ thì để chỗ cho người dùng điền.

## review

Tự xem lại cuối ngày, chỉ cho bản thân. Trung thực hơn bản gửi cấp trên, được phép ghi tên nhánh và tệp.

```
Xem lại 09/11

Đã làm
- <việc>: <kết quả>

Khác với dự định
- <đã hẹn gì, thực tế ra sao>

Mất thời gian vì
- <điều gì, lần sau tránh bằng cách nào>

Việc đầu tiên ngày mai
- Nhánh <nhánh>, tệp <tệp>: <bước cụ thể>
```

## standup

Họp đầu ngày. Khoảng tính từ ngày làm việc gần nhất, nên sáng thứ Hai bao gồm thứ Sáu và cuối tuần.

```
Trước đó
- <việc đã xong hoặc đã đẩy tiếp>

Hôm nay
- <việc sẽ làm>

Đang vướng
- <việc>: <cần gì, từ ai, từ ngày nào>, hoặc "Không có"
```

## weekly

Báo cáo tuần cho cấp trên. Gộp theo kết quả, không liệt kê commit.

```
Báo cáo tuần 09/11 - 15/11 - <tên>

Trạng thái chung: <Đúng tiến độ | Có rủi ro | Trễ>, <một câu lý do>

Kết quả chính
- <kết quả, ai được lợi>

Tiến độ so với mục tiêu
- <mục tiêu>: <x/y task, đúng hẹn hay trễ bao lâu>

Rủi ro
- <rủi ro, hậu quả, cách xử lý>

Quyết định đã chốt
- <quyết định, ai chốt>

Cần quyết
- <việc cần cấp trên chốt, cần trước khi nào>

Tuần tới
- <việc chính>
```
