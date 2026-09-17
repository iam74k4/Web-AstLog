import { Hono } from 'hono'
import type { AppEnv } from './env'
import { adminRoutes } from './routes/admin'
import { publicRoutes } from './routes/public'
import { SITE } from './site'
import { MarkIcon } from './ui/icons'

const app = new Hono<AppEnv>()

app.route('/admin', adminRoutes)
app.route('/', publicRoutes)

const ErrorPage = ({ code, title, detail }: { code: string; title: string; detail: string }) => (
  <html lang="ja">
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
  </html>
)

app.notFound((c) =>
  c.html(
    <ErrorPage
      code="404"
      title="ページが見つかりません"
      detail="メンバーの slug が変わったか、URL が違います。"
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
