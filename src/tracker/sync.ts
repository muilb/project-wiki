// tracker/ in the wiki:
//   state.json   what the tracker knows about this project (pwiki tracker pull), read by the ingest
//   outbox/*.json proposals written by Claude (/sync-tracker), sent only when "approved": true
//   map.json     wiki key (e.g. "issues/emv-timeout") → tracker item id, so nothing is created twice
//   sent/        proposals already sent, with the tracker's answer; sent.log one line per send
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { layoutOf, type Config, type TrackerConfig } from '../config.js';
import { snapshot } from '../snapshot.js';
import { git, isGitRepo } from '../util.js';
import { TrackerClient } from './client.js';

export const TRACKER_DIR = 'tracker';
const HEALTHS = ['green', 'yellow', 'red'] as const;
const ITEM_TYPES = ['issue', 'event', 'milestone'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const ITEM_STATUSES = ['open', 'in_progress', 'done', 'postponed'] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ngày dạng YYYY-MM-DD');

// Mirrors the tracker's api/src/schemas.ts limits so mistakes show before anything is sent.
const itemFields = {
  type: z.enum(ITEM_TYPES),
  title: z.string().trim().min(1).max(500),
  priority: z.enum(PRIORITIES),
  date,
  owner: z.email().optional(),
  status: z.enum(ITEM_STATUSES),
  note: z.string().trim().max(2000).optional(),
};
const common = {
  /** Why this belongs on the tracker (shown when the PL reviews). */
  reason: z.string().min(1),
  /** raw/ or wiki/ paths (with #msg:… anchors) backing the proposal. */
  evidence: z.array(z.string().min(1)).min(1, 'cần ít nhất một dẫn chứng (evidence)'),
  approved: z.boolean().default(false),
  createdAt: z.string().optional(),
};
const itemRef = { key: z.string().min(1).optional(), itemId: z.string().min(1).optional() };

export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('update'),
    body: z.object({
      health: z.enum(HEALTHS).optional(),
      summary: z.string().trim().min(1).max(4000),
      needHelp: z.string().trim().max(2000).optional(),
      rawText: z.string().max(8000).optional(),
    }),
  }),
  z.object({
    ...common,
    kind: z.literal('item'),
    /** Wiki key of the issue / milestone; remembered in map.json with the new item id. */
    key: z.string().min(1),
    body: z.object({ ...itemFields, priority: itemFields.priority.default('medium'), status: itemFields.status.default('open') }),
  }),
  z.object({ ...common, ...itemRef, kind: z.literal('item_status'), body: z.object({ status: z.enum(ITEM_STATUSES), note: itemFields.note }) }),
  z.object({ ...common, ...itemRef, kind: z.literal('item_update'), body: z.object(itemFields).partial() }),
]);
export type Proposal = z.infer<typeof proposalSchema>;

interface ItemMap {
  items: Record<string, string>;
}

const dir = (root: string, ...p: string[]) => join(root, TRACKER_DIR, ...p);

export function loadMap(root: string): ItemMap {
  const p = dir(root, 'map.json');
  return existsSync(p) ? { items: {}, ...(JSON.parse(readFileSync(p, 'utf8')) as Partial<ItemMap>) } : { items: {} };
}

function saveMap(root: string, map: ItemMap) {
  writeFileSync(dir(root, 'map.json'), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

function requireTracker(config: Config): TrackerConfig {
  if (!config.tracker) throw new Error('sources.yaml chưa có mục tracker (url, projectId, email)');
  return config.tracker;
}

export async function pull(root: string, config: Config, fetchImpl: typeof fetch = fetch, now = new Date(), opts: { snapshot?: boolean } = {}) {
  const t = requireTracker(config);
  const client = new TrackerClient(root, t, fetchImpl);
  const data = await client.request<any>('GET', `/projects/${encodeURIComponent(t.projectId)}`);
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(dir(root, 'state.json'), `${JSON.stringify({ pulledAt: now.toISOString(), ...data }, null, 2)}\n`, 'utf8');
  if (config.layout.snapshots && opts.snapshot !== false) snapshot(root, config, now);
  return data as { project: any; items: any[] };
}

export interface OutboxEntry {
  file: string;
  proposal?: Proposal;
  error?: string;
}

export function readOutbox(root: string): OutboxEntry[] {
  const d = dir(root, 'outbox');
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      try {
        const r = proposalSchema.safeParse(JSON.parse(readFileSync(join(d, file), 'utf8')));
        if (r.success) return { file, proposal: r.data };
        return { file, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
      } catch (e) {
        return { file, error: `JSON lỗi: ${(e as Error).message}` };
      }
    });
}

export function describe(p: Proposal): string {
  switch (p.kind) {
    case 'update':
      return `Cập nhật${p.body.health ? ` [${p.body.health}]` : ''}: ${p.body.summary.split('\n')[0]!.slice(0, 100)}`;
    case 'item':
      return `Thêm ${p.body.type} [${p.body.priority}] ${p.body.date}: ${p.body.title}`;
    case 'item_status':
      return `Đổi trạng thái ${p.itemId ?? p.key} → ${p.body.status}`;
    case 'item_update':
      return `Sửa ${p.itemId ?? p.key}: ${Object.keys(p.body).join(', ')}`;
  }
}

export interface PushResult {
  sent: { file: string; what: string; id?: string }[];
  skipped: { file: string; reason: string }[];
  failed: { file: string; error: string }[];
}

export async function push(
  root: string,
  config: Config,
  opts: { dryRun?: boolean; fetch?: typeof fetch; now?: Date; log?: (m: string) => void } = {},
): Promise<PushResult> {
  const t = requireTracker(config);
  const log = opts.log ?? ((m: string) => console.log(m));
  const now = opts.now ?? new Date();
  const client = new TrackerClient(root, t, opts.fetch ?? fetch);
  const map = loadMap(root);
  const result: PushResult = { sent: [], skipped: [], failed: [] };
  const pid = encodeURIComponent(t.projectId);

  for (const entry of readOutbox(root)) {
    if (!entry.proposal) {
      result.failed.push({ file: entry.file, error: entry.error! });
      log(`✗ ${entry.file}: ${entry.error}`);
      continue;
    }
    const p = entry.proposal;
    const what = describe(p);
    if (!p.approved) {
      result.skipped.push({ file: entry.file, reason: 'chưa duyệt' });
      continue;
    }
    try {
      let method: string;
      let path: string;
      let body: unknown;
      if (p.kind === 'update') {
        let rawText = p.body.rawText;
        if (t.evidenceInRawText) rawText = [rawText, `Nguồn (wiki dự án):\n${p.evidence.map((e) => `- ${e}`).join('\n')}`].filter(Boolean).join('\n\n').slice(0, 8000);
        [method, path, body] = ['POST', `/projects/${pid}/updates`, { ...p.body, rawText }];
      } else if (p.kind === 'item') {
        if (map.items[p.key]) throw new Error(`"${p.key}" đã là mục ${map.items[p.key]} trên tracker: dùng item_update / item_status`);
        [method, path, body] = ['POST', `/projects/${pid}/items`, p.body];
      } else {
        const id = p.itemId ?? (p.key ? map.items[p.key] : undefined);
        if (!id) throw new Error(`không biết mục nào trên tracker: thêm itemId, hoặc key có trong map.json`);
        [method, path, body] = ['PATCH', `/projects/${pid}/items/${encodeURIComponent(id)}`, p.body];
      }
      if (opts.dryRun) {
        log(`• (thử) ${method} ${path} — ${what}`);
        result.sent.push({ file: entry.file, what });
        continue;
      }
      const res = await client.request<any>(method, path, body);
      const id: string | undefined = res.item?.id ?? res.update?.id;
      if (p.kind === 'item' && id) {
        map.items[p.key] = id;
        saveMap(root, map);
      }
      const month = now.toISOString().slice(0, 7);
      mkdirSync(dir(root, 'sent', month), { recursive: true });
      const sentFile = dir(root, 'sent', month, entry.file);
      writeFileSync(sentFile, `${JSON.stringify({ ...p, sentAt: now.toISOString(), response: res }, null, 2)}\n`, 'utf8');
      rmSync(dir(root, 'outbox', entry.file));
      appendFileSync(dir(root, 'sent.log'), `${now.toISOString()}\t${p.kind}\t${id ?? '-'}\t${what}\n`, 'utf8');
      result.sent.push({ file: entry.file, what, id });
      log(`✓ ${what}${id ? ` → ${id}` : ''}`);
    } catch (e) {
      result.failed.push({ file: entry.file, error: (e as Error).message });
      log(`✗ ${entry.file}: ${(e as Error).message}`);
    }
  }
  if (!opts.dryRun && result.sent.length && config.layout.snapshots) snapshot(root, config, now);
  if (!opts.dryRun && result.sent.length && config.git.autoCommit && isGitRepo(root)) {
    git(root, ['add', '--all', '--', TRACKER_DIR]);
    const snapDir = layoutOf(config).path('snapshots');
    if (existsSync(join(root, snapDir))) git(root, ['add', '--all', '--', snapDir]);
    git(root, ['commit', '--quiet', '-m', `tracker push: ${result.sent.length} đề xuất đã gửi`], { allowFail: true });
  }
  return result;
}
