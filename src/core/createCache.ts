import { createCacheContext } from "./context";
import type {
  CacheFromMethods,
  CreateCacheOptions,
  MethodDef,
} from "./types";

export function createCache<const Ms extends readonly MethodDef[]>(
  options: CreateCacheOptions<Ms>,
): CacheFromMethods<Ms> {
  if (!Array.isArray(options.methods) || options.methods.length === 0) {
    throw new TypeError("methods must be a non-empty array");
  }

  const seen = new Set<string>();
  for (const method of options.methods) {
    if (seen.has(method.name)) {
      throw new TypeError(`duplicate method name: ${method.name}`);
    }
    seen.add(method.name);
  }

  if (options.driver == null || typeof options.driver !== "object") {
    throw new TypeError("driver is required");
  }

  const ctx = createCacheContext({
    driver: options.driver,
    enabled: options.enabled,
    ttlSeconds: options.ttlSeconds,
    keyPrefix: options.keyPrefix,
  });

  const cache: Record<string, unknown> = {};
  for (const method of options.methods) {
    Object.assign(cache, method.attach(ctx));
  }
  return cache as CacheFromMethods<Ms>;
}
