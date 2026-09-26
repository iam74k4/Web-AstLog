import type { Child } from 'hono/jsx'
import { HtmlDocument, Stylesheets } from './components'
import { MarkIcon } from './icons'

/*
  管理画面の外枠。900px 以上で左ナビ、それ未満では上のバーになる（CSS 側）。
  項目が4つしかないので、折りたたむメニューは持たない。

  公開ページと違い、ここは見た目のプリセットを当てない。編集する場所の
  見え方まで一緒に変わると、直したのが中身なのか設定なのか分からなくなる。
*/
/*
  管理画面の <head>。壁の中（AdminLayout）と外（AdminBare・ログインと初期設定）で
  1文字も違わなかったので1本にする。noindex も viewport も同じ。

  **props の口はまだ開けない。** 壁の外だけ head を変えたくなったら、
  ここに1つ足す——呼ぶ側で <head> を書き直さないこと。2枚に戻ると、
  次に足すメタタグが片方だけに入る。
*/
const AdminHead = ({ title }: { title: string }) => (
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <meta name="robots" content="noindex" />
    <title>{title} — Noctifex Admin</title>
    <Stylesheets admin />
  </head>
)

export const AdminLayout = (props: {
  title: string
  active: 'members' | 'items' | 'blocks' | 'appearance' | 'account'
  // いま誰として入っているか（最後にログインしたアカウントの @ログイン名かメールアドレス）
  account: string
  flash?: string | null
  children?: Child
}) => (
  <HtmlDocument>
    <AdminHead title={props.title} />
    <body>
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
              Projects
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
            {/* どの画面からも、直した結果をすぐ見に行けるように */}
            <a class="btn btn--link" href="/" target="_blank" rel="noreferrer">
              サイトを見る ↗
            </a>
            {/*
              いま誰として入っているかを出し、そのままアカウントの画面への入口にする。
              上の4つと並べないのは、900 未満の横帯に5つ目が入らないため
            */}
            <a
              class="admin-nav__account"
              href="/admin/account"
              aria-current={props.active === 'account' ? 'page' : undefined}
            >
              <span class="sr-only">アカウント: </span>
              {props.account}
            </a>
            <form method="post" action="/admin/logout">
              <button type="submit" class="btn btn--link">
                ログアウト
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
  </HtmlDocument>
)

export const AdminBare = (props: { title: string; children?: Child }) => (
  <HtmlDocument>
    <AdminHead title={props.title} />
    <body class="admin--bare">{props.children}</body>
  </HtmlDocument>
)
