import { Hono } from 'hono'
import type { AppEnv } from '../../env'
import { touchSiteOnWrite } from '../../lib/page-cache'
import { accountRoutes } from './account'
import { authRoutes } from './auth'
import { blockPreviewRoutes } from './block-preview'
import { blockRoutes } from './blocks'
import { dashboardRoutes } from './dashboard'
import { itemRoutes } from './items'
import { memberRoutes } from './members'
import { previewRoutes } from './preview'
import { readAdminForm } from './request'
import { requireAuth, sameOrigin } from './session'
import { siteSettingsRoutes } from './site-settings'

/*
  管理画面（/admin/*）の組み立て。ルートそのものは資源ごとのモジュールにあり、
  ここは守りを掛ける順だけを持つ。

  1. sameOrigin は認証の壁より外側。ログアウトも「書き込み」なので、壁の手前に
     あるものにも掛ける（内側だけに置くと素通りする）
  2. 壁の外はログインの往復（auth.tsx）だけ
  3. 壁（requireAuth）の内側でフォームを読み、壊れた本文は保存前に 400 にする
  4. プレビューは保存せず、公開ページの写しの版も変えない
  5. 書き込みのたびに公開ページの写しの版を上げる
     （touchSiteOnWrite。ログインした POST だけ）
*/
export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use('*', sameOrigin)
adminRoutes.route('/', authRoutes)

const walled = new Hono<AppEnv>()
walled.use('*', requireAuth)
walled.use('*', readAdminForm)
walled.route('/', previewRoutes)
walled.route('/', blockPreviewRoutes)
walled.use('*', touchSiteOnWrite)

walled.route('/', dashboardRoutes)
walled.route('/', memberRoutes)
walled.route('/', itemRoutes)
walled.route('/', blockRoutes)
walled.route('/', siteSettingsRoutes)
walled.route('/', accountRoutes)

adminRoutes.route('/', walled)
