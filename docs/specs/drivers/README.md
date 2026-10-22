# drivers 仕様

現行バージョンに存在する **ストレージドライバ**（localStorage / IndexedDB）の正本。  
テストは [`docs/tests/drivers/`](../../tests/drivers/)。

由来: 旧 `docs/tests/test-spec-cachian.md` §3.4。

## 概要

ドライバ factory（`src/drivers/*.ts`）が `StorageAdapter` を返す。生成時に `assertStorageAvailable` し、バックエンド API が無い環境では `CachianEnvironmentError`（core の環境ガード契約）。

`StorageAdapter`（`src/drivers/types.ts`）:

| メソッド | 役割 |
|----------|------|
| `get` / `set` / `remove` | 物理キー単位の読み書き削除 |
| `clear(keyPrefix)` | localStorage: 接頭辞一致キーを削除。IndexedDB: **object store 全体**を `clear`（`keyPrefix` は無視） |
| `list(keyPrefix)` | 接頭辞配下の正当エントリを列挙（壊れた値は掃除してスキップしてよい） |

npm ルートは `StorageAdapter` を export しない。CDN エントリと型利用・実装詳細としての形状は公開するが、任意カスタムドライバの互換は保証しない。

### `localStorageDriver()`

- 引数なし
- localStorage が使えなければ `CachianEnvironmentError`
- エントリは `JSON.stringify` した文字列として保存
- 読み取り時の JSON 失敗・非エントリは削除して miss
- `setItem` 失敗（Quota 等）は握りつぶす

### `indexedDBDriver(options?)`

型 `IndexedDBDriverOptions`（サブパスから export）:

| フィールド | 型 | 既定 |
|------------|-----|------|
| `dbName` | `string` | `"cachian"` |
| `storeName` | `string` | `"entries"` |

- IndexedDB が使えなければ `CachianEnvironmentError`
- エントリはオブジェクトのまま structured clone で保存（JSON 文字列化しない）
- DB open は固定 version `1` に縛らず、必要なら upgrade で store を追加（`src/drivers/indexedDB.ts`）

## 関連

- テスト仕様: [`docs/tests/drivers/`](../../tests/drivers/)
- コア: [`docs/specs/core/`](../core/)
- メソッド: [`docs/specs/methods/`](../methods/)
