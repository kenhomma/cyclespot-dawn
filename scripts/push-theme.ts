/**
 * push-theme.ts
 *
 * Shopify Admin REST API を使って、新規テーマのカスタムファイル（sections, templates, assets）
 * をアップロードする。既存テーマに対してファイルを PUT する方式。
 *
 * 使い方:
 *   npx tsx scripts/push-theme.ts [--theme-id=THEME_ID]
 *
 * theme-id を指定しない場合はテーマ一覧を表示して終了する。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const BASE = `https://${DOMAIN}/admin/api/2024-01`;

async function api(endpoint: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// カスタムファイルのみをアップロード対象にする
const CUSTOM_FILES = [
  // 店舗ページ
  'sections/store-list.liquid',
  'sections/store-detail.liquid',
  'sections/main-store-detail.liquid',
  'snippets/repair-prices.liquid',
  'assets/section-store-list.css',
  'assets/section-store-detail.css',
  'templates/page.stores.json',
  'templates/page.store-detail.json',
  'templates/metaobject/store.json',
  // 商品ページ
  'snippets/product-specs.liquid',
  'snippets/catalog-price.liquid',
  'snippets/ec-link-button.liquid',
  'snippets/brand-logo.liquid',
  'snippets/card-product.liquid',
  'templates/product.json',
  'templates/collection.json',
  // サイト全体
  'templates/index.json',
  'sections/header-group.json',
  'sections/footer-group.json',
];

async function main() {
  const themeIdArg = process.argv.find(a => a.startsWith('--theme-id='));
  const themeId = themeIdArg?.split('=')[1];

  // テーマ一覧
  console.log('📋 テーマ一覧を取得中...');
  const { themes } = await api('themes.json') as any;

  for (const t of themes) {
    const marker = t.role === 'main' ? ' ★ (公開中)' : '';
    console.log(`  ${t.id} | ${t.name} | ${t.role}${marker}`);
  }

  if (!themeId) {
    console.log('\nテーマIDを指定して再実行してください:');
    console.log('  npx tsx scripts/push-theme.ts --theme-id=XXXXX');
    return;
  }

  console.log(`\n📤 テーマ ${themeId} にファイルをアップロード中...`);

  const themeRoot = path.resolve(__dirname, '..');
  let success = 0;
  let failed = 0;

  for (const file of CUSTOM_FILES) {
    const filePath = path.resolve(themeRoot, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⏭ ${file} (ファイルなし)`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    try {
      await api(`themes/${themeId}/assets.json`, 'PUT', {
        asset: {
          key: file,
          value: content,
        },
      });
      console.log(`  ✓ ${file}`);
      success++;
    } catch (err) {
      console.error(`  ✗ ${file}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n✅ 完了: 成功 ${success}, 失敗 ${failed}`);
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
