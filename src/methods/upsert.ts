import { isExpired, resolveTtlMs } from "../entry";
import type { MethodDef } from "../core/types";
import type { CacheSetOptions } from "../types";

export const upsert: MethodDef<{
  upsert(key: string, data: unknown, options?: CacheSetOptions): Promise<void>;
}> = {
  name: "upsert",
  attach(ctx) {
    return {
      async upsert(key: string, data: unknown, options?: CacheSetOptions) {
        if (!ctx.enabled) return;
        if (options?.ttlSeconds !== undefined) {
          resolveTtlMs(options.ttlSeconds);
        }
        const entry = await ctx.driver.get(ctx.physical(key));
        if (entry == null) {
          await ctx.writeSet(key, data, options);
          return;
        }
        if (isExpired(entry)) {
          await ctx.driver.remove(ctx.physical(key));
          await ctx.writeSet(key, data, options);
          return;
        }
        await ctx.writeUpdate(key, data, entry, options);
      },
    };
  },
};
