# Python

## Đọc

1. `pyproject.toml`, `requirements*.txt`: framework, phiên bản Python, công cụ
2. Điểm vào: `manage.py`, `main.py`, `app.py`, `wsgi.py`, `asgi.py`
3. API: router FastAPI, `urls.py` và view của Django, blueprint Flask, dependency, middleware
4. Mô hình vào ra: Pydantic, serializer
5. Dữ liệu: `models.py`, SQLAlchemy, thư mục `alembic/` hoặc `migrations/`
6. Nền: tác vụ Celery, RQ, lịch chạy, consumer
7. Cấu hình: `settings.py`, `BaseSettings`, biến môi trường
8. Test: `tests/`, `conftest.py`, fixture

## Trích

- Bảng endpoint: phương thức, đường dẫn, quyền, thao tác ghi
- Ranh giới transaction, `atomic`, nơi commit session
- Tác vụ nền: tên, tham số, số lần thử lại, có idempotent không
- Trộn `async` với lời gọi đồng bộ làm tắc vòng lặp sự kiện
- Signal và hook ngầm, vì chúng chạy mà không thấy ở nơi gọi
- Tác dụng phụ lúc import và trạng thái ở cấp module
- `except Exception` nuốt lỗi, cách lỗi biến thành phản hồi HTTP
- Trường mô hình API khác với cột bảng
- Tên biến môi trường, thiếu thì lỗi hay dùng mặc định
