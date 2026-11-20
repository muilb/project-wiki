// Builds the vault for a layout: section folders and MOCs, index, guide, overview, Bases dashboard,
// page templates, Obsidian settings, Claude Code permissions and .pwiki/LAYOUT.md.
// Everything except LAYOUT.md is created only when missing: existing notes are never overwritten.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import type { Config } from './config.js';
import { FILE_SECTIONS, Layout, PAGE_SECTIONS, SECTION_INFO, type PageSection } from './layout.js';
import { PWIKI_DIR } from './state.js';

export const PAGES_DIR = 'templates/pages';

const COLORS: Record<PageSection, string> = {
  domain: '4E79A7',
  architecture: 'F28E2B',
  decisions: 'E15759',
  issues: 'B07AA1',
  qa: '76B7B2',
  cycles: '59A14F',
  changes: 'EDC948',
  people: 'FF9DA7',
  glossary: '9C755F',
  howto: 'BAB0AC',
  sources: '86BCB6',
  answers: 'D4A6C8',
  reports: 'A0CBE8',
};

const today = () => new Date().toISOString().slice(0, 10);

function fm(obj: Record<string, unknown>): string {
  return `---\n${stringify(obj, { lineWidth: 0 }).trimEnd()}\n---\n`;
}

export function mocNote(layout: Layout, key: PageSection): string {
  const info = SECTION_INFO[key];
  const trivial =
    key === 'changes'
      ? 'PR / commit vụn (bump dependency, sửa typo, format, merge…): mỗi cái một dòng ở đây, không tạo trang.'
      : 'Những thứ không đáng một trang riêng: mỗi cái một dòng ở đây.';
  return `${fm({ title: info.title, type: 'moc', section: key, updated: today() })}
# ${info.title}

> ${info.desc}. Mục lục do LLM duy trì: mỗi trang một dòng \`link — tóm tắt một dòng\`. Mẫu trang: ${layout.link(layout.moc(key), `${layout.path('templates')}/${info.type}.md`, `${info.type}`)}.

## Trang

## Vụn

<!-- ${trivial} -->
`;
}

export function indexNote(layout: Layout, name: string): string {
  const from = layout.path('index');
  const lines = PAGE_SECTIONS.map((k) => `- ${layout.link(from, layout.moc(k), SECTION_INFO[k].title)} — ${SECTION_INFO[k].desc}`);
  return `${fm({ title: `Mục lục — ${name}`, type: 'index', updated: today() })}
# ${name}

- ${layout.link(from, layout.path('overview'), 'Tổng quan')} — bức tranh dự án hiện tại: mục tiêu, tiến độ, rủi ro, câu hỏi mở
- ${layout.link(from, layout.path('dashboard'), 'Dashboard')} — issue đang mở, câu hỏi còn treo, quyết định (Obsidian Bases)
- ${layout.link(from, `${layout.path('snapshots')}/snapshots.md`, 'Trạng thái hiện tại')} — trang pwiki tự sinh từ tracker, ticket, git, Teams, tài liệu
- ${layout.link(from, layout.path('guide'), 'Cách sử dụng')} — dành cho thành viên mới
- ${layout.link(from, layout.path('log'), 'Nhật ký')} — wiki đã thay đổi gì, khi nào

## Khu vực

${lines.join('\n')}
`;
}

export function overviewNote(name: string): string {
  return `${fm({ title: `Tổng quan ${name}`, type: 'overview', updated: today() })}
# Tổng quan ${name}

(Chưa có dữ liệu — LLM điền sau lượt ingest đầu tiên.)

## Mục tiêu và phạm vi
## Tiến độ hiện tại
## Rủi ro chính
## Câu hỏi mở
`;
}

export function logNote(): string {
  return `${fm({ title: 'Nhật ký wiki', type: 'log' })}
# Nhật ký wiki

Chỉ ghi nối. Mỗi lượt một khối: \`## [YYYY-MM-DD HH:mm] <ingest|lint|ask|weekly|sync-tracker> | tóm tắt\`.
`;
}

export function timelineNote(): string {
  return `${fm({ title: 'Timeline', type: 'timeline', updated: today() })}
# Timeline

| Ngày | Loại | Nội dung | Trạng thái | Nguồn |
|---|---|---|---|---|
`;
}

export function guideNote(layout: Layout, name: string): string {
  const from = layout.path('guide');
  const rows = PAGE_SECTIONS.map((k) => `| ${layout.link(from, layout.moc(k), SECTION_INFO[k].title)} | \`${layout.path(k)}/\` | ${SECTION_INFO[k].desc} |`);
  const linkHint =
    layout.links === 'wikilink'
      ? 'Link giữa các trang dạng `[[…]]`: mở vault bằng **Obsidian** để bấm link, xem graph và dashboard.'
      : 'Link dạng markdown chuẩn: đọc được trong Obsidian, VS Code hay trên GitHub / GitLab.';
  return `${fm({ title: 'Cách sử dụng wiki', type: 'guide', updated: today() })}
# Cách sử dụng wiki ${name}

Wiki này do **Claude Code** biên soạn và cập nhật từ các nguồn của dự án (Teams, ticket, git, tài liệu… — xem \`sources.yaml\`). Con người chọn nguồn, hỏi, và duyệt những gì báo lên project-tracker. ${linkHint}

## Tìm thông tin ở đâu

Bắt đầu từ ${layout.link(from, layout.path('index'), 'Mục lục')} hoặc ${layout.link(from, layout.path('dashboard'), 'Dashboard')}.

| Khu vực | Thư mục | Nội dung |
|---|---|---|
${rows.join('\n')}

Trang trong \`${layout.path('snapshots')}/\` do pwiki **tự sinh** (trạng thái hiện tại của tracker, ticket, git, Teams): không sửa tay, lần chạy sau sẽ ghi đè.

## Hỏi

Mở Claude Code trong thư mục wiki rồi gõ \`/ask <câu hỏi>\`. Câu trả lời có trích dẫn tới trang và nguồn gốc. Hoặc tìm bằng Obsidian (Ctrl+Shift+F).

## Đóng góp

- **Có tài liệu, biên bản họp, ghi chú?** Thả vào \`${layout.path('inbox')}/\`. Lượt ingest sau sẽ đọc và đưa vào đúng trang.
- **Thấy thông tin sai?** Sửa trực tiếp trên trang (ghi nguồn), hoặc báo người phụ trách wiki. Lượt ingest sau sẽ giữ phần bạn sửa nếu có nguồn.
- Trang mới tạo bằng mẫu trong \`${layout.path('templates')}/\` (Obsidian: lệnh *Templates: Insert template*) để frontmatter đúng, dashboard mới đọc được.
- Không sửa \`raw/\` (nguồn gốc, do pwiki ghi) và \`${layout.path('snapshots')}/\`.

## Thuộc tính trang (frontmatter)

| Thuộc tính | Ý nghĩa |
|---|---|
| \`type\` | loại trang: ${PAGE_SECTIONS.map((k) => `\`${layout.type(k)}\``).join(', ')} |
| \`status\` | issue: open / in_progress / resolved / wontfix · decision: proposed / accepted / superseded · qa: open / answered |
| \`priority\`, \`due\`, \`owner\` | mức ưu tiên, hạn, người phụ trách |
| \`tickets\` | mã ticket liên quan |
| \`sources\` | file nguồn trong \`raw/\` mà trang dựa vào |

## Việc định kỳ (người phụ trách wiki)

| Việc | Lệnh |
|---|---|
| Thu thập nguồn | \`pwiki collect\` (hoặc lịch chạy tự động) |
| Biên soạn wiki | \`/ingest\` |
| Duyệt và báo lên tracker | \`/sync-tracker\` |
| Kiểm tra wiki | \`/lint\` |
| Báo cáo tuần | \`/weekly\` |
`;
}

export function dashboardBase(layout: Layout): string {
  const folder = (k: PageSection) => `file.inFolder(${JSON.stringify(layout.path(k))})`;
  const base = {
    properties: {
      status: { displayName: 'Trạng thái' },
      priority: { displayName: 'Ưu tiên' },
      due: { displayName: 'Hạn' },
      owner: { displayName: 'Phụ trách' },
      tickets: { displayName: 'Ticket' },
      updated: { displayName: 'Cập nhật' },
      start: { displayName: 'Bắt đầu' },
      end: { displayName: 'Kết thúc' },
    },
    views: [
      {
        type: 'table',
        name: 'Issue đang mở',
        filters: { and: [folder('issues'), `type == "${layout.type('issues')}"`, 'status != "resolved"', 'status != "wontfix"'] },
        groupBy: { property: 'priority', direction: 'ASC' },
        order: ['file.name', 'status', 'priority', 'due', 'owner', 'tickets', 'updated'],
      },
      {
        type: 'table',
        name: 'Câu hỏi còn mở với khách',
        filters: { and: [folder('qa'), `type == "${layout.type('qa')}"`, 'status == "open"'] },
        order: ['file.name', 'status', 'owner', 'due', 'updated'],
      },
      {
        type: 'table',
        name: 'Quyết định',
        filters: { and: [folder('decisions'), `type == "${layout.type('decisions')}"`] },
        groupBy: { property: 'status', direction: 'ASC' },
        order: ['file.name', 'status', 'tickets', 'updated'],
      },
      {
        type: 'table',
        name: 'Chu kỳ & mốc',
        filters: { and: [folder('cycles'), `type == "${layout.type('cycles')}"`] },
        order: ['file.name', 'status', 'start', 'end', 'updated'],
      },
    ],
  };
  return `# Dashboard do pwiki tạo (Obsidian Bases). Sửa thoải mái trong Obsidian.\n${stringify(base, { lineWidth: 0 })}`;
}

export function layoutDoc(layout: Layout): string {
  const L = layout;
  const ex = L.links === 'wikilink' ? '`[[30_Decisions/emv-timeout]]` hoặc `[[30_Decisions/emv-timeout|tên hiển thị]]`' : '`[tên](../30_Decisions/emv-timeout.md)`';
  const sectionRows = PAGE_SECTIONS.map(
    (k) => `| ${k} | \`${L.path(k)}/\` | \`${L.moc(k)}\` | \`${L.type(k)}\` | \`${L.path('templates')}/${SECTION_INFO[k].type}.md\` | ${SECTION_INFO[k].desc} |`,
  );
  return `# Bố cục vault của dự án

File này do pwiki sinh từ mục \`layout\` trong \`sources.yaml\`. Muốn đổi thì sửa \`sources.yaml\` rồi chạy \`pwiki upgrade\`; đừng sửa tay. Mọi chỗ trong SCHEMA nói tới một khu vực (decisions, issues…) đều là đường dẫn trong bảng dưới.

## Link

- Kiểu link của dự án: **${L.links}**. Ví dụ (thay đường dẫn cho đúng): ${ex}.
${L.links === 'wikilink' ? '- Luôn ghi **đường dẫn đầy đủ từ gốc vault, không có `.md`** (kể cả khi tên file là duy nhất), để key trang không đổi nghĩa.\n- File không phải markdown giữ phần mở rộng: `[[' + L.path('dashboard') + ']]`.' : '- Đường dẫn tương đối tính từ thư mục của trang đang viết; có dấu cách thì mã hoá thành `%20`.'}
- Trích dẫn nguồn raw luôn dùng link markdown tương đối tới \`raw/…\`, kèm vị trí (\`msg:…\`, sheet, mục).

## File chính

| | Đường dẫn | Ai ghi |
|---|---|---|
| Mục lục | \`${L.path('index')}\` | LLM: chỉ trỏ tới tổng quan, dashboard, trạng thái hiện tại và các MOC |
| Tổng quan | \`${L.path('overview')}\` | LLM |
| Cách sử dụng | \`${L.path('guide')}\` | con người (LLM chỉ sửa khi được yêu cầu) |
| Dashboard | \`${L.path('dashboard')}\` | con người (Obsidian Bases) |
| Nhật ký | \`${L.path('log')}\` | LLM: chỉ ghi nối (SCHEMA mục 9) |
| Timeline | \`${L.path('cycles')}/timeline.md\` | LLM |

## Khu vực

Mỗi khu vực có một **MOC** (mục lục khu vực). Trang mới phải được thêm vào MOC của khu vực đó.

| Khu vực | Thư mục | MOC | \`type\` | Mẫu trang | Nội dung |
|---|---|---|---|---|---|
${sectionRows.join('\n')}

## Thư mục hỗ trợ

| | Đường dẫn | Quy tắc |
|---|---|---|
| inbox | \`${L.path('inbox')}/\` | con người thả tài liệu / ghi chú vào. LLM đọc bản trong \`raw/\` (nếu có nguồn files trỏ tới đây), không sửa / xoá file trong inbox |
| templates | \`${L.path('templates')}/\` | mẫu trang theo \`type\`. Dùng khi tạo trang mới; thay \`{{title}}\`, \`{{date}}\` |
| attachments | \`${L.path('attachments')}/\` | ảnh, file đính kèm |
| snapshots | \`${L.path('snapshots')}/\` | **pwiki sinh tự động — không sửa**. Đọc để biết trạng thái hiện tại |

## Không phải wiki

\`raw/\` (chỉ pwiki ghi), \`tracker/\` (chỉ ghi vào \`tracker/outbox/\`), \`.pwiki/\`, \`.claude/\`, \`.obsidian/\`${L.cfg.ignore.length ? `, và: ${L.cfg.ignore.map((x) => `\`${x}\``).join(', ')}` : ''}.
`;
}

function claudeSettings(layout: Layout): string {
  const snap = layout.path('snapshots');
  return `${JSON.stringify(
    {
      permissions: {
        allow: [
          'Bash(pwiki collect:*)',
          'Bash(pwiki status:*)',
          'Bash(pwiki ingest-plan:*)',
          'Bash(pwiki ingest-done:*)',
          'Bash(pwiki snapshot:*)',
          'Bash(pwiki lint:*)',
          'Bash(pwiki tracker pull:*)',
          'Bash(pwiki tracker outbox:*)',
          'Bash(pwiki tracker push --dry-run:*)',
          'Bash(git status:*)',
          'Bash(git diff:*)',
          'Bash(git log:*)',
          'Bash(git show:*)',
          'Bash(git ls-files:*)',
          'Bash(git add:*)',
          'Bash(git commit:*)',
        ],
        ask: ['Bash(pwiki tracker push)', 'Bash(pwiki tracker push:*)'],
        deny: [
          'Edit(/raw/**)',
          'Write(/raw/**)',
          `Edit(/${snap}/**)`,
          `Write(/${snap}/**)`,
          'Edit(/.pwiki/state.json)',
          'Edit(/tracker/state.json)',
          'Edit(/tracker/map.json)',
          'Edit(/tracker/sent/**)',
          'Read(/.env)',
          'Read(/.pwiki/tracker-session.json)',
          'Read(/.pwiki/teams-profile/**)',
        ],
      },
    },
    null,
    2,
  )}\n`;
}

function readJson(p: string): Record<string, any> {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** .obsidian/: hides non-wiki folders, sets link style, templates folder, graph colors. Merges with what exists. */
export function obsidianSettings(root: string, layout: Layout): string[] {
  const dir = join(root, '.obsidian');
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const appPath = join(dir, 'app.json');
  const app = readJson(appPath);
  const before = JSON.stringify(app);
  const ignore = new Set<string>(Array.isArray(app.userIgnoreFilters) ? app.userIgnoreFilters : []);
  for (const p of ['raw/', 'tracker/', 'node_modules/', 'scripts/', ...layout.cfg.ignore]) ignore.add(p);
  app.userIgnoreFilters = [...ignore];
  app.attachmentFolderPath ??= layout.path('attachments');
  app.useMarkdownLinks ??= layout.links === 'markdown';
  app.newLinkFormat ??= layout.links === 'markdown' ? 'relative' : 'absolute';
  app.alwaysUpdateLinks ??= true;
  if (JSON.stringify(app) !== before) {
    writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);
    written.push('.obsidian/app.json');
  }
  const graphPath = join(dir, 'graph.json');
  if (!existsSync(graphPath)) {
    const graph = {
      search: `-path:"${layout.path('snapshots')}/" -path:"${layout.path('templates')}/" -path:"${layout.path('index')}" -path:"${layout.path('log')}"`,
      showTags: false,
      showAttachments: false,
      hideUnresolved: false,
      showOrphans: true,
      colorGroups: PAGE_SECTIONS.map((k) => ({ query: `path:"${layout.path(k)}/"`, color: { a: 1, rgb: parseInt(COLORS[k], 16) } })),
    };
    writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
    written.push('.obsidian/graph.json');
  }
  const tplPath = join(dir, 'templates.json');
  if (!existsSync(tplPath)) {
    writeFileSync(tplPath, `${JSON.stringify({ folder: layout.path('templates'), dateFormat: 'YYYY-MM-DD' }, null, 2)}\n`);
    written.push('.obsidian/templates.json');
  }
  return written;
}

/** Creates what the layout needs and is missing. Returns the paths written. */
export function ensureStructure(root: string, config: Config, pkgRoot: string, opts: { obsidian?: boolean } = {}): string[] {
  const layout = new Layout(config.layout);
  const name = config.project.name;
  const written: string[] = [];
  const put = (rel: string, text: string) => {
    const p = join(root, ...rel.split('/'));
    if (existsSync(p)) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, 'utf8');
    written.push(rel);
  };
  for (const k of PAGE_SECTIONS) put(layout.moc(k), mocNote(layout, k));
  put(layout.path('index'), indexNote(layout, name));
  put(layout.path('overview'), overviewNote(name));
  put(layout.path('guide'), guideNote(layout, name));
  put(layout.path('dashboard'), dashboardBase(layout));
  put(layout.path('log'), logNote());
  put(`${layout.path('cycles')}/timeline.md`, timelineNote());
  put(`${layout.path('snapshots')}/snapshots.md`, `${fm({ title: 'Trạng thái hiện tại', type: 'snapshot', generated: 'pwiki' })}\n# Trạng thái hiện tại\n\n> Trang do \`pwiki snapshot\` sinh tự động — chạy \`pwiki collect\` hoặc \`pwiki snapshot\` để có dữ liệu.\n`);
  put(`${layout.path('inbox')}/.gitkeep`, '');
  put(`${layout.path('attachments')}/.gitkeep`, '');
  const pages = join(pkgRoot, PAGES_DIR);
  const overrides = new Map(PAGE_SECTIONS.map((k) => [SECTION_INFO[k].type, layout.type(k)]));
  for (const f of readdirSync(pages)) {
    const text = readFileSync(join(pages, f), 'utf8').replace(/^type: (\S+)$/m, (_m, t: string) => `type: ${overrides.get(t) ?? t}`);
    put(`${layout.path('templates')}/${f}`, text);
  }
  put('.claude/settings.json', claudeSettings(layout));
  if (opts.obsidian !== false) written.push(...obsidianSettings(root, layout));
  // Always regenerated: it describes the current layout.
  const doc = join(root, PWIKI_DIR, 'LAYOUT.md');
  const text = layoutDoc(layout);
  if (!existsSync(doc) || readFileSync(doc, 'utf8') !== text) {
    mkdirSync(dirname(doc), { recursive: true });
    writeFileSync(doc, text, 'utf8');
    written.push('.pwiki/LAYOUT.md');
  }
  return written;
}

export { FILE_SECTIONS };
