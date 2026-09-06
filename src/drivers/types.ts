import type { CacheEntry } from "../types";

/** Thin async key-value storage used by createCache. */
export type StorageAdapter = {
  get(physicalKey: string): Promise<CacheEntry | null>;
  set(physicalKey: string, entry: CacheEntry): Promise<void>;
  remove(physicalKey: string): Promise<void>;
  /** localStorage: delete keys with prefix. indexedDB: clear whole store. */
  clear(keyPrefix: string): Promise<void>;
  /** List valid entries whose physical keys start with keyPrefix. */
  list(
    keyPrefix: string,
  ): Promise<Array<{ physicalKey: string; entry: CacheEntry }>>;
};
