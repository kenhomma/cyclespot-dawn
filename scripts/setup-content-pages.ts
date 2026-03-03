/**
 * setup-content-pages.ts
 * ストーリー一覧・企業情報ページのコンテンツを設定する
 *
 * 使い方:
 *   npx tsx scripts/setup-content-pages.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { const d = await import('dotenv'); d.config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

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
// Step 1: 企業情報ページ (About) を更新
// ============================================================
console.log('📝 企業情報ページ (about) を更新...');

const aboutHtml = `
<div style="max-width: 800px; margin: 0 auto;">

<h2>すばらしい乗り物である自転車を通じて、人と社会に笑顔を。</h2>
<p>サイクルスポット・ル・サイクは、東京・神奈川・埼玉を中心に100店舗以上を展開する自転車専門店です。<br>
「街の自転車屋さん」として、一人ひとりのお客様に寄りそい、自転車のある暮らしを支えています。</p>

<h2>サイクルスポットの 10 の約束</h2>

<h3>1. 自転車の力を信じている</h3>
<p>ペダルを踏むだけで、風を感じ、世界が広がる。そんなシンプルで自由な移動の喜びを、ひとりでも多くの人に届けます。</p>

<h3>2. 1台1台に責任を</h3>
<p>お客様の命を乗せる自転車だから、整備も修理も1台1台に責任を持ちます。「安心して乗れる」と胸を張れるまで、手を抜きません。</p>

<h3>3. 笑顔とあいさつから始めます</h3>
<p>どんな修理も、どんな接客も、まず「こんにちは」から。コンビニのように気軽で、専門店のように頼れる――そんな「親しみやすい専門店」を目指します。</p>

<h3>4. スピードは誠実さ</h3>
<p>ただ速いだけではなく、「なぜこうなったか」「どうすれば長持ちするか」まで丁寧にお伝えします。お客様の時間を大切にする「信頼できるスピード」を提供します。</p>

<h3>5. 街の中の「拠りどころ」であること</h3>
<p>駅前から商店街、住宅街まで、困ったときにそこにある。人と自転車がつながる場所として、地域に根差した存在であり続けます。</p>

<h3>6. 仲間と助け合うチームで</h3>
<p>集団走行のように支え合うチームで。店長、整備士、販売スタッフ、本部が一丸となってお客様の信頼に応えます。</p>

<h3>7. 挑戦を楽しむ文化</h3>
<p>新しいサービスやアイデアに果敢に挑戦します。サポートプログラム、新しい店舗コンセプト、地域イベント――新しい風を恐れません。</p>

<h3>8. すべての人にやさしいお店を</h3>
<p>性別も年齢も国籍も関係なく、すべてのお客様とスタッフが安心して過ごせる場所を目指します。</p>

<h3>9. 社会を動かす力になる</h3>
<p>修理、再利用、リサイクルを通じて「長く使う」文化を広げます。CO₂削減、地域の安全――持続可能な未来を自転車から。</p>

<h3>10. すべては「ありがとう」のために</h3>
<p>数字を追いかけるのではなく、本物の「ありがとう」を集める。その一言のために、タイヤに空気を入れ、自転車を整備し、笑顔で送り出す。誠実な仕事は、必ず結果として返ってくると信じています。</p>

<hr>

<h2>3つの強み</h2>

<h3>商品力 — 豊富なブランドとラインナップ</h3>
<p>ブリヂストン、パナソニック、ヤマハなどの国内メーカーから、GIANT、Bianchi などの海外ブランドまで。通勤通学、子ども乗せ、スポーツ、電動アシストと幅広くご提案します。</p>

<h3>技術力 — 確かな整備と修理</h3>
<p>パンク修理からオーバーホールまで、実績ある技術者が対応。修理工賃の透明性を重視し、安心してお任せいただける体制を整えています。</p>

<h3>人間力 — 断らない、寄りそう</h3>
<p>空気入れも、ちょっとした相談も、他店で買った自転車の修理も。「断らない」をモットーに、一人ひとりのお客様に寄りそいます。</p>

</div>
`;

// Find the about page
const pagesRes = await rest('pages.json?limit=250&handle=about');
// We can't filter by handle in REST, so get all pages
const allPagesRes = await rest('pages.json?limit=250');
const aboutPage = allPagesRes.pages?.find((p: any) => p.handle === 'about');

if (aboutPage) {
  await rest(`pages/${aboutPage.id}.json`, 'PUT', {
    page: { id: aboutPage.id, body_html: aboutHtml },
  });
  console.log('  ✓ 企業情報ページを更新しました');
} else {
  console.log('  ⚠️ about ページが見つかりません');
}

// ============================================================
// Step 2: 10の約束ページ (brand-promises) を更新
// ============================================================
console.log('\n📝 10の約束ページ (brand-promises) を更新...');

const promisesPage = allPagesRes.pages?.find((p: any) => p.handle === 'brand-promises');
if (promisesPage) {
  // about ページの10の約束セクションと同じ内容を使う
  await rest(`pages/${promisesPage.id}.json`, 'PUT', {
    page: { id: promisesPage.id, body_html: aboutHtml },
  });
  console.log('  ✓ 10の約束ページを更新しました');
}

// ============================================================
// Step 3: ストーリーブログを作成
// ============================================================
console.log('\n📝 ストーリーブログを作成...');

const blogsRes = await rest('blogs.json');
let storiesBlog = blogsRes.blogs?.find((b: any) => b.handle === 'stories');

if (!storiesBlog) {
  const createBlogRes = await rest('blogs.json', 'POST', {
    blog: { title: 'CYCLESPOT STORIES' },
  });
  storiesBlog = createBlogRes.blog;
  console.log(`  ✓ ブログ作成: ${storiesBlog.id} (${storiesBlog.handle})`);
} else {
  console.log(`  ⏭ ブログは既に存在: ${storiesBlog.id} (${storiesBlog.handle})`);
}

// ============================================================
// Step 4: ストーリー記事を作成
// ============================================================
console.log('\n📝 ストーリー記事を作成...');

const stories = [
  {
    title: '森一樹SVが語る「感謝される仕事」',
    handle: 'story-mori',
    summary: '葛西店の森一樹SV。20年の経験と持ち前の人柄で、地域のお客様から愛される「街の自転車屋さん」の姿。',
    tags: 'スタッフストーリー, SV',
  },
  {
    title: '武蔵小山店 松村店長・賀村SV インタビュー',
    summary: '商店街の中にある武蔵小山店。自転車好きではなかった二人が、この仕事に惚れ込んだ理由とは。',
    handle: 'story-matsumura-kamura',
    tags: 'スタッフストーリー, 店長, SV',
  },
  {
    title: '深沢店 荻野SV インタビュー',
    summary: '住宅街の奥にひっそり佇む深沢店。20年間自転車を直し続けてきた荻野SVの技術と信念。',
    handle: 'story-ogino',
    tags: 'スタッフストーリー, SV, 技術',
  },
  {
    title: '高瀬顧問 ―「感動してもらう店」を作る人',
    summary: 'サイクルスポット創業者の一人、高瀬顧問。100店舗以上の出店を支えた「場所を見つける達人」の物語。',
    handle: 'story-takase',
    tags: '創業ストーリー, 顧問',
  },
  {
    title: '加藤京子社長インタビュー #01 ― 真狩の大地と「家族への手紙」',
    summary: '北海道の農家に生まれ、東京で100店舗の自転車チェーンを率いるまで。加藤京子社長の原点。',
    handle: 'story-kato-01',
    tags: '社長インタビュー, 創業ストーリー',
  },
  {
    title: '加藤京子社長インタビュー #02 ― 食らいつく根性',
    summary: '「スティックさばきは下手。でも、食らいつく根性だけはある」。不器用でも諦めない経営者の姿。',
    handle: 'story-kato-02',
    tags: '社長インタビュー',
  },
  {
    title: '加藤京子社長インタビュー #03 ― 中野店 4,980円の快進撃',
    summary: '「撤去費用より安く売る」。中野店から始まった低価格戦略は、使命感から生まれた。',
    handle: 'story-kato-03',
    tags: '社長インタビュー',
  },
  {
    title: '加藤京子社長インタビュー #04 ― あのお母さんと子供を横浜まで帰す',
    summary: '「会社のルールなんてどうでもいい」。顧客を助けることが最優先。自転車を社会インフラにする原体験。',
    handle: 'story-kato-04',
    tags: '社長インタビュー',
  },
  {
    title: '加藤京子社長インタビュー #05（最終回）― 100年企業と子供たちへの遺言',
    summary: '「他人と比較せず、自分らしく」。危機を乗り越え、次世代へつなぐ想い。',
    handle: 'story-kato-05',
    tags: '社長インタビュー',
  },
];

// Get existing articles in the stories blog
const existingArticlesRes = await rest(`blogs/${storiesBlog.id}/articles.json?limit=50`);
const existingArticleHandles = new Set(
  (existingArticlesRes.articles || []).map((a: any) => a.handle)
);

for (const story of stories) {
  if (existingArticleHandles.has(story.handle)) {
    console.log(`  ⏭ ${story.handle} (既に存在)`);
    continue;
  }

  try {
    await rest(`blogs/${storiesBlog.id}/articles.json`, 'POST', {
      article: {
        title: story.title,
        handle: story.handle,
        body_html: `<p>${story.summary}</p><p><em>（記事は準備中です。近日公開予定。）</em></p>`,
        tags: story.tags,
        published: true,
      },
    });
    console.log(`  ✓ ${story.handle}: ${story.title}`);
  } catch (err) {
    console.error(`  ✗ ${story.handle}: ${err instanceof Error ? err.message : err}`);
  }
  await new Promise(r => setTimeout(r, 500));
}

// ============================================================
// Step 5: ストーリー一覧ページを更新
// ============================================================
console.log('\n📝 ストーリー一覧ページ (stories) を更新...');

const storiesHtml = `
<div style="max-width: 900px; margin: 0 auto;">

<h2>CYCLESPOT STORIES</h2>
<p>サイクルスポットのスタッフが語る、自転車と街と人のストーリー。<br>
「断らない」「寄りそう」――100店舗に息づく文化の源流を、一人ひとりの声からお届けします。</p>

<hr>

<h3>スタッフストーリー</h3>

<p><strong><a href="/blogs/stories/story-mori">森一樹SVが語る「感謝される仕事」</a></strong><br>
葛西店の森一樹SV。20年の経験と持ち前の人柄で、地域のお客様から愛される「街の自転車屋さん」の姿。</p>

<p><strong><a href="/blogs/stories/story-matsumura-kamura">武蔵小山店 松村店長・賀村SV インタビュー</a></strong><br>
商店街の中にある武蔵小山店。自転車好きではなかった二人が、この仕事に惚れ込んだ理由とは。</p>

<p><strong><a href="/blogs/stories/story-ogino">深沢店 荻野SV インタビュー</a></strong><br>
住宅街の奥にひっそり佇む深沢店。20年間自転車を直し続けてきた荻野SVの技術と信念。</p>

<hr>

<h3>創業者の物語</h3>

<p><strong><a href="/blogs/stories/story-takase">高瀬顧問 ―「感動してもらう店」を作る人</a></strong><br>
100店舗以上の出店を支えた「場所を見つける達人」。サイクルスポットの礎を築いた創業者の物語。</p>

<hr>

<h3>加藤京子社長インタビュー（全5回）</h3>

<p><strong><a href="/blogs/stories/story-kato-01">#01 真狩の大地と「家族への手紙」</a></strong><br>
北海道の農家に生まれ、東京で100店舗の自転車チェーンを率いるまで。</p>

<p><strong><a href="/blogs/stories/story-kato-02">#02 食らいつく根性</a></strong><br>
不器用でも諦めない。「スティックさばきは下手。でも、食らいつく根性だけはある」。</p>

<p><strong><a href="/blogs/stories/story-kato-03">#03 中野店 4,980円の快進撃</a></strong><br>
「撤去費用より安く売る」。使命感から生まれた低価格戦略。</p>

<p><strong><a href="/blogs/stories/story-kato-04">#04 あのお母さんと子供を横浜まで帰す</a></strong><br>
顧客を助けることが最優先。自転車を社会インフラにする原体験。</p>

<p><strong><a href="/blogs/stories/story-kato-05">#05（最終回）100年企業と子供たちへの遺言</a></strong><br>
危機を乗り越え、次世代へつなぐ想い。「他人と比較せず、自分らしく」。</p>

<hr>

<p><a href="/pages/about">企業・ブランド情報を見る →</a></p>

</div>
`;

const storiesPage = allPagesRes.pages?.find((p: any) => p.handle === 'stories');
if (storiesPage) {
  await rest(`pages/${storiesPage.id}.json`, 'PUT', {
    page: { id: storiesPage.id, body_html: storiesHtml },
  });
  console.log('  ✓ ストーリー一覧ページを更新しました');
}

// ============================================================
// Step 6: その他のプレースホルダーページも更新
// ============================================================
console.log('\n📝 その他のページも更新...');

const pageUpdates: Record<string, string> = {
  guide: `
<div style="max-width: 800px; margin: 0 auto;">
<h2>自転車の選び方ガイド</h2>
<p>はじめての自転車選びから、買い替えの相談まで。用途や暮らし方に合わせた一台の選び方をご案内します。</p>

<h3>用途から選ぶ</h3>
<ul>
<li><a href="/collections/city-bikes">通勤・通学に</a> — 毎日の通勤通学に最適なシティサイクル</li>
<li><a href="/collections/e-bikes">電動アシスト自転車</a> — 坂道も子ども乗せも、電動でラクラク</li>
<li><a href="/collections/sports-bikes">趣味のライドに</a> — クロスバイク、ロードバイクでもっと遠くへ</li>
<li><a href="/collections/kids-bikes">お子さまに</a> — 成長に合わせた安全な一台を</li>
<li><a href="/collections/mini-velo">ちょっとしたお出かけに</a> — コンパクトなミニベロ・小径車</li>
</ul>

<h3>お店で相談する</h3>
<p>カタログだけではわからないこともあります。実際に見て、触って、試乗して。<br>
お近くの店舗で、プロのスタッフが最適な一台をご提案します。</p>
<p><a href="/pages/stores">店舗を探す →</a></p>

<h3>安心サポート</h3>
<p>ご購入後も、パンク修理から定期メンテナンスまでしっかりサポート。<br>
「1台1台に責任を」をモットーに、安心して乗り続けられるようお手伝いします。</p>
<p><a href="/pages/support">修理・メンテナンスについて →</a></p>
</div>
`,
  'beginner-guide': `
<div style="max-width: 800px; margin: 0 auto;">
<h2>はじめて自転車屋さんに来る方へ</h2>
<p>サイクルスポット・ル・サイクへようこそ。<br>
「自転車屋さんって、なんとなく入りにくい…」と思っていませんか？</p>

<h3>空気入れだけでもお気軽にどうぞ</h3>
<p>タイヤの空気入れは無料でお使いいただけます。何も買わなくて大丈夫。ふらっとお立ち寄りください。</p>

<h3>他店で購入した自転車もOK</h3>
<p>他のお店で買った自転車でも、修理・メンテナンスを承ります。どこで買ったかは関係ありません。</p>

<h3>まずは「こんにちは」から</h3>
<p>スタッフは全員、笑顔でお迎えします。困ったこと、わからないこと、なんでも聞いてください。<br>
コンビニのように気軽で、専門店のように頼れる。そんなお店を目指しています。</p>

<p><a href="/pages/stores">お近くの店舗を探す →</a></p>
</div>
`,
  support: `
<div style="max-width: 800px; margin: 0 auto;">
<h2>修理・メンテナンス</h2>
<p>パンク修理からオーバーホールまで、経験豊富なスタッフが対応します。<br>
他店でご購入の自転車も、お気軽にお持ちください。</p>

<h3>主な修理メニュー</h3>
<ul>
<li>パンク修理: ¥1,100〜</li>
<li>ブレーキ調整: ¥550〜</li>
<li>チェーン交換: ¥2,200〜</li>
<li>タイヤ・チューブ交換: ¥2,200〜（部品代別）</li>
<li>変速機調整: ¥550〜</li>
</ul>
<p>※ 工賃は目安です。車種や状態により異なります。詳細は各店舗にお問い合わせください。</p>

<h3>安心のメンテナンス</h3>
<p>定期的なメンテナンスで、自転車を長く安全にお使いいただけます。<br>
「1台1台に責任を」をモットーに、安心して乗れるまで手を抜きません。</p>

<p><a href="/pages/stores">お近くの店舗を探す →</a></p>
</div>
`,
  jobs: `
<div style="max-width: 800px; margin: 0 auto;">
<h2>採用情報 — 一緒に働きませんか？</h2>
<p>サイクルスポット・ル・サイクでは、自転車と人が好きな仲間を募集しています。</p>

<h3>私たちが求める人</h3>
<ul>
<li>「断らない」姿勢で、お客様に寄りそえる方</li>
<li>人と接することが好きな方</li>
<li>手を動かすことが好きな方</li>
<li>自転車の経験は問いません — 入社後に学べる環境があります</li>
</ul>

<h3>スタッフの声</h3>
<p>サイクルスポットで働くスタッフのリアルな声をお届けしています。</p>
<p><a href="/pages/stories">CYCLESPOT STORIES を読む →</a></p>

<h3>お問い合わせ</h3>
<p>採用に関するお問い合わせは、<a href="/pages/contact">お問い合わせフォーム</a>からお送りください。</p>
</div>
`,
};

// Get all pages with pagination
let allPages: any[] = allPagesRes.pages || [];
let pageUrl = '';
const linkHeader = '';
// Simple approach: we already have pages from earlier fetch

for (const [handle, html] of Object.entries(pageUpdates)) {
  const page = allPages.find((p: any) => p.handle === handle);
  if (!page) {
    console.log(`  ⚠️ ${handle} ページが見つかりません`);
    continue;
  }
  try {
    await rest(`pages/${page.id}.json`, 'PUT', {
      page: { id: page.id, body_html: html },
    });
    console.log(`  ✓ ${handle}`);
  } catch (err) {
    console.error(`  ✗ ${handle}: ${err instanceof Error ? err.message : err}`);
  }
  await new Promise(r => setTimeout(r, 300));
}

console.log('\n✅ コンテンツページの設定完了');
