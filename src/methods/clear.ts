import type { MethodDef } from "../core/types";

export const clear: MethodDef<{
  clear(): Promise<void>;
}> = {
  name: "clear",
  attach(ctx) {
    return {
      async clear() {
        if (!ctx.enabled) return;
        await ctx.driver.clear(ctx.keyPrefix);
      },
    };
  },
};
