---
description: Soạn báo cáo tuần (週報) từ những gì wiki ghi nhận trong 7 ngày qua
argument-hint: "[vi|ja|vi+ja]"
---

Ngôn ngữ báo cáo: $ARGUMENTS (để trống thì dùng ngôn ngữ báo cáo ghi trong CLAUDE.md).

1. Đọc `wiki/log.md` (các khối 7 ngày gần nhất), `wiki/overview.md`, `wiki/timeline.md`, các trang issue / decision / qa thay đổi trong tuần (`git log --since="7 days ago" --name-only -- wiki`), và `tracker/state.json`.
2. Soạn `wiki/reports/<YYYY>-W<tuần>.md` gồm:
   - Tóm tắt (3–5 dòng);
   - Đã xong / tiến triển;
   - Quyết định trong tuần;
   - Vấn đề và rủi ro (mức độ, người phụ trách, hạn);
   - Câu hỏi mở với khách hàng;
   - Kế hoạch tuần tới (lấy từ timeline).

   Mỗi ý có link về trang wiki.
3. Nếu dự án sắp đến hạn cập nhật trên tracker, hoặc tình hình đổi rõ, tạo đề xuất `update` trong `tracker/outbox/` (`approved: false`) với summary rút gọn từ báo cáo.
4. Thêm vào index, ghi nối log (`weekly`), commit, và đưa người dùng đường dẫn báo cáo.
