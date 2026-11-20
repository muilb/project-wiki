---
description: Soạn báo cáo tuần (週報) từ những gì wiki ghi nhận trong 7 ngày qua
argument-hint: "[vi|ja|vi+ja]"
---

Ngôn ngữ báo cáo: $ARGUMENTS (để trống thì dùng ngôn ngữ báo cáo ghi trong CLAUDE.md).

1. Đọc các nguồn sau (đường dẫn trong `.pwiki/LAYOUT.md`):
   - nhật ký (các khối 7 ngày gần nhất), tổng quan, timeline;
   - các trang issue / decision / qa thay đổi trong tuần (`git log --since="7 days ago" --name-only`);
   - các trang trong khu vực snapshots: tracker, ticket, git, Teams.
2. Soạn `<YYYY>-W<tuần>.md` trong khu vực reports (mẫu `report`) gồm:
   - Tóm tắt (3–5 dòng);
   - Đã xong / tiến triển;
   - Quyết định trong tuần;
   - Vấn đề và rủi ro (mức độ, người phụ trách, hạn);
   - Câu hỏi mở với khách hàng;
   - Kế hoạch tuần tới (lấy từ timeline).

   Mỗi ý có link về trang wiki.
3. Nếu dự án sắp đến hạn cập nhật trên tracker, hoặc tình hình đổi rõ, tạo đề xuất `update` trong `tracker/outbox/` (`approved: false`) với summary rút gọn từ báo cáo.
4. Thêm vào MOC reports, ghi nối nhật ký (`weekly`), commit, và đưa người dùng đường dẫn báo cáo.
