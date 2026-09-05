/** Default cache TTL: 1 year (in seconds). */
export const DEFAULT_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;

/** @deprecated Prefer DEFAULT_CACHE_TTL_SECONDS. Kept for existing imports. */
export const CACHE_TTL_MS = DEFAULT_CACHE_TTL_SECONDS * 1000;

export type StorageBackend = "localStorage" | "indexedDB";

export type CreateCacheOptions = {
  /** Backend storage. Default: `"localStorage"`. */
  storage?: StorageBackend;
  /** When false, all operations are miss / no-op. Default: `true`. */
  enabled?: boolean;
  /** Default TTL in seconds for `set`. Default: `DEFAULT_CACHE_TTL_SECONDS`. */
  ttlSeconds?: number;
  /** Prefix prepended to logical keys for physical storage keys. */
  keyPrefix?: string;
  /** IndexedDB database name. Default: `"cachian"`. */
  dbName?: string;
  /** IndexedDB object store name. Default: `"entries"`. */
  storeName?: string;
};

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
  | { createdAfter: AbsoluteTime; createdBefore?: AbsoluteTime };

export type Cache = {
  get(key: string): Promise<unknown | null>;
  set(key: string, data: unknown, options?: CacheSetOptions): Promise<void>;
  update(key: string, data: unknown, options?: CacheSetOptions): Promise<void>;
  upsert(key: string, data: unknown, options?: CacheSetOptions): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  purge(options: CachePurgeOptions): Promise<void>;
};

export type CacheEntry = {
  expiresAt: number;
  data: unknown;
  /** Write time (epoch ms). Always set on new `set`. Optional for legacy entries. */
  createdAt?: number;
};
