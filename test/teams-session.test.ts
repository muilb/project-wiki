import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accountEnvKey,
  accountsFromStorage,
  assertNotCommitted,
  checkAccount,
  expandHome,
  expectedAccounts,
  lockHolder,
  lockProfile,
  migrateLegacyProfile,
  profilePath,
  tenantOf,
} from '../src/adapters/teams-session.js';
import { parseConfig } from '../src/config.js';
import { init, upgrade } from '../src/scaffold.js';
import { gitRepo, tmp } from './helpers.js';

const quiet = () => {};
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const GUEST_TENANT = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

describe('teams profile', () => {
  it('defaults to one profile per source; profileDir may be relative, absolute or under ~', () => {
    const root = tmp();
    expect(profilePath(root, { name: 'teams-a' })).toBe(join(root, '.pwiki/teams-profile/teams-a'));
    expect(profilePath(root, { name: 'x', profileDir: '.pwiki/teams-profile-khach' })).toBe(join(root, '.pwiki/teams-profile-khach'));
    expect(profilePath(root, { name: 'x', profileDir: join(root, 'abs') })).toBe(join(root, 'abs'));
    expect(expandHome('~/.pwiki/teams/me@corp.com', '/home/u')).toBe(join('/home/u', '.pwiki/teams/me@corp.com'));
    expect(expandHome('~', '/home/u')).toBe('/home/u');
    expect(expandHome('a/~/b', '/home/u')).toBe('a/~/b');
  });

  it('moves the single profile of older versions to the first default source, once', () => {
    const root = tmp();
    const legacy = join(root, '.pwiki/teams-profile');
    mkdirSync(join(legacy, 'Default'), { recursive: true });
    writeFileSync(join(legacy, 'Local State'), '{}');
    const logs: string[] = [];
    expect(migrateLegacyProfile(root, { name: 'x', profileDir: 'other' }, quiet)).toBe(false);
    expect(migrateLegacyProfile(root, { name: 'teams-a' }, (m) => logs.push(m))).toBe(true);
    expect(existsSync(join(legacy, 'teams-a/Local State'))).toBe(true);
    expect(existsSync(join(legacy, 'teams-a/Default'))).toBe(true);
    expect(existsSync(join(legacy, 'Local State'))).toBe(false);
    expect(logs[0]).toContain('không cần đăng nhập lại');
    expect(migrateLegacyProfile(root, { name: 'teams-b' }, quiet)).toBe(false);
  });

  it('refuses a profile inside the vault that git would commit', () => {
    const root = tmp();
    init(root, 'Demo', quiet);
    expect(() => assertNotCommitted(root, profilePath(root, { name: 'teams-a' }))).not.toThrow();
    expect(() => assertNotCommitted(root, join(root, '.pwiki/teams-profile-khach'))).not.toThrow();
    expect(() => assertNotCommitted(root, join(root, 'profiles/teams'))).toThrow(/chưa nằm trong \.gitignore[\s\S]*profiles\/teams\//);
    expect(() => assertNotCommitted(root, join(root, 'profiles/teams'))).not.toThrow(/pwiki upgrade/);
    writeFileSync(join(root, '.gitignore'), '');
    expect(() => assertNotCommitted(root, join(root, '.pwiki/teams-profile/x'))).toThrow(/pwiki upgrade/);
    expect(() => assertNotCommitted(root, join(tmp(), 'outside'))).not.toThrow();
  });

  it('upgrade adds the new ignore rule to vaults made by older versions', () => {
    const root = tmp();
    init(root, 'Demo', quiet);
    const gi = join(root, '.gitignore');
    writeFileSync(gi, readFileSync(gi, 'utf8').replace('.pwiki/teams-profile*/', '.pwiki/teams-profile/'));
    expect(() => assertNotCommitted(root, join(root, '.pwiki/teams-profile-khach'))).toThrow();
    expect(upgrade(root, quiet).written).toContain('.gitignore');
    expect(readFileSync(gi, 'utf8')).toMatch(/\.pwiki\/teams-profile\/\n[\s\S]*# pwiki\n\.pwiki\/teams-profile\*\/\n$/);
    expect(() => assertNotCommitted(root, join(root, '.pwiki/teams-profile-khach'))).not.toThrow();
    expect(upgrade(root, quiet).written).not.toContain('.gitignore');
  });

  it('skips the check outside a git repo', () => {
    const root = tmp();
    expect(() => assertNotCommitted(root, join(root, 'p'))).not.toThrow();
    gitRepo(root);
    expect(() => assertNotCommitted(root, join(root, 'p'))).toThrow();
  });

  it('locks a profile shared by several vaults; stale or dead locks do not block', () => {
    const profile = join(tmp(), 'shared');
    const release = lockProfile(profile, 'vault-a (nguồn teams)');
    expect(lockHolder(profile)).toMatchObject({ pid: process.pid, owner: 'vault-a (nguồn teams)' });
    // Another live process holds it (the parent of this test runner).
    writeFileSync(join(profile, 'pwiki.lock'), JSON.stringify({ pid: process.ppid, owner: 'vault-b', at: new Date().toISOString() }));
    expect(() => lockProfile(profile, 'vault-a')).toThrow(/đang được dùng bởi vault-b/);
    // Crashed run: lock from long ago.
    writeFileSync(join(profile, 'pwiki.lock'), JSON.stringify({ pid: process.ppid, owner: 'vault-b', at: '2026-01-01T00:00:00Z' }));
    expect(lockHolder(profile)).toBeUndefined();
    lockProfile(profile, 'vault-a')();
    expect(existsSync(join(profile, 'pwiki.lock'))).toBe(false);
    release();
  });
});

describe('teams account', () => {
  const msal = (username: string, realm: string) =>
    JSON.stringify({ homeAccountId: `uid.${realm}`, environment: 'login.windows.net', realm, localAccountId: 'uid', username, name: 'X', authorityType: 'MSSTS' });

  it('reads signed-in accounts from the MSAL cache and ignores everything else', () => {
    const accounts = accountsFromStorage([
      ['uid.t1-login.windows.net-t1', msal('Hoa@Corp.com', TENANT)],
      ['uid.t2-login.windows.net-t2', msal('hoa@corp.com', GUEST_TENANT)],
      ['dup', msal('hoa@corp.com', TENANT)],
      ['token', JSON.stringify({ credentialType: 'AccessToken', secret: 'x' })],
      ['note', JSON.stringify({ username: 'not-an-account@x.com' })],
      ['broken', '{username'],
      ['plain', 'hello'],
    ]);
    expect(accounts).toEqual([
      { username: 'hoa@corp.com', tenantId: TENANT },
      { username: 'hoa@corp.com', tenantId: GUEST_TENANT },
    ]);
  });

  it('takes the expected account from .env first, so each member can use their own', () => {
    expect(accountEnvKey('teams-spec')).toBe('TEAMS_ACCOUNT_TEAMS_SPEC');
    const cfg = { name: 'teams-spec', account: ['PL@corp.com', 'dev@corp.com'] };
    expect(expectedAccounts(cfg, {})).toEqual(['pl@corp.com', 'dev@corp.com']);
    expect(expectedAccounts(cfg, { TEAMS_ACCOUNT_TEAMS_SPEC: ' Me@corp.com , me@khach.jp ' })).toEqual(['me@corp.com', 'me@khach.jp']);
    expect(expectedAccounts({ name: 'x', account: 'a@b.co' }, { TEAMS_ACCOUNT_X: '' })).toEqual(['a@b.co']);
    expect(expectedAccounts({ name: 'x' }, {})).toEqual([]);
  });

  it('reads the tenant of a Teams link', () => {
    expect(tenantOf(`https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/x?groupId=g&tenantId=${TENANT.toUpperCase()}`)).toBe(TENANT);
    expect(tenantOf('https://teams.microsoft.com/v2/#/conversations/19:abc')).toBeUndefined();
  });

  it('fails on the wrong account, warns when it cannot tell or the tenant looks wrong', () => {
    const signed = [{ username: 'hoa@corp.com', tenantId: TENANT }];
    expect(checkAccount('t', signed, [])).toEqual({});
    expect(checkAccount('t', signed, ['hoa@corp.com'], TENANT)).toEqual({});
    expect(checkAccount('t', signed, ['pl@corp.com']).error).toMatch(/đăng nhập bằng hoa@corp\.com.*cần pl@corp\.com.*TEAMS_ACCOUNT_T/);
    expect(checkAccount('t', [], ['pl@corp.com']).warning).toMatch(/không đọc được/);
    expect(checkAccount('t', signed, ['hoa@corp.com'], GUEST_TENANT).warning).toMatch(/chưa có phiên ở tenant/);
    expect(checkAccount('t', [...signed, { username: 'hoa@corp.com', tenantId: GUEST_TENANT }], ['hoa@corp.com'], GUEST_TENANT)).toEqual({});
    // Several accounts signed in in one profile: fine as long as one is allowed.
    expect(checkAccount('t', [...signed, { username: 'me@khach.jp' }], ['me@khach.jp'])).toEqual({});
  });

  it('validates account and profileDir in sources.yaml', () => {
    const teams = (extra: string) =>
      parseConfig(`project: { name: X }\nsources:\n  - { name: t, type: teams, conversations: [{ name: c, url: "https://teams.microsoft.com/x" }]${extra} }\n`);
    const ok = teams(', account: [a@corp.com, b@khach.jp], profileDir: "~/.pwiki/teams/a@corp.com"').sources[0] as any;
    expect(ok).toMatchObject({ account: ['a@corp.com', 'b@khach.jp'], profileDir: '~/.pwiki/teams/a@corp.com' });
    expect((teams('').sources[0] as any).profileDir).toBeUndefined();
    expect(() => teams(', account: not-an-email')).toThrow();
  });
});
