# React

## Đọc

1. `package.json`: framework, bộ định tuyến, thư viện trạng thái và dữ liệu
2. Định tuyến: `app/`, `pages/`, cấu hình route, route cần đăng nhập
3. Điểm vào: `main.tsx`, layout, các provider bọc ngoài
4. Lớp gọi API: client dùng chung, interceptor, xử lý `401`
5. Dữ liệu từ server: hook truy vấn, query key, chính sách làm mới
6. Trạng thái cục bộ dùng chung: store, context
7. Biểu mẫu: thư viện form, schema kiểm
8. Component dùng chung, token thiết kế, i18n
9. Test: `*.test.tsx`, test đầu cuối

## Trích

- Bảng màn hình: route, quyền, endpoint gọi
- Query key và thao tác nào làm mất hiệu lực key nào
- Dữ liệu nằm ở đâu: URL, server cache, store, `localStorage`, và nguồn nào là gốc
- Trạng thái đang tải, rỗng, lỗi của từng màn hình quan trọng
- Ranh giới server và client nếu dùng SSR hoặc server component
- Biến môi trường lộ ra trình duyệt, không có gì bí mật trong đó
- Hình dạng dữ liệu khác nhau giữa API và component, chỗ chuyển đổi
- Effect có phụ thuộc đáng chú ý, chỗ dễ gọi hai lần
- Kích thước màn hình và theme đang hỗ trợ
