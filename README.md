# cyclespot-dawn

サイクルスポット・ル・サイクの Shopify テーマ（Dawn ベース）

対象ストア: `cyclespot-lecyc.myshopify.com`

## セットアップ

```bash
cd shopify/cyclespot-dawn
cp .env.example .env    # SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN を設定
npm install
```

## テーマ操作コマンド

### テーマをプッシュ（変更したファイルをアップロード）

```bash
# 全カスタムファイルをプッシュ
npx tsx scripts/push-theme.ts --theme-id=187922841966

# 特定ファイルのみ
npx tsx scripts/push-theme.ts --theme-id=187922841966 -- templates/index.json sections/store-detail.liquid
```

### テーマプレビュー（Shopify CLI）

```bash
shopify theme dev --store=cyclespot-lecyc.myshopify.com
```

## データパイプラインコマンド

### 店舗ページ一括作成

```bash
npx tsx scripts/create-store-pages.ts            # 実行
npx tsx scripts/create-store-pages.ts --dry-run   # プレビューのみ
```

### 在庫データ同期

```bash
npx tsx scripts/sync-inventory.ts --csv=../../docs/sync-inventory.csv    # 全店舗同期
npx tsx scripts/sync-inventory.ts --csv=path.csv --store=001             # 特定店舗のみ
npx tsx scripts/sync-inventory.ts --dry-run --csv=path.csv               # プレビュー
npx tsx scripts/sync-inventory.ts --setup                                # メタフィールド定義を作成
```

### ナビゲーションメニュー設定

```bash
npx tsx scripts/setup-menus.ts            # 現在のメニュー確認
npx tsx scripts/setup-menus.ts --update   # ページ作成 + メニュー更新
```

### コンテンツページ更新

```bash
npx tsx scripts/setup-content-pages.ts    # ストーリー・企業情報ページを設定
```

## その他のスクリプト

| スクリプト | 説明 |
|-----------|------|
| `scripts/create-collections.ts` | カテゴリ・ブランドコレクション作成 |
| `scripts/create-metaobject-definition.ts` | store メタオブジェクト定義 |
| `scripts/import-stores.ts` | TSV から店舗メタオブジェクト投入 |
| `scripts/import-products.ts` | 商品データ一括投入 |
| `scripts/setup-product-metafields.ts` | 商品メタフィールド定義 |

## ブランチ運用

- `main` — 本番環境にプッシュする安定版
- 機能追加・大きな変更は `feature/xxx` ブランチで作業し、確認後に `main` にマージ
- テーマ変更前にコミットを作ること（ロールバック可能にするため）

## カスタムセクション・スニペット

| ファイル | 用途 |
|---------|------|
| `sections/store-detail.liquid` | 店舗詳細ページ（メタオブジェクト連携） |
| `sections/store-list.liquid` | 店舗一覧ページ |
| `snippets/repair-prices.liquid` | 修理工賃表 |
| `snippets/product-specs.liquid` | 商品スペック表示 |
| `snippets/ec-link-button.liquid` | EC リンクボタン |
| `snippets/brand-logo.liquid` | ブランドロゴ表示 |

## 注意事項

- `cyclespot-online.myshopify.com` への変更は禁止（参照のみ可）
- テーマ ID `187922841966` が現在の公開テーマ（Dawn）
