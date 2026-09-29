# @b4moss/cachian

プロダクトの意味的な pillar 正本（目的・スコープ・技術方針のハブ）。  
OKF の版索引は [`index.md`](./index.md)（`okf_version` のみ）。

## 目的

ブラウザ専用のツリーシェイク可能なキャッシュヘルパー。  
[`@b4moss/jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id) のキャッシュロジックを外出し・汎用化し、キー・値はドメイン非依存とする。

## スコープ

- **やること**
  - ドライバ（localStorage / IndexedDB）と必要な MethodDef（`get` / `set` / `update` / `upsert` / `remove` / `has` / `purge`）だけを選んで組み立てる
  - 非同期 API・TTL・エントリ形式 `{ expiresAt, data, createdAt? }`・条件付きパージ
  - ブラウザ環境ガード（`CachianEnvironmentError`。現行はドライバ factory 時）
  - CDN / IIFE バンドル（`createFullCache` 含む。詳細は [`specs/core/`](./specs/core/)）
- **やらぬこと**
  - Node / SSR 向けストレージ実装の保証
  - CDN / IIFE のブラウザ手動確認を受け入れ TC の必須にすること
  - 任意カスタム `StorageAdapter` の公開互換保証（形状は実装詳細。npm ルートからは非 export）
  - ドキュメントサイト（現状 out of scope）

## 技術方針

- 単一 npm パッケージ `@b4moss/cachian`（TypeScript / Vitest）。テスト正本ファイルは `src/createCache.test.ts`
- 公開面はサブパス exports（ルートから drivers / methods を再エクスポートしない）
- IIFE は `src/cdn.ts` → `dist/cachian.iife(.min).js`（グローバル `Cachian`）
- `sideEffects: false`、ランタイム依存ゼロ
- CI/CD 契約: [`specs/ops/ci-cd.md`](./specs/ops/ci-cd.md)（日本語: [`ci-cd.ja.md`](./specs/ops/ci-cd.ja.md)）
- 開発ルール: [`charter/`](./charter/)（OKF v0.1: [`charter/okf/`](./charter/okf/)）

現行機能の仕様正本は `docs/specs/`（ドメイン: `core` / `drivers` / `methods` / `ops`）。  
受け入れケースは `docs/tests/`（同じドメイン切り）。

## 索引

- [roadmap](./roadmap.md) — SemVer・マイルストーン
- [wishlist](./wishlist.md) — PO メモ
- [plans](./plans/) — これからやる内容
- [specs](./specs/) — 現行仕様
- [tests](./tests/) — テスト仕様
- [憲章](./charter/) — 開発ルール
- [override-charter](./override-charter.md) — 憲章オーバーライド
- ルート [README](../README.md) / [README (ja)](../README_ja.md)
