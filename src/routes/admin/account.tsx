import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { destroyUserSessions, SESSION_COOKIE } from '../../lib/auth'
import { timeInJapan } from '../../lib/format'
import { PROVIDER_KEYS, PROVIDER_LABEL } from '../../lib/oauth'
import { AdminLayout } from '../../ui/AdminLayout'
import { db } from './request'
import { isHttps } from './session'

export const accountRoutes = new Hono<AppEnv>()

/*
  ログインに使えるアカウントの一覧と、「すべての端末からログアウト」。

  紐づけも外しもここからはしない。紐づくのは OWNER_… と一致するアカウントで
  初めてログインしたときだけで、外すのは D1 の行を消す（README）。画面から
  外せると、セッションを盗んだ人が持ち主のアカウントを外して締め出せる。
*/
accountRoutes.get('/account', async (c) => {
  const identities = await db(c)
    .select()
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.userId, c.get('user').id))
    .orderBy(asc(schema.userIdentities.provider), asc(schema.userIdentities.id))
  const unlinked = PROVIDER_KEYS.filter(
    (provider) => !identities.some((identity) => identity.provider === provider),
  )

  return c.html(
    <AdminLayout title="アカウント" active="account" account={c.get('account')}>
      <div class="admin-head">
        <h1>アカウント</h1>
      </div>
      <p class="form-note">
        この管理画面に入れるアカウントです。どれでログインしても、同じ管理画面に入ります。
      </p>
      <ul class="rows">
        {identities.map((identity) => (
          <li class="row" key={identity.id}>
            <span class="row__main">
              <strong>{PROVIDER_LABEL[identity.provider]}</strong>
              <span class="row__sub">{identity.label}</span>
            </span>
            <span class="row__col">最後のログイン {timeInJapan(identity.lastLoginAt)}</span>
          </li>
        ))}
      </ul>
      {unlinked.map((provider) => (
        <p class="form-note" key={provider}>
          {PROVIDER_LABEL[provider]} はまだ紐づいていません。
          {provider === 'github'
            ? 'OWNER_GITHUB_ID と同じ ID の GitHub アカウントで一度ログインすると紐づきます。'
            : 'OWNER_GOOGLE_EMAIL と同じ、Google が確認済みのアドレスで一度ログインすると紐づきます。'}
        </p>
      ))}
      <section class="catalog">
        <h2 class="catalog__title">すべての端末からログアウト</h2>
        <p class="catalog__note">
          この端末も含めて、ログインしている端末をすべてログアウトします。端末を失くした・共用の端末でログアウトし忘れたときに使います。
        </p>
        <form method="post" action="/admin/account/logout-all">
          <button class="btn btn--danger" type="submit">
            すべての端末からログアウト
          </button>
        </form>
      </section>
    </AdminLayout>,
  )
})

accountRoutes.post('/account/logout-all', async (c) => {
  await destroyUserSessions(db(c), c.get('user').id)
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) })
  return c.redirect('/admin/login?out=all', 303)
})
