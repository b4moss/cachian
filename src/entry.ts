import type { AbsoluteTime, CacheEntry, CachePurgeOlderThan } from "./types";
import { DEFAULT_CACHE_TTL_SECONDS } from "./types";

const MS_PER_SECOND = 1000;
const MS_PER_MIN = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

/** Epoch values with abs < 1e12 are treated as seconds; otherwise milliseconds. */
const EPOCH_SECONDS_ABS_MAX = 1e12;

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
  const now = Date.now();
  return {
    expiresAt: now + resolveTtlMs(ttlSeconds),
    data,
    createdAt: now,
  };
}

/**
 * Parse AbsoluteTime to epoch milliseconds.
 * - string: ISO 8601 (including fractional seconds)
 * - number: epoch seconds if |value| < 1e12, otherwise epoch milliseconds
 */
export function parseAbsoluteTime(value: AbsoluteTime, field: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `${field} AbsoluteTime must be a finite number or ISO 8601 string`,
      );
    }
    return Math.abs(value) < EPOCH_SECONDS_ABS_MAX ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      throw new TypeError(
        `${field} AbsoluteTime must be a valid ISO 8601 string`,
      );
    }
    return ms;
  }

  throw new TypeError(`${field} AbsoluteTime must be a string or number`);
}

function assertNonNegativeFinite(
  value: number | undefined,
  field: string,
): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(
      `olderThan.${field} must be a finite number greater than or equal to 0`,
    );
  }
  return value;
}

/** Fixed conversion of olderThan units to milliseconds (year=365d, month=30d). */
export function resolveOlderThanMs(olderThan: CachePurgeOlderThan): number {
  const years = assertNonNegativeFinite(olderThan.years, "years");
  const months = assertNonNegativeFinite(olderThan.months, "months");
  const hours = assertNonNegativeFinite(olderThan.hours, "hours");
  const mins = assertNonNegativeFinite(olderThan.mins, "mins");
  const seconds = assertNonNegativeFinite(olderThan.seconds, "seconds");

  if (
    olderThan.years === undefined &&
    olderThan.months === undefined &&
    olderThan.hours === undefined &&
    olderThan.mins === undefined &&
    olderThan.seconds === undefined
  ) {
    throw new TypeError(
      "olderThan requires at least one of years, months, hours, mins, seconds",
    );
  }

  return (
    years * MS_PER_YEAR +
    months * MS_PER_MONTH +
    hours * MS_PER_HOUR +
    mins * MS_PER_MIN +
    seconds * MS_PER_SECOND
  );
}
