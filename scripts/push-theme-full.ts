/**
 * push-theme-full.ts
 *
 * テーマ全体のファイルを Shopify にアップロードする。
 * layout, config, sections, snippets, templates, assets すべて対象。
 *
 * 使い方:
 *   npx tsx scripts/push-theme-full.ts --theme-id=XXXXX
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
const BASE = `https://${DOMAIN}/admin/api/2024-01`;

async function api(endpoint: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Shopify テーマで有効なディレクトリとファイル拡張子
const THEME_DIRS = ['layout', 'config', 'sections', 'snippets', 'templates', 'assets', 'locales'];
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot']);

function collectFiles(themeRoot: string): string[] {
  const files: string[] = [];

  for (const dir of THEME_DIRS) {
    const dirPath = path.join(themeRoot, dir);
    if (!fs.existsSync(dirPath)) continue;
    walkDir(dirPath, themeRoot, files);
  }

  return files;
}

function walkDir(dirPath: string, themeRoot: string, files: string[]) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, themeRoot, files);
    } else if (entry.isFile()) {
      const relative = path.relative(themeRoot, fullPath);
      files.push(relative);
    }
  }
}

async function uploadFile(themeId: string, key: string, themeRoot: string): Promise<boolean> {
  const filePath = path.join(themeRoot, key);
  const ext = path.extname(key).toLowerCase();

  try {
    let asset: Record<string, string>;

    if (BINARY_EXTS.has(ext)) {
      // バイナリファイルは base64 エンコード
      const buffer = fs.readFileSync(filePath);
      asset = { key, attachment: buffer.toString('base64') };
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      asset = { key, value: content };
    }

    await api(`themes/${themeId}/assets.json`, 'PUT', { asset });
    return true;
  } catch (err) {
    console.error(`  ✗ ${key}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function main() {
  const themeIdArg = process.argv.find(a => a.startsWith('--theme-id='));
  const themeId = themeIdArg?.split('=')[1];

  if (!themeId) {
    console.log('テーマIDを指定してください: --theme-id=XXXXX');
    const { themes } = await api('themes.json') as any;
    for (const t of themes) {
      console.log(`  ${t.id} | ${t.name} | ${t.role}`);
    }
    return;
  }

  const themeRoot = path.resolve(__dirname, '..');
  const files = collectFiles(themeRoot);

  console.log(`📤 テーマ ${themeId} に ${files.length} ファイルをアップロード`);
  console.log('================================');

  let success = 0;
  let failed = 0;
  let batch = 0;

  for (const file of files) {
    const ok = await uploadFile(themeId, file, themeRoot);
    if (ok) {
      success++;
      // 進捗表示（10件ごと）
      if (success % 10 === 0) {
        process.stdout.write(`  ... ${success}/${files.length}\n`);
      }
    } else {
      failed++;
    }

    batch++;
    // Rate limit: 2リクエスト/秒ペースで
    if (batch % 2 === 0) {
      await new Promise(r => setTimeout(r, 550));
    }
  }

  console.log('================================');
  console.log(`✅ 完了: 成功 ${success}, 失敗 ${failed}, 合計 ${files.length}`);
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
