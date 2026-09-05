# @b4moss/cachian

[![CI](https://github.com/b4moss/cachian/actions/workflows/ci.yml/badge.svg)](https://github.com/b4moss/cachian/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/b4moss/cachian)](https://codecov.io/gh/b4moss/cachian)
[![npm](https://img.shields.io/npm/v/@b4moss/cachian)](https://www.npmjs.com/package/@b4moss/cachian)
[![Release](https://img.shields.io/github/v/release/b4moss/cachian?include_prereleases&filter=v*)](https://github.com/b4moss/cachian/releases)
[![License](https://img.shields.io/github/license/b4moss/cachian)](https://github.com/b4moss/cachian/blob/main/LICENSE)
[![OpenSSF Scorecard](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.scorecard.dev%2Fprojects%2Fgithub.com%2Fb4moss%2Fcachian&label=OpenSSF%20Scorecard&query=$.score)](https://scorecard.dev/viewer/?uri=github.com/b4moss/cachian)

[English](./README.md)

**localStorage**（既定）と **IndexedDB** を切り替えられる、TTL 付きの小さな非同期ブラウザキャッシュヘルパーです。

[`@b4moss/jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id) のキャッシュロジックを外出し・汎用化したものです。

CI/CD 方針: [docs/ci-cd.ja.md](./docs/ci-cd.ja.md)

## インストール

```bash
npm install @b4moss/cachian
```

## 使い方

```ts
import { createCache } from "@b4moss/cachian";

const cache = createCache(); // 既定は localStorage

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

### オプション

| オプション | 既定 | 説明 |
|------------|------|------|
| `storage` | `"localStorage"` | `"localStorage"` または `"indexedDB"` |
| `enabled` | `true` | `false` のとき読み取りは miss、書き込みは no-op |
| `ttlSeconds` | `31536000`（1 年） | `set` の既定 TTL（秒） |
| `keyPrefix` | `""` | 物理キーの接頭辞 |
| `dbName` | `"cachian"` | IndexedDB の DB 名 |
| `storeName` | `"entries"` | IndexedDB の object store 名 |

保存形式は `{ expiresAt: number, data: unknown }`（localStorage は JSON 文字列、IndexedDB はオブジェクト）。

## ライセンス

MIT
