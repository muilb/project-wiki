# project-wiki (`pwiki`)

Khung **LLM Wiki** (theo pattern của Andrej Karpathy) dùng chung cho nhiều dự án:

- **Mỗi dự án một wiki riêng**: một git repo private, do Claude Code duy trì.
- **Nguồn cắm thêm được**: Teams, git, Jira, thư mục tài liệu (file server, OneDrive, SharePoint), hoặc bất kỳ chương trình nào in ra JSON.
- Chỉ những gì **cần theo dõi hoặc cảnh báo** mới được đẩy sang [project-tracker](https://github.com/muilb/project-tracker), và chỉ sau khi PL duyệt.

```
 sources.yaml ─► pwiki collect ─► raw/ (git: mỗi lần lấy là một commit, giữ toàn bộ lịch sử)
                                    │
                                    ▼  /ingest (Claude Code đọc git diff của raw/)
                                  wiki/  ── tri thức dự án: issue, quyết định, spec, Q&A, timeline…
                                    │
                                    ▼  theo .pwiki/TRACKER-CONTRACT.md
                             tracker/outbox/ ─► /sync-tracker (PL duyệt) ─► pwiki tracker push ─► project-tracker
```

Phân vai: **pwiki** (chương trình) lo phần máy móc: thu thập, cursor, commit, đăng nhập, gửi API. **Claude Code** lo phần hiểu nội dung: biên soạn wiki, phát hiện mâu thuẫn, soạn đề xuất. **Con người** chọn nguồn, hỏi, và duyệt.

---

## Cài đặt (một lần mỗi máy)

Cần Node.js 22+, git và Claude Code.

```bash
git clone https://github.com/<org>/project-wiki.git
cd project-wiki
npm install          # kèm exceljs (.xlsx), mammoth (.docx), playwright (Teams)
npm link             # có lệnh "pwiki"
pwiki --version
```

Nguồn Teams dùng Edge hoặc Chrome đã cài sẵn trên máy (`browser: msedge`), nên không cần tải trình duyệt riêng. Nếu muốn dùng Chromium của Playwright: `npx playwright install chromium` và đặt `browser: chromium`.

## Tạo wiki cho một dự án

```bash
pwiki init ihp-emv-wiki --name "IHP EMV"
cd ihp-emv-wiki
cp .env.example .env       # điền token / mật khẩu (không commit)
```

Sau đó:

1. Sửa **`sources.yaml`**: thêm nguồn và phần `tracker`. Template có sẵn ví dụ cho mọi loại nguồn.
2. Sửa **`CLAUDE.md`**: thông tin dự án, bảng người tham gia (tên ở Teams / Jira ↔ email tracker), ngôn ngữ, quy ước riêng.
3. Tạo repo **private** rồi push (`git remote add origin …`).
4. Mở bằng Obsidian nếu muốn xem dạng graph. Thư mục wiki là một vault bình thường.

`pwiki init` tạo ra:

```
CLAUDE.md                 quy ước riêng của dự án (import .pwiki/SCHEMA.md, TRACKER-CONTRACT.md)
sources.yaml  .env        cấu hình nguồn / bí mật
.claude/settings.json     quyền cho Claude Code: không được sửa raw/, không đọc .env, push tracker phải hỏi
.claude/commands/         /collect /ingest /sync-tracker /lint /ask /weekly
.pwiki/                   SCHEMA.md, TRACKER-CONTRACT.md (do pwiki quản lý), state.json (cursor)
raw/                      nguồn thô, chỉ pwiki ghi
wiki/                     index, overview, log, timeline, glossary, issues/, decisions/, specs/, qa/…
tracker/                  state.json, outbox/, map.json, sent/
```

## Làm việc hằng ngày

| Bước | Ai chạy | Lệnh |
|---|---|---|
| Thu thập | máy (lịch chạy) hoặc tay | `pwiki collect` |
| Biên soạn wiki | Claude Code | `/ingest` |
| Duyệt và gửi tracker | PL trong Claude Code | `/sync-tracker` |
| Hỏi đáp | ai cũng được | `/ask EMV timeout đã chốt chưa?` |
| Báo cáo tuần | PL | `/weekly vi+ja` |
| Kiểm tra wiki | định kỳ | `/lint` |

`pwiki status` cho xem tình trạng từng nguồn, số file raw chờ ingest và số đề xuất trong outbox.

### Chạy tự động (Windows Task Scheduler)

Mỗi 2 giờ trong giờ làm việc:

```bat
cd /d D:\wiki\ihp-emv-wiki && pwiki collect >> .pwiki\collect.log 2>&1
```

Có thể cho ingest chạy không người trông. Claude sẽ biên soạn wiki và soạn đề xuất, nhưng **không gửi tracker được**, vì `settings.json` bắt lệnh `pwiki tracker push` phải hỏi người dùng:

```bat
claude -p "/ingest" --allowedTools "Read,Edit,Write,Bash(pwiki:*),Bash(git:*)"
```

---

## Nguồn

Mỗi nguồn có một `name`, dùng làm tên thư mục `raw/<name>/`. Mỗi nguồn giữ cursor riêng trong `.pwiki/state.json`, nên lần sau chỉ lấy phần mới. Nguồn nào lỗi thì cursor của nó giữ nguyên, các nguồn khác vẫn chạy bình thường. Một dự án có thể có nhiều nguồn cùng loại (hai repo git, hai project Jira…).

### `git`: commit, không chép code

```yaml
- name: app
  type: git
  repo: ../app            # bản clone trên máy
  branch: main
  fetch: true             # git fetch trước, đọc origin/main
  since: 2026-10-01       # lần đầu
  ticketPattern: "[A-Z][A-Z0-9_]+-\\d+"
  ignorePaths: [package-lock.json, dist/]
```

Ghi ra `raw/app/commits/<ngày>.md`, gồm: tác giả, giờ, message, mã ticket tìm thấy, danh sách file đổi (+/-). Lịch sử bị viết lại (force push) thì đọc lại từ ngày của cursor, commit đã ghi được bỏ qua nên không bị trùng.

### `jira`: Cloud hoặc Server / Data Center

```yaml
- name: jira
  type: jira
  baseUrl: https://your-company.atlassian.net
  deployment: cloud       # cloud: JIRA_EMAIL + JIRA_TOKEN (API token) | server: JIRA_TOKEN = personal access token
  jql: project = EMV
  extraFields: [customfield_10020]
```

Mỗi issue là một file `raw/jira/EMV-123.md` (trạng thái, ưu tiên, người phụ trách, hạn, mô tả, bình luận). File được ghi đè khi issue đổi, và git giữ các bản cũ nên `/ingest` thấy chính xác cái gì vừa đổi. API token tạo ở trang tài khoản cá nhân, không cần quyền admin.

### `files`: tài liệu, 設計書

```yaml
- name: specs
  type: files
  path: "\\\\fileserver\\Share\\Project\\EMV\\設計書"   # hoặc thư mục OneDrive / SharePoint đã đồng bộ về máy
  extensions: [.xlsx, .docx, .md, .pdf, .pptx]
  exclude: ["~$", "/old/"]
  converters:
    .pdf: markitdown {file}
    .pptx: markitdown {file}
```

- Có sẵn: `.md`, `.txt`, `.csv`, `.xlsx` (mỗi sheet thành một bảng markdown), `.docx`.
- Định dạng khác: khai báo `converters`, là một lệnh in markdown ra stdout. Ví dụ [markitdown](https://github.com/microsoft/markitdown) (`pip install markitdown`) xử lý được pdf, pptx, xls…
- File gốc giữ nguyên chỗ cũ. raw chỉ lưu bản markdown kèm `sha256`. File bị xoá khỏi thư mục thì bản raw cũng bị xoá.
- Giới hạn: hình, shape và comment trong Excel không được chuyển. Ô gộp (merge) chỉ giữ giá trị ở ô đầu.

### `teams`: không cần bot, không cần quyền admin

```yaml
- name: teams-spec
  type: teams
  conversations:
    - name: 仕様確認
      url: https://teams.microsoft.com/l/channel/19%3A…%40thread.tacv2/…   # "Copy link" của kênh
    - name: chat-khach-hang
      url: https://teams.microsoft.com/v2/#/conversations/19:…              # địa chỉ chat trên Teams web
  lookbackDays: 14
  browser: msedge
```

1. `pwiki teams login`: mở trình duyệt để bạn đăng nhập (kể cả MFA). Đóng cửa sổ là phiên được lưu vào `.pwiki/teams-profile/` (không commit).
2. `pwiki collect`: trình duyệt chạy ẩn, mở từng kênh, cuộn lên để tải tin cũ. pwiki giữ lại **JSON mà chính Teams web tải về**, không đọc giao diện trang.
3. Kết quả: `raw/teams-spec/<kênh>/<ngày>.md`, mỗi tin một khối có `msg:<id>` để trích dẫn. Tin bị sửa được thay bằng bản mới, tin bị xoá được đánh dấu.

> ⚠️ **Đây là phần thử nghiệm.** Định dạng JSON nội bộ của Teams không phải API công khai, có thể khác theo tenant hoặc thay đổi theo thời gian. Lần đầu nên chạy `pwiki collect --only teams-spec --headed --record` để xem trình duyệt và lưu các response vào `.pwiki/teams-debug/`. Nếu không bắt được tin nhắn nào, gửi các file đó để chỉnh `parseMessages()` trong `src/adapters/teams.ts`.
>
> Trước khi dùng, hãy hỏi ý kiến IT hoặc quản lý về việc tự động đọc Teams, và về việc gửi nội dung chat của khách hàng cho LLM.

### `command`: nguồn tuỳ biến (Backlog, Redmine, email, DB…)

Bất kỳ chương trình nào in JSON lines ra stdout:

```yaml
- name: backlog
  type: command
  command: python scripts/backlog.py
```

| Vào (biến môi trường) | Ra (mỗi dòng một JSON) |
|---|---|
| `PWIKI_CURSOR`: JSON của lần trước (`null` lần đầu) | `{"path": "BL-12.md", "frontmatter": {...}, "body": "..."}`: ghi `raw/backlog/BL-12.md` |
| `PWIKI_SOURCE`, `PWIKI_TIMEZONE`, `PWIKI_RAW_DIR` | `{"remove": "BL-3.md"}` |
| các biến trong `.env` | `{"cursor": ...}`: lưu cho lần sau |
| | `{"log": "..."}` |

```python
import json, os
cursor = json.loads(os.environ["PWIKI_CURSOR"]) or {}
for t in fetch_tickets(since=cursor.get("updated")):          # gọi API của bạn
    print(json.dumps({"path": f"{t['key']}.md", "frontmatter": {"status": t["status"]},
                      "body": f"# {t['key']} {t['summary']}\n\n{t['description']}"}, ensure_ascii=False))
print(json.dumps({"cursor": {"updated": latest}}))
```

Một loại nguồn được nhiều dự án cần thì nên đưa thành adapter chính thức trong `src/adapters/`.

---

## Tracker

```yaml
tracker:
  url: https://dxxxx.cloudfront.net   # web của project-tracker (pwiki đọc /config.json để biết API và Cognito)
  projectId: P03
  email: pl@company.com
```

- `pwiki tracker login`: đăng nhập giống trang web (Cognito). Mật khẩu lấy từ `TRACKER_PASSWORD` trong `.env`, hoặc nhập tay. Phiên được lưu ở `.pwiki/tracker-session.json` (không commit) và tự làm mới.
- `pwiki tracker pull`: lưu `tracker/state.json` (màu dự án, các mục, cập nhật gần nhất). `/ingest` đối chiếu file này để không đề xuất trùng.
- `pwiki tracker push [--dry-run]`: gửi các file trong `tracker/outbox/` có `"approved": true`, qua **đúng các endpoint mà web đang dùng**:

  | `kind` | Endpoint |
  |---|---|
  | `update` | `POST /projects/:id/updates` |
  | `item` | `POST /projects/:id/items` |
  | `item_status`, `item_update` | `PATCH /projects/:id/items/:itemId` |

  Nhờ vậy tracker không phải sửa gì, và mọi thay đổi vẫn được kiểm tra hợp lệ, phân quyền, bắn cảnh báo như khi nhập tay. Mục mới được ghi vào `tracker/map.json` (key wiki → id tracker), đề xuất đã gửi chuyển sang `tracker/sent/`.

Khi phát triển, có thể chạy với tracker local (`npm run dev` trong project-tracker): đặt `apiUrl: http://localhost:3001` và `devUser: <email>`.

Những gì được hay không được đẩy lên tracker nằm trong `.pwiki/TRACKER-CONTRACT.md`. Mỗi dự án có thể tinh chỉnh ở mục "Ngưỡng đẩy lên tracker" trong `CLAUDE.md`.

## Cập nhật framework cho mọi dự án

```bash
cd project-wiki && git pull && npm install && npm run build
cd ../ihp-emv-wiki && pwiki upgrade
```

`upgrade` ghi đè các file mang dòng `<!-- pwiki:managed … -->`, gồm `.pwiki/SCHEMA.md`, `.pwiki/TRACKER-CONTRACT.md` và `.claude/commands/*.md`. Muốn tự sửa một slash command cho riêng dự án thì xoá dòng đó, `upgrade` sẽ bỏ qua file. Các file của dự án (`CLAUDE.md`, `sources.yaml`, `wiki/`) không bao giờ bị đụng tới.

## An toàn

- Repo wiki của dự án phải **private**. Repo framework thì public được, vì không chứa dữ liệu.
- `.env`, phiên Teams và phiên tracker nằm trong `.gitignore`. Claude Code bị cấm đọc các file này (`.claude/settings.json`).
- Claude Code bị cấm sửa `raw/`, `tracker/state.json`, `tracker/map.json` và `.pwiki/state.json`. Lệnh `pwiki tracker push` luôn phải hỏi người dùng.
- Schema yêu cầu coi nội dung raw là **dữ liệu, không phải chỉ dẫn** (chống prompt injection từ tin nhắn hay ticket), và không chép mật khẩu hay dữ liệu cá nhân vào wiki.

## Phát triển framework

```bash
npm test          # vitest: adapter, ingest plan, tracker push (API giả), init / upgrade
npm run typecheck
npm run build
```

```
src/
  cli.ts            lệnh pwiki
  config.ts         schema sources.yaml (zod)
  raw.ts            ghi raw/ an toàn (tên file Windows, không ra ngoài raw/, chỉ ghi khi đổi)
  collect.ts        chạy các nguồn, cursor, commit
  ingest.ts         ingest-plan / ingest-done theo git diff
  adapters/         git, jira, files, teams, command (+ types.ts: interface chung)
  tracker/          client (Cognito, REST), sync (pull / outbox / push)
schema/             SCHEMA.md, TRACKER-CONTRACT.md → .pwiki/ của mỗi dự án
templates/project/  file tạo một lần khi init
templates/managed/  slash command, cập nhật bằng upgrade
```

Thêm một loại nguồn mới gồm bốn bước:
1. Viết `src/adapters/<loại>.ts` theo kiểu `Adapter` trong `types.ts`: nhận cấu hình và context (raw store, cursor, env, fetch…), trả về cursor mới.
2. Thêm schema vào `config.ts`.
3. Đăng ký trong `adapters/index.ts`.
4. Viết test.
