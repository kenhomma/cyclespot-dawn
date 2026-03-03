/**
 * setup-site-structure.ts
 *
 * サイト全体の構成を整備するワンショットスクリプト:
 * 1. フッターメニュー作成（footer-browse, footer-stores）
 * 2. ブログ「お知らせ」セットアップ（既存 News → 名前変更）
 * 3. カスタムCSS（カート非表示）をテーマに追加
 * 4. ロケール設定確認
 *
 * 使い方:
 *   npx tsx scripts/setup-site-structure.ts
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
const REST_BASE = `https://${DOMAIN}/admin/api/2024-01`;
const GRAPHQL_URL = `https://${DOMAIN}/admin/api/2024-01/graphql.json`;
const THEME_ID = '187922841966';

// ─── REST API helper ──────────────────────────────────────
async function restApi(endpoint: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${REST_BASE}/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ─── GraphQL helper ───────────────────────────────────────
async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
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
    throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  return json.data!;
}

// ═══════════════════════════════════════════════════════════
// 1. フッターメニュー作成
// ═══════════════════════════════════════════════════════════

const MENU_CREATE = `
mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
  menuCreate(title: $title, handle: $handle, items: $items) {
    menu { id handle title }
    userErrors { field message }
  }
}
`;

async function createFooterMenus() {
  console.log('📋 フッターメニューを作成中...\n');

  // footer-browse: 自転車カテゴリ
  try {
    const browseResult = await graphql<{
      menuCreate: {
        menu: { id: string; handle: string; title: string } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(MENU_CREATE, {
      title: '自転車を探す（フッター）',
      handle: 'footer-browse',
      items: [
        { title: '電動アシスト自転車', type: 'HTTP', url: '/collections/e-bikes' },
        { title: 'シティサイクル', type: 'HTTP', url: '/collections/city-bikes' },
        { title: 'スポーツバイク', type: 'HTTP', url: '/collections/sports-bikes' },
        { title: 'ミニベロ・小径車', type: 'HTTP', url: '/collections/mini-velo' },
        { title: '子供用自転車', type: 'HTTP', url: '/collections/kids-bikes' },
        { title: 'すべての自転車', type: 'HTTP', url: '/collections/all' },
      ],
    });

    const errors = browseResult.menuCreate.userErrors;
    if (errors.length > 0) {
      const exists = errors.some(e => e.message.includes('already') || e.message.includes('taken'));
      if (exists) {
        console.log('  ⚠ footer-browse — 既に存在します');
      } else {
        console.error(`  ✗ footer-browse: ${JSON.stringify(errors)}`);
      }
    } else {
      console.log(`  ✓ footer-browse (${browseResult.menuCreate.menu!.id})`);
    }
  } catch (err) {
    console.error(`  ✗ footer-browse: ${err instanceof Error ? err.message : err}`);
  }

  await new Promise(r => setTimeout(r, 500));

  // footer-stores: 店舗・サービス
  try {
    const storesResult = await graphql<{
      menuCreate: {
        menu: { id: string; handle: string; title: string } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(MENU_CREATE, {
      title: '店舗・サービス（フッター）',
      handle: 'footer-stores',
      items: [
        { title: '店舗を探す', type: 'HTTP', url: '/pages/stores' },
        { title: 'お問い合わせ', type: 'HTTP', url: '/pages/contact' },
      ],
    });

    const errors = storesResult.menuCreate.userErrors;
    if (errors.length > 0) {
      const exists = errors.some(e => e.message.includes('already') || e.message.includes('taken'));
      if (exists) {
        console.log('  ⚠ footer-stores — 既に存在します');
      } else {
        console.error(`  ✗ footer-stores: ${JSON.stringify(errors)}`);
      }
    } else {
      console.log(`  ✓ footer-stores (${storesResult.menuCreate.menu!.id})`);
    }
  } catch (err) {
    console.error(`  ✗ footer-stores: ${err instanceof Error ? err.message : err}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 2. ブログ「お知らせ」セットアップ
// ═══════════════════════════════════════════════════════════

async function setupBlog() {
  console.log('\n📰 ブログをセットアップ中...\n');

  // 既存ブログ確認
  const { blogs } = (await restApi('blogs.json')) as { blogs: Array<{ id: number; handle: string; title: string }> };

  for (const b of blogs) {
    console.log(`  既存: ${b.id} | ${b.handle} | ${b.title}`);
  }

  const newsBlog = blogs.find(b => b.handle === 'news');
  if (newsBlog) {
    // News → お知らせ にリネーム
    if (newsBlog.title !== 'お知らせ') {
      await restApi(`blogs/${newsBlog.id}.json`, 'PUT', {
        blog: { id: newsBlog.id, title: 'お知らせ' },
      });
      console.log(`  ✓ "${newsBlog.title}" → "お知らせ" にリネーム`);
    } else {
      console.log('  ⚠ お知らせブログは既に存在します');
    }
  } else {
    // 新規作成
    const result = (await restApi('blogs.json', 'POST', {
      blog: { title: 'お知らせ' },
    })) as { blog: { id: number; handle: string } };
    console.log(`  ✓ お知らせブログ作成 (ID: ${result.blog.id})`);
  }
}

// ═══════════════════════════════════════════════════════════
// 3. カスタムCSS（カート非表示）
// ═══════════════════════════════════════════════════════════

const CUSTOM_CSS = `/* ================================================
 * custom-overrides.css
 * カタログサイト用カスタムCSS
 * ================================================ */

/* カートアイコン非表示 */
.header__icon--cart {
  display: none !important;
}

/* カートドロワー・通知を無効化 */
cart-notification,
cart-drawer {
  display: none !important;
}

/* カート数量バッジ非表示 */
.cart-count-bubble {
  display: none !important;
}
`;

async function setupCustomCSS() {
  console.log('\n🎨 カスタムCSSをセットアップ中...\n');

  // 1. CSSファイルをテーマアセットとしてアップロード
  await restApi(`themes/${THEME_ID}/assets.json`, 'PUT', {
    asset: {
      key: 'assets/custom-overrides.css',
      value: CUSTOM_CSS,
    },
  });
  console.log('  ✓ assets/custom-overrides.css アップロード');

  await new Promise(r => setTimeout(r, 500));

  // 2. layout/theme.liquid にCSS参照を追加
  const { asset } = (await restApi(
    `themes/${THEME_ID}/assets.json?asset[key]=layout/theme.liquid`
  )) as { asset: { key: string; value: string } };

  const cssTag = "{{ 'custom-overrides.css' | asset_url | stylesheet_tag }}";

  if (asset.value.includes('custom-overrides.css')) {
    console.log('  ⚠ theme.liquid に既にCSS参照があります');
    return;
  }

  // </head> の直前に挿入
  const modifiedValue = asset.value.replace(
    '</head>',
    `\n    ${cssTag}\n  </head>`
  );

  await restApi(`themes/${THEME_ID}/assets.json`, 'PUT', {
    asset: {
      key: 'layout/theme.liquid',
      value: modifiedValue,
    },
  });
  console.log('  ✓ layout/theme.liquid にCSS参照を追加');
}

// ═══════════════════════════════════════════════════════════
// 4. ロケール確認
// ═══════════════════════════════════════════════════════════

async function checkLocale() {
  console.log('\n🌐 ロケール設定を確認中...\n');

  try {
    const result = await graphql<{
      shopLocales: Array<{ locale: string; primary: boolean; published: boolean }>;
    }>('{ shopLocales { locale primary published } }');

    for (const loc of result.shopLocales) {
      const flags = [
        loc.primary ? 'プライマリ' : null,
        loc.published ? '公開' : '非公開',
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`  ${loc.locale} (${flags})`);
    }

    const hasJa = result.shopLocales.some(l => l.locale === 'ja');
    if (!hasJa) {
      console.log('\n  ⚠ 日本語ロケールが設定されていません。');
      console.log('  → Shopify管理画面 > Settings > Languages から日本語を追加してください。');
      console.log('  → Dawn テーマに日本語翻訳ファイルが含まれていれば、UI が自動的に日本語化されます。');
    } else {
      console.log('\n  ✓ 日本語ロケール設定済み');
    }
  } catch (err) {
    console.error(`  ✗ ロケール確認失敗: ${err instanceof Error ? err.message : err}`);
  }
}

// ═══════════════════════════════════════════════════════════
// メイン
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('🏗️  サイト構成セットアップを開始します\n');
  console.log('='.repeat(50));

  await createFooterMenus();
  await setupBlog();
  await setupCustomCSS();
  await checkLocale();

  console.log('\n' + '='.repeat(50));
  console.log('✅ サイト構成セットアップ完了！');
  console.log('\n次のステップ:');
  console.log('  1. push-theme.ts でテーマファイルをデプロイ');
  console.log('  2. ブラウザで全ページを確認');
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
