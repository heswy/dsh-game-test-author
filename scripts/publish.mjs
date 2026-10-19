#!/usr/bin/env node
/** Emit registry-entry.json / upload-plan.md / review-checklist.md (offline). */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['publish', projectDir, ...process.argv.slice(2)]));
