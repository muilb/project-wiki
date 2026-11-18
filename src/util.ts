import { spawnSync } from 'node:child_process';

/** YYYY-MM-DD of `d` in a time zone. */
export function dayIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** HH:mm of `d` in a time zone. */
export function timeIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** Runs git; throws with stderr on failure. */
export function git(cwd: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  // core.quotepath=false: Japanese / Vietnamese file names come back as is, not as \345\237… escapes.
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`Không chạy được git: ${r.error.message}`);
  if (r.status !== 0) {
    if (opts.allowFail) return '';
    throw new Error(`git ${args.join(' ')} lỗi: ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout;
}

export function isGitRepo(dir: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** Basic HTML → plain text for chat messages (keeps line breaks, links, mentions). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/\r\n/g, '\n')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
        const t = text.replace(/<[^>]+>/g, '');
        return t && t !== href ? `${t} (${href})` : href;
      })
      .replace(/<img\b[^>]*alt="([^"]*)"[^>]*>/gi, '$1')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

/** Markdown table cell: no pipes or line breaks. */
export function cell(v: unknown): string {
  return String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}
