/**
 * csv-to-tsv.ts
 * cs_store_master.csv → store-master-full.tsv に変換
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseCSV(content: string): string[][] {
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

  return lines.map(line => {
    const values: string[] = [];
    let val = '';
    let q = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') {
        q = !q;
      } else if (c === ',' && !q) {
        values.push(val.trim());
        val = '';
      } else {
        val += c;
      }
    }
    values.push(val.trim());
    return values;
  });
}

const csvPath = path.resolve(__dirname, '../../../docs/cs_store_master.csv');
const tsvPath = path.resolve(__dirname, '../../../docs/store-master-full.tsv');

const csvContent = fs.readFileSync(csvPath, 'utf-8');
const rows = parseCSV(csvContent);

// Convert to TSV (replace any tabs in values and join with tabs)
const tsv = rows.map(row =>
  row.map(v => v.replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')
).join('\n') + '\n';

fs.writeFileSync(tsvPath, tsv, 'utf-8');
console.log(`✓ Converted ${rows.length - 1} stores to TSV: ${tsvPath}`);
