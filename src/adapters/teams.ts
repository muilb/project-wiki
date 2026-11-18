// Microsoft Teams without a bot or admin consent: a real browser (Playwright, persistent profile signed
// in once with `pwiki teams login`) opens each conversation, and we keep the JSON the Teams web client
// itself downloads (its chat service "messages" responses) instead of scraping the page, which changes
// often and only renders the visible messages.
//
// raw/<source>/<conversation>/<YYYY-MM-DD>.md, one block per message, merged by message id.
// The response format is not a public API: run `pwiki collect --only <source> --record` to save what the
// browser received under .pwiki/teams-debug/ and adjust parseMessages() if your tenant differs.
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
  try {
    for (const conv of cfg.conversations) {
      const since = cursor[conv.name]?.last ? new Date(Date.parse(cursor[conv.name]!.last) - 3_600_000) : daysAgo(ctx.now, cfg.lookbackDays);
      const page = await browser.newPage();
      const seen = new Map<string, TeamsMessage>();
      page.on('response', async (res: any) => {
        const url: string = res.url();
        if (!/\/messages(\?|$)/.test(url)) return;
        if (!(res.headers()['content-type'] ?? '').includes('json')) return;
        try {
          const json = await res.json();
          if (ctx.options.record) {
            mkdirSync(debugDir, { recursive: true });
            writeFileSync(join(debugDir, `${Date.now()}-${++recorded}.json`), JSON.stringify({ url, json }, null, 2));
          }
          for (const m of parseMessages(json)) seen.set(m.id, m);
        } catch {
          /* not JSON after all, or body already consumed */
        }
      });
      await page.goto(conv.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
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
      const msgs = [...seen.values()].filter((m) => Date.parse(m.time) >= since.getTime());
      if (!seen.size) ctx.log(`  ${conv.name}: không bắt được tin nhắn nào (thử --headed --record để xem)`);
      total += msgs.length;
      writeConversation(ctx, conv.name, conv.url, msgs);
      const last = msgs.reduce<string | undefined>((a, m) => (!a || m.time > a ? m.time : a), cursor[conv.name]?.last);
      if (last) cursor[conv.name] = { last };
    }
  } finally {
    await browser.close();
  }
  return { cursor, note: `${total} tin nhắn${recorded ? `, ghi ${recorded} response vào .pwiki/teams-debug/` : ''}` };
};

async function launch(playwright: any, profile: string, browser: TeamsSource['browser'], headless: boolean) {
  const opts = { headless, viewport: { width: 1400, height: 900 }, locale: 'ja-JP' };
  if (browser === 'chromium') return playwright.chromium.launchPersistentContext(profile, opts);
  try {
    return await playwright.chromium.launchPersistentContext(profile, { ...opts, channel: browser });
  } catch (e) {
    throw new Error(`Không mở được ${browser} (${(e as Error).message.split('\n')[0]}). Đặt browser: chromium trong sources.yaml nếu máy không có ${browser}.`);
  }
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
  await page.goto(cfg.conversations[0]?.url ?? 'https://teams.microsoft.com/', { waitUntil: 'domcontentloaded' });
  await useWebApp(page);
  console.log('Đăng nhập Teams trong cửa sổ vừa mở (kể cả MFA). Khi đã thấy được tin nhắn, đóng cửa sổ trình duyệt để lưu phiên.');
  await new Promise<void>((r) => ctx.on('close', () => r()));
}
