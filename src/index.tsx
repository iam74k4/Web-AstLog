import { DrizzleQueryError } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from './env'
import { yearInJapan } from './lib/format'
import { HSTS, PERMISSIONS_POLICY } from './lib/headers'
import { pageCache } from './lib/page-cache'
import { adminRoutes } from './routes/admin/index'
import { publicRoutes } from './routes/public/routes'
import { SITE } from './site'
import { ADMIN_CSP } from './ui/admin-behavior'
import {
  Brand,
  ColorSchemeMeta,
  Cta,
  Eyebrow,
  FaviconLinks,
  Hero,
  HtmlDocument,
  Phrases,
  Stylesheets,
} from './ui/components'

const app = new Hono<AppEnv>()

/*
  応答のヘッダは、ここの1本が全部の応答に掛ける（公開・管理画面・404・500・
  リダイレクト）。個々のルートに書くと、足したルートだけが素のまま出る。

  CSP は、注入口（受け入れる前に上がった SVG・javascript: の href・本文の抜け）が
  1つ見つかってもスクリプトを走らせない最後の壁。
  - 公開ページは script-src 'none'。内容・導線・見た目のどれも JavaScript を要らない
    （装飾の動きを始める inline helper を持っていたころは、その SHA-256 だけを許していた）。
    管理画面は ADMIN_BEHAVIOR の SHA-256 だけを許す。JSON-LD（type="application/ld+json"）は
    実行されないデータなので、none でも止まらない
  - style-src に 'unsafe-inline'——ページの切り替えの名前（view-transition-name）と
    アバターの寸法（--avatar-size）を style 属性で渡している。スクリプトではない
  - img-src は 'self' だけ——favicon は public/assets のファイル、ロゴはページに直に描く SVG
  - form-action 'self'——管理画面のフォームはどれも同じオリジンへ送る。
    OAuth の入口はフォームではなく GET のリンクなので、ここに掛からない
  - frame-ancestors 'none'——ほかのサイトの枠に入れさせない。プレビューのみ同一オリジンの枠を許す

  /images/* は自分の CSP（default-src 'none'; sandbox）を持っている。画像の
  ふりをした文書を開かせないための、こちらより狭い約束なので**上書きしない**
  （ルートが CSP を付けていたら、ここは触らない）。

  Referrer-Policy は strict-origin-when-cross-origin。no-referrer にしては
  いけない——Chromium は no-referrer のページから出た同じオリジンのフォームの
  POST に Origin: null を付け、sameOrigin（src/routes/admin/session.ts）がそれを
  403 で弾くので、ログインしたあとの保存がすべて止まる。

  HSTS・Permissions-Policy の値は src/lib/headers.ts に置き、public/_headers と同じ値を
  付ける（理由もそちら）。

  管理画面（/admin/*）は no-store。共用の端末でログアウトしたあと「戻る」で、
  下書きの中身が履歴のキャッシュから出てこないようにする。

  管理画面（ログインの画面も）は Cross-Origin-Opener-Policy: same-origin。ほかのサイトが
  window.open で開いた窓に、開いた側から手を出させない——手が届くと、窓の中の枠の数
  （window.length）でログインしているかが分かり（ログイン後の画面にはプレビューの iframe が
  ある）、開いた窓をあとで偽のページへ移せる。公開ページの窓から /admin へ移っても、そこで
  つながりが切れる。同じオリジンの窓（プレビューを別タブで開く）と iframe はつながったまま、
  OAuth は画面ごとの遷移なので止まらない。
  公開ページと public/ のファイルには付けない。sandbox の枠（allow-popups-to-escape-sandbox を
  持たないもの。メールの表示や埋め込みのプレビュー）から開いた窓は、COOP を持つページを
  開けずにエラーで終わる。公開ページには、開いた側に数えられて困るものが無い。

  public/ の静的なファイルは Worker を通らない（[assets] が先に配る）。
  あちらのヘッダは public/_headers が持つ。
*/
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join('; ')

app.use(async (c, next) => {
  await next()
  const headers = c.res.headers
  const admin = c.req.path === '/admin' || c.req.path.startsWith('/admin/')
  const preview = c.req.path === '/admin/preview' || c.req.path.startsWith('/admin/preview/')
  if (!headers.has('content-security-policy')) {
    // 未保存の画像は検査した raster bytes を応答内に閉じ込める。許可は認証内のプレビューだけ。
    headers.set(
      'content-security-policy',
      preview
        ? PAGE_CSP.replace("img-src 'self'", "img-src 'self' data:").replace(
            "frame-ancestors 'none'",
            "frame-ancestors 'self'",
          )
        : admin &&
            c.req.path !== '/admin/login' &&
            /^text\/html/.test(headers.get('content-type') ?? '')
          ? PAGE_CSP.replace("script-src 'none'", `script-src '${ADMIN_CSP}'`)
          : PAGE_CSP,
    )
  }
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('permissions-policy', PERMISSIONS_POLICY)
  if (new URL(c.req.url).protocol === 'https:') headers.set('strict-transport-security', HSTS)
  if (admin) {
    headers.set('cross-origin-opener-policy', 'same-origin')
    headers.set('cache-control', preview ? 'private, no-store' : 'no-store')
    if (preview) headers.set('x-robots-tag', 'noindex, nofollow')
  }
})

/*
  公開ページの写し（src/lib/page-cache.ts）。上のヘッダの1本より内側に置く——
  写しにはヘッダを焼き込まず、出すたびに上の1本が同じものを付ける
*/
app.use(pageCache)

app.route('/admin', adminRoutes)
app.route('/', publicRoutes)

/*
  404 と 500。公開ページと同じ骨格（上の帯・本文の枠・足元）と入口と同じ型（札・大見出し・
  リード文・押し手）で組む——前は帯も足元も無い中央寄せの1枚で、作り替えたサイトの中で
  ここだけが前の姿のままだった。D1 には聞かない（障害の 500 もここから出る）ので、目次と
  足元の行き先は置かず、ロゴと著作権表示だけ。左の夜明けの窓は入口と同じに出る
*/
const ErrorPage = ({
  code,
  label,
  title,
  detail,
}: {
  code: string
  label: string
  title: string
  detail: string
}) => (
  <HtmlDocument>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <ColorSchemeMeta />
      <title>
        {code} — {SITE.name}
      </title>
      <FaviconLinks />
      <Stylesheets />
    </head>
    <body data-site="">
      <a class="skip" href="#main" lang="en">
        Skip to content
      </a>
      <header class="top">
        <Brand />
      </header>
      <div class="frame">
        <div class="window" aria-hidden="true" />
        <main id="main" tabindex={-1}>
          <Hero cover>
            <Eyebrow parts={[code, label]} />
            <h1>{title}</h1>
            <p class="hero__lead">
              <Phrases text={detail} />
            </p>
            <div class="hero__actions">
              <Cta href="/">Home</Cta>
            </div>
          </Hero>
        </main>
      </div>
      <footer class="foot">
        <p class="foot__meta">
          © {yearInJapan()} {SITE.name}
        </p>
      </footer>
    </body>
  </HtmlDocument>
)

/*
  404 の説明は訪問者の言葉で書く。

  以前は「メンバーの slug が変わったか、URL が違います。」だった。slug は
  管理画面とデータベースの言葉で、ここに着いた人は見たことが無い。しかも
  404 になる道はメンバーのページに限らない（作品・画面の番号・下書きに戻した
  もの）。訪問者に分かるのは「URL が違う」ことだけなので、原因の見当と
  次の一手（下のトップへの道）だけを置く。断定しない——こちらからは、
  変わったのか打ち間違えたのかを見分けられない。
*/
app.notFound((c) =>
  c.html(
    <ErrorPage
      code="404"
      label="Not Found"
      title="ページが見つかりません"
      detail="URL が変わったか、打ち間違えているかもしれません。"
    />,
    404,
  ),
)

/*
  500 のログ（Workers Logs）には、要求の method と path（query は書かない）と、例外の連なり
  （cause）の名前と文だけを書き、束縛した値はどこにも書かない。値は書こうとした名前・所在地・
  メールで、ログに残ると D1 から消したあとも保持期間のあいだ消えない。
  - Drizzle の失敗したクエリの例外（DrizzleQueryError）は文の中に「params:」として値を持つ。
    クエリの文（値は ? で渡す）だけを書く
  - D1 は受け取れない型の値を束縛されると（D1_TYPE_ERROR）、文の末尾「for value '…'」に
    その値を書く。そこから後ろを落とす
  - スタックは書かない（1行目に同じ文が入る）
*/
const MAX_CAUSES = 5
const BOUND_VALUE = / for value [\s\S]*$/

function causeTrail(error: unknown): string {
  const parts: string[] = []
  let current = error
  for (let depth = 0; depth < MAX_CAUSES && current !== undefined && current !== null; depth++) {
    if (current instanceof DrizzleQueryError) {
      parts.push(`DrizzleQueryError: Failed query: ${current.query}`)
    } else if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message.replace(BOUND_VALUE, '')}`)
    } else {
      // 例外でない値は中身を書かない（何が投げられたかは型で分かる）
      parts.push(`thrown ${typeof current}`)
    }
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join(' <- ')
}

app.onError((error, c) => {
  console.error(`500 ${c.req.method} ${new URL(c.req.url).pathname}: ${causeTrail(error)}`)
  return c.html(
    <ErrorPage
      code="500"
      label="Server Error"
      title="うまく表示できませんでした"
      detail="時間をおいてもう一度お試しください。"
    />,
    500,
  )
})

export default app
