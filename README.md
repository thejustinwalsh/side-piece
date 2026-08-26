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
| `.mcp.json` | Claude Code MCP entry (`side-piece`) | yes |
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

Reviews get a clean worktree and no permission to write to yours. The wrapper bypasses provider permission prompts, so that isolation is the safety boundary, not a setting you can rely on.

## Asking for a model

Say the short name. Resolving it is the skill's job — it checks the live catalog and maps your word to whatever that provider actually calls the model today.

| Say | You get |
| --- | --- |
| `opus`, `sonnet`, `haiku` | Claude, at high reasoning effort |
| `fable` | Claude Fable — explicit only, never auto-chosen, may need credits |
| `sol`, `terra`, `luna` | the matching Codex 5.6 model |
| `gemini` | Gemini |
| `mimo`, `nemotron`, `pickle` | the matching OpenCode model |
| `ultra`, `hardest`, `max effort` | the top tier for whichever provider you picked |

Those OpenCode names are examples, not a fixed list — that catalog rotates, so the skill discovers it at routing time rather than trusting anything written here. Run `npx side-piece models` to see what is live.

Naming a model always beats the skill's own preference. Ask for something the catalog does not have and it says so, rather than quietly substituting.

Useful shapes:

> get a second opinion from sol on the cache invalidation
>
> ask mimo to try the migration in a worktree and show me the diff
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

Routing, when you want to drive it yourself:

```bash
npx side-piece models                    # the live catalog — check before choosing
npx side-piece providers                 # provider binaries on PATH, not login or quota
npx side-piece run --cwd /abs/worktree --model opus --prompt-file /abs/prompt.md
npx side-piece wait <pid> --timeout 300 --verbose
npx side-piece result <pid> --verbose
npx side-piece ps                        # runs this host still tracks
```

Use these rather than the underlying server's own commands. `side-piece` is the stable surface; what runs beneath it can be swapped without invalidating anything documented here.

This is also the documented fallback while a client has not reloaded the MCP server yet. It shares the same process state, so runs stay resumable. It is *not* evidence the MCP transport is healthy — check that with `claude mcp get side-piece` or `codex mcp get side-piece`.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| Agent cannot see the `side-piece` tools | the client was not restarted after install |
| `doctor` says the skill link is missing | Claude Code only reads `.claude/skills`; re-run `install --client claude` |
| A run fails instantly with an auth error | that provider CLI is installed but not signed in |
| Claude runs fail before starting | terms not accepted — run `claude --dangerously-skip-permissions` once |
| A model name is rejected | it is not in the live catalog; check `npx side-piece models` |
| Codex cannot find the config | the project has not been trusted in Codex yet |

## Manual setup

If you would rather place things yourself: copy `skill/side-piece/` to `.agents/skills/side-piece/`, symlink `.claude/skills/side-piece` to it, and add the MCP entry from `templates/` to each client's config. The templates assume `mise` + `pnpm`; use whatever the project already uses. The command must resolve `side-piece-mcp` from the project rather than a global install.

## Updating

The server version lives in this package and nowhere else, so it cannot drift out from under your config:

```bash
npm install --save-dev @tjw.dev/side-piece@latest
npx side-piece install --force
```

## Notes

The MCP entry runs `side-piece-mcp`, a bin this package owns, and every documented command goes through `side-piece`. Both are deliberate: the server underneath is pinned as a normal dependency and can be replaced without touching a config file or a line of documentation.

That indirection is also load bearing under pnpm. A dependency of a dependency gets no entry in your project's root `node_modules/.bin`, so pointing a config at the server directly would work under npm and break under pnpm. This package is a direct dependency, so its bins always land there.

Built on [ai-cli-mcp](https://github.com/mkXultra/ai-cli-mcp) by mkXultra.

MIT © Justin Walsh
