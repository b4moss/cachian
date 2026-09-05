# @b4moss/cachian

Universal browser cache helper with **localStorage** (default) and **IndexedDB** backends, TTL, and a small async API.

Extracted and generalized from the cache logic in [`@b4moss/jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id).

## Install

```bash
npm install @b4moss/cachian
```

## Usage

```ts
import { createCache } from "@b4moss/cachian";

const cache = createCache(); // localStorage by default

await cache.set("https://example.com/data.json", { hello: "world" });
const data = await cache.get("https://example.com/data.json");
```

### IndexedDB

```ts
const cache = createCache({
  storage: "indexedDB",
  dbName: "my-app",
  storeName: "cache",
});
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `storage` | `"localStorage"` | `"localStorage"` or `"indexedDB"` |
| `enabled` | `true` | When `false`, reads miss and writes are no-ops |
| `ttlSeconds` | `31536000` (1 year) | Default TTL for `set` |
| `keyPrefix` | `""` | Prefix for physical keys |
| `dbName` | `"cachian"` | IndexedDB database name |
| `storeName` | `"entries"` | IndexedDB object store name |

Entry shape in storage: `{ expiresAt: number, data: unknown }` (localStorage stores JSON strings; IndexedDB stores objects).

## License

MIT
