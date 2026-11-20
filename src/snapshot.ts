// pwiki snapshot: "what is true right now" pages, generated from raw/ and tracker/ without an LLM.
// Cheap, always fresh, never edited by hand. The LLM reads them; it writes the synthesis elsewhere.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { Config, SourceConfig } from './config.js';
import { Layout } from './layout.js';
import { parseDoc, RAW_DIR, RawStore, renderDoc } from './raw.js';
import { describe, loadMap, readOutbox } from './tracker/sync.js';
import { cell, dayIn, daysAgo } from './util.js';

const HEALTH: Record<string, string> = { green: '🟢 xanh', yellow: '🟡 vàng', red: '🔴 đỏ' };
const PRIORITY_RANK = ['highest', 'blocker', 'critical', 'high', '高', 'medium', '中', 'low', '低', 'lowest', 'trivial'];
const rank = (p: unknown) => {
  const i = PRIORITY_RANK.indexOf(String(p ?? '').toLowerCase());
  return i < 0 ? 50 : i;
};

interface Page {
  file: string; // vault path
  title: string;
  body: string;
}

/** Link from a snapshot page to a raw file: always a relative markdown link. */
const rawLink = (from: string, rawPath: string, text: string) => `[${text.replace(/[[\]]/g, '')}](${encodeURI(posix.relative(posix.dirname(from), rawPath))})`;

function table(head: string[], rows: string[][]): string {
  if (!rows.length) return '_(không có)_';
  return [`| ${head.join(' | ')} |`, `|${' --- |'.repeat(head.length)}`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function trackerPage(root: string, layout: Layout, file: string): Page | undefined {
  const p = join(root, 'tracker', 'state.json');
  if (!existsSync(p)) return undefined;
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const pj = s.project ?? {};
  const byId = new Map(Object.entries(loadMap(root).items).map(([k, id]) => [id, k]));
  const wiki = (id: string) => {
    const key = byId.get(id);
    if (!key) return '';
    return existsSync(join(root, ...`${key}.md`.split('/'))) ? layout.link(file, `${key}.md`, posix.basename(key)) : `\`${key}\` (chưa có trang)`;
  };
  const open = (s.items ?? []).filter((i: any) => i.status !== 'done' && i.status !== 'postponed');
  open.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
  const lines = [
    `Dự án **${cell(pj.name ?? '')}** (\`${cell(pj.id ?? '')}\`) — dữ liệu kéo về lúc ${s.pulledAt ?? '?'} (\`pwiki tracker pull\`).`,
    '',
    table(
      ['Màu tổng hợp', 'PL khai', 'PMO', 'Khẩn', 'Trễ cập nhật', 'Hạn cập nhật', 'Issue mở / cao', 'Quá hạn'],
      [
        [
          HEALTH[pj.health] ?? cell(pj.health),
          HEALTH[pj.declaredHealth] ?? '-',
          HEALTH[pj.pmoHealth] ?? '-',
          cell(pj.urgency ?? '-'),
          pj.lateHours ? `⚠️ ${pj.lateHours}h` : 'không',
          cell(pj.dueAt ?? '-'),
          `${pj.openIssues ?? '?'} / ${pj.highIssues ?? '?'}`,
          String(pj.overdueItems ?? '?'),
        ],
      ],
    ),
    '',
    '## Mục đang mở',
    '',
    table(
      ['ID', 'Loại', 'Tiêu đề', 'Ưu tiên', 'Ngày', 'Trạng thái', 'Trang wiki'],
      open.map((i: any) => [i.id, i.type, cell(i.title), i.priority, `${i.date}${i.overdue ? ' ⚠️' : ''}`, i.status, wiki(i.id)]),
    ),
    '',
    '## Cập nhật gần nhất',
    '',
    table(
      ['Lúc', 'Màu', 'Tóm tắt'],
      (s.updates ?? []).slice(0, 5).map((u: any) => [cell(u.at), HEALTH[u.health] ?? '-', cell(String(u.summary ?? '').split('\n')[0]!.slice(0, 160))]),
    ),
    '',
    '## Đề xuất trong outbox',
    '',
    table(
      ['File', 'Nội dung', 'Đã duyệt'],
      readOutbox(root).map((e) => [`\`${e.file}\``, e.proposal ? cell(describe(e.proposal)) : `lỗi: ${cell(e.error)}`, e.proposal?.approved ? '✔' : '']),
    ),
  ];
  return { file, title: 'Tracker', body: lines.join('\n') };
}

function jiraPage(raw: RawStore, file: string, today: string, now: Date): Page {
  const docs = raw.list().map((r) => ({ r, d: raw.read(r)! }));
  const issues = docs.map(({ r, d }) => ({ rel: `${RAW_DIR}/${raw.source}/${r}`, fm: d.frontmatter as Record<string, any>, title: /^# \S+ (.*)$/m.exec(d.body)?.[1] ?? '' }));
  const isDone = (f: Record<string, any>) => f.statusCategory === 'done' || (!f.statusCategory && !!f.resolution);
  const open = issues.filter((i) => !isDone(i.fm)).sort((a, b) => rank(a.fm.priority) - rank(b.fm.priority) || String(a.fm.due ?? '9999').localeCompare(String(b.fm.due ?? '9999')));
  const weekAgo = daysAgo(now, 7).getTime();
  const done = issues.filter((i) => isDone(i.fm) && Date.parse(String(i.fm.updated ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) >= weekAgo);
  const counts = new Map<string, number>();
  for (const i of open) counts.set(String(i.fm.status), (counts.get(String(i.fm.status)) ?? 0) + 1);
  const row = (i: (typeof issues)[number]) => [
    rawLink(file, i.rel, String(i.fm.key)),
    cell(i.title),
    cell(i.fm.type),
    cell(i.fm.status),
    cell(i.fm.priority),
    cell(i.fm.assignee ?? ''),
    i.fm.due ? `${i.fm.due}${String(i.fm.due) < today ? ' ⚠️' : ''}` : '',
  ];
  return {
    file,
    title: `Ticket — ${raw.source}`,
    body: [
      `${issues.length} ticket đã thu thập; **${open.length} đang mở** (${[...counts].map(([k, v]) => `${k}: ${v}`).join(', ') || '-'}). ⚠️ = quá hạn.`,
      '',
      '## Đang mở',
      '',
      table(['Ticket', 'Tóm tắt', 'Loại', 'Trạng thái', 'Ưu tiên', 'Phụ trách', 'Hạn'], open.slice(0, 200).map(row)),
      open.length > 200 ? `\n… và ${open.length - 200} ticket khác` : '',
      '',
      '## Xong trong 7 ngày',
      '',
      table(['Ticket', 'Tóm tắt', 'Loại', 'Trạng thái', 'Ưu tiên', 'Phụ trách', 'Hạn'], done.map(row)),
    ].join('\n'),
  };
}

function gitPage(raw: RawStore, file: string, now: Date, tz: string): Page {
  const since = dayIn(tz, daysAgo(now, 14));
  const days = raw
    .list()
    .filter((r) => /^commits\/\d{4}-\d{2}-\d{2}\.md$/.test(r) && r.slice(8, 18) >= since)
    .sort()
    .reverse();
  const tickets = new Map<string, { n: number; last: string }>();
  const rows = days.map((r) => {
    const body = raw.read(r)!.body;
    const n = (body.match(/<!-- commit:/g) ?? []).length;
    const authors = new Map<string, number>();
    for (const m of body.matchAll(/^### \d\d:\d\d \S+ — (.+?)(?: \(merge\))?$/gm)) authors.set(m[1]!, (authors.get(m[1]!) ?? 0) + 1);
    const day = r.slice(8, 18);
    const found = new Set<string>();
    for (const m of body.matchAll(/^Ticket: (.+)$/gm)) for (const t of m[1]!.split(', ')) found.add(t);
    for (const t of found) {
      const x = tickets.get(t) ?? { n: 0, last: day };
      tickets.set(t, { n: x.n + 1, last: x.last > day ? x.last : day });
    }
    return [rawLink(file, `${RAW_DIR}/${raw.source}/${r}`, day), String(n), cell([...authors].map(([a, c]) => `${a} (${c})`).join(', ')), cell([...found].join(', '))];
  });
  return {
    file,
    title: `Git — ${raw.source}`,
    body: [
      `Commit 14 ngày gần nhất (từ ${since}).`,
      '',
      table(['Ngày', 'Commit', 'Tác giả', 'Ticket'], rows),
      '',
      '## Ticket được nhắc tới trong commit',
      '',
      table(
        ['Ticket', 'Số ngày có commit', 'Gần nhất'],
        [...tickets].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([t, x]) => [t, String(x.n), x.last]),
      ),
    ].join('\n'),
  };
}

function teamsPage(raw: RawStore, file: string, now: Date, tz: string): Page {
  const since = dayIn(tz, daysAgo(now, 7));
  const convs = new Map<string, string[]>();
  for (const r of raw.list()) {
    const m = /^(.+)\/(\d{4}-\d{2}-\d{2})\.md$/.exec(r);
    if (m) convs.set(m[1]!, [...(convs.get(m[1]!) ?? []), r]);
  }
  const rows = [...convs].map(([conv, files]) => {
    files.sort();
    const recent = files.filter((f) => f.slice(-13, -3) >= since);
    const authors = new Map<string, number>();
    let n = 0;
    let name = conv;
    for (const f of recent) {
      const d = raw.read(f)!;
      name = String(d.frontmatter.conversation ?? conv);
      for (const m of d.body.matchAll(/^\*\*\d\d:\d\d (.+?)\*\*/gm)) {
        n++;
        authors.set(m[1]!, (authors.get(m[1]!) ?? 0) + 1);
      }
    }
    const last = files.at(-1)!;
    const top = [...authors].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return [cell(name), String(n), cell(top.map(([a, c]) => `${a} (${c})`).join(', ')), rawLink(file, `${RAW_DIR}/${raw.source}/${last}`, last.slice(-13, -3))];
  });
  return { file, title: `Teams — ${raw.source}`, body: [`Hoạt động 7 ngày gần nhất (từ ${since}).`, '', table(['Kênh / chat', 'Tin nhắn', 'Gửi nhiều nhất', 'Ngày gần nhất'], rows)].join('\n') };
}

function filesPage(raw: RawStore, file: string): Page {
  const docs = raw
    .list()
    .map((r) => ({ r, fm: raw.read(r)!.frontmatter as Record<string, any> }))
    .sort((a, b) => String(b.fm.modified ?? '').localeCompare(String(a.fm.modified ?? '')));
  return {
    file,
    title: `Tài liệu — ${raw.source}`,
    body: [
      `${docs.length} tài liệu, mới sửa gần nhất trước.`,
      '',
      table(
        ['Tài liệu', 'Sửa lần cuối', 'Kích thước'],
        docs.slice(0, 100).map((d) => [rawLink(file, `${RAW_DIR}/${raw.source}/${d.r}`, String(d.fm.path ?? d.r)), cell(String(d.fm.modified ?? '').slice(0, 10)), d.fm.size ? `${Math.max(1, Math.round(Number(d.fm.size) / 1024))} KB` : '']),
      ),
    ].join('\n'),
  };
}

function genericPage(raw: RawStore, file: string): Page {
  const docs = raw.list();
  return {
    file,
    title: `Nguồn — ${raw.source}`,
    body: [
      `${docs.length} tài liệu.`,
      '',
      table(
        ['Tài liệu', 'Trạng thái'],
        docs.slice(0, 200).map((r) => {
          const fm = raw.read(r)!.frontmatter as Record<string, any>;
          return [rawLink(file, `${RAW_DIR}/${raw.source}/${r}`, r), cell(fm.status ?? '')];
        }),
      ),
    ].join('\n'),
  };
}

function sourcePage(root: string, src: SourceConfig, dir: string, now: Date, tz: string): Page {
  const raw = new RawStore(root, src.name);
  const file = `${dir}/${src.name}.md`;
  switch (src.type) {
    case 'jira':
      return jiraPage(raw, file, dayIn(tz, now), now);
    case 'git':
      return gitPage(raw, file, now, tz);
    case 'teams':
      return teamsPage(raw, file, now, tz);
    case 'files':
      return filesPage(raw, file);
    default:
      return genericPage(raw, file);
  }
}

const NOTICE = '> Trang do `pwiki snapshot` sinh tự động — không sửa tay, lần chạy sau sẽ ghi đè.';

/** Writes the snapshot pages that changed; removes those of sources that no longer exist. */
export function snapshot(root: string, config: Config, now = new Date()): string[] {
  const layout = new Layout(config.layout);
  const dir = layout.path('snapshots');
  const tz = config.project.timezone;
  const pages: Page[] = [];
  const t = trackerPage(root, layout, `${dir}/tracker.md`);
  if (t) pages.push(t);
  for (const s of config.sources) if (existsSync(join(root, RAW_DIR, s.name))) pages.push(sourcePage(root, s, dir, now, tz));
  const hubFile = `${dir}/snapshots.md`;
  pages.push({
    file: hubFile,
    title: 'Trạng thái hiện tại',
    body: [
      'Các trang dưới đây do pwiki sinh từ `raw/` và `tracker/` sau mỗi lần thu thập — dùng để biết **bây giờ** đang thế nào. Tri thức đã biên soạn nằm ở các khu vực khác của wiki.',
      '',
      ...pages.map((p) => `- ${layout.link(hubFile, p.file, p.title)}`),
    ].join('\n'),
  });

  const written: string[] = [];
  const keep = new Set(pages.map((p) => p.file));
  for (const p of pages) {
    const abs = join(root, ...p.file.split('/'));
    const body = `# ${p.title}\n\n${NOTICE}\n\n${p.body}`;
    if (existsSync(abs) && parseDoc(readFileSync(abs, 'utf8')).body === body.trimEnd()) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, renderDoc({ frontmatter: { title: p.title, type: 'snapshot', generated: 'pwiki', updated: now.toISOString() }, body }), 'utf8');
    written.push(p.file);
  }
  const absDir = join(root, ...dir.split('/'));
  if (existsSync(absDir))
    for (const f of readdirSync(absDir))
      if (f.endsWith('.md') && !keep.has(`${dir}/${f}`)) {
        rmSync(join(absDir, f));
        written.push(`${dir}/${f}`);
      }
  return written;
}

