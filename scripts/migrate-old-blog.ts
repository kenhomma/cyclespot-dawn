#!/usr/bin/env tsx
/**
 * migrate-old-blog.ts
 * -------------------
 * 旧サイト（cyclespot.net/contents/）のブログ記事を
 * WordPress REST API から取得し、Shopify の news ブログに移植する。
 *
 * Usage:
 *   npx tsx scripts/migrate-old-blog.ts [--dry-run] [--limit N] [--offset N]
 *
 * --dry-run : Shopify への投稿を行わず、取得結果だけ表示
 * --limit N : 取得する記事数（デフォルト: 全件）
 * --offset N: スキップするページ数（デフォルト: 0）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

// ── 設定 ────────────────────────────────────────
const envPath = resolve(dirname(new URL(import.meta.url).pathname), '../.env');
const envText = readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)/);
  if (m) env[m[1]] = m[2].trim();
}

const DOMAIN = env.SHOPIFY_STORE_DOMAIN;
const TOKEN = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const WP_BASE = 'https://www.cyclespot.net/wp-json/wp/v2';
const NEWS_BLOG_ID = 122845462894; // Shopify news blog ID
const PER_PAGE = 50; // WordPress API max per_page

// ── CLI引数 ────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const offsetIdx = args.indexOf('--offset');
const OFFSET_PAGES = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1], 10) : 0;

// ── カテゴリマッピング ─────────────────────────
// WordPress category_id → Shopify tag
const CATEGORY_TAGS: Record<number, string> = {
  1:    'お知らせ',
  4029: 'イベント',
  4028: '記事コンテンツ',
  4146: 'キャンペーン',
  1450: 'お知らせ',
  191:  '店舗ブログ',
  277:  'CYCLE NEWS',
  1449: 'CYCLE NEWS',
  3822: '特集コンテンツ',
  4030: 'メディア',
  3960: '店舗情報',
  3968: '商品情報',
  3979: 'イベント',
  3971: 'その他',
  3980: '出店・退店情報',
  3970: 'ネット通販',
  250:  'オリジナルカスタム車',
  1451: 'メーカー情報',
  1452: '他サイト引用',
};

// Store blog categories → store name tag
const STORE_CATEGORIES: Record<number, string> = {
  1631: '武蔵小山店',
  4615: '沼津南店',
  4080: '沼津店',
  3961: 'MARK IS静岡',
  1750: '静岡モディ',
  4334: '富士店',
  3789: 'ららぽーと沼津',
  1692: '海老名店',
  2230: '南大沢店',
  1259: 'IZU店',
  116:  'akiba店',
  617:  'ベイタウン本牧店',
  115:  '下北沢店',
  2822: '土浦店',
  1546: '渋谷店',
  1257: '立川店',
  2350: '相模大野店',
  273:  'ルイガノ上馬店',
  247:  '麻布十番店',
  147:  '都立大学店',
  1952: '吉祥寺店',
  1586: '神保町店',
  3722: '東大島店',
  4416: '森下店',
  4666: '仲宿店',
  4327: '仙川店',
};

// ── Shopify REST API ────────────────────────────
async function shopifyRest(endpoint: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── WordPress REST API ──────────────────────────
interface WPPost {
  id: number;
  date: string;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  categories: number[];
  tags: number[];
  featured_media: number;
  _embedded?: {
    'wp:featuredmedia'?: Array<{
      source_url: string;
      alt_text: string;
    }>;
    'wp:term'?: Array<Array<{ id: number; name: string; slug: string }>>;
  };
}

async function fetchWPPosts(page: number): Promise<{ posts: WPPost[]; total: number; totalPages: number }> {
  const url = `${WP_BASE}/posts?per_page=${PER_PAGE}&page=${page}&_embed=true&orderby=date&order=desc`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 400) return { posts: [], total: 0, totalPages: 0 };
    throw new Error(`WP API ${res.status}: ${await res.text()}`);
  }
  const posts: WPPost[] = await res.json();
  const total = parseInt(res.headers.get('x-wp-total') || '0', 10);
  const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '0', 10);
  return { posts, total, totalPages };
}

// ── HTML整形 ────────────────────────────────────
function cleanHTML(html: string): string {
  // WordPress block comments
  let cleaned = html.replace(/<!--\s*\/?wp:[^>]*-->/g, '');
  // Remove inline styles except for images
  cleaned = cleaned.replace(/<(?!img\b)([a-z]+)\s[^>]*style="[^"]*"[^>]*>/gi, (match) => {
    return match.replace(/\s*style="[^"]*"/g, '');
  });
  // Clean up empty paragraphs
  cleaned = cleaned.replace(/<p>\s*<\/p>/g, '');
  // Remove data-* attributes from non-image elements
  cleaned = cleaned.replace(/<(?!img\b)([a-z]+)\s[^>]*data-[a-z-]+="[^"]*"/gi, (match) => {
    return match.replace(/\s*data-[a-z-]+="[^"]*"/g, '');
  });
  // Clean up excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function htmlToExcerpt(html: string, maxLen = 200): string {
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── タグ生成 ────────────────────────────────────
function buildTags(post: WPPost): string[] {
  const tags: string[] = [];
  for (const catId of post.categories) {
    if (CATEGORY_TAGS[catId]) tags.push(CATEGORY_TAGS[catId]);
    if (STORE_CATEGORIES[catId]) tags.push(`店舗:${STORE_CATEGORIES[catId]}`);
  }
  // Add WP tag names from embedded data
  if (post._embedded?.['wp:term']) {
    const wpTags = post._embedded['wp:term'].flat().filter(t => t.id && t.name);
    // Category names (for unmapped ones)
    for (const cat of post.categories) {
      const found = wpTags.find(t => t.id === cat);
      if (found && !tags.some(t => t === found.name || t.includes(found.name))) {
        // Skip if already mapped
      }
    }
  }
  // Deduplicate
  return [...new Set(tags)];
}

// ── メイン処理 ──────────────────────────────────
async function main() {
  console.log(`📰 旧サイトブログ移植`);
  console.log(`========================`);
  if (DRY_RUN) console.log('  🔍 DRY RUN モード（Shopifyへの投稿なし）');

  // Step 1: Get total count
  const { total, totalPages } = await fetchWPPosts(1);
  console.log(`  WordPress 記事数: ${total} (${totalPages} ページ)`);

  // Step 2: Get existing Shopify articles to avoid duplicates
  const existingHandles = new Set<string>();
  if (!DRY_RUN) {
    let sinceId = 0;
    let hasMore = true;
    while (hasMore) {
      const data = await shopifyRest(`blogs/${NEWS_BLOG_ID}/articles.json?limit=250&since_id=${sinceId}&fields=id,handle`);
      for (const a of data.articles) {
        existingHandles.add(a.handle);
        sinceId = Math.max(sinceId, a.id);
      }
      hasMore = data.articles.length === 250;
    }
    console.log(`  Shopify 既存記事数: ${existingHandles.size}`);
  }

  // Step 3: Paginate through WP posts
  const urlMap: Array<{ old_url: string; new_handle: string; title: string }> = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;
  let processed = 0;

  const startPage = 1 + OFFSET_PAGES;
  const maxPages = Math.min(totalPages, startPage + Math.ceil(LIMIT / PER_PAGE));

  for (let page = startPage; page <= maxPages; page++) {
    const { posts } = await fetchWPPosts(page);
    if (posts.length === 0) break;

    for (const post of posts) {
      if (processed >= LIMIT) break;
      processed++;

      const title = decodeHTMLEntities(post.title.rendered);
      // Generate handle: use slug if it's predominantly ASCII, else wp-{id}
      const decodedSlug = decodeURIComponent(post.slug);
      const asciiChars = decodedSlug.replace(/[^a-z0-9\-_]/gi, '');
      const asciiSlug = asciiChars.toLowerCase();
      // Only use the slug if ASCII portion is meaningful (>8 chars and >30% of original)
      const handle = (asciiSlug.length >= 8 && asciiChars.length / decodedSlug.length > 0.3)
        ? asciiSlug.slice(0, 200)
        : `wp-${post.id}`;
      const body = cleanHTML(post.content.rendered);
      const excerpt = htmlToExcerpt(post.excerpt.rendered || post.content.rendered);
      const tags = buildTags(post);
      const publishedAt = post.date;

      // Featured image
      let imageUrl = '';
      if (post._embedded?.['wp:featuredmedia']?.[0]) {
        imageUrl = post._embedded['wp:featuredmedia'][0].source_url;
      }

      if (DRY_RUN) {
        console.log(`  ${processed}. [${publishedAt.slice(0, 10)}] ${title.slice(0, 60)}`);
        console.log(`     handle: ${handle} | tags: ${tags.join(', ') || '(なし)'}`);
        if (imageUrl) console.log(`     image: ${imageUrl.slice(0, 80)}...`);
        urlMap.push({ old_url: post.link, new_handle: handle, title });
        continue;
      }

      // Skip if already exists
      if (existingHandles.has(handle)) {
        skipped++;
        urlMap.push({ old_url: post.link, new_handle: handle, title });
        continue;
      }

      try {
        const articleData: Record<string, unknown> = {
          title,
          handle,
          body_html: body,
          summary_html: `<p>${excerpt}</p>`,
          tags: tags.join(', '),
          published_at: publishedAt,
          published: true,
        };

        // Set featured image if available (use original URL)
        if (imageUrl) {
          articleData.image = { src: imageUrl, alt: title };
        }

        await shopifyRest(`blogs/${NEWS_BLOG_ID}/articles.json`, 'POST', { article: articleData });
        created++;
        existingHandles.add(handle);
        urlMap.push({ old_url: post.link, new_handle: handle, title });

        if (created % 10 === 0) {
          console.log(`  ✓ ${created} 件作成 (${processed}/${Math.min(total, LIMIT)} 処理済み)`);
        }

        // Rate limit: 300ms between API calls
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        errors++;
        console.error(`  ✗ エラー: ${title.slice(0, 40)} — ${(err as Error).message.slice(0, 100)}`);
        urlMap.push({ old_url: post.link, new_handle: `ERROR:${handle}`, title });
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (processed >= LIMIT) break;
    // Rate limit between pages
    await new Promise(r => setTimeout(r, 200));
  }

  // Step 4: Save URL mapping
  const mapDir = resolve(dirname(new URL(import.meta.url).pathname), '../../docs/migration');
  if (!existsSync(mapDir)) mkdirSync(mapDir, { recursive: true });

  const csvLines = ['old_url,new_handle,title'];
  for (const entry of urlMap) {
    const escapedTitle = entry.title.replace(/"/g, '""');
    csvLines.push(`"${entry.old_url}","${entry.new_handle}","${escapedTitle}"`);
  }
  const csvPath = resolve(mapDir, 'contents-url-map.csv');
  writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

  // Also create a summary MD
  const mdLines = [
    '# 旧サイト → Shopify ブログ記事 URL 対応表',
    '',
    `- 移植日: ${new Date().toISOString().slice(0, 10)}`,
    `- 対象: https://www.cyclespot.net/contents/`,
    `- 移植先ブログ: news (${DOMAIN})`,
    `- 処理件数: ${processed}`,
    `- 作成: ${created}, スキップ(既存): ${skipped}, エラー: ${errors}`,
    '',
    '## URL マッピング',
    '',
    '| 旧URL | Shopify handle | タイトル |',
    '|-------|---------------|---------|',
  ];
  for (const entry of urlMap.slice(0, 50)) {
    const shortUrl = entry.old_url.replace('https://www.cyclespot.net', '');
    mdLines.push(`| ${shortUrl} | ${entry.new_handle} | ${entry.title.slice(0, 50)} |`);
  }
  if (urlMap.length > 50) {
    mdLines.push(`| ... | ... | ... (全${urlMap.length}件はCSV参照) |`);
  }

  const mdPath = resolve(mapDir, 'contents-url-map.md');
  writeFileSync(mdPath, mdLines.join('\n'), 'utf8');

  console.log(`\n========================`);
  console.log(`✅ 完了: 作成 ${created}, スキップ ${skipped}, エラー ${errors}`);
  console.log(`📄 URL対応表: ${csvPath}`);
  console.log(`📄 サマリ: ${mdPath}`);
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
