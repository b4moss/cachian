import type { CacheEntry } from "./types";
import { DEFAULT_CACHE_TTL_SECONDS } from "./types";

export function isCacheEntry(value: unknown): value is CacheEntry {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return typeof o.expiresAt === "number" && "data" in o;
}

export function resolveTtlMs(ttlSeconds?: number): number {
  const seconds =
    ttlSeconds === undefined ? DEFAULT_CACHE_TTL_SECONDS : ttlSeconds;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new TypeError(
      "ttlSeconds must be a finite number greater than or equal to 0",
    );
  }
  return seconds * 1000;
}

export function isExpired(entry: CacheEntry, now = Date.now()): boolean {
  return now >= entry.expiresAt;
}

export function makeEntry(data: unknown, ttlSeconds?: number): CacheEntry {
  return {
    expiresAt: Date.now() + resolveTtlMs(ttlSeconds),
    data,
  };
}
