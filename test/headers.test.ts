import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import assetHeaders from 'virtual:repo:public/_headers'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
import { ADMIN_BEHAVIOR, ADMIN_CSP } from '../src/ui/admin-behavior'
import { MOTION_CSP, MOTION_START } from '../src/ui/motion'
import { get, okText, resetDb, seedItem, seedMember, signIn, uncachedEnv } from './helpers'

beforeEach(resetDb)

/*
  SEC-3。応答のヘッダは src/index.tsx のミドルウェア1本が全部の応答に掛ける。
  以前は content-type しか無く、「公開ページに JavaScript を置かない」を
  ブラウザに守らせるものが無かった（注入口が1つ入れば、そのまま走る）。
  管理画面には Cache-Control も無く、ログアウトしたあとに「戻る」で下書きが見えた。
*/

// "a b; c d" を { a: 'b', c: 'd' } に開く。並び順や空白の揺れで落とさない
const directives = (csp: string | null) =>
  Object.fromEntries(
    (csp ?? '')
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((words) => words[0])
      .map(([name, ...values]) => [name, values.join(' ')]),
  )

function expectPageHeaders(response: Response, label: string, motion = false, admin = false) {
  const csp = directives(response.headers.get('content-security-policy'))
  // 公開 Layout の成功した HTML だけに、初期描画の補助1本のハッシュを許す
  expect(csp['script-src'], label).toBe(
    admin ? `'${ADMIN_CSP}'` : motion ? `'${MOTION_CSP}'` : "'none'",
  )
  expect(csp['default-src'], label).toBe("'self'")
  expect(csp['object-src'], label).toBe("'none'")
  expect(csp['base-uri'], label).toBe("'none'")
  expect(csp['form-action'], label).toBe("'self'")
  expect(csp['frame-ancestors'], label).toBe("'none'")
  // 画像は同じオリジンだけ（favicon も public/assets のファイル）。軌道図の置き場所や件数は style 属性で渡す
  expect(csp['img-src'], label).toBe("'self'")
  expect(csp['style-src'], label).toBe("'self' 'unsafe-inline'")
  expect(response.headers.get('x-content-type-options'), label).toBe('nosniff')
  expect(response.headers.get('x-astlog-motion'), label).toBeNull()
  /*
    no-referrer にしない。Chromium はそのページから出た同じオリジンの POST に
    Origin: null を付け、sameOrigin が 403 で弾く（管理画面の保存が全部止まる）
  */
  expect(response.headers.get('referrer-policy'), label).toBe('strict-origin-when-cross-origin')
}

describe('応答のヘッダ', () => {
  it('公開ページ・全体ページ・404・robots・sitemap・リダイレクトのどれにも付く', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })
    for (const [path, status, motion] of [
      ['/', 200, true],
      ['/projects', 200, true],
      ['/apps/item/appmixer', 200, true],
      ['/all', 200, true],
      ['/contact', 200, true],
      ['/robots.txt', 200, false],
      ['/sitemap.xml', 200, false],
      ['/apps', 301, false],
      ['/no-such-page', 404, false],
    ] as const) {
      const response = await get(path)
      expect(response.status, path).toBe(status)
      expectPageHeaders(response, path, motion)
      // 訪問者に返す公開ページは共有のキャッシュに置いてよい（no-store は管理画面だけ）
      expect(response.headers.get('cache-control'), path).toBeNull()
    }
  })

  it('500 の画面にも付く', async () => {
    const ctx = createExecutionContext()
    // D1 を持たない env で動かし、公開ページの読み出しを落とす（写しがあると
    // stale-if-error でそれが 200 で出るので、写しを持たない env で）
    const response = await app.fetch(
      new Request('https://astlog.test/'),
      uncachedEnv({ DB: undefined as unknown as D1Database }),
      ctx,
    )
    await waitOnExecutionContext(ctx)
    expect(response.status).toBe(500)
    expectPageHeaders(response, '500')
  })

  it('公開ページの実行スクリプトは初期描画の補助1本だけ。ほかは JSON-LD', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })
    for (const path of ['/', '/apps/item/appmixer', '/all', '/members/okazaki']) {
      const html = await okText(path)
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      const helpers = scripts.filter((script) => script[1] !== ' type="application/ld+json"')
      expect(helpers, path).toHaveLength(1)
      expect(helpers[0]?.[0], path).toBe(`<script>${MOTION_START}</script>`)
    }
  })

  it('CSP のハッシュは、実際に配った補助の UTF-8 全文の SHA-256 と一致する', async () => {
    const response = await get('/')
    const html = await response.text()
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBe(MOTION_START)
    if (script === undefined) throw new Error('初期描画の補助が無い')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script))
    const hash = `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`
    expect(MOTION_CSP).toBe(hash)
    expect(directives(response.headers.get('content-security-policy'))['script-src']).toBe(
      `'${hash}'`,
    )
  })

  it('管理画面の補助も配った全文の SHA-256 だけを許す', async () => {
    const response = await (await signIn())('/admin/members/new')
    const html = await response.text()
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(1)
    const helper = scripts[0]?.[1]
    expect(helper).toBe(ADMIN_BEHAVIOR)
    if (helper === undefined) throw new Error('管理画面の補助が無い')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(helper))
    expect(ADMIN_CSP).toBe(`sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`)
    expectPageHeaders(response, '管理', false, true)
  })

  it('要求ヘッダで公開 Layout の内部印を偽っても、404 に実行許可は付かない', async () => {
    const response = await get('/no-such-page', { headers: { 'x-astlog-motion': 'staged' } })
    expect(response.status).toBe(404)
    expectPageHeaders(response, '内部印を偽った404')
  })

  it('管理画面は no-store。ログイン前の画面・壁のリダイレクト・ログイン後の画面のどれも', async () => {
    const anonymous = [await get('/admin/login'), await get('/admin'), await get('/admin/items')]
    expect(anonymous.map((one) => one.status)).toEqual([200, 303, 303])
    for (const response of anonymous) {
      expectPageHeaders(response, response.url)
      expect(response.headers.get('cache-control'), response.url).toBe('no-store')
    }

    const fetchAs = await signIn()
    for (const path of [
      '/admin/members',
      '/admin/items',
      '/admin/blocks',
      '/admin/appearance',
      '/admin/account',
    ]) {
      const response = await fetchAs(path)
      expect(response.status, path).toBe(200)
      expectPageHeaders(response, path, false, true)
      expect(response.headers.get('cache-control'), path).toBe('no-store')
    }
  })

  it('ログイン中の公開ページは private, no-store のまま（ミドルウェアが上書きしない）', async () => {
    const fetchAs = await signIn()
    const response = await fetchAs('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expectPageHeaders(response, '/', true)
  })

  /*
    /images/* はこちらより狭い自分の CSP（default-src 'none'; sandbox）を持つ。
    ページの CSP で上書きすると、画像のふりをした文書が直に開かれたときに
    同じオリジンの img・style を読める文書になる
  */
  it('/images/* の CSP は上書きしない', async () => {
    await env.MEDIA.put('items/shot-ef56.png', 'image-bytes', {
      metadata: { contentType: 'image/png' },
    })
    const response = await get('/images/items/shot-ef56.png')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  /*
    public/ の静的なファイルは Worker を通らないので、ミドルウェアは届かない。
    Workers Static Assets が public/_headers を読んで付ける（このテストは workerd の
    中で動き、[assets] を持たないので、ファイルの中身を見る）
  */
  // public/_headers を「パス → { ヘッダ名: 値 }」に開く。頭が空白の行がその上のパスのヘッダ
  const headerRules = () => {
    const rules = new Map<string, Record<string, string>>()
    let current: Record<string, string> | undefined
    for (const line of assetHeaders.split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue
      if (!/^\s/.test(line)) {
        current = {}
        rules.set(line.trim(), current)
        continue
      }
      const [name, ...rest] = line.trim().split(':')
      if (current && name) current[name.toLowerCase()] = rest.join(':').trim()
    }
    return rules
  }

  it('静的なファイルのヘッダは public/_headers が持つ', () => {
    const rules = headerRules()
    expect([...rules.keys()][0]).toBe('/*')
    const values = rules.get('/*') ?? {}
    expect(values['x-content-type-options']).toBe('nosniff')
    expect(values['referrer-policy']).toBe('strict-origin-when-cross-origin')
    /*
      読み込みを許すのは data: の画像だけ。ロゴの SVG（ワードマークと favicon）は O の光の絵を
      data URI で抱えていて、ブラウザによっては <img> や favicon で使うときもこの CSP が効く
    */
    expect(values['content-security-policy']).toBe("default-src 'none'; img-src data:; sandbox")
    // 規則の数には上限がある（Workers Static Assets は 100 まで）
    expect(rules.size).toBeLessThanOrEqual(100)
  })

  /*
    PERF-2。CSS は既定（public, max-age=0, must-revalidate）のまま配られ、ページを
    移るたびに描画を止めて条件付き GET を1往復していた。いまは中身から作った版を
    URL に付け（src/ui/components.tsx の Stylesheets）、_headers が1年・immutable で配る。
    長く持たせてよいのは版つきの URL で読まれるものだけ——版の無い素材（ロゴの素材・GitHub の顔）を
    immutable にすると、差し替えた絵が1年届かない。ブラックホールの絵も版つき（上の帯のロゴの O が
    どのページでも読む。版は src/ui/logo.ts の BLACKHOLE_ART で、test/public.test.ts が中身と突き合わせる）。
    星雲とメンバーの天体の絵も中身の版つきで読み、同じテストで実ファイルと突き合わせる
  */
  it('スタイルシートは版つきの URL で読み、1年・immutable で配る', async () => {
    const rules = headerRules()
    const cached = [
      '/app.css',
      '/admin.css',
      '/preview.css',
      '/assets/blackhole.webp',
      ...['sun', 'moon', 'neptune', 'saturn'].map((body) => `/assets/celestial-${body}-v2.webp`),
      ...['iris', 'violet', 'ember', 'mint', 'sky', 'rose'].map(
        (name) => `/assets/nebula-${name}.webp`,
      ),
    ]
    for (const path of cached) {
      expect(rules.get(path)?.['cache-control'], path).toBe('public, max-age=31536000, immutable')
    }
    const long = [...rules].filter(([, values]) => values['cache-control']?.includes('immutable'))
    expect(long.map(([path]) => path).sort()).toEqual([...cached].sort())

    const version = /^\/(app|admin|preview)\.css\?v=[0-9a-z]+$/
    const sheets = (html: string) =>
      [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((found) => found[1])

    // 公開ページと 404 は app.css だけ。管理画面の規則を訪問者に配らない。
    // /projects は作品が無いと 404 になり、404 のページを公開ページとして読んでいた
    await seedItem()
    const missing = await get('/no-such-page')
    expect(missing.status).toBe(404)
    for (const [path, html] of [
      ['/', await okText('/')],
      ['/projects', await okText('/projects')],
      ['/no-such-page', await missing.text()],
    ] as const) {
      const links = sheets(html)
      expect(links, path).toHaveLength(1)
      expect(links[0], path).toMatch(version)
      expect(links[0], path).toMatch(/^\/app\.css/)
      // ブラックホールの絵（上の帯のロゴの O と入口の真ん中）も、版の無い URL では読まない
      const art = [...html.matchAll(/\/assets\/blackhole\.webp[^"'\s)]*/g)].map((found) => found[0])
      expect(art.length, path).toBeGreaterThan(0)
      for (const url of art) expect(url, path).toMatch(/^\/assets\/blackhole\.webp\?v=[0-9a-f]{8}$/)
    }
    // 管理画面（壁の中と外）は app.css のあとに admin.css
    const signed = await signIn()
    for (const [label, html] of [
      ['壁の中', await (await signed('/admin/items')).text()],
      ['ログイン', await okText('/admin/login')],
    ] as const) {
      const links = sheets(html)
      expect(
        links.map((href) => href?.replace(/\?.*/, '')),
        label,
      ).toEqual(['/app.css', '/admin.css'])
      for (const href of links) expect(href, label).toMatch(version)
    }
  })
})
