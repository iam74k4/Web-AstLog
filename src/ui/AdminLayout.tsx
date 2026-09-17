import type { Child } from 'hono/jsx'
import { MarkIcon } from './icons'

/*
  管理画面の外枠。900px 以上で左ナビ、それ未満では上のバーになる（CSS 側）。
  項目が2つしかないので、折りたたむメニューは持たない。
*/
export const AdminLayout = (props: {
  title: string
  active: 'members' | 'items'
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
