/** Default cache TTL: 1 year (in seconds). */
export const DEFAULT_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;

/** @deprecated Prefer DEFAULT_CACHE_TTL_SECONDS. Kept for existing imports. */
export const CACHE_TTL_MS = DEFAULT_CACHE_TTL_SECONDS * 1000;

/** @internal Used by environment checks and driver factories. */
export type StorageBackend = "localStorage" | "indexedDB";

export type CacheSetOptions = {
  /** Override instance TTL for this write (seconds). */
  ttlSeconds?: number;
};

export type CachePurgeOlderThan = {
  years?: number;
  months?: number;
  hours?: number;
  mins?: number;
  seconds?: number;
};

/** Absolute time for purge thresholds: ISO 8601 string or epoch seconds/ms number. */
export type AbsoluteTime = string | number;

export type CachePurgeOptions =
  | { all: true }
  | { keys: string[] }
  | { olderThan: CachePurgeOlderThan }
  | { createdBefore: AbsoluteTime; createdAfter?: AbsoluteTime }
  | { createdAfter: AbsoluteTime; createdBefore?: AbsoluteTime }
  | { expired: true };

export type CacheEntry = {
  expiresAt: number;
  data: unknown;
  /** Write time (epoch ms). Always set on new `set`. Optional for legacy entries. */
  createdAt?: number;
};
