# core 仕様

現行バージョン（v0.6.0）に存在する **コア組み立て・環境ガード・エントリ形式・パッケージ公開面・共通振る舞い** の正本。  
詳細な受け入れケースは [`docs/tests/core/`](../../tests/core/) を参照。

由来: 旧 `docs/tests/test-spec-cachian.md` の契約節（§3.1–3.3.1 / §3.6 / §5）およびルート README の公開面要約を昇格。

## 概要

- `createCache({ driver, methods })` でドライバと MethodDef を組み立てるブラウザ専用キャッシュ
- drivers / methods はルートから再エクスポートしない（サブパス）
- エントリは `{ expiresAt, data, createdAt? }`
- 環境非対応時は `CachianEnvironmentError`

## パッケージエントリ（サブパス）

| サブパス | 主な export | 備考 |
|----------|-------------|------|
| `@b4moss/cachian` | 値: `createCache`, `CachianEnvironmentError`, `DEFAULT_CACHE_TTL_SECONDS`, `CACHE_TTL_MS`（deprecated）。型: `AbsoluteTime`, `CacheEntry`, `CachePurgeOlderThan`, `CachePurgeOptions`, `CacheSetOptions`, `CacheContext`, `CacheFromMethods`, `CreateCacheOptions`, `MethodDef`, `UnionToIntersection` | **drivers / methods / `StorageAdapter` は再エクスポートしない**（`src/index.ts`） |
| `@b4moss/cachian/drivers/localStorage` | `localStorageDriver` | |
| `@b4moss/cachian/drivers/indexedDB` | `indexedDBDriver`, 型 `IndexedDBDriverOptions` | |
| `@b4moss/cachian/methods/get` | `get` | MethodDef |
| `@b4moss/cachian/methods/set` | `set` | MethodDef |
| `@b4moss/cachian/methods/update` | `update` | MethodDef |
| `@b4moss/cachian/methods/upsert` | `upsert` | MethodDef |
| `@b4moss/cachian/methods/remove` | `remove` | MethodDef |
| `@b4moss/cachian/methods/has` | `has` | MethodDef |
| `@b4moss/cachian/methods/purge` | `purge` | MethodDef |

削除（v0.6.0）: `@b4moss/cachian/methods/clear`（公開 MethodDef / サブパス export ともに廃止）。`package.json` `exports` にも無い。

`package.json`: `"sideEffects": false`。ランタイム `dependencies` は無し（または空）。`fake-indexeddb` は `devDependencies` のみ。

### CDN / IIFE エントリ（npm サブパスとは別）

実装: `src/cdn.ts`。ビルド: `scripts/build.mjs` → `dist/cachian.iife.js` / `dist/cachian.iife.min.js`（`package.json` の `unpkg` / `jsdelivr` は minify 版）。グローバル名は **`Cachian`**。

CDN バンドルは npm ルートと異なり、次をまとめて公開する:

- ルート相当: `createCache`, `CachianEnvironmentError`, TTL 定数、上記の共通型
- 両ドライバ + 公開 7 MethodDef（`clear` 無し）
- 型 `StorageAdapter` / `IndexedDBDriverOptions`
- 利便 API **`createFullCache(options?)`** / 型 `CreateFullCacheOptions`
  - `storage?: "localStorage" | "indexedDB"`（省略時 localStorage）
  - `dbName?` / `storeName?`（IndexedDB 時。ドライバ既定は `cachian` / `entries`）
  - その他は `createCache` と同じ `enabled` / `ttlSeconds` / `keyPrefix`
  - 内部で全 7 MethodDef を渡し、選んだドライバで `createCache` する

npm の `createCache` には `storage` 文字列オプションは**無い**（v0.4 破壊的変更）。`storage` は CDN の `createFullCache` 専用。  
受け入れ TC の必須対象は npm / ソースのサブパス契約。CDN のブラウザ手動確認は任意。

## 定数

| 名前 | 型 | 値 / 制約 |
|------|-----|-----------|
| `DEFAULT_CACHE_TTL_SECONDS` | `number` | `365 * 24 * 60 * 60`（`31536000`） |
| `CACHE_TTL_MS` | `number` | `DEFAULT_CACHE_TTL_SECONDS * 1000`。**deprecated**（互換用再エクスポート可） |

## `createCache(options)`

`CreateCacheOptions`:

| フィールド | 型 | 既定 | 制約 |
|------------|-----|------|------|
| `driver` | `StorageAdapter`（ドライバ戻り値） | （なし） | **必須** |
| `methods` | `MethodDef[]` | （なし） | **必須**。長さ 1 以上。空配列は型・実行時とも拒否（`TypeError`） |
| `enabled` | `boolean` | `true` | `false` のとき読み取りは miss、書き込み・purge は no-op（下記「共通振る舞い」） |
| `ttlSeconds` | `number` | （未指定時は書き込み側で `DEFAULT_CACHE_TTL_SECONDS`） | 有限かつ `>= 0`。不正なら **生成時**に `TypeError` |
| `keyPrefix` | `string` | `""` | 論理キーの前に付与 |

`driver` が欠ける／非オブジェクトのとき実行時 **`TypeError`**（メッセージに `driver`）。`methods` 空配列も **`TypeError`**（メッセージに `methods`）。

削除（v0.3 / npm `createCache` からの破壊的変更）:

- `storage: "localStorage" | "indexedDB"` 文字列オプション（CDN の `createFullCache` には残る）
- 引数なし `createCache()`（ドライバ／メソッド未指定）
- 「常に全メソッドを持つ」固定 `Cache` 型

不正な `ttlSeconds` のエラーメッセージは **`ttlSeconds` を含む**こと（現行: `ttlSeconds must be a finite number greater than or equal to 0`）。

メソッド名の重複（同一 `MethodDef.name` を複数渡す）は **`TypeError`**（メッセージに `duplicate method name`）。ストレージへ触らない。

返却オブジェクトは、渡した各 `MethodDef.attach(ctx)` の戻りをマージしたオブジェクト。選んでいないメソッドプロパティは **存在しない**（`undefined` でも「あるが未実装」でもなく、キー自体が無いこと）。

### 実行環境ガード（ブラウザ専用）

モジュール **import 時には throw しない**。

**現行実装**（`src/environment.ts` / 各ドライバ）: 可用性チェックは **`localStorageDriver()` / `indexedDBDriver()` 呼び出し時**の `assertStorageAvailable`。`createCache` 自体はドライバのバックエンド種別を再検査しない（渡された `StorageAdapter` を使う）。

| 条件 | 結果 |
|------|------|
| localStorage ドライバで `globalThis.localStorage` が使えない | **`CachianEnvironmentError`** |
| IndexedDB ドライバで `globalThis.indexedDB` が使えない | **`CachianEnvironmentError`** |
| 上記 API が使える（テスト用 stub / `fake-indexeddb` 含む） | 通常どおり Cache を返す |

「使えない」の定義:

- プロパティが `undefined`
- プロパティ読み取り時に例外（`try/catch`）

`CachianEnvironmentError`:

- `Error` を継承する専用クラス（ルートから export。`instanceof` で判別できること）
- `name` は `"CachianEnvironmentError"`
- メッセージは次を満たすこと:
  - ブラウザ環境が必要である旨が分かる
  - 不足 API 名を含む（localStorage 経路は `localStorage`、IndexedDB 経路は `IndexedDB` または `indexedDB`）

メッセージ例:

```text
cachian requires a browser environment with localStorage
```

```text
cachian requires a browser environment with IndexedDB
```

不正 `ttlSeconds` の `TypeError` と混同しないこと。`enabled: false` は環境非対応の代替にしない。

## エントリ形式

```ts
type CacheEntry = {
  expiresAt: number;
  data: unknown;
  /** 書き込み時刻（エポック ms）。新規 `set` / miss 時 `upsert` では必ず付与。旧データ互換で optional */
  createdAt?: number;
};
```

- 型ガード: `value` が非 null オブジェクトで、`expiresAt` が `number` かつ `"data" in value`（`createdAt` は必須としない）
- 新規 `set`（および miss 時の `upsert`）: `createdAt = Date.now()` を必ず含める
- `update`（および hit 時の `upsert`）: 既存の `createdAt` を維持する（無ければ付与しない）
- localStorage: `JSON.stringify(entry)` を文字列として保存
- IndexedDB: エントリオブジェクトを structured clone で保存
- `get` は呼び出し側に `data` のみ返す（`expiresAt` / `createdAt` は返さない）

## 振る舞い共通契約

### hit / miss

- 未保存キー → `get` は `null`、`has` は `false`
- 有効エントリ → `get` は保存した `data`、`has` は `true`
- `data` は JSON 化可能な値を想定。localStorage 経路では `JSON.parse` 往復後の値と深い等価でよい

### 期限切れ

- `Date.now() >= expiresAt` のエントリは **期限切れ**
- `get` / `has` は期限切れを検知したらストレージから削除し、それぞれ `null` / `false`
- `update` は期限切れを検知したら削除して no-op。`upsert` は削除してから新規 `set` 相当
- 触られない期限切れエントリはストレージに残ってよい（遅延削除）。明示掃除は `purge({ expired: true })`（下記 `{ expired: true }`）
- `ttlSeconds: 0` は「即期限切れになりうる」エントリ。`get` は書き込みと同時刻比較で miss になり得る。許容する

### 壊れたエントリ

次のいずれかをストレージから読んだ場合、削除して miss:

- JSON パース失敗（localStorage）
- 型ガードを満たさないオブジェクト
- IndexedDB 上の非エントリ値

### `enabled: false`

- `get` → 常に `null`（既存エントリがあっても読まない・消さない）
- `has` → 常に `false`
- `set` / `update` / `upsert` / `remove` / `purge` → no-op（ストレージを変更しない）
- `purge` のオプションが不正な場合でも、`enabled: false` なら **バリデーションより先に no-op してよい**。ただし `enabled: true` では不正オプションは必ず `TypeError`

### `purge({ all: true })` の範囲

全削除の正規公開 API は **`purge({ all: true })` のみ**（v0.6.0 で公開 `clear()` は廃止）。

| ドライバ | 削除範囲 |
|----------|----------|
| localStorage | **物理キーが `keyPrefix` で始まるもののみ**。他アプリ・他 prefix のキーは消さない |
| IndexedDB | 当該 `dbName` + `storeName` の object store 全体（ドライバ内部の store `clear` 相当） |

ドライバ層の `StorageAdapter.clear(keyPrefix)` は `purge({ all: true })` の実装に使ってよいが、Cache 公開面には出さない。

### ストレージ不可・書き込み失敗

### 環境非対応（ドライバ生成 / `createCache` 時）

次は **`CachianEnvironmentError`**（miss / no-op にしない）:

- 選んだドライバの `localStorage` / `indexedDB` が未定義
- 可用性チェックで当該 API へのアクセスが throw

### 操作時の失敗（握りつぶし）

API は存在するが個別操作が失敗する場合、例外を外へ投げず miss / no-op:

- `setItem` / IDB put が QuotaExceeded 等で失敗
- IndexedDB の open / upgrade 失敗（生成時チェック通過後の実行時失敗）
- `purge` / 列挙中の読み取り・削除失敗（握りつぶして続行、または全体 no-op。外へは投げない）

### `keyPrefix`

- 物理キー = `keyPrefix + key`（単純連結）
- 異なる prefix のインスタンスは互いに見えない
- `purge({ olderThan })` / 絶対時刻パージ / **`purge({ expired: true })`** の列挙も **自インスタンスの `keyPrefix` 配下のみ**（localStorage）。IndexedDB は store 全件を見て prefix で絞る実装でよい

### `purge` の共通契約

### `{ all: true }`

- `purge({ all: true })` の削除範囲どおり
- 公開 `clear` MethodDef は無い。全削除はこのモードのみ
- `methods: [purge]` のみでも `{ all: true }` は動作する

### `{ keys: string[] }`

- 配列順に各論理キーを物理キーへ変換して削除
- **複数キー削除の正規手段**（`remove` は単一キーのみ — methods: `remove`）
- 空配列 `[]` → no-op（reject しない）
- 重複キーがあっても追加の副作用なし
- 他キーは残す

### `{ olderThan }`

- 期間換算・判定は methods: `olderThan`
- 列挙対象:
  - localStorage: `keyPrefix` で始まる物理キー
  - IndexedDB: 当該 store 内で物理キーが `keyPrefix` で始まるもの（prefix 空なら store 内全件）
- 壊れたエントリは列挙時に削除してスキップしてよい
- `createdAt` 無しの正当なエントリは **残す**
- `createdAt` が閾値より新しいエントリは **残す**

### `{ createdBefore }` / `{ createdAfter }`

- パース・判定は methods: AbsoluteTime / 絶対時刻削除
- 列挙対象・壊れたエントリの扱いは olderThan と同じ列挙範囲（`keyPrefix` 配下）
- `createdAt` 無しの正当なエントリは **残す**
- 境界ちょうど（`===`）のエントリは **残す**
- `olderThan` との混在は methods: モード混在どおり `TypeError`

### `{ expired: true }`

- 判定は `Date.now() >= expiresAt`（`isExpired`）
- 列挙対象・壊れたエントリの扱いは olderThan と同じ列挙範囲（`keyPrefix` 配下）
- `createdAt` 無しの正当なエントリでも、期限切れなら **削除する**（年齢・絶対時刻パージで legacy を残す点と異なる）
- 未期限切れは **残す**（`createdAt` の新旧は問わない）
- 他モード（`all` / `keys` / `olderThan` / `createdBefore` / `createdAfter`）との混在は methods: モード混在どおり `TypeError`

## 関連

- テスト仕様: [`docs/tests/core/`](../../tests/core/)
- ドライバ: [`docs/specs/drivers/`](../drivers/)
- メソッド: [`docs/specs/methods/`](../methods/)
- CI/CD: [`docs/specs/ops/ci-cd.md`](../ops/ci-cd.md)
