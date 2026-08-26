---
name: side-piece
description: Route resumable external-model work through the pinned ai-cli-mcp server. Use for adversarial reviews, implementation reviews, research, and one-off delegated tasks when the user names Claude, Opus, Fable, Sonnet, Haiku, Codex, GPT-5, Sol, Terra, Luna, Gemini, Forge, OpenCode, 0x Alpha, or asks for an external model, a second opinion, or a review by another agent.
license: MIT
metadata:
  package: "@tjw/side-piece"
  server: ai-cli-mcp@2.22.0
  homepage: https://tjw.dev/side-piece
---

# side-piece

Use the project's pinned `ai-cli-mcp@2.22.0` server for external-model work. Do not launch provider CLIs directly when the MCP server can do the job: the server owns background process tracking, session IDs, result retrieval, and provider-specific argument validation.

Every run is resumable. Start it with `run`, retain the returned PID, use `peek` only for a bounded progress sample, use `wait` or `get_result` for the authoritative outcome, and resume with the returned `session_id` when a provider fails or the user asks for another pass. A one-off task is still started in the background; `wait` immediately afterward is the blocking recipe.

## Setup and health check

Before using a new checkout or machine:

1. Confirm `package.json` depends on `@tjw/side-piece`, which pins `ai-cli-mcp` exactly. Confirm the lockfile agrees.
2. Confirm the MCP entry in `.mcp.json` (Claude Code), `.codex/config.toml` (Codex), and `opencode.json` (opencode) invokes the workspace launcher `node_modules/@tjw/side-piece/bin/mcp.mjs`. That launcher resolves the pinned server from the workspace; never substitute an unpinned `npx ai-cli-mcp@latest` download.
3. Run `npx side-piece doctor`. It verifies skill placement, every client's MCP entry, and the resolved server version.
4. Run `npx ai-cli models` and retain the structured output as the model-routing fact for this run.
5. Run `npx ai-cli doctor` for binary availability. It does not prove login, terms acceptance, quota, or provider health, so check those with the provider's own status command when a run needs them.
6. Reload/restart the MCP client after adding or changing any MCP configuration. Confirm that the `ai-cli` MCP tools (`models`, `run`, `wait`, `get_result`) are present in the active tool registry.
7. Perform a small background smoke run through those MCP tools in an isolated temporary worktree, wait for it, and verify that a non-empty result includes a session ID. Resume that session with a second tiny prompt before declaring the router healthy.

`npx ai-cli run` is useful for diagnosing the pinned package and provider authentication, but it is only the CLI façade and does not validate the MCP transport. If the MCP server is not visible to the host client, inspect Codex with `codex mcp get ai-cli` and Claude with `claude mcp get ai-cli`, then reload the client. A missing server is a setup failure; do not report the CLI façade as an MCP smoke test or fall back silently to direct provider CLIs.

Each provider CLI must be installed and signed in on the host before the router can reach it. `ai-cli doctor` reports presence only. Claude additionally requires one manual `claude --dangerously-skip-permissions` run to accept terms before the server can drive it.

### CLI fallback while MCP is unavailable

Use the CLI façade temporarily when the host client has not reloaded the server:

```bash
npx ai-cli models
npx ai-cli run --cwd /absolute/worktree --model <validated-model> --prompt-file /absolute/prompt.md
npx ai-cli wait <pid> --timeout 300 --verbose
npx ai-cli result <pid> --verbose
```

`npx` resolves `ai-cli` from the workspace `node_modules`, so this is the same pinned build the MCP server uses. The fallback is resumable and shares server-side process state. Capture the returned PID, provider/model, absolute worktree, target commit, and returned `session_id`; resume with `run --session-id <session_id>`. Label the run `transport: cli-fallback` and keep trying to restore MCP visibility. Never replace this with a globally installed or unpinned provider CLI, and never claim MCP is healthy because the fallback succeeded.

## Route from facts, not guesses

An explicit user model choice always wins over a task-based preference. The router may recommend a model when the user leaves it open, but it must not substitute a preferred model after the user names one. It still validates the requested name against the live catalog and reports an unavailable or malformed route instead of silently changing providers.

Before selecting a model, call the server's `models` tool. Treat its structured response as the catalog. The `2.22.0` shape is:

```json
{
  "aliases": [
    { "name": "claude-ultra",  "resolvesTo": "opus",                    "agent": "claude", "defaultReasoningEffort": "max" },
    { "name": "codex-ultra",   "resolvesTo": "gpt-5.6-sol",             "agent": "codex",  "defaultReasoningEffort": "ultra" },
    { "name": "gemini-ultra",  "resolvesTo": "gemini-3.1-pro-preview",  "agent": "gemini" }
  ],
  "claude": ["sonnet", "sonnet[1m]", "opus", "opusplan", "fable", "haiku"],
  "codex": ["gpt-5.4", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
            "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"],
  "gemini": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.1-pro-preview",
             "gemini-3-pro-preview", "gemini-3-flash-preview"],
  "forge": ["forge"],
  "opencode": ["opencode"],
  "dynamicModelBackends": {
    "opencode": {
      "explicitPrefix": "oc-",
      "explicitPattern": "oc-<provider/model>",
      "discoveryCommand": "opencode models",
      "modelsAreDynamic": true
    }
  }
}
```

Apply these mappings only after checking the live catalog:

| User wording | `ai-cli` model | Provider rule |
| --- | --- | --- |
| `sol` | `gpt-5.6-sol` | Codex; accepts effort up to `ultra`. |
| `terra`, `tera` | `gpt-5.6-terra` | Codex; accepts effort up to `ultra`. |
| `luna` | `gpt-5.6-luna` | Codex; accepts effort up to `max`, not `ultra`. |
| `opus` | `opus` | Claude; `reasoning_effort: high` by default. |
| `fable` | `fable` | Claude; explicit request only, never auto-selected. May require usage credits. |
| `gemini` | the explicit catalog name | Gemini; this integration does not document a reasoning tier. |
| `forge` | `forge` | Provider key, not a model-family selector. |
| `0x`, `0x alpha`, `0xAlpha` | `oc-opencode/x-preview-f-free` | OpenCode explicit model; omit `reasoning_effort`. |
| `claude:<catalog-model>` | the suffix | Claude; validate the suffix against `models`. |
| `codex:<catalog-model>` | the suffix | Codex; validate the suffix against `models`. |
| `opencode:<provider>/<model>` | `oc-<provider>/<model>` | Validate the backend with `opencode models`; omit `reasoning_effort`. |
| `ultra`, `max effort`, `hardest` | the matching `*-ultra` alias | The alias sets its own effort; do not also pass `reasoning_effort`. |

The `oc-` prefix is required by `ai-cli-mcp`; `opencode/x-preview-f-free` is the provider-native identifier, not the value passed to `ai-cli`. The router must translate it to `oc-opencode/x-preview-f-free`.

### Effort

Every Claude and Codex route defaults to `reasoning_effort: high`. Use a higher tier only when the user explicitly requests that effort; choosing an expensive model or asking for a difficult review does not imply it.

Accepted values are provider- and model-specific, and the server rejects anything outside them:

| Provider | Accepted `reasoning_effort` |
| --- | --- |
| Claude | `low`, `medium`, `high`, `xhigh`, `max` |
| Codex, all models | `low`, `medium`, `high`, `xhigh` |
| Codex `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | additionally `max` |
| Codex `gpt-5.6-sol`, `gpt-5.6-terra` | additionally `ultra` |
| Gemini, Forge, OpenCode | omit the field |

Selecting a `*-ultra` alias is itself the explicit high-effort request: the alias carries its own effort, so do not pass `reasoning_effort` alongside it. Never substitute or silently retry at a different tier when a requested one is rejected; report the rejection and the accepted set.

## Review recipe

For an adversarial review:

1. Resolve the model with `models` and choose the requested provider explicitly.
2. Use an absolute isolated worktree as `workFolder`; include the target commit, review scope, acceptance criteria, and the instruction to report evidence with file/line references.
3. Call `run` with the review prompt. Do not give a review agent a mutation mandate. The ai-cli wrapper bypasses provider permissions, so isolation and a clean worktree are the safety boundary.
4. Record PID, session ID, provider, model, worktree, target commit, and status in the ignored `.cache/side-piece/` run manifest.
5. Use `peek` for a short progress sample only. Use `wait` or `get_result` to collect the complete result.
6. On a transient provider failure, call `run` again with the same `session_id` and the same worktree. Do not start a fresh session unless the original session is unrecoverable.
7. After integration changes, run a new review against the new commit; do not ask a stale session to review a different checkout without stating the new target.

For parallel reviews, start all runs first, then wait on their PIDs together. Keep each worktree and manifest distinct. A successful process exit is not proof of a useful review; require a structured report and inspect the cited source.

## Implementation recipe

Use the same lifecycle for delegated implementation, but make the prompt explicitly mutation-authorized and name the exact branch/worktree. Require the agent to preserve repository instructions, run the narrow gate, and commit only its coherent slice. Review and integrate the result locally before running external review or broader checks.

## Configuration

The pinned server reaches each client through the same workspace launcher:

| Client | File | Key |
| --- | --- | --- |
| Claude Code | `.mcp.json` | `mcpServers.ai-cli` |
| Codex | `.codex/config.toml` | `[mcp_servers.ai-cli]` |
| opencode | `opencode.json` | `mcp.ai-cli` |

All three run `node node_modules/@tjw/side-piece/bin/mcp.mjs`, which resolves `ai-cli-mcp` from the workspace. `tool_timeout_sec` controls the maximum individual MCP call, not server lifetime; the checked-in Codex value is one hour so a long `wait` can remain attached while the server itself stays a normal stdio process.

Details the router needs while diagnosing live runs are in [references/lifecycle.md](references/lifecycle.md); the catalog's interpretation is in [references/model-catalog.md](references/model-catalog.md).
