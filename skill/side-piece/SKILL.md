---
name: side-piece
description: Route resumable external-model work through the pinned side-piece MCP server. Use for adversarial reviews, implementation reviews, research, and one-off delegated tasks when the user names Claude, Opus, Fable, Sonnet, Haiku, Codex, GPT-5, Sol, Terra, Luna, Spark, Gemini, Forge, OpenCode, or asks for an external model, a second opinion, or a review by another agent.
license: MIT
metadata:
  package: "@tjw.dev/side-piece"
  homepage: https://tjw.dev/side-piece
---

# side-piece

Route external-model work through the project's `side-piece` MCP server. Do not launch provider CLIs directly when the server can do the job: it owns background process tracking, session IDs, result retrieval, and provider-specific argument validation.

Every run is resumable. Start it with `run`, retain the returned PID, use `peek` only for a bounded progress sample, use `wait` or `get_result` for the authoritative outcome, and resume with the returned `session_id` when a provider fails or the user asks for another pass. A one-off task is still started in the background; `wait` immediately afterward is the blocking recipe.

**Resume a thread. Start a new session for new work.** Resume to keep the model's own reasoning in play: a live session still holds which files it opened and what it weighed and rejected, none of which survives a summary. This matters most adversarially — reopening with a summary supplies your framing of its position, so it agrees with your précis instead of defending what it actually argued. A resumed session has to argue with itself.

Cost follows, but narrowly: a prompt follow-up rides the provider's cached context and is billed as a follow-up rather than a second full review. That is a tiebreaker, not the reason.

Resume when the prompt continues the same thread against the same target commit and worktree — challenging, correcting, or extending what that session already said. *Push back on point three.* *You missed the error path.* *Go deeper on the cache logic.*

Start fresh when the target commit or worktree changed, when it is a different kind of task, or when the prior history has nothing to do with the new question. Do not reuse a review session for an implementation, and do not ask a stale session about a different checkout.

Resume promptly. Provider prompt caches expire after inactivity — minutes by default, not hours — and the router cannot see cache state. A session picked up while warm rides that cache. A session picked up cold re-sends its entire accumulated transcript at full price, which for a long thread costs *more* than a fresh session with a tight prompt. The longer the history, the worse a cold resume gets.

So for a session that has been idle a while, weigh its size. Short history: resume. Long and cold: start fresh and carry forward a distilled summary of what actually matters — the conclusion, the file references, the open question — instead of dragging the whole transcript back through at full rate.

When it is genuinely unclear, ask. A wrongly resumed session is worse than a fresh one: it answers from stale context and charges for carrying it.

Use the `side-piece` command for everything documented here. It is the stable surface; the server underneath it is an implementation detail that can be replaced.

## Setup and health check

Before using a new checkout or machine:

1. Run `npx side-piece doctor`. It verifies skill placement, every client's MCP entry, and the resolved server version. Every line must read `ok`.
2. Run `npx side-piece models` and retain the structured output as the model-routing fact for this run.
3. Run `npx side-piece providers` for binary availability. It does not prove login, terms acceptance, quota, or provider health, so check those with the provider's own status command when a run needs them.
4. Reload or restart the MCP client after any configuration change. MCP servers are read at startup, so a correct install does nothing until the client restarts. Confirm the `side-piece` MCP tools (`models`, `run`, `wait`, `get_result`) are present in the active tool registry.
5. Perform a small background smoke run through those MCP tools in an isolated temporary worktree, wait for it, and verify a non-empty result including a session ID. Resume that session with a second tiny prompt before declaring the router healthy.

`npx side-piece run` is useful for diagnosing the pinned package and provider authentication, but it is only the CLI façade and does not validate the MCP transport. If the server is not visible to the host client, inspect Codex with `codex mcp get side-piece` and Claude with `claude mcp get side-piece`, then reload. A missing server is a setup failure; do not report the CLI façade as an MCP smoke test or fall back silently to direct provider CLIs.

Each provider CLI must be installed and signed in on the host before the router can reach it. Claude additionally requires one manual `claude --dangerously-skip-permissions` run to accept terms.

### CLI fallback while MCP is unavailable

Use the façade temporarily when the host client has not reloaded the server:

```bash
npx side-piece models
npx side-piece run --cwd /absolute/worktree --model <validated-model> --prompt-file /absolute/prompt.md
npx side-piece wait <pid> --timeout 300 --verbose
npx side-piece result <pid> --verbose
```

This shares the same server-side process state, so runs stay resumable. Capture the PID, provider/model, absolute worktree, target commit, and returned `session_id`; resume with `run --session-id <session_id>`. Label the run `transport: cli-fallback` and keep trying to restore MCP visibility. Never replace this with a globally installed provider CLI, and never claim MCP is healthy because the fallback succeeded.

## Route from facts, not guesses

An explicit user model choice always wins over a task-based preference. The router may recommend a model when the user leaves it open, but it must not substitute a preferred model after the user names one. It still validates the requested name against the live catalog and reports an unavailable or malformed route instead of silently changing providers.

**Always call `models` before selecting.** Provider catalogs change between releases, and preview and free tiers rotate quickly. Any model name written down in this file is an example, not a guarantee — a name that worked last month may be gone. Treat the live response as the only catalog.

The response groups models by agent (`claude`, `codex`, `gemini`, `forge`, `opencode`), lists `aliases` that resolve to a model *and* an effort, and describes `dynamicModelBackends` for providers whose catalogs are discovered at runtime.

Routing is by prefix: `gpt-` goes to Codex, `gemini` to Gemini, `forge` to Forge, `opencode` and `oc-` to OpenCode, and **everything else falls through to Claude**. That fall-through is why an unvalidated typo silently becomes a Claude request.

### Users speak in shorthand; resolve it against the catalog

People say `opus`, `sol`, `mimo`. Those are not always the values the server accepts. Resolving them is this skill's job, and it is a lookup against the live catalog, never a guess:

1. Call `models`. For an OpenCode route, also run `opencode models` — that catalog is dynamic and the `models` response only reports the rule for it.
2. Case-insensitively match the user's word against every candidate name.
3. **Exactly one match** — route to it.
   **More than one** — ask which; never pick the first.
   **None** — say so and show the near misses. Do not fall through to a default.

The fall-through rule makes step 3 non-negotiable: an unrecognized name is not rejected by the server, it is sent to **Claude**. A typo becomes a silent Claude request.

| User says | Resolves to | Rule |
| --- | --- | --- |
| `opus`, `sonnet`, `haiku` | itself | Already a catalog name. `reasoning_effort: high`. |
| `sonnet 1m`, `long context` | `sonnet[1m]` | Claude. The brackets are part of the name. |
| `spark` | `gpt-5.3-codex-spark` | Codex. Fast tier; do not confuse with `gpt-5.3-codex`. |
| `opusplan`, `plan with opus` | `opusplan` | Claude. Opus plans, a cheaper model executes. |
| `fable` | `fable` | Explicit request only, never auto-selected. May require usage credits. |
| `sol`, `terra`, `luna` | the `gpt-5.6-*` entry containing that word | Codex. `terra` has two `r`s; accept `tera` as a typo for it. |
| `mimo`, `nemotron`, `pickle`, … | the unique `opencode/*` match, prefixed `oc-` | See below. Omit `reasoning_effort`. |
| `ultra`, `max effort`, `hardest` | the matching `*-ultra` alias | The alias sets its own effort; do not also pass `reasoning_effort`. **Confirm before running — see Effort.** |
| `claude:<model>`, `codex:<model>` | the suffix | Validate the suffix against the catalog. |

Naming a model always beats the router's own preference. Report an unavailable route rather than substituting one.

### OpenCode models are discovered, not listed

OpenCode's catalog is dynamic and its free and preview slots rotate. `models` reports only the configured default, `opencode`, plus the rule for explicit names. Discover the rest:

```bash
opencode models          # the authoritative list
```

Then translate the provider-native identifier by prefixing `oc-`: a user asking for `mimo` resolves against that list to `opencode/mimo-v2.5-free`, which is passed as `oc-opencode/mimo-v2.5-free`. The prefix is required and the pattern is exact — a malformed value is rejected rather than coerced. Never route to an OpenCode model you have not just seen in that list, and never carry one of these names forward from a previous session.

### Effort

Default every Claude and Codex route to `reasoning_effort: high`. That is the highest tier the router selects on its own, for any model, on any task.

#### Above `high`, stop and confirm

**Never start a run above `high` without a second, explicit confirmation from the user.** This covers `xhigh`, `max`, `ultra`, and every `*-ultra` alias — the aliases set `max` or `ultra` themselves, so choosing one crosses this line even though no effort field was written.

Before such a run, state the model, the exact tier, and why it is warranted. Then wait for a direct answer. Treat the following as **not** confirmation:

- the user naming an expensive or flagship model;
- the task being hard, large, security-sensitive, or important;
- encouragement like *be thorough*, *do your best*, *take your time*, *really dig in*;
- an approval given earlier in the session for a different run;
- your own judgement that the result would be better.

A request phrased as *"use ultra"* is the **first** signal, not the confirmation. Read it back — *"that is Opus at max effort, which costs materially more than high; confirm?"* — and wait. One confirmation authorises one run. A resumed session at the same tier is a new run and needs its own.

If the user declines or does not answer, run at `high` and say that is what you did.

#### Accepted values

Tiers are provider- and model-specific, and the server rejects anything outside them:

| Provider | Accepted `reasoning_effort` |
| --- | --- |
| Claude | `low`, `medium`, `high`, `xhigh`, `max` |
| Codex, all models | `low`, `medium`, `high`, `xhigh` |
| Codex `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | additionally `max` |
| Codex `gpt-5.6-sol`, `gpt-5.6-terra` | additionally `ultra` |
| Gemini, Forge, OpenCode | omit the field |

Never substitute or silently retry at a different tier when a requested one is rejected; report the rejection and the accepted set. Lowering effort below `high` needs no confirmation, but say that you did it.

## Review recipe

For an adversarial review:

1. Resolve the model with `models` and choose the requested provider explicitly.
2. Use an absolute isolated worktree as `workFolder`; include the target commit, review scope, acceptance criteria, and the instruction to report evidence with file and line references.
3. Call `run` with the review prompt. Do not give a review agent a mutation mandate. The wrapper bypasses provider permission prompts, so isolation and a clean worktree are the safety boundary.
4. Record PID, session ID, provider, model, worktree, target commit, status, and the **timestamp of the last turn** in the ignored `.cache/side-piece/` run manifest. That timestamp is the only way to judge later whether resuming a session is still cheap.
5. Use `peek` for a short progress sample only. Use `wait` or `get_result` to collect the complete result.
6. On a transient provider failure, call `run` again with the same `session_id` and worktree. Do not start a fresh session unless the original is unrecoverable.
7. After integration changes, run a new review against the new commit; do not ask a stale session to review a different checkout without stating the new target.

For parallel reviews, start all runs first, then wait on their PIDs together. Keep each worktree and manifest distinct. A successful process exit is not proof of a useful review; require a structured report and inspect the cited source.

## Implementation recipe

Use the same lifecycle for delegated implementation, but make the prompt explicitly mutation-authorized and name the exact branch and worktree. Require the agent to preserve repository instructions, run the narrow gate, and commit only its coherent slice. Review and integrate the result locally before running external review or broader checks.

## Configuration

| Client | File | Key |
| --- | --- | --- |
| Claude Code | `.mcp.json` | `mcpServers.side-piece` |
| Codex | `.codex/config.toml` | `[mcp_servers.side-piece]` |
| opencode | `opencode.json` | `mcp.side-piece` |

All three run `side-piece-mcp` through the project's package manager. `tool_timeout_sec` controls the maximum individual MCP call, not server lifetime; the checked-in Codex value is one hour so a long `wait` can stay attached while the server remains a normal stdio process.

Run lifecycle details are in [references/lifecycle.md](references/lifecycle.md); how to read the catalog response is in [references/model-catalog.md](references/model-catalog.md).
