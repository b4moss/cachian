import type { MethodDef } from "../core/types";

export const remove: MethodDef<{
  remove(key: string): Promise<void>;
}> = {
  name: "remove",
  attach(ctx) {
    return {
      async remove(key: string) {
        if (!ctx.enabled) return;
        await ctx.driver.remove(ctx.physical(key));
      },
    };
  },
};
