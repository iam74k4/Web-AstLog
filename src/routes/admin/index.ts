import { Hono } from 'hono'
import type { AppEnv } from '../../env'
import { touchSiteOnWrite } from '../../lib/page-cache'
import { accountRoutes } from './account'
import { appearanceRoutes } from './appearance'
import { authRoutes } from './auth'
import { blockRoutes } from './blocks'
import { itemRoutes } from './items'
import { memberRoutes } from './members'
import { requireAuth, sameOrigin } from './session'

/*
  管理画面（/admin/*）の組み立て。ルートそのものは資源ごとのモジュールにあり、
  ここは守りを掛ける順だけを持つ。

  1. sameOrigin は認証の壁より外側。ログアウトも「書き込み」なので、壁の手前に
     あるものにも掛ける（内側だけに置くと素通りする）
  2. 壁の外はログインの往復（auth.tsx）だけ
  3. 壁（requireAuth）の内側で、書き込みのたびに公開ページの写しの版を上げる
     （touchSiteOnWrite。ログインした POST だけ）
*/
export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use('*', sameOrigin)
adminRoutes.route('/', authRoutes)

const walled = new Hono<AppEnv>()
walled.use('*', requireAuth)
walled.use('*', touchSiteOnWrite)

walled.get('/', (c) => c.redirect('/admin/members', 303))
walled.route('/', memberRoutes)
walled.route('/', itemRoutes)
walled.route('/', blockRoutes)
walled.route('/', appearanceRoutes)
walled.route('/', accountRoutes)

adminRoutes.route('/', walled)
