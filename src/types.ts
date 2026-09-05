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

export type Cache = {
  get(key: string): Promise<unknown | null>;
  set(key: string, data: unknown, options?: CacheSetOptions): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
};

export type CacheEntry = {
  expiresAt: number;
  data: unknown;
};
