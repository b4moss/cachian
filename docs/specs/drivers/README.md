# drivers 仕様

現行バージョンに存在する **ストレージドライバ**（localStorage / IndexedDB）の正本。  
テストは [`docs/tests/drivers/`](../../tests/drivers/)。

由来: 旧 `docs/tests/test-spec-cachian.md` §3.4。

## 概要

ドライバ factory が `StorageAdapter` を返す。バックエンド API が無い環境では `CachianEnvironmentError`（core の環境ガード契約に従う）。

### `localStorageDriver()`

- 引数なし
- localStorage が使えなければ `CachianEnvironmentError`（§3.3.1）
- エントリは `JSON.stringify` した文字列として保存

### `indexedDBDriver(options?)`

| フィールド | 型 | 既定 |
|------------|-----|------|
| `dbName` | `string` | `"cachian"` |
| `storeName` | `string` | `"entries"` |

- IndexedDB が使えなければ `CachianEnvironmentError`
- エントリはオブジェクトのまま structured clone で保存（JSON 文字列化しない）

## 関連

- テスト仕様: [`docs/tests/drivers/`](../../tests/drivers/)
- コア: [`docs/specs/core/`](../core/)
- メソッド: [`docs/specs/methods/`](../methods/)
