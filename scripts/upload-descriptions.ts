/**
 * upload-descriptions.ts
 * store-descriptions.tsv から店舗紹介文をメタオブジェクトに投入
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { const d = await import('dotenv'); d.config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || '';
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<any>;
}

// Step 1: Load descriptions from TSV
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
console.log(`📋 ${descMap.size} descriptions loaded from TSV\n`);

// Step 2: Get all store metaobjects (paginated)
let allStores: Array<{ id: string; handle: string; name: string; hasDesc: boolean }> = [];
let hasNext = true;
let cursor: string | null = null;

while (hasNext) {
  const afterClause = cursor ? `, after: "${cursor}"` : '';
  const result = await gql(`{
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
  }`);

  if (result.errors) {
    console.error('GraphQL errors:', JSON.stringify(result.errors));
    process.exit(1);
  }

  const edges = result.data?.metaobjects?.edges || [];
  for (const { node, cursor: c } of edges) {
    const nameField = node.fields.find((f: any) => f.key === 'name');
    const descField = node.fields.find((f: any) => f.key === 'description');
    allStores.push({
      id: node.id,
      handle: node.handle,
      name: nameField?.value || '',
      hasDesc: !!descField?.value,
    });
    cursor = c;
  }

  hasNext = result.data?.metaobjects?.pageInfo?.hasNextPage || false;
}

console.log(`📦 ${allStores.length} store metaobjects found`);
const needUpdate = allStores.filter(s => !s.hasDesc);
console.log(`🔄 ${needUpdate.length} need description update\n`);

// Step 3: Update each store with description
let updated = 0;
let noMatch = 0;
let errors = 0;

for (const store of needUpdate) {
  const desc = descMap.get(store.name);
  if (!desc) {
    console.log(`  ⏭ ${store.name}: no matching description in TSV`);
    noMatch++;
    continue;
  }

  const result = await gql(`
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `, {
    id: store.id,
    metaobject: {
      fields: [{ key: 'description', value: desc }],
    },
  });

  const errs = result.data?.metaobjectUpdate?.userErrors || [];
  if (errs.length > 0) {
    console.error(`  ✗ ${store.name}: ${JSON.stringify(errs)}`);
    errors++;
  } else {
    console.log(`  ✓ ${store.name}`);
    updated++;
  }

  await new Promise(r => setTimeout(r, 200));
}

console.log(`\n📊 Updated: ${updated}, No match: ${noMatch}, Errors: ${errors}`);
