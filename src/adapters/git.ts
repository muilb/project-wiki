// git: commit messages, authors and changed-file lists (never the source code itself),
// one raw file per day: raw/<source>/commits/<YYYY-MM-DD>.md.
import { isAbsolute, resolve } from 'node:path';
import type { GitSource } from '../config.js';
import { dayIn, daysAgo, git, timeIn } from '../util.js';
import type { Adapter } from './types.js';

interface Commit {
  sha: string;
  author: string;
  date: string; // ISO
  subject: string;
  body: string;
  parents: number;
  files: { path: string; added: string; deleted: string }[];
}

const SEP = '\u001e';
const END = '\u001f';

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const chunk of out.split(SEP)) {
    if (!chunk.trim()) continue;
    const [head, rest = ''] = chunk.split(END);
    const [sha, author, date, parents, subject, ...bodyLines] = head!.split('\n');
    const files = rest
      .split('\n')
      .map((l) => l.split('\t'))
      .filter((p) => p.length >= 3)
      .map(([added, deleted, ...path]) => ({ added: added!, deleted: deleted!, path: path.join('\t') }));
    commits.push({
      sha: sha!.trim(),
      author: author!,
      date: date!,
      parents: parents!.trim() ? parents!.trim().split(' ').length : 0,
      subject: subject ?? '',
      body: bodyLines.join('\n').trim(),
      files,
    });
  }
  return commits;
}

/** Existing day file → shas already written, to merge new commits without duplicates. */
const SHA_MARK = /<!-- commit:([0-9a-f]{7,40}) -->/g;

function renderCommit(c: Commit, cfg: GitSource, tz: string, tickets: RegExp): string {
  const files = c.files.filter((f) => !cfg.ignorePaths.some((p) => f.path.startsWith(p)));
  const found = [...new Set(`${c.subject}\n${c.body}`.match(tickets) ?? [])];
  const lines = [
    `<!-- commit:${c.sha} -->`,
    `### ${timeIn(tz, new Date(c.date))} ${c.sha.slice(0, 8)} — ${c.author}${c.parents > 1 ? ' (merge)' : ''}`,
    c.subject,
  ];
  if (c.body) lines.push('', c.body);
  if (found.length) lines.push('', `Ticket: ${found.join(', ')}`);
  if (files.length) {
    const shown = files.slice(0, 40).map((f) => `- ${f.path} (+${f.added}/-${f.deleted})`);
    if (files.length > 40) shown.push(`- … và ${files.length - 40} file khác`);
    lines.push('', 'File thay đổi:', ...shown);
  }
  return lines.join('\n');
}

export const gitAdapter: Adapter<GitSource> = async (cfg, ctx) => {
  const repo = isAbsolute(cfg.repo) ? cfg.repo : resolve(ctx.root, cfg.repo);
  if (cfg.fetch) git(repo, ['fetch', '--quiet', 'origin']);
  const ref = cfg.fetch && cfg.branch !== 'HEAD' ? `origin/${cfg.branch}` : cfg.branch;
  const head = git(repo, ['rev-parse', ref]).trim();
  const cursor = ctx.cursor as { sha?: string; date?: string } | undefined;
  if (cursor?.sha === head) return { cursor, note: 'không có commit mới' };

  let range: string[];
  if (cursor?.sha && isAncestor(repo, cursor.sha, head)) range = [`${cursor.sha}..${head}`];
  // History rewritten (force push) or cursor gone: read again from the cursor's date; known shas are skipped below.
  else if (cursor?.date) range = [head, `--since=${cursor.date}`];
  else range = [head, `--since=${cfg.since ?? dayIn('UTC', daysAgo(ctx.now, 30))}`];

  const out = git(repo, [
    'log',
    '--reverse',
    '--no-color',
    '--numstat',
    '--first-parent',
    '--diff-merges=first-parent',
    `--format=${SEP}%H%n%an%n%aI%n%P%n%B${END}`,
    ...range,
  ]);
  const commits = parseLog(out);
  const tickets = new RegExp(cfg.ticketPattern, 'g');

  const byDay = new Map<string, Commit[]>();
  for (const c of commits) {
    const day = dayIn(ctx.timezone, new Date(c.date));
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }
  for (const [day, list] of byDay) {
    const rel = `commits/${day}.md`;
    const prev = ctx.raw.read(rel);
    const known = new Set([...(prev?.body.matchAll(SHA_MARK) ?? [])].map((m) => m[1]!));
    const fresh = list.filter((c) => !known.has(c.sha));
    if (!fresh.length) continue;
    const parts = prev ? [prev.body.trimEnd()] : [`# ${cfg.name} — commit ngày ${day}`];
    parts.push(...fresh.map((c) => renderCommit(c, cfg, ctx.timezone, tickets)));
    ctx.raw.write(rel, {
      frontmatter: { source: 'git', type: 'commits', repo: cfg.repo, branch: cfg.branch, date: day },
      body: parts.join('\n\n'),
    });
  }
  const headDate = git(repo, ['log', '-1', '--format=%aI', head]).trim();
  return { cursor: { sha: head, date: headDate }, note: `${commits.length} commit` };
};

function isAncestor(repo: string, a: string, b: string): boolean {
  try {
    git(repo, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}
