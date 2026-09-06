import type { StorageAdapter } from "../drivers/types";
import type { CacheEntry, CacheSetOptions } from "../types";

/** Shared runtime context passed to MethodDef.attach. */
export type CacheContext = {
  readonly enabled: boolean;
  readonly keyPrefix: string;
  readonly driver: StorageAdapter;
  physical(key: string): string;
  readValid(key: string): Promise<unknown | null>;
  writeSet(
    key: string,
    data: unknown,
    options?: CacheSetOptions,
  ): Promise<void>;
  writeUpdate(
    key: string,
    data: unknown,
    existing: CacheEntry,
    options?: CacheSetOptions,
  ): Promise<void>;
};

/** Pluggable method definition attached at createCache time. */
export type MethodDef<M extends object = object> = {
  readonly name: string;
  attach(ctx: CacheContext): M;
};

export type CreateCacheOptions<Ms extends readonly MethodDef[] = MethodDef[]> =
  {
    /** Storage driver instance (required). */
    driver: StorageAdapter;
    /** Method definitions to attach (required, non-empty). */
    methods: [...Ms] | Ms;
    /** When false, all operations are miss / no-op. Default: `true`. */
    enabled?: boolean;
    /** Default TTL in seconds for `set`. Default: `DEFAULT_CACHE_TTL_SECONDS`. */
    ttlSeconds?: number;
    /** Prefix prepended to logical keys for physical storage keys. */
    keyPrefix?: string;
  };

/** Convert a union of objects into an intersection. */
export type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

export type CacheFromMethods<Ms extends readonly MethodDef[]> =
  UnionToIntersection<ReturnType<Ms[number]["attach"]>>;
