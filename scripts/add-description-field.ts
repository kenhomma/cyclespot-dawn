/**
 * add-description-field.ts
 * store メタオブジェクト定義に description フィールドを追加し、
 * store-descriptions.tsv からデータを投入する
 */
import * as fs from 'fs';
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

// Step 1: Add description field to definition
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

if (!existingKeys.includes('description')) {
  console.log('Adding description field...');
  const addResult = await gql(`
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
        { create: { key: 'description', name: '店舗紹介文', type: 'multi_line_text_field' } },
      ],
    },
  });

  const errors = addResult.data?.metaobjectDefinitionUpdate?.userErrors || [];
  if (errors.length > 0) {
    console.error('Error adding field:', JSON.stringify(errors));
    process.exit(1);
  }
  console.log('✓ description field added');
} else {
  console.log('✓ description field already exists');
}

// Step 2: Load descriptions
const descPath = path.resolve(__dirname, '../../../docs/store-descriptions.tsv');
const descContent = fs.readFileSync(descPath, 'utf-8');
const lines = descContent.trim().split('\n');
const descMap = new Map<string, string>();
for (let i = 1; i < lines.length; i++) {
  const [name, ...descParts] = lines[i].split('\t');
  const desc = descParts.join('\t').trim();
  if (name && desc) {
    descMap.set(name.trim(), desc);
  }
}
console.log(`\n📋 ${descMap.size} descriptions loaded`);

// Step 3: Get all store metaobjects
const storesResult = await gql(`{
  metaobjectsByType(type: "store", first: 250) {
    edges {
      node {
        id
        handle
        field(key: "name") { value }
        descField: field(key: "description") { value }
      }
    }
  }
}`);

const stores = storesResult.data?.metaobjectsByType?.edges || [];
console.log(`📦 ${stores.length} store metaobjects found\n`);

let updated = 0;
let skipped = 0;

for (const { node } of stores) {
  const storeName = node.field?.value || '';
  const existingDesc = node.descField?.value || '';

  if (existingDesc) {
    skipped++;
    continue;
  }

  const desc = descMap.get(storeName);
  if (!desc) {
    console.log(`  ⏭ ${storeName}: no description found`);
    skipped++;
    continue;
  }

  const updateResult = await gql(`
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `, {
    id: node.id,
    metaobject: {
      fields: [{ key: 'description', value: desc }],
    },
  });

  const errors = updateResult.data?.metaobjectUpdate?.userErrors || [];
  if (errors.length > 0) {
    console.error(`  ✗ ${storeName}: ${JSON.stringify(errors)}`);
  } else {
    console.log(`  ✓ ${storeName}`);
    updated++;
  }

  await new Promise(r => setTimeout(r, 200));
}

console.log(`\n📊 Updated: ${updated}, Skipped: ${skipped}`);
