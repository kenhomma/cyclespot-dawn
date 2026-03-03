/**
 * create-store-pages.ts
 *
 * store-master.tsv をもとに、各店舗の Shopify ページを一括作成する。
 * テンプレートは page.store-detail を使用。
 *
 * 使い方:
 *   npx tsx scripts/create-store-pages.ts [--dry-run]
 */

import * as fs from 'fs';
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

interface TsvRow {
  shortname: string;
  slug: string;
  name: string;
}

function parseTsv(content: string): TsvRow[] {
  const lines = content.trim().split('\n');
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const vals = line.split('\t');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i]?.trim() || ''; });
    return row as unknown as TsvRow;
  });
}

async function shopifyRest(endpoint: string, method: string, body?: unknown) {
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

    for (const p of json.pages || []) {
      pages.set(p.handle, p.id);
    }

    // pagination
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]*)>;\s*rel="next"/);
    url = nextMatch ? `pages.json?limit=250&page_info=${nextMatch[1]}` : '';
  }

  return pages;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('📄 店舗ページ一括作成スクリプト');
  console.log('================================');
  if (dryRun) console.log('⚠️  ドライランモード\n');

  // TSV 読み込み
  const tsvPath = path.resolve(__dirname, '../../../docs/store-master-full.tsv');
  const rows = parseTsv(fs.readFileSync(tsvPath, 'utf-8'));
  console.log(`${rows.length} 店舗のデータを読み込みました`);

  if (!dryRun) {
    // 既存ページを取得
    console.log('\n既存ページを取得中...');
    const existing = await getExistingPages();
    console.log(`  既存ページ: ${existing.size} 件`);

    let created = 0;
    let skipped = 0;

    for (const row of rows) {
      const handle = `store-${row.slug}`;

      if (existing.has(handle)) {
        console.log(`  ⏭ ${handle} (既に存在)`);
        skipped++;
        continue;
      }

      try {
        await shopifyRest('pages.json', 'POST', {
          page: {
            title: row.name,
            handle,
            template_suffix: 'store-detail',
            published: true,
            body_html: '',
          },
        });
        console.log(`  ✓ ${handle}: ${row.name}`);
        created++;
      } catch (err) {
        console.error(`  ✗ ${handle}: ${err instanceof Error ? err.message : err}`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n================================`);
    console.log(`✅ 作成: ${created}, スキップ: ${skipped}`);
  } else {
    console.log('\n作成予定のページ:');
    for (const row of rows) {
      console.log(`  store-${row.slug} → ${row.name} (template: store-detail)`);
    }
  }
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
