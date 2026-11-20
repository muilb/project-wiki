// pwiki lint: the mechanical half of /lint, computed from files (exact and cheap). Claude does the
// semantic half (contradictions across sources, stale content) using this report as a starting point.
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { Config } from './config.js';
import { FILE_SECTIONS, Layout, PAGE_SECTIONS, SECTION_INFO, type PageSection } from './layout.js';
import { parseDoc } from './raw.js';
import { dayIn, daysAgo } from './util.js';

export interface LintIssue {
  check: 'broken-link' | 'ambiguous-link' | 'orphan' | 'not-in-moc' | 'tree-only' | 'frontmatter' | 'missing-raw' | 'stray' | 'stale';
  file: string;
  detail: string;
}

export interface LintReport {
  pages: number;
  links: number;
  issues: LintIssue[];
}

export const CHECK_TITLES: Record<LintIssue['check'], string> = {
  'broken-link': 'Link hỏng',
  'ambiguous-link': 'Link không rõ trỏ tới trang nào (trùng tên file)',
  'missing-raw': 'Trích dẫn tới file raw không còn',
  orphan: 'Trang mồ côi (không trang nào link tới)',
  'not-in-moc': 'Trang chưa có trong MOC của khu vực',
  'tree-only': 'Trang chỉ nối với MOC (không liên kết chéo)',
  frontmatter: 'Frontmatter thiếu / sai',
  stray: 'File nằm ngoài các khu vực của bố cục',
  stale: 'Mở quá lâu không cập nhật',
};

const WIKILINK = /!?\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MDLINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
const OPEN_STATUS: Partial<Record<PageSection, string[]>> = { issues: ['open', 'in_progress'], qa: ['open'], decisions: ['proposed'] };

function listVault(root: string): string[] {
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((d) => d.isFile())
    .map((d) => relative(root, join(d.parentPath, d.name)).split(sep).join('/'))
    .filter((p) => !p.split('/').some((seg) => seg.startsWith('.') && seg !== '.gitkeep'));
}

export function extractLinks(text: string): string[] {
  const t = text.replace(CODE, '');
  const out: string[] = [];
  for (const m of t.matchAll(WIKILINK)) if (m[1]!.trim()) out.push(`[[${m[1]!.trim()}`);
  for (const m of t.matchAll(MDLINK)) {
    const href = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    out.push(href.split('#')[0]!);
  }
  return out.filter((l) => l !== '' && l !== '[[');
}

export function lint(root: string, config: Config, now = new Date(), staleDays = 14): LintReport {
  const layout = new Layout(config.layout);
  const all = listVault(root);
  const allSet = new Set(all);
  const byBase = new Map<string, string[]>();
  for (const f of all) {
    const b = posix.basename(f).replace(/\.md$/, '').toLowerCase();
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  const wiki = all.filter((f) => f.endsWith('.md') && layout.isWikiFile(f));
  const mocs = layout.mocs();
  const special = new Set<string>([...FILE_SECTIONS.map((k) => layout.path(k)), ...mocs.keys(), `${layout.path('cycles')}/timeline.md`]);
  const snapDir = `${layout.path('snapshots')}/`;
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  const issues: LintIssue[] = [];
  let links = 0;

  const resolve = (from: string, link: string): { target?: string; ambiguous?: string[] } => {
    if (link.startsWith('[[')) {
      const t = decodeURIComponent(link.slice(2)).replace(/^\//, '');
      for (const c of [t, `${t}.md`]) if (allSet.has(c)) return { target: c };
      const cands = byBase.get(posix.basename(t).replace(/\.md$/, '').toLowerCase()) ?? [];
      const exact = cands.filter((c) => (t.includes('.') && !t.endsWith('.md') ? posix.basename(c) === posix.basename(t) : c.endsWith('.md')));
      // A bare name matching several files: Obsidian picks one, but the page key is unclear (LAYOUT asks for full paths).
      if (!t.includes('/') && exact.length > 1) return { ambiguous: exact };
      const rel = posix.normalize(posix.join(posix.dirname(from), t));
      for (const c of [rel, `${rel}.md`]) if (allSet.has(c)) return { target: c };
      if (exact.length === 1) return { target: exact[0] };
      if (exact.length > 1) return { ambiguous: exact };
      return {};
    }
    let href: string;
    try {
      href = decodeURIComponent(link);
    } catch {
      href = link;
    }
    const p = posix.normalize(posix.join(posix.dirname(from), href));
    return allSet.has(p) ? { target: p } : {};
  };

  for (const f of wiki) {
    const text = readFileSync(join(root, ...f.split('/')), 'utf8');
    const doc = parseDoc(text);
    for (const l of extractLinks(doc.body)) {
      links++;
      const r = resolve(f, l);
      const shown = l.startsWith('[[') ? `${l}]]` : l;
      if (r.ambiguous) {
        issues.push({ check: 'ambiguous-link', file: f, detail: `${shown} → ${r.ambiguous.join(', ')}` });
        continue;
      }
      if (!r.target) {
        const isRaw = /(^|\/)raw\//.test(l.replace(/^\[\[/, ''));
        issues.push({ check: isRaw ? 'missing-raw' : 'broken-link', file: f, detail: shown });
        continue;
      }
      if (r.target === f) continue;
      if (!outbound.has(f)) outbound.set(f, new Set());
      outbound.get(f)!.add(r.target);
      if (!inbound.has(r.target)) inbound.set(r.target, new Set());
      inbound.get(r.target)!.add(f);
    }

    if (special.has(f) || f.startsWith(snapDir)) continue;
    const sec = layout.sectionOf(f);
    if (!sec || !(PAGE_SECTIONS as string[]).includes(sec)) {
      issues.push({ check: 'stray', file: f, detail: 'không thuộc khu vực nào (chuyển vào khu vực phù hợp, hoặc thêm vào layout.ignore)' });
      continue;
    }
    const info = SECTION_INFO[sec as PageSection];
    const type = layout.type(sec as PageSection);
    const fmv = doc.frontmatter as Record<string, any>;
    if (!fmv.type) issues.push({ check: 'frontmatter', file: f, detail: `thiếu type (khu vực này: ${type})` });
    else if (fmv.type !== type) issues.push({ check: 'frontmatter', file: f, detail: `type "${fmv.type}" nhưng nằm trong khu vực ${sec} (${type})` });
    if (info.needsSources && (!Array.isArray(fmv.sources) || fmv.sources.length === 0)) issues.push({ check: 'frontmatter', file: f, detail: 'chưa có sources' });
    for (const s of Array.isArray(fmv.sources) ? fmv.sources : []) {
      const p = String(s).split(/[#\s]/)[0]!;
      if (p.startsWith('raw/') && !allSet.has(p)) issues.push({ check: 'missing-raw', file: f, detail: `sources: ${p}` });
    }
    const open = OPEN_STATUS[sec as PageSection];
    const updated = fmv.updated instanceof Date ? dayIn('UTC', fmv.updated) : String(fmv.updated ?? '');
    if (open?.includes(String(fmv.status)) && /^\d{4}-\d{2}-\d{2}/.test(updated) && updated.slice(0, 10) < dayIn(config.project.timezone, daysAgo(now, staleDays)))
      issues.push({ check: 'stale', file: f, detail: `${fmv.status} từ ${updated.slice(0, 10)} (> ${staleDays} ngày không cập nhật)` });
  }

  // Graph checks need every link first.
  for (const f of wiki) {
    if (special.has(f) || f.startsWith(snapDir)) continue;
    const sec = layout.sectionOf(f);
    if (!sec || !(PAGE_SECTIONS as string[]).includes(sec)) continue;
    const moc = layout.moc(sec as PageSection);
    const from = [...(inbound.get(f) ?? [])].filter((x) => !x.startsWith(snapDir));
    if (!from.length) {
      issues.push({ check: 'orphan', file: f, detail: `thêm vào ${moc} và link từ các trang liên quan` });
      continue;
    }
    if (existsSync(join(root, ...moc.split('/'))) && !from.includes(moc)) issues.push({ check: 'not-in-moc', file: f, detail: moc });
    const peersIn = from.filter((x) => !special.has(x));
    const peersOut = [...(outbound.get(f) ?? [])].filter((x) => !special.has(x) && !x.startsWith(snapDir) && layout.isWikiFile(x));
    if (!peersIn.length && !peersOut.length) issues.push({ check: 'tree-only', file: f, detail: 'chỉ có link từ MOC / mục lục: nối với decision, issue, spec, người… liên quan' });
  }

  // Non-markdown clutter at the wiki root (e.g. "Untitled.base", a stray canvas).
  const wikiRoot = posix.dirname(layout.path('index'));
  for (const f of all) {
    if (posix.dirname(f) !== wikiRoot || f.endsWith('.md') || !layout.isWikiFile(f)) continue;
    if (f === layout.path('dashboard') || f === '.gitkeep') continue;
    if (/\.(base|canvas)$/.test(f)) issues.push({ check: 'stray', file: f, detail: 'file Bases / Canvas ở gốc: đặt tên rõ và chuyển vào khu vực phù hợp, hoặc xoá' });
  }
  return { pages: wiki.length, links, issues };
}

export function formatLint(r: LintReport): string {
  const lines = [`${r.pages} trang, ${r.links} link, ${r.issues.length} vấn đề.`];
  for (const check of Object.keys(CHECK_TITLES) as LintIssue['check'][]) {
    const list = r.issues.filter((i) => i.check === check);
    if (!list.length) continue;
    lines.push('', `## ${CHECK_TITLES[check]} (${list.length})`, ...list.map((i) => `- ${i.file}: ${i.detail}`));
  }
  return lines.join('\n');
}
