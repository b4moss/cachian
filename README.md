# @b4moss/cachian

[![CI](https://github.com/b4moss/cachian/actions/workflows/ci.yml/badge.svg)](https://github.com/b4moss/cachian/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/b4moss/cachian)](https://codecov.io/gh/b4moss/cachian)
[![npm](https://img.shields.io/npm/v/@b4moss/cachian)](https://www.npmjs.com/package/@b4moss/cachian)
[![Release](https://img.shields.io/github/v/release/b4moss/cachian?include_prereleases&filter=v*)](https://github.com/b4moss/cachian/releases)
[![License](https://img.shields.io/github/license/b4moss/cachian)](https://github.com/b4moss/cachian/blob/main/LICENSE)
[![OpenSSF Scorecard](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.scorecard.dev%2Fprojects%2Fgithub.com%2Fb4moss%2Fcachian&label=OpenSSF%20Scorecard&query=$.score)](https://scorecard.dev/viewer/?uri=github.com/b4moss/cachian)

[日本語](./README_ja.md)

Tree-shakeable **browser-only** cache helper. Pick a **driver** (localStorage / IndexedDB) and only the **methods** you need (`get` / `set` / `remove` / …).

Extracted and generalized from the cache logic in [`@b4moss/jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id).

CI/CD: [docs/ci-cd.md](./docs/ci-cd.md)

## Install

```bash
npm install @b4moss/cachian
```

## Usage

```ts
import { createCache } from "@b4moss/cachian";
import { localStorageDriver } from "@b4moss/cachian/drivers/localStorage";
import { get } from "@b4moss/cachian/methods/get";
import { set } from "@b4moss/cachian/methods/set";
import { remove } from "@b4moss/cachian/methods/remove";

const cache = createCache({
  driver: localStorageDriver(),
  methods: [get, set, remove],
});

await cache.set("https://example.com/data.json", { hello: "world" });
const data = await cache.get("https://example.com/data.json");
```

Browser only: drivers throw `CachianEnvironmentError` when the backend API is unavailable (e.g. Node / SSR). Importing modules alone is safe — create the driver / cache only in the browser (or guard with `typeof window !== "undefined"`).

### IndexedDB

```ts
import { indexedDBDriver } from "@b4moss/cachian/drivers/indexedDB";

const cache = createCache({
  driver: indexedDBDriver({ dbName: "my-app", storeName: "cache" }),
  methods: [get, set, remove],
});
```

### Options (`createCache`)

| Option | Default | Description |
|--------|---------|-------------|
| `driver` | _(required)_ | Storage adapter from a driver factory |
| `methods` | _(required)_ | Non-empty list of method defs to attach |
| `enabled` | `true` | When `false`, reads miss and writes are no-ops |
| `ttlSeconds` | `31536000` (1 year) | Default TTL for `set` |
| `keyPrefix` | `""` | Prefix for physical keys |

### Methods (subpath imports)

| Import | Attaches |
|--------|----------|
| `@b4moss/cachian/methods/get` | `get` |
| `@b4moss/cachian/methods/set` | `set` |
| `@b4moss/cachian/methods/update` | `update` |
| `@b4moss/cachian/methods/upsert` | `upsert` |
| `@b4moss/cachian/methods/remove` | `remove` |
| `@b4moss/cachian/methods/has` | `has` |
| `@b4moss/cachian/methods/clear` | `clear` |
| `@b4moss/cachian/methods/purge` | `purge` |

Entry shape in storage: `{ expiresAt: number, data: unknown, createdAt?: number }` (localStorage stores JSON strings; IndexedDB stores objects). New `set` writes always include `createdAt`.

### Writes: `set` / `update` / `upsert`

```ts
await cache.set("k", value); // always writes a new entry (resets createdAt / expiresAt)
await cache.update("k", value); // updates only if a valid entry exists; otherwise no-op
await cache.upsert("k", value); // set on miss, update on hit
```

`update` / hit-path `upsert` keep `createdAt`. Without `ttlSeconds`, they also keep `expiresAt`.

### Purge

```ts
import { purge } from "@b4moss/cachian/methods/purge";

const cache = createCache({
  driver: localStorageDriver(),
  methods: [get, set, purge],
});

await cache.purge({ all: true });
await cache.purge({ keys: ["a", "b"] });
await cache.purge({ olderThan: { hours: 1, mins: 30 } });
await cache.purge({ createdBefore: "2024-06-01T00:00:00.000Z" });
```

Legacy entries without `createdAt` are left alone by `olderThan` and absolute-time modes. Mixing `olderThan` with `createdBefore` / `createdAfter` throws `TypeError`.

## Breaking changes (v0.4)

- `createCache()` no longer returns a fixed full API; pass `driver` + `methods`.
- `storage: "localStorage" | "indexedDB"` string option removed — use driver factories.
- Drivers and methods are **not** re-exported from the package root (import subpaths).

## License

MIT
