import type { MethodDef } from "../core/types";
import type { CacheSetOptions } from "../types";

export const set: MethodDef<{
  set(key: string, data: unknown, options?: CacheSetOptions): Promise<void>;
}> = {
  name: "set",
  attach(ctx) {
    return {
      async set(key: string, data: unknown, options?: CacheSetOptions) {
        if (!ctx.enabled) return;
        await ctx.writeSet(key, data, options);
      },
    };
  },
};
