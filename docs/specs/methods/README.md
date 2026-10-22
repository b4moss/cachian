# methods 仕様

現行バージョンに存在する **MethodDef**（`get` / `set` / `update` / `upsert` / `remove` / `has` / `purge`）の正本。  
公開 `clear` MethodDef は v0.6.0 で廃止（全削除は `purge({ all: true })`）。  
テストは [`docs/tests/methods/`](../../tests/methods/)。

由来: 旧 `docs/tests/test-spec-cachian.md` §3.5 / §3.7 / §3.8。

## 概要

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
| `update` | `update(key, data, options?)` | `Promise<void>` | 有効な既存があるときだけ更新（下記 `purge` / 書き込み契約）。無ければ / 期限切れなら no-op |
| `upsert` | `upsert(key, data, options?)` | `Promise<void>` | 有効なら `update`、無ければ `set`（下記 `purge` / 書き込み契約） |
| `remove` | `remove(key)` | `Promise<void>` | **単一の論理キーのみ**削除（下記 `remove`）。無ければ no-op |
| `has` | `has(key)` | `Promise<boolean>` | 有効エントリがあれば `true`（期限切れは削除して `false`） |
| `purge` | `purge(options)` | `Promise<void>` | モード選択によるパージ（下記 `purge` / core 共通契約）。全削除は `{ all: true }`（core: `purge({ all: true })` の範囲） |

`set` / `update` / `upsert` の `options.ttlSeconds` が不正な場合は **`TypeError`**（ストレージへ書かない）。いずれも `CacheSetOptions`（`{ ttlSeconds?: number }`）を受け取る。

テストやアプリが「フル相当」を欲する場合は、明示的に **7 MethodDef** をすべて渡すか、CDN の **`createFullCache`**（全 MethodDef + ドライバ選択）を使う。公開 `clear` MethodDef は **存在しない**（v0.6.0）。

### `remove(key)` — 単一キー削除

- シグネチャ: `remove(key: string): Promise<void>`
- **引数はキー名を 1 つだけ**受け付ける。複数キーや配列を受け付ける契約ではない
- 複数キーの一括削除は `purge({ keys: string[] })`（`purge({ keys })` / TC-C18）を使う
- 存在しないキーは no-op（reject しない）
- `enabled: false` のとき no-op（core: `enabled: false`）

## `purge(options)`

呼び出し側が次の **いずれか 1 モード**を選ぶ（判別共用体）。異なるモードの混在は **実行時に `TypeError`**（下記モード混在）。ただし `createdBefore` と `createdAfter` の同時指定は範囲削除として許可する。

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
| すべてパージ | `{ all: true }` | 本インスタンスが管理する範囲をすべて削除（core: `purge({ all: true })` の範囲）。v0.6.0 で廃止した公開 `clear()` の代替。`purge` 単体でこのモードは動作すること |
| キー指定 | `{ keys: string[] }` | 論理キー配列の各要素を `remove` 相当で削除（複数キー削除の正規手段）。空配列は no-op。存在しないキーは no-op |
| 経過時間 | `{ olderThan: CachePurgeOlderThan }` | 指定期間より **古い** エントリのみ削除（core: olderThan / list 範囲） |
| 絶対時刻（以前） | `{ createdBefore: AbsoluteTime }` | `createdAt < threshold` のエントリのみ削除（core: 絶対時刻パージ） |
| 絶対時刻（以後） | `{ createdAfter: AbsoluteTime }` | `createdAt > threshold` のエントリのみ削除（core: 絶対時刻パージ） |
| 絶対時刻（範囲） | `{ createdBefore, createdAfter }` | 両方の条件を満たすエントリのみ削除（core: 絶対時刻パージ） |
| 期限切れ | `{ expired: true }` | `expiresAt` が期限切れのエントリのみ削除（下記 `{ expired: true }`） |

公開型 `CachePurgeOptions` / `CachePurgeOlderThan` / `AbsoluteTime` はルート（または purge サブパス）から export する。

### `olderThan` の期間換算

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

### 年齢判定（`olderThan`）

`now = Date.now()` として、エントリを削除する条件:

```
createdAt != null && createdAt <= now - durationMs
```

- `createdAt` が無い旧形式エントリは年齢不明のため **削除しない**
- `durationMs === 0`（例: `{ seconds: 0 }` のみ）は、`createdAt <= now` のエントリ（実質、`createdAt` 付きの全件）を削除対象とする
- 期限切れ（`expiresAt`）とは独立
- 戻り値は常に `Promise<void>`（削除件数は返さない）

### 絶対時刻のパース（`AbsoluteTime`）

`createdBefore` / `createdAfter` の値は次のいずれか。内部ではすべて **エポックミリ秒**に正規化する。

| 入力 | 解釈 |
|------|------|
| `string` | ISO 8601。`Date.parse` 相当でパース。ミリ秒（小数秒）付きも正しく解釈する |
| `number`（有限） | エポック時刻。**秒とミリ秒を自動判定**: 絶対値が `1e12` 未満なら秒とみなし `* 1000`、それ以外はミリ秒 |

不正な入力は **`TypeError`**（メッセージに `createdBefore` / `createdAfter` / `AbsoluteTime` / `ISO` のいずれかを含むこと）。ストレージは変更しない。

### モード混在

次を実行時に受け取った場合は **`TypeError`**。ストレージは変更しない。

- `olderThan` と `createdBefore` の同時指定
- `olderThan` と `createdAfter` の同時指定
- `olderThan` と両方の絶対時刻の同時指定
- `{ expired: true }` と次のいずれかとの同時指定: `all` / `keys` / `olderThan` / `createdBefore` / `createdAfter`

相対×絶対の混在では、エラーメッセージに `olderThan` および `createdBefore` または `createdAfter` を含むこと。  
`expired` の混在では、エラーメッセージに `expired` を含むこと。

`createdBefore` と `createdAfter` の同時指定は **混在エラーではない**（範囲削除として許可）。

`{ expired: false }` や `expired` キー無しは本モードではない（型上も `{ expired: true }` のみ）。実行時に `expired` キーがあるが値が `true` でない場合の扱いは実装任意（本モードとして処理しなくてよい）。

### 絶対時刻の削除判定

```
createdAt != null
  && (beforeMs === undefined || createdAt < beforeMs)
  && (afterMs === undefined || createdAt > afterMs)
```

- `createdAt` が無い旧形式エントリは **削除しない**
- 境界は **厳密不等号**（`===` のエントリは残す）
- 期限切れ（`expiresAt`）とは独立
- 戻り値は常に `Promise<void>`

### 期限切れ一括削除（`{ expired: true }`）

`now = Date.now()` として、エントリを削除する条件:

```
now >= expiresAt
```

（既存の期限切れ判定 `isExpired`（core 期限切れ判定） と同一）

- **`createdAt` の有無は問わない**。旧形式（`createdAt` 無し）でも `expiresAt` が過去なら **削除する**
- 未期限切れ（`now < expiresAt`）のエントリは **残す**
- 年齢パージ（`olderThan` / 絶対時刻）とは独立。作成時刻が古くても未期限なら残す
- 列挙範囲は olderThan と同じ列挙範囲（`keyPrefix` 配下）（`keyPrefix` 配下）
- 壊れたエントリは列挙時に削除してスキップしてよい（既存 purge 列挙と同じ）
- 戻り値は常に `Promise<void>`（削除件数は返さない）
- バックグラウンド／定期の自動呼び出しは契約に含めない（呼び出し側の責務）

## `set` / `update` / `upsert` の書き込み契約

| メソッド | キーが miss（未保存・期限切れ・壊れて掃除後） | キーが有効 hit |
|----------|-----------------------------------------------|----------------|
| `set` | 新規エントリを書く（`createdAt` / `expiresAt` を `Date.now()` 基準で生成） | **上書き**して新規エントリを書く（`createdAt` / `expiresAt` を再生成） |
| `update` | **no-op**（ストレージ変更なし。reject しない） | `data` を更新。`createdAt` は維持。`options.ttlSeconds` 未指定なら `expiresAt` も維持。指定時は `expiresAt = Date.now() + ttlMs` |
| `upsert` | `set` と同一 | `update` と同一 |

補足:

- 期限切れエントリに対する `update` は、期限切れを検知して削除してよいが、**新しいエントリは書かない**
- 壊れたエントリに対する `update` も掃除して no-op でよい
- `update` / `upsert` で既存 `createdAt` が無い正当エントリを更新する場合、`createdAt` は付与せず維持（undefined のまま）
- `enabled: false` のとき 3 メソッドとも no-op（core: `enabled: false`）
- ストレージ書き込み失敗は握りつぶす（core: 操作時失敗の握りつぶし）

## 関連

- テスト仕様: [`docs/tests/methods/`](../../tests/methods/)
- コア共通振る舞い: [`docs/specs/core/`](../core/)
- ドライバ: [`docs/specs/drivers/`](../drivers/)
