/**
 * Bridge between this project and the zero-dependency `dsh-game` CLI.
 *
 * The CLI path is recorded in `dsh-game.config.json` by `create-dsh-game`.
 * Override it with the `DSH_GAME_CLI` environment variable when the project is
 * moved to another machine, or when using a newer checkout.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectDir = path.resolve(here, '..');

function readConfig() {
  const configPath = path.join(projectDir, 'dsh-game.config.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error(`[dsh-game] invalid dsh-game.config.json: ${error.message}`);
    return {};
  }
}

export function resolveCli() {
  const config = readConfig();
  const candidates = [];
  if (process.env.DSH_GAME_CLI) candidates.push(path.resolve(process.env.DSH_GAME_CLI));
  if (typeof config.cli === 'string' && config.cli.length > 0) {
    candidates.push(path.resolve(projectDir, config.cli));
  }
  // Repository template fallback: templates/<name> -> <repo>/scripts/cli/dsh-game.mjs
  candidates.push(path.resolve(projectDir, '../../scripts/cli/dsh-game.mjs'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  console.error('[dsh-game] cannot find the dsh-game CLI.');
  console.error('  Set DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs or');
  console.error('  regenerate the project with `create-dsh-game`.');
  process.exit(2);
}

export function runCli(args) {
  const cli = resolveCli();
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`[dsh-game] failed to start CLI: ${result.error.message}`);
    return 3;
  }
  return result.status === null ? 3 : result.status;
}
