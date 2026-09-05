# @b4moss/cachian

[![CI](https://github.com/b4moss/cachian/actions/workflows/ci.yml/badge.svg)](https://github.com/b4moss/cachian/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/b4moss/cachian)](https://codecov.io/gh/b4moss/cachian)
[![npm](https://img.shields.io/npm/v/@b4moss/cachian)](https://www.npmjs.com/package/@b4moss/cachian)
[![Release](https://img.shields.io/github/v/release/b4moss/cachian?include_prereleases&filter=v*)](https://github.com/b4moss/cachian/releases)
[![License](https://img.shields.io/github/license/b4moss/cachian)](https://github.com/b4moss/cachian/blob/main/LICENSE)
[![OpenSSF Scorecard](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.scorecard.dev%2Fprojects%2Fgithub.com%2Fb4moss%2Fcachian&label=OpenSSF%20Scorecard&query=$.score)](https://scorecard.dev/viewer/?uri=github.com/b4moss/cachian)

[English](./README.md)

**localStorage**（既定）と **IndexedDB** を切り替えられる、TTL 付きの小さな非同期 **ブラウザ専用** キャッシュヘルパーです。

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

ブラウザ専用です。選んだバックエンド API（`localStorage` / `indexedDB`）が無い環境（Node / SSR など）で `createCache()` を呼ぶと `CachianEnvironmentError` になります。モジュールの import だけなら問題ありません — `createCache()` はブラウザで呼ぶか、`typeof window !== "undefined"` などでガードしてください。

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
// このインスタンスが管理する範囲をすべて削除
await cache.purge({ all: true });

// 指定した論理キーだけ削除
await cache.purge({ keys: ["a", "b"] });

// 指定期間より古いエントリだけ削除（固定換算: year=365日, month=30日）
await cache.purge({ olderThan: { hours: 1, mins: 30 } });

// 絶対時刻（ISO 8601、またはエポック秒／ミリ秒の数値）
await cache.purge({ createdBefore: "2024-06-01T00:00:00.000Z" });
await cache.purge({ createdAfter: 1_700_000_000_000 });
await cache.purge({
  createdAfter: "2024-01-01T00:00:00.000Z",
  createdBefore: "2024-12-01T00:00:00.000Z",
});
```

`createdAt` の無い旧エントリは `olderThan` および絶対時刻モードでは残ります（消す場合は `all` または `keys` を使います）。`olderThan` と `createdBefore` / `createdAfter` の混在は `TypeError` になります。

## ライセンス

MIT
