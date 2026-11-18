---
description: Kiểm tra sức khỏe wiki - trích dẫn, link hỏng, trang mồ côi, mâu thuẫn chéo nguồn, lệch với tracker
---

Kiểm tra wiki theo `.pwiki/SCHEMA.md` mục 8.

1. Đọc `wiki/index.md`, rồi duyệt `wiki/` và `tracker/state.json`. Để kiểm tra link và trích dẫn, có thể dùng `git ls-files` hoặc tìm kiếm file.
2. Tự sửa những gì chắc chắn sửa được: link `[[…]]` hỏng do đổi tên, trang thiếu trong index, frontmatter thiếu trường.
3. Với mâu thuẫn chéo nguồn và lệch với tracker: ghi `> ⚠️` vào trang liên quan. Lệch nghiêm trọng thì tạo đề xuất trong `tracker/outbox/` (`approved: false`).
4. Ghi báo cáo vào `wiki/reports/lint-<YYYY-MM-DD>.md` gồm: đã sửa gì, việc cần con người quyết định, câu hỏi nên hỏi khách hàng hoặc team. Thêm vào index, ghi nối `wiki/log.md`, commit.
5. Tóm tắt kết quả cho người dùng, ưu tiên những việc cần họ làm.
