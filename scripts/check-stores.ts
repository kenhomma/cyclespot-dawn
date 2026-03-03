/**
 * check-stores.ts — Shopify 上の store metaobject の現状を確認するスクリプト
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
} catch {}

const domain = process.env.SHOPIFY_STORE_DOMAIN!;
const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

const query = `{
  metaobjectDefinitionByType(type: "store") {
    id
    type
    fieldDefinitions { key name type { name } }
  }
  metaobjects(type: "store", first: 50) {
    edges {
      node {
        handle
        fields { key value }
      }
    }
    pageInfo { hasNextPage }
  }
}`;

const res = await fetch(`https://${domain}/admin/api/2024-01/graphql.json`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
  body: JSON.stringify({ query }),
});
const json = await res.json() as any;

const def = json.data?.metaobjectDefinitionByType;
const edges = json.data?.metaobjects?.edges || [];

console.log('=== Definition ===');
if (def) {
  console.log('Type:', def.type);
  console.log('Fields:', def.fieldDefinitions.map((f: any) => `${f.key} (${f.type.name})`).join(', '));
} else {
  console.log('Not found — definition has not been created yet');
}

console.log(`\n=== Store Entries (${edges.length}) ===`);
for (const e of edges) {
  const name = e.node.fields.find((f: any) => f.key === 'name')?.value || '?';
  const code = e.node.fields.find((f: any) => f.key === 'code')?.value || '?';
  const slug = e.node.fields.find((f: any) => f.key === 'slug')?.value || '?';
  console.log(`  ${e.node.handle.padEnd(25)} | ${code.padEnd(8)} | ${name}`);
}

if (edges.length === 0) {
  console.log('  (no entries found)');
}

console.log('\nHas next page:', json.data?.metaobjects?.pageInfo?.hasNextPage);
