import { assertStorageAvailable } from "./environment";
import { isExpired, makeEntry, resolveOlderThanMs, resolveTtlMs } from "./entry";
import { createIndexedDBAdapter } from "./storage/indexedDB";
import { createLocalStorageAdapter } from "./storage/localStorage";
import type { StorageAdapter } from "./storage/types";
import type {
  Cache,
  CachePurgeOptions,
  CacheSetOptions,
  CreateCacheOptions,
} from "./types";

function resolveAdapter(options: CreateCacheOptions): StorageAdapter {
  if (options.storage === "indexedDB") {
    return createIndexedDBAdapter({
      dbName: options.dbName ?? "cachian",
      storeName: options.storeName ?? "entries",
    });
  }
  return createLocalStorageAdapter();
}

export function createCache(options: CreateCacheOptions = {}): Cache {
  // Validate instance TTL up front (even if later overridden per set).
  resolveTtlMs(options.ttlSeconds);
  assertStorageAvailable(options.storage ?? "localStorage");

  const enabled = options.enabled !== false;
  const keyPrefix = options.keyPrefix ?? "";
  const defaultTtlSeconds = options.ttlSeconds;
  const adapter = resolveAdapter(options);

  const physical = (key: string) => `${keyPrefix}${key}`;

  async function readValid(key: string): Promise<unknown | null> {
    if (!enabled) return null;
    const entry = await adapter.get(physical(key));
    if (entry == null) return null;
    if (isExpired(entry)) {
      await adapter.remove(physical(key));
      return null;
    }
    return entry.data;
  }

  return {
    async get(key) {
      return readValid(key);
    },

    async set(key, data, setOptions?: CacheSetOptions) {
      if (!enabled) return;
      const ttlSeconds =
        setOptions?.ttlSeconds === undefined
          ? defaultTtlSeconds
          : setOptions.ttlSeconds;
      const entry = makeEntry(data, ttlSeconds);
      await adapter.set(physical(key), entry);
    },

    async remove(key) {
      if (!enabled) return;
      await adapter.remove(physical(key));
    },

    async has(key) {
      return (await readValid(key)) !== null;
    },

    async clear() {
      if (!enabled) return;
      await adapter.clear(keyPrefix);
    },

    async purge(purgeOptions: CachePurgeOptions) {
      if (!enabled) return;

      if ("all" in purgeOptions && purgeOptions.all === true) {
        await adapter.clear(keyPrefix);
        return;
      }

      if ("keys" in purgeOptions) {
        for (const key of purgeOptions.keys) {
          await adapter.remove(physical(key));
        }
        return;
      }

      if ("olderThan" in purgeOptions) {
        const durationMs = resolveOlderThanMs(purgeOptions.olderThan);
        const threshold = Date.now() - durationMs;
        const listed = await adapter.list(keyPrefix);
        for (const { physicalKey, entry } of listed) {
          if (entry.createdAt != null && entry.createdAt <= threshold) {
            await adapter.remove(physicalKey);
          }
        }
      }
    },
  };
}
