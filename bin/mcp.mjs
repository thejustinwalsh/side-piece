#!/usr/bin/env node
// Re-exposes the pinned ai-cli-mcp server. See bin/resolve.mjs for why.
import { runBin } from './resolve.mjs';
await runBin('ai-cli-mcp');
