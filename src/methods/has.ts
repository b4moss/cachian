import type { MethodDef } from "../core/types";

export const has: MethodDef<{
  has(key: string): Promise<boolean>;
}> = {
  name: "has",
  attach(ctx) {
    return {
      async has(key: string) {
        return (await ctx.readValid(key)) !== null;
      },
    };
  },
};
