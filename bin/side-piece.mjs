#!/usr/bin/env node
// side-piece installer.
//
//   side-piece install [--client <c>...] [--dry-run] [--force] [--dir <path>]
//   side-piece doctor  [--dir <path>]
//   side-piece help
//
// Places the skill under .agents/skills/side-piece (read natively by Codex and
// opencode), bridges it to .claude/skills/side-piece by symlink (the only path
// Claude Code reads), and merges an `ai-cli` MCP entry into each client's
// config. Existing config is merged, never replaced.

import { cp, lstat, mkdir, readFile, readlink, realpath, symlink, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { execFile } from 'node:child_process';

const SKILL = 'side-piece';
const SERVER = 'side-piece';
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENTS = ['claude', 'codex', 'opencode'];

// ---------------------------------------------------------------- detection

// Signals confirmed by inspecting each CLI's own binary and a live session.
// Codex only exports CODEX_SANDBOX when sandboxed, so CODEX_THREAD_ID carries
// detection under danger-full-access. Any of them can be stripped by Codex's
// shell_environment_policy, so detection is allowed to fail and ask.
const SIGNALS = [
  { client: 'claude', vars: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] },
  { client: 'codex', vars: ['CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_MANAGED_PACKAGE_ROOT'] },
  { client: 'opencode', vars: ['OPENCODE', 'OPENCODE_CONFIG_DIR'] },
];

function detectClient(env = process.env) {
  if (env.SIDE_PIECE_CLIENT) return { client: env.SIDE_PIECE_CLIENT, signal: 'SIDE_PIECE_CLIENT' };
  if (env.AI_AGENT?.startsWith('claude-code')) return { client: 'claude', signal: 'AI_AGENT' };
  for (const { client, vars } of SIGNALS) {
    const hit = vars.find((name) => env[name]);
    if (hit) return { client, signal: hit };
  }
  return { client: null, signal: null };
}

// The MCP command must match how the project already runs tooling, so the
// entry we write is the one a human would have written by hand.
function detectRunner(root) {
  const has = (file) => existsSync(join(root, file));
  const mise = has('mise.toml') || has('.mise.toml');
  if (has('pnpm-lock.yaml') || has('pnpm-workspace.yaml')) {
    return mise
      ? { command: 'mise', args: ['exec', '--', 'pnpm', 'exec', 'side-piece-mcp'] }
      : { command: 'pnpm', args: ['exec', 'side-piece-mcp'] };
  }
  if (has('yarn.lock')) return { command: 'yarn', args: ['exec', 'side-piece-mcp'] };
  if (has('bun.lockb') || has('bun.lock')) return { command: 'bun', args: ['x', 'side-piece-mcp'] };
  return { command: 'npx', args: ['side-piece-mcp'] };
}

function findProjectRoot(start) {
  let directory = resolve(start);
  const { root } = parse(directory);
  while (true) {
    if (existsSync(join(directory, 'package.json')) || existsSync(join(directory, '.git'))) return directory;
    if (directory === root) return null;
    directory = dirname(directory);
  }
}

// ------------------------------------------------------------------- config

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

async function mergeJson(path, mutate, plan) {
  const before = await readJson(path, null);
  const document = before ?? {};
  const changed = mutate(document);
  if (!changed) return plan.push({ path, action: 'already configured' });
  plan.push({ path, action: before ? 'merged' : 'created', write: `${JSON.stringify(document, null, 2)}\n` });
}

// No safe stdlib TOML writer exists, so the Codex entry is appended as text and
// guarded by a header match. Everything already in the file is preserved.
async function mergeToml(path, block, plan) {
  let before = null;
  try {
    before = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (before && new RegExp(`^\\s*\\[mcp_servers\\.${SERVER}\\]`, 'm').test(before)) {
    return plan.push({ path, action: 'already configured' });
  }
  const preamble = before
    ? ''
    : '# Project-scoped Codex MCP configuration. The project must be trusted\n' +
      '# before Codex Desktop or Codex CLI will load this file.\n\n' +
      'sandbox_mode = "workspace-write"\n\n[sandbox_workspace_write]\nnetwork_access = true\n';
  const separator = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  plan.push({ path, action: before ? 'appended' : 'created', write: `${before ?? preamble}${separator}${block}` });
}

function tomlBlock(runner) {
  const args = runner.args.map((value) => JSON.stringify(value)).join(', ');
  return (
    `[mcp_servers.${SERVER}]\n` +
    `command = ${JSON.stringify(runner.command)}\n` +
    `args = [${args}]\n` +
    'startup_timeout_sec = 20\n' +
    'tool_timeout_sec = 3600\n\n' +
    `[mcp_servers.${SERVER}.env]\n` +
    'MCP_CLAUDE_DEBUG = "false"\n'
  );
}

// -------------------------------------------------------------------- steps

async function planSkill(root, force, plan) {
  const destination = join(root, '.agents', 'skills', SKILL);
  plan.push({
    path: destination,
    action: existsSync(destination) ? (force ? 'overwritten' : 'already present') : 'created',
    copy: existsSync(destination) && !force ? null : join(PACKAGE_ROOT, 'skill', SKILL),
  });
}

async function planClaudeLink(root, plan) {
  const link = join(root, '.claude', 'skills', SKILL);
  const target = join(root, '.agents', 'skills', SKILL);
  let action = 'created';
  try {
    const stats = await lstat(link);
    if (!stats.isSymbolicLink()) {
      throw new Error(`${link} exists and is not a symlink; move it aside and re-run`);
    }
    action = (await realpath(link).catch(() => null)) === target ? 'already linked' : 'repaired';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  plan.push({ path: link, action, link: action === 'already linked' ? null : target });
}

async function buildPlan(root, clients, force) {
  const runner = detectRunner(root);
  const plan = [];
  await planSkill(root, force, plan);

  if (clients.includes('claude')) {
    await planClaudeLink(root, plan);
    await mergeJson(
      join(root, '.mcp.json'),
      (document) => {
        document.mcpServers ??= {};
        if (document.mcpServers[SERVER] && !force) return false;
        document.mcpServers[SERVER] = { ...runner, env: { MCP_CLAUDE_DEBUG: 'false' } };
        return true;
      },
      plan,
    );
  }

  if (clients.includes('codex')) {
    await mergeToml(join(root, '.codex', 'config.toml'), tomlBlock(runner), plan);
  }

  if (clients.includes('opencode')) {
    await mergeJson(
      join(root, 'opencode.json'),
      (document) => {
        document.$schema ??= 'https://opencode.ai/config.json';
        document.mcp ??= {};
        if (document.mcp[SERVER] && !force) return false;
        document.mcp[SERVER] = {
          type: 'local',
          command: [runner.command, ...runner.args],
          enabled: true,
          environment: { MCP_CLAUDE_DEBUG: 'false' },
        };
        return true;
      },
      plan,
    );
  }
  return { plan, runner };
}

async function applyPlan(plan) {
  for (const step of plan) {
    if (step.copy) {
      await mkdir(dirname(step.path), { recursive: true });
      await cp(step.copy, step.path, { recursive: true, force: true });
    }
    if (step.link) {
      await mkdir(dirname(step.path), { recursive: true });
      await unlink(step.path).catch(() => {});
      await symlink(relative(dirname(step.path), step.link), step.path, 'dir');
    }
    if (step.write !== undefined) {
      await mkdir(dirname(step.path), { recursive: true });
      await writeFile(step.path, step.write, 'utf8');
    }
  }
}

// -------------------------------------------------------------------- doctor

// Ask the pinned server which provider binaries it can actually see. Placement
// and config being correct proves nothing if no provider CLI is installed --
// that is the most common reason a clean install still cannot run anything.
async function providerReport() {
  let entry;
  try {
    const { resolveBin } = await import('./resolve.mjs');
    entry = fileURLToPath(resolveBin('ai-cli').href);
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    execFile(process.execPath, [entry, 'doctor'], { timeout: 20000 }, (error, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

async function doctor(root) {
  const require = createRequire(join(PACKAGE_ROOT, 'package.json'));
  const lines = [];
  let failed = false;
  const check = (ok, label, detail) => {
    if (!ok) failed = true;
    lines.push(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  const note = (label, detail) => lines.push(`  --    ${label}${detail ? ` — ${detail}` : ''}`);

  let version = null;
  try {
    version = JSON.parse(await readFile(require.resolve('ai-cli-mcp/package.json'), 'utf8')).version;
  } catch {}
  check(Boolean(version), 'pinned server resolves', version ? `ai-cli-mcp ${version}` : 'not found — run npm install');

  const skill = join(root, '.agents', 'skills', SKILL, 'SKILL.md');
  check(existsSync(skill), 'skill installed', relative(root, skill));

  const link = join(root, '.claude', 'skills', SKILL);
  const linked = await readlink(link).catch(() => null);
  check(Boolean(linked), 'claude skill link', linked ?? 'missing — Claude Code will not see the skill');

  const mcp = await readJson(join(root, '.mcp.json'), null);
  check(Boolean(mcp?.mcpServers?.[SERVER]), 'claude .mcp.json entry');

  const codex = await readFile(join(root, '.codex', 'config.toml'), 'utf8').catch(() => '');
  check(new RegExp(`^\\s*\\[mcp_servers\\.${SERVER}\\]`, 'm').test(codex), 'codex config.toml entry');

  const opencode = await readJson(join(root, 'opencode.json'), null);
  check(Boolean(opencode?.mcp?.[SERVER]), 'opencode.json entry');

  const providers = await providerReport();
  if (!providers) {
    note('provider CLIs', 'could not query the server');
  } else {
    const names = Object.keys(providers).filter((key) => key !== 'checks');
    const found = names.filter((name) => providers[name]?.available);
    check(found.length > 0, 'a provider CLI is installed', found.length ? found.join(', ') : 'none found — install and sign in to at least one');
    for (const name of names) {
      if (!providers[name]?.available) note(`  ${name}`, 'not on PATH');
    }
    note('login and quota', 'not checked — run each provider\'s own status command');
  }

  process.stdout.write(`side-piece doctor — ${root}\n${lines.join('\n')}\n`);
  return !failed;
}

// --------------------------------------------------------------- passthrough

// Everything the skill and README tell people to run goes through here, so the
// underlying server is an implementation detail we can replace without
// invalidating a single documented command.
//
// Names verified against `ai-cli --help`: run, wait, peek, ps, result, kill,
// cleanup, doctor, models. Only "providers" is renamed — "doctor" is taken by
// our own install check, which now also folds in the provider report.
const FORWARDED = new Set([
  'models', 'run', 'wait', 'result', 'peek', 'ps', 'kill', 'cleanup', 'providers', 'exec',
]);
const RENAMED = { providers: 'doctor' };

async function forward(command, rest) {
  const { runBin, resolveBin } = await import('./resolve.mjs');
  const argv = command === 'exec' ? rest : [RENAMED[command] ?? command, ...rest];
  process.argv = [process.argv[0], fileURLToPath(resolveBin('ai-cli').href), ...argv];
  await runBin('ai-cli');
}

// ---------------------------------------------------------------------- cli

function parseArgs(argv) {
  if (FORWARDED.has(argv[0])) return { command: argv[0], clients: [], dryRun: false, force: false, dir: process.cwd() };
  const options = { command: argv[0] ?? 'help', clients: [], dryRun: false, force: false, dir: process.cwd() };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run' || argument === '-n') options.dryRun = true;
    else if (argument === '--force' || argument === '-f') options.force = true;
    else if (argument === '--dir') options.dir = argv[++index];
    else if (argument === '--client' || argument === '-c') options.clients.push(...argv[++index].split(','));
    else if (argument.startsWith('-')) throw new Error(`unknown flag: ${argument}`);
  }
  return options;
}

const HELP = `side-piece — the other model, on the side.

Setup
  side-piece install [options]   place the skill and wire up MCP config
  side-piece doctor              placement, MCP entries, server, provider binaries

Routing
  side-piece models              the routing catalog — check before choosing
  side-piece providers           which provider CLIs are on PATH
  side-piece run <args...>       start a background run
  side-piece wait <pid>          block until a run finishes
  side-piece result <pid>        the authoritative result
  side-piece peek <pid>          a bounded progress sample
  side-piece ps                  runs this host still tracks
  side-piece cleanup             forget completed and failed runs
  side-piece kill <pid>          cancel a run
  side-piece exec <args...>      anything else, forwarded verbatim

Options
  -c, --client <c[,c]>   claude | codex | opencode | all (default: detected)
  -n, --dry-run          show the plan without writing anything
  -f, --force            overwrite an existing skill or MCP entry
      --dir <path>       project root (default: nearest package.json or .git)

Detection reads CLAUDECODE, CODEX_THREAD_ID / CODEX_SANDBOX, and OPENCODE.
Set SIDE_PIECE_CLIENT to override it.
`;

async function chooseClients(options) {
  if (options.clients.length) {
    const requested = options.clients.includes('all') ? CLIENTS : options.clients;
    const unknown = requested.filter((client) => !CLIENTS.includes(client));
    if (unknown.length) throw new Error(`unknown client: ${unknown.join(', ')}`);
    return { clients: requested, how: 'requested' };
  }
  const { client, signal } = detectClient();
  if (client && CLIENTS.includes(client)) return { clients: [client], how: `detected via ${signal}` };

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Which client? [${CLIENTS.join('/')}/all] `);
    rl.close();
    const picked = answer.trim().toLowerCase();
    if (picked === 'all') return { clients: CLIENTS, how: 'chosen' };
    if (CLIENTS.includes(picked)) return { clients: [picked], how: 'chosen' };
    throw new Error(`unknown client: ${picked}`);
  }

  // Non-interactive and undetectable: never guess, never hang. Exit with an
  // instruction the calling agent can act on directly.
  throw new Error(
    'could not detect the client and there is no TTY to ask.\n' +
      '  Re-run with an explicit client, for example:\n' +
      '    npx side-piece install --client claude\n' +
      '    npx side-piece install --client all',
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help' || options.command === '--help' || options.command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  const root = findProjectRoot(options.dir);
  if (!root) throw new Error(`no project root at or above ${options.dir} (looked for package.json or .git)`);

  if (FORWARDED.has(options.command)) {
    await forward(options.command, process.argv.slice(3));
    return 0;
  }
  if (options.command === 'doctor') return (await doctor(root)) ? 0 : 1;
  if (options.command !== 'install') throw new Error(`unknown command: ${options.command}`);

  const { clients, how } = await chooseClients(options);
  const { plan, runner } = await buildPlan(root, clients, options.force);

  const header =
    `side-piece install — ${root}\n` +
    `  clients: ${clients.join(', ')} (${how})\n` +
    `  server:  ${runner.command} ${runner.args.join(' ')}\n`;
  const body = plan
    .map((step) => `  ${step.action.padEnd(18)} ${relative(root, step.path) || '.'}`)
    .join('\n');
  process.stdout.write(`${header}${body}\n`);

  if (options.dryRun) {
    process.stdout.write('\n  dry run — nothing written\n');
    return 0;
  }
  await applyPlan(plan);
  process.stdout.write('\n  Restart or reload the client, then verify with: npx side-piece doctor\n');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`side-piece: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
