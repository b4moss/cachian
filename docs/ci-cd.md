# CI / CD (direction)

This document locks the CI/CD direction for `@b4moss/cachian`, adapted from [`jp-local-gov-id`](https://github.com/b4moss/jp-local-gov-id) (`docs/ci-cd.md`). Implementation of workflows follows this plan; this file is the contract.

## Scope vs jp-local-gov-id

| Area | jp-local-gov-id | cachian (this repo) |
|------|-----------------|---------------------|
| Layout | npm workspaces monorepo | Single package `@b4moss/cachian` |
| CI trigger | PR base `develop` / `dev-*` | Same |
| Local gate | `npm run ci:local` (`act`) | Same |
| Coverage | Codecov (informational) | Same |
| SAST | CodeQL (non-blocking) | Same |
| Supply chain | OpenSSF Scorecard on `main` | Same |
| Dependabot | npm + github-actions (weekly) | Same (root only; no `/scripts` workspace) |
| npm publish | `data-v*` / `app-v*` → Release → provenance | Single tag `v*` → Release → provenance |
| Docs site | `site-v*` → GitHub Pages | **Out of scope** (no docs site yet) |
| Source monitor | MIC Excel hash cron | **Out of scope** (no external data) |

## Branch model

```text
feature/* / cursor/*
        │
        ▼
  PR → develop / dev-*     ← CI (Gate → Test ‖ Build → "Test & Build")
        │
        ▼
     release               ← tags v* only from here (create branch when first release)
        │
        ▼
      main                 ← Scorecard; stable default
```

- Day-to-day integration: `develop` (and versioned `dev-*` when needed).
- Release cut: merge into `release`, then tag `vX.Y.Z` (or prerelease `vX.Y.Z-rc.N`).
- Do **not** rely on CI for PRs into `main` / `release` (same rule as the reference).

## Local gate (required before PR)

Before opening or updating a PR targeting `develop` or `dev-*`, **`act` must succeed** (humans and Cloud Agents).

```bash
# Preferred (Docker + nektos/act)
npm run ci:local

# Equivalent
act pull_request -W .github/workflows/ci.yml
```

Defaults live in [`.actrc`](../.actrc) (to be added with workflows). Under `act`, the CI gate always runs Test/Build (`ACT=true`). Codecov is skipped when `ACT` is set.

Without Docker (some Cloud Agent environments):

```bash
npm run ci:local:fallback   # npm ci && npm test && npm run build
```

Do not open or update a PR while this gate is failing.

### Agents

1. Run `npm run ci:local` (or `ci:local:fallback` only when Docker is absent).
2. If non-zero, fix and re-run; do not call the PR creation tool yet.
3. Only then open/update the PR.

## Planned workflows

| File | Role | Status |
|------|------|--------|
| `.github/workflows/ci.yml` | PR CI: Gate → Test ‖ Build → aggregate **Test & Build** | Planned |
| `.github/workflows/codeql.yml` | CodeQL on PR to `develop`/`dev-*`, push to `main`, weekly | Planned |
| `.github/workflows/scorecard.yml` | OpenSSF Scorecard on `main` + schedule | Planned |
| `.github/workflows/release-on-tag.yml` | Push `v*` → create GitHub Release | Planned |
| `.github/workflows/publish.yml` | Release published → npm pack + provenance publish | Planned |
| `.github/dependabot.yml` | Weekly npm + Actions updates (grouped, no auto-merge) | Planned |
| `.github/codeql/codeql-config.yml` | Ignore `dist/**`, `coverage/**` | Planned |
| `codecov.yml` | Project/patch informational; no PR comment | Planned |
| `deploy-docs.yml` / `monitor-source-hash.yml` | — | Not adopted |

### CI rules (mirror reference)

| Item | Rule |
|------|------|
| Trigger | `pull_request` whose **base** is `develop` or `dev-*` |
| Not triggered | Push to arbitrary branches; PRs into `main` / `release` |
| Skip heavy jobs | Same head SHA already has a successful `CI` workflow run |
| Docs-only | Changes limited to `docs/**`, `*.md`, `LICENSE`, `.github/**/*.md` → skip Test/Build on GitHub; local `act` still full |
| Parallelism | `Test` and `Build` after `Gate` |
| Required check name | Aggregate job **`Test & Build`** |
| Node | `24` (engines `>=24`), `npm ci`, pin Actions by SHA |

Coverage path for Codecov: `coverage/lcov.info` (single package root; not a workspace path).

### CD — npm publish

| Item | Rule |
|------|------|
| Trigger | GitHub Release **published** for `v*`, or `workflow_dispatch` with a tag |
| Ancestry | Tag commit must be an ancestor of `origin/release` |
| Verify skip | If that SHA already has CI success → skip Test/Build; always pack + provenance publish |
| Dist-tag | Prerelease versions (`*-rc.*` etc.) publish with `--tag rc`; otherwise `latest` |
| Auth | `NPM_TOKEN` + OIDC provenance (`id-token: write`) |

Create `v*` tags from the **`release`** branch only.

## Badges (README)

Displayed on `README.md` / `README_ja.md`:

| Badge | Source |
|-------|--------|
| CI | `actions/workflows/ci.yml/badge.svg` |
| Coverage | shields.io Codecov |
| npm | shields.io npm version for `@b4moss/cachian` |
| Release | GitHub release (include prereleases, filter `v*`) |
| License | GitHub license |
| OpenSSF Scorecard | dynamic JSON from `api.scorecard.dev` |

Until workflows run and the package is published, some badges may show unknown/empty; that is expected before the implement phase.

## Implementation order

1. **This PR** — direction docs + README badges (no workflows yet, or minimal stubs only if needed for badge URLs).
2. **CI scaffold** — `ci.yml`, `.actrc`, `codecov.yml`, `package.json` scripts `ci:local` / `ci:local:fallback`, Dependabot.
3. **Security** — CodeQL + Scorecard.
4. **CD** — `release` branch convention, `release-on-tag.yml`, `publish.yml` (after npm org token / OIDC is ready).
5. **Branch protection** — require check name **`Test & Build`** on `develop` / `dev-*`.

## Quick reference

```text
local change → npm run ci:local (must pass)
            → open PR to develop / dev-*
            → CI Gate → Test ‖ Build → "Test & Build"
tag v* on release → Release → Publish (reuse CI or re-verify) → npm
```
