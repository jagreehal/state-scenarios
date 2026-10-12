import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CliError } from './errors.js';

/** Shipped in the package, so the guidance always matches the installed version. */
const SKILLS = fileURLToPath(new URL('../skills/', import.meta.url));

export const SKILL_NAMES = ['state-scenarios', 'create-scenario-map'];

const topics = () =>
  readdirSync(join(SKILLS, 'state-scenarios/references')).map((f) => f.replace(/\.md$/, '')).toSorted();

/** The skill's overview, or one topic of it. */
export function guide(topic?: string): string {
  if (!topic) return readFileSync(join(SKILLS, 'state-scenarios/SKILL.md'), 'utf8');

  if (!topics().includes(topic)) {
    throw new CliError('INVALID_ARGUMENT', `Unknown topic "${topic}". Topics: ${topics().join(', ')}`);
  }

  return readFileSync(join(SKILLS, `state-scenarios/references/${topic}.md`), 'utf8');
}

/**
 * Copy the skills into `.agents/skills/` (Codex, Cursor and others read it) and link them
 * from `.claude/skills/` for Claude Code. Rerun after an upgrade to update them.
 */
export function installSkills(cwd: string): string[] {
  return SKILL_NAMES.map((name) => {
    const target = join(cwd, '.agents/skills', name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(SKILLS, name), target, { recursive: true });

    const link = join(cwd, '.claude/skills', name);
    mkdirSync(dirname(link), { recursive: true });

    if (existsSync(link) || isLink(link)) rmSync(link, { recursive: true, force: true });

    try {
      symlinkSync(relative(dirname(link), target), link, 'dir');
    } catch {
      // Windows without Developer Mode can't create symlinks: copy instead.
      cpSync(target, link, { recursive: true });
    }

    return `Installed skill ${relative(cwd, target).replaceAll('\\', '/')} (and .claude/skills/${name})`;
  });
}

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const McpConfig = z.looseObject({ mcpServers: z.record(z.string(), z.unknown()).optional() });

/**
 * Register `state-scenarios mcp` with Claude Code (`.mcp.json`) and, when the project uses it,
 * Cursor (`.cursor/mcp.json`). An existing entry is kept.
 */
export function registerMcp(cwd: string, args: string[]): string[] {
  // Windows can't spawn npx directly from an MCP client: go through cmd.
  const server = process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', 'state-scenarios', ...args] }
    : { command: 'npx', args: ['state-scenarios', ...args] };

  const files = ['.mcp.json', ...(existsSync(join(cwd, '.cursor')) ? ['.cursor/mcp.json'] : [])];

  return files.map((file) => {
    const path = join(cwd, file);
    const config = existsSync(path) ? McpConfig.parse(JSON.parse(readFileSync(path, 'utf8'))) : {};

    if (config.mcpServers?.['state-scenarios']) return `Kept the state-scenarios server in ${file}`;
    writeFileSync(
      path,
      `${
        JSON.stringify(
          { ...config, mcpServers: { ...config.mcpServers, 'state-scenarios': server } },
          null,
          2,
        )
      }\n`,
    );

    return `Registered the state-scenarios MCP server in ${file}`;
  });
}
