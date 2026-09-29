import type { Child } from 'hono/jsx'
import { yearInJapan } from '../lib/format'
import { SITE } from '../site'
import type { Theme } from '../theme'
import { AdminLink, Brand, ColorSchemeMeta, HtmlDocument, langOf, Stylesheets } from './components'
import { markInner } from './icons'

export type NavItem = { href: string; label: string; active?: boolean }

/*
  共有カードの画像（og:image）。サイトの1枚と、作品のページではその作品の画像。

  このサイトへの流入は、貼られたリンク（Slack / DM / 職務経歴書）から来る。
  og:image が無いと、貼った先は灰色の箱か文字だけの行になり、ページが節ごとに
  分かれたいまはどのページを貼っても同じ無地のカードになっていた。

  **作品のページは、画像があればその作品の画像を出す**（src/routes/public/item.tsx の
  itemOgImage）。作品を1件名指しして貼る URL なので、サイトの札より作品の
  スクリーンショットのほうが「何のリンクか」を伝える。種類は経路の拡張子から
  （こちらが判定して付けたもの）、寸法は上げたときに読んだもの（items の
  image_width / image_height）。分からないものは名乗らない——間違った寸法を
  名乗るくらいなら、貼り先に取りに行かせたほうがよい。AVIF は使わず、サイトの
  1枚に戻す（X が og:image に読むのは JPEG / PNG / WebP / GIF だけ）。

  **それ以外のページはサイトの1枚**（SITE_IMAGE）。素材はリポジトリにある
  public/assets/avatar.png。og:image に出せる raster はこれ1枚——ロゴ
  （astlog-mark.svg）は SVG で、貼り先のどれも og:image の SVG を読まない
  （Slack / LinkedIn / X）。入口の軌道図も SVG（ページに直に描く）で、素材の
  ファイルを持たない。

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
  公開ページの外枠。head と骨格（上の帯・本文・足元）はここだけで決める。

  骨格は1つ——上に帯（ロゴと目次。貼り付く）、その下に本文、底に足元（誰の
  サイトか・連絡先・全体ページへの1本）。見た目のプリセットで変わるのは色と
  見出しの書体だけで、並べ方は変えない（src/theme.ts）。

  公開ページは JavaScript を持たない。絞り込みもページの移動もサーバーが決め、
  リンクをたどるだけで動く。ここに <script> を1つ足すと、切られた環境で
  何が落ちるかを毎回考えることになる。ページを移るときの切り替え（app.css の
  @view-transition）も CSS だけで、知らないブラウザではふつうに移るだけ。
*/
export const Layout = (props: {
  title: string
  description: string
  canonical: string
  jsonLd?: unknown
  nav: NavItem[]
  theme: Theme
  /*
    足元の名乗り（components.tsx の SiteIdentity）。どのページにも出るので、
    ここに載せたものは全ページに載る
  */
  footer: Child
  /*
    縦に積んだ全体ページ（/all）のときだけ立てる。app.css は body のこの印で
    「ページの外枠」（表紙の高さ・貼り付く帯）を外す。
  */
  whole?: boolean
  /*
    ログインしている人にだけ渡る、管理画面の行き先（AdminLink）。訪問者には
    undefined が渡り、帯は今までと同じ姿のまま。
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
      <ColorSchemeMeta />
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

      {/*
        印は 24 の格子いっぱい（余白 1）に描いてあるので、角の丸い地に載せると縁に触れる。
        favicon でだけ 8 割に縮めて、地の中に余白を取る
      */}
      <link
        rel="icon"
        href={`data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='5' fill='#0c0c0e'/><g transform='translate(2.4 2.4) scale(.8)'>${markInner('#f2f2f4')}</g></svg>`,
        )}`}
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
    {/*
      data-site は公開ページの印。app.css はこれで公開ページだけに外枠（貼り付く帯・
      表紙の高さ・なめらかな送り）を当てる——管理画面と 404 の body には付かない
    */}
    <body
      data-site=""
      data-accent={props.theme.accent}
      data-typeface={props.theme.typeface}
      data-whole={props.whole ? '' : undefined}
    >
      <a class="skip" href="#main">
        本文へスキップ
      </a>
      {/*
        上の帯。ロゴ（入口へ）と目次と、ログイン中だけ管理画面への入口。ページの上に
        貼り付き（全体ページを除く）、ページを移っても同じ場所に居る。
      */}
      <header class="top">
        <Brand />
        {/*
          いま見ているページには aria-current="page"。'true' ではなく 'page' な
          のは、目次の行き先が別の URL（/projects）だから。'true' は「この一覧の
          中のいま」で、ページそのものは指さない。作品のページは載っている一覧
          （Projects）の行に、個人ページは Profile か Team の行に印が付く。

          番号は振らない。目次の番号はブロックの並び順でしかなく、読む人に言う
          ことが無い。行き先の名前が英字だけなら lang="en"（等幅の小さな大文字の札に
          なる。components.tsx の langOf）。

          aria-label は行き先で出し分ける。全体ページの目次だけが本当に
          ページ内（#projects）を指していて、ページごとの URL では別ページへ移る。
          片方に固定した文字列は、必ずどちらかで嘘になる。

          ページの移動は、この目次と、ページの中のリンク（入口の一覧への手・
          作品の行・「← 一覧に戻る」）だけ。画面の底の左右の手（ページャ）は置かない
          （CLAUDE.md の「公開ページは縦に読む」）。
        */}
        <nav class="toc" aria-label={props.whole ? 'ページ内の移動' : 'ページの移動'}>
          {props.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              lang={langOf(item.label)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        {props.admin ? <AdminLink href={props.admin} /> : null}
      </header>
      {/*
        tabindex={-1} は「本文へスキップ」のため。Safari（と iOS の全ブラウザ）は
        フラグメントで移った先が素でフォーカスを受けない要素だと、見た目だけ動いて
        キーボードの位置は帯に残る。このサイトに迂回路はこの1本しか無いので、
        外すと目次を毎回たどる以外の手が消える。-1 なので Tab の順番には入らない。
      */}
      <main id="main" tabindex={-1}>
        {props.children}
      </main>
      {/*
        足元。誰のサイトか（名前・職種・一言）と連絡先、著作権表示と全体ページへの
        1本。どの幅でも畳まない——上の帯にはロゴと目次しか置かないので、名乗りと
        連絡先はここが受ける。
      */}
      <footer class="foot">
        {props.footer}
        <p class="foot__meta">
          <span>
            © {yearInJapan()} {SITE.name}
          </span>
          {/*
            全体ページ（/all）への1本道。印刷・Ctrl-F・ブラウザ翻訳の宛先で、
            sitemap.xml にも載る。全体ページ自身には出さない（自分への行き先）。

            矢印は →。同じタブで開くサイトの中の行き先なので、「外へ出る・
            別タブ」の印（↗）は付けない（components.tsx の LinkList を見ること）。
          */}
          {props.whole ? null : <a href="/all">全体を1ページで見る →</a>}
        </p>
      </footer>
    </body>
  </HtmlDocument>
)
