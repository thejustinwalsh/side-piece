#!/usr/bin/env node
// Re-exposes the pinned ai-cli CLI facade, used by the documented fallback
// while the MCP transport is unavailable. See bin/resolve.mjs for why.
import { runBin } from './resolve.mjs';
await runBin('ai-cli');
