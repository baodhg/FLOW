# Khuôn báo cáo

Giữ thứ tự các mục. Mục người dùng không chọn thì bỏ. Nội dung ví dụ chỉ để minh hoạ, thay bằng dữ liệu thật.

## daily

Báo cáo ngày trong nhóm chat. Dưới 10 dòng, mỗi việc một dòng, không giải thích kỹ thuật.

```
Báo cáo 09/11 - <tên>

Done
- Thành viên đã gia hạn được sách một lần, đang chạy trên production (#42)

On-going
- Xuất phiếu mượn PDF: 3/5 task, PR #45 chờ review, dự kiến mai xong

Pending
- Đồng bộ kho sách: chờ đối tác cấp quyền API từ 07/11
- Thống kê mượn trả: chưa bắt đầu, làm sau phiếu mượn PDF
```

Tiêu chí thêm đặt sau Pending, theo thứ tự: Cần hỗ trợ, Ngày mai, Rủi ro, Giờ làm.

## oral

Báo cáo miệng. Viết để đọc thành tiếng trong khoảng 45 giây: câu ngắn, nói kết quả trước, không đọc mã PR. Xưng hô theo cách người dùng hay dùng, không biết thì hỏi.

```
"Hôm nay em đã đưa tính năng gia hạn sách lên production.
Phiếu mượn PDF xong 3 trên 5 phần, đang chờ review, dự kiến mai xong.
Đồng bộ kho sách đang kẹt quyền API, em cần hỗ trợ giục đối tác."

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
- <việc>: <chờ ai, từ ngày nào>, hoặc "Không có"
```

## weekly

Báo cáo tuần cho cấp trên. Gộp theo kết quả, không liệt kê commit.

```
Báo cáo tuần 09/11 - 15/11 - <tên>

Kết quả chính
- <kết quả, ai được lợi>

Tiến độ so với mục tiêu
- <mục tiêu>: <x/y task, đúng hẹn hay trễ bao lâu>

Rủi ro
- <rủi ro, hậu quả, cách xử lý>

Cần quyết
- <việc cần cấp trên chốt, hạn chốt>

Tuần tới
- <việc chính>
```
