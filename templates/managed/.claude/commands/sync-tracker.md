---
description: Duyệt các đề xuất trong tracker/outbox cùng người dùng rồi gửi sang project-tracker
---

Mục tiêu: người dùng duyệt từng đề xuất trước khi gửi lên tracker. **Không bao giờ tự đặt `approved: true` khi người dùng chưa đồng ý rõ ràng trong cuộc trò chuyện này.** Nếu không có người dùng trả lời (chạy tự động), chỉ liệt kê rồi dừng.

1. `pwiki tracker pull` để có trạng thái mới nhất, rồi `pwiki tracker outbox`.
2. Với mỗi đề xuất, đối chiếu `tracker/state.json` và wiki. Đề xuất đã lỗi thời (tracker đã có, wiki đã đổi) thì sửa hoặc xoá, và nói rõ đã làm gì.
3. Trình bày cho người dùng một bảng gồm: số thứ tự, loại, nội dung sẽ gửi (title / summary / màu / trạng thái), lý do, dẫn chứng chính. Hỏi người dùng muốn gửi những đề xuất nào, có sửa gì không.
4. Sửa file theo ý người dùng. Đặt `"approved": true` **chỉ** cho những đề xuất người dùng đã đồng ý. Đề xuất người dùng từ chối thì xoá file.
5. `pwiki tracker push --dry-run` để người dùng xem lần cuối, rồi `pwiki tracker push`.
6. Ghi nối `wiki/log.md` (`sync-tracker`: đã gửi gì, mã mục tracker mới) rồi commit.
7. Báo kết quả: đã gửi, mã mục mới, lỗi (nếu có) và cách xử lý.
