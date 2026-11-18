// .pwiki/state.json: adapter cursors and the last ingested commit. Committed with the wiki,
// so a fresh clone continues where the last collect stopped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PWIKI_DIR = '.pwiki';

export interface State {
  cursors: Record<string, unknown>;
  /** raw/ commit up to which the wiki has been ingested. */
  ingestedRev?: string;
  lastCollect?: { at: string; results: Record<string, { ok: boolean; written: number; removed: number; note?: string; error?: string }> };
}

const file = (root: string) => join(root, PWIKI_DIR, 'state.json');

export function loadState(root: string): State {
  const p = file(root);
  if (!existsSync(p)) return { cursors: {} };
  const s = JSON.parse(readFileSync(p, 'utf8')) as Partial<State>;
  return { ...s, cursors: s.cursors ?? {} };
}

export function saveState(root: string, state: State): void {
  mkdirSync(join(root, PWIKI_DIR), { recursive: true });
  writeFileSync(file(root), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
