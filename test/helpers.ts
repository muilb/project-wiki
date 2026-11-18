import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterContext } from '../src/adapters/types.js';
import { RawStore } from '../src/raw.js';
import { git } from '../src/util.js';

export const tmp = (p = 'pwiki-') => mkdtempSync(join(tmpdir(), p));

export function ctxFor(root: string, source: string, over: Partial<AdapterContext> = {}): AdapterContext & { logs: string[] } {
  const logs: string[] = [];
  return {
    root,
    raw: new RawStore(root, source),
    cursor: undefined,
    now: new Date('2026-11-18T04:00:00Z'),
    timezone: 'Asia/Ho_Chi_Minh',
    env: {},
    fetch: (() => {
      throw new Error('no network in tests');
    }) as unknown as typeof fetch,
    log: (m) => logs.push(m),
    options: {},
    logs,
    ...over,
  };
}

export function gitRepo(dir: string) {
  git(dir, ['init', '--quiet', '-b', 'main']);
  git(dir, ['config', 'user.email', 'dev@example.com']);
  git(dir, ['config', 'user.name', 'Dev']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

export function commit(dir: string, file: string, content: string, message: string, date: string) {
  writeFileSync(join(dir, file), content);
  git(dir, ['add', file]);
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const out = spawnSync('git', ['commit', '--quiet', '-m', message], { cwd: dir, env, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr);
}
