/**
 * import-products.ts
 *
 * product_master CSV を読み込み、Shopify の Product / Variant / Metafields に
 * 一括登録するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/import-products.ts --dry-run           # プレビュー（API呼出なし）
 *   npx tsx scripts/import-products.ts --setup-metafields   # メタフィールド定義を作成
 *   npx tsx scripts/import-products.ts --limit=5            # 最初の5商品だけ登録
 *   npx tsx scripts/import-products.ts                      # 全商品を登録
 *
 * 環境変数 (.env):
 *   SHOPIFY_STORE_DOMAIN=cyclespot-lecyc.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxx
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM での __dirname 取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dotenv を動的インポート（インストールされている場合のみ）
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch {
  // dotenv がなくても動作可能
}

// ============================================================
// 型定義
// ============================================================

/** CSV から読み込んだ生データ（1行 = 1バリアント） */
interface CsvRow {
  SD02品番: string;
  SD04名称漢字: string;
  SD01メーカーコード: string;
  SDメーカー名称: string;
  SD08仕入先コード: string;
  SD09中分類コード: string;
  SD10小分類コード: string;
  SD11細分類コード: string;
  SD16バーコード: string;
  SDカラー名称: string;
  SDサイズ名称: string;
  SD18税抜原価: string;
  SD21希望小売価格: string;
  SD22税抜売価: string;
  SD中分類名称: string;
  SD小分類名称: string;
  SD細分類名称: string;
  ホイールサイズ: string;
  変速: string;
  ブレーキ: string;
  ポイント1フレーム: string;
  ポイント2フォーク: string;
  ポイント3コンポ: string;
  ポイント4スピード: string;
  ポイント5重量: string;
}

/** Shopify に送る Product 構造 */
interface ProductInput {
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  options: { name: string; values: { name: string }[] }[];
  variants: VariantInput[];
  metafields: MetafieldInput[];
}

interface VariantInput {
  sku: string;
  barcode: string;
  price: string;
  compareAtPrice?: string;
  optionValues: { optionName: string; name: string }[];
}

interface MetafieldInput {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

interface ImportResult {
  handle: string;
  hinban: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
}

// ============================================================
// CSV パース（csv-to-tsv.ts から流用）
// ============================================================

function parseRawCsv(content: string): string[][] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  return lines.map(line => {
    const values: string[] = [];
    let val = '';
    let q = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') {
        q = !q;
      } else if (c === ',' && !q) {
        values.push(val.trim());
        val = '';
      } else {
        val += c;
      }
    }
    values.push(val.trim());
    return values;
  });
}

function parseCsv(content: string): CsvRow[] {
  const rows = parseRawCsv(content);
  if (rows.length < 2) {
    throw new Error('CSV ファイルにデータ行がありません');
  }

  const headers = rows[0];
  return rows.slice(1).map(values => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i]?.trim() || '';
    });
    return row as unknown as CsvRow;
  });
}

// ============================================================
// 半角カタカナ → 全角カタカナ変換
// ============================================================

const HW_TO_FW: Record<string, string> = {
  'ｦ': 'ヲ', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ',
  'ｫ': 'ォ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
  'ｰ': 'ー', 'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ',
  'ｵ': 'オ', 'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ',
  'ｺ': 'コ', 'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ',
  'ｿ': 'ソ', 'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ',
  'ﾄ': 'ト', 'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ',
  'ﾉ': 'ノ', 'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ',
  'ﾎ': 'ホ', 'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ',
  'ﾓ': 'モ', 'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ', 'ﾗ': 'ラ',
  'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ', 'ﾜ': 'ワ',
  'ﾝ': 'ン',
};

const DAKUTEN_MAP: Record<string, string> = {
  'カ': 'ガ', 'キ': 'ギ', 'ク': 'グ', 'ケ': 'ゲ', 'コ': 'ゴ',
  'サ': 'ザ', 'シ': 'ジ', 'ス': 'ズ', 'セ': 'ゼ', 'ソ': 'ゾ',
  'タ': 'ダ', 'チ': 'ヂ', 'ツ': 'ヅ', 'テ': 'デ', 'ト': 'ド',
  'ハ': 'バ', 'ヒ': 'ビ', 'フ': 'ブ', 'ヘ': 'ベ', 'ホ': 'ボ',
  'ウ': 'ヴ',
};

const HANDAKUTEN_MAP: Record<string, string> = {
  'ハ': 'パ', 'ヒ': 'ピ', 'フ': 'プ', 'ヘ': 'ペ', 'ホ': 'ポ',
};

function hwToFw(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const fw = HW_TO_FW[ch];
    if (fw) {
      const next = str[i + 1];
      if (next === '\uFF9E' && DAKUTEN_MAP[fw]) {
        // 濁点 (ﾞ U+FF9E)
        result += DAKUTEN_MAP[fw];
        i++;
      } else if (next === '\uFF9F' && HANDAKUTEN_MAP[fw]) {
        // 半濁点 (ﾟ U+FF9F)
        result += HANDAKUTEN_MAP[fw];
        i++;
      } else {
        result += fw;
      }
    } else {
      result += ch;
    }
  }
  return result;
}

// ============================================================
// マッピング関数
// ============================================================

/** 品番 → Shopify handle（URL用スラッグ） */
function makeHandle(hinban: string): string {
  return hinban
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 税抜売価 → 税込価格（文字列） */
function taxInclusivePrice(taxExcludedStr: string): string {
  const raw = parseInt(taxExcludedStr, 10);
  if (isNaN(raw) || raw <= 0) return '0';
  return Math.round(raw * 1.10).toString();
}

/** 希望小売価格 → compare_at_price（0なら undefined） */
function compareAtPrice(msrpStr: string): string | undefined {
  const raw = parseInt(msrpStr, 10);
  if (isNaN(raw) || raw <= 0) return undefined;
  return Math.round(raw * 1.10).toString();
}

/** 全バリアントにリアルなサイズ情報があるか */
function hasRealSize(rows: CsvRow[]): boolean {
  return rows.some(r => r.SDサイズ名称 !== 'ｼﾃｲﾅｼ' && r.SDサイズ名称.trim() !== '');
}

/** 品番でグループ化 */
function groupByProduct(rows: CsvRow[]): Map<string, CsvRow[]> {
  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = row.SD02品番;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

/** CSVグループ → Shopify ProductInput へ変換 */
function buildProductInput(hinban: string, rows: CsvRow[]): ProductInput {
  const first = rows[0];
  const withSize = hasRealSize(rows);

  // ユニークなカラー値・サイズ値を収集（出現順を維持）
  const colorSet = new Set<string>();
  const sizeSet = new Set<string>();
  for (const row of rows) {
    colorSet.add(hwToFw(row.SDカラー名称));
    if (withSize) {
      sizeSet.add(row.SDサイズ名称);
    }
  }

  const options: { name: string; values: { name: string }[] }[] = [
    { name: 'カラー', values: [...colorSet].map(c => ({ name: c })) },
  ];
  if (withSize) {
    options.push({ name: 'サイズ', values: [...sizeSet].map(s => ({ name: s })) });
  }

  const variants: VariantInput[] = rows.map(row => {
    const optionValues: { optionName: string; name: string }[] = [
      { optionName: 'カラー', name: hwToFw(row.SDカラー名称) },
    ];
    if (withSize) {
      optionValues.push({ optionName: 'サイズ', name: row.SDサイズ名称 });
    }

    const variant: VariantInput = {
      sku: row.SD16バーコード,
      barcode: row.SD16バーコード,
      price: taxInclusivePrice(row.SD22税抜売価),
      optionValues,
    };

    const cap = compareAtPrice(row.SD21希望小売価格);
    if (cap) variant.compareAtPrice = cap;

    return variant;
  });

  // メタフィールド（商品レベルのスペック）
  const highlights = [
    first.ポイント1フレーム,
    first.ポイント2フォーク,
    first.ポイント3コンポ,
    first.ポイント4スピード,
    first.ポイント5重量,
  ].filter(Boolean);

  const metafields: MetafieldInput[] = [];

  if (first.ホイールサイズ) {
    metafields.push({
      namespace: 'specs',
      key: 'wheel_size',
      type: 'single_line_text_field',
      value: first.ホイールサイズ,
    });
  }
  if (first.変速) {
    metafields.push({
      namespace: 'specs',
      key: 'gear',
      type: 'single_line_text_field',
      value: hwToFw(first.変速),
    });
  }
  if (first.ブレーキ) {
    metafields.push({
      namespace: 'specs',
      key: 'brake',
      type: 'single_line_text_field',
      value: hwToFw(first.ブレーキ),
    });
  }
  if (highlights.length > 0) {
    metafields.push({
      namespace: 'specs',
      key: 'highlights',
      type: 'json',
      value: JSON.stringify(highlights),
    });
  }
  if (first.SD小分類名称) {
    metafields.push({
      namespace: 'specs',
      key: 'subcategory',
      type: 'single_line_text_field',
      value: hwToFw(first.SD小分類名称),
    });
  }

  return {
    handle: makeHandle(hinban),
    title: hwToFw(first.SD04名称漢字),
    vendor: hwToFw(first.SDメーカー名称),
    productType: first.SD中分類名称,
    options,
    variants,
    metafields,
  };
}

// ============================================================
// Shopify Admin API（2024-07 を使用）
// ============================================================

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';

function getShopifyGraphQLEndpoint(): string {
  if (!SHOPIFY_STORE_DOMAIN) {
    throw new Error('SHOPIFY_STORE_DOMAIN が設定されていません');
  }
  return `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/graphql.json`;
}

async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN が設定されていません');
  }

  const response = await fetch(getShopifyGraphQLEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API Error: ${response.status} ${response.statusText}\n${text}`);
  }

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// ============================================================
// GraphQL クエリ・ミューテーション
// ============================================================

const PRODUCT_SET_MUTATION = `
mutation ProductSet($input: ProductSetInput!, $synchronous: Boolean!) {
  productSet(synchronous: $synchronous, input: $input) {
    product {
      id
      handle
      title
      variants(first: 100) {
        edges {
          node {
            id
            sku
            price
          }
        }
      }
    }
    userErrors {
      code
      field
      message
    }
  }
}
`;

const GET_EXISTING_PRODUCTS = `
query ExistingProducts($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      node {
        handle
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
  }
}
`;

const CREATE_METAFIELD_DEFINITION = `
mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition {
      id
      namespace
      key
    }
    userErrors {
      field
      message
    }
  }
}
`;

// ============================================================
// 既存商品ハンドル取得（再実行スキップ用）
// ============================================================

async function getExistingHandles(): Promise<Set<string>> {
  const handles = new Set<string>();
  let cursor: string | null = null;
  let hasNext = true;

  console.log('📋 既存商品ハンドルを取得中...');

  while (hasNext) {
    const variables: Record<string, unknown> = { first: 250 };
    if (cursor) variables.after = cursor;

    const result = await shopifyGraphQL<{
      products: {
        edges: Array<{ node: { handle: string }; cursor: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(GET_EXISTING_PRODUCTS, variables);

    for (const edge of result.products.edges) {
      handles.add(edge.node.handle);
      cursor = edge.cursor;
    }

    hasNext = result.products.pageInfo.hasNextPage;
  }

  console.log(`  → ${handles.size} 件の既存商品を検出\n`);
  return handles;
}

// ============================================================
// メタフィールド定義作成
// ============================================================

async function setupMetafieldDefinitions(): Promise<void> {
  const definitions = [
    { namespace: 'specs', key: 'wheel_size', name: 'ホイールサイズ', type: 'single_line_text_field' },
    { namespace: 'specs', key: 'gear', name: '変速', type: 'single_line_text_field' },
    { namespace: 'specs', key: 'brake', name: 'ブレーキ', type: 'single_line_text_field' },
    { namespace: 'specs', key: 'highlights', name: '特徴ポイント', type: 'json' },
    { namespace: 'specs', key: 'subcategory', name: '小分類', type: 'single_line_text_field' },
  ];

  console.log('📋 メタフィールド定義を作成中...\n');

  for (const def of definitions) {
    try {
      const result = await shopifyGraphQL<{
        metafieldDefinitionCreate: {
          createdDefinition: { id: string } | null;
          userErrors: Array<{ field: string; message: string }>;
        };
      }>(CREATE_METAFIELD_DEFINITION, {
        definition: {
          name: def.name,
          namespace: def.namespace,
          key: def.key,
          type: def.type,
          ownerType: 'PRODUCT',
        },
      });

      const errors = result.metafieldDefinitionCreate.userErrors;
      if (errors.length > 0) {
        // "already exists" は警告扱い
        const alreadyExists = errors.some(e => e.message.includes('already') || e.message.includes('taken'));
        if (alreadyExists) {
          console.log(`  ⚠ specs.${def.key} — 既に存在します`);
        } else {
          console.error(`  ✗ specs.${def.key} — ${JSON.stringify(errors)}`);
        }
      } else {
        console.log(`  ✓ specs.${def.key} (${def.name})`);
      }
    } catch (err) {
      console.error(`  ✗ specs.${def.key} — ${err instanceof Error ? err.message : String(err)}`);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n✅ メタフィールド定義の作成が完了しました');
}

// ============================================================
// 商品登録（productSet）
// ============================================================

async function importProduct(product: ProductInput): Promise<ImportResult> {
  const input: Record<string, unknown> = {
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    status: 'DRAFT',
    productOptions: product.options.map((opt, idx) => ({
      name: opt.name,
      position: idx + 1,
      values: opt.values,
    })),
    variants: product.variants.map(v => {
      const variant: Record<string, unknown> = {
        optionValues: v.optionValues,
        price: v.price,
        sku: v.sku,
        barcode: v.barcode,
      };
      if (v.compareAtPrice) {
        variant.compareAtPrice = v.compareAtPrice;
      }
      return variant;
    }),
  };

  if (product.metafields.length > 0) {
    input.metafields = product.metafields.map(mf => ({
      namespace: mf.namespace,
      key: mf.key,
      type: mf.type,
      value: mf.value,
    }));
  }

  try {
    const result = await shopifyGraphQL<{
      productSet: {
        product: { id: string; handle: string; title: string } | null;
        userErrors: Array<{ code: string; field: string[]; message: string }>;
      };
    }>(PRODUCT_SET_MUTATION, { input, synchronous: true });

    if (result.productSet.userErrors.length > 0) {
      return {
        handle: product.handle,
        hinban: '',
        success: false,
        error: result.productSet.userErrors.map(e => e.message).join('; '),
      };
    }

    return {
      handle: result.productSet.product?.handle || product.handle,
      hinban: '',
      success: true,
    };
  } catch (err) {
    return {
      handle: product.handle,
      hinban: '',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const setupMetafields = args.includes('--setup-metafields');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  console.log('🚴 商品マスタインポートスクリプト');
  console.log('==================================');

  if (dryRun) {
    console.log('⚠️  ドライランモード（Shopify への書き込みは行いません）\n');
  }

  // --setup-metafields モード
  if (setupMetafields) {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      console.error('❌ 環境変数が設定されていません');
      process.exit(1);
    }
    await setupMetafieldDefinitions();
    return;
  }

  // CSV ファイル読み込み
  const csvPath = path.resolve(__dirname, '../../../../product_master (1).csv');
  console.log(`📂 CSV読み込み: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ ファイルが見つかりません: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCsv(csvContent);
  console.log(`  → ${rows.length} 件のバリアント行を読み込みました`);

  // 品番でグループ化
  const groups = groupByProduct(rows);
  console.log(`  → ${groups.size} 件のユニーク品番（= Shopify Product 数）\n`);

  // ProductInput へ変換
  const products: ProductInput[] = [];
  for (const [hinban, groupRows] of groups) {
    const product = buildProductInput(hinban, groupRows);
    products.push(product);
  }

  // limitが指定されている場合
  const targetProducts = limit ? products.slice(0, limit) : products;

  if (limit) {
    console.log(`📎 --limit=${limit} が指定されています。最初の ${targetProducts.length} 商品のみ処理します\n`);
  }

  // ドライランの場合
  if (dryRun) {
    console.log('📝 変換結果プレビュー:\n');

    // サマリー
    const totalVariants = targetProducts.reduce((sum, p) => sum + p.variants.length, 0);
    const withSizeCount = targetProducts.filter(p => p.options.length > 1).length;
    const colorOnlyCount = targetProducts.length - withSizeCount;

    console.log(`  商品数:        ${targetProducts.length}`);
    console.log(`  バリアント数:  ${totalVariants}`);
    console.log(`  カラーのみ:    ${colorOnlyCount} 商品`);
    console.log(`  カラー+サイズ: ${withSizeCount} 商品\n`);

    // 最初の3件を表示
    for (const p of targetProducts.slice(0, 3)) {
      console.log(`  ─── ${p.handle} ───`);
      console.log(`  title:       ${p.title}`);
      console.log(`  vendor:      ${p.vendor}`);
      console.log(`  productType: ${p.productType}`);
      console.log(`  options:     ${p.options.map(o => `${o.name}(${o.values.length})`).join(', ')}`);
      console.log(`  variants:    ${p.variants.length} 件`);
      for (const v of p.variants.slice(0, 2)) {
        const opts = v.optionValues.map(o => `${o.optionName}=${o.name}`).join(', ');
        console.log(`    - ¥${v.price} [${opts}] SKU:${v.sku}`);
      }
      if (p.variants.length > 2) {
        console.log(`    ... 他 ${p.variants.length - 2} バリアント`);
      }
      console.log(`  metafields:  ${p.metafields.map(m => m.key).join(', ')}`);
      console.log('');
    }

    // JSON ファイルに出力
    const outputPath = path.resolve(__dirname, '../dist/products-preview.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(targetProducts, null, 2));
    console.log(`📄 全データを ${outputPath} に出力しました`);
    return;
  }

  // 環境変数チェック
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    console.error('❌ 環境変数が設定されていません:');
    if (!SHOPIFY_STORE_DOMAIN) console.error('  - SHOPIFY_STORE_DOMAIN');
    if (!SHOPIFY_ADMIN_ACCESS_TOKEN) console.error('  - SHOPIFY_ADMIN_ACCESS_TOKEN');
    console.error('\n.env ファイルを確認してください。');
    process.exit(1);
  }

  // 既存商品のハンドルを取得（スキップ判定用）
  const existingHandles = await getExistingHandles();

  // 商品登録
  console.log('📤 Shopify への商品登録を開始...\n');

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const errors: { handle: string; error: string }[] = [];

  for (let i = 0; i < targetProducts.length; i++) {
    const product = targetProducts[i];

    // 既存チェック
    if (existingHandles.has(product.handle)) {
      console.log(`  ⏭ [${i + 1}/${targetProducts.length}] ${product.handle} — 既に存在、スキップ`);
      skipCount++;
      continue;
    }

    const result = await importProduct(product);

    if (result.success) {
      console.log(`  ✓ [${i + 1}/${targetProducts.length}] ${product.handle} — ${product.title} (${product.variants.length}バリアント)`);
      successCount++;
    } else {
      console.error(`  ✗ [${i + 1}/${targetProducts.length}] ${product.handle} — ${result.error}`);
      errors.push({ handle: product.handle, error: result.error || '不明なエラー' });
      errorCount++;
    }

    // Rate limit 対策（300ms待機）
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // サマリー
  console.log('\n==================================');
  console.log(`✅ 完了: 成功 ${successCount} 件, スキップ ${skipCount} 件, 失敗 ${errorCount} 件`);

  if (errors.length > 0) {
    console.log('\n❌ エラー一覧:');
    for (const e of errors) {
      console.log(`  - ${e.handle}: ${e.error}`);
    }
  }
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
