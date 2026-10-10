import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { initScenarios } from '../packages/state-scenarios-cli/src/init.ts';
import { promoteScenarios } from '../packages/state-scenarios-cli/src/promote.ts';

describe('initScenarios', () => {
  it('writes default.json and scenario.schema.json without overwriting', () => {
    const root = mkdtempSync(join(tmpdir(), 'ss-init-'));
    writeFileSync(join(root, 'vite.config.ts'), 'export default {}\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    initScenarios('src/scenarios', root);

    const def = join(root, 'src/scenarios/default.json');
    const schema = join(root, 'src/scenario.schema.json');
    expect(existsSync(def)).toBe(true);
    expect(existsSync(schema)).toBe(true);
    expect(JSON.parse(readFileSync(def, 'utf8')).name).toBe('default');
    const out = log.mock.calls.flat().join('\n');
    expect(out).toMatch(/startScenarios/);
    // Root-relative so the glob works from whichever file the snippet is pasted into.
    expect(out).toContain(`import.meta.glob<ScenarioInput>('/src/scenarios/*.json'`);
    log.mockClear();

    writeFileSync(def, '{"name":"default","description":"kept"}\n');
    initScenarios('src/scenarios', root);
    expect(JSON.parse(readFileSync(def, 'utf8')).description).toBe('kept');
    expect(log.mock.calls.flat().join('\n')).toMatch(/Kept existing src\/scenarios\/default\.json/);

    log.mockRestore();
  });
});

describe('initScenarios for Next.js', () => {
  it('prints the save route for the scenarios folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'ss-init-next-'));
    writeFileSync(join(root, 'next.config.ts'), 'export default {}\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    initScenarios('scenarios', root);

    const out = log.mock.calls.flat().join('\n');
    expect(out).toContain('app/%5F%5Fstate-scenarios/save/route.ts');
    expect(out).toContain(`createSaveRoute({ dir: 'scenarios' })`);
    log.mockRestore();
  });
});

describe('promoteScenarios', () => {
  it('moves valid proposed drafts and refuses duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-promote-'));
    writeFileSync(
      join(dir, 'default.json'),
      JSON.stringify({ name: 'default', network: [{ path: '/a', response: { body: 1 } }] }),
    );
    mkdirSync(join(dir, 'proposed'));
    writeFileSync(
      join(dir, 'proposed', 'empty.json'),
      JSON.stringify({
        name: 'empty',
        extends: 'default',
        network: [{ path: '/a', response: { body: [] } }],
        ready: 'text=Empty',
      }),
    );
    writeFileSync(
      join(dir, 'proposed', 'default.json'),
      JSON.stringify({ name: 'default', ready: 'text=dup' }),
    );

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = promoteScenarios(dir);
    expect(result.moved).toEqual(['empty.json']);
    expect(result.skipped).toContain('default.json');
    expect(existsSync(join(dir, 'empty.json'))).toBe(true);
    expect(existsSync(join(dir, 'proposed', 'empty.json'))).toBe(false);
    err.mockRestore();
    log.mockRestore();
  });
});

describe('promoteScenarios with invalid JSON', () => {
  it('skips an unparseable draft and moves the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-promote-bad-'));
    writeFileSync(join(dir, 'default.json'), JSON.stringify({ name: 'default' }));
    mkdirSync(join(dir, 'proposed'));
    writeFileSync(join(dir, 'proposed', 'invalid.json'), '{ nope');
    writeFileSync(join(dir, 'proposed', 'ok.json'), JSON.stringify({ name: 'ok', extends: 'default' }));

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = promoteScenarios(dir);
    expect(result).toEqual({ moved: ['ok.json'], skipped: ['invalid.json'] });
    expect(err.mock.calls.flat().join('\n')).toMatch(/invalid\.json/);
    err.mockRestore();
    log.mockRestore();
  });

  it('names the catalog file that is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-promote-badcat-'));
    writeFileSync(join(dir, 'default.json'), '{ nope');
    mkdirSync(join(dir, 'proposed'));
    writeFileSync(join(dir, 'proposed', 'ok.json'), JSON.stringify({ name: 'ok' }));

    expect(() => promoteScenarios(dir)).toThrow(/default\.json/);
  });
});
