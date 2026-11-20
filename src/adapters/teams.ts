// Microsoft Teams without a bot or admin consent: a real browser (Playwright, persistent profile signed
// in once with `pwiki teams login`) opens Teams web, and we read the same chat service JSON the web client
// uses ("…/conversations/<id>/messages"), never the page DOM, which changes often and only renders the
// visible messages.
//
// Main path: reuse the auth headers of Teams web's own chat service requests and page back through each
// conversation. Listening to the responses Teams downloads (the fallback) misses messages it already has
// in its IndexedDB cache, i.e. almost everything after the first visit.
//
// raw/<source>/<conversation>/<YYYY-MM-DD>.md, one block per message, merged by message id.
// The response format is not a public API: run `pwiki collect --only <source> --record` to save the
// responses (bodies only, never headers) under .pwiki/teams-debug/ and adjust parseMessages() if needed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { TeamsSource } from '../config.js';
import { PWIKI_DIR } from '../state.js';
import { dayIn, daysAgo, htmlToText, timeIn } from '../util.js';
import type { Adapter } from './types.js';

export interface TeamsMessage {
  id: string;
  time: string; // ISO
  author: string;
  text: string;
  /** Root message of the reply chain, when this is a reply in a channel thread. */
  replyTo?: string;
  subject?: string;
  edited?: boolean;
  deleted?: boolean;
  attachments?: string[];
}

const SKIP_TYPES = /^(ThreadActivity|Event|Control|RichText\/Media_CallRecording|RichText\/Media_CallTranscript)/i;

function attachmentsOf(props: any): string[] {
  try {
    const files = typeof props?.files === 'string' ? JSON.parse(props.files) : props?.files;
    return Array.isArray(files) ? files.map((f: any) => f.fileName ?? f.title ?? f.objectUrl).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Messages in one chat-service JSON response ({ messages: [...] }); unknown shapes give []. */
export function parseMessages(json: unknown): TeamsMessage[] {
  const list = (json as any)?.messages;
  if (!Array.isArray(list)) return [];
  const out: TeamsMessage[] = [];
  for (const m of list) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') continue;
    const type = String(m.messagetype ?? m.messageType ?? '');
    if (SKIP_TYPES.test(type)) continue;
    const time = m.originalarrivaltime ?? m.composetime ?? m.createdDateTime;
    if (!time || Number.isNaN(Date.parse(time))) continue;
    const props = m.properties ?? {};
    const link: string = m.conversationLink ?? m.conversationid ?? '';
    const root = /;messageid=(\d+)/.exec(link)?.[1];
    const content = String(m.content ?? '');
    out.push({
      id: m.id,
      time: new Date(Date.parse(time)).toISOString(),
      author: String(m.imdisplayname ?? m.fromDisplayName ?? m.from?.user?.displayName ?? '?'),
      text: /html/i.test(type) || /<[a-z][\s\S]*>/i.test(content) ? htmlToText(content) : content.trim(),
      replyTo: root && root !== m.id ? root : undefined,
      subject: props.subject || undefined,
      edited: !!props.edittime || undefined,
      deleted: !!props.deletetime || undefined,
      attachments: attachmentsOf(props),
    });
  }
  return out;
}

const BLOCK = /<!-- msg:(\S+) t:(\S+) -->\n([\s\S]*?)(?=\n<!-- msg:|\s*$)/g;

export function renderMessage(m: TeamsMessage, tz: string): string {
  const head = [`**${timeIn(tz, new Date(m.time))} ${m.author}**`];
  if (m.replyTo) head.push(`↳ trả lời [msg:${m.replyTo}]`);
  if (m.edited) head.push('(đã sửa)');
  const lines = [`<!-- msg:${m.id} t:${m.time} -->`, head.join(' ')];
  if (m.subject) lines.push(`Tiêu đề: ${m.subject}`);
  lines.push(m.deleted ? '(tin nhắn đã bị xoá)' : m.text || '(không có chữ)');
  if (m.attachments?.length) lines.push(`Đính kèm: ${m.attachments.join(', ')}`);
  return lines.join('\n');
}

/** Merges messages into a day file body: same id → newer version replaces it; sorted by time. */
export function mergeDay(prevBody: string | undefined, msgs: TeamsMessage[], tz: string, title: string): string {
  const blocks = new Map<string, { t: string; text: string }>();
  for (const m of (prevBody ?? '').matchAll(BLOCK)) blocks.set(m[1]!, { t: m[2]!, text: `<!-- msg:${m[1]} t:${m[2]} -->\n${m[3]!.trimEnd()}` });
  for (const m of msgs) blocks.set(m.id, { t: m.time, text: renderMessage(m, tz) });
  const sorted = [...blocks.values()].sort((a, b) => a.t.localeCompare(b.t));
  return [`# ${title}`, ...sorted.map((b) => b.text)].join('\n\n');
}

export const slug = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[\s/\\]+/g, '-')
    .replace(/[<>:"|?*]/g, '')
    .slice(0, 60) || 'conversation';

export function writeConversation(
  ctx: Parameters<Adapter<TeamsSource>>[1],
  convName: string,
  convUrl: string,
  msgs: TeamsMessage[],
): number {
  const byDay = new Map<string, TeamsMessage[]>();
  for (const m of msgs) {
    const d = dayIn(ctx.timezone, new Date(m.time));
    byDay.set(d, [...(byDay.get(d) ?? []), m]);
  }
  let changed = 0;
  for (const [day, list] of byDay) {
    const rel = `${slug(convName)}/${day}.md`;
    const prev = ctx.raw.read(rel);
    const body = mergeDay(prev?.body, list, ctx.timezone, `${convName} — ${day}`);
    if (ctx.raw.write(rel, { frontmatter: { source: 'teams', conversation: convName, url: convUrl, date: day }, body })) changed++;
  }
  return changed;
}

/** Teams thread id in a conversation link: 19:…@thread.v2 / @thread.tacv2 / @thread.skype / @unq.gbl.spaces. */
export function conversationIdOf(url: string): string | undefined {
  let s = url;
  try {
    s = decodeURIComponent(url);
  } catch {
    /* keep as is */
  }
  return /19:[^/?#&;\s]+@(?:thread\.[a-z0-9]+|unq\.gbl\.spaces)/i.exec(s)?.[0];
}

/** Deep links (https://host/l/…) stop at the "desktop app or web?" launcher, which does nothing headless.
 *  The same link under /_#/ opens the web app directly. */
export function webAppUrl(url: string): string {
  return url.replace(/^(https:\/\/[^/]+)\/l\//i, '$1/_#/l/');
}

/** Chat service base (https://host/api/chatsvc/<region>/v1) and the auth headers of a request Teams web sent. */
export function chatServiceAuth(url: string, headers: Record<string, string>): { base: string; headers: Record<string, string> } | undefined {
  const base = /^(https:\/\/[^/]+\/api\/chatsvc\/[^/]+\/v1)\//i.exec(url)?.[1];
  if (!base || !(headers.authorization || headers.authentication)) return undefined;
  const keep = Object.entries(headers).filter(([k]) => /^(authorization|authentication|behavioroverride|clientinfo|x-ms-migration)$/i.test(k));
  return { base, headers: Object.fromEntries(keep) };
}

export function messagesUrl(base: string, conversationId: string, since: Date, pageSize = 200): string {
  return `${base}/users/ME/conversations/${encodeURIComponent(conversationId)}/messages?view=msnp24Equivalent&pageSize=${pageSize}&startTime=${since.getTime()}`;
}

export type JsonGet = (url: string) => Promise<{ status: number; json?: unknown }>;

/** Pages back through the chat service (newest first, `_metadata.backwardLink`) until `since`. */
export async function fetchConversation(
  get: JsonGet,
  base: string,
  conversationId: string,
  since: Date,
  onPage?: (url: string, json: unknown) => void,
  maxPages = 100,
): Promise<TeamsMessage[]> {
  const seen = new Map<string, TeamsMessage>();
  let url: string | undefined = messagesUrl(base, conversationId, since);
  for (let i = 0; url && i < maxPages; i++) {
    const res = await get(url);
    if (res.status === 401 || res.status === 403) throw new Error(`Teams từ chối truy cập (HTTP ${res.status}): chạy "pwiki teams login" lại`);
    if (res.status === 404) throw new Error(`không tìm thấy cuộc trò chuyện ${conversationId} (tài khoản đang đăng nhập có ở trong chat / kênh này không?)`);
    if (res.status < 200 || res.status >= 300) throw new Error(`chat service trả HTTP ${res.status}`);
    onPage?.(url, res.json);
    const raw = (res.json as any)?.messages;
    if (!Array.isArray(raw) || !raw.length) break;
    for (const m of parseMessages(res.json)) seen.set(m.id, m);
    const times = raw.map((m: any) => Date.parse(m?.originalarrivaltime ?? m?.composetime ?? '')).filter((t: number) => !Number.isNaN(t));
    if (times.length && Math.min(...times) <= since.getTime()) break;
    const next: unknown = (res.json as any)?._metadata?.backwardLink;
    url = typeof next === 'string' && next && next !== url ? next : undefined;
  }
  return [...seen.values()].filter((m) => Date.parse(m.time) >= since.getTime());
}

export const teamsAdapter: Adapter<TeamsSource> = async (cfg, ctx) => {
  let playwright: any;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error('Chưa cài Playwright: chạy "npm i -g playwright" (hoặc cài pwiki kèm optional dependencies)');
  }
  const profile = isAbsolute(cfg.profileDir) ? cfg.profileDir : resolve(ctx.root, cfg.profileDir);
  const browser = await launch(playwright, profile, cfg.browser, !ctx.options.headed);
  const cursor = { ...((ctx.cursor as Record<string, { last: string }> | undefined) ?? {}) };
  const debugDir = join(ctx.root, PWIKI_DIR, 'teams-debug');
  let total = 0;
  let recorded = 0;
  const record = (url: string, json: unknown) => {
    if (!ctx.options.record) return;
    mkdirSync(debugDir, { recursive: true });
    // Only the response body (messages), never request headers / tokens.
    writeFileSync(join(debugDir, `${Date.now()}-${++recorded}.json`), JSON.stringify({ url: url.split('?')[0], json }, null, 2));
  };
  try {
    // Main path: Teams web loads with the saved sign-in; we reuse the auth headers of its own chat-service
    // requests to page through each conversation. Teams caches messages in IndexedDB, so listening to what it
    // downloads misses everything already cached. The headers stay in memory and are never written.
    let auth: ReturnType<typeof chatServiceAuth>;
    browser.on('request', (req: any) => {
      if (!auth) auth = chatServiceAuth(req.url(), req.headers());
    });
    const first = cfg.conversations[0]!;
    const page = await browser.newPage();
    await page.goto(webAppUrl(first.url), { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await useWebApp(page);
    for (let i = 0; i < 60 && !auth; i++) {
      if (/login\.microsoftonline\.com|login\.live\.com/.test(page.url())) {
        throw new Error(`Phiên đăng nhập Teams đã hết: chạy "pwiki teams login --source ${cfg.name}"`);
      }
      await page.waitForTimeout(1000);
    }
    if (!auth) ctx.log('  không bắt được request chat service của Teams web: chuyển sang cách nghe response');
    const get: JsonGet = async (url) => {
      const res = await browser.request.get(url, { headers: auth!.headers, timeout: 60_000 });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        /* not JSON */
      }
      return { status: res.status(), json };
    };

    for (const conv of cfg.conversations) {
      const since = cursor[conv.name]?.last ? new Date(Date.parse(cursor[conv.name]!.last) - 3_600_000) : daysAgo(ctx.now, cfg.lookbackDays);
      const id = conversationIdOf(conv.url);
      let msgs: TeamsMessage[];
      if (auth && id) {
        try {
          msgs = await fetchConversation(get, auth.base, id, since, record);
        } catch (e) {
          // Expired sign-in fails the whole source; one missing chat should not block the others.
          if (/HTTP 40[13]/.test((e as Error).message)) throw e;
          ctx.log(`  ${conv.name}: ${(e as Error).message}`);
          continue;
        }
      } else {
        if (!id) ctx.log(`  ${conv.name}: không thấy mã 19:…@thread trong url, dùng cách nghe response`);
        msgs = await listenConversation(browser, conv.url, since, cfg, record);
      }
      if (!msgs.length) ctx.log(`  ${conv.name}: không có tin nhắn mới`);
      total += msgs.length;
      writeConversation(ctx, conv.name, conv.url, msgs);
      const last = msgs.reduce<string | undefined>((a, m) => (!a || m.time > a ? m.time : a), cursor[conv.name]?.last);
      if (last) cursor[conv.name] = { last };
    }
    await page.close();
  } finally {
    await browser.close();
  }
  return { cursor, note: `${total} tin nhắn${recorded ? `, ghi ${recorded} response vào .pwiki/teams-debug/` : ''}` };
};

/** Fallback: open the conversation and keep the chat-service responses Teams web downloads while scrolling up. */
async function listenConversation(
  browser: any,
  url: string,
  since: Date,
  cfg: TeamsSource,
  record: (url: string, json: unknown) => void,
): Promise<TeamsMessage[]> {
  const page = await browser.newPage();
  const seen = new Map<string, TeamsMessage>();
  page.on('response', async (res: any) => {
    const u: string = res.url();
    if (!/\/messages(\?|$)/.test(u)) return;
    if (!(res.headers()['content-type'] ?? '').includes('json')) return;
    try {
      const json = await res.json();
      record(u, json);
      for (const m of parseMessages(json)) seen.set(m.id, m);
    } catch {
      /* not JSON after all, or body already consumed */
    }
  });
  await page.goto(webAppUrl(url), { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await useWebApp(page);
  if (/login\.microsoftonline\.com|login\.live\.com/.test(page.url())) {
    throw new Error(`Phiên đăng nhập Teams đã hết: chạy "pwiki teams login --source ${cfg.name}"`);
  }
  await page.waitForTimeout(8000);
  // Scroll the conversation up until we reach `since` or nothing new arrives.
  let idle = 0;
  for (let i = 0; i < cfg.maxScrolls && idle < 3; i++) {
    const oldest = [...seen.values()].reduce<string | undefined>((a, m) => (!a || m.time < a ? m.time : a), undefined);
    if (oldest && Date.parse(oldest) <= since.getTime()) break;
    const before = seen.size;
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };
    await page.mouse.move(vp.width * 0.6, vp.height * 0.5);
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(1500);
    idle = seen.size === before ? idle + 1 : 0;
  }
  await page.close();
  return [...seen.values()].filter((m) => Date.parse(m.time) >= since.getTime());
}

async function launch(playwright: any, profile: string, browser: TeamsSource['browser'], headless: boolean) {
  const opts = { headless, viewport: { width: 1400, height: 900 }, locale: 'ja-JP' };
  const open = async (extra: Record<string, unknown> = {}) => {
    if (browser === 'chromium') return playwright.chromium.launchPersistentContext(profile, { ...opts, ...extra });
    try {
      return await playwright.chromium.launchPersistentContext(profile, { ...opts, ...extra, channel: browser });
    } catch (e) {
      throw new Error(`Không mở được ${browser} (${(e as Error).message.split('\n')[0]}). Đặt browser: chromium trong sources.yaml nếu máy không có ${browser}.`);
    }
  };
  const ctx = await open();
  if (!headless) return ctx;
  // Headless browsers announce "HeadlessChrome" and Teams web then renders a blank page: relaunch with the
  // same user agent minus that word.
  const probe = await ctx.newPage();
  const ua: string = await probe.evaluate(() => navigator.userAgent);
  if (!/Headless/i.test(ua)) {
    await probe.close();
    return ctx;
  }
  await ctx.close();
  return open({ userAgent: ua.replace(/HeadlessChrome/g, 'Chrome').replace(/Headless/g, '') });
}

/** Deep links (teams.microsoft.com/l/…) first ask "app or web?": choose the web app. */
async function useWebApp(page: any) {
  try {
    const btn = page.getByRole('button', { name: /web app|Web アプリ|ứng dụng web|Use the web/i }).first();
    if (await btn.isVisible({ timeout: 4000 })) await btn.click();
  } catch {
    /* no launcher page */
  }
}

/** Opens Teams in a visible browser with the source's profile so the user can sign in (MFA) once. */
export async function teamsLogin(root: string, cfg: TeamsSource): Promise<void> {
  const playwright: any = await import('playwright');
  const profile = isAbsolute(cfg.profileDir) ? cfg.profileDir : resolve(root, cfg.profileDir);
  const ctx = await launch(playwright, profile, cfg.browser, false);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(cfg.conversations[0] ? webAppUrl(cfg.conversations[0].url) : 'https://teams.microsoft.com/', { waitUntil: 'domcontentloaded' });
  await useWebApp(page);
  console.log('Đăng nhập Teams trong cửa sổ vừa mở (kể cả MFA). Khi đã thấy được tin nhắn, đóng cửa sổ trình duyệt để lưu phiên.');
  await new Promise<void>((r) => ctx.on('close', () => r()));
}
