import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  CachianEnvironmentError,
  createCache,
  DEFAULT_CACHE_TTL_SECONDS,
} from "./index";
import type { CacheEntry, CreateCacheOptions } from "./types";

function createMemoryLocalStorage() {
  const store = new Map<string, string>();
  return {
    store,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    } satisfies Storage,
  };
}

function readLocalEntry(
  store: Map<string, string>,
  physicalKey: string,
): CacheEntry | null {
  const raw = store.get(physicalKey);
  if (raw == null) return null;
  return JSON.parse(raw) as CacheEntry;
}

async function readIdbEntry(
  dbName: string,
  storeName: string,
  physicalKey: string,
): Promise<unknown> {
  const indexedDB = globalThis.indexedDB;
  if (!indexedDB) throw new Error("indexedDB missing");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onerror = () => reject(req.error ?? new Error("open failed"));
    req.onsuccess = () => resolve(req.result);
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(physicalKey);
      req.onerror = () => reject(req.error ?? new Error("get failed"));
      req.onsuccess = () => resolve(req.result);
    });
  } finally {
    db.close();
  }
}

async function putIdbEntry(
  dbName: string,
  storeName: string,
  physicalKey: string,
  entry: CacheEntry,
): Promise<void> {
  const indexedDB = globalThis.indexedDB;
  if (!indexedDB) throw new Error("indexedDB missing");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onerror = () => reject(req.error ?? new Error("open failed"));
    req.onsuccess = () => resolve(req.result);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(entry, physicalKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("put failed"));
    });
  } finally {
    db.close();
  }
}

describe("package exports (TC-P)", () => {
  it("TC-P01: exports createCache, CachianEnvironmentError, and TTL constants", () => {
    expect(typeof createCache).toBe("function");
    expect(CachianEnvironmentError.prototype).toBeInstanceOf(Error);
    expect(DEFAULT_CACHE_TTL_SECONDS).toBe(31536000);
    expect(CACHE_TTL_MS).toBe(DEFAULT_CACHE_TTL_SECONDS * 1000);
  });

  it("TC-C22: importing the module alone does not throw", async () => {
    await expect(import("./index")).resolves.toMatchObject({
      createCache: expect.any(Function),
      CachianEnvironmentError: expect.any(Function),
    });
  });

  it("TC-P02: runtime dependencies are empty", async () => {
    const pkg = (
      await import("../package.json", { with: { type: "json" } })
    ).default as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});

describe("localStorage backend (TC-C / TC-LS)", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    const mem = createMemoryLocalStorage();
    store = mem.store;
    vi.stubGlobal("localStorage", mem.localStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("TC-C01 / TC-LS01: default backend set → get hit via localStorage", async () => {
    const setItem = vi.spyOn(globalThis.localStorage, "setItem");
    const cache = createCache();
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    expect(setItem).toHaveBeenCalled();
  });

  it("TC-C02: miss", async () => {
    const cache = createCache();
    expect(await cache.get("missing")).toBeNull();
    expect(await cache.has("missing")).toBe(false);
  });

  it("TC-C03: default TTL ≈ 1 year / createdAt set", async () => {
    const cache = createCache();
    const before = Date.now();
    await cache.set("k", "v");
    const entry = readLocalEntry(store, "k");
    expect(entry).not.toBeNull();
    expect(entry!.expiresAt).toBeGreaterThanOrEqual(
      before + DEFAULT_CACHE_TTL_SECONDS * 1000,
    );
    expect(entry!.expiresAt).toBeLessThanOrEqual(
      Date.now() + DEFAULT_CACHE_TTL_SECONDS * 1000 + 2000,
    );
    expect(entry!.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry!.createdAt).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it("TC-C04: instance ttlSeconds applies to set", async () => {
    const cache = createCache({ ttlSeconds: 60 });
    const before = Date.now();
    await cache.set("k", 1);
    const entry = readLocalEntry(store, "k")!;
    expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000 + 2000);
  });

  it("TC-C05: set options.ttlSeconds overrides instance default", async () => {
    const cache = createCache({ ttlSeconds: 3600 });
    const before = Date.now();
    await cache.set("k", 1, { ttlSeconds: 10 });
    const entry = readLocalEntry(store, "k")!;
    expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 10_000);
    expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + 10_000 + 2000);
  });

  it("TC-C06: invalid instance ttlSeconds throws TypeError", () => {
    for (const ttlSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createCache({ ttlSeconds })).toThrow(TypeError);
      expect(() => createCache({ ttlSeconds })).toThrow(/ttlSeconds/);
    }
    expect(store.size).toBe(0);
  });

  it("TC-C07: invalid set ttlSeconds throws and does not write", async () => {
    const cache = createCache();
    await expect(cache.set("k", 1, { ttlSeconds: -1 })).rejects.toThrow(
      TypeError,
    );
    expect(store.has("k")).toBe(false);
  });

  it("TC-C08: expired entry is removed on get", async () => {
    const cache = createCache();
    store.set(
      "k",
      JSON.stringify({
        expiresAt: Date.now() - 1,
        data: "old",
      } satisfies CacheEntry),
    );
    expect(await cache.get("k")).toBeNull();
    expect(store.has("k")).toBe(false);
    expect(await cache.has("k")).toBe(false);
  });

  it("TC-C09: corrupt entries are cleaned up", async () => {
    const cache = createCache();
    store.set("bad-json", "not-json");
    store.set("bad-shape", JSON.stringify({ expiresAt: "x", data: 1 }));
    expect(await cache.get("bad-json")).toBeNull();
    expect(await cache.get("bad-shape")).toBeNull();
    expect(store.has("bad-json")).toBe(false);
    expect(store.has("bad-shape")).toBe(false);
  });

  it("TC-C10: enabled false is miss / no-op without mutating storage", async () => {
    await createCache().set("k", "kept");
    const snapshot = new Map(store);
    const cache = createCache({ enabled: false });
    expect(await cache.get("k")).toBeNull();
    expect(await cache.has("k")).toBe(false);
    await cache.set("k", "new");
    await cache.remove("k");
    await cache.clear();
    await cache.purge({ all: true });
    await cache.purge({ keys: ["k"] });
    await cache.purge({ olderThan: { seconds: 0 } });
    expect([...store.entries()]).toEqual([...snapshot.entries()]);
  });

  it("TC-C11: remove", async () => {
    const cache = createCache();
    await cache.set("k", 1);
    await cache.remove("k");
    expect(await cache.get("k")).toBeNull();
    await expect(cache.remove("missing")).resolves.toBeUndefined();
  });

  it("TC-C12: has is true only for valid entries", async () => {
    const cache = createCache();
    await cache.set("ok", 1);
    store.set(
      "expired",
      JSON.stringify({
        expiresAt: Date.now() - 1,
        data: 2,
      } satisfies CacheEntry),
    );
    expect(await cache.has("ok")).toBe(true);
    expect(await cache.has("expired")).toBe(false);
    expect(store.has("expired")).toBe(false);
  });

  it("TC-C13: keyPrefix isolates instances", async () => {
    const a = createCache({ keyPrefix: "a:" });
    const b = createCache({ keyPrefix: "b:" });
    await a.set("k", 1);
    expect(await b.get("k")).toBeNull();
    expect(store.has("a:k")).toBe(true);
    expect(store.has("k")).toBe(false);
  });

  it("TC-C14 / TC-LS03: clear only removes own prefix keys", async () => {
    store.set("other", "keep");
    const cache = createCache({ keyPrefix: "app:" });
    await cache.set("k", 1);
    await cache.set("m", 2);
    await cache.clear();
    expect(store.has("app:k")).toBe(false);
    expect(store.has("app:m")).toBe(false);
    expect(store.get("other")).toBe("keep");
  });

  it("TC-C15: missing localStorage throws CachianEnvironmentError", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => createCache()).toThrow(CachianEnvironmentError);
    expect(() => createCache()).toThrow(/localStorage/);
    expect(store.size).toBe(0);
  });

  it("TC-C23: localStorage accessor throw is also unsupported", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => createCache()).toThrow(CachianEnvironmentError);
      expect(() => createCache()).toThrow(/localStorage/);
    } finally {
      if (previous) {
        Object.defineProperty(globalThis, "localStorage", previous);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });

  it("TC-C24: createCache succeeds when APIs are available", async () => {
    const cache = createCache();
    await cache.set("k", 1);
    expect(await cache.get("k")).toBe(1);
  });

  it("TC-C16: write failures are swallowed", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } satisfies Storage);
    const cache = createCache();
    await expect(cache.set("k", "v")).resolves.toBeUndefined();
    expect(await cache.get("k")).toBeNull();
  });

  it("TC-LS02: stores JSON entry string (jp-local-gov-id compatible)", async () => {
    const cache = createCache();
    const url = "https://example/data.json";
    await cache.set(url, { x: 1 });
    const parsed = JSON.parse(store.get(url)!) as CacheEntry;
    expect(typeof parsed.expiresAt).toBe("number");
    expect(typeof parsed.createdAt).toBe("number");
    expect(parsed.data).toEqual({ x: 1 });
  });

  it("TC-C17: purge({ all: true }) matches clear scope", async () => {
    store.set("other", "keep");
    const cache = createCache({ keyPrefix: "app:" });
    await cache.set("k", 1);
    await cache.set("m", 2);
    await cache.purge({ all: true });
    expect(store.has("app:k")).toBe(false);
    expect(store.has("app:m")).toBe(false);
    expect(store.get("other")).toBe("keep");
  });

  it("TC-C18: purge({ keys }) removes only listed keys", async () => {
    const cache = createCache();
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);
    await cache.purge({ keys: ["a", "c"] });
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBe(2);
    expect(await cache.get("c")).toBeNull();
    await cache.purge({ keys: [] });
    expect(await cache.get("b")).toBe(2);
    await expect(cache.purge({ keys: ["missing"] })).resolves.toBeUndefined();
  });

  it("TC-C19: purge({ olderThan }) removes only old entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const cache = createCache();
    await cache.set("old", 1);
    vi.advanceTimersByTime(11 * 60 * 1000);
    await cache.set("fresh", 2);
    await cache.purge({ olderThan: { mins: 10 } });
    expect(await cache.get("old")).toBeNull();
    expect(await cache.get("fresh")).toBe(2);

    await cache.purge({ all: true });
    await cache.set("combo-old", 3);
    vi.advanceTimersByTime(90 * 60 * 1000);
    await cache.set("combo-new", 4);
    await cache.purge({ olderThan: { hours: 1, mins: 30 } });
    expect(await cache.get("combo-old")).toBeNull();
    expect(await cache.get("combo-new")).toBe(4);
  });

  it("TC-C20: olderThan keeps legacy entries without createdAt", async () => {
    const cache = createCache();
    store.set(
      "legacy",
      JSON.stringify({
        expiresAt: Date.now() + 60_000,
        data: "legacy",
      } satisfies CacheEntry),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    await cache.set("dated", 1);
    vi.advanceTimersByTime(1000);
    await cache.purge({ olderThan: { seconds: 0 } });
    expect(await cache.get("legacy")).toBe("legacy");
    expect(await cache.get("dated")).toBeNull();
  });

  it("TC-C21: invalid olderThan throws TypeError", async () => {
    const cache = createCache();
    await cache.set("k", 1);
    const snapshot = new Map(store);
    await expect(cache.purge({ olderThan: {} })).rejects.toThrow(TypeError);
    await expect(cache.purge({ olderThan: {} })).rejects.toThrow(/olderThan/);
    await expect(cache.purge({ olderThan: { mins: -1 } })).rejects.toThrow(
      TypeError,
    );
    await expect(cache.purge({ olderThan: { hours: Number.NaN } })).rejects.toThrow(
      TypeError,
    );
    await expect(
      cache.purge({ olderThan: { years: Number.POSITIVE_INFINITY } }),
    ).rejects.toThrow(TypeError);
    expect([...store.entries()]).toEqual([...snapshot.entries()]);
  });

  it("TC-LS04: purge({ olderThan }) does not touch other prefixes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const app = createCache({ keyPrefix: "app:" });
    const plain = createCache();
    await app.set("k", 1);
    await plain.set("k", 2);
    vi.advanceTimersByTime(1000);
    await app.purge({ olderThan: { seconds: 0 } });
    expect(await app.get("k")).toBeNull();
    expect(await plain.get("k")).toBe(2);
  });
});

describe("indexedDB backend (TC-IDB)", () => {
  beforeEach(async () => {
    vi.resetModules();
    const fake = await import("fake-indexeddb");
    const factory = new fake.IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("IDBKeyRange", fake.IDBKeyRange);
    const mem = createMemoryLocalStorage();
    vi.stubGlobal("localStorage", mem.localStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function freshCreate(options?: CreateCacheOptions) {
    const mod = await import("./index");
    return mod.createCache(options);
  }

  it("TC-IDB01: hit/miss without touching localStorage", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    expect(await cache.get("missing")).toBeNull();
    expect(globalThis.localStorage.length).toBe(0);
  });

  it("TC-IDB02: default dbName/storeName work", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("k", "v");
    const raw = await readIdbEntry("cachian", "entries", "k");
    expect(raw).toMatchObject({ data: "v", expiresAt: expect.any(Number) });
  });

  it("TC-IDB03: custom dbName/storeName are isolated", async () => {
    const a = await freshCreate({
      storage: "indexedDB",
      storeName: "a",
    });
    const b = await freshCreate({
      storage: "indexedDB",
      storeName: "b",
    });
    await a.set("k", 1);
    expect(await b.get("k")).toBeNull();
    expect(await a.get("k")).toBe(1);
  });

  it("TC-IDB04: stores entry objects (not JSON strings)", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("k", { x: 1 });
    const raw = await readIdbEntry("cachian", "entries", "k");
    expect(typeof raw).toBe("object");
    expect(typeof raw).not.toBe("string");
    expect(raw).toMatchObject({
      expiresAt: expect.any(Number),
      createdAt: expect.any(Number),
      data: { x: 1 },
    });
  });

  it("TC-IDB05: missing indexedDB throws CachianEnvironmentError", () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(() => createCache({ storage: "indexedDB" })).toThrow(
      CachianEnvironmentError,
    );
    expect(() => createCache({ storage: "indexedDB" })).toThrow(/IndexedDB/i);
  });

  it("TC-IDB06 / TC-C04: instance ttlSeconds", async () => {
    const cache = await freshCreate({
      storage: "indexedDB",
      ttlSeconds: 60,
    });
    const before = Date.now();
    await cache.set("k", 1);
    const raw = (await readIdbEntry(
      "cachian",
      "entries",
      "k",
    )) as CacheEntry;
    expect(raw.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(raw.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000 + 2000);
  });

  it("TC-IDB06 / TC-C08: expired entry removed on get", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("k", "old");
    const indexedDB = globalThis.indexedDB!;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("cachian");
      open.onerror = () => reject(open.error ?? new Error("open"));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("entries", "readwrite");
        tx.objectStore("entries").put(
          { expiresAt: Date.now() - 1, data: "old" },
          "k",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error("tx"));
      };
    });
    expect(await cache.get("k")).toBeNull();
    expect(await readIdbEntry("cachian", "entries", "k")).toBeUndefined();
  });

  it("TC-IDB06 / TC-C10: enabled false no-op", async () => {
    await (await freshCreate({ storage: "indexedDB" })).set("k", "kept");
    const cache = await freshCreate({ storage: "indexedDB", enabled: false });
    expect(await cache.get("k")).toBeNull();
    await cache.set("k", "new");
    await cache.remove("k");
    await cache.clear();
    await cache.purge({ all: true });
    await cache.purge({ keys: ["k"] });
    await cache.purge({ olderThan: { seconds: 0 } });
    const enabled = await freshCreate({ storage: "indexedDB" });
    expect(await enabled.get("k")).toBe("kept");
  });

  it("TC-IDB06 / TC-C11: remove", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("k", 1);
    await cache.remove("k");
    expect(await cache.get("k")).toBeNull();
  });

  it("TC-IDB06 / TC-C13: keyPrefix on physical keys", async () => {
    const a = await freshCreate({
      storage: "indexedDB",
      keyPrefix: "a:",
    });
    const b = await freshCreate({
      storage: "indexedDB",
      keyPrefix: "b:",
    });
    await a.set("k", 1);
    expect(await b.get("k")).toBeNull();
    const raw = await readIdbEntry("cachian", "entries", "a:k");
    expect(raw).toMatchObject({ data: 1 });
  });

  it("TC-C14 indexedDB: clear only current store", async () => {
    const a = await freshCreate({
      storage: "indexedDB",
      storeName: "storeA",
    });
    const b = await freshCreate({
      storage: "indexedDB",
      storeName: "storeB",
    });
    await a.set("k", 1);
    await b.set("k", 2);
    await a.clear();
    expect(await a.get("k")).toBeNull();
    expect(await b.get("k")).toBe(2);
  });

  it("TC-IDB06 / TC-C17: purge all", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.purge({ all: true });
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
  });

  it("TC-IDB06 / TC-C18: purge keys", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);
    await cache.purge({ keys: ["a", "c"] });
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBe(2);
    expect(await cache.get("c")).toBeNull();
  });

  it("TC-IDB06 / TC-C19: purge olderThan", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("old", 1);
    await cache.set("fresh", 2);
    const now = Date.now();
    await putIdbEntry("cachian", "entries", "old", {
      expiresAt: now + 60_000,
      data: 1,
      createdAt: now - 11 * 60 * 1000,
    });
    await putIdbEntry("cachian", "entries", "fresh", {
      expiresAt: now + 60_000,
      data: 2,
      createdAt: now,
    });
    await cache.purge({ olderThan: { mins: 10 } });
    expect(await cache.get("old")).toBeNull();
    expect(await cache.get("fresh")).toBe(2);
  });

  it("TC-IDB06 / TC-C20: olderThan keeps legacy without createdAt", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("legacy", "tmp");
    await cache.set("dated", "tmp");
    const now = Date.now();
    await putIdbEntry("cachian", "entries", "legacy", {
      expiresAt: now + 60_000,
      data: "legacy",
    });
    await putIdbEntry("cachian", "entries", "dated", {
      expiresAt: now + 60_000,
      data: 1,
      createdAt: now - 1000,
    });
    await cache.purge({ olderThan: { seconds: 0 } });
    expect(await cache.get("legacy")).toBe("legacy");
    expect(await cache.get("dated")).toBeNull();
  });

  it("TC-IDB06 / TC-C21: invalid olderThan", async () => {
    const cache = await freshCreate({ storage: "indexedDB" });
    await cache.set("k", 1);
    await expect(cache.purge({ olderThan: {} })).rejects.toThrow(TypeError);
    expect(await cache.get("k")).toBe(1);
  });
});
