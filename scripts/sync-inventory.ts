/**
 * sync-inventory.ts
 *
 * 在庫CSV（store_code, sku, quantity）を読み込み、
 * - store metaobject の inventory_json フィールド（この店舗にある商品一覧）
 * - product metafield inventory.stores（この商品がある店舗一覧）
 * を双方向に生成・更新するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/sync-inventory.ts --dry-run              # プレビュー
 *   npx tsx scripts/sync-inventory.ts --setup                # メタフィールド定義作成
 *   npx tsx scripts/sync-inventory.ts                        # 全件実行
 *   npx tsx scripts/sync-inventory.ts --store=001中野        # 特定店舗のみ
 *   npx tsx scripts/sync-inventory.ts --csv=path/to/file.csv # CSVパス指定
 *
 * 環境変数 (.env):
 *   SHOPIFY_STORE_DOMAIN=cyclespot-lecyc.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxx
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

// ============================================================
// 型定義
// ============================================================

interface InventoryCsvRow {
  store_code: string;
  sku: string;
  quantity: number;
}

/** Shopify から取得する店舗情報 */
interface StoreInfo {
  metaobjectId: string;
  code: string;
  slug: string;
  name: string;
  type: string;     // cyclespot / le_cyc / other
  address: string;  // 都道府県を area として抽出
}

/** Shopify から取得する商品・バリアント情報 */
interface ProductInfo {
  productId: string;
  handle: string;
  title: string;
  productType: string;  // category
  imageUrl: string;
}

interface VariantInfo {
  barcode: string;
  sku: string;
  price: string;
  color: string;
  productHandle: string;
}

/** 店舗側JSON: inventory_json の構造 */
interface StoreInventoryJson {
  updated_at: string;
  count: number;
  items: StoreInventoryItem[];
}

interface StoreInventoryItem {
  product_code: string;
  handle: string;
  title: string;
  price: string;
  price_display: string;
  image_url: string;
  category: string;
  variants: { barcode: string; color: string; qty: number }[];
}

/** 商品側JSON: inventory.stores の構造 */
interface ProductInventoryJson {
  updated_at: string;
  count: number;
  stores: ProductInventoryStore[];
}

interface ProductInventoryStore {
  code: string;
  slug: string;
  name: string;
  type: string;
  area: string;
  qty: number;
}

// ============================================================
// CSV パース
// ============================================================

function parseInventoryCsv(content: string): InventoryCsvRow[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSVにデータ行がありません');
  }

  const headers = lines[0].split(',').map(h => h.trim());

  // 日本語ヘッダーにも対応
  const storeCodeIdx = Math.max(headers.indexOf('store_code'), headers.indexOf('店舗略称'));
  const skuIdx = Math.max(headers.indexOf('sku'), headers.indexOf('バーコード'));
  const qtyIdx = Math.max(headers.indexOf('quantity'), headers.indexOf('在庫数'));

  if (storeCodeIdx === -1 || skuIdx === -1 || qtyIdx === -1) {
    throw new Error(`CSV ヘッダーに必須カラムが不足しています。必要: store_code/店舗略称, sku/バーコード, quantity/在庫数\n実際: ${headers.join(', ')}`);
  }

  const rows: InventoryCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim());
    const qty = parseInt(vals[qtyIdx], 10);
    if (isNaN(qty) || qty <= 0) continue; // 在庫0以下は除外

    rows.push({
      store_code: vals[storeCodeIdx],
      sku: vals[skuIdx],
      quantity: qty,
    });
  }

  return rows;
}

// ============================================================
// Shopify Admin API
// ============================================================

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';

async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!DOMAIN || !TOKEN) {
    throw new Error('SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN が未設定です');
  }

  const response = await fetch(`https://${DOMAIN}/admin/api/2024-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API Error: ${response.status}\n${text}`);
  }

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// ============================================================
// Shopify データ取得
// ============================================================

/** 全店舗メタオブジェクトを取得 → code でインデックス */
async function fetchStores(): Promise<Map<string, StoreInfo>> {
  const map = new Map<string, StoreInfo>();
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `{
      metaobjects(type: "store", first: 50${afterClause}) {
        edges {
          node {
            id
            handle
            fields { key value }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }`;

    const result = await shopifyGraphQL<{
      metaobjects: {
        edges: Array<{
          node: { id: string; handle: string; fields: Array<{ key: string; value: string | null }> };
          cursor: string;
        }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(query);

    for (const edge of result.metaobjects.edges) {
      const fields = new Map(edge.node.fields.map(f => [f.key, f.value || '']));
      const code = fields.get('code') || '';
      const address = fields.get('address') || '';

      map.set(code, {
        metaobjectId: edge.node.id,
        code,
        slug: fields.get('slug') || edge.node.handle,
        name: fields.get('name') || '',
        type: fields.get('type') || 'other',
        address,
      });

      cursor = edge.cursor;
    }

    hasNext = result.metaobjects.pageInfo.hasNextPage;
  }

  return map;
}

/** 全商品 + バリアント情報を取得 → barcode でインデックス */
async function fetchProducts(): Promise<{
  productMap: Map<string, ProductInfo>;
  variantMap: Map<string, VariantInfo>;
}> {
  const productMap = new Map<string, ProductInfo>();
  const variantMap = new Map<string, VariantInfo>();
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `{
      products(first: 50${afterClause}) {
        edges {
          node {
            id
            handle
            title
            productType
            featuredImage { url }
            variants(first: 100) {
              nodes {
                barcode
                sku
                price
                selectedOptions { name value }
              }
            }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }`;

    const result = await shopifyGraphQL<{
      products: {
        edges: Array<{
          node: {
            id: string;
            handle: string;
            title: string;
            productType: string;
            featuredImage: { url: string } | null;
            variants: {
              nodes: Array<{
                barcode: string | null;
                sku: string | null;
                price: string;
                selectedOptions: Array<{ name: string; value: string }>;
              }>;
            };
          };
          cursor: string;
        }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(query);

    for (const edge of result.products.edges) {
      const p = edge.node;
      productMap.set(p.handle, {
        productId: p.id,
        handle: p.handle,
        title: p.title,
        productType: p.productType,
        imageUrl: p.featuredImage?.url || '',
      });

      for (const v of p.variants.nodes) {
        const barcode = v.barcode || v.sku || '';
        if (!barcode) continue;

        const colorOpt = v.selectedOptions.find(o => o.name === 'カラー');
        variantMap.set(barcode, {
          barcode,
          sku: v.sku || barcode,
          price: v.price,
          color: colorOpt?.value || '',
          productHandle: p.handle,
        });
      }

      cursor = edge.cursor;
    }

    hasNext = result.products.pageInfo.hasNextPage;
  }

  return { productMap, variantMap };
}

// ============================================================
// 住所から都道府県を抽出
// ============================================================

function extractArea(address: string): string {
  // 〒xxx-xxxx 東京都... のパターン
  const match = address.match(/(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/);
  return match ? match[1] : '';
}

// ============================================================
// JSON 生成
// ============================================================

function buildStoreInventoryJson(
  storeCode: string,
  rows: InventoryCsvRow[],
  variantMap: Map<string, VariantInfo>,
  productMap: Map<string, ProductInfo>,
): StoreInventoryJson {
  // SKU → 商品ハンドルでグループ化
  const productGroups = new Map<string, { barcode: string; color: string; qty: number }[]>();

  for (const row of rows) {
    const variant = variantMap.get(row.sku);
    if (!variant) continue;

    const handle = variant.productHandle;
    if (!productGroups.has(handle)) productGroups.set(handle, []);
    productGroups.get(handle)!.push({
      barcode: row.sku,
      color: variant.color,
      qty: row.quantity,
    });
  }

  const items: StoreInventoryItem[] = [];
  for (const [handle, variants] of productGroups) {
    const product = productMap.get(handle);
    if (!product) continue;

    const rawPrice = variants[0] ? (variantMap.get(variants[0].barcode)?.price || '0') : '0';
    const priceNum = Math.round(parseFloat(rawPrice));

    items.push({
      product_code: handle,
      handle,
      title: product.title,
      price: rawPrice,
      price_display: priceNum > 0 ? `¥${priceNum.toLocaleString('ja-JP')}` : '',
      image_url: product.imageUrl,
      category: product.productType || 'その他',
      variants: variants.sort((a, b) => a.color.localeCompare(b.color)),
    });
  }

  // カテゴリ → タイトル順にソート
  items.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

  return {
    updated_at: new Date().toISOString(),
    count: items.reduce((sum, item) => sum + item.variants.reduce((s, v) => s + v.qty, 0), 0),
    items,
  };
}

function buildProductInventoryJson(
  productHandle: string,
  storeEntries: { storeCode: string; qty: number }[],
  storeMap: Map<string, StoreInfo>,
): ProductInventoryJson {
  const stores: ProductInventoryStore[] = [];

  for (const entry of storeEntries) {
    const store = storeMap.get(entry.storeCode);
    if (!store) continue;

    stores.push({
      code: store.code,
      slug: store.slug,
      name: store.name,
      type: store.type,
      area: extractArea(store.address),
      qty: entry.qty,
    });
  }

  // エリア → 店舗名順にソート
  stores.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));

  return {
    updated_at: new Date().toISOString(),
    count: stores.length,
    stores,
  };
}

// ============================================================
// Shopify 書き込み
// ============================================================

const UPDATE_METAOBJECT = `
mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
  metaobjectUpdate(id: $id, metaobject: $metaobject) {
    metaobject { id handle }
    userErrors { field message }
  }
}`;

const SET_METAFIELDS = `
mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key }
    userErrors { field message }
  }
}`;

async function updateStoreInventory(metaobjectId: string, json: StoreInventoryJson): Promise<boolean> {
  const result = await shopifyGraphQL<{
    metaobjectUpdate: {
      metaobject: { id: string } | null;
      userErrors: Array<{ field: string; message: string }>;
    };
  }>(UPDATE_METAOBJECT, {
    id: metaobjectId,
    metaobject: {
      fields: [{ key: 'inventory_json', value: JSON.stringify(json) }],
    },
  });

  if (result.metaobjectUpdate.userErrors.length > 0) {
    console.error(`    エラー: ${JSON.stringify(result.metaobjectUpdate.userErrors)}`);
    return false;
  }
  return true;
}

async function updateProductInventory(productId: string, json: ProductInventoryJson): Promise<boolean> {
  const result = await shopifyGraphQL<{
    metafieldsSet: {
      metafields: Array<{ id: string }> | null;
      userErrors: Array<{ field: string; message: string }>;
    };
  }>(SET_METAFIELDS, {
    metafields: [{
      ownerId: productId,
      namespace: 'inventory',
      key: 'stores',
      type: 'json',
      value: JSON.stringify(json),
    }],
  });

  if (result.metafieldsSet.userErrors.length > 0) {
    console.error(`    エラー: ${JSON.stringify(result.metafieldsSet.userErrors)}`);
    return false;
  }
  return true;
}

// ============================================================
// セットアップ（メタフィールド / メタオブジェクトフィールド定義）
// ============================================================

async function setupDefinitions(): Promise<void> {
  console.log('📋 在庫連携用フィールド定義を作成中...\n');

  // 1. store metaobject に inventory_json フィールド追加
  console.log('  1/2: store metaobject に inventory_json フィールドを追加...');

  // まず store metaobject definition ID を取得
  const defResult = await shopifyGraphQL<{
    metaobjectDefinitionByType: { id: string; fieldDefinitions: Array<{ key: string }> } | null;
  }>(`{ metaobjectDefinitionByType(type: "store") { id fieldDefinitions { key } } }`);

  if (!defResult.metaobjectDefinitionByType) {
    console.error('  ✗ store metaobject 定義が見つかりません。先に sync-stores.ts を実行してください。');
    return;
  }

  const existingFields = defResult.metaobjectDefinitionByType.fieldDefinitions.map(f => f.key);
  if (existingFields.includes('inventory_json')) {
    console.log('  ⚠ inventory_json フィールドは既に存在します');
  } else {
    const addFieldResult = await shopifyGraphQL<{
      metaobjectDefinitionUpdate: {
        metaobjectDefinition: { id: string } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(`
      mutation($id: ID!) {
        metaobjectDefinitionUpdate(id: $id, definition: {
          fieldDefinitions: [{ create: { key: "inventory_json", name: "在庫商品一覧", type: "json" } }]
        }) {
          metaobjectDefinition { id }
          userErrors { field message }
        }
      }
    `, { id: defResult.metaobjectDefinitionByType.id });

    if (addFieldResult.metaobjectDefinitionUpdate.userErrors.length > 0) {
      console.error(`  ✗ ${JSON.stringify(addFieldResult.metaobjectDefinitionUpdate.userErrors)}`);
    } else {
      console.log('  ✓ inventory_json フィールドを追加しました');
    }
  }

  // 2. Product metafield inventory.stores 定義
  console.log('  2/2: Product metafield inventory.stores を定義...');

  const mfResult = await shopifyGraphQL<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string } | null;
      userErrors: Array<{ field: string; message: string }>;
    };
  }>(`
    mutation {
      metafieldDefinitionCreate(definition: {
        namespace: "inventory"
        key: "stores"
        name: "在庫店舗一覧"
        type: "json"
        ownerType: PRODUCT
        access: { storefront: PUBLIC_READ }
      }) {
        createdDefinition { id }
        userErrors { field message }
      }
    }
  `);

  const mfErrors = mfResult.metafieldDefinitionCreate.userErrors;
  if (mfErrors.length > 0) {
    const alreadyExists = mfErrors.some(e => e.message.includes('already') || e.message.includes('taken'));
    if (alreadyExists) {
      console.log('  ⚠ inventory.stores 定義は既に存在します');
    } else {
      console.error(`  ✗ ${JSON.stringify(mfErrors)}`);
    }
  } else {
    console.log('  ✓ inventory.stores 定義を作成しました');
  }

  console.log('\n✅ セットアップ完了');
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const setup = args.includes('--setup');
  const storeArg = args.find(a => a.startsWith('--store='));
  const csvArg = args.find(a => a.startsWith('--csv='));
  const targetStoreCode = storeArg ? storeArg.split('=')[1] : undefined;

  console.log('📦 在庫同期スクリプト');
  console.log('=====================');

  if (dryRun) console.log('⚠️  ドライランモード\n');

  // --setup モード
  if (setup) {
    await setupDefinitions();
    return;
  }

  // CSV 読み込み
  const csvPath = csvArg
    ? path.resolve(csvArg.split('=')[1])
    : path.resolve(__dirname, '../../../docs/store_inventory_snapshot.csv');

  console.log(`📂 CSV: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ ファイルが見つかりません: ${csvPath}`);
    console.error('  --csv=path/to/file.csv でパスを指定するか、');
    console.error('  docs/store_inventory_snapshot.csv を配置してください。');
    process.exit(1);
  }

  let rows = parseInventoryCsv(fs.readFileSync(csvPath, 'utf-8'));
  console.log(`  → ${rows.length} 件の在庫レコード（qty > 0）を読み込み`);

  // 店舗フィルタ
  if (targetStoreCode) {
    rows = rows.filter(r => r.store_code === targetStoreCode);
    console.log(`  → --store=${targetStoreCode} でフィルタ: ${rows.length} 件`);
  }

  if (rows.length === 0) {
    console.log('\n在庫データが0件です。処理を終了します。');
    return;
  }

  // Shopify からマスタデータ取得
  console.log('\n📡 Shopify からマスタデータを取得中...');
  const storeMap = await fetchStores();
  console.log(`  店舗: ${storeMap.size} 件`);

  const { productMap, variantMap } = await fetchProducts();
  console.log(`  商品: ${productMap.size} 件`);
  console.log(`  バリアント: ${variantMap.size} 件`);

  // マッチング率チェック
  const unmatchedStores = new Set<string>();
  const unmatchedSkus = new Set<string>();
  for (const row of rows) {
    if (!storeMap.has(row.store_code)) unmatchedStores.add(row.store_code);
    if (!variantMap.has(row.sku)) unmatchedSkus.add(row.sku);
  }

  if (unmatchedStores.size > 0) {
    console.log(`\n⚠ マッチしない店舗コード (${unmatchedStores.size} 件):`);
    for (const code of [...unmatchedStores].slice(0, 10)) {
      console.log(`    ${code}`);
    }
    if (unmatchedStores.size > 10) console.log(`    ... 他 ${unmatchedStores.size - 10} 件`);
  }

  if (unmatchedSkus.size > 0) {
    console.log(`\n⚠ マッチしないSKU (${unmatchedSkus.size} 件):`);
    for (const sku of [...unmatchedSkus].slice(0, 10)) {
      console.log(`    ${sku}`);
    }
    if (unmatchedSkus.size > 10) console.log(`    ... 他 ${unmatchedSkus.size - 10} 件`);
  }

  // ---- 店舗側JSON生成 ----
  console.log('\n🏪 店舗側 inventory_json を生成中...');

  // store_code でグループ化
  const byStore = new Map<string, InventoryCsvRow[]>();
  for (const row of rows) {
    if (!byStore.has(row.store_code)) byStore.set(row.store_code, []);
    byStore.get(row.store_code)!.push(row);
  }

  const storeJsons = new Map<string, StoreInventoryJson>();
  for (const [storeCode, storeRows] of byStore) {
    const json = buildStoreInventoryJson(storeCode, storeRows, variantMap, productMap);
    storeJsons.set(storeCode, json);
  }

  console.log(`  → ${storeJsons.size} 店舗分の JSON を生成`);

  // ---- 商品側JSON生成 ----
  console.log('\n🚲 商品側 inventory.stores を生成中...');

  // barcode → product handle → {store_code: qty} の集約
  const byProduct = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const variant = variantMap.get(row.sku);
    if (!variant) continue;

    const handle = variant.productHandle;
    if (!byProduct.has(handle)) byProduct.set(handle, new Map());

    const storeQtyMap = byProduct.get(handle)!;
    storeQtyMap.set(row.store_code, (storeQtyMap.get(row.store_code) || 0) + row.quantity);
  }

  const productJsons = new Map<string, ProductInventoryJson>();
  for (const [handle, storeQtyMap] of byProduct) {
    const entries = [...storeQtyMap.entries()].map(([code, qty]) => ({ storeCode: code, qty }));
    const json = buildProductInventoryJson(handle, entries, storeMap);
    productJsons.set(handle, json);
  }

  console.log(`  → ${productJsons.size} 商品分の JSON を生成`);

  // ---- ドライラン出力 ----
  if (dryRun) {
    const outputDir = path.resolve(__dirname, '../dist');
    fs.mkdirSync(outputDir, { recursive: true });

    // 店舗側サンプル
    const storePreview = Object.fromEntries(
      [...storeJsons.entries()].slice(0, 3).map(([k, v]) => [k, v])
    );
    const storePreviewPath = path.resolve(outputDir, 'inventory-stores-preview.json');
    fs.writeFileSync(storePreviewPath, JSON.stringify(storePreview, null, 2));

    // 商品側サンプル
    const productPreview = Object.fromEntries(
      [...productJsons.entries()].slice(0, 3).map(([k, v]) => [k, v])
    );
    const productPreviewPath = path.resolve(outputDir, 'inventory-products-preview.json');
    fs.writeFileSync(productPreviewPath, JSON.stringify(productPreview, null, 2));

    console.log(`\n📄 プレビュー出力:`);
    console.log(`  店舗側: ${storePreviewPath}`);
    console.log(`  商品側: ${productPreviewPath}`);

    // サイズ見積もり
    const storeSizes = [...storeJsons.values()].map(j => JSON.stringify(j).length);
    const maxStoreSize = Math.max(...storeSizes);
    const avgStoreSize = Math.round(storeSizes.reduce((a, b) => a + b, 0) / storeSizes.length);
    console.log(`\n📊 サイズ見積もり:`);
    console.log(`  店舗側JSON: 平均 ${(avgStoreSize / 1024).toFixed(1)}KB, 最大 ${(maxStoreSize / 1024).toFixed(1)}KB (上限 128KB)`);

    if (productJsons.size > 0) {
      const prodSizes = [...productJsons.values()].map(j => JSON.stringify(j).length);
      const maxProdSize = Math.max(...prodSizes);
      const avgProdSize = Math.round(prodSizes.reduce((a, b) => a + b, 0) / prodSizes.length);
      console.log(`  商品側JSON: 平均 ${(avgProdSize / 1024).toFixed(1)}KB, 最大 ${(maxProdSize / 1024).toFixed(1)}KB (上限 128KB)`);
    }

    return;
  }

  // ---- Shopify 書き込み ----

  // 店舗側
  console.log('\n📤 店舗 metaobject を更新中...');
  let storeSuccess = 0;
  let storeError = 0;

  for (const [storeCode, json] of storeJsons) {
    const store = storeMap.get(storeCode);
    if (!store) {
      console.log(`  ⏭ ${storeCode} — 店舗メタオブジェクトなし、スキップ`);
      continue;
    }

    const ok = await updateStoreInventory(store.metaobjectId, json);
    if (ok) {
      console.log(`  ✓ ${storeCode} ${store.name} — ${json.items.length}商品, ${json.count}台`);
      storeSuccess++;
    } else {
      console.error(`  ✗ ${storeCode} ${store.name}`);
      storeError++;
    }

    await new Promise(r => setTimeout(r, 600));
  }

  // 商品側
  console.log('\n📤 商品 metafield を更新中...');
  let productSuccess = 0;
  let productError = 0;

  for (const [handle, json] of productJsons) {
    const product = productMap.get(handle);
    if (!product) {
      console.log(`  ⏭ ${handle} — 商品なし、スキップ`);
      continue;
    }

    const ok = await updateProductInventory(product.productId, json);
    if (ok) {
      console.log(`  ✓ ${handle} — ${json.count}店舗`);
      productSuccess++;
    } else {
      console.error(`  ✗ ${handle}`);
      productError++;
    }

    await new Promise(r => setTimeout(r, 600));
  }

  // サマリー
  console.log('\n=====================');
  console.log(`✅ 完了`);
  console.log(`  店舗側: 成功 ${storeSuccess}, 失敗 ${storeError}`);
  console.log(`  商品側: 成功 ${productSuccess}, 失敗 ${productError}`);

  const elapsed = storeJsons.size * 0.6 + productJsons.size * 0.6;
  console.log(`  所要時間（API呼出のみ）: 約 ${Math.ceil(elapsed / 60)} 分`);
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
