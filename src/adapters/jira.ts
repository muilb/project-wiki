// Jira (Cloud or Server / Data Center): one raw file per issue, raw/<source>/<KEY>.md, rewritten
// when the issue changes (git keeps the earlier versions, so the ingest sees exactly what changed).
import type { JiraSource } from '../config.js';
import { dayIn, daysAgo } from '../util.js';
import type { Adapter, AdapterContext } from './types.js';

const BASE_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'reporter',
  'duedate',
  'labels',
  'created',
  'updated',
  'description',
  'comment',
  'parent',
  'fixVersions',
  'resolution',
];

interface JiraIssue {
  key: string;
  fields: Record<string, any>;
}

/** Atlassian Document Format (Cloud API v3) → plain text / light markdown. */
export function adfToText(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const kids = (n: any) => (Array.isArray(n.content) ? n.content.map(adfToText).join('') : '');
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map(adfToText).join('\n\n').trim();
    case 'text': {
      const link = (node.marks ?? []).find((m: any) => m.type === 'link');
      return link ? `${node.text} (${link.attrs?.href})` : (node.text ?? '');
    }
    case 'hardBreak':
      return '\n';
    case 'paragraph':
      return kids(node);
    case 'heading':
      return `${'#'.repeat(node.attrs?.level ?? 3)} ${kids(node)}`;
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? []).map((li: any, i: number) => `${node.type === 'orderedList' ? `${i + 1}.` : '-'} ${adfToText(li).trim()}`).join('\n');
    case 'listItem':
      return (node.content ?? []).map(adfToText).join('\n');
    case 'codeBlock':
      return `\`\`\`\n${kids(node)}\n\`\`\``;
    case 'blockquote':
      return kids(node)
        .split('\n')
        .map((l: string) => `> ${l}`)
        .join('\n');
    case 'mention':
      return node.attrs?.text ?? '@?';
    case 'emoji':
      return node.attrs?.text ?? node.attrs?.shortName ?? '';
    case 'inlineCard':
    case 'blockCard':
      return node.attrs?.url ?? '';
    case 'table':
      return (node.content ?? []).map((row: any) => `| ${(row.content ?? []).map((c: any) => adfToText(c).replace(/\n/g, ' ')).join(' | ')} |`).join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '[đính kèm]';
    default:
      return kids(node);
  }
}

/** Jira times look like 2026-11-18T09:00:00.000+0900 (no colon in the offset). */
export const jiraTime = (s: string) => Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));

const text = (v: any) => (v == null ? '' : typeof v === 'string' ? v : adfToText(v));
const person = (v: any) => v?.displayName ?? v?.name ?? '';

export function renderIssue(issue: JiraIssue, cfg: JiraSource): { frontmatter: Record<string, unknown>; body: string } {
  const f = issue.fields;
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/browse/${issue.key}`;
  const frontmatter: Record<string, unknown> = {
    source: 'jira',
    key: issue.key,
    url,
    type: f.issuetype?.name ?? null,
    status: f.status?.name ?? null,
    statusCategory: f.status?.statusCategory?.key ?? null, // new | indeterminate | done
    priority: f.priority?.name ?? null,
    assignee: person(f.assignee) || null,
    due: f.duedate ?? null,
    labels: f.labels ?? [],
    parent: f.parent?.key ?? null,
    fixVersions: (f.fixVersions ?? []).map((v: any) => v.name),
    resolution: f.resolution?.name ?? null,
    created: f.created ?? null,
    updated: f.updated ?? null,
  };
  for (const extra of cfg.extraFields) {
    const v = f[extra];
    frontmatter[extra] = v == null ? null : typeof v === 'object' ? JSON.parse(JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && 'name' in x ? x.name : x))) : v;
  }
  const lines = [`# ${issue.key} ${f.summary ?? ''}`, '', `Người báo: ${person(f.reporter) || '-'}`];
  const desc = text(f.description).trim();
  lines.push('', '## Mô tả', '', desc || '(trống)');
  const comments: any[] = f.comment?.comments ?? [];
  if (comments.length) {
    const shown = comments.slice(-cfg.maxComments);
    lines.push('', `## Bình luận (${comments.length}${shown.length < comments.length ? `, hiện ${shown.length} gần nhất` : ''})`);
    for (const c of shown) lines.push('', `### ${c.created ?? ''} — ${person(c.author)}`, '', text(c.body).trim());
  }
  return { frontmatter, body: lines.join('\n') };
}

async function getJson(ctx: AdapterContext, url: string, headers: Record<string, string>): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await ctx.fetch(url, { headers: { Accept: 'application/json', ...headers } });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after') ?? 5);
      await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) throw new Error(`Jira từ chối (${res.status}): kiểm tra token / quyền xem project. ${body.slice(0, 200)}`);
      throw new Error(`Jira lỗi ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }
}

export const jiraAdapter: Adapter<JiraSource> = async (cfg, ctx) => {
  const token = ctx.env[cfg.tokenEnv];
  if (!token) throw new Error(`Thiếu biến môi trường ${cfg.tokenEnv} (đặt trong .env)`);
  let auth: string;
  if (cfg.deployment === 'cloud') {
    const email = ctx.env[cfg.emailEnv];
    if (!email) throw new Error(`Thiếu biến môi trường ${cfg.emailEnv} (email tài khoản Atlassian)`);
    auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  } else {
    auth = `Bearer ${token}`;
  }

  const cursor = ctx.cursor as { updated?: string } | undefined;
  // Date-only, one day of overlap: JQL dates are in the Jira user's time zone, which we do not know.
  // Issues that did not change are rewritten byte-identical, so the overlap costs nothing in git.
  const from = cursor?.updated ? daysAgo(new Date(cursor.updated), 1) : daysAgo(ctx.now, cfg.lookbackDays);
  const jql = `(${cfg.jql}) AND updated >= "${dayIn('UTC', from)}" ORDER BY updated ASC`;
  const fields = [...BASE_FIELDS, ...cfg.extraFields].join(',');
  const base = cfg.baseUrl.replace(/\/$/, '');

  const issues: JiraIssue[] = [];
  if (cfg.deployment === 'cloud') {
    let token: string | undefined;
    do {
      const q = new URLSearchParams({ jql, fields, maxResults: '100' });
      if (token) q.set('nextPageToken', token);
      const page = await getJson(ctx, `${base}/rest/api/3/search/jql?${q}`, { Authorization: auth });
      issues.push(...(page.issues ?? []));
      token = page.isLast === false || page.nextPageToken ? page.nextPageToken : undefined;
    } while (token);
  } else {
    for (let startAt = 0; ; ) {
      const q = new URLSearchParams({ jql, fields, maxResults: '100', startAt: String(startAt) });
      const page = await getJson(ctx, `${base}/rest/api/2/search?${q}`, { Authorization: auth });
      const got: JiraIssue[] = page.issues ?? [];
      issues.push(...got);
      startAt += got.length;
      if (!got.length || startAt >= (page.total ?? 0)) break;
    }
  }

  let changed = 0;
  let maxUpdated = cursor?.updated;
  for (const issue of issues) {
    if (ctx.raw.write(`${issue.key}.md`, renderIssue(issue, cfg))) changed++;
    const u = issue.fields.updated as string | undefined;
    if (u && !Number.isNaN(jiraTime(u)) && (!maxUpdated || jiraTime(u) > Date.parse(maxUpdated))) maxUpdated = new Date(jiraTime(u)).toISOString();
  }
  return { cursor: { updated: maxUpdated ?? ctx.now.toISOString() }, note: `${issues.length} issue đọc, ${changed} thay đổi` };
};
