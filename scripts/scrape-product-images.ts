/**
 * scrape-product-images.ts
 *
 * 現行EC（shop.cyclespot.net）から商品画像をスクレイピングし、
 * Shopify の各商品に紐付けてアップロードするスクリプト
 *
 * 使い方:
 *   npx tsx scripts/scrape-product-images.ts --dry-run         # 画像URL収集のみ
 *   npx tsx scripts/scrape-product-images.ts --limit=5          # 最初の5商品のみ
 *   npx tsx scripts/scrape-product-images.ts                    # 全商品
 *
 * フロー:
 *   1. Shopify から全商品(handle, id, variants[sku])を取得
 *   2. 各商品の先頭バリアントSKUで現行EC商品ページにアクセス
 *   3. HTMLから商品画像URLを抽出
 *   4. 画像をダウンロードしてShopify にアップロード
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

interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  featuredImage: { url: string } | null;
  variants: { edges: Array<{ node: { sku: string } }> };
}

interface ScrapedImage {
  url: string;
  filename: string;
}

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
// Shopify 全商品取得
// ============================================================

async function getAllProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const variables: Record<string, unknown> = { first: 50 };
    if (cursor) variables.after = cursor;

    const result = await shopifyGraphQL<{
      products: {
        edges: Array<{ node: ShopifyProduct; cursor: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(`
      query Products($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              handle
              title
              featuredImage { url }
              variants(first: 1) {
                edges { node { sku } }
              }
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

  return products;
}

// ============================================================
// 現行EC スクレイピング
// ============================================================

const EC_BASE = 'https://shop.cyclespot.net';

async function scrapeProductImages(sku: string): Promise<ScrapedImage[]> {
  const url = `${EC_BASE}/store/ProductDetail.aspx?pcd=${sku}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CycleSpot-Migration/1.0)',
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const images: ScrapedImage[] = [];
    const seen = new Set<string>();

    // パターン1: /store/images/products/Marble_item_img\filename.jpg
    const pattern1 = /\/store\/images\/products\/Marble_item_img[\\\/]([^"'\s&]+\.(?:jpg|jpeg|png|gif))/gi;
    let match;
    while ((match = pattern1.exec(html)) !== null) {
      const filename = match[1];
      const imgUrl = `${EC_BASE}/store/images/products/Marble_item_img/${filename}`;
      if (!seen.has(imgUrl)) {
        seen.add(imgUrl);
        images.push({ url: imgUrl, filename });
      }
    }

    // パターン2: Images.aspx?fname= エンコードされたパス
    const pattern2 = /Images\.aspx\?fname=([^&"'\s]+)/gi;
    while ((match = pattern2.exec(html)) !== null) {
      const encodedPath = decodeURIComponent(match[1]);
      // Marble_item_img のパスを含むもののみ
      if (encodedPath.includes('Marble_item_img')) {
        const filename = encodedPath.split(/[\\\/]/).pop() || '';
        if (filename && filename.match(/\.(jpg|jpeg|png|gif)$/i)) {
          const imgUrl = `${EC_BASE}${encodedPath.startsWith('/') ? '' : '/'}${encodedPath.replace(/\\/g, '/')}`;
          if (!seen.has(imgUrl)) {
            seen.add(imgUrl);
            images.push({ url: imgUrl, filename });
          }
        }
      }
    }

    // common_banner 画像は除外（サイト共通バナー）
    return images.filter(img => !img.filename.includes('common_banner') && !img.filename.includes('add_description'));
  } catch {
    return [];
  }
}

// ============================================================
// 画像ダウンロード
// ============================================================

const IMAGE_CACHE_DIR = path.resolve(__dirname, '../.product-images');

async function downloadImage(imageUrl: string, filename: string): Promise<string | null> {
  const localPath = path.join(IMAGE_CACHE_DIR, filename);

  // キャッシュ確認
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CycleSpot-Migration/1.0)',
      },
    });

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1000) return null; // 極端に小さい画像はスキップ

    fs.writeFileSync(localPath, buffer);
    return localPath;
  } catch {
    return null;
  }
}

// ============================================================
// Shopify 画像アップロード（Staged Upload → Product Image）
// ============================================================

async function uploadImageToProduct(productId: string, localPath: string, filename: string, position: number): Promise<boolean> {
  const fileContent = fs.readFileSync(localPath);
  const fileSize = fileContent.length;
  const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

  // Step 1: Staged Upload 作成
  const stagedResult = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(`
    mutation StagedUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { message }
      }
    }
  `, {
    input: [{
      filename,
      mimeType,
      httpMethod: 'POST',
      resource: 'IMAGE',
      fileSize: fileSize.toString(),
    }],
  });

  if (stagedResult.stagedUploadsCreate.userErrors.length > 0) {
    return false;
  }

  const target = stagedResult.stagedUploadsCreate.stagedTargets[0];
  if (!target) return false;

  // Step 2: ファイルをアップロード
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append('file', new Blob([fileContent], { type: mimeType }), filename);

  const uploadResponse = await fetch(target.url, {
    method: 'POST',
    body: formData,
  });

  if (!uploadResponse.ok) {
    return false;
  }

  // Step 3: Product に画像を紐付け
  const createResult = await shopifyGraphQL<{
    productCreateMedia: {
      media: Array<{ id: string }>;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(`
    mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { message }
      }
    }
  `, {
    productId,
    media: [{
      alt: filename.replace(/\.[^.]+$/, ''),
      mediaContentType: 'IMAGE',
      originalSource: target.resourceUrl,
    }],
  });

  return createResult.productCreateMedia.mediaUserErrors.length === 0;
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  console.log('🚴 商品画像スクレイピング＆アップロード');
  console.log('=========================================');
  if (dryRun) console.log('⚠️  ドライランモード（ダウンロード・アップロードなし）\n');

  // 環境変数チェック
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    console.error('❌ 環境変数が設定されていません');
    process.exit(1);
  }

  // Shopify 全商品取得
  console.log('📋 Shopify 商品を取得中...');
  const allProducts = await getAllProducts();
  console.log(`  → ${allProducts.length} 件の商品を取得\n`);

  // 画像が未設定の商品のみ対象
  const productsWithoutImages = allProducts.filter(p => !p.featuredImage);
  console.log(`  → 画像未設定: ${productsWithoutImages.length} 件\n`);

  const targetProducts = limit ? productsWithoutImages.slice(0, limit) : productsWithoutImages;

  if (limit) {
    console.log(`📎 --limit=${limit}: 最初の ${targetProducts.length} 商品のみ処理\n`);
  }

  // キャッシュディレクトリ作成
  if (!dryRun) {
    fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
  }

  let scrapeSuccess = 0;
  let scrapeNoImage = 0;
  let uploadSuccess = 0;
  let uploadError = 0;

  for (let i = 0; i < targetProducts.length; i++) {
    const product = targetProducts[i];
    const firstSku = product.variants.edges[0]?.node.sku;

    if (!firstSku) {
      console.log(`  ⏭ [${i + 1}/${targetProducts.length}] ${product.handle} — SKUなし、スキップ`);
      continue;
    }

    // 現行ECからの画像URL取得
    const images = await scrapeProductImages(firstSku);

    if (images.length === 0) {
      console.log(`  ⚠ [${i + 1}/${targetProducts.length}] ${product.handle} — 画像なし (SKU:${firstSku})`);
      scrapeNoImage++;
      await new Promise(resolve => setTimeout(resolve, 300));
      continue;
    }

    scrapeSuccess++;

    if (dryRun) {
      console.log(`  ✓ [${i + 1}/${targetProducts.length}] ${product.handle} — ${images.length} 枚`);
      for (const img of images.slice(0, 3)) {
        console.log(`      ${img.filename}`);
      }
      if (images.length > 3) console.log(`      ... 他 ${images.length - 3} 枚`);
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }

    // 画像ダウンロード & アップロード（最大5枚まで）
    const targetImages = images.slice(0, 5);
    let productUploadCount = 0;

    for (let j = 0; j < targetImages.length; j++) {
      const img = targetImages[j];
      const localPath = await downloadImage(img.url, `${product.handle}-${j + 1}.jpg`);

      if (!localPath) {
        continue;
      }

      try {
        const uploaded = await uploadImageToProduct(
          product.id,
          localPath,
          `${product.handle}-${j + 1}.jpg`,
          j + 1
        );

        if (uploaded) {
          productUploadCount++;
        }
      } catch {
        // ネットワークエラー等 — スキップして次へ
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (productUploadCount > 0) {
      console.log(`  ✓ [${i + 1}/${targetProducts.length}] ${product.handle} — ${productUploadCount}/${targetImages.length} 枚アップロード`);
      uploadSuccess++;
    } else {
      console.log(`  ✗ [${i + 1}/${targetProducts.length}] ${product.handle} — アップロード失敗`);
      uploadError++;
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n=========================================');
  if (dryRun) {
    console.log(`✅ スクレイピング結果: 画像あり ${scrapeSuccess} 件, 画像なし ${scrapeNoImage} 件`);
  } else {
    console.log(`✅ 完了:`);
    console.log(`  画像発見: ${scrapeSuccess} 件`);
    console.log(`  画像なし: ${scrapeNoImage} 件`);
    console.log(`  アップロード成功: ${uploadSuccess} 件`);
    console.log(`  アップロード失敗: ${uploadError} 件`);
  }
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
