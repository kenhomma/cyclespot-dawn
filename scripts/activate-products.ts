/**
 * activate-products.ts
 *
 * DRAFT 状態の全商品を ACTIVE に一括変更するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/activate-products.ts --dry-run   # 対象商品の確認のみ
 *   npx tsx scripts/activate-products.ts              # 実行
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch {}

// ============================================================
// Shopify Admin API
// ============================================================

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';

async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!response.ok) {
    throw new Error(`Shopify API Error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('🚴 商品一括公開スクリプト');
  console.log('==========================');
  if (dryRun) console.log('⚠️  ドライランモード\n');

  // DRAFT 商品を全て取得
  console.log('📋 DRAFT 商品を取得中...');

  interface ProductNode {
    id: string;
    handle: string;
    title: string;
    status: string;
  }

  const draftProducts: ProductNode[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const variables: Record<string, unknown> = { first: 250 };
    if (cursor) variables.after = cursor;

    const result = await shopifyGraphQL<{
      products: {
        edges: Array<{ node: ProductNode; cursor: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(`
      query DraftProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "status:draft") {
          edges {
            node { id handle title status }
            cursor
          }
          pageInfo { hasNextPage }
        }
      }
    `, variables);

    for (const edge of result.products.edges) {
      draftProducts.push(edge.node);
      cursor = edge.cursor;
    }
    hasNext = result.products.pageInfo.hasNextPage;
  }

  console.log(`  → ${draftProducts.length} 件の DRAFT 商品を検出\n`);

  if (draftProducts.length === 0) {
    console.log('✅ DRAFT 商品はありません');
    return;
  }

  if (dryRun) {
    for (const p of draftProducts) {
      console.log(`  ${p.handle} — ${p.title}`);
    }
    console.log(`\n合計 ${draftProducts.length} 件が ACTIVE に変更されます`);
    return;
  }

  // 一括公開
  console.log('📤 商品を ACTIVE に変更中...\n');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < draftProducts.length; i++) {
    const product = draftProducts[i];

    try {
      const result = await shopifyGraphQL<{
        productUpdate: {
          product: { id: string } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }>(`
        mutation ActivateProduct($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id }
            userErrors { field message }
          }
        }
      `, { input: { id: product.id, status: 'ACTIVE' } });

      if (result.productUpdate.userErrors.length > 0) {
        console.error(`  ✗ [${i + 1}/${draftProducts.length}] ${product.handle} — ${result.productUpdate.userErrors.map(e => e.message).join('; ')}`);
        errorCount++;
      } else {
        console.log(`  ✓ [${i + 1}/${draftProducts.length}] ${product.handle} — ${product.title}`);
        successCount++;
      }
    } catch (err) {
      console.error(`  ✗ [${i + 1}/${draftProducts.length}] ${product.handle} — ${err instanceof Error ? err.message : String(err)}`);
      errorCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\n==========================');
  console.log(`✅ 完了: 成功 ${successCount} 件, 失敗 ${errorCount} 件`);
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
