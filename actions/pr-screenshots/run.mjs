// pr-screenshots: shoot the states a pull request touches on its base and its head, publish the
// differences, and post them as one PR comment. Run by action.yml; inputs arrive as INPUT_* env.
import { execSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildComment, MARKER } from './comment.mjs';

const input = (name, fallback = '') => process.env[`INPUT_${name.toUpperCase()}`]?.trim() || fallback;

const scenarios = input('scenarios');

const dev = input('dev-command');

const baseUrl = input('base-url');

const install = input('install-command', 'npm ci');

const cli = input('cli', 'npx state-scenarios');

const src = input('src');

const shootArgs = input('shoot-args');

const branch = input('branch', 'scenario-shots');

const shootAll = input('all-when-unmatched', 'true') === 'true';

const failOnError = input('fail-on-error', 'true') === 'true';

const work = input('out') || mkdtempSync(join(tmpdir(), 'pr-screenshots-'));

mkdirSync(work, { recursive: true });

const run = (cmd) => execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });

const read = (cmd) =>
  execSync(cmd, { encoding: 'utf8', shell: '/bin/bash', stdio: ['ignore', 'pipe', 'inherit'] });

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;

const log = (text) => console.log(`\n▶ ${text}`);

/** Start the dev server in its own process group, wait until it answers, and return a stop function. */
async function startApp(label) {
  const output = openSync(join(work, `dev-${label}.log`), 'w');
  const child = spawn('bash', ['-c', dev], { detached: true, stdio: ['ignore', output, output] });
  const exited = new Promise((resolve) => child.once('exit', resolve));

  for (let i = 0; i < 120; i++) {
    const up = await fetch(baseUrl).then((r) => r.status < 500, () => false);

    if (up) {
      return async () => {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // Already gone.
        }

        await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      };
    }

    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(readFileSync(join(work, `dev-${label}.log`), 'utf8'));
  throw new Error(`The dev server (${label}) didn't answer at ${baseUrl}`);
}

/** Run shoot and return its JSON report; shoot exits 1 when a state fails, which isn't an error here. */
function shoot(names, out, compare) {
  const flags = [`--only ${quote(names.join(','))}`, `--out ${quote(out)}`, '--json', shootArgs];

  if (compare) flags.push(`--compare ${quote(compare)}`);

  const cmd = `${cli} shoot ${quote(scenarios)} --base-url ${quote(baseUrl)} ${flags.join(' ')}`;

  try {
    return JSON.parse(read(cmd));
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

const listNames = () => JSON.parse(read(`${cli} list ${quote(scenarios)} --json`)).map((s) => s.name);

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));

const pr = event.pull_request;

if (!pr) throw new Error('pr-screenshots runs on pull_request events');

const repo = process.env.GITHUB_REPOSITORY;

const head = read('git rev-parse HEAD').trim();

const fork = pr.head.repo?.full_name !== pr.base.repo.full_name;

log('Install the change');

run(install);

log('Which states the change touches');

const srcFlag = src ? `--src ${quote(src)}` : '';

const affected = JSON.parse(
  read(`${cli} affected ${quote(scenarios)} --base ${pr.base.sha} ${srcFlag} --json`),
);

const all = shootAll && affected.unmatched.length > 0;

const names = all ? listNames() : affected.scenarios.map((s) => s.name);

console.log(all ? `Shared files changed: shooting all ${names.length} states` : names.join('\n') || 'None');

let shots = [];

if (names.length) {
  log('Shoot the base');

  try {
    run(`git switch --detach ${pr.base.sha}`);
    run(install);
    const onBase = new Set(listNames());
    const before = names.filter((n) => onBase.has(n));

    if (before.length) {
      const stop = await startApp('base');

      try {
        shoot(before, join(work, 'before'));
      } finally {
        await stop();
      }
    }
  } catch (err) {
    // A base without scenarios (the PR adds them) shows every state as new.
    console.log(`No base screenshots: ${err.message.split('\n')[0]}`);
  }

  log('Shoot the change');
  run(`git switch --detach ${head}`);
  run(install);
  const stop = await startApp('head');

  try {
    const report = shoot(names, join(work, 'after'), join(work, 'before'));
    shots = report.scenarios ?? report;
  } finally {
    await stop();
  }
}

const images = shots.flatMap((s) => {
  if (!s.ok) return [];

  if (s.compare?.status === 'changed' && s.compare.image) return [s.compare.image];

  return !s.compare || s.compare.status === 'new' ? [s.screenshot] : [];
});

let links = {};

let note;

if (images.length && fork) {
  note = 'Images aren’t published for pull requests from forks; they’re in the workflow run’s artifacts.';
} else if (images.length) {
  log('Publish the images');

  const published = JSON.parse(
    read(
      `${cli} publish ${images.map(quote).join(' ')} --folder pr-${pr.number} --branch ${
        quote(branch)
      } --json`,
    ),
  );

  links = Object.fromEntries(published.map((l) => [l.file, l.url]));
}

const body = buildComment({
  shots,
  affected: affected.scenarios,
  unmatched: affected.unmatched,
  all,
  links,
  sha: head,
  note,
});

const bodyFile = join(work, 'comment.md');

writeFileSync(bodyFile, body);

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);

if (!fork && input('comment', 'true') === 'true') {
  log('Comment on the PR');

  const existing = read(
    `gh api --paginate repos/${repo}/issues/${pr.number}/comments --jq ${
      quote(`.[] | select(.user.login == "github-actions[bot]" and (.body | contains("${MARKER}"))) | .id`)
    }`,
  ).trim().split('\n')[0];

  run(
    existing
      ? `gh api -X PATCH repos/${repo}/issues/comments/${existing} -F body=@${quote(bodyFile)} --silent`
      : `gh api repos/${repo}/issues/${pr.number}/comments -F body=@${quote(bodyFile)} --silent`,
  );
}

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `out=${work}\n`);

const failing = shots.filter((s) => !s.ok);

if (failing.length && failOnError) {
  console.error(`\n${failing.length} state(s) fail on this change: ${failing.map((s) => s.name).join(', ')}`);
  process.exit(1);
}
