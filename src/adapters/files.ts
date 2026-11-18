// files: mirrors a folder (file server share, synced OneDrive / SharePoint folder…) as markdown.
// raw/<source>/<relative path>.md; a file that disappears from the folder is removed from raw/ too.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FilesSource } from '../config.js';
import { safeRelPath } from '../raw.js';
import { cell } from '../util.js';
import type { Adapter } from './types.js';

interface Seen {
  mtimeMs: number;
  size: number;
}

export function quotePath(p: string, platform = process.platform): string {
  return platform === 'win32' ? `"${p}"` : `'${p.replace(/'/g, `'\\''`)}'`;
}

export function listFiles(dir: string, cfg: Pick<FilesSource, 'extensions' | 'exclude'>): string[] {
  const exts = new Set(cfg.extensions.map((e) => e.toLowerCase()));
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)).split(sep).join('/'))
    .filter((rel) => exts.has(extname(rel).toLowerCase()))
    .filter((rel) => !cfg.exclude.some((x) => `/${rel}`.includes(x)))
    .sort();
}

async function xlsxToMarkdown(file: string, maxRows: number): Promise<string> {
  const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out: string[] = [];
  wb.eachSheet((ws: any) => {
    const rows: string[][] = [];
    let width = 0;
    ws.eachRow({ includeEmpty: false }, (row: any) => {
      if (rows.length >= maxRows) return;
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (c: any, col: number) => {
        vals[col - 1] = cell(c.text);
      });
      for (let i = 0; i < vals.length; i++) vals[i] ??= '';
      while (vals.length && vals[vals.length - 1] === '') vals.pop();
      if (!vals.length) return;
      rows.push(vals);
      width = Math.max(width, vals.length);
    });
    out.push(`## ${ws.name}${ws.state && ws.state !== 'visible' ? ' (ẩn)' : ''}`, '');
    if (!rows.length) {
      out.push('(trống)', '');
      return;
    }
    const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    out.push(pad(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(pad));
    if (ws.actualRowCount > maxRows) out.push('', `… còn ${ws.actualRowCount - maxRows} dòng (maxSheetRows = ${maxRows})`);
    out.push('');
  });
  return out.join('\n');
}

async function docxToMarkdown(file: string): Promise<string> {
  const mammoth: any = (await import('mammoth')).default ?? (await import('mammoth'));
  const r = await mammoth.convertToMarkdown({ path: file });
  return String(r.value);
}

export async function convert(file: string, cfg: FilesSource): Promise<{ text: string; converter: string }> {
  const ext = extname(file).toLowerCase();
  const cmd = cfg.converters[ext] ?? cfg.converters[extname(file)];
  if (cmd) {
    const r = spawnSync(cmd.replaceAll('{file}', quotePath(file)), { shell: true, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`converter "${cmd}" lỗi: ${(r.stderr || r.error?.message || '').trim().slice(0, 300)}`);
    return { text: r.stdout, converter: cmd.split(/\s+/)[0]! };
  }
  switch (ext) {
    case '.md':
    case '.markdown':
    case '.txt':
      return { text: readFileSync(file, 'utf8'), converter: 'text' };
    case '.csv':
    case '.tsv':
      return { text: `\`\`\`${ext.slice(1)}\n${readFileSync(file, 'utf8').trimEnd()}\n\`\`\``, converter: 'text' };
    case '.xlsx':
    case '.xlsm':
      return { text: await xlsxToMarkdown(file, cfg.maxSheetRows), converter: 'exceljs' };
    case '.docx':
      return { text: await docxToMarkdown(file), converter: 'mammoth' };
    default:
      throw new Error(`chưa có cách chuyển ${ext}: thêm converters."${ext}" trong sources.yaml (ví dụ markitdown "{file}")`);
  }
}

/** raw path for a source file: markdown keeps its name, others get ".md" appended (spec.xlsx → spec.xlsx.md). */
export const rawPathFor = (rel: string) => (/\.(md|markdown)$/i.test(rel) ? rel : `${rel}.md`);

export const filesAdapter: Adapter<FilesSource> = async (cfg, ctx) => {
  const dir = isAbsolute(cfg.path) ? cfg.path : resolve(ctx.root, cfg.path);
  if (!existsSync(dir)) throw new Error(`Không thấy thư mục ${dir} (ổ mạng chưa kết nối?)`);
  const prev = ((ctx.cursor as { files?: Record<string, Seen> } | undefined)?.files ?? {}) as Record<string, Seen>;
  const next: Record<string, Seen> = {};
  const failed: string[] = [];
  let converted = 0;

  const files = listFiles(dir, cfg);
  for (const rel of files) {
    const abs = join(dir, ...rel.split('/'));
    const st = statSync(abs);
    const seen: Seen = { mtimeMs: Math.round(st.mtimeMs), size: st.size };
    const old = prev[rel];
    if (old && old.mtimeMs === seen.mtimeMs && old.size === seen.size && ctx.raw.read(rawPathFor(rel))) {
      next[rel] = seen;
      continue;
    }
    if (st.size > cfg.maxFileMB * 1024 * 1024) {
      ctx.log(`  bỏ qua ${rel}: ${(st.size / 1048576).toFixed(1)} MB > maxFileMB`);
      continue;
    }
    try {
      const { text, converter } = await convert(abs, cfg);
      const sha256 = createHash('sha256').update(readFileSync(abs)).digest('hex');
      ctx.raw.write(rawPathFor(rel), {
        frontmatter: { source: 'files', path: rel, modified: new Date(st.mtimeMs).toISOString(), size: st.size, sha256, converter },
        body: text.trim() ? text : '(không trích được nội dung)',
      });
      next[rel] = seen;
      converted++;
    } catch (e) {
      failed.push(rel);
      ctx.log(`  lỗi ${rel}: ${(e as Error).message}`);
      if (old) next[rel] = old; // keep the old raw copy; retried next run because mtime differs
    }
  }
  const present = new Set(files);
  for (const rel of Object.keys(prev)) if (!present.has(rel)) ctx.raw.remove(rawPathFor(rel));
  // Raw copies whose source file is gone even without a cursor entry (e.g. state reset).
  const expected = new Set(files.map((f) => safeRelPath(rawPathFor(f))));
  for (const r of ctx.raw.list()) if (!expected.has(r)) ctx.raw.remove(r);

  return {
    cursor: { files: next },
    note: `${files.length} file, ${converted} chuyển mới${failed.length ? `, ${failed.length} lỗi` : ''}`,
  };
};
