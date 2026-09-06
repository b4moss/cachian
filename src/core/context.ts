import { isExpired, makeEntry, resolveTtlMs } from "../entry";
import type { StorageAdapter } from "../drivers/types";
import type { CacheEntry, CacheSetOptions } from "../types";
import type { CacheContext } from "./types";

export type CreateContextOptions = {
  driver: StorageAdapter;
  enabled?: boolean;
  ttlSeconds?: number;
  keyPrefix?: string;
};

export function createCacheContext(
  options: CreateContextOptions,
): CacheContext {
  // Validate instance TTL up front (even if later overridden per set).
  resolveTtlMs(options.ttlSeconds);

  const enabled = options.enabled !== false;
  const keyPrefix = options.keyPrefix ?? "";
  const defaultTtlSeconds = options.ttlSeconds;
  const driver = options.driver;

  const physical = (key: string) => `${keyPrefix}${key}`;

  async function readValid(key: string): Promise<unknown | null> {
    if (!enabled) return null;
    const entry = await driver.get(physical(key));
    if (entry == null) return null;
    if (isExpired(entry)) {
      await driver.remove(physical(key));
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
    await driver.set(physical(key), entry);
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
    await driver.set(physical(key), next);
  }

  return {
    enabled,
    keyPrefix,
    driver,
    physical,
    readValid,
    writeSet,
    writeUpdate,
  };
}
