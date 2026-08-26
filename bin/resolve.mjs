// Resolve a bin entry point from the pinned ai-cli-mcp package.
//
// ai-cli-mcp is a dependency of @tjw.dev/side-piece, which makes it *transitive*
// from the consuming project's point of view. pnpm's isolated linker only
// hoists bins for direct dependencies, so under pnpm there is no
// node_modules/.bin/ai-cli-mcp and no node_modules/ai-cli-mcp -- only
// .pnpm/ai-cli-mcp@<version>/..., a path that hardcodes the version.
//
// @tjw.dev/side-piece *is* a direct dependency, so its bins always land in
// node_modules/.bin under every package manager. We re-expose ai-cli-mcp and
// ai-cli under their own names from here, so every documented command --
// `pnpm exec ai-cli-mcp`, `pnpm exec ai-cli models` -- works unchanged.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGE = 'ai-cli-mcp';
const require = createRequire(import.meta.url);

export function resolveBin(binName) {
  const manifestPath = require.resolve(`${PACKAGE}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!bin) throw new Error(`${PACKAGE}@${manifest.version} declares no "${binName}" binary`);
  return { href: pathToFileURL(resolve(dirname(manifestPath), bin)).href, version: manifest.version };
}

// Neither ai-cli-mcp bin has an entry guard, and both read process.argv.slice(2),
// so importing runs them in this process with our argv. Staying in one process
// keeps stdin/stdout exactly as the client handed them to us, which is what the
// MCP stdio transport requires.
export async function runBin(binName) {
  let target;
  try {
    target = resolveBin(binName);
  } catch (error) {
    // stdout is the MCP transport. Diagnostics go to stderr, always.
    process.stderr.write(
      `side-piece: could not resolve the pinned ${PACKAGE}.\n` +
        `  Reinstall the package:  npm install --save-dev @tjw.dev/side-piece\n` +
        `  Underlying error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
  await import(target.href);
}
