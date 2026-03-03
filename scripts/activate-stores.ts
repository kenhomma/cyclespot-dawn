import 'dotenv/config';

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const API = `https://${DOMAIN}/admin/api/2024-01/graphql.json`;

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<any>;
}

async function main() {
  let cursor: string | null = null;
  let totalUpdated = 0;
  let totalErrors = 0;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const res = await gql(`{
      metaobjects(type: "store", first: 50${afterClause}) {
        edges {
          node {
            id
            handle
            displayName
            capabilities {
              publishable { status }
            }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }`);

    const edges = res.data?.metaobjects?.edges || [];
    if (edges.length === 0) break;

    for (const edge of edges) {
      const { id, handle, displayName, capabilities } = edge.node;
      const status = capabilities?.publishable?.status;

      if (status === 'ACTIVE') {
        console.log(`  ✓ ${displayName} (already active)`);
        continue;
      }

      // Update to ACTIVE
      const updateRes = await gql(`
        mutation($id: ID!) {
          metaobjectUpdate(id: $id, metaobject: {
            capabilities: { publishable: { status: ACTIVE } }
          }) {
            metaobject { id handle }
            userErrors { field message }
          }
        }
      `, { id });

      const errors = updateRes.data?.metaobjectUpdate?.userErrors || [];
      if (errors.length > 0) {
        console.error(`  ✗ ${displayName}: ${errors.map((e: any) => e.message).join(', ')}`);
        totalErrors++;
      } else {
        console.log(`  ✓ ${displayName}`);
        totalUpdated++;
      }
    }

    const pageInfo = res.data?.metaobjects?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = edges[edges.length - 1].cursor;
  }

  console.log(`\n📊 Updated: ${totalUpdated}, Errors: ${totalErrors}`);
}

main().catch(console.error);
