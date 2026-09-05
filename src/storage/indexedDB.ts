import { isCacheEntry } from "../entry";
import type { CacheEntry } from "../types";
import type { StorageAdapter } from "./types";

type IndexedDBAdapterOptions = {
  dbName: string;
  storeName: string;
};

function getIndexedDB(): IDBFactory | null {
  try {
    if (typeof globalThis.indexedDB === "undefined") return null;
    return globalThis.indexedDB;
  } catch {
    return null;
  }
}

/**
 * Open (or create) a DB ensuring `storeName` exists.
 * Avoid hard-coding version `1` so additional stores can be added via upgrade.
 */
function openDb(dbName: string, storeName: string): Promise<IDBDatabase | null> {
  const indexedDB = getIndexedDB();
  if (!indexedDB) return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      // No version → open current (or create at 1 with onupgradeneeded).
      request = indexedDB.open(dbName);
    } catch {
      resolve(null);
      return;
    }

    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      } catch {
        // ignore
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(storeName)) {
        resolve(db);
        return;
      }

      const nextVersion = db.version + 1;
      db.close();

      let upgrade: IDBOpenDBRequest;
      try {
        upgrade = indexedDB.open(dbName, nextVersion);
      } catch {
        resolve(null);
        return;
      }
      upgrade.onerror = () => resolve(null);
      upgrade.onblocked = () => resolve(null);
      upgrade.onupgradeneeded = () => {
        try {
          const upgraded = upgrade.result;
          if (!upgraded.objectStoreNames.contains(storeName)) {
            upgraded.createObjectStore(storeName);
          }
        } catch {
          // ignore
        }
      };
      upgrade.onsuccess = () => resolve(upgrade.result);
    };
  });
}

function withStore<T>(
  dbName: string,
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return openDb(dbName, storeName).then((db) => {
    if (!db) return undefined;
    return new Promise<T | undefined>((resolve) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = fn(store);
        request.onerror = () => {
          db.close();
          resolve(undefined);
        };
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          resolve(undefined);
        };
        tx.onabort = () => {
          db.close();
          resolve(undefined);
        };
      } catch {
        try {
          db.close();
        } catch {
          // ignore
        }
        resolve(undefined);
      }
    });
  });
}

export function createIndexedDBAdapter(
  options: IndexedDBAdapterOptions,
): StorageAdapter {
  const { dbName, storeName } = options;

  return {
    async get(physicalKey) {
      const value = await withStore(dbName, storeName, "readonly", (store) =>
        store.get(physicalKey),
      );
      if (value === undefined) return null;
      if (!isCacheEntry(value)) {
        await withStore(dbName, storeName, "readwrite", (store) =>
          store.delete(physicalKey),
        );
        return null;
      }
      return value;
    },

    async set(physicalKey, entry: CacheEntry) {
      await withStore(dbName, storeName, "readwrite", (store) =>
        store.put(entry, physicalKey),
      );
    },

    async remove(physicalKey) {
      await withStore(dbName, storeName, "readwrite", (store) =>
        store.delete(physicalKey),
      );
    },

    async clear(_keyPrefix) {
      await withStore(dbName, storeName, "readwrite", (store) => store.clear());
    },
  };
}
