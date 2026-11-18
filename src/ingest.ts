// What the next /ingest must read: raw/ files changed between the last ingested commit and HEAD.
// A large first ingest can span several Claude sessions: files are marked done batch by batch,
// and the ingested commit moves forward only when the whole range is done.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { RAW_DIR } from './raw.js';
import { loadState, PWIKI_DIR, saveState } from './state.js';
import { git } from './util.js';

export interface PlanFile {
  status: 'A' | 'M' | 'D' | 'R';
  path: string;
  added?: number;
  deleted?: number;
  done?: boolean;
}

export interface Plan {
  from: string; // commit, or the empty tree on the first ingest
  to: string;
  files: PlanFile[];
}

const pendingPath = (root: string) => join(root, PWIKI_DIR, 'ingest-pending.json');

function emptyTree(root: string): string {
  const r = spawnSync('git', ['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '', encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git hash-object lỗi: ${r.stderr}`);
  return r.stdout.trim();
}

export function computePlan(root: string): Plan {
  const dirty = git(root, ['status', '--porcelain', '--', RAW_DIR]).trim();
  if (dirty) throw new Error(`raw/ có thay đổi chưa commit (chạy "pwiki collect" để commit, hoặc git commit tay):\n${dirty}`);
  const to = git(root, ['rev-parse', 'HEAD']).trim();
  const state = loadState(root);
  const from = state.ingestedRev ?? emptyTree(root);
  const files = new Map<string, PlanFile>();
  for (const line of git(root, ['diff', '--name-status', '--no-renames', from, to, '--', RAW_DIR]).split('\n')) {
    const [status, path] = line.split('\t');
    if (status && path && !path.endsWith('/.gitkeep')) files.set(path, { status: status[0] as PlanFile['status'], path });
  }
  for (const line of git(root, ['diff', '--numstat', '--no-renames', from, to, '--', RAW_DIR]).split('\n')) {
    const [a, d, path] = line.split('\t');
    const f = path ? files.get(path) : undefined;
    if (f) Object.assign(f, { added: Number(a) || 0, deleted: Number(d) || 0 });
  }
  return { from, to, files: [...files.values()] };
}

export function loadPending(root: string): Plan | undefined {
  return existsSync(pendingPath(root)) ? (JSON.parse(readFileSync(pendingPath(root), 'utf8')) as Plan) : undefined;
}

/** Continues the unfinished plan if there is one, else starts a new one from the last ingested commit. */
export function plan(root: string): Plan {
  const pending = loadPending(root);
  if (pending && pending.files.some((f) => !f.done)) return pending;
  const p = computePlan(root);
  if (p.files.length) writeFileSync(pendingPath(root), `${JSON.stringify(p, null, 2)}\n`, 'utf8');
  else markIngested(root, p.to);
  return p;
}

function markIngested(root: string, rev: string) {
  const state = loadState(root);
  state.ingestedRev = rev;
  saveState(root, state);
  if (existsSync(pendingPath(root))) rmSync(pendingPath(root));
}

/** Marks files (or all, when `paths` is empty) of the pending plan as ingested. Returns how many are left. */
export function markDone(root: string, paths: string[]): number {
  const p = loadPending(root);
  if (!p) throw new Error('Không có lượt ingest nào đang dở (chạy "pwiki ingest-plan" trước)');
  const want = new Set(paths.map((x) => x.replace(/\\/g, '/')));
  const unknown = [...want].filter((x) => !p.files.some((f) => f.path === x));
  if (unknown.length) throw new Error(`Không có trong lượt ingest: ${unknown.join(', ')}`);
  for (const f of p.files) if (!want.size || want.has(f.path)) f.done = true;
  const left = p.files.filter((f) => !f.done).length;
  if (left === 0) markIngested(root, p.to);
  else writeFileSync(pendingPath(root), `${JSON.stringify(p, null, 2)}\n`, 'utf8');
  return left;
}

export function formatPlan(p: Plan, batch: number): string {
  const todo = p.files.filter((f) => !f.done);
  if (!todo.length) return 'Không có gì mới trong raw/ để ingest.';
  const shown = todo.slice(0, batch);
  const label = { A: 'mới', M: 'sửa', D: 'xoá', R: 'đổi tên' };
  const lines = [
    `Lượt ingest ${p.from.slice(0, 8)}..${p.to.slice(0, 8)}: còn ${todo.length}/${p.files.length} file; lô này ${shown.length} file.`,
    '',
    ...shown.map((f) => `${f.status} ${f.path}  (${label[f.status]}${f.added != null ? `, +${f.added}/-${f.deleted}` : ''})`),
    '',
    `Xem thay đổi của một file:  git diff ${p.from.slice(0, 12)} ${p.to.slice(0, 12)} -- <file>`,
    `File mới (A) thì đọc thẳng file. Xong lô này:  pwiki ingest-done ${shown.length < todo.length ? '<các file đã xử lý>' : ''}`.trimEnd(),
  ];
  return lines.join('\n');
}
