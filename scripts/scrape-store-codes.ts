/**
 * scrape-store-codes.ts
 * cyclespot.net のエリアページから全店舗のURLとshopimageコードを取得する
 */

const AREA_PAGES = [
  // 東京23区
  'adachi', 'arakawa', 'itabashi', 'edogawa', 'ota',
  'katsushika', 'kita', 'koto', 'shinagawa', 'shibuya',
  'shinjuku', 'suginami', 'sumida', 'setagaya', 'taito',
  'chiyoda', 'toshima', 'nakano', 'nerima', 'bunkyo',
  'minato', 'meguro',
  // 東京23区外
  'musashino', 'chofu', 'fuchu', 'koganei', 'higashikurume',
  'tachikawa', 'higashimurayama',
  // 神奈川
  'kanagawa', 'yokohama', 'kawasaki', 'sagamihara', 'fujisawa',
  'hiratsuka', 'tsurumi',
  // 千葉
  'chiba', 'matsudo', 'kashiwa', 'ichikawa',
  // 埼玉
  'saitama', 'ageo', 'wako', 'soka',
  // 静岡
  'shizuoka', 'numazu', 'fuji',
  // 茨城
  'ibaraki', 'tsuchiura',
];

interface StoreInfo {
  url: string;
  name: string;
  code: string;
  areaPage: string;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) return '';
  return res.text();
}

async function getStoresFromArea(area: string): Promise<StoreInfo[]> {
  const url = `https://www.cyclespot.net/${area}/`;
  const html = await fetchPage(url);
  if (!html) {
    // console.log(`  ⏭ ${area} (not found)`);
    return [];
  }

  const stores: StoreInfo[] = [];

  // Find store links: /shops/XXX/
  const linkRegex = /href="(https?:\/\/www\.cyclespot\.net\/shops\/([^"\/]+)\/?)"/g;
  let linkMatch;
  const storeUrls: { fullUrl: string; slug: string }[] = [];
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    storeUrls.push({ fullUrl: linkMatch[1], slug: linkMatch[2] });
  }

  // Find shopimage codes in the page
  const codeRegex = /shopimage\/(\d+)\//g;
  let codeMatch;
  const codes: string[] = [];
  while ((codeMatch = codeRegex.exec(html)) !== null) {
    if (!codes.includes(codeMatch[1])) {
      codes.push(codeMatch[1]);
    }
  }

  // Try to match store URLs with codes
  // The page typically shows stores with their images containing codes
  // We need to find the association between store URL and image code

  // Get store blocks - look for patterns where store link and image code appear together
  // Match store name from page content near each link
  const storeBlockRegex = /shopimage\/(\d+)\/[\s\S]*?href="https?:\/\/www\.cyclespot\.net\/shops\/([^"\/]+)\/?"/g;
  let blockMatch;
  while ((blockMatch = storeBlockRegex.exec(html)) !== null) {
    stores.push({
      url: `https://www.cyclespot.net/shops/${blockMatch[2]}/`,
      name: blockMatch[2],
      code: blockMatch[1],
      areaPage: area,
    });
  }

  // Also try reverse order (link before image)
  const reverseRegex = /href="https?:\/\/www\.cyclespot\.net\/shops\/([^"\/]+)\/?[\s\S]*?shopimage\/(\d+)\//g;
  let revMatch;
  while ((revMatch = reverseRegex.exec(html)) !== null) {
    const existing = stores.find(s => s.name === revMatch[1]);
    if (!existing) {
      stores.push({
        url: `https://www.cyclespot.net/shops/${revMatch[1]}/`,
        name: revMatch[1],
        code: revMatch[2],
        areaPage: area,
      });
    }
  }

  // If we found codes but no matches, and there's exactly one store, associate them
  if (stores.length === 0 && storeUrls.length === 1 && codes.length === 1) {
    stores.push({
      url: storeUrls[0].fullUrl,
      name: storeUrls[0].slug,
      code: codes[0],
      areaPage: area,
    });
  }

  // If we found codes but couldn't match them, at least report
  if (stores.length === 0 && codes.length > 0) {
    console.log(`  ⚠ ${area}: found codes [${codes.join(',')}] but ${storeUrls.length} store links - manual matching needed`);

    // If same count, pair them in order
    if (codes.length === storeUrls.length) {
      for (let i = 0; i < codes.length; i++) {
        stores.push({
          url: storeUrls[i].fullUrl,
          name: storeUrls[i].slug,
          code: codes[i],
          areaPage: area,
        });
      }
    }
  }

  return stores;
}

async function main() {
  console.log('🔍 Scraping store codes from cyclespot.net...\n');

  const allStores: StoreInfo[] = [];
  const seen = new Set<string>();

  for (const area of AREA_PAGES) {
    const stores = await getStoresFromArea(area);
    for (const store of stores) {
      const key = store.name;
      if (!seen.has(key)) {
        seen.add(key);
        allStores.push(store);
        console.log(`  ✓ ${store.code.padStart(3, '0')} → ${store.name}`);
      }
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n📊 Found ${allStores.length} stores with codes\n`);

  // Now let's also directly visit each store page to get codes we might have missed
  // First, let me also try fetching store pages directly for stores in our TSV
  // that we didn't find codes for

  // Output the mapping as TSV
  console.log('--- Store Code Mapping ---');
  for (const store of allStores.sort((a, b) => a.code.localeCompare(b.code))) {
    console.log(`${store.code}\t${store.name}\t${store.url}`);
  }
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
