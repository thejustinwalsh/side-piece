# side-piece

The other model, on the side.

Your coding agent is good. It is also the only opinion in the room. `side-piece` teaches it to hand work to a *different* model — Claude, Codex, Gemini, OpenCode — and collect the answer without losing its place.

Say *"have opus review this adversarially"* and your agent spawns Opus against an isolated worktree, in the background, with a session it can resume. It reads the result, tells you what came back, and your own context never left the room.

Works in **Claude Code**, **Codex**, and **opencode**. Runs entirely on your machine, through provider CLIs you already have. There is no service in the middle and no account to make.

## What you need

| | |
| --- | --- |
| Node | 20.19+ or 22.12+ |
| A client | Claude Code, Codex, or opencode |
| A provider CLI | at least one of `claude`, `codex`, `gemini`, `opencode`, installed **and signed in** |

That last row is the one that bites. `side-piece` drives provider CLIs that are already authenticated on your host — it cannot log in for you. Claude additionally needs one manual `claude --dangerously-skip-permissions` run to accept terms before anything can drive it.

## Install

From inside your project, give your coding agent this prompt:

> Let's install `@tjw.dev/side-piece` in this project, then tell me how to use it

That is the whole thing.

### If you are the coding agent reading this

You were pointed here by that prompt. Do these, in order:

1. Install the package: `npm install --save-dev @tjw.dev/side-piece` — or the project's own package manager, matching whatever lockfile is present.
2. Run `npx side-piece install`. It detects which client you are and wires that one up. If detection fails it will tell you exactly which flag to re-run with; pass `--client claude`, `codex`, `opencode`, or `all`.
3. Run `npx side-piece doctor` and confirm every line reads `ok`.
4. Tell the human to **restart or reload their client** — MCP servers are read at startup, so nothing you just wrote is live until they do. This is the single most common reason a correct install appears broken.
5. Then read *Use it* and *Asking for a model* below, and explain both to them in your own words. Do not skip this; the prompt asked for it.

Do not edit files under `.agents/skills/side-piece/` — that directory is managed by the package and is replaced on update.

## What gets installed

| Path | What | Committed |
| --- | --- | --- |
| `.agents/skills/side-piece/` | the skill — read natively by Codex and opencode | yes |
| `.claude/skills/side-piece` | symlink to the above; the only path Claude Code reads | yes |
| `.mcp.json` | Claude Code MCP entry | yes |
| `.codex/config.toml` | Codex MCP entry | yes |
| `opencode.json` | opencode MCP entry | yes |
| `node_modules/ai-cli-mcp` | the pinned server | no |

Everything the project needs is in the project; `node_modules` only supplies the pinned binary. Existing configuration is **merged, never replaced** — your other MCP servers, other `config.toml` tables, and the rest of `opencode.json` all survive. Running `install` twice changes nothing.

## Use it

1. Restart or reload your client, so it picks up the new MCP server.
2. Confirm the tools are live — ask your agent to list its MCP tools, or run `npx side-piece doctor`.
3. Ask for a review in plain language: *"have opus review this diff adversarially and cite file and line for every claim."*
4. Your agent resolves the model against the live catalog, starts a background run in an isolated worktree, and hands you back a PID and a session ID.
5. Ask for another pass whenever you want — *"push back on point 3"* — and it resumes that same session instead of starting over.

Reviews get a clean worktree and no permission to write to yours. The `ai-cli` wrapper bypasses provider permission prompts, so that isolation is the safety boundary, not a setting you can rely on.

## Asking for a model

Say the name; the skill resolves it. It checks the live catalog first, so it never invents one.

| Say | You get |
| --- | --- |
| `opus`, `sonnet`, `haiku` | Claude, at high reasoning effort |
| `fable` | Claude Fable — explicit only, never auto-chosen, may need credits |
| `sol`, `terra`, `luna` | the Codex 5.6 family |
| `gpt-5.5`, `gpt-5.3-codex`, … | Codex, by exact name |
| `gemini` | Gemini, by exact catalog name |
| `0x alpha` | OpenCode `x-preview-f-free` |
| `ultra`, `hardest`, `max effort` | the matching ultra alias, which sets its own effort |

Naming a model always wins over the skill's own preference. Ask for something the catalog does not have and it reports that, rather than quietly substituting.

Useful shapes:

> get a second opinion from gpt-5.6-sol on the cache invalidation
>
> ask 0x alpha to try the migration in a worktree and show me the diff
>
> have opus and sol both review this, then tell me where they disagree

That last one is worth knowing: parallel runs start together and are waited on together.

## Commands

```bash
npx side-piece install --client all      # wire every client, not just the detected one
npx side-piece install --dry-run         # print the plan, write nothing
npx side-piece install --force           # overwrite an existing skill or MCP entry
npx side-piece doctor                    # verify placement and every client entry
```

The pinned server is re-exposed under its own names, so it behaves exactly like a direct `ai-cli-mcp` dependency:

```bash
pnpm exec ai-cli models                  # the routing catalog
pnpm exec ai-cli doctor                  # provider binaries on PATH — not login, not quota
pnpm exec ai-cli run --cwd /abs/worktree --model opus --prompt-file /abs/prompt.md
pnpm exec ai-cli wait <pid> --timeout 300 --verbose
pnpm exec ai-cli result <pid> --verbose
```

This is the documented fallback while a client has not reloaded the MCP server yet. It shares the same process state, so runs stay resumable. It is *not* evidence the MCP transport is healthy — check that with `claude mcp get ai-cli` or `codex mcp get ai-cli`.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| Agent cannot see the `ai-cli` tools | the client was not restarted after install |
| `doctor` says the skill link is missing | Claude Code only reads `.claude/skills`; re-run `install --client claude` |
| A run fails instantly with an auth error | that provider CLI is installed but not signed in |
| Claude runs fail before starting | terms not accepted — run `claude --dangerously-skip-permissions` once |
| A model name is rejected | it is not in this server version's catalog; check `pnpm exec ai-cli models` |
| Codex cannot find the config | the project has not been trusted in Codex yet |

## Manual setup

If you would rather place things yourself: copy `skill/side-piece/` to `.agents/skills/side-piece/`, symlink `.claude/skills/side-piece` to it, and add the MCP entry from `templates/` to each client's config. The templates assume `mise` + `pnpm`; use whatever the project already uses. The command must resolve `ai-cli-mcp` from the project rather than a global install.

## Updating

The server version lives in this package and nowhere else, so it cannot drift out from under your config:

```bash
npm install --save-dev @tjw.dev/side-piece@latest
npx side-piece install --force
```

## Notes

`ai-cli-mcp` is our dependency, which makes it transitive from your project's view — and pnpm gives transitive bins no entry in your root `node_modules/.bin`. This package is a direct dependency, so its bins always land there. That is why `ai-cli-mcp` and `ai-cli` are re-exposed from here: every documented command keeps working, under every package manager, with the version pinned in exactly one place.

Built on [ai-cli-mcp](https://github.com/mkXultra/ai-cli-mcp) by mkXultra.

MIT © Justin Walsh
