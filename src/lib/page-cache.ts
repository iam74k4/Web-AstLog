import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env'
import { SESSION_COOKIE } from './auth'

/*
  公開ページの写し（Cache API）。

  公開ページは1画面が1つの URL で、スクロール1回ぶんがフルページ遷移1回に
  なる。写しが無いと、めくるたびに単一リージョンの D1 へ1〜3往復し、D1 が
  落ちている間は入口も作品の一覧も全部 500 になっていた。ここでは、
  訪問者（セッションのクッキーを持たない GET）の応答だけを、そのデータセンターの
  caches.default に置く。

  **写しの正しさは「内容の版」で決める。** 版は KV（MEDIA）の `site:version`
  の1行で、管理画面の書き込み（認証の壁の内側の POST。touchSiteOnWrite）が
  そのたびに新しい値にする。写しは置いたときの版を持っていて、いまの版と
  違えば使わない。
  - 版の読みは KV のエッジのキャッシュ（cacheTtl 60秒）を通す。だから保存から
    **最大 60 秒ほど**、ほかのデータセンターの訪問者には前の画面が出る。
    ログインしている人はクッキーで写しを通らないので、直した本人にはすぐ見える
  - 管理画面を通らない書き換え（D1 を手で直す・seed を流す）は版を上げない。
    そのときは `npm run site:touch`（ローカルは db:seed:local が自分で上げる）。
    上げ忘れても、写しは FRESH_MS（1時間）で古くなって引き直される
  - 写しの鍵には Worker の版（version_metadata の id）も入れる。デプロイで
    マークアップや src/site.ts の文言が変わった日に、前のコードの写しを出さない

  **D1 が例外を投げたら、写しで持ちこたえる**（stale-if-error）。ただし出すのは
  **写しの版がいまの版と同じとき**だけ（1時間を過ぎていてもよい。KEEP_SECONDS＝7日
  までは残してある）。中身が変わっていない画面は、D1 が落ちていても前の姿で出る。
  版が変わった写し——管理画面で何かを書いたあとの写し——は、障害の間も出さない
  （500 のまま）。以前は版を問わずに出していたので、誤って載せた作品を下書きに
  戻した・消したあとでも、その間に誰も開いていない URL の写しが D1 の障害のたびに
  200 で戻ってきた（取り下げが巻き戻る）。書き込みのあとの写しを出さないのは、
  どの書き込みが取り下げかを写しの側では見分けられないため。
  - 版（KV）が読めないときも出さない。写しがいまのものかを確かめられないので
  - 版の読みは KV のエッジのキャッシュ（60秒）を通すので、書き込みから 60 秒ほどは、
    そのデータセンターでは前の版がいまの版に見える（写しの hit と同じ遅れ）
  - 写しを確実に全部外すのはデプロイ（鍵に Worker の版が入っている）

  写しを通らないもの:
  - セッションのクッキーを持つ要求（有効かどうかは問わない）。ログインしている人の
    画面には管理画面への入口が出る（adminHref）ので、その写しを置くと次の訪問者に
    入口が出る。クッキーの有無だけで分けるのは、ここで D1 に聞かないため
  - GET 以外、/admin、/images/*（自分の cache-control を持つ KV の配り口）、
    /robots.txt（D1 を引かない固定の文）、最後の語に「.」を含む URL
    （/sitemap.xml を除く。画面の URL に「.」は無く、/wp-login.php や /.env の
    ような探し回る要求のために KV を読まない）
  - 応答が set-cookie を持つもの、cache-control に private か no-store を持つもの
    （ログイン中の private, no-store）、200・301・302・404 以外のもの（303 は D1 を
    引かない URL の読み替え、500 は失敗）

  応答が自分の cache-control を持っていれば（行き先がデータで変わる転送の no-cache。
  src/routes/public/page.tsx の movedTo）、写しから返すときもそれを付け直す。
  写しの側の cache-control（Cache API に置いておく長さ）は訪問者に渡さない。

  404 も持つのは、形の合う名前（/members/<slug> など）を探し回る要求が、
  写しがあれば D1 を引かずに済むから。形の合わない名前は、写しより前に
  ルートが D1 を引かずに 404 にしている（src/routes/public/routes.ts の SCREEN_NAME）。
*/

export const SITE_VERSION_KEY = 'site:version'

// 写しを「いまのもの」として出してよい長さ。版を上げない書き換えの上限にもなる
const FRESH_MS = 60 * 60 * 1000
// 写しを残しておく長さ（stale-if-error で出せる古さの上限）。Cache API の期限
const KEEP_SECONDS = 7 * 86_400
// 版の読みを KV のエッジに持たせる長さ。保存から訪問者に見えるまでの遅れの上限
const VERSION_TTL_SECONDS = 60

const CACHEABLE = new Set([200, 301, 302, 404])

// 写しに付けて置く印（訪問者に返すときは外す）
const VERSION_HEADER = 'x-noctifex-version'
const STORED_HEADER = 'x-noctifex-stored'
// 応答がもともと持っていた cache-control（返すときに付け直す）
const ORIGINAL_CACHE_CONTROL = 'x-noctifex-cache-control'
// 訪問者に返す、写しをどう使ったか（hit / miss / stale）。テストと調べもの用
export const CACHE_STATE_HEADER = 'x-noctifex-cache'

const passesBy = (path: string) =>
  path === '/admin' ||
  path.startsWith('/admin/') ||
  path.startsWith('/images/') ||
  path === '/robots.txt' ||
  (path !== '/sitemap.xml' && /\.[^/]*$/.test(path))

async function siteVersion(kv: KVNamespace): Promise<string | null> {
  try {
    // 一度も書いていない KV（デプロイしたての本番）でも写しは持てる
    return (await kv.get(SITE_VERSION_KEY, { cacheTtl: VERSION_TTL_SECONDS })) ?? 'initial'
  } catch (error) {
    // 版が読めなければ、写しが正しいかを決められない。写しは出さず、置かない
    console.error('site:version を読めませんでした', error)
    return null
  }
}

/*
  内容の版を上げる。書き込みそのものは済んでいるので、ここで失敗しても
  保存は失敗にしない（写しが FRESH_MS で古くなるのを待つだけ）。
*/
export async function touchSite(kv: KVNamespace): Promise<void> {
  try {
    await kv.put(SITE_VERSION_KEY, crypto.randomUUID())
  } catch (error) {
    console.error('site:version を上げられませんでした', error)
  }
}

const served = (copy: Response, state: 'hit' | 'stale') => {
  const response = new Response(copy.body, copy)
  const own = copy.headers.get(ORIGINAL_CACHE_CONTROL)
  for (const name of [
    VERSION_HEADER,
    STORED_HEADER,
    ORIGINAL_CACHE_CONTROL,
    'cache-control',
    'age',
    'cf-cache-status',
  ]) {
    response.headers.delete(name)
  }
  if (own) response.headers.set('cache-control', own)
  response.headers.set(CACHE_STATE_HEADER, state)
  return response
}

// 写しにしてはいけない応答（その人だけのもの・どこにも置いてはいけないもの）
const personal = (response: Response) =>
  /\b(?:private|no-store)\b/i.test(response.headers.get('cache-control') ?? '')

const isFresh = (copy: Response, version: string) =>
  copy.headers.get(VERSION_HEADER) === version &&
  Date.now() - Number(copy.headers.get(STORED_HEADER)) < FRESH_MS

export const pageCache = createMiddleware<AppEnv>(async (c, next) => {
  if (
    c.req.method !== 'GET' ||
    passesBy(c.req.path) ||
    getCookie(c, SESSION_COOKIE) !== undefined
  ) {
    return next()
  }

  const url = new URL(c.req.url)
  const deploy = c.env.CF_VERSION_METADATA?.id ?? 'local'
  // 鍵は URL（query 込み）と Worker の版。内容の版は写しの中に持つ（古い版の写しを
  // stale-if-error で探せるように、鍵には入れない）
  const key = new Request(`${url.origin}/__page-cache/${deploy}${url.pathname}${url.search}`)
  const cache = caches.default

  // 版は描く前に読む。描いたあとに読むと、描いている間の保存の版を古い中身に付けてしまう
  const [version, copy] = await Promise.all([
    siteVersion(c.env.MEDIA),
    cache.match(key).catch(() => undefined),
  ])
  if (copy && version !== null && isFresh(copy, version)) return served(copy, 'hit')

  await next()

  if (c.error) {
    // いまの版の写しだけ（上の注記）。版が読めなければ出さない
    if (copy && version !== null && copy.headers.get(VERSION_HEADER) === version) {
      c.res = served(copy, 'stale')
    }
    return
  }
  const response = c.res
  if (
    version === null ||
    !CACHEABLE.has(response.status) ||
    personal(response) ||
    response.headers.has('set-cookie')
  ) {
    return
  }

  const body = await response.arrayBuffer()
  const stored = new Response(body, response)
  const own = response.headers.get('cache-control')
  if (own) stored.headers.set(ORIGINAL_CACHE_CONTROL, own)
  stored.headers.set(VERSION_HEADER, version)
  stored.headers.set(STORED_HEADER, String(Date.now()))
  stored.headers.set('cache-control', `public, max-age=${KEEP_SECONDS}`)
  const fresh = new Response(body, response)
  fresh.headers.set(CACHE_STATE_HEADER, 'miss')
  c.res = fresh
  try {
    await cache.put(key, stored)
  } catch (error) {
    console.error('写しを置けませんでした', error)
  }
})

/*
  管理画面の書き込みで版を上げる。認証の壁（requireAuth）の内側に掛けるので、
  ログインしていない POST では上げない——上げられると、誰でも写しを無効にでき、
  KV の書き込みの枠も食われる。

  上げないのは 4xx だけ（検査で止めた保存は何も書いていない）。303 の成功は
  もちろん、途中で例外になった保存（D1 は書けたあとで KV の画像の片付けが
  落ちた、など）でも上げる——上げすぎは写しを1つ引き直すだけで、上げ忘れは
  訪問者に古い画面を出す。
*/
export const touchSiteOnWrite = createMiddleware<AppEnv>(async (c, next) => {
  await next()
  if (c.req.method !== 'POST') return
  if (!c.error && c.res.status >= 400 && c.res.status < 500) return
  await touchSite(c.env.MEDIA)
})
