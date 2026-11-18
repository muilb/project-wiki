// raw/<source>/…: markdown + YAML frontmatter, written only when the content really changed
// (git history keeps every earlier version, so overwriting is safe).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { parse, stringify } from 'yaml';

export const RAW_DIR = 'raw';

export interface RawDoc {
  frontmatter: Record<string, unknown>;
  body: string;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_SEGMENT = 120;

/** One path segment that is valid on Windows, macOS and Linux. */
export function safeSegment(seg: string): string {
  let s = seg.normalize('NFC').replace(/[<>:"\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  if (s === '' || s === '.' || s === '..') s = '_';
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  if (s.length > MAX_SEGMENT) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, MAX_SEGMENT - ext.length) + ext;
  }
  return s;
}

/** A relative path ("a/b/c.md") made safe: no "..", no absolute paths, every segment cleaned. */
export function safeRelPath(rel: string): string {
  const parts = rel.split(/[\\/]+/).filter((p) => p !== '' && p !== '.');
  if (parts.length === 0) throw new Error(`Đường dẫn rỗng: "${rel}"`);
  if (parts.some((p) => p === '..')) throw new Error(`Đường dẫn không được chứa "..": "${rel}"`);
  return parts.map(safeSegment).join('/');
}

export function renderDoc(doc: RawDoc): string {
  const fm = stringify(doc.frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${fm}\n---\n\n${doc.body.trimEnd()}\n`;
}

export function parseDoc(text: string): RawDoc {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { frontmatter: {}, body: text };
  return { frontmatter: (parse(m[1]!) as Record<string, unknown>) ?? {}, body: m[2]!.replace(/^\r?\n/, '').trimEnd() };
}

/** raw/ of one source. Every path given to it is relative to raw/<source>/. */
export class RawStore {
  readonly dir: string;
  written = 0;
  removed = 0;

  constructor(
    readonly root: string,
    readonly source: string,
  ) {
    this.dir = join(root, RAW_DIR, safeSegment(source));
  }

  path(rel: string): string {
    return join(this.dir, ...safeRelPath(rel).split('/'));
  }

  read(rel: string): RawDoc | undefined {
    const p = this.path(rel);
    return existsSync(p) ? parseDoc(readFileSync(p, 'utf8')) : undefined;
  }

  /** Returns true when the file was created or its content changed. */
  write(rel: string, doc: RawDoc): boolean {
    const p = this.path(rel);
    const text = renderDoc(doc);
    if (existsSync(p) && readFileSync(p, 'utf8') === text) return false;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, 'utf8');
    this.written++;
    return true;
  }

  remove(rel: string): boolean {
    const p = this.path(rel);
    if (!existsSync(p)) return false;
    rmSync(p);
    this.removed++;
    return true;
  }

  /** Every file under raw/<source>/, as relative paths with "/". */
  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return (readdirSync(this.dir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
      .filter((d) => d.isFile())
      .map((d) => relative(this.dir, join(d.parentPath, d.name)).split(sep).join('/'))
      .sort();
  }
}
