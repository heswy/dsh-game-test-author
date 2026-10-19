#!/usr/bin/env node
/** Build dist/index.html with the local dsh-game CLI. */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['build', projectDir, ...process.argv.slice(2)]));
