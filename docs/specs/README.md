# specs

現行バージョンに存在する機能の仕様正本。ドメインで切る（SemVer フォルダは使わない）。

| ドメイン | 内容 |
|----------|------|
| [`core/`](./core/) | `createCache`・環境ガード・エントリ形式・共通振る舞い・パッケージ公開面 |
| [`drivers/`](./drivers/) | localStorage / IndexedDB ドライバ |
| [`methods/`](./methods/) | MethodDef（get/set/update/upsert/remove/has/purge） |
| [`ops/`](./ops/) | CI/CD 契約（[`ci-cd.md`](./ops/ci-cd.md) / [`ci-cd.ja.md`](./ops/ci-cd.ja.md)） |

テスト仕様は同じドメイン名で [`../tests/`](../tests/)。
