import type { Child } from 'hono/jsx'
import { yearInJapan } from '../lib/format'
import { SITE } from '../site'
import {
  AdminLink,
  Brand,
  ColorSchemeMeta,
  FaviconLinks,
  HtmlDocument,
  langOf,
  Stylesheets,
} from './components'

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
  public/assets/astlog-card.png（1200×630。ワードマークとサイトの所在。src/ui/logo.ts の
  cardSvg から scripts/logo/export.mjs が書き出す）。個人の名前や顔は焼き込まない——
  メンバーの顔は管理画面からアップロードしたプロフィールだけに載せ、空の DB で個人の顔を
  公開しない。前は 1024 角のロゴで、貼り先では小さい札（summary）にしかならなかった。

  twitter:card は画像の寸法で決める（cardOf）。横長で X の大きい札の下限
  （300x157）以上なら summary_large_image、それ以外は summary。縦長のスクリーンショットも
  summary——大きい札は横長に切り抜くので、縦長の絵は真ん中の帯しか残らない。寸法が
  分からない画像も summary に倒す。

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
  url: `${SITE.origin}/assets/astlog-card.png`,
  alt: `${SITE.name}（${SITE.origin.replace('https://', '')}）`,
  type: 'image/png',
  width: 1200,
  height: 630,
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

  骨格は1つ——上に帯（ロゴと目次。貼り付く）、その下に本文、底に足元（著作権表示と
  サイトの行き先）。色も書体も選ばせない——見た目は1つ（白と墨、見出しの欧文は
  Poppins、左の夜明けの窓）。

  内容・絞り込み・ページの移動はサーバーが決め、公開ページは script を1本も持たない
  （CSP も script-src 'none'。src/index.tsx）。ページを移るときの切り替え（app.css の
  @view-transition）も CSS だけで、知らないブラウザではふつうに移るだけ。
*/
export const Layout = (props: {
  title: string
  description: string
  canonical: string
  jsonLd?: unknown
  nav: NavItem[]
  /*
    足元のサイトの行き先（components.tsx の SiteSocials）。どのページにも出るので、
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
  // 認証済みプレビューの案内。検索・共有用のメタ情報は出さない。
  preview?: Child
  children?: Child
}) => (
  <HtmlDocument>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      <ColorSchemeMeta />
      <title>{props.title}</title>
      <meta name="description" content={props.description} />
      {props.preview ? (
        <meta name="robots" content="noindex, nofollow, noarchive" />
      ) : (
        <>
          <link rel="canonical" href={props.canonical} />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content={SITE.name} />
          <meta property="og:title" content={props.title} />
          <meta property="og:description" content={props.description} />
          <meta property="og:url" content={props.canonical} />
          <meta property="og:locale" content="ja_JP" />
          <ShareImage image={props.image ?? SITE_IMAGE} />
        </>
      )}

      <FaviconLinks />
      <Stylesheets preview={Boolean(props.preview)} />
      {props.jsonLd && !props.preview ? (
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
      data-whole={props.whole ? '' : undefined}
      data-preview={props.preview ? '' : undefined}
    >
      <a class="skip" href="#main">
        本文へスキップ
      </a>
      {props.preview}
      {/*
        上の帯。ロゴ（入口へ）と目次と、ログイン中だけ管理画面への入口。ページの上に
        貼り付き（全体ページを除く）、ページを移っても同じ場所に居る。
      */}
      <header class="top">
        <Brand href={props.preview ? '/admin/preview' : '/'} />
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
      {/*
        本文の枠（Cavani を下敷きにした2分割）。左に夜明けの窓、右に本文の面。窓は字を
        持たない飾りで、絵は app.css の「天体の飾り」が背景として描く（読み上げには出さない）。
        main の直接の子は今までどおり Screen / Hero だけ。
      */}
      <div class="frame">
        <div class="window" aria-hidden="true" />
        <main id="main" tabindex={-1}>
          {props.children}
        </main>
      </div>
      {/*
        足元。著作権表示とサイトの行き先（GitHub・Instagram・X・メール）だけ——持ち主の
        「シンプルに」。どの幅でも畳まない（上の帯にはロゴと目次しか置かないので、
        連絡先はここが受ける）。全体ページ（/all）への1本は置かない（sitemap.xml が載せる）。
      */}
      <footer class="foot">
        <p class="foot__meta">
          © {yearInJapan()} {SITE.name}
        </p>
        {props.footer}
      </footer>
    </body>
  </HtmlDocument>
)
