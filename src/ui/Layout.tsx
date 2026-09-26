import type { Child } from 'hono/jsx'
import { yearInJapan } from '../lib/format'
import { SITE } from '../site'
import type { Theme } from '../theme'
import { AdminLink, HtmlDocument, Stylesheets } from './components'
import { MARK_POINTS } from './icons'

export type NavItem = { href: string; label: string; active?: boolean }

/*
  共有カードの画像（og:image）。サイトの1枚と、作品のページではその作品の画像。

  このサイトへの流入は、貼られたリンク（Slack / DM / 職務経歴書）から来る。
  og:image が無いと、貼った先は灰色の箱か文字だけの行になり、画面が7つに
  分かれたいまはどの画面を貼っても同じ無地のカードになっていた。

  **作品のページは、画像があればその作品の画像を出す**（src/routes/public/item.tsx の
  itemOgImage）。作品を1件名指しして貼る URL なので、サイトの札より作品の
  スクリーンショットのほうが「何のリンクか」を伝える。種類は経路の拡張子から
  （こちらが判定して付けたもの）、寸法は上げたときに読んだもの（items の
  image_width / image_height）。分からないものは名乗らない——間違った寸法を
  名乗るくらいなら、貼り先に取りに行かせたほうがよい。AVIF は使わず、サイトの
  1枚に戻す（X が og:image に読むのは JPEG / PNG / WebP / GIF だけ）。

  **それ以外の画面はサイトの1枚**（SITE_IMAGE）。素材はリポジトリにある
  public/assets/avatar.png。og:image に出せる raster はこれ1枚——ロゴ
  （noctifex-mark.svg / noctifex-wordmark.svg）は SVG で、貼り先のどれも
  og:image の SVG を読まない（Slack / LinkedIn / X）。入口の月
  （moon.avif / moon.webp）は raster だが、無彩色の三日月を CSS の
  mask-image で抜くための素材なので、そのまま貼ると絵にならない。

  twitter:card は画像の寸法で決める（cardOf）。横長で X の大きい札の下限
  （300x157）以上なら summary_large_image、それ以外は summary。サイトの1枚は
  144x144 で推奨（1200x630）に届かないので、小さな正方形のサムネイルの
  summary のまま（summary_large_image にすると、横長の枠に 144px の絵を
  引き伸ばした札になる）。縦長のスクリーンショットも summary——大きい札は
  横長に切り抜くので、縦長の絵は真ん中の帯しか残らない。寸法が分からない
  画像も summary に倒す。

  width と height を添えるのは、取りに行く前に大きさが分かるようにするため。

  twitter:image は置かない。X は twitter:* が無ければ og:* に落ちるので、
  同じ URL を2か所に持つと、片方だけ古くなる形が1つ増えるだけになる。
*/
export type OgImage = {
  // 絶対 URL（貼り先はこの文書の外で読むので、相対では何も指さない）
  url: string
  alt: string
  type?: string
  width?: number
  height?: number
}

const SITE_IMAGE: OgImage = {
  url: `${SITE.origin}/assets/avatar.png`,
  alt: `${SITE.name} のアイコン`,
  type: 'image/png',
  width: 144,
  height: 144,
}

const cardOf = ({ width, height }: OgImage) =>
  width && height && width > height && width >= 300 && height >= 157
    ? 'summary_large_image'
    : 'summary'

const ShareImage = ({ image }: { image: OgImage }) => (
  <>
    <meta property="og:image" content={image.url} />
    {image.type ? <meta property="og:image:type" content={image.type} /> : null}
    {image.width && image.height ? (
      <>
        <meta property="og:image:width" content={String(image.width)} />
        <meta property="og:image:height" content={String(image.height)} />
      </>
    ) : null}
    <meta property="og:image:alt" content={image.alt} />
    <meta name="twitter:card" content={cardOf(image)} />
  </>
)

/*
  公開ページの外枠。head と骨格（名札 + 本文）はここだけで決める。

  骨格の並べ替えは body の data-* だけで済ませる。マークアップは
  どのプリセットでも同じで、変わるのは app.css の [data-layout] 側。
  出し分けを JSX に持たせると、プリセットの数だけ画面が分かれてしまう。

  公開ページは JavaScript を持たない。絞り込みも画面の移動もサーバーが決め、
  リンクをたどるだけで動く。ここに <script> を1つ足すと、切られた環境で
  何が落ちるかを毎回考えることになる。
*/
export const Layout = (props: {
  title: string
  description: string
  canonical: string
  jsonLd?: unknown
  nav: NavItem[]
  theme: Theme
  sidebar: Child
  /*
    縦に積んだ全体ページ（/all）のときだけ立てる。app.css は body のこの印で
    「画面に収める外枠」を外す。印の無いページは1画面に収まり、動かない。
  */
  whole?: boolean
  /*
    ログインしている人にだけ渡る、管理画面の行き先（AdminLink）。訪問者には
    undefined が渡り、柱は今までと同じ姿のまま。
  */
  admin?: string
  // 共有カードの画像。渡さなければサイトの1枚（SITE_IMAGE）
  image?: OgImage
  children?: Child
}) => (
  <HtmlDocument>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      <meta name="color-scheme" content="dark" />
      <title>{props.title}</title>
      <meta name="description" content={props.description} />
      <link rel="canonical" href={props.canonical} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE.name} />
      <meta property="og:title" content={props.title} />
      <meta property="og:description" content={props.description} />
      <meta property="og:url" content={props.canonical} />
      <meta property="og:locale" content="ja_JP" />
      <ShareImage image={props.image ?? SITE_IMAGE} />

      <link
        rel="icon"
        href={`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%230c0c0e'/%3E%3Cpolygon points='${MARK_POINTS}' fill='%23f2f2f4'/%3E%3C/svg%3E`}
      />
      <Stylesheets />
      {props.jsonLd ? (
        <script
          type="application/ld+json"
          // JSON の中の < を潰しておく。</script> で早期に閉じられるのを防ぐため
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(props.jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      ) : null}
    </head>
    <body
      data-layout={props.theme.layout}
      data-accent={props.theme.accent}
      data-typeface={props.theme.typeface}
      data-whole={props.whole ? '' : undefined}
    >
      <a class="skip" href="#main">
        本文へスキップ
      </a>
      <div class="shell">
        <aside class="rail">
          {props.sidebar}
          {/*
            いま見ている画面には aria-current="page"。'true' ではなく 'page' な
            のは、目次の行き先が別の URL（/projects）だから。'true' は「この一覧の
            中のいま」で、ページそのものは指さない。

            番号は振らない。数えるのは画面の底のページャ1つ（Projects 2 / 4）に
            寄せる——目次の番号はブロックの並び順で、節の何画面目に居ても動かない
            ので、同じ姿の数が2組あると別の数え上げが並んで見える。

            aria-label は行き先で出し分ける。全体ページの目次だけが本当に
            ページ内（#projects）を指していて、画面ごとの URL では別ページへ移る。
            片方に固定した文字列は、必ずどちらかで嘘になる。
          */}
          <nav class="toc" aria-label={props.whole ? 'ページ内の移動' : '画面の移動'}>
            {props.nav.map((item) => (
              <a key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          {/*
            目次のすぐ後ろ。足元（.rail__footer）には入れない——あちらは 899 以下で
            畳まれるので、電話からは管理画面へ行けなくなる。ここなら 899 以下の
            横帯でも右端に残る
          */}
          {props.admin ? <AdminLink href={props.admin} /> : null}
          {/*
            全体ページ（/all）への1本道。

            公開側にも管理画面にも /all への href が1本も無かった。@media print は
            「紙の上では『次の画面へ』は押せない。全体ページを刷ること」と書いて
            いるのに、そこへ行く手段が URL を手で打つことしか無い。カードの説明が
            行数で切られない唯一の姿も、Ctrl-F もブラウザ翻訳も、同じ1本が無いために
            届かなかった。

            全体ページ自身には出さない（自分への行き先）。

            899 以下ではこの足元ごと畳まれる（著作権表示と一緒に。CLAUDE.md の
            「899 以下で畳むもの」）。畳んでも全体ページへの道は消えない——入口の Hero の帯の
            下に「すべてを1ページで読む →」（components.tsx の WholeLink）を置いて
            あり、そちらは幅で畳まない。一覧は画面ごとの URL で読めるし、切られた
            説明の全文はカードを押した先の作品1件のページにある。sitemap.xml にも
            載るので、検索からも届く。
          */}
          {/*
            著作権表示（と、あとに続く「 · 」）は .rail__copy に包む。中央寄せの骨格は
            900 以上で柱が上の帯になり、そこでは著作権表示を出さずに全体ページへの
            1本だけを目次の行に残す（app.css の「骨格: 中央寄せ」）。素の字のままだと
            CSS から字だけを選べない。区切りの「 · 」も同じ箱に入れるのは、表示を
            畳んだときに区切りだけが行の頭に残らないようにするため
          */}
          <footer class="rail__footer">
            <span class="rail__copy">
              © {yearInJapan()} {SITE.name}
              {props.whole ? null : ' · '}
            </span>
            {/*
              矢印は →。同じタブで開くサイトの中の行き先なので、「外へ出る・
              別タブ」の印（↗）は付けない（components.tsx の LinkList を見ること）。
              管理画面の同じ1本は別タブで開くので、あちらは ↗ のまま
            */}
            {props.whole ? null : <a href="/all">全体を1ページで見る →</a>}
          </footer>
        </aside>
        {/*
          tabindex={-1} は「本文へスキップ」のため。Safari（と iOS の全ブラウザ）は
          フラグメントで移った先が素でフォーカスを受けない要素だと、見た目だけ動いて
          キーボードの位置は帯に残る。このサイトに迂回路はこの1本しか無いので、
          外すと目次を毎回たどる以外の手が消える。-1 なので Tab の順番には入らない。
        */}
        <main id="main" tabindex={-1}>
          {props.children}
        </main>
      </div>
    </body>
  </HtmlDocument>
)
