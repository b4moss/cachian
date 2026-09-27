# テスト仕様: core（組み立て・共通振る舞い・パッケージ面）

対象マイルストーン: `v0.6.0`  
ドメイン: `core`（specs と同じ切り）。ドライバ固有は [`../drivers/`](../drivers/)、メソッド固有は [`../methods/`](../methods/)。  
正本の API 契約: [`docs/specs/core/`](../../specs/core/)

### 破壊的変更サマリ（v0.6.0）

| 旧 API | 新 API |
|--------|--------|
| `cache.clear()` / `@b4moss/cachian/methods/clear` | `cache.purge({ all: true })`（`methods/purge`） |
| 複数キーを `remove` で削除しようとすること | `remove(key)` は単一キーのみ。複数は `purge({ keys })` |

## 1. 目的（core）

`jp-local-gov-id` の localStorage キャッシュロジックを外出し・汎用化した `@b4moss/cachian` の契約を固定する。

- キー・値はドメイン非依存（URL 専用にしない）
- **ドライバ**（localStorage / IndexedDB）と **メソッド**（`get` / `set` / …）を分割し、利用側が必要なものだけを import・組み立てる
- 読み書きはすべて **非同期**（`Promise`）
- **ブラウザ専用**: 選んだドライバの API が無い環境ではドライバ生成（または `createCache`）が失敗する（§3.3 / §5.6.1）
- エントリ形式 `{ expiresAt, data, createdAt? }`・TTL（秒）・無効化・**操作時**のストレージ失敗握りつぶしは v0.3 系と同等
- **削除 API の役割分担**（v0.6.0）:
  - 単一キー削除 → `methods/remove`（引数はキー名 1 つのみ）
  - 複数キー / 条件付き / 全削除 → `methods/purge`（`{ keys }` / `{ all: true }` / その他モード）
- **パージ API**（全削除 / キー配列削除 / 経過時間削除 / 絶対時刻削除 / 期限切れ一括削除）は `methods/purge` を選んだときのみ利用可能
- **公開 `clear` MethodDef は廃止**（v0.6.0）。全削除は `purge({ all: true })` へ移譲する。ドライバ内部の `StorageAdapter.clear` は実装詳細として残してよい
- **本仕様の直接対象外**: `jp-local-gov-id` への配線、CDN 配信の実行時検証、利用側による任意カスタムドライバの公開保証（内部 `StorageAdapter` 形状は実装詳細）

## 2. 用語

| 用語 | 意味 |
|------|------|
| Cache | `createCache({ driver, methods })` が返すオブジェクト。付くメソッドは渡した `methods` のみ |
| Driver | ストレージ実装。`localStorageDriver()` / `indexedDBDriver()` が返すアダプタ |
| MethodDef | メソッド定義オブジェクト。`attach(ctx)` で Cache にメソッドを生やす |
| CacheContext | core が保持する共有状態（`enabled` / `keyPrefix` / TTL / 物理キー変換 / 読み書きヘルパ / driver） |
| エントリ | ストレージに保存する単位。`{ expiresAt: number, data: unknown, createdAt?: number }` |
| `expiresAt` | 期限切れ判定用のエポックミリ秒。`Date.now() >= expiresAt` なら期限切れ。遅延削除（`get` / `has` 等）および `purge({ expired: true })` で参照する |
| `createdAt` | 書き込み時刻のエポックミリ秒。`purge({ olderThan })` および絶対時刻パージの年齢判定に使う。新規 `set` / miss 時 `upsert` では必須付与。`update` / hit 時 `upsert` では維持。**`purge({ expired: true })` では参照しない** |
| TTL | Time To Live（秒）。`set` 時に `expiresAt = Date.now() + ttlSeconds * 1000` |
| 絶対時刻 | `purge` の `createdBefore` / `createdAfter` に渡す時刻。ISO 8601 文字列、またはエポック秒／ミリ秒の数値（§3.7.3） |
| 論理キー | 呼び出し側が渡す `key` 文字列 |
| 物理キー | 実際にストレージへ書くキー。`keyPrefix` がある場合は `keyPrefix + 論理キー` |
| miss | `get` が `null` を返すこと（未保存・期限切れ・壊れたエントリ・無効化・操作時のストレージ失敗） |
| no-op | 例外を投げず、状態も変えないこと |
| 環境非対応 | 選んだドライバ API が `undefined`、または可用性チェックでアクセスできないこと（サーバー等）。`CachianEnvironmentError` を投げる |

## 3. テスト方針

実装先の目安:

- `src/createCache.test.ts` または `src/core/createCache.test.ts`（必須）
- 必要に応じて drivers / methods / entry の単体テスト
- ランナー: Vitest

テストヘルパ（推奨）:

```ts
import { createCache } from "@b4moss/cachian";
import { localStorageDriver } from "@b4moss/cachian/drivers/localStorage";
import { indexedDBDriver } from "@b4moss/cachian/drivers/indexedDB";
import { get } from "@b4moss/cachian/methods/get";
import { set } from "@b4moss/cachian/methods/set";
// ... 他メソッド

const ALL_METHODS = [get, set, update, upsert, remove, has, purge] as const;

function createTestCache(
  options: Omit<CreateCacheOptions, "driver" | "methods"> & {
    driver?: StorageAdapter;
    methods?: MethodDef[];
  } = {},
) {
  const { driver, methods, ...rest } = options;
  return createCache({
    driver: driver ?? localStorageDriver(),
    methods: methods ?? [...ALL_METHODS],
    ...rest,
  });
}
```

環境:

- **localStorage**: `vi.stubGlobal("localStorage", …)` の Map ベース stub
- **IndexedDB**: `fake-indexeddb`（devDependency）でインメモリ実装
- 実ブラウザ・実ディスクへの依存なし
- 時刻依存ケースは `vi.useFakeTimers()` / `Date.now` 固定、または書き込み直後の範囲アサーション
- `purge({ olderThan })` は fake timers で年齢差を作る（TC-C19）
- 絶対時刻パージは固定の `createdAt` をストレージへ直接配置するか、fake timers でよい（TC-C27〜）
- `purge({ expired: true })` は `expiresAt` を過去／未来に直接配置するか、fake timers でよい（TC-C36〜）

対象外（本仕様では必須としない）:

- IIFE/CDN バンドルのブラウザ手動確認
- マルチタブ競合・旧エントリの一括マイグレーション
- Quota を実際に満杯にする結合テスト（stub で `setItem` が throw すれば足りる）
- `purge` の削除件数の戻り値や進捗コールバック
- `purge({ expired: true })` のバックグラウンド／定期自動実行
- カレンダー月／うるう年に基づく期間換算
- ISO 8601 の全亜種
- `update` が「存在しないキーで throw する」契約（本仕様は no-op）
- バンドラ実機でのツリーシェイクバイト数の CI 固定（§9 のパッケージ面・任意のサイズスモークは別）

## 4. 振る舞い共通契約（参照）

契約の正本は [`docs/specs/core/`](../../specs/core/)。以下はテスト観点の再掲。

### hit / miss

- 未保存キー → `get` は `null`、`has` は `false`
- 有効エントリ → `get` は保存した `data`、`has` は `true`
- `data` は JSON 化可能な値を想定。localStorage 経路では `JSON.parse` 往復後の値と深い等価でよい

### 期限切れ

- `Date.now() >= expiresAt` のエントリは **期限切れ**
- `get` / `has` は期限切れを検知したらストレージから削除し、それぞれ `null` / `false`
- `update` は期限切れを検知したら削除して no-op。`upsert` は削除してから新規 `set` 相当
- 触られない期限切れエントリはストレージに残ってよい（遅延削除）。明示掃除は `purge({ expired: true })`（§3.7.6）
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

- §5.5 の削除範囲どおり
- 公開 `clear` MethodDef は無い。全削除はこのモードのみ
- `methods: [purge]` のみでも `{ all: true }` は動作する

### `{ keys: string[] }`

- 配列順に各論理キーを物理キーへ変換して削除
- **複数キー削除の正規手段**（`remove` は単一キーのみ — §3.5.1）
- 空配列 `[]` → no-op（reject しない）
- 重複キーがあっても追加の副作用なし
- 他キーは残す

### `{ olderThan }`

- 期間換算・判定は §3.7.1 / §3.7.2
- 列挙対象:
  - localStorage: `keyPrefix` で始まる物理キー
  - IndexedDB: 当該 store 内で物理キーが `keyPrefix` で始まるもの（prefix 空なら store 内全件）
- 壊れたエントリは列挙時に削除してスキップしてよい
- `createdAt` 無しの正当なエントリは **残す**
- `createdAt` が閾値より新しいエントリは **残す**

### `{ createdBefore }` / `{ createdAfter }`

- パース・判定は §3.7.3 / §3.7.5
- 列挙対象・壊れたエントリの扱いは §5.8.3 と同じ
- `createdAt` 無しの正当なエントリは **残す**
- 境界ちょうど（`===`）のエントリは **残す**
- `olderThan` との混在は §3.7.4 のとおり `TypeError`

### `{ expired: true }`

- 判定は §3.7.6（`Date.now() >= expiresAt`）
- 列挙対象・壊れたエントリの扱いは §5.8.3 と同じ
- `createdAt` 無しの正当なエントリでも、期限切れなら **削除する**（§5.8.3 / §5.8.4 と異なる点）
- 未期限切れは **残す**（`createdAt` の新旧は問わない）
- 他モード（`all` / `keys` / `olderThan` / `createdBefore` / `createdAfter`）との混在は §3.7.4 のとおり `TypeError`

## 5. 組み立て・モジュール面（TC-M）

### TC-M01: `methods` 空配列は TypeError

- **操作**: `createCache({ driver: localStorageDriver(), methods: [] })`
- **期待**: `TypeError`
- **期待**: ストレージへ書き込まない

### TC-M02: メソッド名重複は TypeError

- **操作**: `createCache({ driver: localStorageDriver(), methods: [get, get] })`
- **期待**: `TypeError`（メッセージにメソッド名または `duplicate` 相当が分かるとよい）

### TC-M03: 選んだメソッドだけがインスタンスに付く

- **操作**: `createCache({ driver: localStorageDriver(), methods: [get, set, remove] })`
- **期待**: `typeof cache.get/set/remove === "function"`
- **期待**: `"purge" in cache === false`（および `update` / `upsert` / `has` も同様に無し）
- **期待**: `"clear" in cache === false`（公開 `clear` は v0.6.0 で廃止済みのため、どの `methods` 組み合わせでも付かない）

### TC-M04: ルートから drivers / methods を import できない

- **操作**: `@b4moss/cachian` から `localStorageDriver` / `get` 等を import（型チェックまたは実行時の export 列挙）
- **期待**: ルートの公開 export に含まれない（サブパスからのみ取得可能）

### TC-M05: サブパスから個別に import できる

- **操作**: 各 `@b4moss/cachian/drivers/*` / `@b4moss/cachian/methods/{get,set,update,upsert,remove,has,purge}` から該当シンボルを import
- **期待**: いずれも関数（または MethodDef オブジェクト）として取得できる
- **期待**: `@b4moss/cachian/methods/clear` は package exports に存在しない（TC-P02）

### TC-M06: `get` + `set` + `remove` のみで基本読み書きができる

- **前提**: `methods: [get, set, remove]`
- **操作**: `set` → `get` hit → `remove` → `get` miss
- **期待**: フルメソッド組み立てと同じ hit/miss / 削除結果

## 6. コアケース（TC-C）— ドライバ非依存

特記なき限り、テストヘルパで **localStorage ドライバ + 全 MethodDef** を組み立てる。IndexedDB でも同型の代表ケースを再実行すること（§9）。

### TC-C01: 既定オプションで set → get hit

- **前提**: `createTestCache()`（localStorage）
- **操作**: `await set("k", { a: 1 })` → `await get("k")`
- **期待**: `{ a: 1 }`（深い等価）
- **期待**: 使用ドライバは localStorage

### TC-C02: miss

- **前提**: 空ストレージ
- **操作**: `await get("missing")`
- **期待**: `null`
- **期待**: `await has("missing") === false`

### TC-C03: 既定 TTL で `expiresAt` が約 1 年後 / `createdAt` 付与

- **前提**: 固定または記録した `before = Date.now()`
- **操作**: `await set("k", "v")`（ttl 未指定）
- **期待**: 保存エントリの `expiresAt` が `[before + DEFAULT_CACHE_TTL_SECONDS*1000, Date.now() + DEFAULT_CACHE_TTL_SECONDS*1000 + slack]` の範囲
- **期待**: 保存エントリの `createdAt` が `[before, Date.now() + slack]` の範囲

### TC-C04: インスタンス `ttlSeconds` が set に効く

- **前提**: `createTestCache({ ttlSeconds: 60 })`
- **操作**: `await set("k", 1)`
- **期待**: `expiresAt` が約 `now + 60_000`

### TC-C05: `set` オプションの `ttlSeconds` がインスタンス既定を上書き

- **前提**: `createTestCache({ ttlSeconds: 3600 })`
- **操作**: `await set("k", 1, { ttlSeconds: 10 })`
- **期待**: `expiresAt` が約 `now + 10_000`

### TC-C06: 不正なインスタンス `ttlSeconds` → 生成時 TypeError

- **操作**: `createTestCache({ ttlSeconds: -1 })` および `NaN` / `Infinity`
- **期待**: いずれも `TypeError`（メッセージに `ttlSeconds`）
- **期待**: ストレージへ何も書かない

### TC-C07: 不正な `set` 時 `ttlSeconds` → TypeError

- **前提**: 正当な `createTestCache()`
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
- **操作**: `createTestCache({ enabled: false })` で `get` / `set` / `update` / `upsert` / `remove` / `has` / `purge`（`purge({ all: true })` および代表的な他モードを含む）
- **期待**: `get` → `null`、`has` → `false`
- **期待**: 書き込み系・削除系のあとでも、既存ストレージ内容が変わらない

### TC-C11: `remove`（単一キーのみ）

- **前提**: `"k"` を保存済み。`methods` に `remove` を含む
- **操作**: `await remove("k")` → `await get("k")`
- **期待**: `null`
- **期待**: 存在しないキーの `remove` は reject しない
- **期待（契約）**: 公開シグネチャは `remove(key: string)`。複数キー削除は `purge({ keys })`（TC-C18）であり、`remove` の責務外

### TC-C12: `has` は有効時のみ true

- **前提**: 有効エントリと期限切れエントリ
- **期待**: 有効のみ `true`。期限切れは `false` かつ削除

### TC-C13: `keyPrefix` 隔離

- **前提**: `createTestCache({ keyPrefix: "a:" })` と `createTestCache({ keyPrefix: "b:" })`
- **操作**: 前者で `set("k", 1)`、後者で `get("k")`
- **期待**: 後者は `null`
- **期待**: localStorage 上の物理キーは `"a:k"`（前者）

### TC-C14: `purge({ all: true })` が prefix 範囲のみ（localStorage） / store 全体（IndexedDB）

- **前提**: `methods` に `purge` を含む（公開 `clear` は使わない）
- **localStorage**: prefix `"app:"` のインスタンスで `set` したキーだけ消え、prefix なしで置いた他キーは残る
- **IndexedDB**: 同一 `dbName`/`storeName` 内の全エントリが消える。別 `storeName` のインスタンスのデータは残ってよい
- **操作**: `await purge({ all: true })`

### TC-C15: localStorage 未定義なら環境エラー

- **前提**: `globalThis.localStorage` を `undefined` に stub（または削除）
- **操作**: `localStorageDriver()` またはそれを使う `createCache`
- **期待**: `CachianEnvironmentError`（`instanceof` 可）。メッセージに `localStorage` を含み、ブラウザ環境が必要である旨が分かる
- **期待**: ストレージへ一切書き込まない

### TC-C16: 書き込み失敗を握りつぶす（§5.6.2）

- **前提**: 生成は成功済み。localStorage の `setItem` が throw（QuotaExceeded 相当）。IndexedDB は put 失敗を stub
- **操作**: `await set("k", hugeOrAny)`
- **期待**: reject しない
- **期待**: 続く `get("k")` は `null`

### TC-C17: `purge({ all: true })` が自インスタンス管理分をすべて削除する

- **前提**: 複数キーを保存済み（localStorage なら他 prefix のキーも用意）。`methods` に `purge` を含む
- **操作**: `await purge({ all: true })`
- **期待**: §5.5 / TC-C14 と同じ削除範囲。自インスタンス管理分はすべて miss
- **期待**: reject しない
- **備考**: v0.6.0 以前の公開 `clear()` と同等の範囲を、本モードが正規に担う

### TC-C18: `purge({ keys })` が指定キーのみ削除

- **前提**: `"a"` / `"b"` / `"c"` を保存済み
- **操作**: `await purge({ keys: ["a", "c"] })`
- **期待**: `get("a")` / `get("c")` は `null`、`get("b")` は hit
- **期待**: `await purge({ keys: [] })` は no-op
- **期待**: 存在しないキーを含む配列でも reject しない
- **備考**: 複数キー削除は本モードが正規手段（`remove` は単一キーのみ — TC-C11）

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

- **前提**: 正当な `createTestCache()`、事前に `"k"` を保存済みでもよい
- **操作**:
  - `purge({ olderThan: {} })`
  - `purge({ olderThan: { mins: -1 } })`
  - `purge({ olderThan: { hours: NaN } })`
  - `purge({ olderThan: { years: Infinity } })`
- **期待**: いずれも `TypeError`（メッセージに `olderThan` またはフィールド名）
- **期待**: ストレージ内容は変わらない

### TC-C22: `update` が `createdAt` を維持し data を更新

- **前提**: `set` 済みキー
- **操作**: `await update("k", newData)`
- **期待**: `get` は `newData`
- **期待**: 保存エントリの `createdAt` は更新前と同一
- **期待**: `ttlSeconds` 未指定なら `expiresAt` も同一

### TC-C23: `update` で `ttlSeconds` 指定時は `expiresAt` のみ更新

- **前提**: `set` 済みキー
- **操作**: `await update("k", data, { ttlSeconds: 10 })`
- **期待**: `createdAt` 維持、`expiresAt` は約 `now + 10_000`

### TC-C24: `update` は miss / 期限切れで no-op

- **操作**: 未保存キーおよび期限切れキーに `update`
- **期待**: reject しない。新規エントリは書かない。期限切れは削除してよい

### TC-C25: `upsert` は miss→set / hit→update

- **操作**: miss で `upsert` したあと hit で `upsert`
- **期待**: miss 時は新規 `createdAt` / `expiresAt`。hit 時は `createdAt` 維持

### TC-C26: `set` は既存キーでも `createdAt` / `expiresAt` を再生成

- **前提**: 既存キー
- **操作**: 再度 `set`
- **期待**: `createdAt` / `expiresAt` が新しい値になる

### TC-C27: `purge({ createdBefore })` が閾値より前のみ削除

- **前提**: 異なる `createdAt` の複数エントリを配置
- **操作**: `await purge({ createdBefore: "2024-06-01T00:00:00.000Z" })`
- **期待**: 閾値より前のみ miss。境界ちょうどおよび後は残る

### TC-C28: `purge({ createdAfter })` および範囲

- **操作**: `createdAfter` 単独、および `createdBefore` + `createdAfter` の範囲
- **期待**: §3.7.5 の厳密不等号どおり

### TC-C29: `AbsoluteTime` が ISO / 秒 / ミリ秒を解釈する

- **操作**: ISO 文字列、ミリ秒エポック、秒エポック（`|value| < 1e12`）で `createdBefore` / `createdAfter`
- **期待**: それぞれ正しく閾値化され、意図したキーだけ削除される
- **期待**: 不正文字列 / `NaN` / `Infinity` は `TypeError`

### TC-C30: 絶対時刻パージで `createdAt` 無しは残す

- **前提**: legacy（`createdAt` 無し）と dated エントリ
- **操作**: 広い `createdBefore`
- **期待**: legacy は残る、dated は条件に応じて削除

### TC-C31: `olderThan` と絶対時刻の混在は TypeError

- **操作**: `olderThan` と `createdBefore` / `createdAfter` を同時指定
- **期待**: `TypeError`。ストレージ不変

### TC-C32: 不正な `update` / `upsert` の `ttlSeconds` → TypeError

- **前提**: 正当なインスタンス、キー保存済みでもよい
- **操作**: `update` / `upsert` に `ttlSeconds: -1` 等
- **期待**: `TypeError`（メッセージに `ttlSeconds`）。ストレージ不変

### TC-C33: import だけでは throw しない

- **前提**: `localStorage` / `indexedDB` が未定義の環境（Node 相当）でもよい
- **操作**: ルートおよびサブパスのモジュールを import（`createCache` / ドライバ関数を**呼ばない**）
- **期待**: モジュール評価は成功する

### TC-C34: localStorage アクセス時 throw も環境非対応

- **前提**: `localStorage` のゲッターが throw するよう stub
- **操作**: `localStorageDriver()` またはそれを使う `createCache`
- **期待**: `CachianEnvironmentError`（メッセージに `localStorage`）

### TC-C35: API がある環境では生成できる

- **前提**: Map ベースの `localStorage` stub。IndexedDB は `fake-indexeddb` 投入後
- **操作**: `localStorageDriver()` + 全 methods、および `indexedDBDriver()` + 全 methods
- **期待**: throw せず Cache を返す。続く `set` / `get` は TC-C01 等どおり

### TC-C36: `purge({ expired: true })` が期限切れのみ削除

- **前提**: 期限切れエントリ（`expiresAt = Date.now() - 1`、`createdAt` 付き）と、未来の `expiresAt` を持つ有効エントリを配置
- **操作**: `await purge({ expired: true })`
- **期待**: 期限切れキーのみストレージから消える。有効キーは `get` で hit のまま
- **期待**: 戻り値は `undefined`（`Promise<void>`）

### TC-C37: `purge({ expired: true })` は `createdAt` 無しの期限切れも削除

- **前提**: `{ expiresAt: Date.now() - 1, data: "legacy" }`（`createdAt` 無し）と、未来の `expiresAt` を持つ有効エントリ
- **操作**: `await purge({ expired: true })`
- **期待**: legacy 期限切れは削除。有効エントリは残る
- **補足**: TC-C20 / TC-C30（年齢・絶対時刻パージで legacy を残す）と対になる契約

### TC-C38: `purge({ expired: true })` は未期限切れのみなら no-op

- **前提**: すべて `expiresAt` が未来のエントリのみ
- **操作**: `await purge({ expired: true })`
- **期待**: ストレージ不変。各キーは hit

### TC-C39: `expired` と他モードの混在は TypeError

- **操作**: 次をそれぞれ実行（型上不正なのでテストでは `as never` 等で渡してよい）
  - `purge({ expired: true, all: true })`
  - `purge({ expired: true, keys: ["a"] })`
  - `purge({ expired: true, olderThan: { seconds: 1 } })`
  - `purge({ expired: true, createdBefore: "2024-01-01T00:00:00.000Z" })`
  - `purge({ expired: true, createdAfter: 0 })`
- **期待**: いずれも `TypeError`（メッセージに `expired`）。ストレージ不変

### TC-C40: `enabled: false` で `purge({ expired: true })` は no-op

- **前提**: 期限切れエントリがストレージに存在する。`createTestCache({ enabled: false })`
- **操作**: `await purge({ expired: true })`
- **期待**: ストレージ不変（期限切れも消えない）

## 7. 公開面・パッケージ（TC-P）

### TC-P01: ルートから必要なシンボルを export

- **期待**: `createCache` / `CachianEnvironmentError` / `DEFAULT_CACHE_TTL_SECONDS` /（任意）`CACHE_TTL_MS` および共通公開型が `@b4moss/cachian` から import できる
- **期待**: ルートから `localStorageDriver` / `get` 等は export されない（TC-M04）
- ビルド後 `dist` の types でも同様

### TC-P02: サブパス exports が package.json に定義されている

- **期待**: `exports` に `.` / `./drivers/localStorage` / `./drivers/indexedDB` / `./methods/{get,set,update,upsert,remove,has,purge}` がある
- **期待**: `./methods/clear` は **無い**（v0.6.0 で廃止）
- **期待**: 各エントリに `types` / `import`（および CJS を維持するなら `require`）が解決できる

### TC-P03: `sideEffects: false`

- **期待**: `package.json` に `"sideEffects": false` がある

### TC-P04: ランタイム依存ゼロ

- **期待**: `package.json` の `dependencies` が空（または無し）。`fake-indexeddb` は `devDependencies` のみ

## 8. 受け入れ条件（core 関連）

1. §6 の TC-M をパス
2. §7 の TC-C を localStorage（公開 7 MethodDef）ですべてパス（TC-C36〜TC-C40 を含む）
3. §8 の TC-LS をパス（TC-LS06 を含む）
4. §9 の TC-IDB をパス（TC-IDB05 の環境ガード、および TC-IDB06 の再実行セットを含む）
5. §10 の TC-P をパス（`methods/clear` が exports に無いこと含む）
6. `npm test` および `npm run build` が CI / ローカルで成功
7. v0.4 破壊的変更（組み立て必須・`storage` 文字列廃止・ルートからの drivers/methods 非再エクスポート）の契約を維持する
8. v0.5.0 の `purge({ expired: true })` の意味を変えないこと
9. **v0.6.0 破壊的変更**: 公開 `clear` MethodDef / `@b4moss/cachian/methods/clear` を廃止し、全削除は `purge({ all: true })` へ移譲すること。`remove` は単一キーのみ（複数キーは `purge({ keys })`）
10. （推奨）localStorage + `get`/`set`/`remove` のみの minify サイズが、旧フル一体バンドルより明確に小さいこと

## 9. トレーサビリティ

| 抽出元 / 旧 cachian (v0.3) | v0.4 / v0.5 / v0.6 |
|----------------------------|-------------------|
| `createCache()` 引数なし・全メソッド | `createCache({ driver, methods })` 必須組み立て |
| `storage: "localStorage"` | `localStorageDriver()` |
| `storage: "indexedDB", dbName, storeName` | `indexedDBDriver({ dbName, storeName })` |
| 固定 `Cache` 全メソッド | 選んだ MethodDef の交差型 |
| `getCachedData` / `setCachedData`（jp-local-gov-id） | `cache.get` / `cache.set` |
| `DEFAULT_CACHE_TTL_SECONDS` / `CACHE_TTL_MS` | 同名（ルート） |
| 同期 API（抽出元） | 非同期 API |
| （なし） | サブパス分割 + `sideEffects: false` |
| 環境非対応時 | `CachianEnvironmentError`（ドライバ生成時または `createCache` 時） |
| 期限切れは操作時の遅延削除のみ | 同左 + **`purge({ expired: true })`（v0.5.0）** |
| 公開 `clear()`（v0.5 まで） | **廃止（v0.6.0）** → `purge({ all: true })` |
| 単一キー削除 | `remove(key)`（v0.6.0 でも単一キーのみを明示） |
| 複数キー削除 | `purge({ keys })`（`remove` の責務外） |

本仕様は cachian 単体の契約であり、`createLocalGovClient` のオプション名の互換は **jp-local-gov-id 配線時の別仕様**とする。

## 関連仕様

- [`docs/specs/core/`](../../specs/core/)
- [`docs/tests/drivers/`](../drivers/)
- [`docs/tests/methods/`](../methods/)
