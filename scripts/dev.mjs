#!/usr/bin/env node
/** Start the Local Runtime Simulator (fake bridge, no DSH Agent needed). */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['dev', projectDir, ...process.argv.slice(2)]));
