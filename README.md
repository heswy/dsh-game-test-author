# Ember Drift

Controlled M4 test-author project for the DSH Game Market community publishing loop.

This is a real, playable single-file game used to verify the public submission -> release -> catalog -> update -> withdraw path. It is not a production catalog submission.

- Game id: `ember-drift`
- Version: `1.0.0`
- License: MIT

Build (the generated project requires `DSH_GAME_CLI`):

```bash
export DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs
npm run build && npm run validate && npm run pack
```
