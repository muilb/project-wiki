# project-wiki (pwiki): hướng dẫn cho Claude Code

Framework LLM Wiki dùng chung cho nhiều dự án: thu thập nguồn vào `raw/`, Claude Code biên soạn vault Obsidian, pwiki sinh snapshot / lint, và đẩy những gì cần theo dõi sang project-tracker (sau khi PL duyệt). Bối cảnh, các quyết định và việc tiếp theo nằm trong `docs/HANDOFF.md`. Hướng dẫn người dùng nằm trong `README.md`.

## Lệnh

```bash
npm install
npm test            # vitest, phải pass trước khi commit
npm run typecheck   # tsc --noEmit
npm run build       # dist/ (bin pwiki); npm link để có lệnh pwiki
```

## Quy ước

- TypeScript ESM, Node 22+, chạy được trên **Windows** (đường dẫn, ổ mạng UNC, tên file Nhật / Việt) lẫn Linux / macOS. Gọi git qua `util.git()` (đã đặt `core.quotepath=false`).
- Chữ người dùng nhìn thấy (CLI, lỗi, trang sinh ra, slash command, schema) viết **tiếng Việt**. Comment trong code viết tiếng Anh, ngắn, giải thích *vì sao*.
- Thêm hay sửa tính năng thì **có test** trong `test/` (dùng `tmp()`, `ctxFor()`, `gitRepo()` trong `test/helpers.ts`). Không gọi mạng thật trong test: dùng `fetch` giả.
- **Không đưa dữ liệu thật** (chat khách hàng, ticket, tài liệu, token) vào repo này, kể cả làm fixture: phải ẩn dữ liệu trước.
- Code nói về khu vực **logic** (`decisions`, `issues`…), không hard-code đường dẫn. Đường dẫn thật lấy từ `Layout` (`src/layout.ts`). Thêm khu vực mới thì cập nhật cả `PRESETS`, `SECTION_INFO`, `KEYWORDS`, mẫu trong `templates/pages/` và test.
- `raw/` chỉ ghi qua `RawStore`. Adapter mới theo kiểu `Adapter` trong `src/adapters/types.ts`, đăng ký trong `adapters/index.ts`, thêm schema vào `config.ts`.
- File trong `schema/` và `templates/managed/` được `pwiki upgrade` chép vào vault, có dòng đánh dấu `pwiki:managed`. Còn `templates/project/` và những gì `vault.ts` sinh ra thì chỉ tạo khi chưa có: **không bao giờ ghi đè note của người dùng**.
- `src/tracker/sync.ts` bắt chước giới hạn của `api/src/schemas.ts` bên project-tracker. Phía tracker đổi thì sửa theo, và cập nhật `schema/TRACKER-CONTRACT.md`.
- Thay đổi hành vi người dùng thấy được thì cập nhật `README.md`. Thay đổi quyết định hay trạng thái thì cập nhật `docs/HANDOFF.md`.
