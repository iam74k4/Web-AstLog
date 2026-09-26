import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import packageJson from 'virtual:repo:package.json'
import touchScript from 'virtual:repo:scripts/touch-site.mjs'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import app from '../src/index'
import { SESSION_COOKIE } from '../src/lib/auth'
import { CACHE_STATE_HEADER, SITE_VERSION_KEY } from '../src/lib/page-cache'
import { db, form, get, resetDb, seedItem, signIn, touch, uncachedEnv, withCookie } from './helpers'

beforeEach(resetDb)

/*
  公開ページの写し（src/lib/page-cache.ts）。

  写しから出たことは、応答の印（x-noctifex-cache）だけでなく中身でも確かめる——
  D1 を直に書き換えて版を上げずに見ると、写しなら前の題が、描き直しなら新しい題が出る。
*/

const state = (response: Response) => response.headers.get(CACHE_STATE_HEADER)

const retitle = (title: string) =>
  db().update(schema.items).set({ title }).where(eq(schema.items.slug, 'appmixer'))

// 同じ Worker の版（写しの鍵が同じ）のまま、env だけを差し替えて動かす
async function run(path: string, overrides: Partial<Cloudflare.Env>) {
  const ctx = createExecutionContext()
  const response = await app.fetch(
    new Request(`https://noctifex.test${path}`, { redirect: 'manual' }),
    { ...env, ...overrides },
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return response
}

// D1 に投げた文を数える（prepare / batch / exec）
function countingDb() {
  const calls = { count: 0 }
  const database = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'prepare' || key === 'batch' || key === 'exec') calls.count++
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { calls, database }
}

describe('公開ページの写し', () => {
  it('2度目は写しから出す（D1 を直に書き換えても、版を上げるまでは前の画面）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    const first = await get('/projects')
    expect(state(first)).toBe('miss')
    expect(await first.text()).toContain('AppMixer')

    await retitle('改名した題')
    const second = await get('/projects')
    expect(state(second)).toBe('hit')
    const html = await second.text()
    expect(html).toContain('AppMixer')
    expect(html).not.toContain('改名した題')
    // 写しの印（版・置いた時刻・Cache API の期限）は訪問者に出さない
    expect(second.headers.get('cache-control')).toBeNull()
    expect(second.headers.get('x-noctifex-version')).toBeNull()
    expect(second.headers.get('x-noctifex-stored')).toBeNull()
    // ヘッダの1本（src/index.tsx）は写しにも同じものを付ける
    expect(second.headers.get('content-security-policy')).toContain("script-src 'none'")

    // 版を上げると描き直す
    await touch()
    const third = await get('/projects')
    expect(state(third)).toBe('miss')
    expect(await third.text()).toContain('改名した題')
  })

  it('query は鍵に入る（絞り込みは別の写し）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    expect(state(await get('/projects'))).toBe('miss')
    expect(state(await get('/projects?kind=app'))).toBe('miss')
    expect(state(await get('/projects?kind=app'))).toBe('hit')
  })

  it('管理画面で保存すると版が上がり、訪問者にも新しい画面が出る', async () => {
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    expect(state(await get('/apps/item/appmixer'))).toBe('miss')
    expect(state(await get('/apps/item/appmixer'))).toBe('hit')

    const signed = await signIn()
    const saved = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: '保存した題', slug: 'appmixer', published: '1' }),
    })
    expect(saved.status).toBe(303)

    const after = await get('/apps/item/appmixer')
    expect(state(after)).toBe('miss')
    expect(await after.text()).toContain('保存した題')
  })

  it('ログインしていない POST と、検査で止めた保存は版を上げない', async () => {
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    expect(version).not.toBeNull()

    // 認証の壁がログイン画面へ送る。誰でも写しを捨てさせられると、KV の書き込みの枠も食われる
    const outside = await get(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: '外から', published: '1' }),
    })
    expect(outside.status).toBe(303)
    expect(outside.headers.get('location')).toBe('/admin/login')
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)

    // 題が空の保存は 400（何も書いていない）
    const signed = await signIn()
    const refused = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: '', published: '1' }),
    })
    expect(refused.status).toBe(400)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('D1 が落ちたら、古い写しを 500 の代わりに出す（版が変わっていても）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    expect(state(await get('/projects'))).toBe('miss')
    // 版が上がったあと（写しは古い）に D1 が落ちる
    await touch()

    const broken = { DB: undefined as unknown as D1Database }
    const response = await run('/projects', broken)
    expect(response.status).toBe(200)
    expect(state(response)).toBe('stale')
    expect(await response.text()).toContain('AppMixer')

    // 写しの無い URL は今までどおり 500
    expect((await run('/contact', broken)).status).toBe(500)
  })

  it('ログインしている人の画面は写しに置かない（管理画面への入口が訪問者に出ない）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    const signed = await signIn()
    const own = await signed('/projects')
    expect(own.headers.get('cache-control')).toBe('private, no-store')
    expect(state(own)).toBeNull()
    expect(await own.text()).toContain('/admin/items')

    const visitor = await get('/projects')
    expect(state(visitor)).toBe('miss')
    expect(await visitor.text()).not.toContain('/admin/items')
  })

  it('セッションのクッキーがあれば写しを通らない（切れたクッキーでも）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await get('/projects')
    expect(state(await get('/projects'))).toBe('hit')
    await retitle('改名した題')

    for (const cookie of [`${SESSION_COOKIE}=expired-or-forged`, `other=1; ${SESSION_COOKIE}=x`]) {
      const response = await withCookie(cookie)('/projects')
      expect(state(response), cookie).toBeNull()
      expect(await response.text(), cookie).toContain('改名した題')
    }
    // ほかのクッキーだけなら訪問者として写しを使う
    expect(state(await withCookie('other=1')('/projects'))).toBe('hit')
  })

  it('デプロイした日（Worker の版が変わった日）には、前のコードの写しを出さない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await get('/projects')
    expect(state(await get('/projects'))).toBe('hit')
    await retitle('改名した題')

    const deployed = await run('/projects', uncachedEnv())
    expect(state(deployed)).toBe('miss')
    expect(await deployed.text()).toContain('改名した題')
  })

  it('404 と 301 も持つ。管理画面・画像・robots.txt・「.」を含む URL は通らない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    for (const path of ['/members/nobody', '/apps', '/sitemap.xml']) {
      expect(state(await get(path)), path).toBe('miss')
      expect(state(await get(path)), path).toBe('hit')
    }
    for (const path of [
      '/admin/login',
      '/images/items/none.png',
      '/robots.txt',
      '/favicon.ico',
      '/wp-login.php',
    ]) {
      await get(path)
      expect(state(await get(path)), path).toBeNull()
    }
  })
})

describe('探し回る要求', () => {
  it('画面の名前の形でない URL は、D1 に聞かずに 404', async () => {
    const { calls, database } = countingDb()
    for (const path of ['/wp-login.php', '/.env', '/xmlrpc.php/1', '/nope', '/block-x', '/Team']) {
      calls.count = 0
      const response = await run(path, uncachedEnv({ DB: database }))
      expect(response.status, path).toBe(404)
      expect(calls.count, path).toBe(0)
    }
    // 形の合う名前は今までどおり D1 に聞く（数えられていることの確かめ）
    calls.count = 0
    expect((await run('/contact', uncachedEnv({ DB: database }))).status).toBe(200)
    expect(calls.count).toBeGreaterThan(0)
  })
})

describe('管理画面を通らない書き換え', () => {
  const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts

  it('seed を流したら版を上げる。本番の手直しのあとに打つ入口もある', () => {
    // 上げないと、seed の前に置いた写しが FRESH_MS のあいだ出続ける
    expect(scripts['db:seed:local']).toMatch(
      /--file=\.\/seed\.sql && node scripts\/touch-site\.mjs --local$/,
    )
    expect(scripts['site:touch']).toBe('node scripts/touch-site.mjs --remote')
    // 鍵の名前は src/lib/page-cache.ts と同じ（.mjs からは TS を読めないので写してある）
    expect(touchScript).toContain(`const KEY = '${SITE_VERSION_KEY}'`)
  })
})
