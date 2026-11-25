// pwiki init: a new project vault. pwiki adopt: pwiki added to an existing Obsidian vault.
// pwiki upgrade: refreshes framework-managed files and creates what the layout still lacks.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, loadConfig, type Config } from './config.js';
import { detectSections, FILE_SECTIONS, PAGE_SECTIONS, SECTION_INFO, SUPPORT_SECTIONS, type PageSection, type Preset, type SectionKey } from './layout.js';
import { parseDoc } from './raw.js';
import { git, isGitRepo } from './util.js';
import { ensureStructure } from './vault.js';

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(PKG_ROOT, 'templates');
const SCHEMA = join(PKG_ROOT, 'schema');
/** Marks a managed file. Remove it to keep your own version on upgrade. */
export const MANAGED = '<!-- pwiki:managed — "pwiki upgrade" ghi đè file này; xoá dòng này nếu muốn tự sửa -->';
const IMPORTS = '@.pwiki/SCHEMA.md\n@.pwiki/LAYOUT.md\n@.pwiki/TRACKER-CONTRACT.md';

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => f.split(sep).join('/'))
    .sort();
}

/** Puts the marker first, or right after a YAML frontmatter block (slash commands need it on line 1). */
export function withMarker(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return m ? `${m[0]}${MANAGED}\n${text.slice(m[0].length)}` : `${MANAGED}\n${text}`;
}

function managedFiles(): { target: string; source: string }[] {
  return [
    ...walk(SCHEMA).map((f) => ({ target: `.pwiki/${f}`, source: join(SCHEMA, f) })),
    ...walk(join(TEMPLATES, 'managed')).map((f) => ({ target: f, source: join(TEMPLATES, 'managed', f) })),
  ];
}

function writeManaged(root: string): { written: string[]; kept: string[] } {
  const written: string[] = [];
  const kept: string[] = [];
  for (const { target, source } of managedFiles()) {
    const dest = join(root, target);
    const text = withMarker(readFileSync(source, 'utf8'));
    if (existsSync(dest)) {
      const cur = readFileSync(dest, 'utf8');
      if (!cur.includes(MANAGED)) {
        kept.push(target);
        continue;
      }
      if (cur === text) continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text, 'utf8');
    written.push(target);
  }
  return { written, kept };
}

/** Appends the lines of `wanted` that `file` lacks; never rewrites what is there. */
function appendIgnores(file: string, wanted: string): boolean {
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const have = cur.split(/\r?\n/);
  const missing = wanted.split(/\r?\n/).filter((l) => l.trim() && !have.includes(l));
  if (!missing.length) return false;
  appendFileSync(file, `${!cur || cur.endsWith('\n') ? '' : '\n'}# pwiki\n${missing.join('\n')}\n`);
  return true;
}

/** Managed files + LAYOUT.md + whatever the layout needs and is missing. Notes are never overwritten. */
export function upgrade(root: string, log = console.log, config?: Config): { written: string[]; kept: string[] } {
  const r = writeManaged(root);
  // New ignore rules (e.g. browser profiles holding sign-in cookies) must reach vaults made earlier.
  if (appendIgnores(join(root, '.gitignore'), readFileSync(join(TEMPLATES, 'project', '_gitignore'), 'utf8'))) r.written.push('.gitignore');
  r.written.push(...ensureStructure(root, config ?? loadConfig(root), PKG_ROOT));
  for (const f of r.written) log(`  ghi ${f}`);
  for (const f of r.kept) log(`  giữ nguyên ${f} (đã tự sửa)`);
  return r;
}

interface ProjectFilesOpts {
  name: string;
  preset: Preset;
  moc: 'inside' | 'beside';
  sections: Partial<Record<SectionKey, string>>;
  types?: Partial<Record<PageSection, string>>;
  inbox: string;
}

/** Files of templates/project (CLAUDE.md, sources.yaml, .gitignore…), skipping what exists. */
function writeProjectFiles(dir: string, o: ProjectFilesOpts, log: (m: string) => void): string[] {
  const project = join(TEMPLATES, 'project');
  const written: string[] = [];
  for (const f of walk(project)) {
    const rel = f.replace(/(^|\/)_gitignore$/, '$1.gitignore').replace(/(^|\/)_env\.example$/, '$1.env.example');
    const dest = join(dir, rel);
    const text = readFileSync(join(project, f), 'utf8')
      .replaceAll('{{PROJECT_NAME}}', o.name)
      .replaceAll('{{PRESET}}', o.preset)
      .replaceAll('{{MOC}}', o.moc)
      .replaceAll('{{SECTIONS}}', Object.keys(o.sections).length ? JSON.stringify(o.sections) : '{}')
      .replaceAll('{{TYPES}}', o.types && Object.keys(o.types).length ? JSON.stringify(o.types) : '{}')
      .replaceAll('{{INBOX}}', o.inbox);
    if (existsSync(dest)) {
      if (rel === '.gitignore') {
        if (appendIgnores(dest, text)) written.push(rel);
      } else if (rel === 'CLAUDE.md') {
        const cur = readFileSync(dest, 'utf8');
        if (!cur.includes('.pwiki/SCHEMA.md')) {
          appendFileSync(dest, `${cur.endsWith('\n') ? '' : '\n'}\n## pwiki\n\nQuy ước của pwiki (khung LLM Wiki). Khi mâu thuẫn, phần riêng ở trên của file này thắng.\n\n${IMPORTS}\n`);
          written.push(rel);
          log('  thêm import .pwiki/* vào cuối CLAUDE.md có sẵn');
        }
      } else log(`  bỏ qua ${rel} (đã có)`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text, 'utf8');
    written.push(rel);
  }
  return written;
}

/**
 * Commits what is staged. A failure (most often: no git user.name / user.email on a fresh machine)
 * must not abort init/adopt, but must not stay silent either, or later git-diff based ingest breaks.
 */
function commitOrWarn(dir: string, message: string, log: (m: string) => void): void {
  git(dir, ['commit', '--quiet', '-m', message], { allowFail: true });
  const staged = git(dir, ['diff', '--cached', '--name-only'], { allowFail: true }).trim();
  if (staged)
    log(
      `Chưa commit được (thường do git chưa có user.name / user.email). Chạy:\n` +
        `  git config --global user.name "Tên bạn"\n  git config --global user.email "ban@example.com"\n` +
        `rồi: git -C "${dir}" commit -m "${message}"`,
    );
}

export function init(dir: string, name: string, log: (m: string) => void = console.log, preset: Preset = 'numbered'): void {
  if (existsSync(join(dir, CONFIG_FILE))) throw new Error(`${dir} đã có ${CONFIG_FILE}`);
  mkdirSync(dir, { recursive: true });
  writeProjectFiles(dir, { name, preset, moc: 'inside', sections: {}, inbox: '_Inbox' }, log);
  upgrade(dir, () => {});
  if (!isGitRepo(dir)) git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['add', '--all']);
  commitOrWarn(dir, `pwiki init: ${name}`, log);
  log(`Đã tạo wiki "${name}" (bố cục ${preset}) ở ${dir}.`);
}

/** Most common frontmatter type of the notes already in each detected section, when it is not pwiki's. */
export function detectTypes(dir: string, sections: Partial<Record<SectionKey, string>>): Partial<Record<PageSection, string>> {
  const out: Partial<Record<PageSection, string>> = {};
  for (const k of PAGE_SECTIONS) {
    const d = sections[k];
    if (!d || !existsSync(join(dir, d))) continue;
    const counts = new Map<string, number>();
    for (const f of walk(join(dir, d)).filter((x) => x.endsWith('.md')).slice(0, 300)) {
      const t = parseDoc(readFileSync(join(dir, d, f), 'utf8')).frontmatter.type;
      if (typeof t === 'string' && /^[a-z][a-z0-9_-]*$/.test(t) && t !== 'moc') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (top && top[0] !== SECTION_INFO[k].type && top[1] * 2 > total) out[k] = top[0];
  }
  return out;
}

export interface AdoptResult {
  detected: Partial<Record<SectionKey, string>>;
  types: Partial<Record<PageSection, string>>;
  moc: 'inside' | 'beside';
  missing: SectionKey[];
  written: string[];
}

/**
 * Adds pwiki to an existing vault: guesses the layout from the top-level folders, writes sources.yaml,
 * .pwiki/, .claude/, raw/, tracker/ and appends to CLAUDE.md / .gitignore. Creates no note: run
 * "pwiki upgrade" after checking layout.sections to create the sections that are still missing.
 */
export function adopt(dir: string, name: string, log: (m: string) => void = console.log): AdoptResult {
  if (existsSync(join(dir, CONFIG_FILE))) throw new Error(`${dir} đã có ${CONFIG_FILE} (đã dùng pwiki)`);
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, dir: e.isDirectory() }));
  const { sections, moc } = detectSections(entries);
  const types = detectTypes(dir, sections);
  const preset: Preset = entries.some((e) => e.dir && e.name === 'wiki') && !Object.keys(sections).length ? 'flat' : 'numbered';
  const written = writeProjectFiles(dir, { name, preset, moc, sections, types, inbox: sections.inbox ?? '_Inbox' }, log);
  written.push(...writeManaged(dir).written);
  const missing = [...FILE_SECTIONS, ...PAGE_SECTIONS, ...SUPPORT_SECTIONS].filter((k) => !sections[k]);
  if (!isGitRepo(dir)) {
    git(dir, ['init', '--quiet', '-b', 'main']);
    git(dir, ['add', '--all']);
    commitOrWarn(dir, `pwiki adopt: ${name}`, log);
  } else {
    git(dir, ['add', '--', ...written.filter((w) => existsSync(join(dir, w)))]);
    commitOrWarn(dir, `pwiki adopt: ${name}`, log);
  }
  return { detected: sections, types, moc, missing, written };
}
