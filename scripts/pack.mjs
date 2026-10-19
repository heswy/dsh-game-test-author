#!/usr/bin/env node
/** Pack dist/index.html into dist/<id>-<version>.html + .sha256. */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['pack', projectDir, ...process.argv.slice(2)]));
