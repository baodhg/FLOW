# Đóng góp

## Giấy phép đóng góp

Khi gửi pull request, bạn đồng ý rằng phần đóng góp được phát hành theo giấy phép MIT của dự án, và bạn có quyền đóng góp nội dung đó.

## Ranh giới với dự án khác

Bộ skill chỉ chứa nguyên lý đã khái quát. Không đưa vào:

- mã, tài liệu hay câu chữ chép từ dự án khác, nhất là dự án của công ty hoặc khách hàng;
- tên riêng, số liệu, sự cố, từ vựng nghiệp vụ, dữ liệu thật.

Ví dụ minh hoạ dùng miền hư cấu "thư viện cho mượn sách". Trước khi gửi, đối chiếu với các dự án bạn đang làm:

```
flow provenance --against <thư mục dự án>
```

## Chạy kiểm tra

```
npm test
node bin/flow.mjs selftest
node bin/flow.mjs secrets scan --path .
```

Sửa lỗi thì thêm test thất bại trước khi sửa. Không nới công cụ kiểm tra để cho qua.

## Quy ước

- Mã: định danh tiếng Anh, không chú thích, không thêm phụ thuộc ngoài.
- Commit: Conventional Commits, tiêu đề tiếng Anh.
- Tài liệu skill: tiếng Việt có dấu.
- Tiêu đề commit tạo nên `CHANGELOG.md`, nên viết để người dùng đọc hiểu. Không sửa tay số phiên bản hay các mục do release-please sinh.

## Phát hành

release-please đọc các commit trên `main` và mở một PR phát hành gồm số phiên bản và `CHANGELOG.md`. Merge PR đó thì CI tạo tag, bản phát hành trên GitHub và đăng lên npm kèm provenance qua trusted publishing. Không cần token npm và không đăng tay.

PR do release-please mở không tự chạy CI vì GitHub không kích hoạt workflow từ token mặc định. Nếu cần kiểm tra, đóng rồi mở lại PR đó. Bước đăng gói luôn chạy lại toàn bộ test trước khi đăng.
