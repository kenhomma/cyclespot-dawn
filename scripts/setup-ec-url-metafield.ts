/**
 * setup-ec-url-metafield.ts
 *
 * 商品に custom.ec_url メタフィールド定義を作成するワンショットスクリプト。
 * 外部ECサイト（shop.cyclespot.net）の商品ページURLを格納するためのフィールド。
 *
 * 使い方:
 *   npx tsx scripts/setup-ec-url-metafield.ts
 */

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
const GRAPHQL_URL = `https://${DOMAIN}/admin/api/2024-01/graphql.json`;

async function shopifyGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data!;
}

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

async function main() {
  console.log('📋 custom.ec_url メタフィールド定義を作成中...\n');

  const result = await shopifyGraphQL<{
    metafieldDefinitionCreate: {
      createdDefinition: { id: string; namespace: string; key: string } | null;
      userErrors: Array<{ field: string; message: string }>;
    };
  }>(CREATE_METAFIELD_DEFINITION, {
    definition: {
      name: 'ECサイトURL',
      namespace: 'custom',
      key: 'ec_url',
      type: 'url',
      ownerType: 'PRODUCT',
      description: '外部ECサイト（shop.cyclespot.net）の商品ページURL',
      access: {
        storefront: 'PUBLIC_READ',
      },
    },
  });

  const errors = result.metafieldDefinitionCreate.userErrors;
  if (errors.length > 0) {
    const alreadyExists = errors.some(e => e.message.includes('already') || e.message.includes('taken'));
    if (alreadyExists) {
      console.log('  ⚠ custom.ec_url — 既に存在します');
    } else {
      console.error(`  ✗ エラー: ${JSON.stringify(errors, null, 2)}`);
      process.exit(1);
    }
  } else {
    const created = result.metafieldDefinitionCreate.createdDefinition!;
    console.log(`  ✓ ${created.namespace}.${created.key} (ID: ${created.id})`);
  }

  console.log('\n✅ 完了');
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
