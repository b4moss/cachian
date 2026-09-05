# CI / CD（方針）

`@b4moss/cachian` の CI/CD 方針を、[`jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id)（`docs/ci-cd.ja.md`）を参考に固定します。ワークフロー実装はこの文書を契約とします。

## jp-local-gov-id との差分

| 領域 | jp-local-gov-id | cachian（本リポジトリ） |
|------|-----------------|-------------------------|
| 構成 | npm workspaces モノレポ | 単一パッケージ `@b4moss/cachian` |
| CI トリガ | PR base が `develop` / `dev-*` | 同じ |
| ローカルゲート | `npm run ci:local`（`act`） | 同じ |
| カバレッジ | Codecov（informational） | 同じ |
| SAST | CodeQL（非ブロッキング） | 同じ |
| サプライチェーン | OpenSSF Scorecard（`main`） | 同じ |
| Dependabot | npm + github-actions（週次） | 同じ（ルートのみ。`/scripts` workspace なし） |
| npm publish | `data-v*` / `app-v*` → Release → provenance | 単一タグ `v*` → Release → provenance |
| ドキュメントサイト | `site-v*` → GitHub Pages | **対象外**（現状サイトなし） |
| ソース監視 | 総務省 Excel ハッシュ cron | **対象外**（外部データなし） |

## ブランチモデル

```text
feature/* / cursor/*
        │
        ▼
  PR → develop / dev-*     ← CI（Gate → Test ‖ Build → "Test & Build"）
        │
        ▼
     release               ← v* タグはここからのみ（初回リリース時にブランチ作成）
        │
        ▼
      main                 ← Scorecard・既定ブランチ
```

- 日常の統合先: `develop`（必要時は版付き `dev-*`）
- リリース: `release` に取り込み、`vX.Y.Z`（または `vX.Y.Z-rc.N`）をタグ付け
- `main` / `release` 向け PR では CI に依存しない（参考リポジトリと同じ）

## ローカルゲート（PR 前必須）

`develop` / `dev-*` 向けの PR を作成・更新する前に、**`act` の成功を必須**とします（人間・Cloud Agent 共通）。

```bash
# 推奨（Docker + nektos/act）
npm run ci:local

# 同等
act pull_request -W .github/workflows/ci.yml
```

既定は [`.actrc`](../.actrc)（ワークフロー追加時に同梱）。`act` 実行時はゲートが Test/Build を必ず実行します（`ACT=true`）。Codecov は `ACT` 時にスキップします。

Docker が無い環境（一部の Cloud Agent など）:

```bash
npm run ci:local:fallback   # npm ci && npm test && npm run build
```

ゲート失敗のまま PR しないでください。

### エージェント向け

1. `npm run ci:local` を実行（Docker が無いときだけ `ci:local:fallback`）
2. 非 0 なら修正して再実行。PR 作成ツールはまだ呼ばない
3. 成功後に PR を作成・更新する

## 予定ワークフロー

| ファイル | 役割 | 状態 |
|----------|------|------|
| `.github/workflows/ci.yml` | PR CI: Gate → Test ‖ Build → 集約 **Test & Build** | 予定 |
| `.github/workflows/codeql.yml` | CodeQL（`develop`/`dev-*` PR、`main` push、週次） | 予定 |
| `.github/workflows/scorecard.yml` | OpenSSF Scorecard（`main` + schedule） | 予定 |
| `.github/workflows/release-on-tag.yml` | `v*` push → GitHub Release 作成 | 予定 |
| `.github/workflows/publish.yml` | Release published → npm pack + provenance publish | 予定 |
| `.github/dependabot.yml` | 週次 npm + Actions（グループ化、自動マージなし） | 予定 |
| `.github/codeql/codeql-config.yml` | `dist/**`・`coverage/**` を除外 | 予定 |
| `codecov.yml` | project/patch は informational、PR コメントなし | 予定 |
| `deploy-docs.yml` / `monitor-source-hash.yml` | — | 採用しない |

### CI ルール（参考リポジトリ踏襲）

| 項目 | ルール |
|------|--------|
| トリガ | base が `develop` または `dev-*` の `pull_request` |
| 発火しない例 | 任意ブランチへの push、`main` / `release` などへの PR |
| 重いジョブのスキップ | 同一 head SHA に成功済みの `CI` ワークフローがある |
| docs のみ | `docs/**`・`*.md`・`LICENSE`・`.github/**/*.md` のみ → GitHub 上は Test/Build スキップ。ローカル act は原則フル |
| 並行 | `Gate` の後に `Test` と `Build` を並行 |
| required check 名 | 集約ジョブ **`Test & Build`** |
| Node | `24`（engines `>=24`）、`npm ci`、Actions は SHA ピン |

Codecov のカバレッジパス: `coverage/lcov.info`（単一パッケージルート）。

### CD — npm publish

| 項目 | ルール |
|------|--------|
| トリガ | `v*` の GitHub Release **published**、またはタグ指定の `workflow_dispatch` |
| 祖先チェック | タグのコミットが `origin/release` の祖先であること |
| 検証スキップ | その SHA に CI success があれば Test/Build 省略。pack + provenance publish は常に実行 |
| dist-tag | プレリリース（`*-rc.*` 等）は `--tag rc`、それ以外は `latest` |
| 認証 | `NPM_TOKEN` + OIDC provenance（`id-token: write`） |

`v*` タグは **`release` ブランチから**打つ。

## バッジ（README）

`README.md` / `README_ja.md` に掲示:

| バッジ | ソース |
|--------|--------|
| CI | `actions/workflows/ci.yml/badge.svg` |
| Coverage | shields.io Codecov |
| npm | shields.io npm（`@b4moss/cachian`） |
| Release | GitHub release（プレリリース含む、`v*` フィルタ） |
| License | GitHub license |
| OpenSSF Scorecard | `api.scorecard.dev` の dynamic JSON |

ワークフロー未稼働・未公開の間は一部バッジが空／不明になることがあります（実装フェーズ前は想定内）。

## 実装順

1. **本 PR** — 方針ドキュメント + README バッジ（ワークフローは未実装、またはバッジ用に最小限）
2. **CI スキャフォールド** — `ci.yml`、`.actrc`、`codecov.yml`、`ci:local` / `ci:local:fallback`、Dependabot
3. **セキュリティ** — CodeQL + Scorecard
4. **CD** — `release` ブランチ運用、`release-on-tag.yml`、`publish.yml`（npm トークン / OIDC 準備後）
5. **ブランチ保護** — `develop` / `dev-*` で **`Test & Build`** を required に

## 流れ

```text
ローカル変更 → npm run ci:local（必須）
            → develop / dev-* へ PR
            → CI Gate → Test ‖ Build → "Test & Build"
release 上のタグ v* → Release → Publish（CI 再利用 or 再検証）→ npm
```
