# side-piece

The other model, on the side.

`side-piece` gives your coding agent a second opinion. It pins [`ai-cli-mcp`](https://github.com/mkXultra/ai-cli-mcp) and installs one skill that teaches your agent to hand work to a *different* model — Claude, Codex, Gemini, OpenCode — as a resumable background run in an isolated worktree, then collect the result.

Works in **Claude Code**, **Codex**, and **opencode**.

## Install

From inside your project, give your coding agent this prompt:

> Let's install `@tjw/side-piece` in this project

That is the whole thing. Your agent installs the package, reads this file, and wires up whichever client it is running in.

## What gets installed

| Path | What | Committed |
| --- | --- | --- |
| `.agents/skills/side-piece/` | the skill — read natively by Codex and opencode | yes |
| `.claude/skills/side-piece` | symlink to the above; the only path Claude Code reads | yes |
| `.mcp.json` | Claude Code MCP entry | yes |
| `.codex/config.toml` | Codex MCP entry | yes |
| `opencode.json` | opencode MCP entry | yes |
| `node_modules/ai-cli-mcp` | the pinned server | no |

Everything the project needs is in the project. `node_modules` only supplies the pinned binary.

## Setup

```bash
npm install --save-dev @tjw/side-piece
npx side-piece install
```

`install` detects which client it is running inside and wires that one up. It reads `CLAUDECODE`, `CODEX_THREAD_ID` / `CODEX_SANDBOX`, and `OPENCODE`. Codex's `shell_environment_policy` can strip those, so when detection fails it asks — and when there is no terminal to ask, it exits with the exact command to re-run rather than guessing:

```bash
npx side-piece install --client claude     # or codex, opencode, all
npx side-piece install --client all --dry-run
npx side-piece doctor
```

Existing configuration is **merged, never replaced**. Other MCP servers in `.mcp.json`, other tables in `.codex/config.toml`, and the rest of `opencode.json` are preserved. Re-running changes nothing.

Reload or restart the client afterward, then confirm the server is live:

```bash
npx side-piece doctor
```

## Manual setup

If you would rather place things yourself, copy `skill/side-piece/` to `.agents/skills/side-piece/`, symlink `.claude/skills/side-piece` to it, and add the MCP entry from `templates/` to each client's config. The templates assume `mise` + `pnpm`; use whatever runner the project already uses — `pnpm exec ai-cli-mcp`, `npx ai-cli-mcp`, `yarn exec ai-cli-mcp`. The command must resolve `ai-cli-mcp` from the project, not from a global install.

## Using it

Ask for a model by name and the skill takes over:

> have opus review this diff adversarially
>
> get a second opinion from gpt-5.6-sol on the cache invalidation
>
> ask 0x alpha to try the migration in a worktree

The skill queries the live catalog before routing, so it never invents a model name. It runs every delegated task in the background with a PID and a session ID, which means a failed provider is resumed rather than restarted, and a long review survives a disconnected client.

Reviews get an isolated worktree and no mutation mandate. The `ai-cli` wrapper bypasses provider permission prompts, so that isolation is the safety boundary — not a setting.

## Commands

The pinned server is re-exposed under its own names, so every command works exactly as it does with a direct `ai-cli-mcp` dependency:

```bash
pnpm exec ai-cli models          # the routing catalog — check it before choosing
pnpm exec ai-cli doctor          # provider binaries on PATH (not login, not quota)
pnpm exec ai-cli run --cwd /abs/worktree --model opus --prompt-file /abs/prompt.md
pnpm exec ai-cli wait <pid> --timeout 300 --verbose
pnpm exec ai-cli result <pid> --verbose
```

This is the documented fallback while a client has not yet reloaded the MCP server. It shares the same process state, so runs stay resumable. It is not proof the MCP transport is healthy — check that with `claude mcp get ai-cli` or `codex mcp get ai-cli`.

### Why the bins are re-exposed

`ai-cli-mcp` is a dependency of `@tjw/side-piece`, which makes it *transitive* from your project's point of view. pnpm's isolated linker only hoists bins for direct dependencies, so under pnpm there is no `node_modules/.bin/ai-cli-mcp` to point a config at — only `.pnpm/ai-cli-mcp@2.22.0/…`, a path with the version baked into it. `@tjw/side-piece` *is* a direct dependency, so its bins always land in `node_modules/.bin`. Re-exposing `ai-cli-mcp` and `ai-cli` from here keeps every documented command working and keeps the version in exactly one place: this package's `package.json`.

## Before the first run

Each provider CLI must be installed and signed in on the host. `ai-cli doctor` reports only whether the binary is on `PATH` — not login, terms acceptance, or quota. Claude additionally needs one manual `claude --dangerously-skip-permissions` run to accept terms before the server can drive it.

## Updating

The server version lives in this package. Bump the dependency and reinstall:

```bash
npm install --save-dev @tjw/side-piece@latest
npx side-piece install --force
```

## License

MIT © Justin Walsh
