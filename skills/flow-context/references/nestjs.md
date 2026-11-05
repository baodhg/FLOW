# NestJS

## Đọc

1. `*.module.ts`: `imports`, `providers`, `exports`, ranh giới thực sự của module
2. `*.controller.ts`: route, decorator guard, pipe, interceptor
3. `*.service.ts`: logic chính, transaction
4. DTO: `class-validator`, `@ApiProperty`
5. Tầng dữ liệu: entity TypeORM, `schema.prisma`, schema Mongoose, thư mục migration
6. Guard, interceptor, filter toàn cục ở `main.ts` và `app.module.ts`
7. Bất đồng bộ: `@Processor`, `@Cron`, `@EventPattern`, `@MessagePattern`, `@OnEvent`
8. Cấu hình: `ConfigModule`, schema kiểm biến môi trường
9. `*.spec.ts`, `test/*.e2e-spec.ts`

## Trích

- Bảng route: phương thức, đường dẫn, guard, quyền
- Provider được export, ai import module này
- Thứ tự thực thi có ý nghĩa: guard, interceptor, pipe, filter
- Ranh giới transaction và lệnh gọi ngoài nằm trong transaction
- Sự kiện phát ra và nhận vào: tên, payload, hàng đợi, số lần thử lại
- Phụ thuộc vòng và các chỗ dùng `forwardRef`
- Provider có scope `REQUEST`, vì nó lan scope lên chuỗi phụ thuộc
- Trường DTO khác với cột bảng; `ValidationPipe` có `whitelist` hay không
- Tên biến môi trường đọc ở đâu, thiếu thì lỗi hay dùng mặc định
