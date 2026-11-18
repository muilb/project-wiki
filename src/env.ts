// .env in the wiki root (never committed): tokens and passwords for the sources and the tracker.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]!] = v;
  }
  return out;
}

export function loadEnv(root: string): Record<string, string> {
  const p = join(root, '.env');
  return existsSync(p) ? parseEnv(readFileSync(p, 'utf8')) : {};
}
