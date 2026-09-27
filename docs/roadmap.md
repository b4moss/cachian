# Roadmap

SemVer・マイルストーンのハブ。詳細な現行契約は [`specs/`](./specs/)、これからやる内容は [`plans/`](./plans/)。

| 版 | 状態 | 要点 |
|----|------|------|
| [v0.6.0](https://github.com/b4moss/cachian/releases/tag/v0.6.0) | 現行 | 公開 `clear` 廃止 → `purge({ all: true })`。`remove` は単一キーのみ |
| [v0.5.0](https://github.com/b4moss/cachian/releases/tag/v0.5.0) | 出荷済み | `purge({ expired: true })` |
| [v0.4.0](https://github.com/b4moss/cachian/releases/tag/v0.4.0) | 出荷済み | ドライバ／メソッド分割・組み立て必須 |
| [v0.3.x](https://github.com/b4moss/cachian/releases/tag/v0.3.1) | 出荷済み | 初期汎用キャッシュ API |
| [v0.2.0](https://github.com/b4moss/cachian/releases/tag/v0.2.0) | 出荷済み | 初期公開 |

次の版の意図スタブができたときは `docs/plans/vX.Y.Z/`（または `unscheduled/`）へ置く。実装完了後は対応する `docs/specs/{domain}/` へ移す。
