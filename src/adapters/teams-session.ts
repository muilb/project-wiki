// Where a Teams source keeps its browser sign-in, and the checks around it: one profile per source by
// default, never inside the git history, never opened by two pwiki runs at once, and signed in with the
// account the source expects. Nothing here needs Playwright, so it is unit-tested directly.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { TeamsSource } from '../config.js';
import { isGitRepo } from '../util.js';

/** Default parent of the per-source profiles; also where the single shared profile of pwiki ≤ 0.1 lived. */
export const PROFILE_ROOT = '.pwiki/teams-profile';
const LOCK_FILE = 'pwiki.lock';
/** A lock older than this is from a run that crashed without cleaning up. */
const LOCK_STALE_MS = 12 * 3_600_000;

export function expandHome(p: string, home = homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p;
}

/** Absolute profile folder of a source: `profileDir` (may start with ~), else .pwiki/teams-profile/<name>. */
export function profilePath(root: string, cfg: Pick<TeamsSource, 'name' | 'profileDir'>): string {
  if (!cfg.profileDir) return resolve(root, PROFILE_ROOT, cfg.name);
  const p = expandHome(cfg.profileDir);
  return isAbsolute(p) ? resolve(p) : resolve(root, p);
}

/**
 * pwiki ≤ 0.1 kept one profile directly in .pwiki/teams-profile/. Move it to the first source that uses
 * the default location, so nobody has to sign in (and pass MFA) again. Chromium marks a profile root
 * with a "Local State" file, which is how we tell it from the new per-source folders.
 */
export function migrateLegacyProfile(root: string, cfg: Pick<TeamsSource, 'name' | 'profileDir'>, log: (m: string) => void): boolean {
  if (cfg.profileDir) return false;
  const legacy = resolve(root, PROFILE_ROOT);
  if (!existsSync(join(legacy, 'Local State'))) return false;
  const target = profilePath(root, cfg);
  if (existsSync(target)) return false;
  const tmp = `${legacy}.migrating`;
  renameSync(legacy, tmp);
  mkdirSync(legacy, { recursive: true });
  renameSync(tmp, target);
  log(`  chuyển phiên Teams cũ sang ${relative(root, target)} (không cần đăng nhập lại)`);
  return true;
}

/** Refuses a profile inside the vault that git would commit: it holds the Teams cookies. */
export function assertNotCommitted(root: string, profile: string): void {
  const rel = relative(root, profile);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !isGitRepo(root)) return;
  // Trailing slash: lets git match directory patterns even before the folder exists.
  const path = `${rel.split(sep).join('/')}/`;
  const r = spawnSync('git', ['check-ignore', '-q', path], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) return;
  throw new Error(
    `Thư mục phiên Teams "${rel}" chưa nằm trong .gitignore, nên cookie đăng nhập có thể bị commit. ` +
      // upgrade only knows pwiki's own profile locations, not a custom profileDir.
      `Thêm dòng "${path}" vào .gitignore${path.startsWith(PROFILE_ROOT) ? ' (hoặc chạy "pwiki upgrade")' : ''}, hoặc đặt profileDir ngoài vault (ví dụ ~/.pwiki/teams/<email>).`,
  );
}

interface LockInfo {
  pid: number;
  owner: string;
  at: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Who holds the profile now, or undefined (no lock, or a stale one). */
export function lockHolder(profile: string, now = Date.now()): LockInfo | undefined {
  const f = join(profile, LOCK_FILE);
  if (!existsSync(f)) return undefined;
  try {
    const info = JSON.parse(readFileSync(f, 'utf8')) as LockInfo;
    if (now - Date.parse(info.at) > LOCK_STALE_MS || !alive(info.pid)) return undefined;
    return info;
  } catch {
    return undefined;
  }
}

/**
 * Takes the profile for this process. A profile can be shared by several vaults (profileDir under ~),
 * and Chromium cannot open one profile twice, so the second run gets a clear message instead.
 * Returns the release function.
 */
export function lockProfile(profile: string, owner: string, now = new Date()): () => void {
  mkdirSync(profile, { recursive: true });
  const f = join(profile, LOCK_FILE);
  const held = lockHolder(profile, now.getTime());
  if (held && held.pid !== process.pid)
    throw new Error(`Phiên Teams ở ${profile} đang được dùng bởi ${held.owner} (từ ${held.at}). Chờ lần chạy đó xong rồi chạy lại.`);
  writeFileSync(f, JSON.stringify({ pid: process.pid, owner, at: now.toISOString() }));
  return () => rmSync(f, { force: true });
}

export interface SignedInAccount {
  username: string;
  /** Tenant the cached sign-in belongs to (MSAL "realm"). */
  tenantId?: string;
}

/**
 * Accounts the Teams web client has signed in, read from its MSAL cache in web storage: entries whose
 * value is an account object ({ username, realm, homeAccountId… }). Not a public format, so unknown
 * shapes are skipped and an empty list means "could not tell", not "signed out".
 */
export function accountsFromStorage(entries: Array<[string, string]>): SignedInAccount[] {
  const seen = new Map<string, SignedInAccount>();
  for (const [, value] of entries) {
    if (!value || value[0] !== '{' || !value.includes('username')) continue;
    let o: any;
    try {
      o = JSON.parse(value);
    } catch {
      continue;
    }
    if (typeof o?.username !== 'string' || !o.username.includes('@')) continue;
    if (!o.homeAccountId && !o.localAccountId && !o.realm) continue;
    const a: SignedInAccount = { username: o.username.toLowerCase(), tenantId: typeof o.realm === 'string' ? o.realm.toLowerCase() : undefined };
    seen.set(`${a.username}|${a.tenantId ?? ''}`, a);
  }
  return [...seen.values()];
}

/** TEAMS_ACCOUNT_<NAME> in .env: each member's own account, overriding sources.yaml. */
export const accountEnvKey = (sourceName: string) => `TEAMS_ACCOUNT_${sourceName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/** Accounts allowed for a source (lower case); empty = no check. */
export function expectedAccounts(cfg: Pick<TeamsSource, 'name' | 'account'>, env: Record<string, string | undefined>): string[] {
  const fromEnv = env[accountEnvKey(cfg.name)]?.trim();
  const list = fromEnv ? fromEnv.split(',') : cfg.account === undefined ? [] : Array.isArray(cfg.account) ? cfg.account : [cfg.account];
  return list.map((a) => a.trim().toLowerCase()).filter(Boolean);
}

/** tenantId=… of a Teams link ("Copy link" of a channel carries it). */
export function tenantOf(url: string): string | undefined {
  return /[?&#]tenantId=([0-9a-f-]{36})/i.exec(url)?.[1]?.toLowerCase();
}

export interface AccountCheck {
  /** Wrong account: collecting would read nothing, or the wrong person's chats. */
  error?: string;
  /** Could not verify, or a likely problem we cannot be sure of. */
  warning?: string;
}

export function checkAccount(sourceName: string, signedIn: SignedInAccount[], expected: string[], tenantId?: string): AccountCheck {
  if (!expected.length && !tenantId) return {};
  if (!signedIn.length) return { warning: 'không đọc được tài khoản đang đăng nhập Teams (định dạng có thể đã đổi), bỏ qua kiểm tra tài khoản' };
  const users = [...new Set(signedIn.map((a) => a.username))];
  const mine = expected.length ? signedIn.filter((a) => expected.includes(a.username)) : signedIn;
  if (!mine.length)
    return {
      error:
        `Teams đang đăng nhập bằng ${users.join(', ')}, nhưng nguồn "${sourceName}" cần ${expected.join(' hoặc ')}. ` +
        `Chạy "pwiki teams login --source ${sourceName}" bằng đúng tài khoản, hoặc sửa ${accountEnvKey(sourceName)} trong .env.`,
    };
  // Tenant: only a warning, since how Teams caches guest sign-ins in other tenants is not verified yet.
  if (tenantId && mine.some((a) => a.tenantId) && !mine.some((a) => a.tenantId === tenantId))
    return {
      warning:
        `tài khoản ${[...new Set(mine.map((a) => a.username))].join(', ')} chưa có phiên ở tenant ${tenantId} của link này. ` +
        `Nếu là tài khoản khách: cần được mời vào tenant đó, rồi trong "pwiki teams login" chuyển sang tenant đó một lần.`,
    };
  return {};
}
