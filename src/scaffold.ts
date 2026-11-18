// pwiki init: creates a project wiki from templates/. pwiki upgrade: refreshes the framework-managed files
// (schema, tracker contract, slash commands) and never touches the project's own files.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE } from './config.js';
import { git, isGitRepo } from './util.js';

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(PKG_ROOT, 'templates');
const SCHEMA = join(PKG_ROOT, 'schema');
/** First line of a managed file. Remove it to keep your own version on upgrade. */
export const MANAGED = '<!-- pwiki:managed — "pwiki upgrade" ghi đè file này; xoá dòng này nếu muốn tự sửa -->';

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => f.split(sep).join('/'))
    .sort();
}

/** Managed files: schema/*.md → .pwiki/, templates/managed/** → same path in the wiki. */
function managedFiles(): { target: string; source: string }[] {
  return [
    ...walk(SCHEMA).map((f) => ({ target: `.pwiki/${f}`, source: join(SCHEMA, f) })),
    ...walk(join(TEMPLATES, 'managed')).map((f) => ({ target: f, source: join(TEMPLATES, 'managed', f) })),
  ];
}

/** Puts the marker first, or right after a YAML frontmatter block (slash commands need it on line 1). */
export function withMarker(text: string): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return fm ? `${fm[0]}${MANAGED}\n${text.slice(fm[0].length)}` : `${MANAGED}\n${text}`;
}

export function upgrade(root: string, log = console.log): { written: string[]; kept: string[] } {
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
  for (const f of written) log(`  cập nhật ${f}`);
  for (const f of kept) log(`  giữ nguyên ${f} (đã tự sửa)`);
  return { written, kept };
}

export function init(dir: string, name: string, log = console.log): void {
  if (existsSync(join(dir, CONFIG_FILE))) throw new Error(`${dir} đã có ${CONFIG_FILE}`);
  mkdirSync(dir, { recursive: true });
  const project = join(TEMPLATES, 'project');
  for (const f of walk(project)) {
    const dest = join(dir, f.replace(/(^|\/)_gitignore$/, '$1.gitignore').replace(/(^|\/)_env\.example$/, '$1.env.example'));
    if (existsSync(dest)) {
      log(`  bỏ qua ${relative(dir, dest)} (đã có)`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    const text = readFileSync(join(project, f), 'utf8').replaceAll('{{PROJECT_NAME}}', name);
    writeFileSync(dest, text, 'utf8');
  }
  upgrade(dir, () => {});
  if (!isGitRepo(dir)) git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['add', '--all']);
  git(dir, ['commit', '--quiet', '-m', `pwiki init: ${name}`], { allowFail: true });
  log(`Đã tạo wiki "${name}" ở ${dir}.`);
}

