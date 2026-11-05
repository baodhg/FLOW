# Đóng góp

## Giấy phép đóng góp

Khi gửi pull request, bạn đồng ý rằng phần đóng góp được phát hành theo giấy phép MIT của dự án, và bạn có quyền đóng góp nội dung đó.

## Ranh giới với dự án khác

Bộ skill chỉ chứa nguyên lý đã khái quát. Không đưa vào:

- mã, tài liệu hay câu chữ chép từ dự án khác, nhất là dự án của công ty hoặc khách hàng;
- tên riêng, số liệu, sự cố, từ vựng nghiệp vụ, dữ liệu thật.

Ví dụ minh hoạ dùng miền hư cấu "thư viện cho mượn sách". Trước khi gửi, đối chiếu với các dự án bạn đang làm:

```
flowctl provenance --against <thư mục dự án>
```

## Chạy kiểm tra

```
npm test
node bin/flowctl.mjs selftest
node bin/flowctl.mjs secrets scan --path .
```

Sửa lỗi thì thêm test thất bại trước khi sửa. Không nới công cụ kiểm tra để cho qua.

## Quy ước

- Mã: định danh tiếng Anh, không chú thích, không thêm phụ thuộc ngoài.
- Commit: Conventional Commits, tiêu đề tiếng Anh.
- Tài liệu skill: tiếng Việt có dấu.
- Thay đổi người dùng thấy được thì ghi vào mục `[Chưa phát hành]` của `CHANGELOG.md`.
