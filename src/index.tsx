import { Hono } from 'hono'
import type { AppEnv } from './env'
import { adminRoutes } from './routes/admin'
import { publicRoutes } from './routes/public'
import { SITE } from './site'
import { HtmlDocument } from './ui/components'
import { MarkIcon } from './ui/icons'

const app = new Hono<AppEnv>()

app.route('/admin', adminRoutes)
app.route('/', publicRoutes)

const ErrorPage = ({ code, title, detail }: { code: string; title: string; detail: string }) => (
  <HtmlDocument>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="color-scheme" content="dark" />
      <title>
        {code} — {SITE.name}
      </title>
      <link rel="stylesheet" href="/app.css" />
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
