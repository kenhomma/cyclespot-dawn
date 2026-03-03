/**
 * rebuild-main-menu.ts
 * メインメニューのアイテムを新構成で完全置換する
 */
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { const d = await import('dotenv'); d.config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<any>;
}

const storeUrl = `https://${DOMAIN}`;

// menuUpdate with full replacement using MenuItemUpdateInput (id is optional → new items)
console.log('📝 メインメニューを新構成に更新...');
const updateResult = await gql(`
  mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        items {
          title
          url
          type
          items { title url type }
        }
      }
      userErrors { field message }
    }
  }
`, {
  id: 'gid://shopify/Menu/313497125230',
  title: 'Main menu',
  items: [
    { title: 'ホーム', type: 'HTTP', url: storeUrl },
    {
      title: '自転車を探す',
      type: 'HTTP',
      url: `${storeUrl}/collections`,
      items: [
        { title: '電動アシスト自転車', type: 'HTTP', url: `${storeUrl}/collections/e-bikes` },
        { title: 'シティサイクル', type: 'HTTP', url: `${storeUrl}/collections/city-bikes` },
        { title: 'スポーツバイク', type: 'HTTP', url: `${storeUrl}/collections/sports-bikes` },
        { title: 'ミニベロ・小径車', type: 'HTTP', url: `${storeUrl}/collections/mini-velo` },
        { title: '子供用自転車', type: 'HTTP', url: `${storeUrl}/collections/kids-bikes` },
        { title: 'すべての自転車', type: 'HTTP', url: `${storeUrl}/collections` },
      ],
    },
    { title: '店舗・サービス', type: 'HTTP', url: `${storeUrl}/pages/stores` },
    { title: '選び方・安心サポート', type: 'HTTP', url: `${storeUrl}/pages/guide` },
    { title: 'ストーリー・スタッフ', type: 'HTTP', url: `${storeUrl}/pages/stories` },
    { title: '企業・ブランド情報', type: 'HTTP', url: `${storeUrl}/pages/about` },
    { title: 'お知らせ・採用', type: 'HTTP', url: `${storeUrl}/blogs/news` },
  ],
});

if (updateResult.errors) {
  console.error('GraphQL errors:', JSON.stringify(updateResult.errors, null, 2));
  process.exit(1);
}
if (updateResult.data?.menuUpdate?.userErrors?.length > 0) {
  console.error('User errors:', JSON.stringify(updateResult.data.menuUpdate.userErrors, null, 2));
  process.exit(1);
}

console.log('✅ メインメニュー更新完了:');
const menu = updateResult.data?.menuUpdate?.menu;
if (menu) {
  for (const item of menu.items) {
    console.log(`  - ${item.title} → ${item.url} [${item.type}]`);
    for (const sub of (item.items || [])) {
      console.log(`    - ${sub.title} → ${sub.url} [${sub.type}]`);
    }
  }
}
