# @b4moss/cachian

[![CI](https://github.com/b4moss/cachian/actions/workflows/ci.yml/badge.svg)](https://github.com/b4moss/cachian/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/b4moss/cachian)](https://codecov.io/gh/b4moss/cachian)
[![npm](https://img.shields.io/npm/v/@b4moss/cachian)](https://www.npmjs.com/package/@b4moss/cachian)
[![Release](https://img.shields.io/github/v/release/b4moss/cachian?include_prereleases&filter=v*)](https://github.com/b4moss/cachian/releases)
[![License](https://img.shields.io/github/license/b4moss/cachian)](https://github.com/b4moss/cachian/blob/main/LICENSE)
[![OpenSSF Scorecard](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.scorecard.dev%2Fprojects%2Fgithub.com%2Fb4moss%2Fcachian&label=OpenSSF%20Scorecard&query=$.score)](https://scorecard.dev/viewer/?uri=github.com/b4moss/cachian)

[English](./README.md)

ツリーシェイク可能な **ブラウザ専用** キャッシュヘルパーです。**ドライバ**（localStorage / IndexedDB）と必要な **メソッド**（`get` / `set` / `remove` / …）だけを選んで組み立てます。

[`@b4moss/jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id) のキャッシュロジックを外出し・汎用化したものです。

CI/CD: [docs/ci-cd.ja.md](./docs/ci-cd.ja.md)

## インストール

```bash
npm install @b4moss/cachian
```

## 使い方

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

ブラウザ専用です。バックエンド API が無い環境（Node / SSR など）ではドライバ生成時に `CachianEnvironmentError` になります。モジュールの import だけなら安全です — ドライバ / `createCache` はブラウザで呼ぶか、`typeof window !== "undefined"` などでガードしてください。

### IndexedDB

```ts
import { indexedDBDriver } from "@b4moss/cachian/drivers/indexedDB";

const cache = createCache({
  driver: indexedDBDriver({ dbName: "my-app", storeName: "cache" }),
  methods: [get, set, remove],
});
```

### オプション（`createCache`）

| オプション | 既定 | 説明 |
|------------|------|------|
| `driver` | （必須） | ドライバ factory が返すストレージアダプタ |
| `methods` | （必須） | 付与する MethodDef の非空配列 |
| `enabled` | `true` | `false` のとき読み取りは miss、書き込みは no-op |
| `ttlSeconds` | `31536000`（1 年） | `set` の既定 TTL（秒） |
| `keyPrefix` | `""` | 物理キーの接頭辞 |

### メソッド（サブパス import）

| import | 付与されるメソッド |
|--------|--------------------|
| `@b4moss/cachian/methods/get` | `get` |
| `@b4moss/cachian/methods/set` | `set` |
| `@b4moss/cachian/methods/update` | `update` |
| `@b4moss/cachian/methods/upsert` | `upsert` |
| `@b4moss/cachian/methods/remove` | `remove` |
| `@b4moss/cachian/methods/has` | `has` |
| `@b4moss/cachian/methods/clear` | `clear` |
| `@b4moss/cachian/methods/purge` | `purge` |

保存形式は `{ expiresAt: number, data: unknown, createdAt?: number }`（localStorage は JSON 文字列、IndexedDB はオブジェクト）。新規 `set` では必ず `createdAt` を付与します。

### 書き込み: `set` / `update` / `upsert`

```ts
await cache.set("k", value); // 常に新規エントリ（createdAt / expiresAt を再生成）
await cache.update("k", value); // 有効な既存があるときだけ更新。なければ no-op
await cache.upsert("k", value); // 無ければ set、有れば update
```

`update` / hit 時の `upsert` は `createdAt` を維持します。`ttlSeconds` 未指定なら `expiresAt` も維持します。

### パージ

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
await cache.purge({ expired: true });
```

`createdAt` の無い旧エントリは `olderThan` および絶対時刻モードでは残りますが、`{ expired: true }` では `expiresAt` が過去なら **削除されます**。`olderThan` と `createdBefore` / `createdAfter` の混在、および `{ expired: true }` と他モードの混在は `TypeError` になります。

## 破壊的変更（v0.4）

- `createCache()` は固定フル API を返さず、`driver` + `methods` の指定が必須
- `storage: "localStorage" | "indexedDB"` 文字列オプションは削除（ドライバ factory を使用）
- drivers / methods はルートから再エクスポートしない（サブパスから import）

## ライセンス

MIT
