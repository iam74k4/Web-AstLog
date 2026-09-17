import type { Child } from 'hono/jsx'
import { MarkIcon } from './icons'

/*
  管理画面の外枠。900px 以上で左ナビ、それ未満では上のバーになる（CSS 側）。
  項目が4つしかないので、折りたたむメニューは持たない。

  公開ページと違い、ここは見た目のプリセットを当てない。編集する場所の
  見え方まで一緒に変わると、直したのが中身なのか設定なのか分からなくなる。
*/
export const AdminLayout = (props: {
  title: string
  active: 'members' | 'items' | 'blocks' | 'appearance'
  email: string
  flash?: string | null
  children?: Child
}) => (
  <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      <meta name="color-scheme" content="dark" />
      <meta name="robots" content="noindex" />
      <title>{props.title} — Noctifex Admin</title>
      <link rel="stylesheet" href="/app.css" />
    </head>
    <body class="admin">
      <div class="admin-shell">
        <aside class="admin-nav">
          <span class="admin-nav__brand">
            <MarkIcon size={18} />
            <span>ADMIN</span>
          </span>
          <nav class="admin-nav__links">
            <a href="/admin/members" aria-current={props.active === 'members' ? 'page' : undefined}>
              Members
            </a>
            <a href="/admin/items" aria-current={props.active === 'items' ? 'page' : undefined}>
              Apps &amp; Works
            </a>
            <a href="/admin/blocks" aria-current={props.active === 'blocks' ? 'page' : undefined}>
              構成
            </a>
            <a
              href="/admin/appearance"
              aria-current={props.active === 'appearance' ? 'page' : undefined}
            >
              見た目
            </a>
          </nav>
          <div class="admin-nav__foot">
            <span class="admin-nav__email">{props.email}</span>
            <form method="post" action="/admin/logout">
              <button type="submit" class="btn btn--link">
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <main class="admin-main">
          {props.flash ? <p class="flash">{props.flash}</p> : null}
          {props.children}
        </main>
      </div>
    </body>
  </html>
)

export const AdminBare = (props: { title: string; children?: Child }) => (
  <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      <meta name="color-scheme" content="dark" />
      <meta name="robots" content="noindex" />
      <title>{props.title} — Noctifex Admin</title>
      <link rel="stylesheet" href="/app.css" />
    </head>
    <body class="admin admin--bare">{props.children}</body>
  </html>
)
