# Go

## Đọc

1. `go.mod`: phiên bản, thư viện chính
2. `cmd/*/main.go`: cách lắp ráp, cờ, tín hiệu tắt
3. `internal/` hoặc package của module: tệp đặt tên theo package, `doc.go`
4. Handler: router, middleware, transport HTTP hoặc gRPC, tệp `.proto`
5. Interface được định nghĩa ở phía dùng
6. Tầng dữ liệu: `sqlc`, `sqlx`, `gorm`, thư mục migration
7. Goroutine: `go func`, `errgroup`, channel, worker
8. Cấu hình: struct config, nơi đọc biến môi trường
9. `*_test.go`, `testdata/`, build tag cho test tích hợp

## Trích

- Điểm vào: route, method RPC, lịch chạy, consumer
- Ranh giới transaction và lệnh gọi mạng nằm trong transaction
- Cách lan truyền `context.Context`, timeout, chỗ dùng `context.Background()` giữa luồng
- Cách bọc lỗi, sentinel error, chỗ `errors.Is` và `errors.As` phụ thuộc vào
- Vòng đời goroutine: ai dừng nó, panic được xử lý ở đâu
- Trạng thái dùng chung và khoá bảo vệ
- Giá trị rỗng có ý nghĩa: `nil` khác slice rỗng khi ra JSON
- Tên biến môi trường, thiếu thì lỗi hay dùng mặc định
- Mã sinh: lệnh `go:generate`, tệp không được sửa tay
