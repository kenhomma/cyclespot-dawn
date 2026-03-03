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

const res = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
  headers: { 'X-Shopify-Access-Token': token },
});
const json = await res.json() as any;

console.log('Current API scopes:');
for (const s of json.access_scopes || []) {
  console.log(`  - ${s.handle}`);
}
