# Bảo mật

## Báo lỗ hổng

Đừng mở issue công khai. Dùng mục **Security → Report a vulnerability** của repo trên GitHub để báo riêng, kèm phiên bản, cách tái hiện và ảnh hưởng. Đừng gửi khoá hay dữ liệu thật trong báo cáo.

Đây là dự án do một người duy trì trong thời gian rảnh, nên không có cam kết về thời gian phản hồi. Lỗ hổng được xác nhận sẽ được vá ở bản mới nhất và ghi trong `CHANGELOG.md`.

## Phiên bản được hỗ trợ

Chỉ bản phát hành mới nhất.

## Công cụ này đụng tới những gì

Nên biết trước khi cài:

- `npm install` không chạy script nào của gói.
- `flowctl install` nối skill vào `~/.claude/skills` và `~/.agents/skills`, chèn một khối chỉ dẫn vào tệp chỉ dẫn toàn cục của Claude Code, Codex, Gemini CLI, và sinh lệnh slash. Tệp cấu hình được sao lưu thành `*.pre-agent-flow.bak` trước lần ghi đầu tiên. Xem trước bằng `flowctl install --dry`.
- `flowctl install --hooks` thêm hook vào cấu hình của agent. Hook có thể chặn lệnh của agent, ví dụ ghi vào nhánh được bảo vệ hoặc đọc `.env`.
- Gói không gửi dữ liệu đi đâu và không có telemetry.

## Giới hạn

Bộ rà bí mật và các hook chỉ là lớp phòng hộ, không phải ranh giới bảo mật. Chúng có thể bỏ sót và có thể bị lách. Kết quả sạch không chứng minh repo không có bí mật.
