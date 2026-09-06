import { isExpired, resolveTtlMs } from "../entry";
import type { MethodDef } from "../core/types";
import type { CacheSetOptions } from "../types";

export const update: MethodDef<{
  update(key: string, data: unknown, options?: CacheSetOptions): Promise<void>;
}> = {
  name: "update",
  attach(ctx) {
    return {
      async update(key: string, data: unknown, options?: CacheSetOptions) {
        if (!ctx.enabled) return;
        // Validate TTL before touching storage when provided.
        if (options?.ttlSeconds !== undefined) {
          resolveTtlMs(options.ttlSeconds);
        }
        const entry = await ctx.driver.get(ctx.physical(key));
        if (entry == null) return;
        if (isExpired(entry)) {
          await ctx.driver.remove(ctx.physical(key));
          return;
        }
        await ctx.writeUpdate(key, data, entry, options);
      },
    };
  },
};
