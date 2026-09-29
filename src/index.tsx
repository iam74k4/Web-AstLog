import { Hono } from 'hono'
import type { AppEnv } from './env'
import { pageCache } from './lib/page-cache'
import { adminRoutes } from './routes/admin/index'
import { publicRoutes } from './routes/public/routes'
import { SITE } from './site'
import { ColorSchemeMeta, HtmlDocument, Stylesheets } from './ui/components'
import { MarkIcon } from './ui/icons'

const app = new Hono<AppEnv>()

/*
  応答のヘッダは、ここの1本が全部の応答に掛ける（公開・管理画面・404・500・
  リダイレクト）。個々のルートに書くと、足したルートだけが素のまま出る。

  CSP は「公開ページに JavaScript を置かない」をブラウザに守らせる最後の壁。
  注入口（受け入れる前に上がった SVG・javascript: の href・本文の抜け）が
  1つ見つかっても、ここがあればスクリプトは走らない。
  - script-src 'none'——JSON-LD（type="application/ld+json"）はデータの塊で
    実行されないので、これで止まらない（ブラウザで確かめてある）
  - style-src に 'unsafe-inline'——入口の軌道図の札の位置（--x / --y）と走査の順
    （--at）、件数の数え上げの値（--to）、出る順（--i）、ページの切り替えの名前
    （view-transition-name）、アバターの寸法（--avatar-size）を style 属性で渡して
    いる。スクリプトではない
  - img-src に data:——ファビコンは data: の SVG（src/ui/Layout.tsx）
  - form-action 'self'——管理画面のフォームはどれも同じオリジンへ送る。
    OAuth の入口はフォームではなく GET のリンクなので、ここに掛からない
  - frame-ancestors 'none'——どのページもほかのサイトの枠に入れさせない

  /images/* は自分の CSP（default-src 'none'; sandbox）を持っている。画像の
  ふりをした文書を開かせないための、こちらより狭い約束なので**上書きしない**
  （ルートが CSP を付けていたら、ここは触らない）。

  Referrer-Policy は strict-origin-when-cross-origin。no-referrer にしては
  いけない——Chromium は no-referrer のページから出た同じオリジンのフォームの
  POST に Origin: null を付け、sameOrigin（src/routes/admin/session.ts）がそれを
  403 で弾くので、ログインしたあとの保存がすべて止まる。

  管理画面（/admin/*）は no-store。共用の端末でログアウトしたあと「戻る」で、
  下書きの中身が履歴のキャッシュから出てこないようにする。

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
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
].join('; ')

app.use(async (c, next) => {
  await next()
  const headers = c.res.headers
  if (!headers.has('content-security-policy')) headers.set('content-security-policy', PAGE_CSP)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  if (c.req.path === '/admin' || c.req.path.startsWith('/admin/')) {
    headers.set('cache-control', 'no-store')
  }
})

/*
  公開ページの写し（src/lib/page-cache.ts）。上のヘッダの1本より内側に置く——
  写しにはヘッダを焼き込まず、出すたびに上の1本が同じものを付ける
*/
app.use(pageCache)

app.route('/admin', adminRoutes)
app.route('/', publicRoutes)

const ErrorPage = ({ code, title, detail }: { code: string; title: string; detail: string }) => (
  <HtmlDocument>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <ColorSchemeMeta />
      <title>
        {code} — {SITE.name}
      </title>
      <Stylesheets />
    </head>
    <body>
      <div class="oops">
        <span class="oops__mark">
          <MarkIcon size={28} />
        </span>
        <span class="oops__code">{code}</span>
        <h1>{title}</h1>
        <p>{detail}</p>
        <a href="/">トップへ戻る →</a>
      </div>
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
      title="ページが見つかりません"
      detail="URL が変わったか、打ち間違えているかもしれません。"
    />,
    404,
  ),
)

app.onError((error, c) => {
  console.error(error)
  return c.html(
    <ErrorPage
      code="500"
      title="うまく表示できませんでした"
      detail="時間をおいてもう一度お試しください。"
    />,
    500,
  )
})

export default app
