import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandAdapter } from '../src/adapters/command.js';
import { filesAdapter, quotePath, rawPathFor } from '../src/adapters/files.js';
import { gitAdapter } from '../src/adapters/git.js';
import { adfToText, jiraAdapter } from '../src/adapters/jira.js';
import {
  chatServiceAuth,
  conversationIdOf,
  fetchConversation,
  mergeDay,
  messagesUrl,
  parseMessages,
  webAppUrl,
  writeConversation,
} from '../src/adapters/teams.js';
import { parseConfig, type CommandSource, type FilesSource, type GitSource, type JiraSource, type TeamsSource } from '../src/config.js';
import { commit, ctxFor, gitRepo, tmp } from './helpers.js';

function source<T>(yaml: string): T {
  return parseConfig(`project: { name: t }\nsources:\n  - ${yaml}`).sources[0] as T;
}

describe('git adapter', () => {
  it('groups commits by day, keeps ticket ids, reads only new commits next time', async () => {
    const repo = tmp('repo-');
    gitRepo(repo);
    commit(repo, 'a.ts', '1', 'EMV-12 thêm timeout\n\nchi tiết', '2026-11-17T09:00:00+07:00');
    commit(repo, 'b.ts', '2', 'sửa log', '2026-11-17T23:30:00+07:00');
    const root = tmp();
    const cfg = source<GitSource>(`{ name: app, type: git, repo: ${JSON.stringify(repo)}, since: 2026-11-01 }`);
    const ctx = ctxFor(root, 'app');
    const r1 = await gitAdapter(cfg, ctx);
    expect(r1.note).toBe('2 commit');
    const day = ctx.raw.read('commits/2026-11-17.md')!;
    expect(day.body).toContain('EMV-12 thêm timeout');
    expect(day.body).toContain('Ticket: EMV-12');
    expect(day.body).toContain('- a.ts (+1/-0)');
    expect(day.body).toContain('chi tiết');

    commit(repo, 'c.ts', '3', 'EMV-13 fix', '2026-11-18T10:00:00+07:00');
    const ctx2 = ctxFor(root, 'app', { cursor: r1.cursor });
    const r2 = await gitAdapter(cfg, ctx2);
    expect(r2.note).toBe('1 commit');
    expect(ctx2.raw.list()).toEqual(['commits/2026-11-17.md', 'commits/2026-11-18.md']);
    expect(ctx2.raw.written).toBe(1);

    const r3 = await gitAdapter(cfg, ctxFor(root, 'app', { cursor: r2.cursor }));
    expect(r3.note).toBe('không có commit mới');
  });

  it('survives a rewritten history without duplicating commits', async () => {
    const repo = tmp('repo-');
    gitRepo(repo);
    commit(repo, 'a.ts', '1', 'one', '2026-11-17T09:00:00+07:00');
    const root = tmp();
    const cfg = source<GitSource>(`{ name: app, type: git, repo: ${JSON.stringify(repo)}, since: 2026-11-01 }`);
    const r1 = await gitAdapter(cfg, ctxFor(root, 'app'));
    const ctx = ctxFor(root, 'app', { cursor: { ...(r1.cursor as object), sha: 'deadbeef'.repeat(5) } });
    commit(repo, 'b.ts', '2', 'two', '2026-11-17T10:00:00+07:00');
    await gitAdapter(cfg, ctx);
    const body = ctx.raw.read('commits/2026-11-17.md')!.body;
    expect(body.match(/<!-- commit:/g)).toHaveLength(2);
  });
});

describe('jira adapter', () => {
  const issue = (key: string, updated: string, extra: Record<string, unknown> = {}) => ({
    key,
    fields: {
      summary: `Sự cố ${key}`,
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      issuetype: { name: 'Bug' },
      assignee: { displayName: 'Giàu' },
      reporter: { displayName: 'Hòa' },
      duedate: '2026-11-25',
      labels: ['uat'],
      updated,
      description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Timeout 30s' }] }] },
      comment: { comments: [{ author: { displayName: 'Ishii' }, created: '2026-11-18T01:00:00Z', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '確認します' }] }] } }] },
      ...extra,
    },
  });

  it('pages through Cloud search/jql and writes one file per issue', async () => {
    const calls: string[] = [];
    const pages = [
      { issues: [issue('EMV-1', '2026-11-17T10:00:00.000+0900')], nextPageToken: 't2', isLast: false },
      { issues: [issue('EMV-2', '2026-11-18T09:00:00.000+0900')], isLast: true },
    ];
    const fetchMock = (async (url: string, init: any) => {
      calls.push(url);
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('me@x.com:tok').toString('base64')}`);
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const root = tmp();
    const cfg = source<JiraSource>('{ name: jira, type: jira, baseUrl: "https://x.atlassian.net", jql: "project = EMV" }');
    const ctx = ctxFor(root, 'jira', { fetch: fetchMock, env: { JIRA_EMAIL: 'me@x.com', JIRA_TOKEN: 'tok' } });
    const r = await jiraAdapter(cfg, ctx);
    expect(calls[0]).toContain('/rest/api/3/search/jql?');
    expect(new URL(calls[0]!).searchParams.get('jql')).toBe('(project = EMV) AND updated >= "2026-08-20" ORDER BY updated ASC');
    expect(calls[1]).toContain('nextPageToken=t2');
    expect(ctx.raw.list()).toEqual(['EMV-1.md', 'EMV-2.md']);
    const doc = ctx.raw.read('EMV-1.md')!;
    expect(doc.frontmatter).toMatchObject({ key: 'EMV-1', status: 'In Progress', assignee: 'Giàu', url: 'https://x.atlassian.net/browse/EMV-1' });
    expect(doc.body).toContain('Timeout 30s');
    expect(doc.body).toContain('確認します');
    expect(r.cursor).toEqual({ updated: '2026-11-18T00:00:00.000Z' });
  });

  it('uses Bearer + startAt paging on Server, overlap of one day from the cursor', async () => {
    const calls: string[] = [];
    const fetchMock = (async (url: string, init: any) => {
      calls.push(url);
      expect(init.headers.Authorization).toBe('Bearer pat');
      const startAt = Number(new URL(url).searchParams.get('startAt'));
      const all = [issue('A-1', '2026-11-18T00:00:00.000+0000'), issue('A-2', '2026-11-18T00:00:00.000+0000')];
      return new Response(JSON.stringify({ issues: all.slice(startAt, startAt + 1), total: 2 }), { status: 200 });
    }) as unknown as typeof fetch;
    const cfg = source<JiraSource>('{ name: j, type: jira, deployment: server, baseUrl: "https://jira.local", jql: "project = A", tokenEnv: PAT }');
    const ctx = ctxFor(tmp(), 'j', { fetch: fetchMock, env: { PAT: 'pat' }, cursor: { updated: '2026-11-10T03:00:00.000Z' } });
    await jiraAdapter(cfg, ctx);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('startAt=1');
    expect(calls[0]).toContain('/rest/api/2/search?');
    expect(new URL(calls[0]!).searchParams.get('jql')).toContain('updated >= "2026-11-09"');
    expect(ctx.raw.list()).toEqual(['A-1.md', 'A-2.md']);
  });

  it('explains missing tokens and 401', async () => {
    const cfg = source<JiraSource>('{ name: j, type: jira, baseUrl: "https://x.atlassian.net", jql: "x" }');
    await expect(jiraAdapter(cfg, ctxFor(tmp(), 'j'))).rejects.toThrow(/JIRA_TOKEN/);
    const fetch401 = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    await expect(jiraAdapter(cfg, ctxFor(tmp(), 'j', { fetch: fetch401, env: { JIRA_TOKEN: 't', JIRA_EMAIL: 'e' } }))).rejects.toThrow(/từ chối \(401\)/);
  });

  it('flattens ADF', () => {
    expect(
      adfToText({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Tiêu đề' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://l' } }] }, { type: 'mention', attrs: { text: '@Hòa' } }] },
        ],
      }),
    ).toBe('## Tiêu đề\n\n- a\n\nlink (https://l)@Hòa');
  });
});

describe('files adapter', () => {
  it('mirrors text files, converts with a command, removes deleted files, skips unchanged', async () => {
    const dir = tmp('share-');
    mkdirSync(join(dir, 'sub'));
    mkdirSync(join(dir, 'old'));
    writeFileSync(join(dir, 'README.md'), '# Spec\n\nnội dung');
    writeFileSync(join(dir, 'sub', 'data.csv'), 'a,b\n1,2');
    writeFileSync(join(dir, 'sub', '~$lock.md'), 'x');
    writeFileSync(join(dir, 'old', 'x.md'), 'x');
    writeFileSync(join(dir, 'note.pdf'), 'PDF');
    const root = tmp();
    const cfg = source<FilesSource>(
      `{ name: specs, type: files, path: ${JSON.stringify(dir)}, extensions: [.md, .csv, .pdf], exclude: ["~$", "/old/"], converters: { .pdf: "node -e \\"process.stdout.write('# converted ' + require('fs').readFileSync(process.argv[1],'utf8'))\\" {file}" } }`,
    );
    const ctx = ctxFor(root, 'specs');
    const r1 = await filesAdapter(cfg, ctx);
    expect(ctx.raw.list()).toEqual(['README.md', 'note.pdf.md', 'sub/data.csv.md']);
    expect(ctx.raw.read('note.pdf.md')!.body).toBe('# converted PDF');
    expect(ctx.raw.read('sub/data.csv.md')!.body).toContain('```csv');
    expect(ctx.raw.read('README.md')!.frontmatter).toMatchObject({ path: 'README.md', converter: 'text' });

    const ctx2 = ctxFor(root, 'specs', { cursor: r1.cursor });
    await filesAdapter(cfg, ctx2);
    expect(ctx2.raw.written).toBe(0);

    rmSync(join(dir, 'sub', 'data.csv'));
    writeFileSync(join(dir, 'README.md'), '# Spec v2');
    utimesSync(join(dir, 'README.md'), new Date(), new Date(Date.now() + 5000));
    const ctx3 = ctxFor(root, 'specs', { cursor: r1.cursor });
    const r3 = await filesAdapter(cfg, ctx3);
    expect(ctx3.raw.list()).toEqual(['README.md', 'note.pdf.md']);
    expect(ctx3.raw.read('README.md')!.body).toBe('# Spec v2');
    expect(r3.note).toContain('1 chuyển mới');
  });

  it('keeps going when one file fails', async () => {
    const dir = tmp('share-');
    writeFileSync(join(dir, 'a.md'), 'ok');
    writeFileSync(join(dir, 'b.xls'), 'old excel');
    const cfg = source<FilesSource>(`{ name: s, type: files, path: ${JSON.stringify(dir)}, extensions: [.md, .xls] }`);
    const ctx = ctxFor(tmp(), 's');
    const r = await filesAdapter(cfg, ctx);
    expect(ctx.raw.list()).toEqual(['a.md']);
    expect(r.note).toContain('1 lỗi');
    expect(ctx.logs.join('\n')).toMatch(/b\.xls: chưa có cách chuyển \.xls/);
  });

  it('converts .xlsx and .docx with the bundled libraries', async () => {
    const dir = tmp('share-');
    const ExcelJS: any = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('画面一覧');
    ws.addRow(['ID', '画面名', 'Ghi chú']);
    ws.addRow(['S01', 'ログイン', 'a|b']);
    await wb.xlsx.writeFile(join(dir, '基本設計.xlsx'));
    const cfg = source<FilesSource>(`{ name: s, type: files, path: ${JSON.stringify(dir)} }`);
    const ctx = ctxFor(tmp(), 's');
    await filesAdapter(cfg, ctx);
    const body = ctx.raw.read('基本設計.xlsx.md')!.body;
    expect(body).toContain('## 画面一覧');
    expect(body).toContain('| ID | 画面名 | Ghi chú |');
    expect(body).toContain('| S01 | ログイン | a\\|b |');
  });

  it('quotes paths per platform and names raw files', () => {
    expect(quotePath("C:\\a b\\x.pdf", 'win32')).toBe('"C:\\a b\\x.pdf"');
    expect(quotePath("/a/it's.pdf", 'linux')).toBe(`'/a/it'\\''s.pdf'`);
    expect(rawPathFor('a/b.xlsx')).toBe('a/b.xlsx.md');
    expect(rawPathFor('a/b.md')).toBe('a/b.md');
  });
});

describe('teams', () => {
  const response = {
    messages: [
      {
        id: '1731900000000',
        originalarrivaltime: '2026-11-18T02:00:00.000Z',
        messagetype: 'RichText/Html',
        imdisplayname: 'Ishii Manabu',
        content: '<p>EMV の timeout は <b>30 秒</b>で確定です。</p>',
        conversationLink: 'https://x/v1/users/ME/conversations/19:abc@thread.tacv2;messageid=1731900000000',
        properties: { subject: '仕様確認' },
      },
      {
        id: '1731900300000',
        originalarrivaltime: '2026-11-18T02:05:00.000Z',
        messagetype: 'Text',
        imdisplayname: 'Hòa',
        content: '了解しました',
        conversationLink: 'https://x/v1/users/ME/conversations/19:abc@thread.tacv2;messageid=1731900000000',
        properties: { files: JSON.stringify([{ fileName: 'spec.xlsx' }]) },
      },
      { id: '1', originalarrivaltime: '2026-11-18T02:06:00.000Z', messagetype: 'ThreadActivity/AddMember', content: '<addmember/>' },
      { id: '2', originalarrivaltime: '2026-11-18T02:07:00.000Z', messagetype: 'Text', imdisplayname: 'X', content: 'xoá', properties: { deletetime: '1' } },
    ],
  };

  it('parses chat service messages, skipping system events', () => {
    const msgs = parseMessages(response);
    expect(msgs.map((m) => m.id)).toEqual(['1731900000000', '1731900300000', '2']);
    expect(msgs[0]).toMatchObject({ author: 'Ishii Manabu', text: 'EMV の timeout は 30 秒で確定です。', subject: '仕様確認', replyTo: undefined });
    expect(msgs[1]).toMatchObject({ replyTo: '1731900000000', attachments: ['spec.xlsx'] });
    expect(msgs[2]!.deleted).toBe(true);
    expect(parseMessages({ value: [] })).toEqual([]);
    expect(parseMessages(null)).toEqual([]);
  });

  it('merges by id and day, newest version wins', () => {
    const tz = 'Asia/Ho_Chi_Minh';
    const [a, b] = parseMessages(response);
    const first = mergeDay(undefined, [b!], tz, 'kênh — 2026-11-18');
    const merged = mergeDay(first, [a!, { ...b!, text: 'đã sửa', edited: true }], tz, 'kênh — 2026-11-18');
    expect(merged.match(/<!-- msg:/g)).toHaveLength(2);
    expect(merged.indexOf('msg:1731900000000')).toBeLessThan(merged.indexOf('msg:1731900300000'));
    expect(merged).toContain('**09:05 Hòa** ↳ trả lời [msg:1731900000000] (đã sửa)\nđã sửa');
    expect(merged).toContain('Đính kèm: spec.xlsx');
  });

  it('writes one file per conversation and local day', () => {
    const ctx = ctxFor(tmp(), 'teams-spec');
    const msgs = parseMessages({
      messages: [
        { id: 'a', originalarrivaltime: '2026-11-17T16:59:00Z', messagetype: 'Text', imdisplayname: 'A', content: 'trước nửa đêm VN' },
        { id: 'b', originalarrivaltime: '2026-11-17T17:01:00Z', messagetype: 'Text', imdisplayname: 'B', content: 'sau nửa đêm VN' },
      ],
    });
    writeConversation(ctx, '仕様 確認', 'https://teams/x', msgs);
    expect(ctx.raw.list()).toEqual(['仕様-確認/2026-11-17.md', '仕様-確認/2026-11-18.md']);
    expect(ctx.raw.read('仕様-確認/2026-11-18.md')!.frontmatter).toMatchObject({ conversation: '仕様 確認', date: '2026-11-18' });
  });

  it('finds the thread id in chat / channel links and opens deep links in the web app', () => {
    const chat = 'https://teams.cloud.microsoft/l/chat/19%3Aabc123%40thread.v2/conversations?context=%7B%22contextType%22%3A%22chat%22%7D';
    expect(conversationIdOf(chat)).toBe('19:abc123@thread.v2');
    expect(conversationIdOf('https://teams.microsoft.com/l/channel/19%3Axyz%40thread.tacv2/%E4%BB%95%E6%A7%98?groupId=g')).toBe('19:xyz@thread.tacv2');
    expect(conversationIdOf('https://teams.microsoft.com/v2/#/conversations/19:a-b_c@unq.gbl.spaces?ctx=chat')).toBe('19:a-b_c@unq.gbl.spaces');
    expect(conversationIdOf('https://teams.live.com/l/invite/FBAxyz')).toBeUndefined();
    expect(webAppUrl(chat)).toBe(chat.replace('/l/chat/', '/_#/l/chat/'));
    expect(webAppUrl('https://teams.microsoft.com/v2/#/conversations/19:x@thread.v2')).toBe('https://teams.microsoft.com/v2/#/conversations/19:x@thread.v2');
  });

  it('keeps only the chat service base and auth headers of a Teams web request', () => {
    const a = chatServiceAuth('https://teams.cloud.microsoft/api/chatsvc/jp/v1/users/ME/properties', {
      authorization: 'Bearer t',
      clientinfo: 'os=windows',
      cookie: 'c=1',
      'user-agent': 'x',
    });
    expect(a).toEqual({ base: 'https://teams.cloud.microsoft/api/chatsvc/jp/v1', headers: { authorization: 'Bearer t', clientinfo: 'os=windows' } });
    expect(chatServiceAuth('https://teams.cloud.microsoft/api/chatsvc/jp/v1/users/ME/properties', {})).toBeUndefined();
    expect(chatServiceAuth('https://teams.cloud.microsoft/api/mt/apac/beta/me', { authorization: 'Bearer t' })).toBeUndefined();
  });

  it('pages back through the chat service until `since`', async () => {
    const base = 'https://h/api/chatsvc/jp/v1';
    const msg = (id: string, t: string) => ({ id, originalarrivaltime: t, messagetype: 'Text', imdisplayname: 'A', content: id });
    const pages: Record<string, unknown> = {
      first: { messages: [msg('m4', '2026-11-19T00:00:00Z'), msg('m3', '2026-11-18T00:00:00Z')], _metadata: { backwardLink: 'https://h/p2' } },
      'https://h/p2': { messages: [msg('m2', '2026-11-10T00:00:00Z'), msg('m1', '2026-11-01T00:00:00Z')], _metadata: { backwardLink: 'https://h/p3' } },
      'https://h/p3': { messages: [msg('m0', '2026-10-01T00:00:00Z')] },
    };
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      return { status: 200, json: pages[url.startsWith(base) ? 'first' : url] };
    };
    const since = new Date('2026-11-05T00:00:00Z');
    const msgs = await fetchConversation(get, base, '19:abc@thread.v2', since);
    expect(msgs.map((m) => m.id).sort()).toEqual(['m2', 'm3', 'm4']);
    // stops at the page that reaches `since`: p3 is never requested
    expect(asked).toEqual([messagesUrl(base, '19:abc@thread.v2', since), 'https://h/p2']);
    expect(asked[0]).toContain('/conversations/19%3Aabc%40thread.v2/messages?');

    await expect(fetchConversation(async () => ({ status: 404 }), base, '19:x@thread.v2', since)).rejects.toThrow(/không tìm thấy/);
    await expect(fetchConversation(async () => ({ status: 401 }), base, '19:x@thread.v2', since)).rejects.toThrow(/HTTP 401/);
    expect(await fetchConversation(async () => ({ status: 200, json: { messages: [] } }), base, '19:x@thread.v2', since)).toEqual([]);
  });
});

describe('command adapter', () => {
  it('writes, removes, logs and keeps the cursor from JSON lines', async () => {
    const root = tmp();
    writeFileSync(
      join(root, 'src.mjs'),
      `const c = JSON.parse(process.env.PWIKI_CURSOR);
const out = (o) => console.log(JSON.stringify(o));
out({ log: 'cursor=' + JSON.stringify(c) });
out({ path: 'BL-1.md', frontmatter: { status: 'open' }, body: '# BL-1' });
out({ remove: 'BL-0.md' });
out({ cursor: { page: (c?.page ?? 0) + 1 } });
console.error('stderr line');`,
    );
    const cfg = source<CommandSource>('{ name: bl, type: command, command: "node src.mjs" }');
    const ctx = ctxFor(root, 'bl', { cursor: { page: 4 } });
    ctx.raw.write('BL-0.md', { frontmatter: {}, body: 'old' });
    const r = await commandAdapter(cfg, ctx);
    expect(r.cursor).toEqual({ page: 5 });
    expect(ctx.raw.list()).toEqual(['BL-1.md']);
    expect(ctx.raw.read('BL-1.md')!.frontmatter).toEqual({ source: 'bl', status: 'open' });
    expect(ctx.logs).toEqual(['  stderr line', '  cursor={"page":4}']);
  });

  it('rejects non-JSON output and failing programs', async () => {
    const root = tmp();
    await expect(commandAdapter(source<CommandSource>('{ name: x, type: command, command: "echo hello" }'), ctxFor(root, 'x'))).rejects.toThrow(/không phải JSON/);
    await expect(commandAdapter(source<CommandSource>(`{ name: x, type: command, command: 'node -e "process.exit(3)"' }`), ctxFor(root, 'x'))).rejects.toThrow(/mã 3/);
  });
});

export type { TeamsSource };
