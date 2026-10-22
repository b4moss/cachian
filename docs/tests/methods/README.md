# テスト仕様: methods

ドメイン: `methods`。契約正本は [`docs/specs/methods/`](../../specs/methods/)。

メソッドの受け入れケースの大部分はドライバ非依存の **TC-C** として [`../core/`](../core/) に置く（同一 SoT を分割した際の配置）。  
本ファイルはメソッド面の索引と、v0.6.0 破壊的変更の確認観点をまとめる。

## 破壊的変更サマリ（v0.6.0）

| 旧 API | 新 API |
|--------|--------|
| `cache.clear()` / `@b4moss/cachian/methods/clear` | `cache.purge({ all: true })`（`methods/purge`） |
| 複数キーを `remove` で削除しようとすること | `remove(key)` は単一キーのみ。複数は `purge({ keys })` |

## 確認観点（core の TC へのマップ）

| 観点 | 参照 TC（`docs/tests/core/`） |
|------|-------------------------------|
| `remove` 単一キー | TC-C11 |
| `has` | TC-C12 |
| `purge({ all: true })` | TC-C14 / TC-C17 |
| `purge({ keys })` | TC-C18 |
| `purge({ olderThan })` | TC-C19〜C21 |
| `set` / `update` / `upsert` | TC-C22〜C26 / TC-C32（`update` 系。環境系の同 ID とはタイトルで区別） |
| 絶対時刻パージ | TC-C27〜C31 |
| `purge({ expired: true })` | TC-C36〜C40 |
| MethodDef 組み立て | TC-M01〜M06 |

実装テスト SoT: `src/createCache.test.ts`。ドライバ固有の purge 範囲は [`../drivers/`](../drivers/)（TC-LS / TC-IDB）。

## 関連仕様

- [`docs/specs/methods/`](../../specs/methods/)
- [`docs/tests/core/`](../core/)
- [`docs/tests/drivers/`](../drivers/)
