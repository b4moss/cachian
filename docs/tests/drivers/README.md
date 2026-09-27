# テスト仕様: drivers

ドメイン: `drivers`。契約正本は [`docs/specs/drivers/`](../../specs/drivers/)。  
共通ケース（TC-C）は [`../core/`](../core/) を localStorage / IndexedDB の両方で満たすこと。

## localStorage 固有（TC-LS）

### TC-LS01: 既定テストヘルパのドライバが localStorage

- **操作**: `createTestCache()` で `set`
- **期待**: stub した `localStorage.setItem` が呼ばれる（IndexedDB は触らない）

### TC-LS02: 保存値が JSON エントリ文字列

- **操作**: `await set("https://example/data.json", { x: 1 })`
- **期待**: `getItem` で得た文字列を `JSON.parse` すると `{ expiresAt: number, data: { x: 1 }, createdAt: number }`

### TC-LS03: `purge({ all: true })` が他 prefix を消さない

- `purge({ all: true })` 範囲 / TC-C14 の localStorage 詳細。必須
- **操作**: prefix 付きインスタンスで `await purge({ all: true })`
- **期待**: 自 prefix 配下のみ削除。他 prefix / 無 prefix は残る

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

## IndexedDB 固有（TC-IDB）

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
- TC-C11（remove・単一キー）
- TC-C13（keyPrefix。**仕様は物理キーへ prefix を載せる**）
- TC-C14（`purge({ all: true })` の store 範囲）
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

## 関連仕様

- [`docs/specs/drivers/`](../../specs/drivers/)
- [`docs/tests/core/`](../core/)
