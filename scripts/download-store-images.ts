/**
 * download-store-images.ts
 *
 * 1. cs_store_master.csv からstore codeを抽出
 * 2. cyclespot.net から店舗画像をダウンロード
 * 3. Shopify Files API にアップロード
 * 4. store メタオブジェクトの image フィールドに紐付け
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { const d = await import('dotenv'); d.config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

// --- CSV Parser ---
function parseCSV(content: string): Record<string, string>[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  const headers = lines[0].split(',');
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values: string[] = [];
    let val = '';
    let q = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') {
        q = !q;
      } else if (c === ',' && !q) {
        values.push(val);
        val = '';
      } else {
        val += c;
      }
    }
    values.push(val);

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

// --- Extract store code from shortname ---
function extractCode(shortname: string): string | null {
  const match = shortname.match(/^(\d+)/);
  return match ? match[1] : null;
}

// --- GraphQL helper ---
async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${DOMAIN}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<any>;
}

// --- Download image ---
async function downloadImage(code: string): Promise<Buffer | null> {
  const paddedCode = code.padStart(3, '0');
  const url = `https://www.cyclespot.net/wp-content/themes/cyclespot2021/images/shopimage/${paddedCode}/${paddedCode}_1.jpg`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

// --- Upload to Shopify via staged upload ---
async function uploadToShopify(filename: string, imageBuffer: Buffer): Promise<string | null> {
  // Step 1: Create staged upload
  const stageResult = await gql(`
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `, {
    input: [{
      resource: 'FILE',
      filename: filename,
      mimeType: 'image/jpeg',
      httpMethod: 'POST',
    }],
  });

  const targets = stageResult.data?.stagedUploadsCreate?.stagedTargets;
  if (!targets || targets.length === 0) {
    console.error('  Failed to create staged upload');
    return null;
  }

  const target = targets[0];

  // Step 2: Upload to staged URL
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), filename);

  const uploadRes = await fetch(target.url, {
    method: 'POST',
    body: formData,
  });

  if (!uploadRes.ok) {
    console.error(`  Staged upload failed: ${uploadRes.status}`);
    return null;
  }

  // Step 3: Create file in Shopify
  const fileResult = await gql(`
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          alt
          ... on MediaImage {
            image { url }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    files: [{
      originalSource: target.resourceUrl,
      alt: filename.replace('.jpg', '').replace('store-', ''),
      contentType: 'IMAGE',
    }],
  });

  const files = fileResult.data?.fileCreate?.files;
  const errors = fileResult.data?.fileCreate?.userErrors || [];
  if (errors.length > 0) {
    console.error(`  File create errors: ${JSON.stringify(errors)}`);
    return null;
  }

  return files?.[0]?.id || null;
}

// --- Get store metaobject by handle ---
async function getStoreMetaobject(slug: string): Promise<{ id: string; imageFileId: string | null } | null> {
  const result = await gql(`{
    metaobjectByHandle(handle: { type: "store", handle: "${slug}" }) {
      id
      field(key: "image") {
        reference {
          ... on MediaImage { id }
        }
      }
    }
  }`);

  const obj = result.data?.metaobjectByHandle;
  if (!obj) return null;

  return {
    id: obj.id,
    imageFileId: obj.field?.reference?.id || null,
  };
}

// --- Update store metaobject with image ---
async function updateStoreImage(metaobjectId: string, fileId: string): Promise<boolean> {
  const result = await gql(`
    mutation metaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `, {
    id: metaobjectId,
    metaobject: {
      fields: [{ key: 'image', value: fileId }],
    },
  });

  const errors = result.data?.metaobjectUpdate?.userErrors || [];
  if (errors.length > 0) {
    console.error(`  Update errors: ${JSON.stringify(errors)}`);
    return false;
  }
  return true;
}

// --- Main ---
async function main() {
  const csvPath = path.resolve(__dirname, '../../../docs/cs_store_master.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const stores = parseCSV(csvContent);

  console.log(`📋 ${stores.length} stores loaded from CSV\n`);

  // Save images locally for caching
  const imgDir = path.resolve(__dirname, '../.store-images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  let downloaded = 0;
  let uploaded = 0;
  let linked = 0;
  let skipped = 0;
  let failed = 0;

  for (const store of stores) {
    const code = extractCode(store.shortname);
    const slug = store.slug;
    const name = store.name;

    if (!code) {
      console.log(`  ⏭ ${name} (no store code)`);
      skipped++;
      continue;
    }

    const paddedCode = code.padStart(3, '0');
    const imgFile = path.join(imgDir, `store-${slug}.jpg`);

    // Step 1: Download image (use cache if exists)
    let imageBuffer: Buffer;
    if (fs.existsSync(imgFile)) {
      imageBuffer = fs.readFileSync(imgFile);
      // console.log(`  📂 ${slug}: using cached image`);
    } else {
      const buf = await downloadImage(code);
      if (!buf || buf.length < 1000) {
        console.log(`  ⏭ ${paddedCode} ${slug}: no image found`);
        skipped++;
        continue;
      }
      fs.writeFileSync(imgFile, buf);
      imageBuffer = buf;
      downloaded++;
    }

    // Step 2: Check if store metaobject exists and already has image
    const meta = await getStoreMetaobject(slug);
    if (!meta) {
      console.log(`  ⚠ ${slug}: metaobject not found (will be created during sync)`);
      // Still download the image, it will be linked after sync
      console.log(`  📥 ${paddedCode} ${slug}: image saved locally (${(imageBuffer.length / 1024).toFixed(0)}KB)`);
      continue;
    }

    if (meta.imageFileId) {
      console.log(`  ✓ ${paddedCode} ${slug}: already has image`);
      skipped++;
      continue;
    }

    // Step 3: Upload to Shopify
    const filename = `store-${slug}.jpg`;
    console.log(`  📤 ${paddedCode} ${slug}: uploading (${(imageBuffer.length / 1024).toFixed(0)}KB)...`);
    const fileId = await uploadToShopify(filename, imageBuffer);
    if (!fileId) {
      console.log(`  ✗ ${slug}: upload failed`);
      failed++;
      continue;
    }
    uploaded++;

    // Step 4: Link to metaobject
    const ok = await updateStoreImage(meta.id, fileId);
    if (ok) {
      console.log(`  ✓ ${paddedCode} ${slug}: linked`);
      linked++;
    } else {
      console.log(`  ✗ ${slug}: link failed`);
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📊 Results:`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Linked: ${linked}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
