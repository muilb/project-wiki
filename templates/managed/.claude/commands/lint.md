---
description: Kiểm tra sức khỏe wiki - link, trang mồ côi, MOC, liên kết chéo, mâu thuẫn chéo nguồn, lệch với tracker
---

Kiểm tra wiki theo `.pwiki/SCHEMA.md` mục 8.

1. `pwiki lint` (nếu cần xử lý theo máy thì thêm `--json`). Sửa những lỗi chắc chắn sửa được:
   - link hỏng hoặc trùng tên: ghi đường dẫn đầy đủ;
   - trang chưa có trong MOC: thêm vào MOC;
   - frontmatter sai: sửa;
   - trang mồ côi hoặc chỉ nối với MOC: thêm liên kết chéo tới các trang thật sự liên quan, đọc nội dung để chọn. **Đừng thêm link chỉ để cho hết cảnh báo.**
   - file nằm ngoài bố cục: chuyển vào khu vực phù hợp. Chỉ hỏi người dùng trước khi xoá.
2. Kiểm tra phần máy không làm được:
   - mâu thuẫn chéo nguồn (spec ↔ quyết định, ticket ↔ commit, timeline ↔ ticket);
   - lệch giữa wiki và trang `tracker` trong khu vực snapshots;
   - nội dung lỗi thời.

   Ghi `> ⚠️` vào trang liên quan. Lệch nghiêm trọng thì tạo đề xuất trong `tracker/outbox/` (`approved: false`).
3. Ghi báo cáo vào khu vực reports (`lint-<YYYY-MM-DD>.md`, type `report`) gồm: đã sửa gì, việc cần con người quyết định, câu hỏi nên hỏi khách hàng hoặc team. Thêm vào MOC reports, ghi nối nhật ký, commit.
4. Chạy lại `pwiki lint` để xác nhận. Tóm tắt kết quả cho người dùng, ưu tiên những việc cần họ làm.
