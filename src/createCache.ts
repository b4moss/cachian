import {
  isExpired,
  makeEntry,
  parseAbsoluteTime,
  resolveOlderThanMs,
  resolveTtlMs,
} from "./entry";
import { createIndexedDBAdapter } from "./storage/indexedDB";
import { createLocalStorageAdapter } from "./storage/localStorage";
import type { StorageAdapter } from "./storage/types";
import type {
  AbsoluteTime,
  Cache,
  CacheEntry,
  CachePurgeOlderThan,
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

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function createCache(options: CreateCacheOptions = {}): Cache {
  // Validate instance TTL up front (even if later overridden per set).
  resolveTtlMs(options.ttlSeconds);

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

  async function writeSet(
    key: string,
    data: unknown,
    setOptions?: CacheSetOptions,
  ): Promise<void> {
    const ttlSeconds =
      setOptions?.ttlSeconds === undefined
        ? defaultTtlSeconds
        : setOptions.ttlSeconds;
    const entry = makeEntry(data, ttlSeconds);
    await adapter.set(physical(key), entry);
  }

  async function writeUpdate(
    key: string,
    data: unknown,
    existing: CacheEntry,
    setOptions?: CacheSetOptions,
  ): Promise<void> {
    const next: CacheEntry = {
      data,
      expiresAt:
        setOptions?.ttlSeconds === undefined
          ? existing.expiresAt
          : Date.now() + resolveTtlMs(setOptions.ttlSeconds),
    };
    if (existing.createdAt !== undefined) {
      next.createdAt = existing.createdAt;
    }
    await adapter.set(physical(key), next);
  }

  return {
    async get(key) {
      return readValid(key);
    },

    async set(key, data, setOptions?: CacheSetOptions) {
      if (!enabled) return;
      await writeSet(key, data, setOptions);
    },

    async update(key, data, setOptions?: CacheSetOptions) {
      if (!enabled) return;
      // Validate TTL before touching storage when provided.
      if (setOptions?.ttlSeconds !== undefined) {
        resolveTtlMs(setOptions.ttlSeconds);
      }
      const entry = await adapter.get(physical(key));
      if (entry == null) return;
      if (isExpired(entry)) {
        await adapter.remove(physical(key));
        return;
      }
      await writeUpdate(key, data, entry, setOptions);
    },

    async upsert(key, data, setOptions?: CacheSetOptions) {
      if (!enabled) return;
      if (setOptions?.ttlSeconds !== undefined) {
        resolveTtlMs(setOptions.ttlSeconds);
      }
      const entry = await adapter.get(physical(key));
      if (entry == null) {
        await writeSet(key, data, setOptions);
        return;
      }
      if (isExpired(entry)) {
        await adapter.remove(physical(key));
        await writeSet(key, data, setOptions);
        return;
      }
      await writeUpdate(key, data, entry, setOptions);
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

      const hasOlderThan = hasOwn(purgeOptions, "olderThan");
      const hasCreatedBefore = hasOwn(purgeOptions, "createdBefore");
      const hasCreatedAfter = hasOwn(purgeOptions, "createdAfter");

      if (hasOlderThan && (hasCreatedBefore || hasCreatedAfter)) {
        throw new TypeError(
          "purge cannot mix olderThan with createdBefore/createdAfter",
        );
      }

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

      if (hasOlderThan) {
        const olderThan = (purgeOptions as { olderThan: CachePurgeOlderThan })
          .olderThan;
        const durationMs = resolveOlderThanMs(olderThan);
        const threshold = Date.now() - durationMs;
        const listed = await adapter.list(keyPrefix);
        for (const { physicalKey, entry } of listed) {
          if (entry.createdAt != null && entry.createdAt <= threshold) {
            await adapter.remove(physicalKey);
          }
        }
        return;
      }

      if (hasCreatedBefore || hasCreatedAfter) {
        const opts = purgeOptions as {
          createdBefore?: AbsoluteTime;
          createdAfter?: AbsoluteTime;
        };
        const beforeMs =
          opts.createdBefore !== undefined
            ? parseAbsoluteTime(opts.createdBefore, "createdBefore")
            : undefined;
        const afterMs =
          opts.createdAfter !== undefined
            ? parseAbsoluteTime(opts.createdAfter, "createdAfter")
            : undefined;

        const listed = await adapter.list(keyPrefix);
        for (const { physicalKey, entry } of listed) {
          if (entry.createdAt == null) continue;
          if (beforeMs !== undefined && !(entry.createdAt < beforeMs)) continue;
          if (afterMs !== undefined && !(entry.createdAt > afterMs)) continue;
          await adapter.remove(physicalKey);
        }
      }
    },
  };
}
