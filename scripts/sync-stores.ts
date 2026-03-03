/**
 * sync-stores.ts
 *
 * 店舗マスタ（TSV）を読み込み、Shopify の store metaobject に同期するスクリプト
 *
 * 使い方:
 *   npm run sync-stores
 *   # または
 *   npx tsx scripts/sync-stores.ts [--dry-run]
 *
 * 環境変数 (.env):
 *   SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
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

/** TSV から読み込んだ生データ */
interface StoreTsvRow {
  shortname: string;
  slug: string;
  name: string;
  zip: string;
  prefecture: string;
  city: string;
  address1: string;
  address2: string;
  tel: string;
  holiday: string;
  hours: string;
  lat: string;
  lng: string;
  gmb: string;
}

/** Shopify store metaobject 用のフィールド */
interface StoreMetaobjectFields {
  code: string;           // ← shortname
  name: string;           // ← name
  type: string;           // ← name から判定（サイクルスポット / ル・サイク）
  address: string;        // ← zip + prefecture + city + address1 + address2
  latitude: string;       // ← lat
  longitude: string;      // ← lng
  opening_hours: string;  // ← hours
  regular_holiday: string;// ← holiday
  phone: string;          // ← tel
  gmb_url: string;        // ← gmb
  slug: string;           // ← slug（URLスラッグ用）
}

/** GraphQL 用の metaobject input */
interface MetaobjectFieldInput {
  key: string;
  value: string;
}

// ============================================================
// TSV パース
// ============================================================

function parseTsv(content: string): StoreTsvRow[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('TSV ファイルにデータ行がありません');
  }

  const headers = lines[0].split('\t');
  const rows: StoreTsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || '';
    });

    rows.push(row as unknown as StoreTsvRow);
  }

  return rows;
}

// ============================================================
// マッピング関数
// ============================================================

/**
 * 店舗名から店舗タイプを判定
 * - 「ル・サイク」で始まる → "le_cyc"
 * - 「サイクルスポット」で始まる → "cyclespot"
 * - その他 → "other"
 */
function determineStoreType(name: string): string {
  if (name.startsWith('ル・サイク')) {
    return 'le_cyc';
  } else if (name.startsWith('サイクルスポット')) {
    return 'cyclespot';
  }
  return 'other';
}

/**
 * 住所を結合
 */
function buildFullAddress(row: StoreTsvRow): string {
  const parts = [
    row.zip ? `〒${row.zip}` : '',
    row.prefecture,
    row.city,
    row.address1,
    row.address2,
  ].filter(Boolean);

  return parts.join(' ');
}

/**
 * TSV行 → StoreMetaobjectFields へ変換
 */
function mapToMetaobjectFields(row: StoreTsvRow): StoreMetaobjectFields {
  return {
    code: row.shortname,
    name: row.name,
    type: determineStoreType(row.name),
    address: buildFullAddress(row),
    latitude: row.lat,
    longitude: row.lng,
    opening_hours: row.hours,
    regular_holiday: row.holiday,
    phone: row.tel,
    gmb_url: row.gmb,
    slug: row.slug,
  };
}

/**
 * StoreMetaobjectFields → GraphQL用フィールド配列
 */
function toGraphQLFields(fields: StoreMetaobjectFields): MetaobjectFieldInput[] {
  return [
    { key: 'code', value: fields.code },
    { key: 'name', value: fields.name },
    { key: 'type', value: fields.type },
    { key: 'address', value: fields.address },
    { key: 'latitude', value: fields.latitude },
    { key: 'longitude', value: fields.longitude },
    { key: 'opening_hours', value: fields.opening_hours },
    { key: 'regular_holiday', value: fields.regular_holiday },
    { key: 'phone', value: fields.phone },
    { key: 'gmb_url', value: fields.gmb_url },
    { key: 'slug', value: fields.slug },
  ];
}

// ============================================================
// Shopify Admin API
// ============================================================

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';

function getShopifyGraphQLEndpoint(): string {
  if (!SHOPIFY_STORE_DOMAIN) {
    throw new Error('SHOPIFY_STORE_DOMAIN が設定されていません');
  }
  return `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`;
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
    throw new Error(`Shopify API Error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// ============================================================
// Metaobject Definition 作成（なければ作る）
// ============================================================

const CREATE_METAOBJECT_DEFINITION = `
mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition {
      id
      type
    }
    userErrors {
      field
      message
    }
  }
}
`;

const GET_METAOBJECT_DEFINITION = `
query GetMetaobjectDefinition($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id
    type
    fieldDefinitions {
      key
      type {
        name
      }
    }
  }
}
`;

async function ensureMetaobjectDefinition(): Promise<void> {
  console.log('📋 store metaobject 定義を確認中...');

  // 既存定義をチェック
  const existing = await shopifyGraphQL<{
    metaobjectDefinitionByType: { id: string; type: string } | null;
  }>(GET_METAOBJECT_DEFINITION, { type: 'store' });

  if (existing.metaobjectDefinitionByType) {
    console.log('  ✓ store metaobject 定義は既に存在します');
    return;
  }

  // 定義を作成
  console.log('  → store metaobject 定義を作成します...');

  const definition = {
    type: 'store',
    name: '店舗',
    displayNameKey: 'name',
    fieldDefinitions: [
      { key: 'code', name: '店舗コード', type: 'single_line_text_field' },
      { key: 'name', name: '店舗名', type: 'single_line_text_field' },
      { key: 'type', name: '店舗タイプ', type: 'single_line_text_field' },
      { key: 'address', name: '住所', type: 'single_line_text_field' },
      { key: 'latitude', name: '緯度', type: 'single_line_text_field' },
      { key: 'longitude', name: '経度', type: 'single_line_text_field' },
      { key: 'opening_hours', name: '営業時間', type: 'single_line_text_field' },
      { key: 'regular_holiday', name: '定休日', type: 'single_line_text_field' },
      { key: 'phone', name: '電話番号', type: 'single_line_text_field' },
      { key: 'gmb_url', name: 'Google Maps URL', type: 'url' },
      { key: 'slug', name: 'URLスラッグ', type: 'single_line_text_field' },
    ],
  };

  const result = await shopifyGraphQL<{
    metaobjectDefinitionCreate: {
      metaobjectDefinition: { id: string } | null;
      userErrors: Array<{ field: string; message: string }>;
    };
  }>(CREATE_METAOBJECT_DEFINITION, { definition });

  if (result.metaobjectDefinitionCreate.userErrors.length > 0) {
    throw new Error(`Definition creation failed: ${JSON.stringify(result.metaobjectDefinitionCreate.userErrors)}`);
  }

  console.log('  ✓ store metaobject 定義を作成しました');
}

// ============================================================
// Metaobject Upsert
// ============================================================

const UPSERT_METAOBJECT = `
mutation UpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject {
      id
      handle
    }
    userErrors {
      field
      message
    }
  }
}
`;

interface UpsertResult {
  success: boolean;
  handle: string;
  error?: string;
}

async function upsertStore(fields: StoreMetaobjectFields): Promise<UpsertResult> {
  const handle = {
    type: 'store',
    handle: fields.slug, // slug を handle として使用（英数字のみ）
  };

  const metaobject = {
    fields: toGraphQLFields(fields),
  };

  try {
    const result = await shopifyGraphQL<{
      metaobjectUpsert: {
        metaobject: { id: string; handle: string } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(UPSERT_METAOBJECT, { handle, metaobject });

    if (result.metaobjectUpsert.userErrors.length > 0) {
      return {
        success: false,
        handle: fields.slug,
        error: JSON.stringify(result.metaobjectUpsert.userErrors),
      };
    }

    return {
      success: true,
      handle: result.metaobjectUpsert.metaobject?.handle || fields.code,
    };
  } catch (err) {
    return {
      success: false,
      handle: fields.slug,
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

  console.log('🚴 店舗マスタ同期スクリプト');
  console.log('===========================');

  if (dryRun) {
    console.log('⚠️  ドライランモード（Shopify への書き込みは行いません）\n');
  }

  // TSV ファイル読み込み
  const tsvPath = path.resolve(__dirname, '../../../docs/store-master-full.tsv');
  console.log(`📂 TSV読み込み: ${tsvPath}`);

  if (!fs.existsSync(tsvPath)) {
    console.error(`❌ ファイルが見つかりません: ${tsvPath}`);
    process.exit(1);
  }

  const tsvContent = fs.readFileSync(tsvPath, 'utf-8');
  const rows = parseTsv(tsvContent);
  console.log(`  → ${rows.length} 件の店舗データを読み込みました\n`);

  // マッピング
  const stores = rows.map(mapToMetaobjectFields);

  if (dryRun) {
    // ドライランの場合は変換結果を表示
    console.log('📝 変換結果プレビュー:');
    console.log(JSON.stringify(stores.slice(0, 3), null, 2));
    console.log(`  ... 他 ${stores.length - 3} 件\n`);

    // JSON ファイルに出力
    const outputPath = path.resolve(__dirname, '../dist/stores-preview.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(stores, null, 2));
    console.log(`📄 全データを ${outputPath} に出力しました`);
    return;
  }

  // 環境変数チェック
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    console.error('❌ 環境変数が設定されていません:');
    if (!SHOPIFY_STORE_DOMAIN) console.error('  - SHOPIFY_STORE_DOMAIN');
    if (!SHOPIFY_ADMIN_ACCESS_TOKEN) console.error('  - SHOPIFY_ADMIN_ACCESS_TOKEN');
    console.error('\n.env ファイルを作成するか、環境変数を設定してください。');
    console.error('例: SHOPIFY_STORE_DOMAIN=your-store.myshopify.com');
    process.exit(1);
  }

  // Metaobject 定義確認・作成
  await ensureMetaobjectDefinition();

  // Upsert 実行
  console.log('\n📤 Shopify への同期を開始...');

  let successCount = 0;
  let errorCount = 0;

  for (const store of stores) {
    const result = await upsertStore(store);

    if (result.success) {
      console.log(`  ✓ ${store.code}: ${store.name}`);
      successCount++;
    } else {
      console.error(`  ✗ ${store.code}: ${result.error}`);
      errorCount++;
    }

    // Rate limit 対策（0.5秒待機）
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n===========================');
  console.log(`✅ 完了: 成功 ${successCount} 件, 失敗 ${errorCount} 件`);
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
