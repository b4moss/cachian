import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  CachianEnvironmentError,
  createCache,
  DEFAULT_CACHE_TTL_SECONDS,
} from "./index";
import { localStorageDriver } from "./drivers/localStorage";
import { indexedDBDriver } from "./drivers/indexedDB";
import { get } from "./methods/get";
import { set } from "./methods/set";
import { update } from "./methods/update";
import { upsert } from "./methods/upsert";
import { remove } from "./methods/remove";
import { has } from "./methods/has";
import { clear } from "./methods/clear";
import { purge } from "./methods/purge";
import type { CacheEntry } from "./types";
import type { CreateCacheOptions, MethodDef } from "./core/types";
import type { StorageAdapter } from "./drivers/types";

const ALL_METHODS = [
  get,
  set,
  update,
  upsert,
  remove,
  has,
  clear,
  purge,
] as const satisfies readonly MethodDef[];

type TestCacheOptions = Omit<CreateCacheOptions, "driver" | "methods"> & {
  driver?: StorageAdapter;
  methods?: MethodDef[];
};

function createTestCache(options: TestCacheOptions = {}) {
  const { driver, methods, ...rest } = options;
  return createCache({
    driver: driver ?? localStorageDriver(),
    methods: methods ?? [...ALL_METHODS],
    ...rest,
  });
}

function createIdbTestCache(
  options: TestCacheOptions & { dbName?: string; storeName?: string } = {},
) {
  const { dbName, storeName, driver, methods, ...rest } = options;
  return createCache({
    driver:
      driver ??
      indexedDBDriver({
        dbName,
        storeName,
      }),
    methods: methods ?? [...ALL_METHODS],
    ...rest,
  });
}

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
    const cache = createTestCache();
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    expect(setItem).toHaveBeenCalled();
  });

  it("TC-C02: miss", async () => {
    const cache = createTestCache();
    expect(await cache.get("missing")).toBeNull();
    expect(await cache.has("missing")).toBe(false);
  });

  it("TC-C03: default TTL ≈ 1 year / createdAt set", async () => {
    const cache = createTestCache();
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
    const cache = createTestCache({ ttlSeconds: 60 });
    const before = Date.now();
    await cache.set("k", 1);
    const entry = readLocalEntry(store, "k")!;
    expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000 + 2000);
  });

  it("TC-C05: set options.ttlSeconds overrides instance default", async () => {
    const cache = createTestCache({ ttlSeconds: 3600 });
    const before = Date.now();
    await cache.set("k", 1, { ttlSeconds: 10 });
    const entry = readLocalEntry(store, "k")!;
    expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 10_000);
    expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + 10_000 + 2000);
  });

  it("TC-C06: invalid instance ttlSeconds throws TypeError", () => {
    for (const ttlSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createTestCache({ ttlSeconds })).toThrow(TypeError);
      expect(() => createTestCache({ ttlSeconds })).toThrow(/ttlSeconds/);
    }
    expect(store.size).toBe(0);
  });

  it("TC-C07: invalid set ttlSeconds throws and does not write", async () => {
    const cache = createTestCache();
    await expect(cache.set("k", 1, { ttlSeconds: -1 })).rejects.toThrow(
      TypeError,
    );
    expect(store.has("k")).toBe(false);
  });

  it("TC-C08: expired entry is removed on get", async () => {
    const cache = createTestCache();
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
    const cache = createTestCache();
    store.set("bad-json", "not-json");
    store.set("bad-shape", JSON.stringify({ expiresAt: "x", data: 1 }));
    expect(await cache.get("bad-json")).toBeNull();
    expect(await cache.get("bad-shape")).toBeNull();
    expect(store.has("bad-json")).toBe(false);
    expect(store.has("bad-shape")).toBe(false);
  });

  it("TC-C10: enabled false is miss / no-op without mutating storage", async () => {
    await createTestCache().set("k", "kept");
    const snapshot = new Map(store);
    const cache = createTestCache({ enabled: false });
    expect(await cache.get("k")).toBeNull();
    expect(await cache.has("k")).toBe(false);
    await cache.set("k", "new");
    await cache.update("k", "upd");
    await cache.upsert("k", "ups");
    await cache.remove("k");
    await cache.clear();
    await cache.purge({ all: true });
    await cache.purge({ keys: ["k"] });
    await cache.purge({ olderThan: { seconds: 0 } });
    await cache.purge({ createdBefore: "2099-01-01T00:00:00.000Z" });
    expect([...store.entries()]).toEqual([...snapshot.entries()]);
  });

  it("TC-C11: remove", async () => {
    const cache = createTestCache();
    await cache.set("k", 1);
    await cache.remove("k");
    expect(await cache.get("k")).toBeNull();
    await expect(cache.remove("missing")).resolves.toBeUndefined();
  });

  it("TC-C12: has is true only for valid entries", async () => {
    const cache = createTestCache();
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
    const a = createTestCache({ keyPrefix: "a:" });
    const b = createTestCache({ keyPrefix: "b:" });
    await a.set("k", 1);
    expect(await b.get("k")).toBeNull();
    expect(store.has("a:k")).toBe(true);
    expect(store.has("k")).toBe(false);
  });

  it("TC-C14 / TC-LS03: clear only removes own prefix keys", async () => {
    store.set("other", "keep");
    const cache = createTestCache({ keyPrefix: "app:" });
    await cache.set("k", 1);
    await cache.set("m", 2);
    await cache.clear();
    expect(store.has("app:k")).toBe(false);
    expect(store.has("app:m")).toBe(false);
    expect(store.get("other")).toBe("keep");
  });

  it("TC-C15: missing localStorage throws CachianEnvironmentError", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => createTestCache()).toThrow(CachianEnvironmentError);
    expect(() => createTestCache()).toThrow(/localStorage/);
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
      expect(() => createTestCache()).toThrow(CachianEnvironmentError);
      expect(() => createTestCache()).toThrow(/localStorage/);
    } finally {
      if (previous) {
        Object.defineProperty(globalThis, "localStorage", previous);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });

  it("TC-C24: createCache succeeds when APIs are available", async () => {
    const cache = createTestCache();
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
    const cache = createTestCache();
    await expect(cache.set("k", "v")).resolves.toBeUndefined();
    expect(await cache.get("k")).toBeNull();
  });

  it("TC-LS02: stores JSON entry string (jp-local-gov-id compatible)", async () => {
    const cache = createTestCache();
    const url = "https://example/data.json";
    await cache.set(url, { x: 1 });
    const parsed = JSON.parse(store.get(url)!) as CacheEntry;
    expect(typeof parsed.expiresAt).toBe("number");
    expect(typeof parsed.createdAt).toBe("number");
    expect(parsed.data).toEqual({ x: 1 });
  });

  it("TC-C17: purge({ all: true }) matches clear scope", async () => {
    store.set("other", "keep");
    const cache = createTestCache({ keyPrefix: "app:" });
    await cache.set("k", 1);
    await cache.set("m", 2);
    await cache.purge({ all: true });
    expect(store.has("app:k")).toBe(false);
    expect(store.has("app:m")).toBe(false);
    expect(store.get("other")).toBe("keep");
  });

  it("TC-C18: purge({ keys }) removes only listed keys", async () => {
    const cache = createTestCache();
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
    const cache = createTestCache();
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
    const cache = createTestCache();
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
    const cache = createTestCache();
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
    const app = createTestCache({ keyPrefix: "app:" });
    const plain = createTestCache();
    await app.set("k", 1);
    await plain.set("k", 2);
    vi.advanceTimersByTime(1000);
    await app.purge({ olderThan: { seconds: 0 } });
    expect(await app.get("k")).toBeNull();
    expect(await plain.get("k")).toBe(2);
  });

  it("TC-C22: update changes data only and keeps createdAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const cache = createTestCache();
    await cache.set("k", { a: 1 });
    const before = readLocalEntry(store, "k")!;
    vi.advanceTimersByTime(60_000);
    await cache.update("k", { a: 2 });
    const after = readLocalEntry(store, "k")!;
    expect(await cache.get("k")).toEqual({ a: 2 });
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.expiresAt).toBe(before.expiresAt);
  });

  it("TC-C23: update with ttlSeconds refreshes expiresAt only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const cache = createTestCache();
    await cache.set("k", "v1");
    const createdAt = readLocalEntry(store, "k")!.createdAt;
    vi.advanceTimersByTime(5_000);
    const now = Date.now();
    await cache.update("k", "v2", { ttlSeconds: 10 });
    const entry = readLocalEntry(store, "k")!;
    expect(entry.data).toBe("v2");
    expect(entry.createdAt).toBe(createdAt);
    expect(entry.expiresAt).toBeGreaterThanOrEqual(now + 10_000);
    expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + 10_000 + 50);
  });

  it("TC-C24: update is no-op on miss / expired", async () => {
    const cache = createTestCache();
    await expect(cache.update("missing", 1)).resolves.toBeUndefined();
    expect(store.has("missing")).toBe(false);

    store.set(
      "exp",
      JSON.stringify({
        expiresAt: Date.now() - 1,
        data: "old",
        createdAt: Date.now() - 1000,
      } satisfies CacheEntry),
    );
    await cache.update("exp", 2);
    expect(await cache.get("exp")).toBeNull();
    expect(store.has("exp")).toBe(false);
  });

  it("TC-C25: upsert is set on miss and update on hit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));
    const cache = createTestCache();
    await cache.upsert("a", 1);
    expect(await cache.get("a")).toBe(1);
    const first = readLocalEntry(store, "a")!;
    expect(typeof first.createdAt).toBe("number");
    expect(typeof first.expiresAt).toBe("number");

    vi.advanceTimersByTime(1000);
    await cache.upsert("a", 2);
    const second = readLocalEntry(store, "a")!;
    expect(await cache.get("a")).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);

    const now = Date.now();
    await cache.upsert("a", 3, { ttlSeconds: 5 });
    const third = readLocalEntry(store, "a")!;
    expect(third.data).toBe(3);
    expect(third.createdAt).toBe(first.createdAt);
    expect(third.expiresAt).toBeGreaterThanOrEqual(now + 5_000);
    expect(third.expiresAt).toBeLessThanOrEqual(Date.now() + 5_000 + 50);
  });

  it("TC-C26: set regenerates createdAt / expiresAt even when key exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const cache = createTestCache();
    await cache.set("k", "old");
    const oldCreatedAt = readLocalEntry(store, "k")!.createdAt!;
    vi.advanceTimersByTime(60_000);
    await cache.set("k", "replaced");
    const replaced = readLocalEntry(store, "k")!;
    expect(await cache.get("k")).toBe("replaced");
    expect(replaced.createdAt!).toBeGreaterThan(oldCreatedAt);
  });

  it("TC-C27: purge({ createdBefore }) removes only earlier entries", async () => {
    const cache = createTestCache();
    const far = Date.parse("2099-01-01T00:00:00.000Z");
    store.set(
      "old",
      JSON.stringify({
        expiresAt: far,
        data: "old",
        createdAt: Date.parse("2024-01-01T00:00:00.000Z"),
      } satisfies CacheEntry),
    );
    store.set(
      "mid",
      JSON.stringify({
        expiresAt: far,
        data: "mid",
        createdAt: Date.parse("2024-06-01T00:00:00.000Z"),
      } satisfies CacheEntry),
    );
    store.set(
      "new",
      JSON.stringify({
        expiresAt: far,
        data: "new",
        createdAt: Date.parse("2024-12-01T00:00:00.000Z"),
      } satisfies CacheEntry),
    );
    await cache.purge({ createdBefore: "2024-06-01T00:00:00.000Z" });
    expect(await cache.get("old")).toBeNull();
    expect(await cache.get("mid")).toBe("mid");
    expect(await cache.get("new")).toBe("new");
  });

  it("TC-C28: purge({ createdAfter }) and range", async () => {
    const cache = createTestCache();
    const far = Date.parse("2099-01-01T00:00:00.000Z");
    const seed = async () => {
      store.clear();
      store.set(
        "old",
        JSON.stringify({
          expiresAt: far,
          data: "old",
          createdAt: Date.parse("2024-01-01T00:00:00.000Z"),
        } satisfies CacheEntry),
      );
      store.set(
        "mid",
        JSON.stringify({
          expiresAt: far,
          data: "mid",
          createdAt: Date.parse("2024-06-01T00:00:00.000Z"),
        } satisfies CacheEntry),
      );
      store.set(
        "new",
        JSON.stringify({
          expiresAt: far,
          data: "new",
          createdAt: Date.parse("2024-12-01T00:00:00.000Z"),
        } satisfies CacheEntry),
      );
    };

    await seed();
    await cache.purge({ createdAfter: "2024-06-01T00:00:00.000Z" });
    expect(await cache.get("old")).toBe("old");
    expect(await cache.get("mid")).toBe("mid");
    expect(await cache.get("new")).toBeNull();

    await seed();
    await cache.purge({
      createdAfter: "2024-01-01T00:00:00.000Z",
      createdBefore: "2024-12-01T00:00:00.000Z",
    });
    expect(await cache.get("old")).toBe("old");
    expect(await cache.get("mid")).toBeNull();
    expect(await cache.get("new")).toBe("new");
  });

  it("TC-C29: AbsoluteTime parses ISO / seconds / milliseconds", async () => {
    const cache = createTestCache();
    const createdAt = 1_700_000_000_000;
    const far = createdAt + 86_400_000;

    const seed = () => {
      store.set(
        "k",
        JSON.stringify({
          expiresAt: far,
          data: 1,
          createdAt,
        } satisfies CacheEntry),
      );
    };

    seed();
    await cache.purge({ createdBefore: "2023-11-14T22:13:20.000Z" });
    expect(await cache.get("k")).toBeNull();

    seed();
    await cache.purge({ createdBefore: "2023-11-14T22:13:20.123Z" });
    expect(await cache.get("k")).toBeNull();

    seed();
    await cache.purge({ createdBefore: 1_700_000_000_001 });
    expect(await cache.get("k")).toBeNull();

    seed();
    await cache.purge({ createdBefore: 1_700_000_001 });
    expect(await cache.get("k")).toBeNull();

    seed();
    const snapshot = new Map(store);
    await expect(cache.purge({ createdBefore: "not-a-date" })).rejects.toThrow(
      TypeError,
    );
    await expect(cache.purge({ createdBefore: "not-a-date" })).rejects.toThrow(
      /createdBefore|AbsoluteTime|ISO/,
    );
    await expect(cache.purge({ createdBefore: Number.NaN })).rejects.toThrow(
      TypeError,
    );
    await expect(
      cache.purge({ createdBefore: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(TypeError);
    expect([...store.entries()]).toEqual([...snapshot.entries()]);
  });

  it("TC-C30: absolute purge keeps legacy entries without createdAt", async () => {
    const cache = createTestCache();
    store.set(
      "legacy",
      JSON.stringify({
        expiresAt: Date.now() + 60_000,
        data: "legacy",
      } satisfies CacheEntry),
    );
    store.set(
      "dated",
      JSON.stringify({
        expiresAt: Date.now() + 60_000,
        data: 1,
        createdAt: Date.parse("2020-01-01T00:00:00.000Z"),
      } satisfies CacheEntry),
    );
    await cache.purge({ createdBefore: "2099-01-01T00:00:00.000Z" });
    expect(await cache.get("legacy")).toBe("legacy");
    expect(await cache.get("dated")).toBeNull();
  });

  it("TC-C31: mixing olderThan with absolute time throws TypeError", async () => {
    const cache = createTestCache();
    await cache.set("k", 1);
    const snapshot = new Map(store);
    await expect(
      cache.purge({
        olderThan: { seconds: 1 },
        createdBefore: "2024-01-01T00:00:00.000Z",
      } as never),
    ).rejects.toThrow(TypeError);
    await expect(
      cache.purge({
        olderThan: { seconds: 1 },
        createdBefore: "2024-01-01T00:00:00.000Z",
      } as never),
    ).rejects.toThrow(/olderThan/);
    await expect(
      cache.purge({
        olderThan: { mins: 1 },
        createdAfter: 0,
      } as never),
    ).rejects.toThrow(/createdAfter|createdBefore/);
    expect([...store.entries()]).toEqual([...snapshot.entries()]);
  });

  it("TC-C32: invalid update/upsert ttlSeconds throws TypeError", async () => {
    const cache = createTestCache();
    await cache.set("k", 1);
    const snapshot = new Map(store);
    await expect(cache.update("k", 1, { ttlSeconds: -1 })).rejects.toThrow(
      TypeError,
    );
    await expect(cache.update("k", 1, { ttlSeconds: -1 })).rejects.toThrow(
      /ttlSeconds/,
    );
    await expect(cache.upsert("k", 1, { ttlSeconds: Number.NaN })).rejects.toThrow(
      TypeError,
    );
    expect([...store.entries()]).toEqual([...snapshot.entries()]);
  });

  it("TC-LS05: absolute purge does not touch other prefixes", async () => {
    const app = createTestCache({ keyPrefix: "app:" });
    const plain = createTestCache();
    const far = Date.parse("2099-01-01T00:00:00.000Z");
    const old = Date.parse("2020-01-01T00:00:00.000Z");
    store.set(
      "app:k",
      JSON.stringify({
        expiresAt: far,
        data: 1,
        createdAt: old,
      } satisfies CacheEntry),
    );
    store.set(
      "k",
      JSON.stringify({
        expiresAt: far,
        data: 2,
        createdAt: old,
      } satisfies CacheEntry),
    );
    await app.purge({ createdBefore: "2099-01-01T00:00:00.000Z" });
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
    vi.useRealTimers();
  });

  function freshCreate(
    options: TestCacheOptions & { dbName?: string; storeName?: string } = {},
  ) {
    return createIdbTestCache(options);
  }

  it("TC-IDB01: hit/miss without touching localStorage", async () => {
    const cache = await freshCreate();
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    expect(await cache.get("missing")).toBeNull();
    expect(globalThis.localStorage.length).toBe(0);
  });

  it("TC-IDB02: default dbName/storeName work", async () => {
    const cache = await freshCreate();
    await cache.set("k", "v");
    const raw = await readIdbEntry("cachian", "entries", "k");
    expect(raw).toMatchObject({ data: "v", expiresAt: expect.any(Number) });
  });

  it("TC-IDB03: custom dbName/storeName are isolated", async () => {
    const a = await freshCreate({ storeName: "a" });
    const b = await freshCreate({ storeName: "b" });
    await a.set("k", 1);
    expect(await b.get("k")).toBeNull();
    expect(await a.get("k")).toBe(1);
  });

  it("TC-IDB04: stores entry objects (not JSON strings)", async () => {
    const cache = await freshCreate();
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
    expect(() => createTestCache({ driver: indexedDBDriver() })).toThrow(
      CachianEnvironmentError,
    );
    expect(() => createTestCache({ driver: indexedDBDriver() })).toThrow(/IndexedDB/i);
  });

  it("TC-IDB06 / TC-C04: instance ttlSeconds", async () => {
    const cache = await freshCreate({ ttlSeconds: 60 });
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
    const cache = await freshCreate();
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
    await (await freshCreate()).set("k", "kept");
    const cache = await freshCreate({ enabled: false });
    expect(await cache.get("k")).toBeNull();
    await cache.set("k", "new");
    await cache.update("k", "upd");
    await cache.upsert("k", "ups");
    await cache.remove("k");
    await cache.clear();
    await cache.purge({ all: true });
    await cache.purge({ keys: ["k"] });
    await cache.purge({ olderThan: { seconds: 0 } });
    await cache.purge({ createdBefore: "2099-01-01T00:00:00.000Z" });
    const enabled = await freshCreate();
    expect(await enabled.get("k")).toBe("kept");
  });

  it("TC-IDB06 / TC-C11: remove", async () => {
    const cache = await freshCreate();
    await cache.set("k", 1);
    await cache.remove("k");
    expect(await cache.get("k")).toBeNull();
  });

  it("TC-IDB06 / TC-C13: keyPrefix on physical keys", async () => {
    const a = await freshCreate({ keyPrefix: "a:" });
    const b = await freshCreate({ keyPrefix: "b:" });
    await a.set("k", 1);
    expect(await b.get("k")).toBeNull();
    const raw = await readIdbEntry("cachian", "entries", "a:k");
    expect(raw).toMatchObject({ data: 1 });
  });

  it("TC-C14 indexedDB: clear only current store", async () => {
    const a = await freshCreate({ storeName: "storeA" });
    const b = await freshCreate({ storeName: "storeB" });
    await a.set("k", 1);
    await b.set("k", 2);
    await a.clear();
    expect(await a.get("k")).toBeNull();
    expect(await b.get("k")).toBe(2);
  });

  it("TC-IDB06 / TC-C17: purge all", async () => {
    const cache = await freshCreate();
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.purge({ all: true });
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
  });

  it("TC-IDB06 / TC-C18: purge keys", async () => {
    const cache = await freshCreate();
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);
    await cache.purge({ keys: ["a", "c"] });
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBe(2);
    expect(await cache.get("c")).toBeNull();
  });

  it("TC-IDB06 / TC-C19: purge olderThan", async () => {
    const cache = await freshCreate();
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
    const cache = await freshCreate();
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
    const cache = await freshCreate();
    await cache.set("k", 1);
    await expect(cache.purge({ olderThan: {} })).rejects.toThrow(TypeError);
    expect(await cache.get("k")).toBe(1);
  });

  it("TC-IDB06 / TC-C22: update keeps createdAt", async () => {
    const cache = await freshCreate();
    await cache.set("k", { a: 1 });
    const createdAt = Date.parse("2024-01-01T00:00:00.000Z");
    const expiresAt = Date.parse("2099-01-01T00:00:00.000Z");
    await putIdbEntry("cachian", "entries", "k", {
      expiresAt,
      data: { a: 1 },
      createdAt,
    });
    await cache.update("k", { a: 2 });
    const after = (await readIdbEntry(
      "cachian",
      "entries",
      "k",
    )) as CacheEntry;
    expect(await cache.get("k")).toEqual({ a: 2 });
    expect(after.createdAt).toBe(createdAt);
    expect(after.expiresAt).toBe(expiresAt);
  });

  it("TC-IDB06 / TC-C25: upsert miss→set / hit→update", async () => {
    const cache = await freshCreate();
    await cache.upsert("a", 1);
    expect(await cache.get("a")).toBe(1);
    const createdAt = Date.parse("2024-01-01T00:00:00.000Z");
    const expiresAt = Date.parse("2099-01-01T00:00:00.000Z");
    await putIdbEntry("cachian", "entries", "a", {
      expiresAt,
      data: 1,
      createdAt,
    });
    await cache.upsert("a", 2);
    const second = (await readIdbEntry(
      "cachian",
      "entries",
      "a",
    )) as CacheEntry;
    expect(await cache.get("a")).toBe(2);
    expect(second.createdAt).toBe(createdAt);
    expect(second.expiresAt).toBe(expiresAt);
  });

  it("TC-IDB06 / TC-C27: createdBefore", async () => {
    const cache = await freshCreate();
    await cache.set("old", "tmp");
    await cache.set("mid", "tmp");
    await cache.set("new", "tmp");
    const far = Date.parse("2099-01-01T00:00:00.000Z");
    await putIdbEntry("cachian", "entries", "old", {
      expiresAt: far,
      data: "old",
      createdAt: Date.parse("2024-01-01T00:00:00.000Z"),
    });
    await putIdbEntry("cachian", "entries", "mid", {
      expiresAt: far,
      data: "mid",
      createdAt: Date.parse("2024-06-01T00:00:00.000Z"),
    });
    await putIdbEntry("cachian", "entries", "new", {
      expiresAt: far,
      data: "new",
      createdAt: Date.parse("2024-12-01T00:00:00.000Z"),
    });
    await cache.purge({ createdBefore: "2024-06-01T00:00:00.000Z" });
    expect(await cache.get("old")).toBeNull();
    expect(await cache.get("mid")).toBe("mid");
    expect(await cache.get("new")).toBe("new");
  });

  it("TC-IDB06 / TC-C28: createdAfter / range", async () => {
    const cache = await freshCreate();
    await cache.set("old", "tmp");
    await cache.set("mid", "tmp");
    await cache.set("new", "tmp");
    const far = Date.parse("2099-01-01T00:00:00.000Z");
    await putIdbEntry("cachian", "entries", "old", {
      expiresAt: far,
      data: "old",
      createdAt: Date.parse("2024-01-01T00:00:00.000Z"),
    });
    await putIdbEntry("cachian", "entries", "mid", {
      expiresAt: far,
      data: "mid",
      createdAt: Date.parse("2024-06-01T00:00:00.000Z"),
    });
    await putIdbEntry("cachian", "entries", "new", {
      expiresAt: far,
      data: "new",
      createdAt: Date.parse("2024-12-01T00:00:00.000Z"),
    });
    await cache.purge({ createdAfter: "2024-06-01T00:00:00.000Z" });
    expect(await cache.get("old")).toBe("old");
    expect(await cache.get("mid")).toBe("mid");
    expect(await cache.get("new")).toBeNull();
  });

  it("TC-IDB06 / TC-C30: absolute purge keeps legacy without createdAt", async () => {
    const cache = await freshCreate();
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
      createdAt: Date.parse("2020-01-01T00:00:00.000Z"),
    });
    await cache.purge({ createdBefore: "2099-01-01T00:00:00.000Z" });
    expect(await cache.get("legacy")).toBe("legacy");
    expect(await cache.get("dated")).toBeNull();
  });

  it("TC-IDB06 / TC-C31: olderThan mixed with absolute throws", async () => {
    const cache = await freshCreate();
    await cache.set("k", 1);
    await expect(
      cache.purge({
        olderThan: { seconds: 1 },
        createdBefore: "2024-01-01T00:00:00.000Z",
      } as never),
    ).rejects.toThrow(TypeError);
    expect(await cache.get("k")).toBe(1);
  });
});

describe("modular assembly (TC-M)", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    const mem = createMemoryLocalStorage();
    store = mem.store;
    vi.stubGlobal("localStorage", mem.localStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TC-M01: empty methods throws TypeError", () => {
    expect(() =>
      createCache({ driver: localStorageDriver(), methods: [] }),
    ).toThrow(TypeError);
    expect(() =>
      createCache({ driver: localStorageDriver(), methods: [] }),
    ).toThrow(/methods/);
  });

  it("TC-M02: duplicate method names throw TypeError", () => {
    expect(() =>
      createCache({ driver: localStorageDriver(), methods: [get, get] }),
    ).toThrow(TypeError);
    expect(() =>
      createCache({ driver: localStorageDriver(), methods: [get, get] }),
    ).toThrow(/duplicate/);
  });

  it("TC-M03: only selected methods are attached", () => {
    const cache = createCache({
      driver: localStorageDriver(),
      methods: [get, set, remove],
    });
    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
    expect(typeof cache.remove).toBe("function");
    expect("purge" in cache).toBe(false);
    expect("update" in cache).toBe(false);
    expect("upsert" in cache).toBe(false);
    expect("has" in cache).toBe(false);
    expect("clear" in cache).toBe(false);
  });

  it("TC-M04: root does not re-export drivers or methods", async () => {
    const mod = await import("./index");
    expect(mod).not.toHaveProperty("localStorageDriver");
    expect(mod).not.toHaveProperty("indexedDBDriver");
    expect(mod).not.toHaveProperty("get");
    expect(mod).not.toHaveProperty("set");
    expect(mod).not.toHaveProperty("purge");
  });

  it("TC-M05: drivers and methods are importable from subpaths", async () => {
    await expect(import("./drivers/localStorage")).resolves.toMatchObject({
      localStorageDriver: expect.any(Function),
    });
    await expect(import("./drivers/indexedDB")).resolves.toMatchObject({
      indexedDBDriver: expect.any(Function),
    });
    await expect(import("./methods/get")).resolves.toMatchObject({
      get: expect.objectContaining({ name: "get", attach: expect.any(Function) }),
    });
    await expect(import("./methods/purge")).resolves.toMatchObject({
      purge: expect.objectContaining({
        name: "purge",
        attach: expect.any(Function),
      }),
    });
  });

  it("TC-M06: get/set/remove alone support basic read/write", async () => {
    const cache = createCache({
      driver: localStorageDriver(),
      methods: [get, set, remove],
    });
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    await cache.remove("k");
    expect(await cache.get("k")).toBeNull();
    expect(store.size).toBe(0);
  });
});
