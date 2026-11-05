# Sửa dữ liệu: {{title}}

Ngày: {{date}} · Plan: {{plan}}

## 0. Mục đích

- Sai ở đâu: <…>
- Sau khi chạy phải đúng thế nào: <…>
- Số dòng dự kiến: <…>

## 1. Đo trước

| Điều cần đo | Truy vấn | Kỳ vọng | Nếu lệch |
|---|---|---|---|
| <…> | <…> | <…> | Không chạy, báo người phụ trách |

## 2. Script

Mỗi khối đều kết thúc bằng `ROLLBACK`. Chạy thử nguyên khối trước, đọc kết quả, rồi chỉ đổi dòng cuối thành `COMMIT` khi có người được giao phê duyệt. Dùng khối đúng với CSDL đang chạy.

PostgreSQL:

```sql
BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM loan WHERE id IN (<id>) AND status = 'OPEN') <> <số dòng> THEN
    RAISE EXCEPTION 'trạng thái trước không khớp';
  END IF;
END $$;

CREATE TABLE bak_loan_<slug> AS
SELECT * FROM loan WHERE id IN (<id>);

UPDATE loan
SET status = 'RETURNED'
WHERE id IN (<id>) AND status = 'OPEN';

DO $$
BEGIN
  IF (SELECT count(*) FROM loan WHERE id IN (<id>) AND status = 'RETURNED') <> <số dòng> THEN
    RAISE EXCEPTION 'trạng thái sau không khớp';
  END IF;
END $$;

ROLLBACK;
```

SQL Server:

```sql
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF (SELECT COUNT(*) FROM loan WHERE id IN (<id>) AND status = 'OPEN') <> <số dòng>
BEGIN
  THROW 50001, N'trạng thái trước không khớp', 1;
END;

SELECT * INTO bak_loan_<slug> FROM loan WHERE id IN (<id>);

UPDATE loan
SET status = 'RETURNED'
WHERE id IN (<id>) AND status = 'OPEN';

IF (SELECT COUNT(*) FROM loan WHERE id IN (<id>) AND status = 'RETURNED') <> <số dòng>
BEGIN
  THROW 50001, N'trạng thái sau không khớp', 1;
END;

ROLLBACK;
```

## 3. Đọc lại

Chạy sau khi đã `COMMIT`, trên kết nối mới.

```sql
SELECT id, status FROM loan WHERE id IN (<id>);
```

- Đạt khi: <…>

## 4. Đảo ngược

Khôi phục từ bảng `bak_loan_<slug>`:

```sql
UPDATE loan
SET status = (SELECT b.status FROM bak_loan_<slug> b WHERE b.id = loan.id)
WHERE id IN (SELECT id FROM bak_loan_<slug>);
```

- Hạn giữ bảng sao lưu: <…>

## 5. Ngoài phạm vi

- <dữ liệu nào cố ý không đụng, và vì sao>
