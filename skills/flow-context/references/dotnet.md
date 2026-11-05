# .NET

## Đọc

1. `*.csproj`, `*.sln`: target framework, tham chiếu giữa các project
2. `Program.cs`: đăng ký DI, thứ tự middleware, xác thực
3. `appsettings*.json`: chỉ đọc tên khoá, không in giá trị
4. API: `Controllers/`, minimal API, filter, `[Authorize]`, policy
5. Logic: service, handler, MediatR nếu có
6. Dữ liệu: `DbContext`, cấu hình entity, `Migrations/`, truy vấn thô, stored procedure
7. Nền: `IHostedService`, `BackgroundService`, Hangfire, consumer
8. Hợp đồng: DTO, ánh xạ, thuộc tính chuyển đổi JSON
9. Project test

## Trích

- Bảng endpoint: route, policy, thao tác ghi
- Thứ tự middleware có ý nghĩa
- Thời gian sống trong DI: chỗ `Singleton` giữ `Scoped`, chỗ tạo scope tay
- Ranh giới `SaveChanges` và transaction; lệnh gọi ngoài nằm trong transaction
- Truy vấn dùng `AsNoTracking`, `Include`, nguy cơ N+1
- Global query filter, vì nó âm thầm đổi kết quả
- `async void`, `.Result`, `.Wait()` và chỗ thiếu `CancellationToken`
- Xử lý lỗi toàn cục, cách lỗi biến thành mã HTTP
- Tên cấu hình, thiếu thì lỗi hay dùng mặc định
