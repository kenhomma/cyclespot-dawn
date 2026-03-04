/**
 * upload-stories.ts
 *
 * docs/story-*.md の原稿を HTML に変換し、Shopify の stories ブログ記事を更新する
 *
 * 使い方:
 *   npx tsx scripts/upload-stories.ts [--dry-run]
 *
 * 環境変数 (.env):
 *   SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxx
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

// ============================================================
// ストーリー定義（ファイル → 記事メタデータのマッピング）
// ============================================================

interface StoryDef {
  file: string;
  handle: string;
  storyNumber: string;
  category: string;
  tags: string[];
}

const STORIES: StoryDef[] = [
  {
    file: 'story-mori-sv-interview.md',
    handle: 'story-mori',
    storyNumber: '#01',
    category: 'スタッフインタビュー',
    tags: ['category:スタッフインタビュー', 'story:#01'],
  },
  {
    file: 'story-musashikoyama-matsumura-kamura.md',
    handle: 'story-matsumura-kamura',
    storyNumber: '#02',
    category: 'スタッフインタビュー',
    tags: ['category:スタッフインタビュー', 'story:#02'],
  },
  {
    file: 'story-fukasawa-ogino.md',
    handle: 'story-ogino',
    storyNumber: '#03',
    category: 'スタッフインタビュー',
    tags: ['category:スタッフインタビュー', 'story:#03'],
  },
  {
    file: 'story-founder-takase.md',
    handle: 'story-takase',
    storyNumber: '#04',
    category: '創業ストーリー',
    tags: ['category:創業ストーリー', 'story:#04'],
  },
  {
    file: 'story-president-kato-01.md',
    handle: 'story-kato-01',
    storyNumber: '#05',
    category: '社長インタビュー',
    tags: ['category:社長インタビュー', 'story:#05'],
  },
  {
    file: 'story-president-kato-02.md',
    handle: 'story-kato-02',
    storyNumber: '#06',
    category: '社長インタビュー',
    tags: ['category:社長インタビュー', 'story:#06'],
  },
  {
    file: 'story-president-kato-03.md',
    handle: 'story-kato-03',
    storyNumber: '#07',
    category: '社長インタビュー',
    tags: ['category:社長インタビュー', 'story:#07'],
  },
  {
    file: 'story-president-kato-04.md',
    handle: 'story-kato-04',
    storyNumber: '#08',
    category: '社長インタビュー',
    tags: ['category:社長インタビュー', 'story:#08'],
  },
  {
    file: 'story-president-kato-05.md',
    handle: 'story-kato-05',
    storyNumber: '#09',
    category: '社長インタビュー',
    tags: ['category:社長インタビュー', 'story:#09'],
  },
];

// ============================================================
// Markdown → HTML 変換
// ============================================================

/**
 * ストーリー用 Markdown を HTML に変換する
 * - 【導入】【第1章】等のチャプターヘッダー → <h2>
 * - ## 見出し → <h2>, ### → <h3>, #### → <h4>
 * - ■ 見出し → <h3>
 * - ― Column ― → <aside class="article-column">
 * - 引用（> ）→ <blockquote>
 * - インタビュー対話（「名前：」「――」）→ 整形
 * - --- → 無視（区切り線はセクション間で自動）
 * - 空行区切りの段落 → <p>
 */
function markdownToHtml(content: string): { html: string; title: string; excerpt: string } {
  const lines = content.split('\n');

  // ヘッダー行（## CYCLESPOT STORIES #XX, ### タイトル）をスキップして
  // 本文のタイトルと excerpt を抽出
  let title = '';
  let excerpt = '';
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // ## CYCLESPOT STORIES #XX → スキップ（タイトルは StoryDef から取得）
    if (line.startsWith('## CYCLESPOT STORIES')) continue;

    // ### 【サイクルスポット...】タイトル → 記事タイトルとして抽出
    if (line.startsWith('### ') && !title) {
      title = line.replace(/^###\s*/, '').replace(/^【[^】]+】\s*/, '');
      continue;
    }

    // > アーカイブ説明 → スキップ
    if (line.startsWith('> ')) continue;

    // --- → スキップ
    if (line === '---') continue;

    // ### 1. 本文 → 本文開始
    if (line.match(/^###\s*\d+\.\s*本文/)) {
      bodyStartIndex = i + 1;
      break;
    }

    // 上記に該当しない最初の実質テキスト行が見つかったら本文開始
    if (line.length > 0 && !line.startsWith('#')) {
      bodyStartIndex = i;
      break;
    }
  }

  // 本文を処理
  const bodyLines = lines.slice(bodyStartIndex);
  const htmlParts: string[] = [];
  let inColumn = false;
  let inBlockquote = false;
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join('<br>\n');
    htmlParts.push(`<p>${text}</p>`);
    paragraphBuffer = [];
  }

  function flushBlockquote() {
    if (!inBlockquote) return;
    htmlParts.push('</blockquote>');
    inBlockquote = false;
  }

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const trimmed = line.trim();

    // 空行 → 段落区切り
    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    // --- 区切り線 → スキップ
    if (trimmed === '---') {
      flushParagraph();
      continue;
    }

    // > 引用
    if (trimmed.startsWith('> ')) {
      flushParagraph();
      if (!inBlockquote) {
        htmlParts.push('<blockquote>');
        inBlockquote = true;
      }
      htmlParts.push(`<p>${escapeHtml(trimmed.slice(2))}</p>`);
      continue;
    }
    if (inBlockquote && !trimmed.startsWith('>')) {
      flushBlockquote();
    }

    // ― Column ― ブロック
    if (trimmed.match(/^―\s*Column\s*―/i)) {
      flushParagraph();
      if (inColumn) {
        htmlParts.push('</aside>');
      }
      // Column タイトル（同じ行 or 次の行）
      const columnTitle = trimmed.replace(/^―\s*Column\s*―\s*/i, '').trim();
      htmlParts.push('<aside class="article-column">');
      if (columnTitle) {
        htmlParts.push(`<h4 class="article-column__title">― Column ― ${escapeHtml(columnTitle)}</h4>`);
      }
      inColumn = true;
      continue;
    }

    // 【導入】【第X章】 → <h2> (チャプターヘッダー)
    if (trimmed.match(/^【[^】]+】/)) {
      flushParagraph();
      if (inColumn) {
        htmlParts.push('</aside>');
        inColumn = false;
      }
      // 最初の【導入】段落から excerpt を取得
      if (!excerpt) {
        // 次の空行までの文を excerpt として収集
        const excerptLines: string[] = [];
        for (let j = i + 1; j < bodyLines.length && j < i + 6; j++) {
          const el = bodyLines[j].trim();
          if (el === '' && excerptLines.length > 0) break;
          if (el === '') continue;
          if (el.startsWith('【') || el.startsWith('##') || el.startsWith('――')) break;
          excerptLines.push(el);
        }
        excerpt = excerptLines.join(' ').slice(0, 300);
      }
      htmlParts.push(`<h2>${escapeHtml(trimmed)}</h2>`);
      continue;
    }

    // ## 見出し → <h2>
    if (trimmed.startsWith('## ')) {
      flushParagraph();
      if (inColumn) {
        htmlParts.push('</aside>');
        inColumn = false;
      }
      if (!excerpt) {
        const excerptLines: string[] = [];
        for (let j = i + 1; j < bodyLines.length && j < i + 6; j++) {
          const el = bodyLines[j].trim();
          if (el === '' && excerptLines.length > 0) break;
          if (el === '') continue;
          if (el.startsWith('#') || el.startsWith('――')) break;
          excerptLines.push(el);
        }
        excerpt = excerptLines.join(' ').slice(0, 300);
      }
      htmlParts.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
      continue;
    }

    // ### 見出し → <h3>
    if (trimmed.startsWith('### ')) {
      flushParagraph();
      htmlParts.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
      continue;
    }

    // #### 見出し → <h4>
    if (trimmed.startsWith('#### ')) {
      flushParagraph();
      htmlParts.push(`<h4>${escapeHtml(trimmed.slice(5))}</h4>`);
      continue;
    }

    // ■ 見出し → <h3>
    if (trimmed.startsWith('■ ')) {
      flushParagraph();
      if (!excerpt) {
        const excerptLines: string[] = [];
        for (let j = i + 1; j < bodyLines.length && j < i + 6; j++) {
          const el = bodyLines[j].trim();
          if (el === '' && excerptLines.length > 0) break;
          if (el === '') continue;
          if (el.startsWith('■') || el.startsWith('#') || el.startsWith('――')) break;
          excerptLines.push(el);
        }
        excerpt = excerptLines.join(' ').slice(0, 300);
      }
      htmlParts.push(`<h3>${escapeHtml(trimmed.slice(2))}</h3>`);
      continue;
    }

    // インタビュアー質問（――で始まる行）
    if (trimmed.startsWith('――')) {
      flushParagraph();
      htmlParts.push(`<p class="article-story__question"><strong>${escapeHtml(trimmed)}</strong></p>`);
      continue;
    }

    // 話者の発言（「名前：」or「名前： 」）
    const speakerMatch = trimmed.match(/^([^\s：:]{1,10})[：:]\s*/);
    if (speakerMatch && !trimmed.startsWith('http')) {
      flushParagraph();
      const speaker = speakerMatch[1];
      const speech = trimmed.slice(speakerMatch[0].length);
      htmlParts.push(`<p><strong>${escapeHtml(speaker)}：</strong> ${escapeHtml(speech)}</p>`);
      continue;
    }

    // 【対談者】セクション → 小見出し
    if (trimmed === '【対談者】') {
      flushParagraph();
      htmlParts.push('<h4>対談者</h4>');
      continue;
    }

    // 通常テキスト → 段落バッファに追加
    paragraphBuffer.push(escapeHtml(trimmed));
  }

  // 残りをフラッシュ
  flushParagraph();
  flushBlockquote();
  if (inColumn) {
    htmlParts.push('</aside>');
  }

  return {
    html: htmlParts.join('\n'),
    title,
    excerpt: excerpt || '',
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// ============================================================
// Shopify REST API
// ============================================================

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
  return res.json() as Promise<any>;
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const docsDir = path.resolve(__dirname, '../../../docs');

  console.log('📝 ストーリー記事アップロード');
  console.log('============================');
  if (dryRun) console.log('⚠️  ドライランモード\n');

  // 1. 各 Markdown ファイルを読み込んで HTML に変換
  const articles: Array<{
    def: StoryDef;
    title: string;
    excerpt: string;
    html: string;
  }> = [];

  for (const def of STORIES) {
    const filePath = path.resolve(docsDir, def.file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠ ファイルなし: ${def.file}`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const { html, title, excerpt } = markdownToHtml(content);

    articles.push({ def, title, excerpt, html });
    console.log(`  ✓ ${def.file} → ${title.slice(0, 40)}... (${html.length} bytes)`);
  }

  console.log(`\n  → ${articles.length} 件の記事を変換`);

  // ドライラン: HTML をファイルに出力
  if (dryRun) {
    const outputDir = path.resolve(__dirname, '../dist/stories');
    fs.mkdirSync(outputDir, { recursive: true });

    for (const article of articles) {
      const htmlPath = path.resolve(outputDir, `${article.def.handle}.html`);
      const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${article.title}</title>
  <link rel="stylesheet" href="../assets/section-article-story.css">
  <style>
    body { font-family: sans-serif; max-width: 72rem; margin: 2rem auto; padding: 0 2rem; }
    .article-column { background: #f9f7f4; border-left: 3px solid #3a6b4c; padding: 2rem; margin: 2rem 0; }
    .article-column__title { color: #3a6b4c; font-size: 1.1rem; margin-top: 0; }
    .article-story__question strong { color: #555; }
    blockquote { border-left: 3px solid #3a6b4c; padding-left: 1.5rem; color: #555; font-style: italic; }
  </style>
</head>
<body>
  <p><strong>Handle:</strong> ${article.def.handle}</p>
  <p><strong>Tags:</strong> ${article.def.tags.join(', ')}</p>
  <p><strong>Excerpt:</strong> ${article.excerpt}</p>
  <hr>
  <h1>${article.title}</h1>
  ${article.html}
</body>
</html>`;
      fs.writeFileSync(htmlPath, fullHtml);
    }

    console.log(`\n📄 プレビュー出力: ${outputDir}`);
    console.log('  ブラウザで HTML ファイルを開いて内容を確認してください。');
    return;
  }

  // 2. Shopify 接続: stories ブログを取得 or 作成
  if (!DOMAIN || !TOKEN) {
    console.error('❌ SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN が未設定です。');
    process.exit(1);
  }

  console.log('\n📡 Shopify に接続中...');
  const blogsRes = await rest('blogs.json');
  let storiesBlog = blogsRes.blogs?.find((b: any) => b.handle === 'stories');

  if (!storiesBlog) {
    const createBlogRes = await rest('blogs.json', 'POST', {
      blog: { title: 'CYCLESPOT STORIES' },
    });
    storiesBlog = createBlogRes.blog;
    console.log(`  ✓ ブログ作成: ${storiesBlog.id}`);
  } else {
    console.log(`  ✓ ブログ確認: ${storiesBlog.id} (${storiesBlog.handle})`);
  }

  // 3. 既存記事を取得
  const existingRes = await rest(`blogs/${storiesBlog.id}/articles.json?limit=50`);
  const existingArticles = new Map<string, any>(
    (existingRes.articles || []).map((a: any) => [a.handle, a])
  );

  // 4. 記事を作成 or 更新
  console.log('\n📤 記事をアップロード中...');
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const article of articles) {
    const existing = existingArticles.get(article.def.handle);

    const articleData = {
      title: article.title,
      handle: article.def.handle,
      body_html: article.html,
      summary_html: article.excerpt,
      tags: article.def.tags.join(', '),
      published: true,
    };

    try {
      if (existing) {
        await rest(`blogs/${storiesBlog.id}/articles/${existing.id}.json`, 'PUT', {
          article: { id: existing.id, ...articleData },
        });
        console.log(`  ✓ 更新: ${article.def.handle} — ${article.title.slice(0, 40)}`);
        updated++;
      } else {
        await rest(`blogs/${storiesBlog.id}/articles.json`, 'POST', {
          article: articleData,
        });
        console.log(`  ✓ 作成: ${article.def.handle} — ${article.title.slice(0, 40)}`);
        created++;
      }
    } catch (err) {
      console.error(`  ✗ ${article.def.handle}: ${err instanceof Error ? err.message : err}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // 5. サマリー
  console.log('\n============================');
  console.log(`✅ 完了: 作成 ${created}, 更新 ${updated}, エラー ${errors}`);
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
