import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../../env'
import { accountLabel, getSessionUser, SESSION_COOKIE } from '../../lib/auth'
import { db } from './request'

/*
  管理画面の入口の守り。送り元の検査（sameOrigin）と認証の壁（requireAuth）。
  組み合わせる順は src/routes/admin/index.ts。
*/

/*
  SameSite=Lax だけに頼らず、書き込みは送り元も見る。
  ログアウトも「書き込み」なので、認証の壁より外側で掛ける（内側だけに置くと、
  壁の手前にあるものを素通りする）。/admin/auth/* は GET だけなのでここには
  掛からない——あちらの CSRF は、クッキーと D1 の state が一致することで止める。

  見る順は Origin → Sec-Fetch-Site → Referer。比べるのは scheme・host・port の
  組（origin）ごと。host だけだと http と https を取り違える。

  - Origin: null は拒む（403）。Referrer-Policy: no-referrer のページや
    サンドボックスの iframe から来ると null になり、どこから来たか分からない。
    以前は new URL('null') が例外を投げて 500 になっていた。このサイトのページは
    Referrer-Policy: strict-origin-when-cross-origin（src/index.tsx）なので、自分の
    フォームからの POST が null になることは無い——no-referrer に変えると、全部ここで止まる
  - 3つとも無いときは通す。今のブラウザは POST に Origin も Sec-Fetch-Site も
    付けるので、どちらも無いのはブラウザ以外（curl など）で、それはそもそも
    ほかの人のクッキーを持てない。しかも管理画面の POST はどれもセッションの
    クッキーが要り、そのクッキーは SameSite=Lax で、別のサイトからの POST には
    付かない。パスワードのログイン（クッキー無しで受ける POST）はもう無いので、
    「クッキー無しでも効く CSRF」の入口も残っていない
*/
function writeIsSameOrigin(request: Request): boolean {
  const own = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (origin !== null) return origin !== 'null' && origin === own

  const site = request.headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin' || site === 'none'

  const referer = request.headers.get('referer')
  if (referer !== null) {
    try {
      return new URL(referer).origin === own
    } catch {
      return false
    }
  }
  return true
}

export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !writeIsSameOrigin(c.req.raw)) {
    return c.text('別のサイトからの送信は受け付けません', 403)
  }
  await next()
})

/*
  ログイン後の戻り先。管理画面の中の経路だけを通す。
  外の URL や //host を通すと、ログイン画面が他サイトへの踏み台になる。
  ログインの往復そのもの（/admin/login・/admin/auth/…）とログアウトも
  戻り先にしない——戻った先でまたログインが始まる・すぐ抜ける、の輪になる
*/
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !/^\/admin(\/[\w\-./?=&%]*)?$/.test(value)) return null
  if (value.includes('..') || value.includes('//')) return null
  if (/^\/admin\/(login|logout|auth)/.test(value)) return null
  return value
}

/*
  クッキーの Secure は https のときだけ。本番（noctifex.dev）は常に https なので
  必ず付く。http://localhost の開発では、Secure のクッキーを捨てるブラウザが
  あり（Safari）、付けるとログインの往復そのものが通らなくなる
*/
export const isHttps = (c: Context<AppEnv>) => new URL(c.req.url).protocol === 'https:'

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  const user = token ? await getSessionUser(db(c), token) : null
  if (!user) {
    // GET なら行き先を持ち回す（POST の宛先は開き直せないので持たない）
    const url = new URL(c.req.url)
    const next = c.req.method === 'GET' ? safeNext(url.pathname + url.search) : null
    return c.redirect(next ? `/admin/login?next=${encodeURIComponent(next)}` : '/admin/login', 303)
  }
  c.set('user', user)
  c.set('account', (await accountLabel(db(c), user.id)) ?? 'アカウント')
  await next()
})
