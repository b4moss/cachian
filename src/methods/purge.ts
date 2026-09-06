import { parseAbsoluteTime, resolveOlderThanMs } from "../entry";
import type { MethodDef } from "../core/types";
import type {
  AbsoluteTime,
  CachePurgeOlderThan,
  CachePurgeOptions,
} from "../types";

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export const purge: MethodDef<{
  purge(options: CachePurgeOptions): Promise<void>;
}> = {
  name: "purge",
  attach(ctx) {
    return {
      async purge(purgeOptions: CachePurgeOptions) {
        if (!ctx.enabled) return;

        const hasOlderThan = hasOwn(purgeOptions, "olderThan");
        const hasCreatedBefore = hasOwn(purgeOptions, "createdBefore");
        const hasCreatedAfter = hasOwn(purgeOptions, "createdAfter");

        if (hasOlderThan && (hasCreatedBefore || hasCreatedAfter)) {
          throw new TypeError(
            "purge cannot mix olderThan with createdBefore/createdAfter",
          );
        }

        if ("all" in purgeOptions && purgeOptions.all === true) {
          await ctx.driver.clear(ctx.keyPrefix);
          return;
        }

        if ("keys" in purgeOptions) {
          for (const key of purgeOptions.keys) {
            await ctx.driver.remove(ctx.physical(key));
          }
          return;
        }

        if (hasOlderThan) {
          const olderThan = (purgeOptions as { olderThan: CachePurgeOlderThan })
            .olderThan;
          const durationMs = resolveOlderThanMs(olderThan);
          const threshold = Date.now() - durationMs;
          const listed = await ctx.driver.list(ctx.keyPrefix);
          for (const { physicalKey, entry } of listed) {
            if (entry.createdAt != null && entry.createdAt <= threshold) {
              await ctx.driver.remove(physicalKey);
            }
          }
          return;
        }

        if (hasCreatedBefore || hasCreatedAfter) {
          const opts = purgeOptions as {
            createdBefore?: AbsoluteTime;
            createdAfter?: AbsoluteTime;
          };
          const beforeMs =
            opts.createdBefore !== undefined
              ? parseAbsoluteTime(opts.createdBefore, "createdBefore")
              : undefined;
          const afterMs =
            opts.createdAfter !== undefined
              ? parseAbsoluteTime(opts.createdAfter, "createdAfter")
              : undefined;

          const listed = await ctx.driver.list(ctx.keyPrefix);
          for (const { physicalKey, entry } of listed) {
            if (entry.createdAt == null) continue;
            if (beforeMs !== undefined && !(entry.createdAt < beforeMs)) {
              continue;
            }
            if (afterMs !== undefined && !(entry.createdAt > afterMs)) {
              continue;
            }
            await ctx.driver.remove(physicalKey);
          }
        }
      },
    };
  },
};
