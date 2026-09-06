/**
 * CDN / IIFE entry: re-exports core plus every driver and method so
 * `Cachian.createCache` can be composed without additional imports.
 */
export {
  CACHE_TTL_MS,
  createCache,
  CachianEnvironmentError,
  DEFAULT_CACHE_TTL_SECONDS,
} from "./index";
export type {
  AbsoluteTime,
  CacheContext,
  CacheEntry,
  CacheFromMethods,
  CachePurgeOlderThan,
  CachePurgeOptions,
  CacheSetOptions,
  CreateCacheOptions,
  MethodDef,
} from "./index";
export { localStorageDriver } from "./drivers/localStorage";
export { indexedDBDriver } from "./drivers/indexedDB";
export type { StorageAdapter } from "./drivers/types";
export type { IndexedDBDriverOptions } from "./drivers/indexedDB";
export { get } from "./methods/get";
export { set } from "./methods/set";
export { update } from "./methods/update";
export { upsert } from "./methods/upsert";
export { remove } from "./methods/remove";
export { has } from "./methods/has";
export { clear } from "./methods/clear";
export { purge } from "./methods/purge";

import { createCache } from "./core/createCache";
import { indexedDBDriver } from "./drivers/indexedDB";
import { localStorageDriver } from "./drivers/localStorage";
import { clear } from "./methods/clear";
import { get } from "./methods/get";
import { has } from "./methods/has";
import { purge } from "./methods/purge";
import { remove } from "./methods/remove";
import { set } from "./methods/set";
import { update } from "./methods/update";
import { upsert } from "./methods/upsert";
import type { CreateCacheOptions } from "./core/types";
import type { MethodDef } from "./core/types";

const ALL_METHODS = [
  get,
  set,
  update,
  upsert,
  remove,
  has,
  clear,
  purge,
] as const satisfies readonly MethodDef[];

export type CreateFullCacheOptions = Omit<
  CreateCacheOptions<typeof ALL_METHODS>,
  "driver" | "methods"
> & {
  storage?: "localStorage" | "indexedDB";
  dbName?: string;
  storeName?: string;
};

/** Convenience for CDN users: wires all methods and a chosen driver. */
export function createFullCache(options: CreateFullCacheOptions = {}) {
  const { storage, dbName, storeName, ...rest } = options;
  const driver =
    storage === "indexedDB"
      ? indexedDBDriver({ dbName, storeName })
      : localStorageDriver();
  return createCache({
    ...rest,
    driver,
    methods: [...ALL_METHODS],
  });
}
