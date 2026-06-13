# Firebase Cloud Functions — Justfile
# 使い方: just <タスク名>

# デフォルト: タスク一覧を表示
default:
    @just --list

# ───────────────────────────────────────────────
# セットアップ
# ───────────────────────────────────────────────

# 依存パッケージをインストール
install:
    npm --prefix functions install

# ───────────────────────────────────────────────
# 開発
# ───────────────────────────────────────────────

# TypeScript をビルド（一回）
build:
    npm --prefix functions run build

# TypeScript をウォッチモードでビルド
watch:
    npm --prefix functions run build:watch

# Lint を実行
lint:
    npm --prefix functions run lint

# Lint + Build（デプロイ前と同じ検証）
check: lint build

# ───────────────────────────────────────────────
# エミュレーター
# ───────────────────────────────────────────────

# Functions エミュレーターを起動（ビルド込み）
emulate:
    npm --prefix functions run serve

# Firebase Functions のインタラクティブシェルを起動
shell:
    npm --prefix functions run shell

# ───────────────────────────────────────────────
# デプロイ
# ───────────────────────────────────────────────

# Functions をデプロイ（lint & build は firebase.json の predeploy で実行）
deploy:
    npm --prefix functions run deploy

# ───────────────────────────────────────────────
# ログ・モニタリング
# ───────────────────────────────────────────────

# Firebase Functions のログを表示
logs:
    npm --prefix functions run logs

# ───────────────────────────────────────────────
# セキュリティ (gitleaks)
# ───────────────────────────────────────────────

# リポジトリ全体のシークレットをスキャン
scan:
    gitleaks detect --config .gitleaks.toml --redact --source .

# ステージング済みファイルのみスキャン（pre-commit と同じ内容）
scan-staged:
    gitleaks protect --config .gitleaks.toml --redact --staged

# ───────────────────────────────────────────────
# クリーンアップ
# ───────────────────────────────────────────────

# ビルド成果物（lib/）を削除
clean:
    rm -rf functions/lib

# ビルド成果物 + node_modules を削除
clean-all: clean
    rm -rf functions/node_modules
