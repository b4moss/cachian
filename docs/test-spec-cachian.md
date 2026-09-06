# テスト仕様書: `@b4moss/cachian`（汎用ブラウザキャッシュ）

対象マイルストーン: `v0.5.0`（`purge({ expired: true })` — TTL 期限切れの明示一括掃除）  
関連: [#32](https://github.com/b4moss/cachian/issues/32) / 抽出元 `b4moss/jp-local-gov-id` のキャッシュロジック / モジュール化（core + drivers + methods）  
作業ブランチ: `cursor/purge-expired-option-3fbc`  
想定実装: リポジトリルートの単一パッケージ（`src/core/*` / `src/drivers/*` / `src/methods/*` ほか）  
前提: `v0.4.0` のドライバ／メソッド分割契約を継承し、本版は **非破壊のオプション追加**

## 1. 目的

`jp-local-gov-id` の localStorage キャッシュロジックを外出し・汎用化した `@b4moss/cachian` の契約を固定する。

- キー・値はドメイン非依存（URL 専用にしない）
- **ドライバ**（localStorage / IndexedDB）と **メソッド**（`get` / `set` / …）を分割し、利用側が必要なものだけを import・組み立てる
- 読み書きはすべて **非同期**（`Promise`）
- **ブラウザ専用**: 選んだドライバの API が無い環境ではドライバ生成（または `createCache`）が失敗する（§3.3 / §5.6.1）
- エントリ形式 `{ expiresAt, data, createdAt? }`・TTL（秒）・無効化・**操作時**のストレージ失敗握りつぶしは v0.3 系と同等
- **パージ API**（全削除 / キー配列削除 / 経過時間削除 / 絶対時刻削除 / **期限切れ一括削除**）は `methods/purge` を選んだときのみ利用可能
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

## 3. 公開 API 契約

### 3.1 パッケージエントリ（サブパス）

| サブパス | 主な export | 備考 |
|----------|-------------|------|
| `@b4moss/cachian` | `createCache`, `CachianEnvironmentError`, `DEFAULT_CACHE_TTL_SECONDS`, `CACHE_TTL_MS`（deprecated）, 共通型 | **drivers / methods は再エクスポートしない** |
| `@b4moss/cachian/drivers/localStorage` | `localStorageDriver` | |
| `@b4moss/cachian/drivers/indexedDB` | `indexedDBDriver` | |
| `@b4moss/cachian/methods/get` | `get` | MethodDef |
| `@b4moss/cachian/methods/set` | `set` | MethodDef |
| `@b4moss/cachian/methods/update` | `update` | MethodDef |
| `@b4moss/cachian/methods/upsert` | `upsert` | MethodDef |
| `@b4moss/cachian/methods/remove` | `remove` | MethodDef |
| `@b4moss/cachian/methods/has` | `has` | MethodDef |
| `@b4moss/cachian/methods/clear` | `clear` | MethodDef |
| `@b4moss/cachian/methods/purge` | `purge` | MethodDef |

CDN（IIFE）は別エントリで両ドライバ + 全メソッドを束ねてよい（npm のツリーシェイク対象外）。本仕様の TC 必須対象は npm / ソースのサブパス契約とする。

### 3.2 定数

| 名前 | 型 | 値 / 制約 |
|------|-----|-----------|
| `DEFAULT_CACHE_TTL_SECONDS` | `number` | `365 * 24 * 60 * 60`（`31536000`） |
| `CACHE_TTL_MS` | `number` | `DEFAULT_CACHE_TTL_SECONDS * 1000`。**deprecated**（互換用再エクスポート可） |

### 3.3 `createCache(options)` → 交差型 Cache

`CreateCacheOptions`:

| フィールド | 型 | 既定 | 制約 |
|------------|-----|------|------|
| `driver` | `StorageAdapter`（ドライバ戻り値） | （なし） | **必須** |
| `methods` | `MethodDef[]` | （なし） | **必須**。長さ 1 以上。空配列は型・実行時とも拒否（`TypeError`） |
| `enabled` | `boolean` | `true` | `false` のとき §5.4 |
| `ttlSeconds` | `number` | `DEFAULT_CACHE_TTL_SECONDS` | 有限かつ `>= 0`。不正なら **生成時**に `TypeError` |
| `keyPrefix` | `string` | `""` | 論理キーの前に付与 |

削除（v0.3 系からの破壊的変更）:

- `storage: "localStorage" | "indexedDB"` 文字列オプション
- 引数なし `createCache()`（ドライバ／メソッド未指定）
- 「常に全メソッドを持つ」固定 `Cache` 型

不正な `ttlSeconds` のエラーメッセージは **`ttlSeconds` を含む**こと。

メソッド名の重複（同一 `MethodDef.name` を複数渡す）は **`TypeError`**。ストレージへ触らない。

返却オブジェクトは、渡した各 `MethodDef.attach(ctx)` の戻りをマージしたオブジェクト。選んでいないメソッドプロパティは **存在しない**（`undefined` でも「あるが未実装」でもなく、キー自体が無いこと）。

### 3.3.1 実行環境ガード（ブラウザ専用）

モジュール **import 時には throw しない**。可用性チェックは次のいずれか（実装はどちらでもよいが、ストレージへ触る前に失敗すること）:

- 各 `*Driver()` 呼び出し時
- `createCache({ driver })` 時（driver が持つバックエンド種別に基づく）

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

### 3.4 ドライバ

#### 3.4.1 `localStorageDriver()`

- 引数なし
- localStorage が使えなければ `CachianEnvironmentError`（§3.3.1）
- エントリは `JSON.stringify` した文字列として保存

#### 3.4.2 `indexedDBDriver(options?)`

| フィールド | 型 | 既定 |
|------------|-----|------|
| `dbName` | `string` | `"cachian"` |
| `storeName` | `string` | `"entries"` |

- IndexedDB が使えなければ `CachianEnvironmentError`
- エントリはオブジェクトのまま structured clone で保存（JSON 文字列化しない）

### 3.5 メソッド（MethodDef）と Cache 面

各公開メソッドモジュールは `MethodDef` を default または named export する（パッケージでは named `get` / `set` / … を採用）。

```ts
type MethodDef<M extends object = object> = {
  readonly name: string;
  attach(ctx: CacheContext): M;
};
```

`name` は `createCache` の重複検出に使う安定識別子（例: `"get"` / `"purge"`）。`attach` は Cache に載せるメソッド群（通常は 1 メソッド）を返す。

| MethodDef | 付与するメソッド | 戻り値 | 概要 |
|-----------|------------------|--------|------|
| `get` | `get(key)` | `Promise<unknown \| null>` | 有効エントリの `data`。miss は `null` |
| `set` | `set(key, data, options?)` | `Promise<void>` | **常に**新規エントリとして保存（`createdAt` / `expiresAt` を再生成） |
| `update` | `update(key, data, options?)` | `Promise<void>` | 有効な既存があるときだけ更新（§3.7）。無ければ / 期限切れなら no-op |
| `upsert` | `upsert(key, data, options?)` | `Promise<void>` | 有効なら `update`、無ければ `set`（§3.7） |
| `remove` | `remove(key)` | `Promise<void>` | 当該物理キーを削除。無ければ no-op |
| `has` | `has(key)` | `Promise<boolean>` | 有効エントリがあれば `true`（期限切れは削除して `false`） |
| `clear` | `clear()` | `Promise<void>` | 本インスタンスが管理する範囲のみ削除（§5.5） |
| `purge` | `purge(options)` | `Promise<void>` | モード選択によるパージ（§3.6 / §5.8） |

`set` / `update` / `upsert` の `options.ttlSeconds` が不正な場合は **`TypeError`**（ストレージへ書かない）。いずれも `CacheSetOptions`（`{ ttlSeconds?: number }`）を受け取る。

テストやアプリが「フル相当」を欲する場合は、明示的に 8 MethodDef をすべて渡す。

### 3.6 エントリ形式

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

### 3.7 `purge(options)` — パージ API（`methods/purge` 選択時）

呼び出し側が次の **いずれか 1 モード**を選ぶ（判別共用体）。異なるモードの混在は **実行時に `TypeError`**（§3.7.4）。ただし `createdBefore` と `createdAfter` の同時指定は範囲削除として許可する。

```ts
type AbsoluteTime = string | number;

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
  | { olderThan: CachePurgeOlderThan }
  | { createdBefore: AbsoluteTime; createdAfter?: AbsoluteTime }
  | { createdAfter: AbsoluteTime; createdBefore?: AbsoluteTime }
  | { expired: true };
```

| モード | オプション | 振る舞い |
|--------|------------|----------|
| すべてパージ | `{ all: true }` | `clear()` と同一の削除範囲（§5.5）。`clear` MethodDef 未選択でも `purge` 単体でこのモードは動作すること |
| キー指定 | `{ keys: string[] }` | 論理キー配列の各要素を `remove` 相当で削除。空配列は no-op。存在しないキーは no-op |
| 経過時間 | `{ olderThan: CachePurgeOlderThan }` | 指定期間より **古い** エントリのみ削除（§5.8.3） |
| 絶対時刻（以前） | `{ createdBefore: AbsoluteTime }` | `createdAt < threshold` のエントリのみ削除（§5.8.4） |
| 絶対時刻（以後） | `{ createdAfter: AbsoluteTime }` | `createdAt > threshold` のエントリのみ削除（§5.8.4） |
| 絶対時刻（範囲） | `{ createdBefore, createdAfter }` | 両方の条件を満たすエントリのみ削除（§5.8.4） |
| 期限切れ | `{ expired: true }` | `expiresAt` が期限切れのエントリのみ削除（§3.7.6 / §5.8.5） |

公開型 `CachePurgeOptions` / `CachePurgeOlderThan` / `AbsoluteTime` はルート（または purge サブパス）から export する。

#### 3.7.1 `olderThan` の期間換算

期間フィールドはすべて **省略可**だが、**少なくとも 1 つ**は指定必須（空オブジェクト `{}` は不正）。

各フィールドの制約: 有限の `number` かつ `>= 0`。不正なら **`TypeError`**（メッセージに `olderThan` または当該フィールド名を含むこと）。ストレージは変更しない。

合算は **固定換算**（カレンダー月・うるう年は使わない）:

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

#### 3.7.2 年齢判定（`olderThan`）

`now = Date.now()` として、エントリを削除する条件:

```
createdAt != null && createdAt <= now - durationMs
```

- `createdAt` が無い旧形式エントリは年齢不明のため **削除しない**
- `durationMs === 0`（例: `{ seconds: 0 }` のみ）は、`createdAt <= now` のエントリ（実質、`createdAt` 付きの全件）を削除対象とする
- 期限切れ（`expiresAt`）とは独立
- 戻り値は常に `Promise<void>`（削除件数は返さない）

#### 3.7.3 絶対時刻のパース（`AbsoluteTime`）

`createdBefore` / `createdAfter` の値は次のいずれか。内部ではすべて **エポックミリ秒**に正規化する。

| 入力 | 解釈 |
|------|------|
| `string` | ISO 8601。`Date.parse` 相当でパース。ミリ秒（小数秒）付きも正しく解釈する |
| `number`（有限） | エポック時刻。**秒とミリ秒を自動判定**: 絶対値が `1e12` 未満なら秒とみなし `* 1000`、それ以外はミリ秒 |

不正な入力は **`TypeError`**（メッセージに `createdBefore` / `createdAfter` / `AbsoluteTime` / `ISO` のいずれかを含むこと）。ストレージは変更しない。

#### 3.7.4 モード混在

次を実行時に受け取った場合は **`TypeError`**。ストレージは変更しない。

- `olderThan` と `createdBefore` の同時指定
- `olderThan` と `createdAfter` の同時指定
- `olderThan` と両方の絶対時刻の同時指定
- `{ expired: true }` と次のいずれかとの同時指定: `all` / `keys` / `olderThan` / `createdBefore` / `createdAfter`

相対×絶対の混在では、エラーメッセージに `olderThan` および `createdBefore` または `createdAfter` を含むこと。  
`expired` の混在では、エラーメッセージに `expired` を含むこと。

`createdBefore` と `createdAfter` の同時指定は **混在エラーではない**（範囲削除として許可）。

`{ expired: false }` や `expired` キー無しは本モードではない（型上も `{ expired: true }` のみ）。実行時に `expired` キーがあるが値が `true` でない場合の扱いは実装任意（本モードとして処理しなくてよい）。

#### 3.7.5 絶対時刻の削除判定

```
createdAt != null
  && (beforeMs === undefined || createdAt < beforeMs)
  && (afterMs === undefined || createdAt > afterMs)
```

- `createdAt` が無い旧形式エントリは **削除しない**
- 境界は **厳密不等号**（`===` のエントリは残す）
- 期限切れ（`expiresAt`）とは独立
- 戻り値は常に `Promise<void>`

#### 3.7.6 期限切れ一括削除（`{ expired: true }`）

`now = Date.now()` として、エントリを削除する条件:

```
now >= expiresAt
```

（既存の期限切れ判定 §5.2 / `isExpired` と同一）

- **`createdAt` の有無は問わない**。旧形式（`createdAt` 無し）でも `expiresAt` が過去なら **削除する**
- 未期限切れ（`now < expiresAt`）のエントリは **残す**
- 年齢パージ（`olderThan` / 絶対時刻）とは独立。作成時刻が古くても未期限なら残す
- 列挙範囲は §5.8.3 と同じ（`keyPrefix` 配下）
- 壊れたエントリは列挙時に削除してスキップしてよい（既存 purge 列挙と同じ）
- 戻り値は常に `Promise<void>`（削除件数は返さない）
- バックグラウンド／定期の自動呼び出しは契約に含めない（呼び出し側の責務）

### 3.8 `set` / `update` / `upsert` の書き込み契約

| メソッド | キーが miss（未保存・期限切れ・壊れて掃除後） | キーが有効 hit |
|----------|-----------------------------------------------|----------------|
| `set` | 新規エントリを書く（`createdAt` / `expiresAt` を `Date.now()` 基準で生成） | **上書き**して新規エントリを書く（`createdAt` / `expiresAt` を再生成） |
| `update` | **no-op**（ストレージ変更なし。reject しない） | `data` を更新。`createdAt` は維持。`options.ttlSeconds` 未指定なら `expiresAt` も維持。指定時は `expiresAt = Date.now() + ttlMs` |
| `upsert` | `set` と同一 | `update` と同一 |

補足:

- 期限切れエントリに対する `update` は、期限切れを検知して削除してよいが、**新しいエントリは書かない**
- 壊れたエントリに対する `update` も掃除して no-op でよい
- `update` / `upsert` で既存 `createdAt` が無い正当エントリを更新する場合、`createdAt` は付与せず維持（undefined のまま）
- `enabled: false` のとき 3 メソッドとも no-op（§5.4）
- ストレージ書き込み失敗は握りつぶす（§5.6.2）

## 4. テスト方針

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

const ALL_METHODS = [get, set, update, upsert, remove, has, clear, purge] as const;

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

## 5. 振る舞い共通契約

### 5.1 hit / miss

- 未保存キー → `get` は `null`、`has` は `false`
- 有効エントリ → `get` は保存した `data`、`has` は `true`
- `data` は JSON 化可能な値を想定。localStorage 経路では `JSON.parse` 往復後の値と深い等価でよい

### 5.2 期限切れ

- `Date.now() >= expiresAt` のエントリは **期限切れ**
- `get` / `has` は期限切れを検知したらストレージから削除し、それぞれ `null` / `false`
- `update` は期限切れを検知したら削除して no-op。`upsert` は削除してから新規 `set` 相当
- 触られない期限切れエントリはストレージに残ってよい（遅延削除）。明示掃除は `purge({ expired: true })`（§3.7.6）
- `ttlSeconds: 0` は「即期限切れになりうる」エントリ。`get` は書き込みと同時刻比較で miss になり得る。許容する

### 5.3 壊れたエントリ

次のいずれかをストレージから読んだ場合、削除して miss:

- JSON パース失敗（localStorage）
- 型ガードを満たさないオブジェクト
- IndexedDB 上の非エントリ値

### 5.4 `enabled: false`

- `get` → 常に `null`（既存エントリがあっても読まない・消さない）
- `has` → 常に `false`
- `set` / `update` / `upsert` / `remove` / `clear` / `purge` → no-op（ストレージを変更しない）
- `purge` のオプションが不正な場合でも、`enabled: false` なら **バリデーションより先に no-op してよい**。ただし `enabled: true` では不正オプションは必ず `TypeError`

### 5.5 `clear` / `purge({ all: true })` の範囲

| ドライバ | 削除範囲 |
|----------|----------|
| localStorage | **物理キーが `keyPrefix` で始まるもののみ**。他アプリ・他 prefix のキーは消さない |
| IndexedDB | 当該 `dbName` + `storeName` の object store を `clear()` |

### 5.6 ストレージ不可・書き込み失敗

#### 5.6.1 環境非対応（ドライバ生成 / `createCache` 時）

次は **`CachianEnvironmentError`**（miss / no-op にしない）:

- 選んだドライバの `localStorage` / `indexedDB` が未定義
- 可用性チェックで当該 API へのアクセスが throw

#### 5.6.2 操作時の失敗（握りつぶし）

API は存在するが個別操作が失敗する場合、例外を外へ投げず miss / no-op:

- `setItem` / IDB put が QuotaExceeded 等で失敗
- IndexedDB の open / upgrade 失敗（生成時チェック通過後の実行時失敗）
- `purge` / 列挙中の読み取り・削除失敗（握りつぶして続行、または全体 no-op。外へは投げない）

### 5.7 `keyPrefix`

- 物理キー = `keyPrefix + key`（単純連結）
- 異なる prefix のインスタンスは互いに見えない
- `purge({ olderThan })` / 絶対時刻パージ / **`purge({ expired: true })`** の列挙も **自インスタンスの `keyPrefix` 配下のみ**（localStorage）。IndexedDB は store 全件を見て prefix で絞る実装でよい

### 5.8 `purge` の共通契約

#### 5.8.1 `{ all: true }`

- §5.5 と同等
- `clear` MethodDef を選んでいれば `clear()` と同じ範囲。`purge` のみでも `{ all: true }` は動作する

#### 5.8.2 `{ keys: string[] }`

- 配列順に各論理キーを物理キーへ変換して削除
- 空配列 `[]` → no-op（reject しない）
- 重複キーがあっても追加の副作用なし
- 他キーは残す

#### 5.8.3 `{ olderThan }`

- 期間換算・判定は §3.7.1 / §3.7.2
- 列挙対象:
  - localStorage: `keyPrefix` で始まる物理キー
  - IndexedDB: 当該 store 内で物理キーが `keyPrefix` で始まるもの（prefix 空なら store 内全件）
- 壊れたエントリは列挙時に削除してスキップしてよい
- `createdAt` 無しの正当なエントリは **残す**
- `createdAt` が閾値より新しいエントリは **残す**

#### 5.8.4 `{ createdBefore }` / `{ createdAfter }`

- パース・判定は §3.7.3 / §3.7.5
- 列挙対象・壊れたエントリの扱いは §5.8.3 と同じ
- `createdAt` 無しの正当なエントリは **残す**
- 境界ちょうど（`===`）のエントリは **残す**
- `olderThan` との混在は §3.7.4 のとおり `TypeError`

#### 5.8.5 `{ expired: true }`

- 判定は §3.7.6（`Date.now() >= expiresAt`）
- 列挙対象・壊れたエントリの扱いは §5.8.3 と同じ
- `createdAt` 無しの正当なエントリでも、期限切れなら **削除する**（§5.8.3 / §5.8.4 と異なる点）
- 未期限切れは **残す**（`createdAt` の新旧は問わない）
- 他モード（`all` / `keys` / `olderThan` / `createdBefore` / `createdAfter`）との混在は §3.7.4 のとおり `TypeError`

## 6. 組み立て・モジュール面（TC-M）

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
- **期待**: `"purge" in cache === false`（および `update` / `upsert` / `has` / `clear` も同様に無し）

### TC-M04: ルートから drivers / methods を import できない

- **操作**: `@b4moss/cachian` から `localStorageDriver` / `get` 等を import（型チェックまたは実行時の export 列挙）
- **期待**: ルートの公開 export に含まれない（サブパスからのみ取得可能）

### TC-M05: サブパスから個別に import できる

- **操作**: 各 `@b4moss/cachian/drivers/*` / `@b4moss/cachian/methods/*` から該当シンボルを import
- **期待**: いずれも関数（または MethodDef オブジェクト）として取得できる

### TC-M06: `get` + `set` + `remove` のみで基本読み書きができる

- **前提**: `methods: [get, set, remove]`
- **操作**: `set` → `get` hit → `remove` → `get` miss
- **期待**: フルメソッド組み立てと同じ hit/miss / 削除結果

## 7. コアケース（TC-C）— ドライバ非依存

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
- **操作**: `createTestCache({ enabled: false })` で `get` / `set` / `update` / `upsert` / `remove` / `has` / `clear` / `purge`
- **期待**: `get` → `null`、`has` → `false`
- **期待**: 書き込み系・削除系のあとでも、既存ストレージ内容が変わらない

### TC-C11: `remove`

- **前提**: `"k"` を保存済み
- **操作**: `await remove("k")` → `await get("k")`
- **期待**: `null`
- **期待**: 存在しないキーの `remove` は reject しない

### TC-C12: `has` は有効時のみ true

- **前提**: 有効エントリと期限切れエントリ
- **期待**: 有効のみ `true`。期限切れは `false` かつ削除

### TC-C13: `keyPrefix` 隔離

- **前提**: `createTestCache({ keyPrefix: "a:" })` と `createTestCache({ keyPrefix: "b:" })`
- **操作**: 前者で `set("k", 1)`、後者で `get("k")`
- **期待**: 後者は `null`
- **期待**: localStorage 上の物理キーは `"a:k"`（前者）

### TC-C14: `clear` が prefix 範囲のみ（localStorage） / store 全体（IndexedDB）

- **localStorage**: prefix `"app:"` のインスタンスで `set` したキーだけ消え、prefix なしで置いた他キーは残る
- **IndexedDB**: 同一 `dbName`/`storeName` 内の全エントリが消える。別 `storeName` のインスタンスのデータは残ってよい

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

### TC-C17: `purge({ all: true })` が `clear` 相当

- **前提**: 複数キーを保存済み（localStorage なら他 prefix のキーも用意）
- **操作**: `await purge({ all: true })`
- **期待**: §5.5 / TC-C14 と同じ削除範囲。自インスタンス管理分はすべて miss
- **期待**: reject しない

### TC-C18: `purge({ keys })` が指定キーのみ削除

- **前提**: `"a"` / `"b"` / `"c"` を保存済み
- **操作**: `await purge({ keys: ["a", "c"] })`
- **期待**: `get("a")` / `get("c")` は `null`、`get("b")` は hit
- **期待**: `await purge({ keys: [] })` は no-op
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

## 8. localStorage 固有（TC-LS）

### TC-LS01: 既定テストヘルパのドライバが localStorage

- **操作**: `createTestCache()` で `set`
- **期待**: stub した `localStorage.setItem` が呼ばれる（IndexedDB は触らない）

### TC-LS02: 保存値が JSON エントリ文字列

- **操作**: `await set("https://example/data.json", { x: 1 })`
- **期待**: `getItem` で得た文字列を `JSON.parse` すると `{ expiresAt: number, data: { x: 1 }, createdAt: number }`

### TC-LS03: `clear` が他 prefix を消さない

- §5.5 / TC-C14 の localStorage 詳細。必須

### TC-LS04: `purge({ olderThan })` が他 prefix を消さない

- **前提**: prefix `"app:"` のインスタンスと、prefix なしで置いた他キー（いずれも十分な年齢の `createdAt`）
- **操作**: `app` 側で `purge({ olderThan: { seconds: 0 } })`
- **期待**: `"app:"` 配下の対象のみ削除。他 prefix / 無 prefix のキーは残る

### TC-LS05: 絶対時刻パージが他 prefix を消さない

- **前提**: TC-LS04 と同様に prefix 隔離されたエントリ
- **操作**: `app` 側で `purge({ createdBefore: "2099-01-01T00:00:00.000Z" })`
- **期待**: `"app:"` 配下の対象のみ削除。他キーは残る

### TC-LS06: `purge({ expired: true })` が他 prefix を消さない

- **前提**: prefix `"app:"` のインスタンスに期限切れエントリ、prefix なし（または別 prefix）にも期限切れエントリ
- **操作**: `app` 側で `purge({ expired: true })`
- **期待**: `"app:"` 配下の期限切れのみ削除。他 prefix / 無 prefix の期限切れキーは残る

## 9. IndexedDB 固有（TC-IDB）

### TC-IDB01: `indexedDBDriver` で hit/miss

- **前提**: `fake-indexeddb` 投入、`createTestCache({ driver: indexedDBDriver() })`
- **操作**: TC-C01 / TC-C02 相当
- **期待**: 同様の hit/miss。localStorage は変更されない

### TC-IDB02: 既定 `dbName` / `storeName`

- **期待**: 未指定時データベース名 `"cachian"`、ストア名 `"entries"` で読み書きできる

### TC-IDB03: カスタム `dbName` / `storeName` 隔離

- **前提**: `indexedDBDriver({ dbName, storeName })` で store 名を変えた二つのインスタンス
- **期待**: 互いに見えない

### TC-IDB04: エントリはオブジェクト保存（非 JSON 文字列）

- **操作**: `set` 後、IDB から直接取得（テストヘルパ可）
- **期待**: 値がオブジェクトであり、文字列の JSON 丸ごとではない（`expiresAt` / `data` / `createdAt` プロパティを持つ）

### TC-IDB05: IndexedDB 未定義なら環境エラー

- **前提**: `globalThis.indexedDB` を `undefined` に stub。`fake-indexeddb` は投入しない
- **操作**: `indexedDBDriver()` またはそれを使う `createCache`
- **期待**: `CachianEnvironmentError`。メッセージに `IndexedDB` または `indexedDB`
- **期待**: IndexedDB / localStorage へ書き込まない

### TC-IDB06: 共通ケースの再実行セット

最低限、IndexedDB でも次を通す:

- TC-C04（TTL）
- TC-C08（期限切れ削除）
- TC-C10（enabled: false）
- TC-C11（remove）
- TC-C13（keyPrefix。**仕様は物理キーへ prefix を載せる**）
- TC-C17（`purge` all）
- TC-C18（`purge` keys）
- TC-C19（`purge` olderThan）
- TC-C20（`createdAt` 無しは残す）
- TC-C21（不正 `olderThan`）
- TC-C22（`update` が `createdAt` を維持）
- TC-C25（`upsert` miss→set / hit→update）
- TC-C27（`createdBefore`）
- TC-C28（`createdAfter` / 範囲）
- TC-C30（絶対時刻で legacy 残す）
- TC-C31（相対と絶対の混在エラー）
- TC-C36（`purge` expired）
- TC-C37（expired で legacy 期限切れも削除）
- TC-C39（`expired` と他モードの混在エラー）

## 10. 公開面・パッケージ（TC-P）

### TC-P01: ルートから必要なシンボルを export

- **期待**: `createCache` / `CachianEnvironmentError` / `DEFAULT_CACHE_TTL_SECONDS` /（任意）`CACHE_TTL_MS` および共通公開型が `@b4moss/cachian` から import できる
- **期待**: ルートから `localStorageDriver` / `get` 等は export されない（TC-M04）
- ビルド後 `dist` の types でも同様

### TC-P02: サブパス exports が package.json に定義されている

- **期待**: `exports` に `.` / `./drivers/localStorage` / `./drivers/indexedDB` / `./methods/{get,set,update,upsert,remove,has,clear,purge}` がある
- **期待**: 各エントリに `types` / `import`（および CJS を維持するなら `require`）が解決できる

### TC-P03: `sideEffects: false`

- **期待**: `package.json` に `"sideEffects": false` がある

### TC-P04: ランタイム依存ゼロ

- **期待**: `package.json` の `dependencies` が空（または無し）。`fake-indexeddb` は `devDependencies` のみ

## 11. 受け入れ条件

1. §6 の TC-M をパス
2. §7 の TC-C を localStorage（全 MethodDef）ですべてパス（TC-C36〜TC-C40 を含む）
3. §8 の TC-LS をパス（TC-LS06 を含む）
4. §9 の TC-IDB をパス（TC-IDB05 の環境ガード、および TC-IDB06 の再実行セットを含む）
5. §10 の TC-P をパス
6. `npm test` および `npm run build` が CI / ローカルで成功
7. v0.4 破壊的変更（組み立て必須・`storage` 文字列廃止・ルートからの drivers/methods 非再エクスポート）の契約を維持する
8. v0.5.0 の `purge({ expired: true })` は **非破壊の追加**であり、既存モードの意味を変えないこと
9. （推奨）localStorage + `get`/`set`/`remove` のみの minify サイズが、旧フル一体バンドルより明確に小さいこと

## 12. トレーサビリティ

| 抽出元 / 旧 cachian (v0.3) | v0.4 / v0.5 |
|----------------------------|-------------|
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

本仕様は cachian 単体の契約であり、`createLocalGovClient` のオプション名の互換は **jp-local-gov-id 配線時の別仕様**とする。
