import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { FormErrors } from './AdminForm'
import { ADMIN_BEHAVIOR } from './admin-behavior'
import { ColorSchemeMeta, FaviconLinks, HtmlDocument, Stylesheets } from './components'
import { Wordmark } from './icons'

/*
  管理画面の外枠。900px 以上で左ナビ、それ未満では上のナビになる（CSS 側）。
  節の名前に短い説明を添え、狭い画面では3列に分けて全項目を表示する。

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
    <ColorSchemeMeta />
    <meta name="robots" content="noindex" />
    <title>{title} — AstLog Admin</title>
    <FaviconLinks />
    <Stylesheets admin />
  </head>
)

export const AdminLayout = (props: {
  title: string
  active: 'dashboard' | 'members' | 'items' | 'blocks' | 'appearance' | 'site' | 'account'
  // いま誰として入っているか（最後にログインしたアカウントの @ログイン名かメールアドレス）
  account: string
  flash?: string | null
  errors?: Record<string, string> | null
  latestHref?: string
  children?: Child
}) => (
  <HtmlDocument>
    <AdminHead title={props.title} />
    <body>
      <a class="skip" href="#admin-main">
        管理内容へスキップ
      </a>
      <div class="admin-shell">
        <aside class="admin-nav">
          <span class="admin-nav__brand">
            <Wordmark class="admin-wordmark" />
            <span>ADMIN</span>
          </span>
          <nav class="admin-nav__links">
            <a href="/admin" aria-current={props.active === 'dashboard' ? 'page' : undefined}>
              <span>概要</span>
              <span class="admin-nav__note">準備と状況</span>
            </a>
            <a href="/admin/members" aria-current={props.active === 'members' ? 'page' : undefined}>
              <span>Members</span>
              <span class="admin-nav__note">プロフィール</span>
            </a>
            <a href="/admin/items" aria-current={props.active === 'items' ? 'page' : undefined}>
              <span>Projects</span>
              <span class="admin-nav__note">作品・業務</span>
            </a>
            <a href="/admin/blocks" aria-current={props.active === 'blocks' ? 'page' : undefined}>
              <span>構成</span>
              <span class="admin-nav__note">ページと順番</span>
            </a>
            <a
              href="/admin/appearance"
              aria-current={props.active === 'appearance' ? 'page' : undefined}
            >
              <span>見た目</span>
              <span class="admin-nav__note">色と書体</span>
            </a>
            <a href="/admin/site" aria-current={props.active === 'site' ? 'page' : undefined}>
              <span>サイト設定</span>
              <span class="admin-nav__note">紹介・連絡先</span>
            </a>
          </nav>
          <details class="admin-nav__tools">
            <summary>サイト確認・アカウント</summary>
            <div class="admin-nav__foot">
              {/* どの画面からも、直した結果をすぐ見に行けるように */}
              <a class="btn btn--ghost" href="/admin/preview" target="_blank" rel="noreferrer">
                全体プレビュー ↗
              </a>
              <a class="btn btn--link" href="/" target="_blank" rel="noreferrer">
                公開サイト ↗
              </a>
              {/*
              いま誰として入っているかを出し、そのままアカウントの画面への入口にする。
              主要な編集項目とは役割が異なるため、足元に置く
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
          </details>
        </aside>
        <main class="admin-main" id="admin-main" tabindex={-1}>
          <FormErrors errors={props.errors} latestHref={props.latestHref} />
          {props.flash ? <p class="flash">{props.flash}</p> : null}
          {props.children}
        </main>
      </div>
      <dialog id="editor-preview" class="editor-preview" aria-labelledby="editor-preview-title">
        <div class="editor-preview__head">
          <div>
            <h2 id="editor-preview-title">完成形を確認</h2>
            <p role="status">入力中の内容・まだ保存されていません</p>
          </div>
          <button type="button" class="btn btn--ghost" data-close-preview>
            編集に戻る
          </button>
        </div>
        <iframe
          name="draft-preview"
          title="入力中の内容のプレビュー"
          sandbox="allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </dialog>
      <script>{raw(ADMIN_BEHAVIOR)}</script>
    </body>
  </HtmlDocument>
)

export const AdminBare = (props: { title: string; children?: Child }) => (
  <HtmlDocument>
    <AdminHead title={props.title} />
    <body class="admin--bare">{props.children}</body>
  </HtmlDocument>
)
