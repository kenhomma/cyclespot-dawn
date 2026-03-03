/**
 * create-collections.ts
 *
 * カテゴリ別・ブランド別の自動コレクションを作成するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/create-collections.ts --dry-run   # 作成予定の確認のみ
 *   npx tsx scripts/create-collections.ts              # 実行
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
// 型定義
// ============================================================

interface CollectionDef {
  title: string;
  handle: string;
  ruleColumn: 'TYPE' | 'VENDOR';
  ruleCondition: string;
  sortOrder: string;
}

// ============================================================
// コレクション定義
// ============================================================

/** カテゴリ別コレクション（product_type ベース） */
const CATEGORY_COLLECTIONS: CollectionDef[] = [
  { title: 'シティサイクル', handle: 'city-bikes', ruleColumn: 'TYPE', ruleCondition: 'シティ車', sortOrder: 'BEST_SELLING' },
  { title: '軽快車', handle: 'keikai-bikes', ruleColumn: 'TYPE', ruleCondition: '軽快車', sortOrder: 'BEST_SELLING' },
  { title: 'スポーツバイク', handle: 'sports-bikes', ruleColumn: 'TYPE', ruleCondition: 'スポーツ車', sortOrder: 'BEST_SELLING' },
  { title: '電動アシスト自転車', handle: 'e-bikes', ruleColumn: 'TYPE', ruleCondition: '電動車', sortOrder: 'BEST_SELLING' },
  { title: 'ミニベロ・小径車', handle: 'mini-velo', ruleColumn: 'TYPE', ruleCondition: '小径車', sortOrder: 'BEST_SELLING' },
  { title: '子供用自転車', handle: 'kids-bikes', ruleColumn: 'TYPE', ruleCondition: '子供車', sortOrder: 'BEST_SELLING' },
  { title: '幼児用自転車', handle: 'toddler-bikes', ruleColumn: 'TYPE', ruleCondition: '幼児車', sortOrder: 'BEST_SELLING' },
  { title: '一輪車・三輪車', handle: 'unicycle-tricycle', ruleColumn: 'TYPE', ruleCondition: '一輪・三輪車', sortOrder: 'BEST_SELLING' },
];

/** ブランド別コレクション（vendor ベース） */
const BRAND_COLLECTIONS: CollectionDef[] = [
  { title: 'ブリヂストンサイクル', handle: 'brand-bridgestone', ruleColumn: 'VENDOR', ruleCondition: 'ブリヂストンサイクル', sortOrder: 'BEST_SELLING' },
  { title: 'サイクルスポット', handle: 'brand-cyclespot', ruleColumn: 'VENDOR', ruleCondition: 'サイクルスポット', sortOrder: 'BEST_SELLING' },
  { title: 'LOUIS GARNEAU', handle: 'brand-louis-garneau', ruleColumn: 'VENDOR', ruleCondition: 'LOUIS GARNEAU', sortOrder: 'BEST_SELLING' },
  { title: 'MERIDA', handle: 'brand-merida', ruleColumn: 'VENDOR', ruleCondition: 'MERIDA', sortOrder: 'BEST_SELLING' },
  { title: 'パナソニック', handle: 'brand-panasonic', ruleColumn: 'VENDOR', ruleCondition: 'パナソニック', sortOrder: 'BEST_SELLING' },
  { title: 'GIANT', handle: 'brand-giant', ruleColumn: 'VENDOR', ruleCondition: 'GIANT', sortOrder: 'BEST_SELLING' },
  { title: 'MARIN', handle: 'brand-marin', ruleColumn: 'VENDOR', ruleCondition: 'MARIN', sortOrder: 'BEST_SELLING' },
  { title: 'GIOS', handle: 'brand-gios', ruleColumn: 'VENDOR', ruleCondition: 'GIOS', sortOrder: 'BEST_SELLING' },
  { title: 'ヤマハ', handle: 'brand-yamaha', ruleColumn: 'VENDOR', ruleCondition: 'ヤマハ', sortOrder: 'BEST_SELLING' },
  { title: 'KhodaaBloom', handle: 'brand-khodaabloom', ruleColumn: 'VENDOR', ruleCondition: 'KhodaaBloom', sortOrder: 'BEST_SELLING' },
  { title: 'Bianchi', handle: 'brand-bianchi', ruleColumn: 'VENDOR', ruleCondition: 'Bianchi', sortOrder: 'BEST_SELLING' },
  { title: 'a.n.design works', handle: 'brand-and-works', ruleColumn: 'VENDOR', ruleCondition: 'a.n.design works', sortOrder: 'BEST_SELLING' },
  { title: 'NESTO', handle: 'brand-nesto', ruleColumn: 'VENDOR', ruleCondition: 'NESTO', sortOrder: 'BEST_SELLING' },
  { title: 'tern', handle: 'brand-tern', ruleColumn: 'VENDOR', ruleCondition: 'tern', sortOrder: 'BEST_SELLING' },
  { title: 'JAMIS', handle: 'brand-jamis', ruleColumn: 'VENDOR', ruleCondition: 'JAMIS', sortOrder: 'BEST_SELLING' },
  { title: 'D-Bike', handle: 'brand-d-bike', ruleColumn: 'VENDOR', ruleCondition: 'D-Bike', sortOrder: 'BEST_SELLING' },
  { title: 'RENAULT', handle: 'brand-renault', ruleColumn: 'VENDOR', ruleCondition: 'RENAULT', sortOrder: 'BEST_SELLING' },
  { title: 'STRIDER', handle: 'brand-strider', ruleColumn: 'VENDOR', ruleCondition: 'STRIDER', sortOrder: 'BEST_SELLING' },
  { title: '!cycles', handle: 'brand-cycles', ruleColumn: 'VENDOR', ruleCondition: '!cycles', sortOrder: 'BEST_SELLING' },
  { title: 'HUMMER', handle: 'brand-hummer', ruleColumn: 'VENDOR', ruleCondition: 'HUMMER', sortOrder: 'BEST_SELLING' },
];

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
// 既存コレクション取得
// ============================================================

async function getExistingCollectionHandles(): Promise<Set<string>> {
  const handles = new Set<string>();
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const variables: Record<string, unknown> = { first: 250 };
    if (cursor) variables.after = cursor;

    const result = await shopifyGraphQL<{
      collections: {
        edges: Array<{ node: { handle: string }; cursor: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(`
      query Collections($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
          edges {
            node { handle }
            cursor
          }
          pageInfo { hasNextPage }
        }
      }
    `, variables);

    for (const edge of result.collections.edges) {
      handles.add(edge.node.handle);
      cursor = edge.cursor;
    }
    hasNext = result.collections.pageInfo.hasNextPage;
  }

  return handles;
}

// ============================================================
// コレクション作成
// ============================================================

const CREATE_COLLECTION = `
mutation CreateCollection($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection {
      id
      handle
      title
    }
    userErrors {
      field
      message
    }
  }
}
`;

async function createSmartCollection(def: CollectionDef): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await shopifyGraphQL<{
      collectionCreate: {
        collection: { id: string; handle: string; title: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(CREATE_COLLECTION, {
      input: {
        title: def.title,
        handle: def.handle,
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            {
              column: def.ruleColumn,
              relation: 'EQUALS',
              condition: def.ruleCondition,
            },
          ],
        },
        sortOrder: def.sortOrder,
      },
    });

    if (result.collectionCreate.userErrors.length > 0) {
      return { success: false, error: result.collectionCreate.userErrors.map(e => e.message).join('; ') };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('🚴 コレクション作成スクリプト');
  console.log('==============================');
  if (dryRun) console.log('⚠️  ドライランモード\n');

  const allCollections = [...CATEGORY_COLLECTIONS, ...BRAND_COLLECTIONS];

  console.log(`📋 作成予定: カテゴリ ${CATEGORY_COLLECTIONS.length} 件 + ブランド ${BRAND_COLLECTIONS.length} 件 = ${allCollections.length} 件\n`);

  if (dryRun) {
    console.log('【カテゴリ別】');
    for (const c of CATEGORY_COLLECTIONS) {
      console.log(`  ${c.handle} — ${c.title} (${c.ruleColumn} = "${c.ruleCondition}")`);
    }
    console.log('\n【ブランド別】');
    for (const c of BRAND_COLLECTIONS) {
      console.log(`  ${c.handle} — ${c.title} (${c.ruleColumn} = "${c.ruleCondition}")`);
    }
    return;
  }

  // 環境変数チェック
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    console.error('❌ 環境変数が設定されていません');
    process.exit(1);
  }

  // 既存コレクション取得
  console.log('📋 既存コレクションを確認中...');
  const existingHandles = await getExistingCollectionHandles();
  console.log(`  → ${existingHandles.size} 件の既存コレクションを検出\n`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // カテゴリ別
  console.log('【カテゴリ別コレクション】');
  for (const def of CATEGORY_COLLECTIONS) {
    if (existingHandles.has(def.handle)) {
      console.log(`  ⏭ ${def.handle} — 既に存在、スキップ`);
      skipCount++;
      continue;
    }

    const result = await createSmartCollection(def);
    if (result.success) {
      console.log(`  ✓ ${def.handle} — ${def.title}`);
      successCount++;
    } else {
      console.error(`  ✗ ${def.handle} — ${result.error}`);
      errorCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // ブランド別
  console.log('\n【ブランド別コレクション】');
  for (const def of BRAND_COLLECTIONS) {
    if (existingHandles.has(def.handle)) {
      console.log(`  ⏭ ${def.handle} — 既に存在、スキップ`);
      skipCount++;
      continue;
    }

    const result = await createSmartCollection(def);
    if (result.success) {
      console.log(`  ✓ ${def.handle} — ${def.title}`);
      successCount++;
    } else {
      console.error(`  ✗ ${def.handle} — ${result.error}`);
      errorCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n==============================');
  console.log(`✅ 完了: 成功 ${successCount} 件, スキップ ${skipCount} 件, 失敗 ${errorCount} 件`);
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
