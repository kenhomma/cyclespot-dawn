/**
 * add-image-field.ts
 * store メタオブジェクト定義に image フィールドを追加する
 */
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { const d = await import('dotenv'); d.config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<any>;
}

// Get definition ID
const defResult = await gql(`{
  metaobjectDefinitionByType(type: "store") {
    id
    fieldDefinitions { key }
  }
}`);

const def = defResult.data?.metaobjectDefinitionByType;
if (!def) {
  console.error('store metaobject definition not found');
  process.exit(1);
}

const existingKeys = def.fieldDefinitions.map((f: any) => f.key);
console.log('Existing fields:', existingKeys.join(', '));

if (existingKeys.includes('image')) {
  console.log('✓ image field already exists');
  process.exit(0);
}

// Add image field
const result = await gql(`
  mutation UpdateDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition { id }
      userErrors { field message }
    }
  }
`, {
  id: def.id,
  definition: {
    fieldDefinitions: [
      { create: { key: 'image', name: '店舗画像', type: 'file_reference' } },
    ],
  },
});

const errors = result.data?.metaobjectDefinitionUpdate?.userErrors || [];
if (errors.length > 0) {
  console.error('Error:', JSON.stringify(errors));
} else {
  console.log('✓ image field added to store metaobject');
}
