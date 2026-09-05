# @b4moss/cachian

[![CI](https://github.com/b4moss/cachian/actions/workflows/ci.yml/badge.svg)](https://github.com/b4moss/cachian/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/b4moss/cachian)](https://codecov.io/gh/b4moss/cachian)
[![npm](https://img.shields.io/npm/v/@b4moss/cachian)](https://www.npmjs.com/package/@b4moss/cachian)
[![Release](https://img.shields.io/github/v/release/b4moss/cachian?include_prereleases&filter=v*)](https://github.com/b4moss/cachian/releases)
[![License](https://img.shields.io/github/license/b4moss/cachian)](https://github.com/b4moss/cachian/blob/main/LICENSE)
[![OpenSSF Scorecard](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.scorecard.dev%2Fprojects%2Fgithub.com%2Fb4moss%2Fcachian&label=OpenSSF%20Scorecard&query=$.score)](https://scorecard.dev/viewer/?uri=github.com/b4moss/cachian)

[日本語](./README_ja.md)

Universal browser cache helper with **localStorage** (default) and **IndexedDB** backends, TTL, and a small async API.

Extracted and generalized from the cache logic in [`@b4moss/jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id).

CI/CD direction: [docs/ci-cd.md](./docs/ci-cd.md)

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
