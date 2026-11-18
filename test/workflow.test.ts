import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collect } from '../src/collect.js';
import { loadConfig } from '../src/config.js';
import { computePlan, formatPlan, markDone, plan } from '../src/ingest.js';
import { init, MANAGED, upgrade } from '../src/scaffold.js';
import { loadState } from '../src/state.js';
import { TrackerClient } from '../src/tracker/client.js';
import { loadMap, pull, push, readOutbox } from '../src/tracker/sync.js';
import { git } from '../src/util.js';
import { commit, gitRepo, tmp } from './helpers.js';

const quiet = () => {};

function newWiki(sources = '[]', tracker = 'tracker: { apiUrl: "http://tracker.test", devUser: "pl@example.com", projectId: P03 }') {
  const root = tmp('wiki-');
  init(root, 'Demo', quiet);
  git(root, ['config', 'user.email', 'pl@example.com']);
  git(root, ['config', 'user.name', 'PL']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(root, 'sources.yaml'), `project: { name: Demo }\n${tracker}\nsources: ${sources}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'config']);
  return root;
}

describe('init / upgrade', () => {
  it('creates a git wiki with managed files and keeps hand-edited ones', () => {
    const root = tmp('wiki-');
    init(root, 'IHP EMV', quiet);
    for (const f of ['CLAUDE.md', 'sources.yaml', '.gitignore', '.env.example', '.claude/settings.json', '.claude/commands/ingest.md', '.pwiki/SCHEMA.md', '.pwiki/TRACKER-CONTRACT.md', 'wiki/index.md', 'tracker/map.json'])
      expect(existsSync(join(root, f)), f).toBe(true);
    expect(readFileSync(join(root, 'sources.yaml'), 'utf8')).toContain('name: "IHP EMV"');
    expect(readFileSync(join(root, '.claude/commands/ingest.md'), 'utf8').startsWith('---\ndescription:')).toBe(true);
    expect(git(root, ['log', '--oneline'])).toContain('pwiki init: IHP EMV');
    expect(() => loadConfig(root)).not.toThrow();

    writeFileSync(join(root, '.claude/commands/lint.md'), '# của tôi');
    writeFileSync(join(root, '.pwiki/SCHEMA.md'), `${MANAGED}\ncũ`);
    const r = upgrade(root, quiet);
    expect(r.written).toEqual(['.pwiki/SCHEMA.md']);
    expect(r.kept).toEqual(['.claude/commands/lint.md']);
    expect(() => init(root, 'x', quiet)).toThrow(/đã có/);
  });
});

describe('collect + ingest plan', () => {
  it('commits raw/, plans changed files, continues batch by batch', async () => {
    const repo = tmp('repo-');
    gitRepo(repo);
    commit(repo, 'a.ts', '1', 'EMV-1 init', '2026-11-17T09:00:00+07:00');
    const docs = tmp('docs-');
    writeFileSync(join(docs, 'spec.md'), '# Spec v1');
    writeFileSync(join(docs, 'faq.md'), '# FAQ');
    const root = newWiki(
      `\n  - { name: app, type: git, repo: ${JSON.stringify(repo)}, since: 2026-11-01 }\n  - { name: specs, type: files, path: ${JSON.stringify(docs)} }\n  - { name: off, type: command, command: "exit 1", enabled: false }`,
    );
    const config = loadConfig(root);
    const s1 = await collect(root, config, { log: quiet });
    expect(s1.ok).toBe(true);
    expect(s1.commit).toBeTruthy();
    expect(Object.keys(s1.results)).toEqual(['app', 'specs']);
    expect(git(root, ['status', '--porcelain'])).toBe('');

    const p1 = plan(root);
    expect(p1.files.map((f) => `${f.status} ${f.path}`)).toEqual(['A raw/app/commits/2026-11-17.md', 'A raw/specs/faq.md', 'A raw/specs/spec.md']);
    expect(formatPlan(p1, 2)).toContain('lô này 2 file');
    expect(markDone(root, ['raw/app/commits/2026-11-17.md', 'raw/specs/faq.md'])).toBe(1);
    expect(plan(root).files.filter((f) => !f.done).map((f) => f.path)).toEqual(['raw/specs/spec.md']);
    expect(markDone(root, [])).toBe(0);
    expect(loadState(root).ingestedRev).toBe(p1.to);

    writeFileSync(join(docs, 'spec.md'), '# Spec v2\n\nthêm');
    const s2 = await collect(root, config, { log: quiet });
    expect(s2.results.specs!.written).toBe(1);
    const p2 = computePlan(root);
    expect(p2.files).toMatchObject([{ status: 'M', path: 'raw/specs/spec.md' }]);
    expect(git(root, ['diff', p2.from, p2.to, '--', 'raw/specs/spec.md'])).toContain('+# Spec v2');

    const s3 = await collect(root, config, { log: quiet });
    expect(s3.commit).toBeUndefined();
  });

  it('keeps going when one source fails and does not move its cursor', async () => {
    const root = newWiki(`\n  - { name: bad, type: files, path: /no/such/dir }\n  - { name: ok, type: command, command: "node -e \\"console.log(JSON.stringify({cursor: 1}))\\"" }`);
    const s = await collect(root, loadConfig(root), { log: quiet });
    expect(s.ok).toBe(false);
    expect(s.results.bad!.error).toMatch(/ổ mạng/);
    const st = loadState(root);
    expect(st.cursors).toEqual({ ok: 1 });
  });

  it('refuses to plan over uncommitted raw changes', () => {
    const root = newWiki();
    mkdirSync(join(root, 'raw', 'x'), { recursive: true });
    writeFileSync(join(root, 'raw', 'x', 'a.md'), 'x');
    expect(() => computePlan(root)).toThrow(/chưa commit/);
  });
});

describe('tracker', () => {
  function fakeTracker() {
    const calls: { method: string; url: string; body?: any; headers: any }[] = [];
    let n = 15;
    const fetchMock = (async (url: string, init: any = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method ?? 'GET', url, body, headers: init.headers });
      if (url.endsWith('/projects/P03') && (init.method ?? 'GET') === 'GET')
        return Response.json({ project: { id: 'P03', name: 'Demo', health: 'yellow' }, items: [{ id: 'I0001', title: 'UAT', type: 'milestone', status: 'open' }], updates: [] });
      if (url.endsWith('/projects/P03/items') && init.method === 'POST') return Response.json({ item: { id: `I00${n++}`, ...body } }, { status: 201 });
      if (url.endsWith('/projects/P03/updates') && init.method === 'POST') return Response.json({ update: { id: 'U1', ...body } }, { status: 201 });
      if (url.includes('/items/I0001') && init.method === 'PATCH') return Response.json({ item: { id: 'I0001', ...body } });
      if (url.includes('/items/') && init.method === 'PATCH') return Response.json({ error: 'Không tìm thấy mục' }, { status: 404 });
      return Response.json({ error: 'Not found' }, { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, fetchMock };
  }

  const write = (root: string, name: string, p: object) => writeFileSync(join(root, 'tracker', 'outbox', name), JSON.stringify(p, null, 2));

  it('pulls state and pushes only approved, valid proposals', async () => {
    const root = newWiki();
    const config = loadConfig(root);
    const { calls, fetchMock } = fakeTracker();
    await pull(root, config, fetchMock, new Date('2026-11-18T05:00:00Z'));
    const state = JSON.parse(readFileSync(join(root, 'tracker', 'state.json'), 'utf8'));
    expect(state).toMatchObject({ pulledAt: '2026-11-18T05:00:00.000Z', project: { health: 'yellow' } });
    expect(calls[0]!.headers['x-dev-user']).toBe('pl@example.com');

    write(root, '1-item.json', {
      kind: 'item',
      key: 'issues/emv-timeout',
      body: { type: 'issue', title: 'Timeout chưa chốt', priority: 'high', date: '2026-11-25' },
      reason: 'chặn test',
      evidence: ['raw/teams/spec/2026-11-18.md msg:1'],
      approved: true,
    });
    write(root, '2-update.json', { kind: 'update', body: { health: 'yellow', summary: 'Đang chờ khách chốt timeout' }, reason: 'r', evidence: ['wiki/issues/emv-timeout.md'], approved: true });
    write(root, '3-status.json', { kind: 'item_status', itemId: 'I0001', body: { status: 'done' }, reason: 'r', evidence: ['raw/git/x.md'], approved: false });
    write(root, '4-bad.json', { kind: 'item', key: 'k', body: { type: 'issue', title: 'x', date: '25/11' }, reason: 'r', evidence: [], approved: true });

    const dry = await push(root, config, { dryRun: true, fetch: fetchMock, log: quiet });
    expect(dry.sent).toHaveLength(2);
    expect(calls).toHaveLength(1);

    const r = await push(root, config, { fetch: fetchMock, now: new Date('2026-11-18T06:00:00Z'), log: quiet });
    expect(r.sent.map((s) => s.id)).toEqual(['I0015', 'U1']);
    expect(r.skipped).toEqual([{ file: '3-status.json', reason: 'chưa duyệt' }]);
    expect(r.failed[0]!.file).toBe('4-bad.json');
    expect(r.failed[0]!.error).toMatch(/body\.date/);
    expect(r.failed[0]!.error).toMatch(/evidence/);
    const posted = calls.find((c) => c.url.endsWith('/items'))!;
    expect(posted.body).toEqual({ type: 'issue', title: 'Timeout chưa chốt', priority: 'high', date: '2026-11-25', status: 'open' });
    const upd = calls.find((c) => c.url.endsWith('/updates'))!;
    expect(upd.body.rawText).toBe('Nguồn (wiki dự án):\n- wiki/issues/emv-timeout.md');
    expect(loadMap(root).items).toEqual({ 'issues/emv-timeout': 'I0015' });
    expect(readOutbox(root).map((e) => e.file)).toEqual(['3-status.json', '4-bad.json']);
    expect(existsSync(join(root, 'tracker', 'sent', '2026-11', '1-item.json'))).toBe(true);
    expect(readFileSync(join(root, 'tracker', 'sent.log'), 'utf8')).toContain('item\tI0015');
    expect(git(root, ['log', '-1', '--format=%s']).trim()).toBe('tracker push: 2 đề xuất đã gửi');

    // Status change by wiki key through map.json; creating the same key again is refused.
    write(root, '5-status.json', { kind: 'item_status', key: 'issues/emv-timeout', body: { status: 'done' }, reason: 'r', evidence: ['x'], approved: true });
    write(root, '6-dup.json', { kind: 'item', key: 'issues/emv-timeout', body: { type: 'issue', title: 'x', date: '2026-11-30' }, reason: 'r', evidence: ['x'], approved: true });
    const r2 = await push(root, config, { fetch: fetchMock, log: quiet });
    expect(calls.at(-1)!.url).toContain('/items/I0015');
    expect(r2.failed.map((f) => f.file)).toContain('5-status.json'); // fake tracker: I0015 unknown → 404 message kept
    expect(r2.failed.find((f) => f.file === '5-status.json')!.error).toBe('Không tìm thấy mục');
    expect(r2.failed.find((f) => f.file === '6-dup.json')!.error).toMatch(/đã là mục I0015/);
  });

  it('signs in with Cognito via /config.json and refreshes the token', async () => {
    const root = newWiki('[]', 'tracker: { url: "https://tracker.example.com", projectId: P03, email: PL@Example.com }');
    const config = loadConfig(root);
    const calls: { url: string; target?: string; body?: any }[] = [];
    let now = 0;
    const fetchMock = (async (url: string, init: any = {}) => {
      const target = init.headers?.['X-Amz-Target'];
      calls.push({ url, target, body: init.body ? JSON.parse(init.body) : undefined });
      if (url === 'https://tracker.example.com/config.json') return Response.json({ apiUrl: 'https://api.example.com/', region: 'ap-northeast-1', userPoolClientId: 'cid' });
      if (target?.endsWith('InitiateAuth')) {
        const body = JSON.parse(init.body);
        if (body.AuthFlow === 'USER_PASSWORD_AUTH') return Response.json({ AuthenticationResult: { IdToken: 'id1', RefreshToken: 'r1', ExpiresIn: 60 } });
        now++;
        return Response.json({ AuthenticationResult: { IdToken: `id-refreshed-${now}`, ExpiresIn: 3600 } });
      }
      return Response.json({ ok: true, auth: init.headers?.Authorization });
    }) as unknown as typeof fetch;
    const client = new TrackerClient(root, config.tracker!, fetchMock);
    await client.login('secret');
    expect(calls[1]!.body).toEqual({ ClientId: 'cid', AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: 'pl@example.com', PASSWORD: 'secret' } });
    expect(calls[1]!.url).toBe('https://cognito-idp.ap-northeast-1.amazonaws.com/');
    // Token expires in 60s (< 120s margin) → refreshed before the call.
    const res = await client.request<any>('GET', '/me');
    expect(res.auth).toBe('id-refreshed-1');
    expect(calls.at(-1)!.url).toBe('https://api.example.com/me');
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.pwiki/tracker-session.json');
  });
});
