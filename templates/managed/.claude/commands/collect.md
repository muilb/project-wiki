---
description: Thu thập dữ liệu mới từ các nguồn (Teams, git, Jira, file…) vào raw/
argument-hint: "[tên nguồn, cách nhau bằng dấu phẩy]"
---

Nguồn cần lấy: $ARGUMENTS (để trống là mọi nguồn đang bật).

1. Chạy `pwiki collect`, thêm `--only <các nguồn>` nếu người dùng chỉ định nguồn.
2. Báo kết quả từng nguồn. Với nguồn lỗi:
   - Teams hết phiên: người dùng chạy `pwiki teams login` trên máy của họ (cần mở trình duyệt, Claude không làm thay được).
   - Jira 401/403: kiểm tra token trong `.env` (không đọc `.env`, chỉ nhắc người dùng).
   - Không thấy thư mục: ổ mạng chưa kết nối.
3. Có thay đổi trong raw/ thì đề nghị chạy `/ingest`.
