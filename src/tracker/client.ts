// project-tracker client: signs in like the web does (Cognito USER_PASSWORD_AUTH, then REFRESH_TOKEN_AUTH),
// so the tracker needs no change and every write is checked, permission-checked and alerted as usual.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackerConfig } from '../config.js';
import { PWIKI_DIR } from '../state.js';

interface RemoteConfig {
  apiUrl: string;
  region?: string;
  userPoolClientId?: string;
  devAuth?: boolean;
}

interface Session {
  email: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class TrackerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const SESSION_FILE = 'tracker-session.json';

export class TrackerClient {
  private remote?: RemoteConfig;

  constructor(
    private readonly root: string,
    private readonly cfg: TrackerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get sessionPath() {
    return join(this.root, PWIKI_DIR, SESSION_FILE);
  }

  async config(): Promise<RemoteConfig> {
    if (this.remote) return this.remote;
    if (this.cfg.apiUrl) {
      this.remote = { apiUrl: this.cfg.apiUrl.replace(/\/$/, ''), devAuth: !!this.cfg.devUser };
      return this.remote;
    }
    const url = `${this.cfg.url!.replace(/\/$/, '')}/config.json`;
    const res = await this.fetchImpl(url, { cache: 'no-store' } as RequestInit);
    if (!res.ok) throw new TrackerError(`Không đọc được ${url} (${res.status})`);
    const c = (await res.json()) as RemoteConfig;
    if (!c.apiUrl) throw new TrackerError(`${url} không có apiUrl`);
    this.remote = { ...c, apiUrl: c.apiUrl.replace(/\/$/, '') };
    return this.remote;
  }

  private async cognito<T>(action: string, body: object): Promise<T> {
    const { region, userPoolClientId } = await this.config();
    if (!region || !userPoolClientId) throw new TrackerError('config.json của tracker thiếu region / userPoolClientId');
    const res = await this.fetchImpl(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify({ ClientId: userPoolClientId, ...body }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const code = String(json.__type ?? 'Error').split('#').pop();
      throw new TrackerError(`Cognito ${action}: ${code}${json.message ? ` — ${json.message}` : ''}`, res.status);
    }
    return json as T;
  }

  async login(password: string): Promise<void> {
    const email = this.cfg.email?.trim().toLowerCase();
    if (!email) throw new TrackerError('Thiếu tracker.email trong sources.yaml');
    if ((await this.config()).devAuth) return this.save({ email, idToken: '', refreshToken: '', expiresAt: Number.MAX_SAFE_INTEGER });
    const r = await this.cognito<any>('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: password } });
    if (r.ChallengeName) throw new TrackerError(`Tài khoản cần xử lý "${r.ChallengeName}": đăng nhập web tracker một lần trước (đổi mật khẩu tạm…).`);
    const a = r.AuthenticationResult;
    this.save({ email, idToken: a.IdToken, refreshToken: a.RefreshToken, expiresAt: Date.now() + a.ExpiresIn * 1000 });
  }

  logout(): void {
    if (existsSync(this.sessionPath)) rmSync(this.sessionPath);
  }

  private save(s: Session) {
    mkdirSync(join(this.root, PWIKI_DIR), { recursive: true });
    writeFileSync(this.sessionPath, JSON.stringify(s), { encoding: 'utf8', mode: 0o600 });
  }

  private load(): Session | undefined {
    return existsSync(this.sessionPath) ? (JSON.parse(readFileSync(this.sessionPath, 'utf8')) as Session) : undefined;
  }

  async headers(): Promise<Record<string, string>> {
    const remote = await this.config();
    if (remote.devAuth) return { 'x-dev-user': this.cfg.devUser ?? this.cfg.email ?? '' };
    const s = this.load();
    if (!s) throw new TrackerError('Chưa đăng nhập tracker: chạy "pwiki tracker login"');
    if (s.expiresAt - Date.now() < 120_000) {
      try {
        const r = await this.cognito<any>('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: s.refreshToken } });
        const a = r.AuthenticationResult;
        s.idToken = a.IdToken;
        s.expiresAt = Date.now() + a.ExpiresIn * 1000;
        this.save(s);
      } catch (e) {
        throw new TrackerError(`Phiên tracker đã hết hạn (${(e as Error).message}): chạy "pwiki tracker login"`);
      }
    }
    return { Authorization: s.idToken };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { apiUrl } = await this.config();
    const res = await this.fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: { 'Accept-Language': 'vi', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(await this.headers()) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new TrackerError(json.error ?? json.message ?? `HTTP ${res.status}`, res.status);
    return json as T;
  }
}
