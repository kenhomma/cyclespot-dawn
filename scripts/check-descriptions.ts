/**
 * check-descriptions.ts - メタオブジェクトの description フィールドを確認
 */
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

// definition のフィールド確認
const defResult = await gql(`{
  metaobjectDefinitionByType(type: "store") {
    id
    fieldDefinitions { key name type { name } }
  }
}`);

const def = defResult.data?.metaobjectDefinitionByType;
console.log('📋 store メタオブジェクト定義フィールド:');
for (const f of (def?.fieldDefinitions || [])) {
  console.log(`  - ${f.key} (${f.type.name})`);
}

// 最初の5件のメタオブジェクトを確認
let hasMore = true;
let cursor: string | null = null;
let withDesc = 0;
let withoutDesc = 0;
let total = 0;

while (hasMore) {
  const afterClause = cursor ? `, after: "${cursor}"` : '';
  const result = await gql(`{
    metaobjects(type: "store", first: 50${afterClause}) {
      edges {
        node {
          handle
          fields { key value }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }`);

  const edges = result.data?.metaobjects?.edges || [];
  for (const { node } of edges) {
    total++;
    const desc = node.fields.find((f: any) => f.key === 'description');
    const name = node.fields.find((f: any) => f.key === 'name');
    if (desc?.value) {
      withDesc++;
    } else {
      withoutDesc++;
      if (total <= 10) {
        console.log(`  ⚠ ${node.handle}: ${name?.value || '?'} → description なし`);
      }
    }
  }

  hasMore = result.data?.metaobjects?.pageInfo?.hasNextPage;
  if (edges.length > 0) {
    cursor = edges[edges.length - 1].cursor;
  }
}

console.log(`\n📊 全 ${total} 件: description あり ${withDesc}, なし ${withoutDesc}`);
