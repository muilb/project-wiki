// command: any program (Python, PowerShell, Node…) that prints JSON lines. This is how a project adds
// a source the framework does not ship (Backlog, Redmine, email, a database…) without changing pwiki.
//
// Input (environment): PWIKI_CURSOR (JSON of the last cursor, "null" on the first run), PWIKI_SOURCE,
// PWIKI_TIMEZONE, PWIKI_RAW_DIR. Output, one JSON object per line:
//   {"path": "BL-12.md", "frontmatter": {...}, "body": "..."}   write raw/<source>/BL-12.md
//   {"remove": "BL-3.md"}                                       delete it
//   {"cursor": <any JSON>}                                       cursor for the next run (last one wins)
//   {"log": "text"}                                              shown in the collect output
import { spawnSync } from 'node:child_process';
import type { CommandSource } from '../config.js';
import type { Adapter } from './types.js';

export const commandAdapter: Adapter<CommandSource> = async (cfg, ctx) => {
  const r = spawnSync(cfg.command, {
    cwd: ctx.root,
    shell: true,
    encoding: 'utf8',
    timeout: cfg.timeoutSeconds * 1000,
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...ctx.env,
      PWIKI_CURSOR: JSON.stringify(ctx.cursor ?? null),
      PWIKI_SOURCE: cfg.name,
      PWIKI_TIMEZONE: ctx.timezone,
      PWIKI_RAW_DIR: ctx.raw.dir,
    },
  });
  if (r.error) throw new Error(`Không chạy được "${cfg.command}": ${r.error.message}`);
  for (const l of r.stderr.split('\n').filter(Boolean)) ctx.log(`  ${l}`);
  if (r.status !== 0) throw new Error(`"${cfg.command}" kết thúc với mã ${r.status}`);

  let cursor: unknown = ctx.cursor;
  let docs = 0;
  for (const [i, line] of r.stdout.split('\n').entries()) {
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      throw new Error(`Dòng ${i + 1} của "${cfg.command}" không phải JSON: ${line.slice(0, 120)}`);
    }
    if (typeof msg.path === 'string') {
      if (typeof msg.body !== 'string') throw new Error(`Dòng ${i + 1}: thiếu "body" (chuỗi)`);
      ctx.raw.write(msg.path, { frontmatter: { source: cfg.name, ...(msg.frontmatter ?? {}) }, body: msg.body });
      docs++;
    } else if (typeof msg.remove === 'string') ctx.raw.remove(msg.remove);
    else if ('cursor' in msg) cursor = msg.cursor;
    else if (typeof msg.log === 'string') ctx.log(`  ${msg.log}`);
    else throw new Error(`Dòng ${i + 1}: không hiểu ${line.slice(0, 120)}`);
  }
  return { cursor, note: `${docs} tài liệu` };
};
