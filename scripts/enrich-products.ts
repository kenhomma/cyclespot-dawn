/**
 * enrich-products.ts
 *
 * メーカー公式サイトから商品情報をスクレイピングし、
 * Shopify の商品説明（descriptionHtml）を充実させるスクリプト
 *
 * 対象メーカー:
 *   - ブリヂストンサイクル (bscycle.co.jp)
 *   - パナソニック (cycle.panasonic.com)
 *   - ヤマハ (yamaha-motor.co.jp/pas/)
 *
 * 使い方:
 *   npx tsx scripts/enrich-products.ts --dry-run            # スクレイピングのみ
 *   npx tsx scripts/enrich-products.ts --vendor=パナソニック   # 特定メーカーのみ
 *   npx tsx scripts/enrich-products.ts                       # 全メーカー実行
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
// 型定義
// ============================================================

interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  descriptionHtml: string;
}

interface EnrichedContent {
  productName: string;
  tagline: string;
  description: string;
  manufacturerUrl: string;
}

// ============================================================
// メーカーページURL マッピング
// ============================================================

/** ブリヂストン: handle → bscycle.co.jp パス */
const BRIDGESTONE_MAP: Record<string, string> = {
  'e73lt1':  '/items/bicycle/ebridge/',
  'e63lt1':  '/items/bicycle/ebridge/',
  'epl001':  '/items/bicycle/ecopal/',
  'epl201':  '/items/bicycle/ecopal/',
  'epl401':  '/items/bicycle/ecopal/',
  'st63t2':  '/items/bicycle/stepcruz/',
  'lbd764':  '/items/bicycle/lb1/',
  'bm0b44':  '/items/e-bicycle/bikke/mob/',
  'bp0c44':  '/items/e-bicycle/bikke/polar/',
  'rk4b45':  '/items/e-bicycle/rakutto/',
  'tb7b45':  '/items/e-bicycle/tb1e/',
  'shl65':   '/items/bicycle/schlein/',
  'shl45':   '/items/bicycle/schlein/',
  'shl65s':  '/items/bicycle/schlein/',
  'shl45s':  '/items/bicycle/schlein/',
  'cfj45t':  '/items/bicycle/crossFireJ/',
  'cfj25t':  '/items/bicycle/crossFireJ/',
  'cfj245':  '/items/bicycle/crossFireJ/',
  'cfj225':  '/items/bicycle/crossFireJ/',
  'cfj205':  '/items/bicycle/crossFireJ/',
  'hy6b45':  '/items/e-bicycle/hydeeII/',
  'st6b45':  '/items/e-bicycle/stepcruz-e/',
  'se6b46':  '/items/e-bicycle/stepcruz-e/',
  'f6db45':  '/items/e-bicycle/frontia/',
  'f4db45':  '/items/e-bicycle/frontia/',
  'tbxx6':   '/items/bicycle/tb1/',
  'absxx6':  '/items/bicycle/albeltSports/',
};

/** パナソニック: handle → cycle.panasonic.com スラグ */
const PANASONIC_MAP: Record<string, string> = {
  'be-fd433':  'vivi_dx',
  'be-fd633':  'vivi_dx',
  'be-fl434':  'vivi_l',
  'be-fl634':  'vivi_l',
  'be-fvs771': 'velostar',
  'be-fta634': 'timo_a',
  'be-fts633': 'timo_s',
  'be-ffd033': 'gyutto_croom_dx',
  'be-ffe033': 'gyutto_croom_ex',
  'be-fad032': 'gyutto_annys_dx',
  'be-fad632': 'gyutto_annys_dx_26',
  'be-frd034': 'gyutto_croomr_dx',
  'be-fre034': 'gyutto_croomr_ex',
  'be-fsl435': 'vivi_sl',
  'be-fgl033': 'glitter',
};

/** ヤマハ: handle → yamaha-motor.co.jp/pas/lineup/ スラグ */
const YAMAHA_MAP: Record<string, string> = {
  'pa26fgch5j': 'cheer',
  'pa26fgrn5j': 'rin',
  'pa26agu5j':  'ulu',
  'pa20lgc5j':  'city-c',
  'pa24lg5j':   'sion-u',
  'pa20lg5j':   'sion-u',
  'pa26jgwl6j': 'with',
  'pa24jgwl6j': 'with',
  'pa20bgk6j':  'kiss',
  'pa20bgb6j':  'babby',
  'pa26ggrn6j': 'rin',
  'pa26bgu6j':  'ulu',
  'pa20mgc6j':  'city-c',
  'pa26ggch6j': 'cheer',
};

// ============================================================
// ベンダー → マッピング解決
// ============================================================

const TARGET_VENDORS = ['ブリヂストンサイクル', 'パナソニック', 'ヤマハ'] as const;

function resolveManufacturerUrl(handle: string, vendor: string): string | null {
  // sale- プレフィックスを除去
  const baseHandle = handle.replace(/^sale-/, '');

  if (vendor === 'ブリヂストンサイクル') {
    const p = BRIDGESTONE_MAP[baseHandle];
    return p ? `https://www.bscycle.co.jp${p}` : null;
  }
  if (vendor === 'パナソニック') {
    const slug = PANASONIC_MAP[baseHandle];
    return slug ? `https://cycle.panasonic.com/products/${slug}/` : null;
  }
  if (vendor === 'ヤマハ') {
    const slug = YAMAHA_MAP[baseHandle];
    return slug ? `https://www.yamaha-motor.co.jp/pas/lineup/${slug}/` : null;
  }
  return null;
}

// ============================================================
// ページ取得（キャッシュ付き）
// ============================================================

const pageCache = new Map<string, string>();

async function fetchPage(url: string): Promise<string | null> {
  if (pageCache.has(url)) return pageCache.get(url)!;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CycleSpot-Enrichment/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'ja,en;q=0.5',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    pageCache.set(url, html);
    return html;
  } catch {
    return null;
  }
}

// ============================================================
// HTML ユーティリティ
// ============================================================

function extractMeta(html: string, name: string): string {
  // <meta name="description" content="..."> or <meta property="og:description" content="...">
  const re = new RegExp(
    `<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']`,
    'i'
  );
  const m = html.match(re);
  if (m) return m[1].trim();

  // content が先に来るパターン
  const re2 = new RegExp(
    `<meta\\s+content=["']([^"']+)["']\\s+(?:name|property)=["']${name}["']`,
    'i'
  );
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : '';
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').trim();
}

// ============================================================
// ブランド別コンテンツ抽出
// ============================================================

function extractBridgestoneContent(html: string, url: string): EnrichedContent | null {
  const title = extractTitle(html);
  const metaDesc = extractMeta(html, 'description');

  // タイトルから商品名を抽出（例: "シュライン | 通学車 | ブリヂストンサイクル株式会社"）
  const productName = title.split(/[|｜]/)[0].trim();

  // OG description を優先、なければ meta description
  const ogDesc = extractMeta(html, 'og:description');
  const desc = ogDesc || metaDesc;

  if (!productName || !desc) return null;

  // ブリヂストン公式サイトの説明文にはブランド名プレフィックスが含まれることがある
  const cleanDesc = desc
    .replace(/^ブリヂストンサイクル(?:株式会社)?の/, '')
    .replace(/^ブリヂストンの/, '');

  return {
    productName,
    tagline: '',
    description: cleanDesc,
    manufacturerUrl: url,
  };
}

function extractPanasonicContent(html: string, url: string): EnrichedContent | null {
  // <h1 class="p-products-title">ビビ・DX</h1>
  const titleMatch = html.match(/<h1[^>]*class="p-products-title"[^>]*>([^<]+)<\/h1>/i);
  const productName = titleMatch ? titleMatch[1].trim() : '';

  // <p class="p-products-description">快適装備が満載のロングセラーモデル。</p>
  const taglineMatch = html.match(/<p[^>]*class="p-products-description"[^>]*>([^<]+)<\/p>/i);
  const tagline = taglineMatch ? taglineMatch[1].trim() : '';

  // meta description
  const metaDesc = extractMeta(html, 'description');
  // "パナソニック自転車公式サイト。..." プレフィックスを除去
  const cleanDesc = metaDesc
    .replace(/^パナソニック自転車公式サイト。/, '')
    .replace(/^【公式】/, '')
    .trim();

  // 説明がモデル名から始まる場合、タグラインの前の部分を除去
  // 例: "ショッピングモデルの電動アシスト自転車「ビビ・DX」の機能や特長をご紹介。快適装備が満載の..."
  // → カテゴリ説明 + 商品説明 の構造

  if (!productName && !cleanDesc) return null;

  return {
    productName: productName || extractTitle(html).split(/[|｜]/)[0].trim(),
    tagline,
    description: cleanDesc,
    manufacturerUrl: url,
  };
}

function extractYamahaContent(html: string, url: string): EnrichedContent | null {
  const title = extractTitle(html);
  const metaDesc = extractMeta(html, 'description');
  const ogDesc = extractMeta(html, 'og:description');

  // タイトルから商品名抽出（例: "PAS CHEER - 電動自転車 | ヤマハ発動機"）
  const productName = title.split(/\s*[-–—|｜]\s*/)[0].trim();

  const desc = ogDesc || metaDesc;
  const cleanDesc = desc
    .replace(/^ヤマハ(?:発動機)?の/, '')
    .replace(/^【公式】/, '')
    .trim();

  if (!productName && !cleanDesc) return null;

  return {
    productName,
    tagline: '',
    description: cleanDesc,
    manufacturerUrl: url,
  };
}

function extractContent(html: string, url: string, vendor: string): EnrichedContent | null {
  if (vendor === 'ブリヂストンサイクル') return extractBridgestoneContent(html, url);
  if (vendor === 'パナソニック') return extractPanasonicContent(html, url);
  if (vendor === 'ヤマハ') return extractYamahaContent(html, url);
  return null;
}

// ============================================================
// 説明HTML生成
// ============================================================

function buildDescriptionHtml(content: EnrichedContent, vendor: string): string {
  const parts: string[] = [];

  if (content.tagline) {
    parts.push(`<p><strong>${content.tagline}</strong></p>`);
  }

  if (content.description) {
    parts.push(`<p>${content.description}</p>`);
  }

  const brandLabel = vendor === 'ブリヂストンサイクル' ? 'ブリヂストン'
    : vendor === 'ヤマハ' ? 'ヤマハ' : vendor;

  parts.push(
    `<p><a href="${content.manufacturerUrl}" target="_blank" rel="noopener noreferrer">${brandLabel}公式サイトで詳しく見る →</a></p>`
  );

  return parts.join('\n');
}

// ============================================================
// Shopify: 商品取得
// ============================================================

async function getProductsByVendors(vendors: readonly string[]): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];

  for (const vendor of vendors) {
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const variables: Record<string, unknown> = {
        first: 50,
        query: `vendor:"${vendor}"`,
      };
      if (cursor) variables.after = cursor;

      const result = await shopifyGraphQL<{
        products: {
          edges: Array<{ node: ShopifyProduct; cursor: string }>;
          pageInfo: { hasNextPage: boolean };
        };
      }>(`
        query Products($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, query: $query) {
            edges {
              node {
                id
                handle
                title
                vendor
                descriptionHtml
              }
              cursor
            }
            pageInfo { hasNextPage }
          }
        }
      `, variables);

      for (const edge of result.products.edges) {
        products.push(edge.node);
        cursor = edge.cursor;
      }
      hasNext = result.products.pageInfo.hasNextPage;
    }
  }

  return products;
}

// ============================================================
// Shopify: 商品説明更新
// ============================================================

async function updateProductDescription(
  productId: string,
  descriptionHtml: string
): Promise<boolean> {
  try {
    const result = await shopifyGraphQL<{
      productUpdate: {
        product: { id: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(`
      mutation ProductUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product { id }
          userErrors { field message }
        }
      }
    `, {
      input: {
        id: productId,
        descriptionHtml,
      },
    });

    if (result.productUpdate.userErrors.length > 0) {
      console.error(`    エラー: ${result.productUpdate.userErrors.map(e => e.message).join('; ')}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`    エラー: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const forceUpdate = args.includes('--force');
  const vendorArg = args.find(a => a.startsWith('--vendor='));
  const vendorFilter = vendorArg ? vendorArg.split('=')[1] : null;

  console.log('🚴 メーカー公式サイトから商品説明エンリッチメント');
  console.log('==================================================');
  if (dryRun) console.log('⚠️  ドライランモード（Shopify 更新なし）');
  if (forceUpdate) console.log('⚠️  強制更新モード（既存説明を上書き）');
  console.log('');

  if (!dryRun && (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN)) {
    console.error('❌ 環境変数 SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN が未設定');
    process.exit(1);
  }

  // 対象ベンダー
  const vendors = vendorFilter
    ? TARGET_VENDORS.filter(v => v.includes(vendorFilter))
    : [...TARGET_VENDORS];

  if (vendors.length === 0) {
    console.error(`❌ 対象ベンダーが見つかりません: ${vendorFilter}`);
    process.exit(1);
  }

  console.log(`📋 対象メーカー: ${vendors.join(', ')}`);

  // Shopify 商品取得
  console.log('📋 Shopify 商品を取得中...');
  const products = await getProductsByVendors(vendors);
  console.log(`  → ${products.length} 件の商品を取得\n`);

  let mapped = 0;
  let unmapped = 0;
  let scraped = 0;
  let scrapeFail = 0;
  let updated = 0;
  let skipped = 0;
  let updateError = 0;

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const prefix = `  [${i + 1}/${products.length}]`;

    // 1. URL マッピング
    const url = resolveManufacturerUrl(product.handle, product.vendor);
    if (!url) {
      console.log(`${prefix} ⏭ ${product.handle} — マッピングなし`);
      unmapped++;
      continue;
    }
    mapped++;

    // 2. 既存説明チェック
    if (!forceUpdate && product.descriptionHtml && product.descriptionHtml.trim().length > 0) {
      console.log(`${prefix} ⏭ ${product.handle} — 既存説明あり（スキップ）`);
      skipped++;
      continue;
    }

    // 3. メーカーページ取得
    const html = await fetchPage(url);
    if (!html) {
      console.log(`${prefix} ⚠ ${product.handle} — ページ取得失敗 (${url})`);
      scrapeFail++;
      await sleep(500);
      continue;
    }

    // 4. コンテンツ抽出
    const content = extractContent(html, url, product.vendor);
    if (!content || (!content.description && !content.tagline)) {
      console.log(`${prefix} ⚠ ${product.handle} — コンテンツ抽出失敗`);
      scrapeFail++;
      await sleep(300);
      continue;
    }
    scraped++;

    // 5. 説明HTML生成
    const descHtml = buildDescriptionHtml(content, product.vendor);

    if (dryRun) {
      console.log(`${prefix} ✓ ${product.handle} — ${content.productName}`);
      console.log(`      ${content.description.slice(0, 80)}...`);
      await sleep(200);
      continue;
    }

    // 6. Shopify 更新
    const ok = await updateProductDescription(product.id, descHtml);
    if (ok) {
      console.log(`${prefix} ✓ ${product.handle} — ${content.productName}`);
      updated++;
    } else {
      console.log(`${prefix} ✗ ${product.handle} — Shopify 更新失敗`);
      updateError++;
    }

    await sleep(300);
  }

  console.log('\n==================================================');
  console.log('✅ 完了:');
  console.log(`  マッピングあり: ${mapped} 件`);
  console.log(`  マッピングなし: ${unmapped} 件`);
  if (!dryRun) {
    console.log(`  スクレイピング成功: ${scraped} 件`);
    console.log(`  スクレイピング失敗: ${scrapeFail} 件`);
    console.log(`  既存説明スキップ: ${skipped} 件`);
    console.log(`  Shopify 更新成功: ${updated} 件`);
    console.log(`  Shopify 更新失敗: ${updateError} 件`);
  } else {
    console.log(`  スクレイピング成功: ${scraped} 件`);
    console.log(`  スクレイピング失敗: ${scrapeFail} 件`);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
