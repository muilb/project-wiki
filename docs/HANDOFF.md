# Bàn giao: project-wiki (`pwiki`)

Tóm tắt toàn bộ ý tưởng, các quyết định thiết kế, những gì đã làm và việc tiếp theo, để tiếp tục làm trong Claude Code. Viết ngày 2026-11-20.

---

## 1. Mục tiêu

Xây **"bộ não thứ hai" cho từng dự án** theo pattern **LLM Wiki** của Andrej Karpathy (gist `llm-wiki`, 04/2026):

- Thay vì RAG (mỗi câu hỏi lại tìm lại trong tài liệu gốc), LLM **biên soạn một lần** nguồn thô thành wiki markdown có liên kết, rồi **giữ wiki luôn cập nhật**. Wiki là tài sản tích luỹ theo thời gian.
- Ba lớp:
  - `raw/`: nguồn thô, bất biến, LLM chỉ đọc;
  - wiki: do LLM viết;
  - schema: `CLAUDE.md` và các quy ước.
- Ba thao tác: **ingest** (biên soạn), **query** (hỏi đáp), **lint** (kiểm tra).
- "Obsidian là IDE, LLM là lập trình viên, wiki là codebase."

Kết hợp với **[project-tracker](https://github.com/muilb/project-tracker)**: ứng dụng theo dõi **nhiều dự án** ở mức quản lý (màu, vấn đề, mốc, cảnh báo). Tracker chạy serverless trên AWS (Hono/Lambda, DynamoDB, Cognito), dựng bằng môi trường cloud của Claude Code.

## 2. Các quyết định thiết kế (đã chốt trong trao đổi)

| # | Quyết định | Lý do |
|---|---|---|
| 1 | **Mỗi dự án một vault (git repo private). Tracker dùng chung cho nhiều dự án.** Chỉ những gì cần theo dõi hoặc cảnh báo mới đẩy sang tracker | Tracker giữ "trạng thái" ở mức quản lý, wiki giữ "tri thức" chi tiết |
| 2 | **AI chỉ đề xuất, PL duyệt** rồi mới gửi tracker (`tracker/outbox/` → `/sync-tracker`) | Cùng tinh thần "AI chỉ đề xuất" của project-tracker |
| 3 | **Nguồn cắm thêm được:** Teams, git, Jira, file (file server, OneDrive), inbox, `command` (script tuỳ biến in JSON lines) | Mỗi dự án dùng công cụ khác nhau. Framework không hard-code |
| 4 | **Teams không cần bot hay quyền admin:** Playwright với phiên đăng nhập lưu sẵn, bắt **JSON chatsvc** mà Teams web tự tải, không đọc DOM | Không có quyền tạo bot. Graph API cần admin consent |
| 5 | **`raw/` là git.** Nguồn thay đổi (ticket, file) thì ghi đè, git giữ lịch sử. `/ingest` đọc **git diff** kể từ lần trước | Giải quyết mâu thuẫn "raw bất biến" với việc nguồn bị sửa. LLM biết chính xác cái gì vừa đổi |
| 6 | **Tracker không phải sửa gì:** pwiki đăng nhập Cognito giống web (`USER_PASSWORD_AUTH` + `REFRESH_TOKEN_AUTH`), gọi đúng các REST endpoint đang có | Vẫn có kiểm tra hợp lệ, phân quyền, cảnh báo như nhập tay. Dữ liệu chat của khách không lên AWS |
| 7 | **Hợp đồng wiki ↔ tracker** (`schema/TRACKER-CONTRACT.md`). Không đẩy từng ticket Jira, chỉ đẩy ở mức quản lý | Tránh biến tracker thành bản sao của Jira |
| 8 | **Framework dùng chung + `pwiki upgrade`.** File framework có dòng đánh dấu `pwiki:managed` và được ghi đè khi upgrade, file của dự án không bao giờ bị ghi đè | Nhiều dự án dùng chung, không bị lệch nhau |
| 9 | **Obsidian là công cụ xem chính** (không bắt buộc): bố cục đánh số, MOC từng khu vực, Bases, graph đã cấu hình | Rút ra từ việc phân tích một vault mẫu (ảnh "brain-datahub", xem mục 6) |
| 10 | **Snapshot và lint làm bằng code, không dùng LLM** | Rẻ, chính xác. LLM chỉ làm phần cần hiểu nội dung |

## 3. Kiến trúc

```
 sources.yaml ─► pwiki collect ─► raw/<nguồn>/… (commit)   + tracker/state.json (kéo từ tracker)
                      │                   │
                      ▼                   ▼  /ingest (Claude Code): pwiki ingest-plan → đọc diff → viết trang
              _snapshots/ (pwiki sinh)   vault: Mục lục → MOC từng khu vực → trang (+ liên kết chéo)
                                          │
                                          ▼  theo TRACKER-CONTRACT
                                   tracker/outbox/*.json ─► /sync-tracker (PL duyệt) ─► pwiki tracker push
                                                                                         ─► project-tracker REST
```

Vault mặc định (preset `numbered`):

```
00_Index.md  01_Cach_su_dung.md  02_Tong_quan.md  03_Dashboard.base  04_Nhat_ky.md
10_Domain/  20_Architecture/  30_Decisions/  40_Issues/  50_QA/  60_Cycles/(timeline, Reports/)
70_Changes/  80_Teams/  90_Reference/{Glossary,HowTo,Sources,Answers}/
_Inbox/  _templates/  _attachments/  _snapshots/      raw/  tracker/  .pwiki/  .claude/  .obsidian/
```

Mỗi khu vực có một MOC (`30_Decisions/30_Decisions.md`, hoặc `30_Decisions.md` nếu `moc: beside`).

## 4. Repo framework

```
src/
  cli.ts          lệnh pwiki
  config.ts       schema sources.yaml (zod): project, git, layout, tracker, sources
  layout.ts       khu vực logic ↔ đường dẫn; preset numbered / flat; MOC; kiểu link; detectSections (adopt)
  vault.ts        sinh MOC, mục lục, hướng dẫn, nhật ký, dashboard Bases, mẫu trang, .obsidian/, .claude/settings.json, .pwiki/LAYOUT.md
  scaffold.ts     init / adopt / upgrade, file managed
  raw.ts          RawStore: ghi raw/ an toàn (tên file Windows, không ra ngoài raw/, chỉ ghi khi đổi)
  collect.ts      chạy các nguồn, cursor, kéo tracker, snapshot, commit
  ingest.ts       ingest-plan / ingest-done theo git diff (chia lô được)
  snapshot.ts     trang trạng thái hiện tại: tracker, jira, git, teams, files, command
  lint.ts         kiểm tra link, mồ côi, MOC, chỉ nối với MOC, frontmatter, file lạc, mục mở quá lâu
  env.ts  state.ts  util.ts
  adapters/       types.ts (interface), git, jira, files, teams, command
  tracker/        client.ts (Cognito + REST), sync.ts (pull / outbox / push, map.json)
schema/           SCHEMA.md, TRACKER-CONTRACT.md → .pwiki/ của mỗi vault
templates/
  project/        file tạo một lần: CLAUDE.md, sources.yaml, _env.example, _gitignore, tracker/
  managed/        .claude/commands: collect, ingest, sync-tracker, lint, ask, weekly
  pages/          13 mẫu trang theo type → _templates/
test/             vitest: core, adapters, workflow, vault (40 test)
```

### Lệnh

| Lệnh | Việc |
|---|---|
| `pwiki init <dir> --name "…" [--preset numbered\|flat]` | Tạo vault mới |
| `pwiki adopt [dir] --name "…"` | Thêm pwiki vào vault Obsidian có sẵn: đoán `layout.sections`, `moc`, `types`. Không tạo note nào |
| `pwiki upgrade` | Ghi đè file managed, sinh lại LAYOUT.md, tạo phần bố cục còn thiếu |
| `pwiki layout` | In bố cục đang dùng |
| `pwiki collect [--only a,b] [--record] [--headed] [--no-commit]` | Thu thập nguồn, kéo tracker, snapshot, commit |
| `pwiki teams login [--source x]` | Đăng nhập Teams một lần (có MFA) |
| `pwiki ingest-plan [--batch 30]` / `pwiki ingest-done [file…]` | Lượt ingest theo git diff |
| `pwiki snapshot` / `pwiki lint [--json] [--stale 14]` | Trang trạng thái / kiểm tra máy móc |
| `pwiki tracker login\|pull\|outbox\|push [--dry-run]\|logout` | Đồng bộ project-tracker |
| `pwiki status` | Tình trạng tổng hợp |

### Hợp đồng gửi tracker (đề xuất trong `tracker/outbox/*.json`)

| `kind` | Endpoint của project-tracker | Ghi chú |
|---|---|---|
| `update` | `POST /projects/:id/updates` | `summary`, `health`, `needHelp`. Evidence được nối vào `rawText` |
| `item` | `POST /projects/:id/items` | `key` (key trang wiki) được ghi vào `tracker/map.json` cùng id mục mới |
| `item_status`, `item_update` | `PATCH /projects/:id/items/:itemId` | Xác định mục bằng `itemId`, hoặc bằng `key` có trong map |

Giới hạn trường dữ liệu **bắt chước `api/src/schemas.ts`** của project-tracker. Tracker đổi schema thì phải sửa `src/tracker/sync.ts` theo.

## 5. Trạng thái

**Đã xong và có test:** toàn bộ mục 4.

**Đã chạy thử toàn bộ luồng** với project-tracker chạy local (`npm run dev`, `devUser`):
- init → collect (inbox, git, tracker) → snapshot → lint báo 0 lỗi;
- push đề xuất thật: tạo mục I0018 và đổi I0007 sang done;
- adopt một bản dựng giống vault "brain-datahub": nhận đúng 14 khu vực, `moc: beside`, `type: pr`.

**Chưa kiểm được:**
- [ ] **Teams với tenant thật.** Định dạng chatsvc chưa công khai, cần chạy `--headed --record` để xem rồi chỉnh `parseMessages()`.
- [ ] Jira thật, cả Cloud và Server. Hiện mới test với API giả lập.
- [ ] Mở `03_Dashboard.base`, `graph.json`, `app.json` trong **Obsidian thật**.
- [ ] Chạy `/ingest`, `/sync-tracker`, `/lint`, `/weekly` trong Claude Code với dữ liệu thật, rồi chỉnh SCHEMA theo kết quả.
- [ ] Chạy trên **Windows**: ổ mạng UNC, Task Scheduler, `browser: msedge`.
- [x] **Push lên GitHub** (`main`) và thêm GitHub Actions (`.github/workflows/ci.yml`): typecheck, test, build trên ubuntu và windows.

**Cần xin phép:** hỏi IT hoặc quản lý về việc tự động đọc Teams, và việc đưa nội dung trao đổi với khách hàng cho LLM.

## 6. Bài học từ vault mẫu "brain-datahub" (ảnh graph Obsidian)

Phân tích dựa trên ảnh, không có file gốc:
- Thư mục đánh số kiểu Johnny Decimal. Mỗi thư mục có một note MOC cùng tên đặt bên cạnh, và các MOC này là các hub lớn trên graph.
- Có `70_PR_open_snapshot` và `70_PR_trivial_index`: tách snapshot khỏi lịch sử, gom PR vụn vào một trang. Có `40_Cycles` / `80_Teams`, nhiều khả năng lấy từ Linear.
- **Điểm yếu thấy trên graph:**
  - liên kết kiểu cây (note lá chỉ nối về MOC);
  - khoảng 150 note mồ côi;
  - hub index lấn át graph;
  - rác ở thư mục gốc (daily note, `Untitled.base`).
- **Đã đưa vào pwiki:**
  - MOC theo khu vực;
  - mục "Vụn";
  - snapshot sinh bằng code;
  - quy tắc liên kết chéo, có lint kiểm tra;
  - graph ẩn hub và tô màu theo khu vực;
  - inbox, mẫu trang, trang "Cách sử dụng";
  - `adopt` cho vault kiểu này.

## 7. Việc tiếp theo (gợi ý thứ tự)

1. ~~**Đưa repo lên GitHub**, thêm GitHub Actions chạy `npm test` và `npm run typecheck` trên ubuntu và windows.~~ Đã xong. Theo dõi lần chạy đầu trên windows và sửa nếu có test phụ thuộc hệ điều hành.
2. **Chạy thử trên một dự án thật nhỏ:**
   - `pwiki init`;
   - khai báo nguồn git và files;
   - chạy `/ingest`;
   - chỉnh `schema/SCHEMA.md` và các slash command theo những gì Claude làm chưa tốt.
3. **Teams:** `pwiki teams login` → `pwiki collect --only <teams> --headed --record` → sửa `parseMessages()` theo JSON thật, viết test với fixture đã ẩn dữ liệu.
4. **Jira thật.** Thêm adapter **PR** (GitHub / GitLab / Backlog) cho khu vực `changes`, dùng được cho kiểu `trivial`. Có thể thêm adapter Linear (Cycles / Teams).
5. **Obsidian:**
   - xác nhận dashboard Bases hiển thị đúng;
   - hướng dẫn cài `kepano/obsidian-skills` để Claude viết đúng cú pháp Bases / Canvas;
   - chốt kiểu link: wikilink hay markdown (markdown nếu team xem trên GitHub).
6. **Không bắt buộc, phía project-tracker:**
   - trường `source` / link wiki trên cập nhật và mục;
   - token cá nhân, nếu refresh token Cognito hết hạn gây phiền khi chạy định kỳ.

## 8. Cách tiếp tục trong Claude Code

```bash
git clone project-wiki.bundle project-wiki        # file bundle đã gửi trong chat
cd project-wiki
git remote set-url origin https://github.com/muilb/project-wiki.git
git push -u origin main
npm install && npm test
```

Mở repo bằng Claude Code rồi gõ, ví dụ:

> Đọc `docs/HANDOFF.md` và `README.md`. Làm việc tiếp theo số 1 trong mục 7: thêm GitHub Actions chạy test trên ubuntu và windows.

Quy ước làm việc trong repo nằm ở `CLAUDE.md` (Claude Code tự đọc).
