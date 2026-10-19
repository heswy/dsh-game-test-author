#!/usr/bin/env node
/** CI entry: build, then validate the built single-file package. */
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

const buildStatus = runCli(['build', projectDir]);
if (buildStatus !== 0) process.exit(buildStatus);
process.exit(runCli(['validate', path.join(projectDir, 'dist/index.html'), ...process.argv.slice(2)]));
