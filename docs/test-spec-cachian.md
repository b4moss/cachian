# テスト仕様書: `@b4moss/cachian`（汎用ブラウザキャッシュ）

対象マイルストーン: `v0.3.0`（サーバー非対応環境の生成時エラー）  
関連: [#18 サーバーサイドでの実行をプリベント](https://github.com/b4moss/cachian/issues/18) / 抽出元 `b4moss/jp-local-gov-id` の `packages/jp-local-gov-id/src/cache.ts`  
作業ブランチ: `cursor/prevent-server-side-d013`  
想定実装: リポジトリルートの単一パッケージ（`src/createCache.ts` ほか）

## 1. 目的

`jp-local-gov-id` の localStorage キャッシュロジックを外出し・汎用化した `@b4moss/cachian` の契約を固定する。

- キー・値はドメイン非依存（URL 専用にしない）
- 既定バックエンドは **localStorage**
- オプションで **IndexedDB** に切り替え可能
- 読み書きはすべて **非同期**（`Promise`）
- **ブラウザ専用**: 選んだバックエンド API（`localStorage` / `indexedDB`）が無い環境では `createCache()` が失敗する（§3.2.1 / §5.6.1）
- エントリ形式 `{ expiresAt, data, createdAt? }`・TTL（秒）・無効化・**操作時**のストレージ失敗握りつぶしは抽出元と同等（§5.6.2）
- **パージ API**（全削除 / キー配列削除 / 経過時間削除）で選択的にキャッシュを捨てられる
- **本仕様の直接対象外**: `jp-local-gov-id` への配線、CDN 配信の実行時検証、カスタム `StorageAdapter` の公開

## 2. 用語

| 用語 | 意味 |
|------|------|
| Cache | `createCache()` が返すオブジェクト（`get` / `set` / `update` / `upsert` / `remove` / `has` / `clear` / `purge`） |
| バックエンド | `storage: "localStorage"` または `"indexedDB"` |
| エントリ | ストレージに保存する単位。`{ expiresAt: number, data: unknown, createdAt?: number }` |
| `expiresAt` | 期限切れ判定用のエポックミリ秒。`Date.now() >= expiresAt` なら期限切れ |
| `createdAt` | 書き込み時刻のエポックミリ秒。`purge({ olderThan })` および絶対時刻パージの年齢判定に使う。新規 `set` / `upsert`（miss 時）では必須付与。`update` / `upsert`（hit 時）では維持 |
| TTL | Time To Live（秒）。`set` 時に `expiresAt = Date.now() + ttlSeconds * 1000` |
| 絶対時刻 | `purge` の `createdBefore` / `createdAfter` に渡す時刻。ISO 8601 文字列、またはエポック秒／ミリ秒の数値（§3.5.3） |
| 論理キー | 呼び出し側が渡す `key` 文字列 |
| 物理キー | 実際にストレージへ書くキー。`keyPrefix` がある場合は `keyPrefix + 論理キー` |
| miss | `get` が `null` を返すこと（未保存・期限切れ・壊れたエントリ・無効化・操作時のストレージ失敗） |
| no-op | 例外を投げず、状態も変えないこと |
| 環境非対応 | 選んだバックエンド API が `undefined`、または生成時の可用性チェックでアクセスできないこと（サーバー等）。`createCache()` が `CachianEnvironmentError` を投げる |
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

### 3.2.1 実行環境ガード（ブラウザ専用）

`createCache()` は **モジュール import 時には throw しない**。生成時に、選んだバックエンドの API が利用可能かを確認する。

| 条件 | 結果 |
|------|------|
| `storage` 未指定または `"localStorage"` で `globalThis.localStorage` が使えない | **`CachianEnvironmentError`** |
| `storage: "indexedDB"` で `globalThis.indexedDB` が使えない | **`CachianEnvironmentError`** |
| 上記 API が使える（テスト用 stub / `fake-indexeddb` 含む） | 通常どおり `Cache` を返す |

「使えない」の定義:

- プロパティが `undefined`
- プロパティ読み取り時に例外（既存アダプタと同様に `try/catch`）

`CachianEnvironmentError`:

- `Error` を継承する専用クラス（パッケージから export。呼び出し側が `instanceof` で判別できること）
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

不正 `ttlSeconds` の `TypeError` と混同しないこと。環境ガードは TTL 検証の前後どちらでもよいが、**ストレージへ触る前**に失敗すること。

SSR（Next.js 等）では import はサーバーでも通る想定。`createCache()` の呼び出しはブラウザ（または API がある環境）に限定する。`enabled: false` は環境非対応の代替にしない（API が無ければ `enabled` に関わらず throw）。

### 3.3 `Cache` メソッド

| メソッド | 戻り値 | 概要 |
|----------|--------|------|
| `get(key)` | `Promise<unknown \| null>` | 有効エントリの `data`。miss は `null` |
| `set(key, data, options?)` | `Promise<void>` | **常に**新規エントリとして保存（`createdAt` / `expiresAt` を再生成）。既存の有無は問わない |
| `update(key, data, options?)` | `Promise<void>` | 有効な既存エントリがあるときだけ `data` を更新（§3.6）。無ければ / 期限切れなら no-op |
| `upsert(key, data, options?)` | `Promise<void>` | 有効エントリがあれば `update`、無ければ `set`（§3.6） |
| `remove(key)` | `Promise<void>` | 当該物理キーを削除。無ければ no-op |
| `has(key)` | `Promise<boolean>` | 有効エントリがあれば `true`（期限切れは削除して `false`） |
| `clear()` | `Promise<void>` | 本インスタンスが管理する範囲のみ削除（§5.5） |
| `purge(options)` | `Promise<void>` | モード選択によるパージ（§3.5 / §5.8）。既存 `clear` / `remove` は互換のため残す |

`set` / `update` / `upsert` の `options.ttlSeconds` が不正な場合は **`TypeError`**（ストレージへ書かない）。

`set` / `update` / `upsert` はいずれも `CacheSetOptions`（`{ ttlSeconds?: number }`）を受け取る。

### 3.4 エントリ形式

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
- IndexedDB: エントリオブジェクトを structured clone で保存（stringify 不要）
- `get` は呼び出し側に `data` のみ返す（`expiresAt` / `createdAt` は返さない）

### 3.5 `purge(options)` — パージ API

呼び出し側が次の **いずれか 1 モード**を選ぶ（判別共用体）。複数モードを同時に指定する形は本仕様の対象外（実装は TypeScript の判別共用体で排他する）。相対時刻（`olderThan`）と絶対時刻（`createdBefore` / `createdAfter`）の混在は **実行時に `TypeError`**（§3.5.4）。

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
  | { createdAfter: AbsoluteTime; createdBefore?: AbsoluteTime };
```

| モード | オプション | 振る舞い |
|--------|------------|----------|
| すべてパージ | `{ all: true }` | `clear()` と同一の削除範囲（§5.5） |
| キー指定 | `{ keys: string[] }` | 論理キー配列の各要素を `remove` 相当で削除。空配列は no-op。存在しないキーは no-op |
| 経過時間 | `{ olderThan: CachePurgeOlderThan }` | 指定期間より **古い** エントリのみ削除（§5.8.3） |
| 絶対時刻（以前） | `{ createdBefore: AbsoluteTime }` | `createdAt < threshold` のエントリのみ削除（§5.8.4） |
| 絶対時刻（以後） | `{ createdAfter: AbsoluteTime }` | `createdAt > threshold` のエントリのみ削除（§5.8.4） |
| 絶対時刻（範囲） | `{ createdBefore, createdAfter }` | 両方の条件を満たすエントリのみ削除（§5.8.4） |

公開型 `CachePurgeOptions` / `CachePurgeOlderThan` / `AbsoluteTime` はパッケージから export する。

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

#### 3.5.2 年齢判定（`olderThan`）

`now = Date.now()` として、エントリを削除する条件:

```
createdAt != null && createdAt <= now - durationMs
```

- `createdAt` が無い旧形式エントリは年齢不明のため **削除しない**
- `durationMs === 0`（例: `{ seconds: 0 }` のみ）は、`createdAt <= now` のエントリ（実質、`createdAt` 付きの全件）を削除対象とする
- 期限切れ（`expiresAt`）とは独立。期限切れでも `createdAt` が新しければ残るし、有効でも古ければ消える
- 戻り値は常に `Promise<void>`（削除件数は返さない）

#### 3.5.3 絶対時刻のパース（`AbsoluteTime`）

`createdBefore` / `createdAfter` の値は次のいずれか。内部ではすべて **エポックミリ秒**に正規化する。

| 入力 | 解釈 |
|------|------|
| `string` | ISO 8601（例: `2024-01-01T00:00:00Z`、`2024-01-01T00:00:00.123Z`、オフセット付きも可）。`Date.parse` 相当でパース。ミリ秒（小数秒）付きも正しく解釈する |
| `number`（有限） | エポック時刻。**秒とミリ秒を自動判定**: 絶対値が `1e12` 未満なら秒とみなし `* 1000`、それ以外はミリ秒としてそのまま使う（負の時刻も同様に絶対値で判定） |

不正な入力は **`TypeError`**（メッセージに `createdBefore` / `createdAfter` / `AbsoluteTime` / `ISO` のいずれかを含むこと）。ストレージは変更しない。

不正の例:

- 空文字・パース不能な文字列（例: `"not-a-date"`）
- `NaN` / `Infinity` / `-Infinity`
- `string` / `number` 以外（実装が受けた場合。TypeScript では型で除外）

#### 3.5.4 相対時刻と絶対時刻の混在

次のようなオブジェクトを実行時に受け取った場合（型アサーション等で判別共用体を迂回した場合を含む）は **`TypeError`**。ストレージは変更しない。

- `olderThan` と `createdBefore` の同時指定
- `olderThan` と `createdAfter` の同時指定
- `olderThan` と両方の絶対時刻の同時指定

エラーメッセージに `olderThan` および `createdBefore` または `createdAfter` を含むこと。

`createdBefore` と `createdAfter` の同時指定は **混在エラーではない**（範囲削除として許可）。

#### 3.5.5 絶対時刻の削除判定

`createdBefore` / `createdAfter` をそれぞれパースして得た閾値を `beforeMs` / `afterMs` とする。

```
createdAt != null
  && (beforeMs === undefined || createdAt < beforeMs)
  && (afterMs === undefined || createdAt > afterMs)
```

- `createdAt` が無い旧形式エントリは **削除しない**（`olderThan` と同様）
- 境界は **厳密不等号**（`createdAt === beforeMs` や `createdAt === afterMs` のエントリは残す）
- `createdBefore` のみ / `createdAfter` のみ / 両方、のいずれでもよい。両方とも欠ける単独モードは型上あり得ない（少なくとも一方が必須）
- 期限切れ（`expiresAt`）とは独立
- 戻り値は常に `Promise<void>`

### 3.6 `set` / `update` / `upsert` の書き込み契約

3 メソッドは意図的に挙動を分ける。

| メソッド | キーが miss（未保存・期限切れ・壊れて掃除後） | キーが有効 hit |
|----------|-----------------------------------------------|----------------|
| `set` | 新規エントリを書く（`createdAt` / `expiresAt` を `Date.now()` 基準で生成） | **上書き**して新規エントリを書く（`createdAt` / `expiresAt` を再生成） |
| `update` | **no-op**（ストレージ変更なし。reject しない） | `data` を更新。`createdAt` は維持。`options.ttlSeconds` 未指定なら `expiresAt` も維持。指定時は `expiresAt = Date.now() + ttlMs` |
| `upsert` | `set` と同一 | `update` と同一 |

補足:

- 期限切れエントリに対する `update` は、`get` / `has` と同様に期限切れを検知して削除してよいが、**新しいエントリは書かない**（結果として miss のまま = no-op）
- 壊れたエントリに対する `update` も掃除して no-op でよい
- `update` / `upsert` で既存 `createdAt` が無い正当エントリを更新する場合、`createdAt` は付与せず維持（undefined のまま）
- `enabled: false` のとき 3 メソッドとも no-op（§5.4）
- ストレージ書き込み失敗は `set` と同様に握りつぶす（§5.6）
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
- 絶対時刻パージは固定の `createdAt` をストレージへ直接配置するか、fake timers でよい（TC-C27〜）
- `AbsoluteTime` のパースは文字列・秒・ミリ秒の代表値を固定ケースで検証（TC-C29）

対象外（本仕様では必須としない）:

- IIFE/CDN バンドルのブラウザ手動確認
- マルチタブ競合・バージョンアップマイグレーション（`createdAt` 無し旧エントリの一括変換は不要。TC-C20 のとおり残す）
- Quota を実際に満杯にする結合テスト（stub で `setItem` が throw すれば足りる）
- `purge` の削除件数の戻り値や進捗コールバック
- カレンダー月／うるう年に基づく期間換算（固定換算のみ）
- ISO 8601 の全亜種（週番号日付・ordinal date 等）。`Date.parse` が受け付ける一般的な暦日付＋時刻で足りる
- `update` が「存在しないキーで throw する」契約（本仕様は no-op）

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
- `set` / `update` / `upsert` / `remove` / `clear` / `purge` → no-op（ストレージを変更しない）
- `purge` のオプションが不正な場合でも、`enabled: false` なら **バリデーションより先に no-op してよい**（実装都合）。ただし `enabled: true` では不正オプションは必ず `TypeError`

### 5.5 `clear` の範囲

| バックエンド | 削除範囲 |
|--------------|----------|
| localStorage | **物理キーが `keyPrefix` で始まるもののみ**。prefix 空なら、当該アダプタが管理するキー列挙に載るもの。他アプリ・他 prefix のキーは消さない |
| IndexedDB | 当該 `dbName` + `storeName` の object store を `clear()` |

`purge({ all: true })` も本節と同一範囲。

### 5.6 ストレージ不可・書き込み失敗

本節は **環境非対応（生成時）** と **操作時失敗（握りつぶし）** を分ける。

#### 5.6.1 環境非対応（`createCache` 時）

次は §3.2.1 のとおり **`CachianEnvironmentError`**（miss / no-op にしない）:

- 選んだバックエンドの `localStorage` / `indexedDB` が未定義
- 生成時の可用性チェックで当該 API へのアクセスが throw

一度生成に成功したインスタンスに対し、後から API が消えるケースは本仕様の必須対象外（実装は操作時 §5.6.2 に落としてよい）。

#### 5.6.2 操作時の失敗（握りつぶし）

API は存在するが個別操作が失敗する場合、例外を外へ投げず miss / no-op:

- `setItem` / IDB put が QuotaExceeded 等で失敗
- IndexedDB の open / upgrade 失敗（生成時チェックを通過したあとの実行時失敗）
- `purge` / 列挙中の読み取り・削除失敗（握りつぶして続行、または全体 no-op。外へは投げない）

### 5.7 `keyPrefix`

- 物理キー = `keyPrefix + key`（単純連結。セパレータは呼び出し側が prefix に含めてよい）
- 異なる prefix のインスタンスは互いに見えない
- `purge({ olderThan })` / 絶対時刻パージの列挙も **自インスタンスの `keyPrefix` 配下のみ**（localStorage）。IndexedDB は store 全件を見て prefix で絞る実装でよい

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

#### 5.8.4 `{ createdBefore }` / `{ createdAfter }`

- パース・判定は §3.5.3 / §3.5.5
- 列挙対象・壊れたエントリの扱いは §5.8.3 と同じ
- `createdAt` 無しの正当なエントリは **残す**
- 境界ちょうど（`===`）のエントリは **残す**
- `olderThan` との混在は §3.5.4 のとおり `TypeError`

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
- **操作**: `createCache({ enabled: false })` で `get` / `set` / `update` / `upsert` / `remove` / `has` / `clear` / `purge`
- **期待**: `get` → `null`、`has` → `false`
- **期待**: `set` / `update` / `upsert` / `remove` / `clear` / `purge({ all: true })` / `purge({ keys: ["k"] })` / `purge({ olderThan: { seconds: 0 } })` / `purge({ createdBefore: "2099-01-01T00:00:00.000Z" })` 後も、既存ストレージ内容が変わらない（事前データがあれば残る）

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

### TC-C15: ストレージ未定義なら `createCache` が `CachianEnvironmentError`

- **前提**: 既定（localStorage）経路。`globalThis.localStorage` を `undefined` に stub（または削除）
- **操作**: `createCache()`
- **期待**: `CachianEnvironmentError`（`instanceof` 可）。メッセージに `localStorage` を含み、ブラウザ環境が必要である旨が分かる
- **期待**: ストレージへ一切書き込まない

### TC-C16: 書き込み失敗を握りつぶす（§5.6.2）

- **前提**: `createCache()` は成功済み。localStorage の `setItem` が throw（QuotaExceeded 相当）。IndexedDB は put 失敗を stub
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

### TC-C22: import だけでは throw しない

- **前提**: `localStorage` / `indexedDB` が未定義の環境（Node 相当）でもよい
- **操作**: `import { createCache, CachianEnvironmentError } from "@b4moss/cachian"`（またはテスト内の同モジュール import）
- **期待**: モジュール評価は成功する（`createCache` を呼ばなければ throw しない）

### TC-C23: localStorage アクセス時 throw も環境非対応

- **前提**: `localStorage` のゲッターが throw するよう stub（プライベートモード等の模擬）
- **操作**: `createCache()`
- **期待**: `CachianEnvironmentError`（メッセージに `localStorage`）

### TC-C24: API がある環境では従来どおり生成できる

- **前提**: 既存どおり Map ベースの `localStorage` stub（§4）
- **操作**: `createCache()` および `createCache({ storage: "indexedDB" })`（後者は `fake-indexeddb` 投入後）
- **期待**: throw せず `Cache` を返す。続く `set` / `get` は従来ケース（TC-C01 等）どおり


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

### TC-LS05: 絶対時刻パージが他 prefix を消さない

- **前提**: TC-LS04 と同様に prefix 隔離されたエントリ（いずれも閾値より前の `createdAt`）
- **操作**: `app` 側で `purge({ createdBefore: "2099-01-01T00:00:00.000Z" })`
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

### TC-IDB05: IndexedDB 未定義なら `createCache` が `CachianEnvironmentError`

- **前提**: `globalThis.indexedDB` を `undefined` に stub（または削除）。`fake-indexeddb` は投入しない
- **操作**: `createCache({ storage: "indexedDB" })`
- **期待**: `CachianEnvironmentError`。メッセージに `IndexedDB` または `indexedDB` を含み、ブラウザ環境が必要である旨が分かる
- **期待**: IndexedDB / localStorage へ書き込まない
- **備考**: 既定の localStorage 経路は TC-C15。本ケースは indexedDB 指定時のみ

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
- TC-C22（`update` が `createdAt` を維持）
- TC-C25（`upsert` miss→set / hit→update）
- TC-C27（`createdBefore`）
- TC-C28（`createdAfter` / 範囲）
- TC-C30（絶対時刻で legacy 残す）
- TC-C31（相対と絶対の混在エラー）

## 9. 公開面・パッケージ（TC-P）

### TC-P01: エントリポイントから必要なシンボルを export

- **期待**: `createCache` / `CachianEnvironmentError` / `DEFAULT_CACHE_TTL_SECONDS` /（任意）`CACHE_TTL_MS` および公開型（`Cache` / `CacheEntry` / `CacheSetOptions` / `CreateCacheOptions` / `StorageBackend` / `CachePurgeOptions` / `CachePurgeOlderThan`）が `@b4moss/cachian` から import できる
- ビルド後 `dist` の types でも同様（`npm run build` 後の型チェック、または dts 生成物の存在確認）

### TC-P02: ランタイム依存ゼロ

- **期待**: `package.json` の `dependencies` が空（または無し）。`fake-indexeddb` は `devDependencies` のみ

## 10. 受け入れ条件

1. §6 の TC-C（TC-C15 / TC-C22〜TC-C24 の環境ガード、および TC-C17〜TC-C21 のパージ系を含む）を localStorage ですべてパス
2. §7 の TC-LS（TC-LS04 を含む）をパス
3. §8 の TC-IDB をパス（TC-IDB05 の環境ガード、および §8.6 の再実行セットを含む）
4. §9 の TC-P をパス（`CachianEnvironmentError` の export を含む）
5. `npm test` および `npm run build` が CI / ローカルで成功
6. 破壊的変更として、旧「ストレージ未定義でも miss / no-op」契約からの移行をリリースノート等で明示する

## 11. トレーサビリティ（抽出元）

| 抽出元（jp-local-gov-id） | cachian |
|--------------------------|---------|
| `getCachedData(url, { enabled })` | `cache.get(key)`（`enabled` はインスタンスオプション） |
| `setCachedData(url, data, { enabled, ttlSeconds })` | `cache.set(key, data, { ttlSeconds })` |
| `DEFAULT_CACHE_TTL_SECONDS` / `CACHE_TTL_MS` | 同名エクスポート |
| localStorage のみ | + `storage: "indexedDB"` |
| 同期 API | 非同期 API |
| URL キー前提のコメント | 任意文字列キー |
| （なし） | `cache.purge({ all \| keys \| olderThan \| createdBefore \| createdAfter })` |
| （なし） | エントリの `createdAt`（新規書き込み） |
| （なし・握りつぶし） | 環境非対応時は `CachianEnvironmentError`（生成時。#18） |

本仕様は cachian 単体の契約であり、`createLocalGovClient` のオプション名（`cache` / `cacheTtlSeconds`）の互換は **jp-local-gov-id 配線時の別仕様**とする。
