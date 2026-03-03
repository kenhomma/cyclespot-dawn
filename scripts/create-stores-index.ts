/**
 * 店舗一覧ページ（/pages/stores）を作成する
 */
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { const d = await import('dotenv'); d.config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/pages.json`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': TOKEN,
  },
  body: JSON.stringify({
    page: {
      title: '店舗一覧',
      handle: 'stores',
      template_suffix: 'stores',
      published: true,
      body_html: '',
    },
  }),
});

const json = await res.json() as any;
if (json.page) {
  console.log(`✓ 作成: /pages/stores (ID: ${json.page.id})`);
} else {
  console.log('結果:', JSON.stringify(json, null, 2));
}
