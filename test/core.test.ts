import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { parseEnv } from '../src/env.js';
import { parseDoc, RawStore, renderDoc, safeRelPath, safeSegment } from '../src/raw.js';
import { withMarker, MANAGED } from '../src/scaffold.js';
import { htmlToText } from '../src/util.js';
import { tmp } from './helpers.js';

describe('raw paths', () => {
  it('cleans segments for Windows', () => {
    expect(safeSegment('a:b*c?.md')).toBe('a_b_c_.md');
    expect(safeSegment('CON')).toBe('_CON');
    expect(safeSegment('nul.txt')).toBe('_nul.txt');
    expect(safeSegment('trailing. ')).toBe('trailing');
    expect(safeSegment('基本設計書.xlsx')).toBe('基本設計書.xlsx');
    expect(safeSegment('x'.repeat(200) + '.md')).toHaveLength(120);
    expect(safeSegment('x'.repeat(200) + '.md').endsWith('.md')).toBe(true);
  });

  it('refuses to leave raw/', () => {
    expect(() => safeRelPath('../secrets.md')).toThrow();
    expect(() => safeRelPath('a/../../b.md')).toThrow();
    expect(safeRelPath('/abs\\win\\path.md')).toBe('abs/win/path.md');
  });
});

describe('RawStore', () => {
  it('writes only when content changes, lists and removes', () => {
    const root = tmp();
    const s = new RawStore(root, 'jira');
    const doc = { frontmatter: { source: 'jira', key: 'A-1' }, body: '# A-1\n\nnội dung 日本語' };
    expect(s.write('A-1.md', doc)).toBe(true);
    expect(s.write('A-1.md', doc)).toBe(false);
    expect(s.write('sub/A-2.md', { ...doc, body: 'khác' })).toBe(true);
    expect(s.list()).toEqual(['A-1.md', 'sub/A-2.md']);
    expect(s.read('A-1.md')).toEqual(doc);
    expect(s.remove('A-1.md')).toBe(true);
    expect(s.list()).toEqual(['sub/A-2.md']);
    expect(s.written).toBe(2);
    expect(s.removed).toBe(1);
  });

  it('round-trips frontmatter', () => {
    const d = { frontmatter: { a: 1, b: ['x', 'y'], c: null, d: 'có: dấu hai chấm' }, body: 'body' };
    expect(parseDoc(renderDoc(d))).toEqual(d);
  });
});

describe('config', () => {
  it('fills defaults', () => {
    const c = parseConfig(`
project: { name: X }
sources:
  - { name: app, type: git, repo: ../app }
  - { name: jira, type: jira, baseUrl: https://x.atlassian.net, jql: project = X }
  - { name: specs, type: files, path: ./docs }
  - { name: chat, type: teams, conversations: [{ name: a, url: https://teams.microsoft.com/l/channel/x }] }
  - { name: bl, type: command, command: echo }
`);
    expect(c.project.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(c.git.autoCommit).toBe(true);
    expect(c.sources.map((s) => s.enabled)).toEqual([true, true, true, true, true]);
    const files = c.sources[2]!;
    expect(files.type === 'files' && files.extensions).toContain('.xlsx');
    const teams = c.sources[3]!;
    expect(teams.type === 'teams' && teams.browser).toBe('msedge');
  });

  it('reports every problem with its path', () => {
    expect(() =>
      parseConfig(`
project: { name: X }
tracker: { projectId: P1 }
sources:
  - { name: App, type: git, repo: x }
  - { name: a, type: nope }
  - { name: dup, type: command, command: x }
  - { name: dup, type: command, command: y }
`),
    ).toThrowError(/tracker[\s\S]*sources\.0\.name[\s\S]*sources\.1\.type/);
    expect(() => parseConfig('project: { name: X }\nsources:\n  - { name: dup, type: command, command: x }\n  - { name: dup, type: command, command: y }')).toThrowError(
      /sources\.1\.name: name "dup" bị trùng/,
    );
  });

  it('parses the template sources.yaml', () => {
    const t = readFileSync(join(import.meta.dirname, '../templates/project/sources.yaml'), 'utf8').replaceAll('{{PROJECT_NAME}}', 'Demo');
    const c = parseConfig(t);
    expect(c.tracker?.projectId).toBe('P01');
    expect(c.sources).toEqual([]);
  });
});

describe('misc', () => {
  it('parses .env', () => {
    expect(parseEnv('A=1\nexport B="x y"\n# c\nC=z # comment\nD=\'q#r\'')).toEqual({ A: '1', B: 'x y', C: 'z', D: 'q#r' });
  });

  it('converts chat HTML to text', () => {
    expect(htmlToText('<div>Xin chào&nbsp;<at id="0">Hòa</at></div><p>Link <a href="https://x.y/a">tài liệu</a></p><ul><li>a</li><li>b</li></ul>')).toBe(
      'Xin chào Hòa\nLink tài liệu (https://x.y/a)\n- a\n- b',
    );
    expect(htmlToText('&lt;b&gt; &#x65E5;&#26412;')).toBe('<b> 日本');
  });

  it('puts the managed marker after frontmatter', () => {
    expect(withMarker('---\na: 1\n---\nbody')).toBe(`---\na: 1\n---\n${MANAGED}\nbody`);
    expect(withMarker('# t')).toBe(`${MANAGED}\n# t`);
  });
});

export { writeFileSync };
