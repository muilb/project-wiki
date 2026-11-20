# Hợp đồng wiki ↔ project-tracker

project-tracker theo dõi **nhiều dự án** ở mức quản lý: màu sức khỏe, vấn đề, mốc, cảnh báo. Wiki biết chi tiết của **một** dự án. Chỉ những gì cần theo dõi hoặc cần cảnh báo ở mức quản lý mới được đẩy sang tracker.

## Trạng thái hiện tại trên tracker

`tracker/state.json` được tạo bởi `pwiki tracker pull`. Nội dung gồm:
- `project`: màu tổng hợp, màu PL khai, mức khẩn, có trễ cập nhật không, mốc kế tiếp…;
- `items`: các vấn đề, sự kiện, mốc (`id`, `type`, `title`, `priority`, `date`, `status`, `owner`…);
- `updates`: các cập nhật gần nhất.

`tracker/map.json` lưu `key trang wiki → id mục tracker` (key = đường dẫn từ gốc vault, bỏ `.md`). Trạng thái tracker dạng dễ đọc có trong trang `tracker` của khu vực snapshots. **Luôn đối chiếu hai file này trước khi đề xuất**, để không tạo trùng và không đề xuất điều tracker đã biết.

## Khi nào đề xuất

| Phát hiện trong wiki | Đề xuất | `kind` |
|---|---|---|
| Rủi ro / blocker / bug nghiêm trọng mới, ảnh hưởng tiến độ, chất lượng hoặc khách hàng | thêm mục `issue` (`priority` theo mức ảnh hưởng, `date` = hạn xử lý) | `item` |
| Mốc / sự kiện có ngày: release, UAT, nghiệm thu, họp quan trọng với khách | thêm mục `milestone` / `event` | `item` |
| Issue đã giải quyết, mốc đã xong, hoặc bị hoãn | đổi trạng thái (`done` / `postponed` / `in_progress`) | `item_status` |
| Hạn, mức ưu tiên hoặc người phụ trách của mục thay đổi | sửa mục | `item_update` |
| Tình hình dự án đổi rõ rệt (xấu đi / tốt lên), hoặc cần hỗ trợ từ quản lý | cập nhật `summary`, đề xuất `health`, `needHelp` | `update` |
| Sắp đến hạn cập nhật định kỳ (xem `project` trong state.json) | bản tóm tắt tình hình kể từ lần cập nhật trước | `update` |
| Mâu thuẫn nghiêm trọng chéo nguồn (spec ↔ quyết định khách hàng) | mục `issue` | `item` |

## Không đề xuất

- Chi tiết spec, Q&A, thuật ngữ, lý do của quyết định: những thứ này ở lại wiki.
- **Từng ticket Jira / Backlog.** Ticket đã có nơi quản lý riêng. Chỉ đề xuất khi một ticket hay một nhóm ticket thành vấn đề ở mức quản lý, và khi đó gộp lại thành một mục (ví dụ "5 bug Critical chưa xử lý trước UAT").
- Điều tracker đã có, đúng như state.json.
- Suy đoán chưa có nguồn.

## Định dạng đề xuất

Mỗi đề xuất là một file `tracker/outbox/<YYYYMMDD-HHmm>-<kind>-<slug>.json`. `body` là **đúng** body của API tracker:

```json
{
  "kind": "item",
  "key": "40_Issues/emv-timeout",
  "body": { "type": "issue", "title": "EMV決済タイムアウト（30秒）の仕様未確定", "priority": "high", "date": "2026-11-25", "status": "open" },
  "reason": "Khách hàng chưa chốt timeout, chặn việc test kết nối dự kiến 25/11",
  "evidence": ["raw/teams-spec/仕様確認/2026-11-18.md msg:1731912345678", "40_Issues/emv-timeout.md"],
  "approved": false
}
```

| `kind` | Trường bắt buộc | `body` |
|---|---|---|
| `update` | — | `summary` (≤4000), tuỳ chọn `health` (`green` / `yellow` / `red`), `needHelp` (≤2000) |
| `item` | `key` (key trang wiki) | `type` (`issue` / `event` / `milestone`), `title` (≤500), `date` (YYYY-MM-DD; issue: hạn, event / milestone: ngày diễn ra), `priority` (`high` / `medium` / `low`), tuỳ chọn `owner` (**email** người dùng tracker), `note` (≤2000) |
| `item_status` | `itemId` (từ state.json) hoặc `key` (có trong map.json) | `status` (`open` / `in_progress` / `done` / `postponed`), tuỳ chọn `note` |
| `item_update` | như trên | chỉ các trường thay đổi |

Quy tắc:
- `approved` **luôn là `false`** khi bạn tạo. Chỉ đặt `true` khi con người đã đồng ý rõ ràng trong cuộc trò chuyện (`/sync-tracker`).
- `reason` và `evidence` là bắt buộc. Evidence trỏ về raw (kèm `msg:`) và trang wiki.
- `owner` chỉ điền khi biết chắc email tracker của người đó (ghi trong `CLAUDE.md` hoặc trường `tracker_email` của trang người).
- Viết `title` và `summary` bằng ngôn ngữ dùng trên tracker (ghi trong `CLAUDE.md`). Ngắn, đọc là hiểu, không cần mở wiki.
- `health` chỉ là **đề xuất**. Đỏ = dự án đang gặp vấn đề nghiêm trọng, cần can thiệp; Vàng = có rủi ro cần theo dõi; Xanh = bình thường. Không đổi màu vì một sự cố nhỏ đã xử lý xong.
- Mỗi lượt ingest thường chỉ ra 0–3 đề xuất. Nhiều hơn thì gộp lại.
- Đề xuất trong outbox đã lỗi thời (state.json mới hơn đã phản ánh, hoặc wiki đã đổi) thì sửa hoặc xoá file đó.
