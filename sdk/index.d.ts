/**
 * `@dsh-game/sdk` v1 public TypeScript surface.
 *
 * Mirrors PRD v2.2 §8.3 ("公开 TypeScript 声明") and docs/V1-CONTRACTS §8.
 * This file describes the frozen public API only; bridge envelopes and other
 * internals are intentionally not exported.
 *
 * The SDK is zero-dependency and is inlined into a single-file game at build
 * time. Games normally use the global created by the official templates:
 *
 *   const game = DSH_GAME_SDK.createGameSDK();
 *   await game.ready();
 *
 * or the package singleton:
 *
 *   import { game } from '@dsh-game/sdk';
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Capabilities granted to a game by its manifest (V1, D-011). */
export type Capability = 'storage' | 'score';

/**
 * Error codes a game can receive from the Game Runtime. `GM-*` is the only
 * code shape that crosses the bridge (D-030); internal `E_*` names never do.
 */
export type GameErrorCode =
  | 'GM-4002'
  | 'GM-4004'
  | 'GM-4006'
  | 'GM-4031'
  | 'GM-4032'
  | 'GM-4033'
  | 'GM-4092'
  | 'GM-4093'
  | 'GM-4098'
  | 'GM-4099'
  | 'GM-4131'
  | 'GM-4132'
  | 'GM-4133'
  | 'GM-4134'
  | 'GM-4260'
  | 'GM-4261'
  | 'GM-4290'
  | 'GM-4291'
  | 'GM-5001'
  | 'GM-5002'
  | 'GM-5003'
  | 'GM-5004'
  | 'GM-5005'
  | 'GM-5011'
  | 'GM-5012'
  | 'GM-5021'
  | 'GM-5022'
  | 'GM-5031';

export interface GameErrorOptions {
  retryable?: boolean;
  details?: JsonObject;
}

/** Public error type; every rejected SDK promise rejects with this shape. */
export declare class GameError extends Error {
  readonly code: GameErrorCode;
  readonly retryable: boolean;
  readonly details?: JsonObject;
  constructor(code: GameErrorCode, message?: string, options?: GameErrorOptions);
}

export declare function isGameError(error: unknown): error is GameError;

export type GameLifecycleEvent = 'pause' | 'resume' | 'hidden' | 'visible' | 'before-save';
export type PauseReason = 'user' | 'hidden' | 'leave' | 'waiting-user';
export type SaveReason = 'interval' | 'pause' | 'hidden' | 'leave' | 'agent-complete';

/**
 * Payload passed to `lifecycle.on` handlers. `event` is included by SDK v1 so
 * one handler can be registered for several events (PRD §8.3); the Runtime
 * payload fields (`reason`, `at`, `deadlineMs`) are preserved.
 */
export type LifecyclePayload =
  | { event: 'pause'; reason: PauseReason; at: number }
  | { event: 'resume'; reason: 'user' | 'visible'; at: number }
  | { event: 'hidden'; at: number }
  | { event: 'visible'; at: number }
  | { event: 'before-save'; reason: SaveReason; deadlineMs: number };

export interface StorageSaveResult {
  key: string;
  bytes: number;
  revision: number;
  updatedAt: string | null;
}

export interface StorageLoadResult<T extends JsonValue = JsonValue> {
  key: string;
  data: T;
  revision: number;
  updatedAt: string | null;
}

export interface StorageRemoveResult {
  key: string;
  removed: boolean;
  revision: number;
}

export interface SessionStartResult {
  playSessionId: string | null;
  startedAt: string | null;
  adopted: boolean;
}

export type SessionOutcome = 'completed' | 'lost' | 'abandoned' | 'quit';

export interface SessionEndResult {
  playSessionId: string;
  startedAt: string;
  endedAt: string;
  outcome: SessionOutcome;
  score: number | null;
  ignored: boolean;
}

export interface ScoreSubmitResult {
  best: number | null;
  isBest: boolean;
  submittedAt: string | null;
}

export interface BestScore {
  score: number;
  achievedAt: string | null;
  meta: JsonObject | null;
}

export type GameAgentPhase = 'idle' | 'running' | 'waiting-user' | 'completed' | 'error';
export type GameAgentSource = 'turn' | 'tool' | 'approval' | 'question' | 'lifecycle' | 'restore';

export interface GameAgentState {
  state: GameAgentPhase;
  /** Localized display text. Games must not parse it (PRD §8.3). */
  label: string;
  /** Stable key for the same text (V1); localize in your own i18n if needed. */
  labelKey: string | null;
  sessionId: string | null;
  updatedAt: string;
  source: GameAgentSource;
  seq: number;
  since: string;
  turnId: string | null;
  /** Host process epoch (`he_*`); changes when DSH restarts. */
  hostEpoch?: string;
}

export interface GameRuntimeInfo {
  readonly sdkVersion: string;
  readonly protocolVersion: 1;
  /** `null` before `ready()` resolves. */
  readonly runtimeVersion: string | null;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly locale: string;
  readonly theme: 'light' | 'dark';
  readonly reducedMotion: boolean;
  readonly capabilities: readonly Capability[];
  /** How the platform launched this run (resume-paused = platform modal is the only confirmation). */
  readonly launchMode: 'start' | 'resume-paused';
  readonly viewport: Readonly<{ width: number; height: number; dpr: number }>;
  readonly ready: boolean;
}

export interface Game {
  /** Stable read-only live view; properties reflect the latest Runtime state. */
  readonly runtime: GameRuntimeInfo;

  ready(timeoutMs?: number): Promise<GameRuntimeInfo>;

  readonly storage: {
    save<T extends JsonValue>(key: string, data: T): Promise<StorageSaveResult>;
    load<T extends JsonValue = JsonValue>(key: string): Promise<StorageLoadResult<T> | null>;
    remove(key: string): Promise<StorageRemoveResult>;
  };

  readonly session: {
    start(): Promise<SessionStartResult>;
    end(options?: { outcome?: SessionOutcome; score?: number | null }): Promise<SessionEndResult | null>;
  };

  readonly score: {
    submit(score: number, meta?: JsonObject): Promise<ScoreSubmitResult>;
    getBest(): Promise<BestScore | null>;
  };

  readonly lifecycle: {
    on(
      event: GameLifecycleEvent,
      handler: (payload: LifecyclePayload) => void | Promise<void>
    ): () => void;
  };

  readonly agent: {
    getStatus(): Promise<GameAgentState>;
    on(event: 'status', handler: (state: GameAgentState) => void): () => void;
  };

  // ---- V0 compatibility surface (must not be removed, V1-07) ----
  onError(handler: (error: GameError) => void): () => void;
  isGameError(error: unknown): error is GameError;
}

/**
 * Advanced/testing hook used by the repository test harness and by tooling that
 * injects a fake Runtime. Games should call `createGameSDK()` with no options.
 */
export interface CreateGameSDKOptions {
  window?: unknown;
  parent?: unknown;
  location?: unknown;
  timers?: { setTimeout: Function; clearTimeout: Function };
  now?: () => number;
  crypto?: unknown;
}

export declare function createGameSDK(options?: CreateGameSDKOptions): Game;

/** Lazy package singleton; starting the handshake is deferred to first use. */
export declare const game: Game;
