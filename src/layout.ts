// Where each kind of page lives in the vault. Code and schema speak of logical sections ("decisions",
// "issues"…); the layout maps them to real paths, so a project can keep its own folder names
// (e.g. an existing vault with 70_PR instead of 70_Changes).
import { posix } from 'node:path';

export type FileSection = 'index' | 'guide' | 'overview' | 'dashboard' | 'log';
export type PageSection =
  | 'domain'
  | 'architecture'
  | 'decisions'
  | 'issues'
  | 'qa'
  | 'cycles'
  | 'changes'
  | 'people'
  | 'glossary'
  | 'howto'
  | 'sources'
  | 'answers'
  | 'reports';
export type SupportSection = 'inbox' | 'templates' | 'attachments' | 'snapshots';
export type SectionKey = FileSection | PageSection | SupportSection;

export const FILE_SECTIONS: FileSection[] = ['index', 'guide', 'overview', 'dashboard', 'log'];
export const PAGE_SECTIONS: PageSection[] = [
  'domain',
  'architecture',
  'decisions',
  'issues',
  'qa',
  'cycles',
  'changes',
  'people',
  'glossary',
  'howto',
  'sources',
  'answers',
  'reports',
];
export const SUPPORT_SECTIONS: SupportSection[] = ['inbox', 'templates', 'attachments', 'snapshots'];
export const ALL_SECTIONS: SectionKey[] = [...FILE_SECTIONS, ...PAGE_SECTIONS, ...SUPPORT_SECTIONS];

/** What each page section holds; `type` is the frontmatter type of its pages. */
export const SECTION_INFO: Record<PageSection, { title: string; type: string; desc: string; needsSources: boolean }> = {
  domain: { title: 'Nghiệp vụ & spec', type: 'spec', desc: 'spec theo chức năng / màn hình / API / batch, quy tắc nghiệp vụ', needsSources: true },
  architecture: { title: 'Kiến trúc', type: 'topic', desc: 'kiến trúc, module, hệ thống liên quan, môi trường, hạ tầng', needsSources: true },
  decisions: { title: 'Quyết định', type: 'decision', desc: 'mỗi quyết định một trang (kiểu ADR): bối cảnh, lựa chọn, lý do, hệ quả', needsSources: true },
  issues: { title: 'Vấn đề & rủi ro', type: 'issue', desc: 'vấn đề, rủi ro, blocker, bug quan trọng', needsSources: true },
  qa: { title: 'Hỏi đáp với khách hàng', type: 'qa', desc: 'câu hỏi gửi khách (質問票) và câu trả lời, câu hỏi còn mở', needsSources: true },
  cycles: { title: 'Chu kỳ & mốc', type: 'cycle', desc: 'sprint / cycle / phase, timeline, mốc và deadline', needsSources: false },
  changes: { title: 'Thay đổi code', type: 'change', desc: 'PR / nhóm commit có ý nghĩa, gom theo chủ đề; PR vụn chỉ một dòng trong MOC', needsSources: true },
  people: { title: 'Người & team', type: 'person', desc: 'người liên quan, vai trò, phụ trách gì, tên ở từng nguồn', needsSources: false },
  glossary: { title: 'Thuật ngữ', type: 'term', desc: 'mỗi thuật ngữ một trang ngắn (tiếng Nhật ↔ tiếng Việt ↔ nghĩa trong dự án)', needsSources: false },
  howto: { title: 'Hướng dẫn', type: 'howto', desc: 'cách làm: build, deploy, chạy test, xử lý sự cố thường gặp', needsSources: false },
  sources: { title: 'Nguồn tài liệu', type: 'source', desc: 'tóm tắt từng tài liệu / nguồn quan trọng (設計書, biên bản…), trỏ về raw', needsSources: true },
  answers: { title: 'Câu trả lời đã lưu', type: 'answer', desc: 'phân tích / tổng hợp đáng giữ từ /ask', needsSources: false },
  reports: { title: 'Báo cáo', type: 'report', desc: 'báo cáo tuần, kết quả lint', needsSources: false },
};

export type Preset = 'numbered' | 'flat';
export type LinkStyle = 'wikilink' | 'markdown';
export type MocPlacement = 'inside' | 'beside';

export const PRESETS: Record<Preset, Record<SectionKey, string>> = {
  numbered: {
    index: '00_Index.md',
    guide: '01_Cach_su_dung.md',
    overview: '02_Tong_quan.md',
    dashboard: '03_Dashboard.base',
    log: '04_Nhat_ky.md',
    domain: '10_Domain',
    architecture: '20_Architecture',
    decisions: '30_Decisions',
    issues: '40_Issues',
    qa: '50_QA',
    cycles: '60_Cycles',
    changes: '70_Changes',
    people: '80_Teams',
    glossary: '90_Reference/Glossary',
    howto: '90_Reference/HowTo',
    sources: '90_Reference/Sources',
    answers: '90_Reference/Answers',
    reports: '60_Cycles/Reports',
    inbox: '_Inbox',
    templates: '_templates',
    attachments: '_attachments',
    snapshots: '_snapshots',
  },
  flat: {
    index: 'wiki/index.md',
    guide: 'wiki/cach-su-dung.md',
    overview: 'wiki/overview.md',
    dashboard: 'wiki/dashboard.base',
    log: 'wiki/log.md',
    domain: 'wiki/specs',
    architecture: 'wiki/topics',
    decisions: 'wiki/decisions',
    issues: 'wiki/issues',
    qa: 'wiki/qa',
    cycles: 'wiki/cycles',
    changes: 'wiki/changes',
    people: 'wiki/people',
    glossary: 'wiki/glossary',
    howto: 'wiki/howto',
    sources: 'wiki/sources',
    answers: 'wiki/answers',
    reports: 'wiki/reports',
    inbox: '_Inbox',
    templates: 'wiki/_templates',
    attachments: 'wiki/_attachments',
    snapshots: 'wiki/_snapshots',
  },
};

/** Never part of the wiki, whatever the layout. */
export const NON_WIKI = ['raw/', 'tracker/', '.pwiki/', '.claude/', '.obsidian/', '.git/', 'node_modules/', 'scripts/'];
const NON_WIKI_FILES = ['CLAUDE.md', 'README.md', 'AGENTS.md', 'sources.yaml'];

export interface LayoutConfig {
  preset: Preset;
  links: LinkStyle;
  moc: MocPlacement;
  snapshots: boolean;
  sections: Partial<Record<SectionKey, string>>;
  /** Frontmatter type per section when a vault already uses other names (e.g. changes: pr). */
  types: Partial<Record<PageSection, string>>;
  ignore: string[];
}

export class Layout {
  readonly paths: Record<SectionKey, string>;

  constructor(readonly cfg: LayoutConfig) {
    this.paths = { ...PRESETS[cfg.preset] };
    for (const [k, v] of Object.entries(cfg.sections)) if (v) this.paths[k as SectionKey] = normalize(v);
    // Follow the vault's own folders when only those were given (adopted vaults): reports live with the
    // cycles, saved answers with the sources.
    if (!cfg.sections.reports && cfg.sections.cycles) this.paths.reports = `${this.paths.cycles}/Reports`;
    if (!cfg.sections.answers && cfg.sections.sources) this.paths.answers = `${this.paths.sources}/Answers`;
  }

  /** Frontmatter type of the pages of a section. */
  type(key: PageSection): string {
    return this.cfg.types?.[key] ?? SECTION_INFO[key].type;
  }

  get links(): LinkStyle {
    return this.cfg.links;
  }

  path(key: SectionKey): string {
    return this.paths[key];
  }

  /** MOC note of a page section: inside → 30_Decisions/30_Decisions.md, beside → 30_Decisions.md. */
  moc(key: PageSection): string {
    const dir = this.paths[key];
    const name = posix.basename(dir);
    return this.cfg.moc === 'inside' ? `${dir}/${name}.md` : `${posix.dirname(dir) === '.' ? '' : `${posix.dirname(dir)}/`}${name}.md`;
  }

  /** Every MOC path → its section. */
  mocs(): Map<string, PageSection> {
    return new Map(PAGE_SECTIONS.map((s) => [this.moc(s), s]));
  }

  /** Section of a vault path: the longest matching page / support folder (so 60_Cycles/Reports → reports). */
  sectionOf(path: string): PageSection | SupportSection | undefined {
    let best: { key: PageSection | SupportSection; len: number } | undefined;
    for (const key of [...PAGE_SECTIONS, ...SUPPORT_SECTIONS]) {
      const dir = `${this.paths[key]}/`;
      if (path.startsWith(dir) && (!best || dir.length > best.len)) best = { key, len: dir.length };
    }
    return best?.key;
  }

  /** true for markdown the wiki owns (pages, MOCs, index…), false for raw/, tracker/, CLAUDE.md, templates… */
  isWikiFile(path: string): boolean {
    if (NON_WIKI.some((p) => path.startsWith(p)) || NON_WIKI_FILES.includes(path)) return false;
    if (this.cfg.ignore.some((p) => path.startsWith(p))) return false;
    const sec = this.sectionOf(path);
    // inbox: human drop zone (read through raw/), templates / attachments: not pages.
    return sec !== 'templates' && sec !== 'attachments' && sec !== 'inbox';
  }

  /** Key used in tracker/map.json and links: path without ".md". */
  key(path: string): string {
    return path.replace(/\.md$/, '');
  }

  /** A link from `from` to `to` (vault paths) in the configured style. */
  link(from: string, to: string, alias?: string): string {
    if (this.cfg.links === 'wikilink') {
      const target = to.replace(/\.md$/, '');
      return alias ? `[[${target}|${alias.replace(/[|\]]/g, ' ')}]]` : `[[${target}]]`;
    }
    const rel = posix.relative(posix.dirname(from), to) || posix.basename(to);
    return `[${(alias ?? posix.basename(to, '.md')).replace(/[[\]]/g, '')}](${encodeURI(rel)})`;
  }

  /** Folders Obsidian / pwiki create for this layout. */
  dirs(): string[] {
    return [...PAGE_SECTIONS, ...SUPPORT_SECTIONS].map((k) => this.paths[k]);
  }
}

function normalize(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '');
}

const KEYWORDS: [SectionKey, RegExp][] = [
  ['index', /^(index|moc|home|muc_?luc)$/i],
  ['guide', /(cach_?su_?dung|huong_?dan|guide|how_?to_?use|usage)/i],
  ['overview', /^(overview|tong_?quan|summary)$/i],
  ['log', /^(log|nhat_?ky|journal)$/i],
  ['domain', /^(domain|business|spec|specs|nghiep_?vu)$/i],
  ['architecture', /^(architecture|arch|kien_?truc|system|systems)$/i],
  ['decisions', /^(decisions?|adr|adrs|quyet_?dinh)$/i],
  ['issues', /^(issues?|risks?|problems?|van_?de)$/i],
  ['qa', /^(qa|q&a|questions?|faq|hoi_?dap)$/i],
  ['cycles', /^(cycles?|sprints?|timeline|milestones?|phases?)$/i],
  ['changes', /^(pr|prs|pull_?requests?|changes?|commits?|changelog)$/i],
  ['people', /^(teams?|people|persons?|members?|nguoi)$/i],
  ['glossary', /^(glossary|terms?|thuat_?ngu)$/i],
  ['howto', /^(how_?to|howtos|guides|playbooks?|runbooks?)$/i],
  ['sources', /^(sources?|references?|docs|nguon)$/i],
  ['answers', /^(answers?)$/i],
  ['reports', /^(reports?|bao_?cao)$/i],
  ['inbox', /^(inbox)$/i],
  ['templates', /^(templates?)$/i],
  ['attachments', /^(attachments?|assets|images?|files)$/i],
  ['snapshots', /^(snapshots?)$/i],
];

const stem = (name: string) =>
  name
    .replace(/\.(md|base)$/i, '')
    .replace(/^[_\-\s]*\d{0,3}[_\-.\s]*/, '')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

/**
 * Guesses the sections of an existing vault from its top-level names
 * ("10_Domain", "70_PR", "_Inbox", "00_Index.md"…). Unknown names are left alone.
 */
export function detectSections(entries: { name: string; dir: boolean }[]): { sections: Partial<Record<SectionKey, string>>; moc: MocPlacement } {
  const sections: Partial<Record<SectionKey, string>> = {};
  for (const e of entries) {
    const s = stem(e.name);
    for (const [key, re] of KEYWORDS) {
      const isFile = (FILE_SECTIONS as string[]).includes(key);
      if (isFile === e.dir || sections[key] || !re.test(s)) continue;
      if (key === 'dashboard' || (isFile && !/\.md$/i.test(e.name))) continue;
      sections[key] = e.name;
      break;
    }
  }
  // Notes named like a folder next to it (10_Domain/ + 10_Domain.md) mean MOCs live beside folders.
  const names = new Set(entries.filter((e) => !e.dir).map((e) => e.name.replace(/\.md$/i, '')));
  const pageDirs = PAGE_SECTIONS.map((k) => sections[k]).filter((x): x is string => !!x);
  const beside = pageDirs.some((d) => names.has(d));
  return { sections, moc: beside ? 'beside' : 'inside' };
}
