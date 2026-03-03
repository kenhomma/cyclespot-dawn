/**
 * setup-brand-data.ts
 *
 * ブランドコレクションに紹介文（HTML）とロゴ画像を設定するスクリプト
 * - 現行EC（shop.cyclespot.net）からロゴPNGをダウンロード
 * - Staged Upload API → collectionUpdate で画像・説明文を設定
 *
 * 使い方:
 *   npx tsx scripts/setup-brand-data.ts --dry-run   # 確認のみ
 *   npx tsx scripts/setup-brand-data.ts              # 実行
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

interface BrandDef {
  handle: string;
  title: string;
  logoFilename: string | null;
  descriptionHtml: string;
}

// ============================================================
// ブランド定義
// ============================================================

const BRANDS: BrandDef[] = [
  {
    handle: 'brand-bridgestone',
    title: 'ブリヂストンサイクル',
    logoFilename: 'bs.png',
    descriptionHtml: '<p>日本を代表する自転車メーカー、ブリヂストンサイクル。通学・通勤に最適な耐久性の高いシティサイクルから、お子様向けモデル、電動アシスト自転車まで幅広いラインナップ。安心の国内品質と充実したアフターサポートで、毎日の暮らしを支えます。</p>',
  },
  {
    handle: 'brand-cyclespot',
    title: 'サイクルスポット',
    logoFilename: 'cyclespot.png',
    descriptionHtml: '<p>サイクルスポットが自信を持ってお届けするオリジナルブランド。毎日の通勤・通学や街乗りに最適なコストパフォーマンスに優れた自転車を豊富に取り揃えています。お手頃な価格でも品質にこだわった、長く乗れる一台をお探しの方に。</p>',
  },
  {
    handle: 'brand-louis-garneau',
    title: 'LOUIS GARNEAU',
    logoFilename: 'lg.png',
    descriptionHtml: '<p>カナダ生まれのスポーツライフスタイルブランド、LOUIS GARNEAU（ルイガノ）。洗練されたデザインとカラーリングが人気のクロスバイクやミニベロを中心に、街乗りからサイクリングまで楽しめるモデルが揃います。</p>',
  },
  {
    handle: 'brand-merida',
    title: 'MERIDA',
    logoFilename: 'merida.png',
    descriptionHtml: '<p>台湾発の世界的自転車メーカー、MERIDA（メリダ）。高品質なロードバイク、マウンテンバイク、クロスバイクを手の届きやすい価格で提供。世界のプロレースで実証された技術を、日常のライディングに活かしたモデルが魅力です。</p>',
  },
  {
    handle: 'brand-panasonic',
    title: 'パナソニック',
    logoFilename: 'panasonic.png',
    descriptionHtml: '<p>パナソニックの電動アシスト自転車「ビビ」「ギュット」「ティモ」シリーズ。バッテリーとモーターの技術に定評があり、坂道の多い地域や子乗せ用途で多くのお客様に選ばれています。信頼の日本メーカー品質。</p>',
  },
  {
    handle: 'brand-giant',
    title: 'GIANT',
    logoFilename: 'giant.png',
    descriptionHtml: '<p>世界最大の自転車メーカー、GIANT（ジャイアント）。ロードバイクからクロスバイク、マウンテンバイクまで、高い品質と優れたコストパフォーマンスを両立。初めてのスポーツバイクからステップアップまで、幅広いラインナップでお応えします。</p>',
  },
  {
    handle: 'brand-marin',
    title: 'MARIN',
    logoFilename: 'marin.png',
    descriptionHtml: '<p>カリフォルニア・マリン郡発のスポーツバイクブランド、MARIN（マリン）。マウンテンバイクのパイオニアとしての歴史を持ち、クロスバイクやグラベルバイクでも高い評価を獲得。アクティブなライドスタイルを提案します。</p>',
  },
  {
    handle: 'brand-gios',
    title: 'GIOS',
    logoFilename: 'gios.png',
    descriptionHtml: '<p>イタリアの名門自転車ブランド、GIOS（ジオス）。トレードマークの「ジオスブルー」が映える美しいフレームデザインが特徴。ロードバイクやミニベロを中心に、イタリアンクラフトマンシップを感じられるモデルが揃います。</p>',
  },
  {
    handle: 'brand-yamaha',
    title: 'ヤマハ',
    logoFilename: 'yamaha.png',
    descriptionHtml: '<p>ヤマハの電動アシスト自転車「PAS」シリーズ。世界初の電動アシスト自転車を開発したパイオニアとして、長年の技術と信頼性を誇ります。通勤・通学用からお子様の送り迎え用まで、暮らしに寄り添うモデルをラインナップ。</p>',
  },
  {
    handle: 'brand-khodaabloom',
    title: 'KhodaaBloom',
    logoFilename: 'khodaabloom.png',
    descriptionHtml: '<p>日本のスポーツバイクブランド、KhodaaBloom（コーダーブルーム）。日本人の体格に合わせた設計と軽量フレームが特徴で、初めてのスポーツバイクにも最適。軽さと走りやすさを追求したロードバイクやクロスバイクを展開しています。</p>',
  },
  {
    handle: 'brand-bianchi',
    title: 'Bianchi',
    logoFilename: 'bianchi.png',
    descriptionHtml: '<p>1885年創業、イタリア最古の自転車ブランドBianchi（ビアンキ）。象徴的な「チェレステカラー」で知られ、ロードバイクからクロスバイク、ミニベロまで幅広く展開。歴史と伝統に裏打ちされた本格的なイタリアンバイクです。</p>',
  },
  {
    handle: 'brand-and-works',
    title: 'a.n.design works',
    logoFilename: null,
    descriptionHtml: '<p>a.n.design works（エー・エヌ・デザインワークス）のおしゃれで手頃な自転車。個性的なカラーバリエーションとデザイン性の高さが魅力。お子様用自転車からシティサイクルまで、日常使いにちょうどいいモデルが見つかります。</p>',
  },
  {
    handle: 'brand-nesto',
    title: 'NESTO',
    logoFilename: 'nesto.png',
    descriptionHtml: '<p>日本発のスポーツバイクブランド、NESTO（ネスト）。軽量で高品質なロードバイクやクロスバイクを、手の届きやすい価格で提供。独自の快適テクノロジーを搭載し、はじめてのスポーツバイクとして高い人気を誇ります。</p>',
  },
  {
    handle: 'brand-tern',
    title: 'tern',
    logoFilename: 'tern.png',
    descriptionHtml: '<p>折りたたみ自転車の世界的ブランド、tern（ターン）。コンパクトに折りたためるミニベロを中心に、通勤や輪行に最適なモデルを豊富にラインナップ。デザイン性と実用性を兼ね備えた都市型バイクです。</p>',
  },
  {
    handle: 'brand-jamis',
    title: 'JAMIS',
    logoFilename: null,
    descriptionHtml: '<p>アメリカ・フロリダ発の総合自転車ブランド、JAMIS（ジェイミス）。ロードバイク、クロスバイク、マウンテンバイクなど多彩なラインナップ。快適な乗り心地にこだわったフレーム設計と、手頃な価格が魅力です。</p>',
  },
  {
    handle: 'brand-d-bike',
    title: 'D-Bike',
    logoFilename: 'd-bike.png',
    descriptionHtml: '<p>ides（アイデス）の子ども向け自転車ブランド、D-Bike。三輪車からキックバイク、補助輪付き自転車まで、お子様の成長に合わせたステップアップモデルが充実。安全設計と楽しいデザインで、はじめての自転車体験をサポートします。</p>',
  },
  {
    handle: 'brand-renault',
    title: 'RENAULT',
    logoFilename: null,
    descriptionHtml: '<p>フランスの自動車ブランドRENAULT（ルノー）のライセンス自転車。軽量コンパクトな折りたたみミニベロが人気。街乗りや輪行に便利な超軽量モデルを取り揃えています。</p>',
  },
  {
    handle: 'brand-strider',
    title: 'STRIDER',
    logoFilename: 'strider.png',
    descriptionHtml: '<p>世界中で愛されるキッズ用バランスバイクブランド、STRIDER（ストライダー）。ペダルなしで地面を蹴って進むシンプルな構造で、お子様のバランス感覚を自然に育てます。2歳から始められる、はじめての乗り物に最適です。</p>',
  },
  {
    handle: 'brand-cycles',
    title: '!cycles',
    logoFilename: null,
    descriptionHtml: '<p>都市型ライフスタイル自転車ブランド、!cycles（バイシクルズ）。シンプルで洗練されたデザインのシティバイクやクロスバイクを展開。街に馴染むスタイリッシュな一台をお探しの方におすすめです。</p>',
  },
  {
    handle: 'brand-hummer',
    title: 'HUMMER',
    logoFilename: null,
    descriptionHtml: '<p>アメリカの力強いSUVブランドHUMMER（ハマー）のライセンス自転車。タフなデザインのファットバイクや折りたたみ自転車をラインナップ。見た目のインパクトと実用性を兼ね備えたモデルが揃います。</p>',
  },
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
// 既存ブランドコレクション取得
// ============================================================

interface CollectionInfo {
  id: string;
  handle: string;
  hasImage: boolean;
}

async function getBrandCollections(): Promise<Map<string, CollectionInfo>> {
  const map = new Map<string, CollectionInfo>();
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const variables: Record<string, unknown> = { first: 250 };
    if (cursor) variables.after = cursor;

    const result = await shopifyGraphQL<{
      collections: {
        edges: Array<{ node: { id: string; handle: string; image: { url: string } | null }; cursor: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(`
      query Collections($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
          edges {
            node { id handle image { url } }
            cursor
          }
          pageInfo { hasNextPage }
        }
      }
    `, variables);

    for (const edge of result.collections.edges) {
      if (edge.node.handle.startsWith('brand-')) {
        map.set(edge.node.handle, {
          id: edge.node.id,
          handle: edge.node.handle,
          hasImage: !!edge.node.image,
        });
      }
      cursor = edge.cursor;
    }
    hasNext = result.collections.pageInfo.hasNextPage;
  }

  return map;
}

// ============================================================
// ロゴダウンロード
// ============================================================

const LOGO_BASE_URL = 'http://shop.cyclespot.net/store/u_page/img/cyclespot/img/logo';
const LOGO_CACHE_DIR = path.resolve(__dirname, '../.brand-logos');

async function downloadLogo(filename: string): Promise<string | null> {
  const localPath = path.join(LOGO_CACHE_DIR, filename);

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  try {
    const response = await fetch(`${LOGO_BASE_URL}/${filename}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CycleSpot-Migration/1.0)' },
    });

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 100) return null;

    fs.writeFileSync(localPath, buffer);
    return localPath;
  } catch {
    return null;
  }
}

// ============================================================
// Staged Upload → コレクション画像設定
// ============================================================

async function uploadLogoToCollection(collectionId: string, localPath: string, filename: string): Promise<boolean> {
  const fileContent = fs.readFileSync(localPath);
  const fileSize = fileContent.length;
  const mimeType = 'image/png';

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

  // Step 3: コレクション画像として設定
  const updateResult = await shopifyGraphQL<{
    collectionUpdate: {
      collection: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(`
    mutation CollectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      id: collectionId,
      image: {
        src: target.resourceUrl,
        altText: `${filename.replace(/\.[^.]+$/, '')} ロゴ`,
      },
    },
  });

  return updateResult.collectionUpdate.userErrors.length === 0;
}

// ============================================================
// コレクション説明文更新
// ============================================================

async function updateCollectionDescription(collectionId: string, descriptionHtml: string): Promise<boolean> {
  const result = await shopifyGraphQL<{
    collectionUpdate: {
      collection: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(`
    mutation CollectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      id: collectionId,
      descriptionHtml,
    },
  });

  return result.collectionUpdate.userErrors.length === 0;
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('🏷️  ブランドデータ設定スクリプト');
  console.log('==================================');
  if (dryRun) console.log('⚠️  ドライランモード\n');

  console.log(`📋 対象ブランド: ${BRANDS.length} 件`);
  console.log(`  ロゴあり: ${BRANDS.filter(b => b.logoFilename).length} 件`);
  console.log(`  ロゴなし: ${BRANDS.filter(b => !b.logoFilename).length} 件\n`);

  if (dryRun) {
    for (const brand of BRANDS) {
      const logoStatus = brand.logoFilename ? `ロゴ: ${brand.logoFilename}` : 'ロゴなし';
      const descPreview = brand.descriptionHtml.replace(/<[^>]+>/g, '').slice(0, 50) + '...';
      console.log(`  ${brand.handle}`);
      console.log(`    ${brand.title} — ${logoStatus}`);
      console.log(`    紹介文: ${descPreview}`);
    }
    return;
  }

  // 環境変数チェック
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    console.error('❌ 環境変数が設定されていません');
    process.exit(1);
  }

  // 既存コレクション取得
  console.log('📋 ブランドコレクションを取得中...');
  const collections = await getBrandCollections();
  console.log(`  → ${collections.size} 件のブランドコレクションを検出\n`);

  // キャッシュディレクトリ作成
  fs.mkdirSync(LOGO_CACHE_DIR, { recursive: true });

  let descSuccess = 0;
  let logoSuccess = 0;
  let logoSkip = 0;
  let errorCount = 0;

  for (let i = 0; i < BRANDS.length; i++) {
    const brand = BRANDS[i];
    const collection = collections.get(brand.handle);

    if (!collection) {
      console.error(`  ✗ [${i + 1}/${BRANDS.length}] ${brand.handle} — コレクションが見つかりません`);
      errorCount++;
      continue;
    }

    try {
      // 説明文更新
      const descOk = await updateCollectionDescription(collection.id, brand.descriptionHtml);
      if (descOk) {
        descSuccess++;
      } else {
        console.error(`  ✗ [${i + 1}/${BRANDS.length}] ${brand.handle} — 説明文更新失敗`);
        errorCount++;
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }

      // ロゴアップロード
      if (brand.logoFilename) {
        if (collection.hasImage) {
          console.log(`  ✓ [${i + 1}/${BRANDS.length}] ${brand.handle} — 説明文更新 + ロゴ既存（スキップ）`);
          logoSkip++;
        } else {
          const localPath = await downloadLogo(brand.logoFilename);
          if (localPath) {
            const logoOk = await uploadLogoToCollection(collection.id, localPath, brand.logoFilename);
            if (logoOk) {
              console.log(`  ✓ [${i + 1}/${BRANDS.length}] ${brand.handle} — 説明文 + ロゴ設定完了`);
              logoSuccess++;
            } else {
              console.log(`  △ [${i + 1}/${BRANDS.length}] ${brand.handle} — 説明文更新OK、ロゴ設定失敗`);
            }
          } else {
            console.log(`  △ [${i + 1}/${BRANDS.length}] ${brand.handle} — 説明文更新OK、ロゴダウンロード失敗`);
          }
        }
      } else {
        console.log(`  ✓ [${i + 1}/${BRANDS.length}] ${brand.handle} — 説明文更新OK（ロゴなし）`);
      }
    } catch (err) {
      console.error(`  ✗ [${i + 1}/${BRANDS.length}] ${brand.handle} — ${err instanceof Error ? err.message : String(err)}`);
      errorCount++;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n==================================');
  console.log(`✅ 完了:`);
  console.log(`  説明文更新: ${descSuccess} 件`);
  console.log(`  ロゴ設定: ${logoSuccess} 件`);
  console.log(`  ロゴスキップ（既存）: ${logoSkip} 件`);
  console.log(`  エラー: ${errorCount} 件`);
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
