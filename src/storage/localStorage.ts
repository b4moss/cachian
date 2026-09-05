import { isCacheEntry } from "../entry";
import type { CacheEntry } from "../types";
import type { StorageAdapter } from "./types";

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createLocalStorageAdapter(): StorageAdapter {
  return {
    async get(physicalKey) {
      const storage = getLocalStorage();
      if (!storage) return null;
      try {
        const raw = storage.getItem(physicalKey);
        if (raw == null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isCacheEntry(parsed)) {
          storage.removeItem(physicalKey);
          return null;
        }
        return parsed;
      } catch {
        try {
          storage.removeItem(physicalKey);
        } catch {
          // ignore
        }
        return null;
      }
    },

    async set(physicalKey, entry) {
      const storage = getLocalStorage();
      if (!storage) return;
      try {
        storage.setItem(physicalKey, JSON.stringify(entry));
      } catch {
        // QuotaExceeded or private mode — skip cache
      }
    },

    async remove(physicalKey) {
      const storage = getLocalStorage();
      if (!storage) return;
      try {
        storage.removeItem(physicalKey);
      } catch {
        // ignore
      }
    },

    async clear(keyPrefix) {
      const storage = getLocalStorage();
      if (!storage) return;
      try {
        const toRemove: string[] = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key != null && key.startsWith(keyPrefix)) {
            toRemove.push(key);
          }
        }
        for (const key of toRemove) {
          storage.removeItem(key);
        }
      } catch {
        // ignore
      }
    },

    async list(keyPrefix) {
      const storage = getLocalStorage();
      if (!storage) return [];
      const results: Array<{ physicalKey: string; entry: CacheEntry }> = [];
      try {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key != null && key.startsWith(keyPrefix)) {
            keys.push(key);
          }
        }
        for (const physicalKey of keys) {
          try {
            const raw = storage.getItem(physicalKey);
            if (raw == null) continue;
            const parsed: unknown = JSON.parse(raw);
            if (!isCacheEntry(parsed)) {
              storage.removeItem(physicalKey);
              continue;
            }
            results.push({ physicalKey, entry: parsed });
          } catch {
            try {
              storage.removeItem(physicalKey);
            } catch {
              // ignore
            }
          }
        }
      } catch {
        return [];
      }
      return results;
    },
  };
}
