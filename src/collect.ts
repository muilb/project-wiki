// pwiki collect: runs every enabled source, saves cursors, refreshes snapshots, commits (one commit per run).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from './adapters/index.js';
import type { Adapter } from './adapters/types.js';
import { layoutOf, type Config } from './config.js';
import { loadEnv } from './env.js';
import { RAW_DIR, RawStore } from './raw.js';
import { snapshot } from './snapshot.js';
import { pull, TRACKER_DIR } from './tracker/sync.js';
import { loadState, PWIKI_DIR, saveState } from './state.js';
import { git, isGitRepo } from './util.js';

export interface CollectOptions {
  only?: string[];
  commit?: boolean;
  record?: boolean;
  headed?: boolean;
  /** Pull tracker/state.json too (default: when sources.yaml has a tracker). */
  tracker?: boolean;
  now?: Date;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
}

export interface CollectSummary {
  ok: boolean;
  results: Record<string, { ok: boolean; written: number; removed: number; note?: string; error?: string }>;
  commit?: string;
}

export async function collect(root: string, config: Config, opts: CollectOptions = {}): Promise<CollectSummary> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const now = opts.now ?? new Date();
  const env = { ...loadEnv(root), ...process.env };
  const state = loadState(root);
  const unknown = (opts.only ?? []).filter((n) => !config.sources.some((s) => s.name === n));
  if (unknown.length) throw new Error(`Không có nguồn: ${unknown.join(', ')}`);
  const sources = config.sources.filter((s) => (opts.only?.length ? opts.only.includes(s.name) : s.enabled));
  if (!sources.length) log('Chưa có nguồn nào được bật trong sources.yaml.');

  const summary: CollectSummary = { ok: true, results: {} };
  for (const src of sources) {
    const raw = new RawStore(root, src.name);
    log(`▶ ${src.name} (${src.type})`);
    try {
      const adapter = adapters[src.type] as Adapter;
      const r = await adapter(src, {
        root,
        raw,
        cursor: state.cursors[src.name],
        now,
        timezone: config.project.timezone,
        env,
        fetch: opts.fetch ?? fetch,
        log,
        options: { record: opts.record, headed: opts.headed },
      });
      state.cursors[src.name] = r.cursor;
      summary.results[src.name] = { ok: true, written: raw.written, removed: raw.removed, note: r.note };
      log(`  ✓ ${r.note ?? ''} → ${raw.written} file ghi, ${raw.removed} file xoá`);
    } catch (e) {
      summary.ok = false;
      const error = (e as Error).message;
      summary.results[src.name] = { ok: false, written: raw.written, removed: raw.removed, error };
      log(`  ✗ ${error}`);
    }
  }
  if (config.tracker && opts.tracker !== false) {
    // Current tracker state, so snapshots and the next /ingest see it. Not fatal: no login yet, offline…
    try {
      await pull(root, config, opts.fetch ?? fetch, now, { snapshot: false });
      log('▶ tracker: đã kéo trạng thái dự án');
    } catch (e) {
      log(`▶ tracker: bỏ qua (${(e as Error).message})`);
    }
  }
  state.lastCollect = { at: now.toISOString(), results: summary.results };
  saveState(root, state);
  const snapDir = layoutOf(config).path('snapshots');
  if (config.layout.snapshots) {
    try {
      const pages = snapshot(root, config, now);
      if (pages.length) log(`Snapshot: ${pages.length} trang cập nhật.`);
    } catch (e) {
      log(`Snapshot lỗi: ${(e as Error).message}`);
    }
  }

  if ((opts.commit ?? config.git.autoCommit) && isGitRepo(root)) {
    const extra = [snapDir, `${TRACKER_DIR}/state.json`].filter((p) => existsSync(join(root, p)));
    git(root, ['add', '--all', '--', RAW_DIR, `${PWIKI_DIR}/state.json`, ...extra]);
    const staged = git(root, ['diff', '--cached', '--name-only', '--', RAW_DIR]).trim();
    if (staged) {
      const files = staged.split('\n').length;
      const parts = Object.entries(summary.results).map(([n, r]) => `${n}: ${r.ok ? `${r.written}+/${r.removed}-` : 'lỗi'}`);
      git(root, ['commit', '--quiet', '-m', `collect: ${files} file raw (${parts.join(', ')})`]);
      summary.commit = git(root, ['rev-parse', 'HEAD']).trim();
      log(`Đã commit ${files} file raw (${summary.commit.slice(0, 8)}).`);
    } else {
      // Cursor-only change: keep it out of history noise but staged state must not linger.
      git(root, ['commit', '--quiet', '-m', 'collect: cập nhật cursor / snapshot'], { allowFail: true });
      log('Không có thay đổi trong raw/.');
    }
  }
  return summary;
}
