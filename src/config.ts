// sources.yaml: what one project's wiki collects and where it reports.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { ALL_SECTIONS, FILE_SECTIONS, Layout, PAGE_SECTIONS, type PageSection, type SectionKey } from './layout.js';

export const CONFIG_FILE = 'sources.yaml';

const name = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'name: chỉ chữ thường, số, "-", "_" (tối đa 40 ký tự), dùng làm tên thư mục trong raw/');

const base = { name, enabled: z.boolean().default(true) };

export const teamsSourceSchema = z.object({
  ...base,
  type: z.literal('teams'),
  /** Channels / chats to read. `url` is the link from "Copy link" (channel) or the chat's address in Teams web. */
  conversations: z
    .array(z.object({ name: z.string().min(1).max(80), url: z.url() }))
    .min(1),
  /** First run (no cursor): how far back to read. */
  lookbackDays: z.number().int().min(1).max(365).default(14),
  /** Profile folder of the browser that keeps the Teams sign-in (never committed). */
  profileDir: z.string().default('.pwiki/teams-profile'),
  /** msedge / chrome use the browser installed on the PC (better with company sign-in policies). */
  browser: z.enum(['msedge', 'chrome', 'chromium']).default('msedge'),
  /** How many times to scroll up per conversation looking for older messages. */
  maxScrolls: z.number().int().min(0).max(500).default(40),
});

export const gitSourceSchema = z.object({
  ...base,
  type: z.literal('git'),
  /** Path to a local clone (relative to the wiki root or absolute). Source code is never copied. */
  repo: z.string().min(1),
  branch: z.string().default('HEAD'),
  /** Run `git fetch` before reading (then reads `origin/<branch>` when branch is not HEAD). */
  fetch: z.boolean().default(false),
  /** First run (no cursor): commits after this date (YYYY-MM-DD). Default: 30 days ago. */
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Ticket ids found in commit messages, e.g. Jira / Backlog keys. */
  ticketPattern: z.string().default('[A-Z][A-Z0-9_]+-\\d+'),
  /** Paths (prefix match) left out of the changed-file lists, e.g. generated code. */
  ignorePaths: z.array(z.string()).default([]),
});

export const jiraSourceSchema = z.object({
  ...base,
  type: z.literal('jira'),
  baseUrl: z.url(),
  /** cloud: email + API token (Basic). server: Data Center / Server personal access token (Bearer). */
  deployment: z.enum(['cloud', 'server']).default('cloud'),
  jql: z.string().min(1),
  emailEnv: z.string().default('JIRA_EMAIL'),
  tokenEnv: z.string().default('JIRA_TOKEN'),
  /** First run (no cursor): issues updated in the last N days. */
  lookbackDays: z.number().int().min(1).max(3650).default(90),
  /** Extra fields to keep (custom fields), e.g. customfield_10020 for sprint. */
  extraFields: z.array(z.string()).default([]),
  maxComments: z.number().int().min(0).max(500).default(50),
});

export const filesSourceSchema = z.object({
  ...base,
  type: z.literal('files'),
  /** Folder to mirror: file server share, a synced OneDrive / SharePoint folder… */
  path: z.string().min(1),
  extensions: z.array(z.string().regex(/^\.[A-Za-z0-9]+$/)).default(['.md', '.txt', '.csv', '.docx', '.xlsx']),
  /** A file is skipped when its relative path (with "/") contains one of these. "~$" = Office lock files. */
  exclude: z.array(z.string()).default(['~$', '/.git/', 'node_modules/']),
  maxFileMB: z.number().min(0.1).max(500).default(20),
  /** Command per extension that prints markdown on stdout; {file} is replaced by the quoted path. */
  converters: z.record(z.string().regex(/^\.[A-Za-z0-9]+$/), z.string().min(1)).default({}),
  /** Max rows per sheet when converting .xlsx. */
  maxSheetRows: z.number().int().min(10).max(100_000).default(2000),
});

export const commandSourceSchema = z.object({
  ...base,
  type: z.literal('command'),
  /** Any program that prints JSON lines (see README "Nguồn tuỳ biến"). Runs in the wiki root. */
  command: z.string().min(1),
  timeoutSeconds: z.number().int().min(1).max(3600).default(300),
});

export const sourceSchema = z.discriminatedUnion('type', [
  teamsSourceSchema,
  gitSourceSchema,
  jiraSourceSchema,
  filesSourceSchema,
  commandSourceSchema,
]);

const sectionKey = z.enum(ALL_SECTIONS as [SectionKey, ...SectionKey[]]);

export const layoutSchema = z
  .object({
    /** numbered: 00_Index, 10_Domain… at the vault root. flat: everything under wiki/. */
    preset: z.enum(['numbered', 'flat']).default('numbered'),
    /** wikilink: [[30_Decisions/x]] (best in Obsidian). markdown: [x](../30_Decisions/x.md) (also renders on GitHub / GitLab). */
    links: z.enum(['wikilink', 'markdown']).default('wikilink'),
    /** inside: 30_Decisions/30_Decisions.md. beside: 30_Decisions.md next to the folder. */
    moc: z.enum(['inside', 'beside']).default('inside'),
    /** Regenerate pages under the snapshots section after collect / tracker pull. */
    snapshots: z.boolean().default(true),
    /** Override any section path, e.g. changes: 70_PR. */
    sections: z.partialRecord(sectionKey, z.string().min(1).regex(/^(?!.*\.\.)[^:*?"<>|]+$/, 'đường dẫn tương đối, không chứa ".."')).default({}),
    /** Frontmatter type per section, when the vault already uses its own names, e.g. changes: pr. */
    types: z.partialRecord(z.enum(PAGE_SECTIONS as [PageSection, ...PageSection[]]), z.string().regex(/^[a-z][a-z0-9_-]*$/)).default({}),
    /** Vault paths (prefix) that lint leaves alone, e.g. runtime/ of another tool. */
    ignore: z.array(z.string()).default([]),
  })
  .superRefine((l, ctx) => {
    for (const k of FILE_SECTIONS) {
      const v = l.sections[k];
      const ext = k === 'dashboard' ? '.base' : '.md';
      if (v && !v.endsWith(ext)) ctx.addIssue({ code: 'custom', path: ['sections', k], message: `${k} là một file ${ext}` });
    }
  });

export const configSchema = z
  .object({
    project: z.object({
      name: z.string().min(1),
      /** Day boundaries of raw files (Teams days, git days). */
      timezone: z.string().default('Asia/Ho_Chi_Minh'),
    }),
    git: z.object({ autoCommit: z.boolean().default(true) }).prefault({}),
    layout: layoutSchema.prefault({}),
    tracker: z
      .object({
        /** The project-tracker web address (its /config.json gives the API and Cognito). */
        url: z.url().optional(),
        /** Or give the API directly (local dev: http://localhost:3001 with devUser). */
        apiUrl: z.url().optional(),
        devUser: z.email().optional(),
        projectId: z.string().min(1).max(40),
        email: z.email().optional(),
        /** Append "Nguồn: …" (evidence) to rawText of updates. */
        evidenceInRawText: z.boolean().default(true),
      })
      .refine((t) => t.url || t.apiUrl, 'tracker: cần url (web của tracker) hoặc apiUrl')
      .optional(),
    sources: z.array(sourceSchema).default([]),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    for (const [i, s] of c.sources.entries()) {
      if (seen.has(s.name)) ctx.addIssue({ code: 'custom', path: ['sources', i, 'name'], message: `name "${s.name}" bị trùng` });
      seen.add(s.name);
    }
  });

export type Config = z.infer<typeof configSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export type TeamsSource = z.infer<typeof teamsSourceSchema>;
export type GitSource = z.infer<typeof gitSourceSchema>;
export type JiraSource = z.infer<typeof jiraSourceSchema>;
export type FilesSource = z.infer<typeof filesSourceSchema>;
export type CommandSource = z.infer<typeof commandSourceSchema>;
export type TrackerConfig = NonNullable<Config['tracker']>;

export class ConfigError extends Error {}

export const layoutOf = (c: Config) => new Layout(c.layout);

export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = parse(text) ?? {};
  } catch (e) {
    throw new ConfigError(`${CONFIG_FILE}: YAML không hợp lệ: ${(e as Error).message}`);
  }
  const r = configSchema.safeParse(raw);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '(gốc)'}: ${i.message}`);
    throw new ConfigError(`${CONFIG_FILE} có lỗi:\n${lines.join('\n')}`);
  }
  return r.data;
}

export function loadConfig(root: string): Config {
  return parseConfig(readFileSync(join(root, CONFIG_FILE), 'utf8'));
}

/** The wiki root: the nearest folder (from `start` upwards) holding sources.yaml. */
export function findRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new ConfigError(`Không tìm thấy ${CONFIG_FILE} (chạy lệnh trong thư mục wiki của dự án, hoặc "pwiki init").`);
    dir = up;
  }
}
