import type { SourceConfig } from '../config.js';
import type { RawStore } from '../raw.js';

export interface AdapterContext {
  /** Wiki root (folder of sources.yaml). */
  root: string;
  /** raw/<source name>/ of this source. */
  raw: RawStore;
  /** What the previous run returned, undefined on the first run. */
  cursor: unknown;
  now: Date;
  timezone: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  log: (msg: string) => void;
  options: { record?: boolean; headed?: boolean };
}

/** New cursor, saved only when the run succeeded. */
export interface AdapterResult {
  cursor: unknown;
  /** One line for the collect summary, e.g. "12 commit". */
  note?: string;
}

export type Adapter<C extends SourceConfig = SourceConfig> = (cfg: C, ctx: AdapterContext) => Promise<AdapterResult>;
