# Repository guidance

`side-piece` is a single npm package that pins [`ai-cli-mcp`](https://github.com/mkXultra/ai-cli-mcp), ships one Agent Skill, and installs both into a project for Claude Code, Codex, and opencode. It has no build step and no runtime dependencies beyond the pinned server.

## Layout

| Path | Owns |
| --- | --- |
| `skill/side-piece/` | the skill as published — the source of truth |
| `bin/side-piece.mjs` | the installer (`install`, `doctor`) |
| `bin/mcp.mjs`, `bin/cli.mjs` | proxies re-exposing `ai-cli-mcp` and `ai-cli` |
| `bin/resolve.mjs` | shared resolution, and the reason the proxies exist |
| `templates/` | reference MCP config for manual setup |
| `docs/` | the GitHub Pages site, served at <https://tjw.dev/side-piece> |
| `.agents/skills/side-piece` | symlink to `skill/side-piece`, so this repo uses its own skill |

`skill/side-piece/` is the only copy. `.agents/skills/side-piece` and `.claude/skills/side-piece` are links to it — never edit through a link, and never let a second copy exist.

## The two facts that constrain every change

**Skill discovery differs per client.** Codex and opencode read `.agents/skills/*/SKILL.md`. Claude Code reads `.claude/skills/*/SKILL.md` and nothing else. That asymmetry is why the installer symlinks rather than copying twice.

**`ai-cli-mcp` is transitive.** It is our dependency, not the consumer's, so pnpm's isolated linker gives it no entry in the project's root `node_modules/.bin`. `@tjw.dev/side-piece` is a direct dependency, so ours always lands there. The proxies in `bin/` exist for exactly that reason and for no other. Do not replace them with a direct `node_modules/.bin/ai-cli-mcp` path — verify with pnpm before assuming a simpler form works.

## Changing the pinned server

The version appears in `package.json` `dependencies` and nowhere else that matters. When bumping it:

1. Read the new `dist/model-catalog.js` and `dist/cli-builder.js` from the published tarball rather than trusting release notes.
2. Update the catalog block, the routing table, and the effort ceilings in `skill/side-piece/SKILL.md` and `references/model-catalog.md` to match what those files actually declare.
3. Update the `metadata.server` field in the skill frontmatter.
4. Re-run the install and doctor checks against a scratch project under every package manager you claim to support.

Model names, effort ceilings, and alias behaviour are facts about a specific published version. Never carry one version's table forward into another without re-reading the source.

## Verifying

There is no test runner yet. Verify by installing the packed tarball into a scratch project and exercising the real paths:

```bash
npm pack --pack-destination /tmp
cd /tmp/scratch && pnpm add -D /tmp/tjw.dev-side-piece-<version>.tgz
pnpm exec side-piece install --client all --dry-run
pnpm exec side-piece install --client all
pnpm exec side-piece doctor
pnpm exec ai-cli models
```

A dry run that prints the right plan is not evidence the write path works, and a successful install is not evidence the MCP transport loads. Check both, and check idempotency by running `install` twice.

## Documentation

`README.md` is the install contract. An agent reads it out of `node_modules` after `npm install` and acts on it — that is the entire mechanism behind the one-line prompt. Keep it accurate, ordered by what the agent needs first, and free of instructions that depend on a human being present.

`docs/index.html` is the public page. It carries the prompt and little else; depth belongs in the README.
