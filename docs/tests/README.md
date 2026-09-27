# tests

テスト仕様（TDD 入力）。[`../specs/`](../specs/) と**同じドメイン切り**。SemVer フォルダは使わない。

| ドメイン | 内容 |
|----------|------|
| [`core/`](./core/) | 組み立て（TC-M）・ドライバ非依存コア（TC-C）・パッケージ面（TC-P）。SoT 実装テストは `src/createCache.test.ts` |
| [`drivers/`](./drivers/) | localStorage（TC-LS） / IndexedDB（TC-IDB） |
| [`methods/`](./methods/) | メソッド面の索引と v0.6 破壊的変更の確認マップ（詳細 TC は core） |

旧単一 SoT `test-spec-cachian.md` は上記ドメインへ分割・昇格済み。TC ラベルはコードの `it(...)` タイトルに同期（環境系で TC-C22〜C24 が update 系と重複している点を含む）。
