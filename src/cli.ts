#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { collect } from './collect.js';
import { ConfigError, findRoot, loadConfig, type TeamsSource } from './config.js';
import { loadEnv } from './env.js';
import { formatPlan, markDone, plan } from './ingest.js';
import { init, PKG_ROOT, upgrade } from './scaffold.js';
import { loadState } from './state.js';
import { SESSION_FILE, TrackerClient } from './tracker/client.js';
import { describe, pull, push, readOutbox } from './tracker/sync.js';
import { git, isGitRepo } from './util.js';

const HELP = `pwiki — khung LLM Wiki cho từng dự án

Khởi tạo
  pwiki init <thư mục> --name "Tên dự án"   tạo wiki mới (git repo riêng, nên để private)
  pwiki upgrade                             cập nhật schema / slash command theo bản pwiki mới

Thu thập (raw/)
  pwiki collect [--only a,b] [--no-commit] [--record] [--headed]
  pwiki teams login [--source <tên>]        đăng nhập Teams một lần (mở trình duyệt)

Ingest (Claude Code dùng trong /ingest)
  pwiki ingest-plan [--batch 30]            các file raw/ thay đổi từ lần ingest trước
  pwiki ingest-done [file…]                 đánh dấu đã ingest (không ghi file = cả lượt)

Tracker
  pwiki tracker login                       đăng nhập (mật khẩu từ TRACKER_PASSWORD hoặc nhập tay)
  pwiki tracker pull                        lưu trạng thái dự án vào tracker/state.json
  pwiki tracker outbox                      liệt kê đề xuất trong tracker/outbox/
  pwiki tracker push [--dry-run]            gửi các đề xuất "approved": true
  pwiki tracker logout

  pwiki status                              tình trạng nguồn, ingest, outbox
`;

async function askHidden(question: string): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((res) => {
    rl.question(question, (a) => {
      rl.close();
      process.stdout.write('\n');
      res(a);
    });
    muted = true;
  });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: v, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      name: { type: 'string' },
      only: { type: 'string' },
      'no-commit': { type: 'boolean' },
      record: { type: 'boolean' },
      headed: { type: 'boolean' },
      batch: { type: 'string' },
      source: { type: 'string' },
      'dry-run': { type: 'boolean' },
      root: { type: 'string' },
    },
  });
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return 0;
  }
  if (cmd === '--version' || cmd === 'version') {
    console.log(JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version);
    return 0;
  }
  if (cmd === 'init') {
    const dir = resolve(pos[0] ?? '.');
    init(dir, String(v.name ?? pos[1] ?? 'Dự án'));
    console.log('Tiếp theo: sửa sources.yaml và CLAUDE.md, tạo .env từ .env.example, rồi "pwiki collect".');
    return 0;
  }

  const root = findRoot(String(v.root ?? process.cwd()));
  const config = loadConfig(root);

  switch (cmd) {
    case 'upgrade':
      upgrade(root);
      return 0;
    case 'collect': {
      const s = await collect(root, config, {
        only: v.only ? String(v.only).split(',').map((x) => x.trim()) : undefined,
        commit: v['no-commit'] ? false : undefined,
        record: !!v.record,
        headed: !!v.headed,
      });
      return s.ok ? 0 : 1;
    }
    case 'teams': {
      if (pos[0] !== 'login') break;
      const teams = config.sources.filter((s): s is TeamsSource => s.type === 'teams');
      const src = v.source ? teams.find((s) => s.name === v.source) : teams[0];
      if (!src) throw new ConfigError(v.source ? `Không có nguồn teams "${v.source}"` : 'sources.yaml chưa có nguồn type: teams');
      const { teamsLogin } = await import('./adapters/teams.js');
      await teamsLogin(root, src);
      console.log('Đã lưu phiên Teams.');
      return 0;
    }
    case 'ingest-plan': {
      const p = plan(root);
      console.log(formatPlan(p, Number(v.batch ?? 30)));
      return 0;
    }
    case 'ingest-done': {
      const left = markDone(root, pos);
      console.log(left ? `Còn ${left} file chưa ingest trong lượt này.` : 'Lượt ingest đã xong.');
      if (!left && config.git.autoCommit && isGitRepo(root)) {
        git(root, ['add', '--', '.pwiki/state.json']);
        git(root, ['commit', '--quiet', '-m', 'ingest: xong lượt', '--', '.pwiki/state.json'], { allowFail: true });
      }
      return 0;
    }
    case 'tracker': {
      const sub = pos[0];
      if (!config.tracker) throw new ConfigError('sources.yaml chưa có mục tracker');
      const client = new TrackerClient(root, config.tracker);
      if (sub === 'login') {
        const env = { ...loadEnv(root), ...process.env };
        const pw = config.tracker.devUser ? '' : env.TRACKER_PASSWORD || (await askHidden(`Mật khẩu tracker của ${config.tracker.email}: `));
        await client.login(pw);
        console.log('Đã đăng nhập tracker.');
        return 0;
      }
      if (sub === 'logout') {
        client.logout();
        return 0;
      }
      if (sub === 'pull') {
        const d = await pull(root, config);
        console.log(`Đã lưu tracker/state.json: ${d.project?.name ?? config.tracker.projectId}, ${d.items?.length ?? 0} mục.`);
        return 0;
      }
      if (sub === 'outbox') {
        const entries = readOutbox(root);
        if (!entries.length) console.log('Outbox trống.');
        for (const e of entries) console.log(e.proposal ? `${e.proposal.approved ? '✔' : '·'} ${e.file}  ${describe(e.proposal)}` : `✗ ${e.file}  ${e.error}`);
        return 0;
      }
      if (sub === 'push') {
        const r = await push(root, config, { dryRun: !!v['dry-run'] });
        console.log(`Gửi ${r.sent.length}, chưa duyệt ${r.skipped.length}, lỗi ${r.failed.length}.`);
        return r.failed.length ? 1 : 0;
      }
      break;
    }
    case 'status': {
      const state = loadState(root);
      console.log(`Dự án: ${config.project.name}`);
      for (const s of config.sources) {
        const r = state.lastCollect?.results[s.name];
        console.log(`  ${s.enabled ? '●' : '○'} ${s.name} (${s.type})${r ? ` — lần trước: ${r.ok ? `ok, ${r.note ?? ''}` : `LỖI ${r.error}`}` : ''}`);
      }
      if (state.lastCollect) console.log(`Collect gần nhất: ${state.lastCollect.at}`);
      if (isGitRepo(root)) {
        const head = git(root, ['rev-parse', 'HEAD'], { allowFail: true }).trim();
        const changed = state.ingestedRev
          ? git(root, ['diff', '--name-only', state.ingestedRev, head, '--', 'raw'], { allowFail: true }).trim()
          : git(root, ['ls-files', '--', 'raw'], { allowFail: true }).trim();
        const n = changed ? changed.split('\n').filter((f) => !f.endsWith('.gitkeep')).length : 0;
        console.log(`Chờ ingest: ${n} file raw${state.ingestedRev ? ` (từ ${state.ingestedRev.slice(0, 8)})` : ' (chưa ingest lần nào)'}`);
      }
      const out = readOutbox(root);
      console.log(`Outbox: ${out.length} đề xuất (${out.filter((e) => e.proposal?.approved).length} đã duyệt, ${out.filter((e) => e.error).length} lỗi)`);
      if (config.tracker) console.log(`Tracker: ${config.tracker.projectId} — ${existsSync(join(root, '.pwiki', SESSION_FILE)) ? 'đã đăng nhập' : 'chưa đăng nhập'}`);
      return 0;
    }
  }
  console.error(`Lệnh không hợp lệ: ${argv.join(' ')}\n`);
  console.log(HELP);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof ConfigError ? e.message : `Lỗi: ${(e as Error).message}`);
    process.exit(1);
  },
);
