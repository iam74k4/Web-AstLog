import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import assetSums from 'virtual:asset-sha256'
import assetFiles from 'virtual:assets'
import securityTxt from 'virtual:repo:public/.well-known/security.txt'
import assetHeaders from 'virtual:repo:public/_headers'
import { beforeEach, describe, expect, it } from 'vitest'
import appCss from '../public/app.css'
import app from '../src/index'
import { HSTS, OPENER_POLICY, PERMISSIONS_POLICY } from '../src/lib/headers'
import { ADMIN_BEHAVIOR, ADMIN_CSP } from '../src/ui/admin-behavior'
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

function expectPageHeaders(response: Response, label: string, admin = false) {
  const csp = directives(response.headers.get('content-security-policy'))
  // 公開ページはスクリプトを1本も許さない。管理画面だけが補助1本のハッシュを許す
  expect(csp['script-src'], label).toBe(admin ? `'${ADMIN_CSP}'` : "'none'")
  expect(csp['default-src'], label).toBe("'self'")
  expect(csp['object-src'], label).toBe("'none'")
  expect(csp['base-uri'], label).toBe("'none'")
  expect(csp['form-action'], label).toBe("'self'")
  expect(csp['frame-ancestors'], label).toBe("'none'")
  // 画像は同じオリジンだけ（favicon も public/assets のファイル）。アバターの寸法は style 属性で渡す
  expect(csp['img-src'], label).toBe("'self'")
  expect(csp['style-src'], label).toBe("'self' 'unsafe-inline'")
  expect(response.headers.get('x-content-type-options'), label).toBe('nosniff')
  /*
    no-referrer にしない。Chromium はそのページから出た同じオリジンの POST に
    Origin: null を付け、sameOrigin が 403 で弾く（管理画面の保存が全部止まる）
  */
  expect(response.headers.get('referrer-policy'), label).toBe('strict-origin-when-cross-origin')
  // ほかのサイトが開いた窓から、ログインの有無（枠の数）を数えさせない（src/lib/headers.ts）
  expect(response.headers.get('cross-origin-opener-policy'), label).toBe(OPENER_POLICY)
}

describe('応答のヘッダ', () => {
  it('公開ページ・全体ページ・404・robots・sitemap・リダイレクトのどれにも付く', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })
    for (const [path, status] of [
      ['/', 200],
      ['/projects', 200],
      ['/apps/item/appmixer', 200],
      ['/all', 200],
      ['/contact', 200],
      ['/robots.txt', 200],
      ['/sitemap.xml', 200],
      ['/apps', 301],
      ['/no-such-page', 404],
    ] as const) {
      const response = await get(path)
      expect(response.status, path).toBe(status)
      expectPageHeaders(response, path)
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

  it('公開ページは実行するスクリプトを持たない。script 要素は JSON-LD（データ）だけ', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })
    for (const path of ['/', '/apps/item/appmixer', '/all', '/members/okazaki']) {
      const html = await okText(path)
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      expect(
        scripts.filter((script) => script[1] !== ' type="application/ld+json"'),
        path,
      ).toEqual([])
    }
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
    expectPageHeaders(response, '管理', true)
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
      '/admin/site',
      '/admin/account',
    ]) {
      const response = await fetchAs(path)
      expect(response.status, path).toBe(200)
      expectPageHeaders(response, path, true)
      expect(response.headers.get('cache-control'), path).toBe('no-store')
    }
  })

  it('ログイン中の公開ページは private, no-store のまま（ミドルウェアが上書きしない）', async () => {
    const fetchAs = await signIn()
    const response = await fetchAs('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expectPageHeaders(response, '/')
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

  /*
    https を1年覚えさせ（HSTS）、ほかのサイトが開いた窓に手を出させず（COOP）、使わない
    端末の機能を止める（Permissions-Policy）。公開・管理画面・リダイレクト・404・画像の
    どれにも、同じ1本のミドルウェアが付ける
  */
  it('どの応答にも HSTS・COOP・Permissions-Policy を付ける', async () => {
    await seedItem()
    await env.MEDIA.put('items/shot-ab90.png', 'image-bytes', {
      metadata: { contentType: 'image/png' },
    })
    for (const [path, status] of [
      ['/', 200],
      ['/admin', 303],
      ['/admin/login', 200],
      ['/no-such-page', 404],
      ['/robots.txt', 200],
      ['/images/items/shot-ab90.png', 200],
    ] as const) {
      const response = await get(path)
      expect(response.status, path).toBe(status)
      expect(response.headers.get('strict-transport-security'), path).toBe(HSTS)
      expect(response.headers.get('permissions-policy'), path).toBe(PERMISSIONS_POLICY)
      expect(response.headers.get('cross-origin-opener-policy'), path).toBe(OPENER_POLICY)
    }
    // ログイン後の画面（プレビューの iframe を持つ）にも
    const signed = await signIn()
    expect((await signed('/admin/items')).headers.get('cross-origin-opener-policy')).toBe(
      OPENER_POLICY,
    )
    // 全画面（動画の操作の手）は止めない
    expect(PERMISSIONS_POLICY).not.toContain('fullscreen')
  })

  /*
    脆弱性を見つけた人の連絡先（RFC 9116。public/.well-known/security.txt）。Expires は必須で、
    切れた security.txt は古いものとして読まれる。切れる30日前からここが落ちる——1年先の日付に
    書き換えて出し直す
  */
  it('security.txt は連絡先と、30日より先の期限を持つ', () => {
    const fields = Object.fromEntries(
      securityTxt
        .split('\n')
        .filter((line) => line.includes(': '))
        .map((line) => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2)]),
    )
    expect(fields.Contact).toMatch(/^mailto:\S+@\S+$/)
    expect(fields.Canonical).toBe('https://astlog.dev/.well-known/security.txt')
    const expires = Date.parse(fields.Expires ?? '')
    const day = 86_400_000
    expect(expires - Date.now(), 'security.txt の Expires を1年先へ更新する').toBeGreaterThan(
      30 * day,
    )
    // RFC 9116 は1年より先にしないことを勧める
    expect(expires - Date.now()).toBeLessThan(366 * day)
  })

  it('静的なファイルのヘッダは public/_headers が持つ', () => {
    const rules = headerRules()
    expect([...rules.keys()][0]).toBe('/*')
    const values = rules.get('/*') ?? {}
    expect(values['x-content-type-options']).toBe('nosniff')
    expect(values['referrer-policy']).toBe('strict-origin-when-cross-origin')
    /*
      何も読み込ませない。ロゴの SVG（ワードマークと favicon）は輪郭の path と塗りだけで、
      ブラウザによっては <img> や favicon で使うときもこの CSP が効く
    */
    expect(values['content-security-policy']).toBe("default-src 'none'; sandbox")
    // HSTS・COOP・Permissions-Policy は Worker の応答と同じ値（静的なファイルだけ素で出さない）
    expect(values['strict-transport-security']).toBe(HSTS)
    expect(values['cross-origin-opener-policy']).toBe(OPENER_POLICY)
    expect(values['permissions-policy']).toBe(PERMISSIONS_POLICY)
    // 規則の数には上限がある（Workers Static Assets は 100 まで）
    expect(rules.size).toBeLessThanOrEqual(100)
  })

  /*
    PERF-2。CSS は既定（public, max-age=0, must-revalidate）のまま配られ、ページを
    移るたびに描画を止めて条件付き GET を1往復していた。いまは中身から作った版を
    URL に付け（src/ui/components.tsx の Stylesheets）、_headers が1年・immutable で配る。
    長く持たせてよいのは版つきの URL で読まれるものだけ——版の無い素材（ロゴの素材・共有カード）を
    immutable にすると、差し替えた絵が1年届かない
  */
  /*
    見出しの書体（Poppins）も1年・immutable。版の無い既定（毎回確かめる）のままだと、ページを
    移るたびに書体の条件付き GET が1往復し、戻りが新しいページの最初の描画に間に合わないと、
    上の帯の字が一瞬だけ代わりの書体で描かれてから差し替わった。版は中身の SHA-256 の頭8桁を
    名前に持つ——中身だけを差し替えて名前を変え忘れると、古い書体が1年残るので、ここで落とす
  */
  it('書体は中身の版を名前に持ち、1年・immutable で配る', () => {
    const rules = headerRules()
    const fonts = assetFiles.filter((file) => file.endsWith('.woff2'))
    expect(fonts).toHaveLength(4)
    for (const file of fonts) {
      const version = file.match(/^poppins-[1-9]00\.([0-9a-f]{8})\.woff2$/)?.[1]
      expect(version, file).toBeDefined()
      expect(assetSums[file]?.slice(0, 8), file).toBe(version)
      expect(rules.get(`/assets/${file}`)?.['cache-control'], file).toBe(
        'public, max-age=31536000, immutable',
      )
      // CSS の @font-face が同じ名前で読む（古い名前を指したまま残らない）
      expect(appCss, file).toContain(`url('/assets/${file}')`)
    }
  })

  it('スタイルシートは版つきの URL で読み、1年・immutable で配る', async () => {
    const rules = headerRules()
    // 1年持たせるのは版つきの URL で読むものだけ（版の無い素材に付けると、古い写しが1年残る）
    const cached = ['/app.css', '/admin.css', '/preview.css']
    for (const path of cached) {
      expect(rules.get(path)?.['cache-control'], path).toBe('public, max-age=31536000, immutable')
    }
    // ほかに1年持たせるのは、名前に版を持つ書体だけ（下の「書体」）
    const fonts = assetFiles
      .filter((file) => file.endsWith('.woff2'))
      .map((file) => `/assets/${file}`)
    const long = [...rules].filter(([, values]) => values['cache-control']?.includes('immutable'))
    expect(long.map(([path]) => path).sort()).toEqual([...cached, ...fonts].sort())

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
      // 上の帯・見出し・作品名の Poppins（500・600・700）は CSS を読み終える前から取りに行く。
      // 取りに行く URL は CSS の @font-face と同じ（違うと、同じ書体を2度取る）
      for (const weight of [500, 600, 700]) {
        const font = appCss.match(new RegExp(`url\\('(/assets/poppins-${weight}\\.[^']+)'\\)`))?.[1]
        expect(font, `${weight}`).toBeDefined()
        expect(html, `${path} ${weight}`).toContain(
          `<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin="anonymous"/>`,
        )
      }
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
