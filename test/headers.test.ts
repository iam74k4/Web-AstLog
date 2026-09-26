import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import assetHeaders from 'virtual:repo:public/_headers'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'
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

function expectPageHeaders(response: Response, label: string) {
  const csp = directives(response.headers.get('content-security-policy'))
  // JavaScript 0本を機械が守る。JSON-LD はデータの塊なのでこれで止まらない
  expect(csp['script-src'], label).toBe("'none'")
  expect(csp['default-src'], label).toBe("'self'")
  expect(csp['object-src'], label).toBe("'none'")
  expect(csp['base-uri'], label).toBe("'none'")
  expect(csp['form-action'], label).toBe("'self'")
  expect(csp['frame-ancestors'], label).toBe("'none'")
  // ファビコンは data: の SVG。列の数とアバターの寸法は style 属性で渡す
  expect(csp['img-src'], label).toBe("'self' data:")
  expect(csp['style-src'], label).toBe("'self' 'unsafe-inline'")
  expect(response.headers.get('x-content-type-options'), label).toBe('nosniff')
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
      new Request('https://noctifex.test/'),
      uncachedEnv({ DB: undefined as unknown as D1Database }),
      ctx,
    )
    await waitOnExecutionContext(ctx)
    expect(response.status).toBe(500)
    expectPageHeaders(response, '500')
  })

  it('公開ページの <script> は JSON-LD だけ（CSP の script-src が止めるものが無い）', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })
    for (const path of ['/', '/apps/item/appmixer', '/all', '/members/okazaki']) {
      const html = await okText(path)
      const scripts = html.match(/<script\b[^>]*>/g) ?? []
      for (const tag of scripts) expect(tag, path).toBe('<script type="application/ld+json">')
    }
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
      expectPageHeaders(response, path)
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

  it('静的なファイルのヘッダは public/_headers が持つ', () => {
    const rules = headerRules()
    expect([...rules.keys()][0]).toBe('/*')
    const values = rules.get('/*') ?? {}
    expect(values['x-content-type-options']).toBe('nosniff')
    expect(values['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(values['content-security-policy']).toBe("default-src 'none'; sandbox")
    // 規則の数には上限がある（Workers Static Assets は 100 まで）
    expect(rules.size).toBeLessThanOrEqual(100)
  })

  /*
    PERF-2。CSS は既定（public, max-age=0, must-revalidate）のまま配られ、画面を1枚
    めくるたびに描画を止めて条件付き GET を1往復していた。いまは中身から作った版を
    URL に付け（src/ui/components.tsx の Stylesheets）、_headers が1年・immutable で配る。
    長く持たせてよいのは版つきの URL で読まれるものだけ——版の無い素材（ロゴ・月）を
    immutable にすると、差し替えた絵が1年届かない
  */
  it('スタイルシートは版つきの URL で読み、1年・immutable で配る', async () => {
    const rules = headerRules()
    for (const path of ['/app.css', '/admin.css']) {
      expect(rules.get(path)?.['cache-control'], path).toBe('public, max-age=31536000, immutable')
    }
    const long = [...rules].filter(([, values]) => values['cache-control']?.includes('immutable'))
    expect(long.map(([path]) => path).sort()).toEqual(['/admin.css', '/app.css'])

    const version = /^\/(app|admin)\.css\?v=[0-9a-z]+$/
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
