import type { MethodDef } from "../core/types";

export const get: MethodDef<{
  get(key: string): Promise<unknown | null>;
}> = {
  name: "get",
  attach(ctx) {
    return {
      async get(key: string) {
        return ctx.readValid(key);
      },
    };
  },
};
