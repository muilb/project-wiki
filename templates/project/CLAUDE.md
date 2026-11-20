# Wiki dự án: {{PROJECT_NAME}}

Đây là wiki của **một** dự án, do LLM duy trì theo pattern LLM Wiki. Quy ước chung nằm ở ba file dưới đây (pwiki quản lý, cập nhật bằng `pwiki upgrade`). Phần còn lại của file này là quy ước riêng của dự án, và **ưu tiên hơn** quy ước chung.

@.pwiki/SCHEMA.md
@.pwiki/LAYOUT.md
@.pwiki/TRACKER-CONTRACT.md

## Thông tin dự án

- Khách hàng: <!-- tên công ty, bộ phận -->
- Mục tiêu / phạm vi: <!-- 2–3 dòng -->
- Giai đoạn hiện tại: <!-- 要件定義 / 設計 / 実装 / テスト / UAT / 運用 -->
- Mã dự án trên tracker: xem `tracker.projectId` trong sources.yaml

## Người tham gia

<!-- Tên hiển thị khác nhau ở từng nguồn: ghi để wiki gộp về đúng một người. Email tracker dùng cho "owner". -->

| Người | Vai trò | Teams | Jira / git | Email tracker |
|---|---|---|---|---|
| | PL | | | |

## Ngôn ngữ

- Wiki: tiếng Việt, giữ nguyên thuật ngữ tiếng Nhật (kèm nghĩa trong glossary)
- Đề xuất lên tracker (title, summary): tiếng Việt
- Báo cáo tuần: tiếng Việt

## Nguồn có thẩm quyền

<!-- Chỉ ghi khi khác bảng mặc định ở SCHEMA.md mục 5. Ví dụ: "Spec: 基本設計書 trong nguồn specs; 詳細設計 chỉ tham khảo." -->

## Quy ước riêng

- Mã ticket: <!-- ví dụ EMV-123 -->
- <!-- tên màn hình / mã API / batch theo chuẩn nào, nhánh git nào là release… -->

## Ngưỡng đẩy lên tracker

<!-- Tuỳ chỉnh hợp đồng tracker cho dự án này, ví dụ:
- Bug Critical của Jira: gộp thành 1 issue khi ≥ 3 cái mở quá 2 ngày
- Họp định kỳ với khách hàng: không tạo event (đã có lịch)
-->
