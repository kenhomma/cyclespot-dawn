/**
 * setup-menus.ts
 * Shopify ナビゲーションメニューを設定する
 *
 * 使い方:
 *   npx tsx scripts/setup-menus.ts            # 現在のメニュー一覧を表示
 *   npx tsx scripts/setup-menus.ts --update   # メニューとページを更新
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

async function rest(endpoint: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function getExistingPages(): Promise<Map<string, number>> {
  const pages = new Map<string, number>();
  let url = 'pages.json?limit=250';
  while (url) {
    const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/${url}`, {
      headers: { 'X-Shopify-Access-Token': TOKEN },
    });
    const json = await res.json() as any;
    for (const p of json.pages || []) pages.set(p.handle, p.id);
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]*)>;\s*rel="next"/);
    url = nextMatch ? `pages.json?limit=250&page_info=${nextMatch[1]}` : '';
  }
  return pages;
}

// ============================================================
const args = process.argv.slice(2);
const doUpdate = args.includes('--update');

// メニュー一覧取得
console.log('🔍 現在のメニュー:');
const result = await gql(`{
  menus(first: 20) {
    edges {
      node {
        id
        title
        handle
        items {
          id
          title
          url
          type
          items {
            id
            title
            url
            type
          }
        }
      }
    }
  }
}`);

if (result.errors) {
  console.log('GraphQL errors:', JSON.stringify(result.errors, null, 2));
}

const menus = result.data?.menus?.edges || [];
console.log(`メニュー数: ${menus.length}`);

for (const { node: menu } of menus) {
  console.log(`\n📋 ${menu.title} (handle: ${menu.handle}, id: ${menu.id})`);
  for (const item of menu.items) {
    console.log(`  - ${item.title} → ${item.url} [${item.type}]`);
    for (const sub of (item.items || [])) {
      console.log(`    - ${sub.title} → ${sub.url} [${sub.type}]`);
    }
  }
}

if (!doUpdate) {
  console.log('\nメニューを更新するには --update を付けて実行してください');
  process.exit(0);
}

// ============================================================
// Step 1: プレースホルダーページを作成
// ============================================================
console.log('\n\n📝 Step 1: プレースホルダーページ作成');
console.log('====================================');

const existingPages = await getExistingPages();
console.log(`既存ページ: ${existingPages.size} 件`);

const placeholderPages = [
  { handle: 'guide', title: '選び方・安心サポート', body: '<p>自転車の選び方ガイド、安心の修理・メンテナンスサポートについてご案内します。</p>' },
  { handle: 'stories', title: 'ストーリー・スタッフ', body: '<p>サイクルスポットのスタッフが語る、自転車と暮らしのストーリー。</p>' },
  { handle: 'about', title: '企業・ブランド情報', body: '<p>サイクルスポットの企業情報、ブランドビジョン、そして私たちが大切にしていること。</p>' },
  { handle: 'jobs', title: '採用情報', body: '<p>サイクルスポットで一緒に働きませんか？仲間を募集しています。</p>' },
  { handle: 'beginner-guide', title: 'はじめてガイド', body: '<p>はじめて自転車屋さんに来る方へ。空気入れだけでもお気軽にどうぞ。</p>' },
  { handle: 'support', title: '修理・メンテナンス', body: '<p>パンク修理から定期メンテナンスまで。お気軽にご相談ください。</p>' },
  { handle: 'brand-promises', title: '10の約束', body: '<p>サイクルスポットがお客様に約束する10のこと。</p>' },
];

for (const page of placeholderPages) {
  if (existingPages.has(page.handle)) {
    console.log(`  ⏭ ${page.handle} (既に存在)`);
    continue;
  }
  try {
    await rest('pages.json', 'POST', {
      page: { title: page.title, handle: page.handle, body_html: page.body, published: true },
    });
    console.log(`  ✓ ${page.handle}: ${page.title}`);
  } catch (err) {
    console.error(`  ✗ ${page.handle}: ${err instanceof Error ? err.message : err}`);
  }
  await new Promise(r => setTimeout(r, 500));
}

// ============================================================
// Step 2: メインメニュー更新
// ============================================================
console.log('\n\n📝 Step 2: メインメニュー更新');
console.log('====================================');

const mainMenuEdge = menus.find((e: any) => e.node.handle === 'main-menu');

if (!mainMenuEdge) {
  console.log('メインメニューが存在しません。新規作成します...');
  const r = await gql(`
    mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
      menuCreate(title: $title, handle: $handle, items: $items) {
        menu { id title }
        userErrors { field message }
      }
    }
  `, {
    title: 'Main menu',
    handle: 'main-menu',
    items: buildMainMenuItems(),
  });
  logResult('メインメニュー作成', r.data?.menuCreate);
} else {
  const menuId = mainMenuEdge.node.id;
  console.log(`メインメニュー (${menuId}) を更新...`);

  // 既存アイテムを全削除してから新規追加
  const existingItemIds = mainMenuEdge.node.items.map((item: any) => item.id);

  // まず既存アイテムを削除
  if (existingItemIds.length > 0) {
    const deleteResult = await gql(`
      mutation menuUpdate($id: ID!, $items: [MenuItemUpdateInput!]!) {
        menuUpdate(id: $id, items: $items) {
          menu { id }
          userErrors { field message }
        }
      }
    `, {
      id: menuId,
      items: [], // 空にする
    });
    if (deleteResult.data?.menuUpdate?.userErrors?.length > 0) {
      console.log('アイテム削除エラー:', JSON.stringify(deleteResult.data.menuUpdate.userErrors, null, 2));
    }
  }

  // 新しいアイテムを追加
  const addResult = await gql(`
    mutation menuUpdate($id: ID!, $items: [MenuItemUpdateInput!]!, $addItems: [MenuItemCreateInput!]!) {
      menuUpdate(id: $id, items: $items, addItems: $addItems) {
        menu {
          id
          items {
            title
            url
            items { title url }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    id: menuId,
    items: [],
    addItems: buildMainMenuItems(),
  });
  logResult('メインメニュー更新', addResult.data?.menuUpdate);

  if (addResult.data?.menuUpdate?.menu?.items) {
    for (const item of addResult.data.menuUpdate.menu.items) {
      console.log(`  - ${item.title} → ${item.url}`);
      for (const sub of (item.items || [])) {
        console.log(`    - ${sub.title} → ${sub.url}`);
      }
    }
  }
}

// ============================================================
// Step 3: フッターメニュー作成
// ============================================================
console.log('\n\n📝 Step 3: フッターメニュー作成');
console.log('====================================');

const existingMenuHandles = new Set(menus.map((e: any) => e.node.handle));

const footerMenus = [
  {
    handle: 'footer-browse',
    title: '自転車を探す（フッター）',
    items: [
      { title: '電動アシスト自転車', type: 'HTTP', url: `https://${DOMAIN}/collections/e-bikes` },
      { title: 'シティサイクル', type: 'HTTP', url: `https://${DOMAIN}/collections/city-bikes` },
      { title: 'スポーツバイク', type: 'HTTP', url: `https://${DOMAIN}/collections/sports-bikes` },
      { title: 'ミニベロ・小径車', type: 'HTTP', url: `https://${DOMAIN}/collections/mini-velo` },
      { title: '子供用自転車', type: 'HTTP', url: `https://${DOMAIN}/collections/kids-bikes` },
      { title: 'すべての自転車', type: 'HTTP', url: `https://${DOMAIN}/collections/all` },
    ],
  },
  {
    handle: 'footer-stores',
    title: '店舗・サービス（フッター）',
    items: [
      { title: '店舗を探す', type: 'HTTP', url: `https://${DOMAIN}/pages/stores` },
      { title: '修理・メンテナンス', type: 'HTTP', url: `https://${DOMAIN}/pages/support` },
      { title: 'お問い合わせ', type: 'HTTP', url: `https://${DOMAIN}/pages/contact` },
    ],
  },
  {
    handle: 'footer-support',
    title: '選び方・安心サポート（フッター）',
    items: [
      { title: '選び方ガイド', type: 'HTTP', url: `https://${DOMAIN}/pages/guide` },
      { title: 'はじめてガイド', type: 'HTTP', url: `https://${DOMAIN}/pages/beginner-guide` },
      { title: '修理・メンテナンス', type: 'HTTP', url: `https://${DOMAIN}/pages/support` },
    ],
  },
  {
    handle: 'footer-stories',
    title: 'ストーリー・スタッフ（フッター）',
    items: [
      { title: 'ストーリー一覧', type: 'HTTP', url: `https://${DOMAIN}/pages/stories` },
      { title: '10の約束', type: 'HTTP', url: `https://${DOMAIN}/pages/brand-promises` },
    ],
  },
  {
    handle: 'footer-about',
    title: '企業・ブランド情報（フッター）',
    items: [
      { title: '企業情報', type: 'HTTP', url: `https://${DOMAIN}/pages/about` },
      { title: 'ビジョン・ミッション', type: 'HTTP', url: `https://${DOMAIN}/pages/about` },
    ],
  },
  {
    handle: 'footer-news-jobs',
    title: 'お知らせ・採用（フッター）',
    items: [
      { title: 'お知らせ', type: 'HTTP', url: `https://${DOMAIN}/blogs/news` },
      { title: '採用情報', type: 'HTTP', url: `https://${DOMAIN}/pages/jobs` },
    ],
  },
];

for (const fm of footerMenus) {
  if (existingMenuHandles.has(fm.handle)) {
    console.log(`  ⏭ ${fm.handle} (既に存在 — スキップ)`);
    continue;
  }
  try {
    const r = await gql(`
      mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
        menuCreate(title: $title, handle: $handle, items: $items) {
          menu { id title handle }
          userErrors { field message }
        }
      }
    `, { title: fm.title, handle: fm.handle, items: fm.items });
    logResult(`フッター ${fm.handle}`, r.data?.menuCreate);
  } catch (err) {
    console.error(`  ✗ ${fm.handle}: ${err instanceof Error ? err.message : err}`);
  }
  await new Promise(r => setTimeout(r, 500));
}

console.log('\n✅ ナビゲーション設定完了');

// ============================================================
// Helper functions
// ============================================================

function buildMainMenuItems() {
  return [
    {
      title: 'ホーム',
      type: 'HTTP',
      url: `https://${DOMAIN}`,
    },
    {
      title: '自転車を探す',
      type: 'HTTP',
      url: `https://${DOMAIN}/collections`,
      items: [
        { title: '電動アシスト自転車', type: 'HTTP', url: `https://${DOMAIN}/collections/e-bikes` },
        { title: 'シティサイクル', type: 'HTTP', url: `https://${DOMAIN}/collections/city-bikes` },
        { title: 'スポーツバイク', type: 'HTTP', url: `https://${DOMAIN}/collections/sports-bikes` },
        { title: 'ミニベロ・小径車', type: 'HTTP', url: `https://${DOMAIN}/collections/mini-velo` },
        { title: '子供用自転車', type: 'HTTP', url: `https://${DOMAIN}/collections/kids-bikes` },
        { title: 'すべての自転車', type: 'HTTP', url: `https://${DOMAIN}/collections` },
      ],
    },
    {
      title: '店舗・サービス',
      type: 'HTTP',
      url: `https://${DOMAIN}/pages/stores`,
    },
    {
      title: '選び方・安心サポート',
      type: 'HTTP',
      url: `https://${DOMAIN}/pages/guide`,
    },
    {
      title: 'ストーリー・スタッフ',
      type: 'HTTP',
      url: `https://${DOMAIN}/pages/stories`,
    },
    {
      title: '企業・ブランド情報',
      type: 'HTTP',
      url: `https://${DOMAIN}/pages/about`,
    },
    {
      title: 'お知らせ・採用',
      type: 'HTTP',
      url: `https://${DOMAIN}/blogs/news`,
    },
  ];
}

function logResult(label: string, result: any) {
  if (result?.userErrors?.length > 0) {
    console.error(`  ❌ ${label}:`, JSON.stringify(result.userErrors, null, 2));
  } else {
    console.log(`  ✓ ${label}: OK`);
  }
}
