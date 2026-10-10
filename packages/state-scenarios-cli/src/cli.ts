#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createCatalog, scenarioJsonSchema, type ScenarioRule } from 'state-scenarios';

const HELP = `Usage: state-scenarios <command> <scenarios-dir> [options]

  init       Create <dir> (default src/scenarios) with default.json, a sibling scenario.schema.json,
             and print the wiring snippet to paste into your entry file
  validate   Check every scenario parses, resolves and passes --rules
  list       Print scenarios with links (--base-url) for people and agents; --json for machines
  shoot      Open each scenario in Chromium, wait for its ready selector, screenshot it,
             and report requests it didn't mock. --base-url (required), --out, --only a,b, --no-strict
  suggest    Ask Claude which UI states lack scenarios and draft them into --out (default <dir>/proposed).
             --src dir[,dir] (required), --schema file, --max n, --model (default $STATE_SCENARIOS_MODEL or claude-opus-5-5).
             Needs ANTHROPIC_API_KEY or \`ant auth login\`; ANTHROPIC_BASE_URL points it at a compatible proxy.
             --env-file file loads those variables first.
  promote    Move <dir>/proposed/*.json into <dir> after validate. --dry-run lists moves only.

Common: --rules file   module exporting \`rules\` (ScenarioRule[])`;

const MAX_SOURCE_CHARS = 800_000;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    rules: { type: 'string' },
    'base-url': { type: 'string' },
    out: { type: 'string' },
    only: { type: 'string' },
    'no-strict': { type: 'boolean' },
    json: { type: 'boolean' },
    src: { type: 'string' },
    schema: { type: 'string' },
    max: { type: 'string' },
    model: { type: 'string' },
    'env-file': { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, dir = command === 'init' ? 'src/scenarios' : undefined] = positionals;

if (values.help || !command || !dir) {
  console.log(HELP);
  process.exit(command ? 1 : 0);
}

try {
  if (command === 'init') {
    const { initScenarios } = await import('./init.js');
    initScenarios(dir);
    process.exit(0);
  }

  const rules: ScenarioRule[] = values.rules
    ? (await import(pathToFileURL(resolve(values.rules)).href)).rules
    : [];

  if (command === 'promote') {
    const { promoteScenarios } = await import('./promote.js');
    const result = promoteScenarios(dir, { rules, dryRun: !!values['dry-run'] });
    process.exit(result.skipped.length ? 1 : 0);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  const catalog = createCatalog(
    files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))),
    { rules },
  );

  switch (command) {
    case 'validate': {
      const problems = catalog.check();

      for (const p of problems) console.error(`✗ ${p}\n`);
      console.log(`${catalog.list.length - problems.length}/${catalog.list.length} scenarios valid`);
      process.exit(problems.length ? 1 : 0);
    }

    case 'list': {
      const base = values['base-url'];

      const rows = catalog.list.map((s) => ({
        name: s.name,
        description: s.description ?? '',
        tags: s.tags ?? [],
        ready: s.ready ?? null,
        url: base
          ? `${base.replace(/\/$/, '')}${catalog.resolve(s).path ?? '/'}?scenario=${
            encodeURIComponent(s.name)
          }`
          : null,
      }));

      if (values.json) console.log(JSON.stringify(rows, null, 2));
      else {
        for (const r of rows) {
          console.log(
            `${r.name.padEnd(32)} ${r.description}${r.url ? `\n${' '.repeat(33)}${r.url}` : ''}`,
          );
        }
      }

      break;
    }

    case 'shoot': {
      const baseURL = values['base-url'];

      if (!baseURL) throw new Error('shoot needs --base-url, e.g. http://localhost:5173');
      const out = values.out ?? 'scenario-shots';
      const only = values.only?.split(',');
      mkdirSync(out, { recursive: true });

      const { chromium } = await import('@playwright/test');
      const { openScenario, unhandledRequests } = await import('state-scenarios/playwright');
      const browser = await chromium.launch();
      const report = [];

      for (const s of catalog.list.filter((s) => !only || only.includes(s.name))) {
        const context = await browser.newContext({ baseURL });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        // Uncaught exceptions and console errors both fail the run. Browser network logs
        // ("Failed to load resource") are excluded: error scenarios cause them on purpose,
        // and requests the scenario didn't mock are reported as `unhandled` instead.
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', (m) => {
          if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
            consoleErrors.push(m.text());
          }
        });
        page.on('pageerror', (err) => pageErrors.push(err.message));
        let error: string | null = null;

        try {
          await openScenario(page, s.name, {
            path: catalog.resolve(s).path,
            strict: !values['no-strict'],
          });
        } catch (err) {
          error = err instanceof Error ? err.message.split('\n')[0] : String(err);
        }

        const screenshot = join(out, `${s.name}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        const unhandled = await unhandledRequests(page);
        const ok = !error && !unhandled.length && !consoleErrors.length && !pageErrors.length;
        report.push({ name: s.name, ok, screenshot, unhandled, consoleErrors, pageErrors, error });
        await context.close();
      }

      await browser.close();

      if (values.json) console.log(JSON.stringify(report, null, 2));
      else {
        for (const r of report) {
          console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(32)} ${r.screenshot}`);

          if (r.error) console.log(`    error: ${r.error}`);

          for (const u of r.unhandled) console.log(`    unmocked: ${u}`);

          for (const e of r.pageErrors) console.log(`    uncaught: ${e}`);

          for (const e of r.consoleErrors) console.log(`    console.error: ${e}`);
        }
      }

      process.exit(report.every((r) => r.ok) ? 0 : 1);
    }

    case 'suggest': {
      if (!values.src) throw new Error('suggest needs --src, e.g. --src src/pages,src/components');
      const sources = values.src.split(',').flatMap((d) => walk(d));
      const size = sources.reduce((n, f) => n + f.content.length, 0);

      if (size > MAX_SOURCE_CHARS) {
        throw new Error(
          `--src is ${size.toLocaleString()} characters; narrow it to the screens you want covered`,
        );
      }

      const jsonSchema = values.schema
        ? JSON.parse(readFileSync(values.schema, 'utf8'))
        : scenarioJsonSchema();

      if (values['env-file']) process.loadEnvFile(values['env-file']);
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const model = values.model ?? process.env.STATE_SCENARIOS_MODEL ?? undefined;
      const { suggestScenarios } = await import('./suggest.js');
      console.error(
        `Reading ${sources.length} files (${size.toLocaleString()} chars) and ${catalog.list.length} scenarios with ${
          model ?? 'claude-opus-5-5'
        }…`,
      );

      const result = await suggestScenarios(
        { sources, catalog, jsonSchema, max: Number(values.max ?? 8), model },
        {
          client: new Anthropic({
            baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
            // Some Anthropic-compatible proxies require a session id and a user agent.
            defaultHeaders: {
              'x-opencode-session': `state-scenarios-${Date.now()}`,
              'User-Agent': 'state-scenarios/0.0 (suggest)',
            },
          }),
        },
      );

      console.log('\nCandidate UI states (not exhaustive)\n');

      for (const s of result.states) {
        const mark = s.covered_by ? '✓' : '✗';
        console.log(
          `${mark} ${`${s.area} / ${s.state}`.padEnd(56)} ${s.covered_by ?? `uncovered (${s.priority})`}`,
        );
      }

      const covered = result.states.filter((s) => s.covered_by).length;
      console.log(
        `\n${result.states.length} states detected, ${covered} have scenarios, ${
          result.states.length - covered
        } uncovered`,
      );

      const out = values.out ?? join(dir, 'proposed');

      if (result.accepted.length) mkdirSync(out, { recursive: true });

      for (const { scenario, covers } of result.accepted) {
        const file = join(out, `${scenario.name}.json`);
        const $schema = values.schema ? relative(out, values.schema) : undefined;
        writeFileSync(file, `${JSON.stringify({ $schema, ...scenario }, null, 2)}\n`);
        console.log(`+ ${file}  (${covers})`);
      }

      for (const r of result.rejected) console.log(`- rejected proposal for ${r.covers}: ${r.error}`);

      if (result.accepted.length) {
        console.log(
          `\nReview the drafts, then: state-scenarios promote ${dir}`,
        );
      }

      break;
    }

    default:
      console.error(`Unknown command "${command}"\n\n${HELP}`);
      process.exit(1);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const hint = /authentication/i.test(message) ? '\nSet ANTHROPIC_API_KEY, or run `ant auth login`.' : '';
  console.error(`state-scenarios ${command}: ${message}${hint}`);
  process.exit(1);
}

function walk(path: string): { path: string; content: string; }[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((f) => !['node_modules', 'dist', 'scenarios'].includes(f))
      .flatMap((f) => walk(join(path, f)));
  }

  const isSource = /\.(tsx?|jsx?|vue|svelte)$/.test(path) && !/\.(d|test|spec)\.\w+$/.test(path);

  return isSource ? [{ path, content: readFileSync(path, 'utf8') }] : [];
}
