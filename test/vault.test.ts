import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadConfig, parseConfig } from '../src/config.js';
import { detectSections, Layout } from '../src/layout.js';
import { extractLinks, formatLint, lint } from '../src/lint.js';
import { RawStore } from '../src/raw.js';
import { adopt, init, upgrade } from '../src/scaffold.js';
import { snapshot } from '../src/snapshot.js';
import { git } from '../src/util.js';
import { tmp } from './helpers.js';

const quiet = () => {};
const read = (root: string, p: string) => readFileSync(join(root, ...p.split('/')), 'utf8');
const write = (root: string, p: string, text: string) => {
  mkdirSync(join(root, ...p.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...p.split('/')), text);
};
const layoutOf = (yaml = '') => new Layout(parseConfig(`project: { name: X }\n${yaml}`).layout);

describe('layout', () => {
  it('resolves presets, overrides, MOC placement and sections of paths', () => {
    const n = layoutOf();
    expect(n.path('decisions')).toBe('30_Decisions');
    expect(n.moc('decisions')).toBe('30_Decisions/30_Decisions.md');
    expect(n.moc('glossary')).toBe('90_Reference/Glossary/Glossary.md');
    expect(n.sectionOf('60_Cycles/Reports/2026-W47.md')).toBe('reports');
    expect(n.sectionOf('60_Cycles/sprint-3.md')).toBe('cycles');
    expect(n.isWikiFile('raw/jira/A-1.md')).toBe(false);
    expect(n.isWikiFile('_templates/issue.md')).toBe(false);
    expect(n.isWikiFile('CLAUDE.md')).toBe(false);
    expect(n.isWikiFile('_Inbox/note.md')).toBe(false);

    const b = layoutOf('layout: { moc: beside, sections: { changes: 70_PR, people: "80_Teams/" }, ignore: [runtime/] }');
    expect(b.moc('changes')).toBe('70_PR.md');
    expect(b.moc('glossary')).toBe('90_Reference/Glossary.md');
    expect(b.path('people')).toBe('80_Teams');
    expect(b.isWikiFile('runtime/log.md')).toBe(false);

    const f = layoutOf('layout: { preset: flat, links: markdown }');
    expect(f.path('index')).toBe('wiki/index.md');
    expect(f.link('wiki/issues/a.md', 'wiki/decisions/b c.md', 'B')).toBe('[B](../decisions/b%20c.md)');
    expect(n.link('00_Index.md', '30_Decisions/x.md', 'X')).toBe('[[30_Decisions/x|X]]');
    expect(n.link('00_Index.md', '03_Dashboard.base')).toBe('[[03_Dashboard.base]]');
  });

  it('rejects bad section values', () => {
    expect(() => parseConfig('project: { name: X }\nlayout: { sections: { index: Index } }')).toThrow(/index là một file \.md/);
    expect(() => parseConfig('project: { name: X }\nlayout: { sections: { issues: ../out } }')).toThrow(/không chứa/);
  });

  it('guesses the layout of an existing vault like brain-datahub', () => {
    const names = ['_attachments', '_templates', '10_Domain', '20_Architecture', '30_Decisions', '40_Cycles', '50_Glossary', '60_HowTo', '70_PR', '80_Teams', '90_Sources', 'runtime', '_Inbox'];
    const files = ['00_Index.md', '01_Cach_su_dung.md', '10_Domain.md', '20_Architecture.md', '30_Decisions.md', '40_Cycles.md', '50_Glossary.md', '60_HowTo.md', '70_PR.md', '80_Teams.md', '90_Sources.md', 'CLAUDE.md', 'Untitled.base'];
    const r = detectSections([...names.map((name) => ({ name, dir: true })), ...files.map((name) => ({ name, dir: false }))]);
    expect(r.sections).toEqual({
      attachments: '_attachments',
      templates: '_templates',
      domain: '10_Domain',
      architecture: '20_Architecture',
      decisions: '30_Decisions',
      cycles: '40_Cycles',
      glossary: '50_Glossary',
      howto: '60_HowTo',
      changes: '70_PR',
      people: '80_Teams',
      sources: '90_Sources',
      inbox: '_Inbox',
      index: '00_Index.md',
      guide: '01_Cach_su_dung.md',
    });
    expect(r.moc).toBe('beside');
  });
});

describe('init', () => {
  it('builds a numbered vault: MOCs, index, guide, Bases dashboard, templates, Obsidian and Claude settings', () => {
    const root = tmp('vault-');
    init(root, 'IHP EMV', quiet);
    for (const f of ['00_Index.md', '01_Guide.md', '02_Overview.md', '03_Dashboard.base', '30_Decisions/30_Decisions.md', '60_Cycles/timeline.md', '90_Reference/Glossary/Glossary.md', '_templates/issue.md', '_Inbox/.gitkeep', '.obsidian/app.json', '.obsidian/graph.json', '.obsidian/templates.json', '.claude/settings.json', '.pwiki/LAYOUT.md'])
      expect(existsSync(join(root, f)), f).toBe(true);
    expect(read(root, '00_Index.md')).toContain('- [[30_Decisions/30_Decisions|Quyết định]] — ');
    expect(read(root, '00_Index.md')).toContain('[[_snapshots/snapshots|Trạng thái hiện tại]]');
    expect(read(root, '01_Guide.md')).toContain('Thả vào `_Inbox/`');

    const base = parse(read(root, '03_Dashboard.base'));
    expect(base.views.map((v: any) => v.name)).toEqual(['Issue đang mở', 'Câu hỏi còn mở với khách', 'Quyết định', 'Chu kỳ & mốc']);
    expect(base.views[0].filters.and).toEqual(['file.inFolder("40_Issues")', 'type == "issue"', 'status != "resolved"', 'status != "wontfix"']);

    const app = JSON.parse(read(root, '.obsidian/app.json'));
    expect(app).toMatchObject({ userIgnoreFilters: ['raw/', 'tracker/', 'node_modules/', 'scripts/'], attachmentFolderPath: '_attachments', useMarkdownLinks: false, newLinkFormat: 'absolute' });
    const graph = JSON.parse(read(root, '.obsidian/graph.json'));
    expect(graph.search).toBe('-path:"_snapshots/" -path:"_templates/" -path:"00_Index.md" -path:"04_Log.md"');
    expect(graph.colorGroups[0]).toEqual({ query: 'path:"10_Domain/"', color: { a: 1, rgb: 0x4e79a7 } });
    const settings = JSON.parse(read(root, '.claude/settings.json'));
    expect(settings.permissions.deny).toContain('Edit(/_snapshots/**)');
    expect(read(root, '.pwiki/LAYOUT.md')).toContain('| issues | `40_Issues/` | `40_Issues/40_Issues.md` | `issue` |');
    expect(read(root, 'CLAUDE.md')).toContain('@.pwiki/LAYOUT.md');
    expect(loadConfig(root).sources[0]).toMatchObject({ name: 'inbox', type: 'files', path: '_Inbox' });
    // A fresh vault lints clean.
    expect(lint(root, loadConfig(root)).issues).toEqual([]);
  });

  it('builds a flat vault with markdown links', () => {
    const root = tmp('vault-');
    init(root, 'Flat', quiet, 'flat');
    const y = read(root, 'sources.yaml').replace('links: wikilink', 'links: markdown');
    writeFileSync(join(root, 'sources.yaml'), y);
    // links changed after init: LAYOUT.md follows on upgrade, existing notes stay.
    upgrade(root, quiet);
    expect(read(root, 'wiki/index.md')).toContain('[[wiki/decisions/decisions|Quyết định]]');
    expect(read(root, '.pwiki/LAYOUT.md')).toContain('Kiểu link của dự án: **markdown**');
    const root2 = tmp('vault-');
    write(root2, 'sources.yaml', 'project: { name: M }\nlayout: { preset: flat, links: markdown }\n');
    upgrade(root2, quiet);
    expect(read(root2, 'wiki/index.md')).toContain('- [Quyết định](decisions/decisions.md) — ');
    expect(JSON.parse(read(root2, '.obsidian/app.json'))).toMatchObject({ useMarkdownLinks: true, newLinkFormat: 'relative' });
    expect(lint(root2, loadConfig(root2)).issues).toEqual([]);
  });
});

describe('adopt', () => {
  it('adds pwiki to an existing vault without touching its notes, then upgrade fills the gaps', () => {
    const root = tmp('brain-');
    for (const d of ['10_Domain', '30_Decisions', '70_PR', '80_Teams', '_templates', '_Inbox', 'runtime']) mkdirSync(join(root, d));
    write(root, '00_Index.md', '# Index của tôi\n');
    write(root, '10_Domain.md', '# Domain\n- [[10_Domain/order]]\n');
    write(root, '10_Domain/order.md', '---\ntype: spec\nsources: [raw/x.md]\n---\n# Đơn hàng\n');
    write(root, 'CLAUDE.md', '# Vault của tôi\n\nQuy tắc riêng.\n');
    write(root, '.gitignore', 'node_modules/\n');
    write(root, '.obsidian/app.json', JSON.stringify({ userIgnoreFilters: ['runtime/'], useMarkdownLinks: false, newLinkFormat: 'shortest' }));
    write(root, '_templates/issue.md', 'mẫu của tôi');
    write(root, '70_PR/pr-1.md', '---\ntype: pr\n---\n# PR 1\n');
    write(root, '70_PR/pr-2.md', '---\ntype: pr\n---\n# PR 2\n');
    mkdirSync(join(root, '40_Cycles'));

    const r = adopt(root, 'Brain', quiet);
    expect(r.detected).toMatchObject({ domain: '10_Domain', decisions: '30_Decisions', changes: '70_PR', people: '80_Teams', index: '00_Index.md', inbox: '_Inbox' });
    expect(r.moc).toBe('beside');
    expect(r.types).toEqual({ changes: 'pr' });
    expect(r.missing).toContain('issues');
    const cfg = loadConfig(root);
    expect(cfg.layout).toMatchObject({ moc: 'beside', sections: { changes: '70_PR', index: '00_Index.md' } });
    expect(read(root, 'CLAUDE.md')).toMatch(/^# Vault của tôi\n\nQuy tắc riêng\.\n\n## pwiki[\s\S]*@\.pwiki\/LAYOUT\.md/);
    expect(read(root, '.gitignore')).toContain('node_modules/\n# pwiki\n.env');
    expect(existsSync(join(root, '40_Issues'))).toBe(false); // adopt creates no notes

    git(root, ['config', 'user.email', 'a@b.c']);
    git(root, ['config', 'user.name', 'A']);
    upgrade(root, quiet, cfg);
    expect(read(root, '00_Index.md')).toBe('# Index của tôi\n');
    expect(read(root, '10_Domain.md')).toBe('# Domain\n- [[10_Domain/order]]\n');
    expect(read(root, '_templates/issue.md')).toBe('mẫu của tôi');
    expect(existsSync(join(root, '40_Issues.md'))).toBe(true); // missing section, MOC beside
    expect(existsSync(join(root, '_templates/decision.md'))).toBe(true);
    expect(read(root, '_templates/change.md')).toContain('type: pr');
    expect(existsSync(join(root, '40_Cycles/Reports.md'))).toBe(true); // reports follow the vault's cycles folder
    expect(existsSync(join(root, '60_Cycles'))).toBe(false);
    expect(lint(root, loadConfig(root)).issues.filter((i) => i.check === 'frontmatter' && i.detail.includes('type'))).toEqual([]);
    const app = JSON.parse(read(root, '.obsidian/app.json'));
    expect(app.userIgnoreFilters).toEqual(['runtime/', 'raw/', 'tracker/', 'node_modules/', 'scripts/']);
    expect(app.newLinkFormat).toBe('shortest'); // user's choice kept
    expect(() => adopt(root, 'Brain', quiet)).toThrow(/đã dùng pwiki/);
  });
});

describe('snapshot', () => {
  it('builds tracker, ticket, git, Teams and document pages, and only rewrites on change', () => {
    const root = tmp('vault-');
    init(root, 'Demo', quiet);
    writeFileSync(
      join(root, 'sources.yaml'),
      `project: { name: Demo }\nsources:\n  - { name: jira, type: jira, baseUrl: "https://x.atlassian.net", jql: x }\n  - { name: app, type: git, repo: . }\n  - { name: chat, type: teams, conversations: [{ name: 仕様, url: "https://teams.microsoft.com/x" }] }\n  - { name: specs, type: files, path: . }\n  - { name: gone, type: command, command: x }\n`,
    );
    const config = loadConfig(root);
    const jira = new RawStore(root, 'jira');
    jira.write('EMV-1.md', { frontmatter: { key: 'EMV-1', status: 'In Progress', statusCategory: 'indeterminate', priority: 'High', assignee: 'Giàu', due: '2026-11-10', type: 'Bug' }, body: '# EMV-1 Timeout 30s' });
    jira.write('EMV-2.md', { frontmatter: { key: 'EMV-2', status: 'To Do', statusCategory: 'new', priority: 'Low', type: 'Task' }, body: '# EMV-2 Log' });
    jira.write('EMV-3.md', { frontmatter: { key: 'EMV-3', status: 'Done', statusCategory: 'done', priority: 'High', updated: '2026-11-17T10:00:00.000+0900' }, body: '# EMV-3 Đã xong' });
    new RawStore(root, 'app').write('commits/2026-11-17.md', {
      frontmatter: { source: 'git' },
      body: '# app\n\n<!-- commit:abc1234 -->\n### 09:00 abc12345 — Giàu\nEMV-1 fix\n\nTicket: EMV-1\n\n<!-- commit:def5678 -->\n### 10:00 def56789 — Hòa\nlog',
    });
    new RawStore(root, 'chat').write('仕様/2026-11-18.md', {
      frontmatter: { conversation: '仕様' },
      body: '# 仕様\n\n<!-- msg:1 t:x -->\n**09:00 Ishii**\nA\n\n<!-- msg:2 t:y -->\n**09:05 Hòa**\nB\n\n<!-- msg:3 t:z -->\n**09:06 Ishii**\nC',
    });
    new RawStore(root, 'specs').write('基本設計.xlsx.md', { frontmatter: { path: '基本設計.xlsx', modified: '2026-11-16T00:00:00Z', size: 6000 }, body: 'x' });
    write(root, 'tracker/state.json', JSON.stringify({ pulledAt: '2026-11-18T01:00:00Z', project: { id: 'P03', name: 'Demo', health: 'red', declaredHealth: 'yellow', lateHours: 5, openIssues: 2, highIssues: 1, overdueItems: 0 }, items: [{ id: 'I0018', type: 'issue', title: 'Timeout', priority: 'high', date: '2026-11-21', status: 'open' }, { id: 'I0007', type: 'issue', title: 'Xong', priority: 'high', date: '2026-11-01', status: 'done' }], updates: [{ at: '2026-11-17', health: 'red', summary: 'Chờ khách\nchi tiết' }] }));
    write(root, 'tracker/map.json', JSON.stringify({ items: { '40_Issues/timeout': 'I0018' } }));
    write(root, '40_Issues/timeout.md', '---\ntype: issue\nstatus: open\nsources: [raw/jira/EMV-1.md]\n---\n# Timeout\n');

    const now = new Date('2026-11-18T05:00:00Z');
    const w = snapshot(root, config, now);
    expect(w.sort()).toEqual(['_snapshots/app.md', '_snapshots/chat.md', '_snapshots/jira.md', '_snapshots/snapshots.md', '_snapshots/specs.md', '_snapshots/tracker.md']);
    const tracker = read(root, '_snapshots/tracker.md');
    expect(tracker).toContain('| 🔴 đỏ | 🟡 vàng | - | - | ⚠️ 5h |');
    expect(tracker).toContain('| I0018 | issue | Timeout | high | 2026-11-21 | open | [[40_Issues/timeout|timeout]] |');
    expect(tracker).not.toContain('I0007');
    const j = read(root, '_snapshots/jira.md');
    expect(j).toContain('**2 đang mở** (In Progress: 1, To Do: 1)');
    expect(j.indexOf('EMV-1')).toBeLessThan(j.indexOf('EMV-2'));
    expect(j).toContain('| [EMV-1](../raw/jira/EMV-1.md) | Timeout 30s | Bug | In Progress | High | Giàu | 2026-11-10 ⚠️ |');
    expect(j.split('## Xong trong 7 ngày')[1]).toContain('EMV-3');
    expect(read(root, '_snapshots/app.md')).toContain('| [2026-11-17](../raw/app/commits/2026-11-17.md) | 2 | Giàu (1), Hòa (1) | EMV-1 |');
    expect(read(root, '_snapshots/chat.md')).toContain('| 仕様 | 3 | Ishii (2), Hòa (1) |');
    expect(read(root, '_snapshots/specs.md')).toContain('基本設計.xlsx');
    expect(read(root, '_snapshots/snapshots.md')).toContain('[[_snapshots/tracker|Tracker]]');

    expect(snapshot(root, config, new Date('2026-11-18T05:10:00Z'))).toEqual([]);
    // Snapshot pages are not orphans / stray for lint.
    expect(lint(root, config, now).issues.filter((i) => i.file.startsWith('_snapshots'))).toEqual([]);
  });
});

describe('lint', () => {
  it('finds broken / ambiguous links, orphans, tree-only pages, MOC gaps, frontmatter, stray and stale pages', () => {
    const root = tmp('vault-');
    init(root, 'Demo', quiet);
    const config = loadConfig(root);
    write(root, 'raw/jira/EMV-1.md', 'x');
    write(
      root,
      '40_Issues/40_Issues.md',
      '---\ntype: moc\n---\n# Issues\n\n- [[40_Issues/timeout]] — a\n- [[40_Issues/lonely]] — b\n- [[40_Issues/old]] — c\n',
    );
    write(root, '40_Issues/timeout.md', '---\ntype: issue\nstatus: open\nsources: [raw/jira/EMV-1.md]\nupdated: 2026-11-18\n---\n# T\n\nXem [[30_Decisions/timeout-30s]] và [[nope]], nguồn [EMV-1](../raw/jira/EMV-1.md), [mất](../raw/jira/EMV-9.md). `[[trong code]]`\n');
    write(root, '30_Decisions/timeout-30s.md', '---\ntype: decision\nstatus: accepted\nsources: [raw/jira/EMV-1.md, raw/gone.md]\n---\n# D\n');
    write(root, '40_Issues/lonely.md', '---\ntype: issue\nstatus: open\nsources: [raw/jira/EMV-1.md]\nupdated: 2026-11-18\n---\n# L\n');
    write(root, '40_Issues/old.md', '---\ntype: issue\nstatus: open\nsources: [raw/jira/EMV-1.md]\nupdated: 2026-10-01\n---\n# O\n\n[[timeout]]\n');
    write(root, '10_Domain/timeout.md', '---\ntype: topic\n---\n# trùng tên\n');
    write(root, '10_Domain/hidden.md', '# không ai link\n');
    write(root, '2026-10-01.md', '# daily');
    write(root, 'Untitled.base', 'views: []');
    write(root, '_templates/x.md', '[[không kiểm tra]]');

    const r = lint(root, config, new Date('2026-11-18T05:00:00Z'));
    const by = (c: string) => r.issues.filter((i) => i.check === c).map((i) => `${i.file}: ${i.detail}`);
    expect(by('broken-link')).toEqual(['40_Issues/timeout.md: [[nope]]']);
    expect(by('missing-raw').sort()).toEqual(['30_Decisions/timeout-30s.md: sources: raw/gone.md', '40_Issues/timeout.md: ../raw/jira/EMV-9.md']);
    expect(by('ambiguous-link')).toEqual(['40_Issues/old.md: [[timeout]] → 10_Domain/timeout.md, 40_Issues/timeout.md']);
    expect(by('orphan').map((x) => x.split(':')[0]).sort()).toEqual(['10_Domain/hidden.md', '10_Domain/timeout.md']);
    expect(by('not-in-moc')).toEqual(['30_Decisions/timeout-30s.md: 30_Decisions/30_Decisions.md']);
    expect(by('tree-only').map((x) => x.split(':')[0])).toEqual(['40_Issues/lonely.md', '40_Issues/old.md']); // old.md: its only link is ambiguous
    expect(by('frontmatter').sort()).toEqual([
      '10_Domain/hidden.md: chưa có sources',
      '10_Domain/hidden.md: thiếu type (khu vực này: spec)',
      '10_Domain/timeout.md: chưa có sources',
      '10_Domain/timeout.md: type "topic" nhưng nằm trong khu vực domain (spec)',
    ]);
    expect(by('stray').map((x) => x.split(':')[0]).sort()).toEqual(['2026-10-01.md', 'Untitled.base']);
    expect(by('stale')).toEqual(['40_Issues/old.md: open từ 2026-10-01 (> 14 ngày không cập nhật)']);
    expect(formatLint(r)).toContain('## Link hỏng (1)');
  });

  it('extracts wiki and markdown links but not code, urls or anchors', () => {
    expect(extractLinks('[[a/b|x]] ![[img.png]] [[c#h]] [t](d.md#x) [u](https://x) [#](#top) `[[no]]`\n```\n[[no2]]\n```')).toEqual(['[[a/b', '[[img.png', '[[c', 'd.md']);
  });
});
