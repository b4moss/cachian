# テスト仕様書: `@b4moss/cachian`（汎用ブラウザキャッシュ）

対象マイルストーン: `v0.1.0`（初回公開想定）  
関連: 実装計画（cachian パッケージ） / 抽出元 `b4moss/jp-local-gov-id` の `packages/jp-local-gov-id/src/cache.ts`  
作業ブランチ: `cursor/cache-purge-test-spec-12ec`（パージ API 追記）  
想定実装: リポジトリルートの単一パッケージ（`src/createCache.ts` ほか）

## 1. 目的

`jp-local-gov-id` の localStorage キャッシュロジックを外出し・汎用化した `@b4moss/cachian` の契約を固定する。

- キー・値はドメイン非依存（URL 専用にしない）
- 既定バックエンドは **localStorage**
- オプションで **IndexedDB** に切り替え可能
- 読み書きはすべて **非同期**（`Promise`）
- エントリ形式 `{ expiresAt, data, createdAt? }`・TTL（秒）・無効化・ストレージ不可時の握りつぶしは抽出元と同等
- **パージ API**（全削除 / キー配列削除 / 経過時間削除）で選択的にキャッシュを捨てられる
- **本仕様の直接対象外**: `jp-local-gov-id` への配線、CDN 配信の実行時検証、カスタム `StorageAdapter` の公開

## 2. 用語

| 用語 | 意味 |
|------|------|
| Cache | `createCache()` が返すオブジェクト（`get` / `set` / `remove` / `has` / `clear` / `purge`） |
| バックエンド | `storage: "localStorage"` または `"indexedDB"` |
| エントリ | ストレージに保存する単位。`{ expiresAt: number, data: unknown, createdAt?: number }` |
| `expiresAt` | 期限切れ判定用のエポックミリ秒。`Date.now() >= expiresAt` なら期限切れ |
| `createdAt` | 書き込み時刻のエポックミリ秒。`purge({ olderThan })` の年齢判定に使う。新規 `set` では必須付与 |
| TTL | Time To Live（秒）。`set` 時に `expiresAt = Date.now() + ttlSeconds * 1000` |
| 論理キー | 呼び出し側が渡す `key` 文字列 |
| 物理キー | 実際にストレージへ書くキー。`keyPrefix` がある場合は `keyPrefix + 論理キー` |
| miss | `get` が `null` を返すこと（未保存・期限切れ・壊れたエントリ・無効化・ストレージ不可） |
| no-op | 例外を投げず、状態も変えないこと |
| パージ | `purge(options)` による明示的な一括／選択削除。既存の `clear` / `remove` とは別メソッド |

## 3. 公開 API 契約

### 3.1 定数

| 名前 | 型 | 値 / 制約 |
|------|-----|-----------|
| `DEFAULT_CACHE_TTL_SECONDS` | `number` | `365 * 24 * 60 * 60`（`31536000`） |
| `CACHE_TTL_MS` | `number` | `DEFAULT_CACHE_TTL_SECONDS * 1000`。**deprecated**（互換用再エクスポート可） |

### 3.2 `createCache(options?)` → `Cache`

`CreateCacheOptions`:

| フィールド | 型 | 既定 | 制約 |
|------------|-----|------|------|
| `storage` | `"localStorage"` \| `"indexedDB"` | `"localStorage"` | 上記 2 値のみ |
| `enabled` | `boolean` | `true` | `false` のとき §5.4 |
| `ttlSeconds` | `number` | `DEFAULT_CACHE_TTL_SECONDS` | 有限かつ `>= 0`。不正なら **生成時**に `TypeError` |
| `keyPrefix` | `string` | `""`（未指定時） | 論理キーの前に付与 |
| `dbName` | `string` | `"cachian"` | `storage === "indexedDB"` のときのみ使用 |
| `storeName` | `string` | `"entries"` | 同上 |

不正な `ttlSeconds` のエラーメッセージは `ttlSeconds` または `cacheTtlSeconds` を含む文言でよい（抽出元は `cacheTtlSeconds`）。本パッケージでは **`ttlSeconds` を含む**こと。

### 3.3 `Cache` メソッド

| メソッド | 戻り値 | 概要 |
|----------|--------|------|
| `get(key)` | `Promise<unknown \| null>` | 有効エントリの `data`。miss は `null` |
| `set(key, data, options?)` | `Promise<void>` | エントリを保存。`options.ttlSeconds` はインスタンス既定を上書き可。新規書き込みは `createdAt` を付与 |
| `remove(key)` | `Promise<void>` | 当該物理キーを削除。無ければ no-op |
| `has(key)` | `Promise<boolean>` | 有効エントリがあれば `true`（期限切れは削除して `false`） |
| `clear()` | `Promise<void>` | 本インスタンスが管理する範囲のみ削除（§5.5） |
| `purge(options)` | `Promise<void>` | モード選択によるパージ（§3.5 / §5.8）。既存 `clear` / `remove` は互換のため残す |

`set` の `options.ttlSeconds` が不正な場合は **`TypeError`**（ストレージへ書かない）。

### 3.4 エントリ形式

```ts
type CacheEntry = {
  expiresAt: number;
  data: unknown;
  /** 書き込み時刻（エポック ms）。新規 `set` では必ず付与。旧データ互換で optional */
  createdAt?: number;
};
```

- 型ガード: `value` が非 null オブジェクトで、`expiresAt` が `number` かつ `"data" in value`（`createdAt` は必須としない）
- 新規 `set`: `createdAt = Date.now()` を必ず含める
- localStorage: `JSON.stringify(entry)` を文字列として保存
- IndexedDB: エントリオブジェクトを structured clone で保存（stringify 不要）
- `get` は呼び出し側に `data` のみ返す（`expiresAt` / `createdAt` は返さない）

### 3.5 `purge(options)` — パージ API

呼び出し側が次の **いずれか 1 モード**を選ぶ（判別共用体）。複数モードを同時に指定する形は本仕様の対象外（実装は TypeScript の判別共用体で排他する）。

```ts
type CachePurgeOlderThan = {
  years?: number;
  months?: number;
  hours?: number;
  mins?: number;
  seconds?: number;
};

type CachePurgeOptions =
  | { all: true }
  | { keys: string[] }
  | { olderThan: CachePurgeOlderThan };
```

| モード | オプション | 振る舞い |
|--------|------------|----------|
| すべてパージ | `{ all: true }` | `clear()` と同一の削除範囲（§5.5） |
| キー指定 | `{ keys: string[] }` | 論理キー配列の各要素を `remove` 相当で削除。空配列は no-op。存在しないキーは no-op |
| 経過時間 | `{ olderThan: CachePurgeOlderThan }` | 指定期間より **古い** エントリのみ削除（§5.8.3） |

公開型 `CachePurgeOptions` / `CachePurgeOlderThan` はパッケージから export する。

#### 3.5.1 `olderThan` の期間換算

期間フィールドはすべて **省略可**だが、**少なくとも 1 つ**は指定必須（空オブジェクト `{}` は不正）。

各フィールドの制約: 有限の `number` かつ `>= 0`。不正なら **`TypeError`**（メッセージに `olderThan` または当該フィールド名を含むこと）。ストレージは変更しない。

合算は **固定換算**（カレンダー月・うるう年は使わない。決定的でテストしやすいため）:

| 単位 | 1 単位あたりのミリ秒 |
|------|----------------------|
| `years` | `365 * 24 * 60 * 60 * 1000` |
| `months` | `30 * 24 * 60 * 60 * 1000` |
| `hours` | `60 * 60 * 1000` |
| `mins` | `60 * 1000` |
| `seconds` | `1000` |

```
durationMs =
  (years ?? 0)   * (365 * 24 * 60 * 60 * 1000) +
  (months ?? 0)  * (30 * 24 * 60 * 60 * 1000) +
  (hours ?? 0)   * (60 * 60 * 1000) +
  (mins ?? 0)    * (60 * 1000) +
  (seconds ?? 0) * 1000
```

省略された単位は `0` として扱う。複数単位は加算する（例: `{ hours: 1, mins: 30 }` → 90 分）。

#### 3.5.2 年齢判定

`now = Date.now()` として、エントリを削除する条件:

```
createdAt != null && createdAt <= now - durationMs
```

- `createdAt` が無い旧形式エントリは年齢不明のため **削除しない**
- `durationMs === 0`（例: `{ seconds: 0 }` のみ）は、`createdAt <= now` のエントリ（実質、`createdAt` 付きの全件）を削除対象とする
- 期限切れ（`expiresAt`）とは独立。期限切れでも `createdAt` が新しければ残るし、有効でも古ければ消える
- 戻り値は常に `Promise<void>`（削除件数は返さない）

## 4. テスト方針

実装先の目安:

- `src/createCache.test.ts`（必須）
- 必要に応じて `src/storage/*.test.ts` / `src/entry.test.ts`
- ランナー: Vitest（jp-local-gov-id パッケージと同様）

環境:

- **localStorage**: `vi.stubGlobal("localStorage", …)` の Map ベース stub（抽出元 `api.test.ts` と同型）
- **IndexedDB**: `fake-indexeddb`（devDependency）でインメモリ実装
- 実ブラウザ・実ディスクへの依存なし（CI で決定的に通ること）
- 時刻依存ケースは `vi.useFakeTimers()` / `Date.now` 固定、または書き込み直後の範囲アサーションでよい
- `purge({ olderThan })` は fake timers で年齢差を作る（TC-C19）

対象外（本仕様では必須としない）:

- IIFE/CDN バンドルのブラウザ手動確認
- マルチタブ競合・バージョンアップマイグレーション（`createdAt` 無し旧エントリの一括変換は不要。TC-C20 のとおり残す）
- Quota を実際に満杯にする結合テスト（stub で `setItem` が throw すれば足りる）
- `purge` の削除件数の戻り値や進捗コールバック
- カレンダー月／うるう年に基づく期間換算（固定換算のみ）

## 5. 振る舞い共通契約

### 5.1 hit / miss

- 未保存キー → `get` は `null`、`has` は `false`
- 有効エントリ → `get` は保存した `data`、`has` は `true`
- `data` は JSON 化可能な値を想定（object / array / string / number / boolean / null）。localStorage 経路では `JSON.parse` 往復後の値と深い等価でよい

### 5.2 期限切れ

- `Date.now() >= expiresAt` のエントリは **期限切れ**
- `get` / `has` は期限切れを検知したらストレージから削除し、それぞれ `null` / `false`
- `ttlSeconds: 0` は「即期限切れになりうる」エントリ（`expiresAt === Date.now()` 付近）。`get` は書き込みと同時刻比較で miss になり得る。許容する

### 5.3 壊れたエントリ

次のいずれかをストレージから読んだ場合、削除して miss:

- JSON パース失敗（localStorage）
- 型ガードを満たさないオブジェクト
- IndexedDB 上の非エントリ値

### 5.4 `enabled: false`

- `get` → 常に `null`（既存エントリがあっても読まない・消さない）
- `has` → 常に `false`
- `set` / `remove` / `clear` / `purge` → no-op（ストレージを変更しない）
- `purge` のオプションが不正な場合でも、`enabled: false` なら **バリデーションより先に no-op してよい**（実装都合）。ただし `enabled: true` では不正オプションは必ず `TypeError`

### 5.5 `clear` の範囲

| バックエンド | 削除範囲 |
|--------------|----------|
| localStorage | **物理キーが `keyPrefix` で始まるもののみ**。prefix 空なら、当該アダプタが管理するキー列挙に載るもの。他アプリ・他 prefix のキーは消さない |
| IndexedDB | 当該 `dbName` + `storeName` の object store を `clear()` |

`purge({ all: true })` も本節と同一範囲。

### 5.6 ストレージ不可・書き込み失敗

次の場合、例外を外へ投げず miss / no-op:

- `localStorage` / `indexedDB` が未定義、またはアクセス時に throw
- `setItem` / IDB put が QuotaExceeded 等で失敗
- IndexedDB の open / upgrade 失敗
- `purge` / 列挙中の読み取り・削除失敗（握りつぶして続行、または全体 no-op。外へは投げない）

### 5.7 `keyPrefix`

- 物理キー = `keyPrefix + key`（単純連結。セパレータは呼び出し側が prefix に含めてよい）
- 異なる prefix のインスタンスは互いに見えない
- `purge({ olderThan })` の列挙も **自インスタンスの `keyPrefix` 配下のみ**（localStorage）。IndexedDB は store 全件を見て prefix で絞る実装でよい

### 5.8 `purge` の共通契約

#### 5.8.1 `{ all: true }`

- §5.5 の `clear` と同等
- 既存 `clear()` メソッドは残す（`purge({ all: true })` のエイリアス実装でよい）

#### 5.8.2 `{ keys: string[] }`

- 配列順に各論理キーを物理キーへ変換して削除
- 空配列 `[]` → no-op（reject しない）
- 重複キーがあっても追加の副作用なし（2 回目は no-op）
- 他キーは残す

#### 5.8.3 `{ olderThan }`

- 期間換算・判定は §3.5.1 / §3.5.2
- 列挙対象:
  - localStorage: `keyPrefix` で始まる物理キー
  - IndexedDB: 当該 store 内で物理キーが `keyPrefix` で始まるもの（prefix 空なら store 内全件）
- 壊れたエントリ（型ガード不一致・JSON パース失敗）は列挙時に削除してスキップしてよい（`get` の掃除と同様）。`olderThan` の件数対象には含めない
- `createdAt` 無しの正当なエントリは **残す**
- `createdAt` が閾値より新しいエントリは **残す**
- 削除対象のみ `remove` 相当

## 6. コアケース（TC-C）— バックエンド非依存

両バックエンドで同じ期待になるケース。実装は **localStorage で必須**、IndexedDB でも **同型の代表ケースを再実行**すること（§8）。

### TC-C01: 既定オプションで set → get hit

- **前提**: `createCache()`（引数なし）
- **操作**: `await set("k", { a: 1 })` → `await get("k")`
- **期待**: `{ a: 1 }`（深い等価）
- **期待**: 使用バックエンドは localStorage

### TC-C02: miss

- **前提**: 空ストレージ
- **操作**: `await get("missing")`
- **期待**: `null`
- **期待**: `await has("missing") === false`

### TC-C03: 既定 TTL で `expiresAt` が約 1 年後 / `createdAt` 付与

- **前提**: 固定または記録した `before = Date.now()`
- **操作**: `await set("k", "v")`（ttl 未指定）
- **期待**: 保存エントリの `expiresAt` が `[before + DEFAULT_CACHE_TTL_SECONDS*1000, Date.now() + DEFAULT_CACHE_TTL_SECONDS*1000 + slack]` の範囲（slack は数秒まで可）
- **期待**: 保存エントリの `createdAt` が `[before, Date.now() + slack]` の範囲（新規 `set` では必須）

### TC-C04: インスタンス `ttlSeconds` が set に効く

- **前提**: `createCache({ ttlSeconds: 60 })`
- **操作**: `await set("k", 1)`
- **期待**: `expiresAt` が約 `now + 60_000`

### TC-C05: `set` オプションの `ttlSeconds` がインスタンス既定を上書き

- **前提**: `createCache({ ttlSeconds: 3600 })`
- **操作**: `await set("k", 1, { ttlSeconds: 10 })`
- **期待**: `expiresAt` が約 `now + 10_000`

### TC-C06: 不正なインスタンス `ttlSeconds` → 生成時 TypeError

- **操作**: `createCache({ ttlSeconds: -1 })` および `NaN` / `Infinity`
- **期待**: いずれも `TypeError`（メッセージに `ttlSeconds`）
- **期待**: ストレージへ何も書かない

### TC-C07: 不正な `set` 時 `ttlSeconds` → TypeError

- **前提**: 正当な `createCache()`
- **操作**: `await set("k", 1, { ttlSeconds: -1 })`
- **期待**: `TypeError`
- **期待**: キー `"k"` は未保存のまま

### TC-C08: 期限切れで get が miss かつ削除

- **前提**: エントリを `expiresAt = Date.now() - 1` で直接または fake timer で用意
- **操作**: `await get("k")`
- **期待**: `null`
- **期待**: ストレージから当該キーが消えている
- **期待**: 続く `has("k")` も `false`

### TC-C09: 壊れたエントリを掃除

- **前提**: localStorage に非 JSON 文字列、または `{ expiresAt: "x" }` など不正オブジェクトを物理キーへ配置（IndexedDB なら非エントリ値）
- **操作**: `await get("k")`
- **期待**: `null`、キー削除済み

### TC-C10: `enabled: false`

- **前提**: 事前に別インスタンス（`enabled: true`）で `"k"` を保存済みでもよい
- **操作**: `createCache({ enabled: false })` で `get` / `set` / `remove` / `has` / `clear` / `purge`
- **期待**: `get` → `null`、`has` → `false`
- **期待**: `set` / `remove` / `clear` / `purge({ all: true })` / `purge({ keys: ["k"] })` / `purge({ olderThan: { seconds: 0 } })` 後も、既存ストレージ内容が変わらない（事前データがあれば残る）

### TC-C11: `remove`

- **前提**: `"k"` を保存済み
- **操作**: `await remove("k")` → `await get("k")`
- **期待**: `null`
- **期待**: 存在しないキーの `remove` は reject しない

### TC-C12: `has` は有効時のみ true

- **前提**: 有効エントリと期限切れエントリ
- **期待**: 有効のみ `true`。期限切れは `false` かつ削除

### TC-C13: `keyPrefix` 隔離

- **前提**: `createCache({ keyPrefix: "a:" })` と `createCache({ keyPrefix: "b:" })`
- **操作**: 前者で `set("k", 1)`、後者で `get("k")`
- **期待**: 後者は `null`
- **期待**: localStorage 上の物理キーは `"a:k"`（前者）

### TC-C14: `clear` が prefix 範囲のみ（localStorage） / store 全体（IndexedDB）

- **localStorage**: prefix `"app:"` のインスタンスで `set` したキーだけ消え、prefix なしで置いた他キーは残る
- **IndexedDB**: 同一 `dbName`/`storeName` 内の全エントリが消える。別 `storeName` のインスタンスのデータは残ってよい

### TC-C15: ストレージ未定義でも落ちない

- **前提**: `localStorage` または `indexedDB` を `undefined` に stub（当該バックエンド）
- **操作**: `get` / `set` / `remove` / `has` / `clear` / `purge`
- **期待**: reject せず、`get` は `null`、`set` / `purge` は no-op

### TC-C16: 書き込み失敗を握りつぶす

- **前提**: localStorage の `setItem` が throw（QuotaExceeded 相当）。IndexedDB は put 失敗を stub
- **操作**: `await set("k", hugeOrAny)`
- **期待**: reject しない
- **期待**: 続く `get("k")` は `null`

### TC-C17: `purge({ all: true })` が `clear` 相当

- **前提**: 複数キーを保存済み（localStorage なら他 prefix のキーも用意）
- **操作**: `await purge({ all: true })`
- **期待**: §5.5 / TC-C14 と同じ削除範囲。自インスタンス管理分はすべて miss
- **期待**: reject しない

### TC-C18: `purge({ keys })` が指定キーのみ削除

- **前提**: `"a"` / `"b"` / `"c"` を保存済み
- **操作**: `await purge({ keys: ["a", "c"] })`
- **期待**: `get("a")` / `get("c")` は `null`、`get("b")` は hit
- **期待**: `await purge({ keys: [] })` は no-op（全キー残る）
- **期待**: 存在しないキーを含む配列でも reject しない

### TC-C19: `purge({ olderThan })` が古いエントリのみ削除

- **前提**: `vi.useFakeTimers()` 等で時刻を制御
- **操作**:
  1. `t0` で `set("old", 1)`
  2. 11 分進める
  3. `set("new", 2)`
  4. `await purge({ olderThan: { mins: 10 } })`
- **期待**: `"old"` は miss、`"new"` は hit
- **期待**: 複数単位の合算例として `{ hours: 1, mins: 30 }` も、固定換算どおりに閾値計算されること（代表 1 ケースでよい）

### TC-C20: `olderThan` で `createdAt` 無しの旧エントリは残す

- **前提**: ストレージに `{ expiresAt: farFuture, data: "legacy" }`（`createdAt` 無し）を物理キーへ直接配置。別キーには通常の `set` で古い `createdAt` 付きエントリを用意
- **操作**: `await purge({ olderThan: { seconds: 0 } })`
- **期待**: legacy キーは残る（`get` で hit）
- **期待**: `createdAt` 付きの古いキーは削除される

### TC-C21: 不正な `olderThan` → TypeError

- **前提**: 正当な `createCache()`、事前に `"k"` を保存済みでもよい
- **操作**:
  - `purge({ olderThan: {} })`（期間フィールドなし）
  - `purge({ olderThan: { mins: -1 } })`
  - `purge({ olderThan: { hours: NaN } })`
  - `purge({ olderThan: { years: Infinity } })`
- **期待**: いずれも `TypeError`（メッセージに `olderThan` またはフィールド名）
- **期待**: ストレージ内容は変わらない

## 7. localStorage 固有（TC-LS）

### TC-LS01: 既定バックエンドが localStorage

- **操作**: `createCache()` で `set`
- **期待**: stub した `localStorage.setItem` が呼ばれる（IndexedDB は触らない）

### TC-LS02: 保存値が JSON エントリ文字列

- **操作**: `await set("https://example/data.json", { x: 1 })`
- **期待**: `getItem` で得た文字列を `JSON.parse` すると `{ expiresAt: number, data: { x: 1 }, createdAt: number }`
- **備考**: 抽出元（jp-local-gov-id）互換のキー用法。`createdAt` は本パッケージで追加（旧読取側は未知フィールドを無視できる想定）

### TC-LS03: `clear` が他 prefix を消さない

- §5.5 / TC-C14 の localStorage 詳細。必須

### TC-LS04: `purge({ olderThan })` が他 prefix を消さない

- **前提**: prefix `"app:"` のインスタンスと、prefix なしで置いた他キー（いずれも十分な年齢の `createdAt`）
- **操作**: `app` 側で `purge({ olderThan: { seconds: 0 } })`
- **期待**: `"app:"` 配下の対象のみ削除。他 prefix / 無 prefix のキーは残る

## 8. IndexedDB 固有（TC-IDB）

### TC-IDB01: `storage: "indexedDB"` で hit/miss

- **前提**: `fake-indexeddb` 投入、`createCache({ storage: "indexedDB" })`
- **操作**: TC-C01 / TC-C02 相当
- **期待**: 同様の hit/miss。localStorage は変更されない

### TC-IDB02: 既定 `dbName` / `storeName`

- **期待**: 未指定時データベース名 `"cachian"`、ストア名 `"entries"` で読み書きできる

### TC-IDB03: カスタム `dbName` / `storeName` 隔離

- **前提**: 二つのインスタンスで store 名を変える
- **期待**: 互いに見えない

### TC-IDB04: エントリはオブジェクト保存（非 JSON 文字列）

- **操作**: `set` 後、IDB から直接取得（テストヘルパ可）
- **期待**: 値がオブジェクトであり、文字列の JSON 丸ごとではない（`expiresAt` / `data` / `createdAt` プロパティを持つ）

### TC-IDB05: IndexedDB 不可時の miss / no-op

- TC-C15 の indexedDB 版。必須

### TC-IDB06: 共通ケースの再実行セット

最低限、IndexedDB でも次を通す:

- TC-C04（TTL）
- TC-C08（期限切れ削除）
- TC-C10（enabled: false）
- TC-C11（remove）
- TC-C13（keyPrefix。実装が IDB キーに prefix を載せるなら物理キー、載せないなら論理キー＋別ストアで隔離のどちらでもよいが、**仕様は物理キーへ prefix を載せる**）
- TC-C17（`purge` all）
- TC-C18（`purge` keys）
- TC-C19（`purge` olderThan）
- TC-C20（`createdAt` 無しは残す）
- TC-C21（不正 `olderThan`）

## 9. 公開面・パッケージ（TC-P）

### TC-P01: エントリポイントから必要なシンボルを export

- **期待**: `createCache` / `DEFAULT_CACHE_TTL_SECONDS` /（任意）`CACHE_TTL_MS` および公開型（`Cache` / `CacheEntry` / `CacheSetOptions` / `CreateCacheOptions` / `StorageBackend` / `CachePurgeOptions` / `CachePurgeOlderThan`）が `@b4moss/cachian` から import できる
- ビルド後 `dist` の types でも同様（`npm run build` 後の型チェック、または dts 生成物の存在確認）

### TC-P02: ランタイム依存ゼロ

- **期待**: `package.json` の `dependencies` が空（または無し）。`fake-indexeddb` は `devDependencies` のみ

## 10. 受け入れ条件

1. §6 の TC-C（TC-C17〜TC-C21 のパージ系を含む）を localStorage ですべてパス
2. §7 の TC-LS（TC-LS04 を含む）をパス
3. §8 の TC-IDB をパス（§8.6 の再実行セット含む）
4. §9 の TC-P をパス
5. `npm test` および `npm run build` が CI / ローカルで成功

## 11. トレーサビリティ（抽出元）

| 抽出元（jp-local-gov-id） | cachian |
|--------------------------|---------|
| `getCachedData(url, { enabled })` | `cache.get(key)`（`enabled` はインスタンスオプション） |
| `setCachedData(url, data, { enabled, ttlSeconds })` | `cache.set(key, data, { ttlSeconds })` |
| `DEFAULT_CACHE_TTL_SECONDS` / `CACHE_TTL_MS` | 同名エクスポート |
| localStorage のみ | + `storage: "indexedDB"` |
| 同期 API | 非同期 API |
| URL キー前提のコメント | 任意文字列キー |
| （なし） | `cache.purge({ all \| keys \| olderThan })` |
| （なし） | エントリの `createdAt`（新規書き込み） |

本仕様は cachian 単体の契約であり、`createLocalGovClient` のオプション名（`cache` / `cacheTtlSeconds`）の互換は **jp-local-gov-id 配線時の別仕様**とする。
