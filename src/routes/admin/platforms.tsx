import { asc, count, eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { newToken } from '../../lib/auth'
import { str, toSlug } from '../../lib/format'
import { Confirm } from '../../ui/AdminForm'
import { AdminLayout } from '../../ui/AdminLayout'
import { TrashIcon } from '../../ui/icons'
import { db, flashFor, readSortOrder } from './request'

/*
  プラットフォームの選択肢（個人開発の作品の札。macOS・iOS …）を、管理画面で足す・直す・消す。

  選択肢は表（platforms）が正で、自由入力にしない（表記ゆれで札が揃わない）。以前は行を入れる口が
  移行にしか無く、選択肢に無い種類（VS Code の拡張など）の作品は、札を付けないまま公開するか、
  コードを直してデプロイするしかなかった。ここと、作品のフォームの「選択肢に無いとき」の欄
  （items.tsx。保存と一緒に足す）が書く口。

  key は作品が指す名前で、作ったら変えない（表示名は変えてよい）。消すと、その札の作品からは札が
  外れる（items.platform_key は ON DELETE SET NULL。作品は消えない）。
*/
export const platformRoutes = new Hono<AppEnv>()

// 表示名は一覧の行の札に出る。作品の区分の札と同じ列に並ぶ短い名前
export const PLATFORM_LABEL_MAX = 24

// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を弾くのがこの検査の目的
const CONTROL = /[\u0000-\u001f\u007f]/

export function platformLabelError(label: string): string | null {
  if (!label) return '表示名を入れてください'
  if (CONTROL.test(label)) return '改行や制御文字を含めないでください'
  if ([...label].length > PLATFORM_LABEL_MAX) return `${PLATFORM_LABEL_MAX} 字までにしてください`
  return null
}

// 同じ名前の選択肢（大文字と小文字・前後の空きの違いは同じ名前。「macOS」と「MacOS」を並べない）
export const samePlatform = (platforms: readonly schema.Platform[], label: string) =>
  platforms.find((one) => one.label.trim().toLowerCase() === label.trim().toLowerCase())

// 並びの最後に足す（10 刻み。間に入れやすい）
export const nextPlatformOrder = (platforms: readonly schema.Platform[]) =>
  Math.max(0, ...platforms.map((one) => one.sortOrder)) + 10

/*
  新しい選択肢の key。表示名から作る（「VS Code」→ vs-code）。英数字を1つも含まない名前は
  読めない代わりに重ならない名前にする。既にある key と重なったら番号を足す
*/
export function platformKeyFor(label: string, platforms: readonly schema.Platform[]): string {
  const base = toSlug(label) || `platform-${newToken(3)}`
  const taken = new Set(platforms.map((one) => one.key))
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
  return key
}

const PLATFORM_KEY = /^[a-z0-9][a-z0-9-]{0,80}$/

const listPlatforms = (database: ReturnType<typeof db>) =>
  database.query.platforms.findMany({
    orderBy: [asc(schema.platforms.sortOrder), asc(schema.platforms.key)],
  })

// その選択肢を使っている作品の数（下書きも数える。消すと札が外れる相手）
async function usage(database: ReturnType<typeof db>): Promise<Map<string, number>> {
  const rows = await database
    .select({ key: schema.items.platformKey, total: count() })
    .from(schema.items)
    .groupBy(schema.items.platformKey)
  return new Map(rows.flatMap((row) => (row.key ? [[row.key, row.total] as const] : [])))
}

type Typed = { label: string; sortOrder: string }

/*
  1画面で全部を直す。行ごとに小さなフォーム（表示名・並び順・保存）を持ち、追加は下の枠。
  弾いたときは、その行（か追加の枠）に打った字を残して同じ画面を描き直す
*/
async function page(
  c: Context<AppEnv>,
  failed?: { key: string | null; typed: Typed; error: Record<string, string> },
) {
  const database = db(c)
  const [platforms, used] = await Promise.all([listPlatforms(database), usage(database)])
  const errorOf = (key: string | null, field: 'label' | 'sortOrder') =>
    failed && failed.key === key ? failed.error[field] : undefined
  const typedOf = (key: string | null) => (failed && failed.key === key ? failed.typed : null)
  const fresh = typedOf(null)
  return c.html(
    <AdminLayout
      title="プラットフォーム"
      active="items"
      account={c.get('account')}
      errors={failed?.error}
      flash={
        c.req.query('added')
          ? '選択肢を足しました'
          : flashFor(c, '選択肢を消しました。使っていた作品からは札が外れました')
      }
    >
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">作品 / プラットフォーム</span>
          <h1>プラットフォーム</h1>
        </div>
        <div class="admin-head__actions">
          <a class="btn btn--ghost" href="/admin/items">
            作品の一覧へ
          </a>
        </div>
      </div>
      <p class="form-note">
        個人開発の作品に付ける札の選択肢です（一覧の行と作品のページに出ます）。作品のフォームには、並び順の小さい順に並びます。
        表示名を直すと、その札の作品すべてに反映されます。
      </p>

      {platforms.length === 0 ? (
        <div class="empty-state">
          <p>選択肢はまだありません</p>
        </div>
      ) : (
        <ul class="rows">
          {platforms.map((platform) => {
            const typed = typedOf(platform.key)
            const total = used.get(platform.key) ?? 0
            return (
              <li class="row row--option" key={platform.key} id={`platform-${platform.key}`}>
                <form method="post" action={`/admin/platforms/${platform.key}`} class="option">
                  <label class="field">
                    <span class="field__label">表示名</span>
                    <input
                      class={errorOf(platform.key, 'label') ? 'input input--error' : 'input'}
                      name="label"
                      value={typed?.label ?? platform.label}
                      maxlength={PLATFORM_LABEL_MAX}
                      required
                      aria-label={`${platform.label} の表示名`}
                    />
                    {errorOf(platform.key, 'label') ? (
                      <span class="field__error" id="field-label-error">
                        {errorOf(platform.key, 'label')}
                      </span>
                    ) : null}
                  </label>
                  <label class="field option__order">
                    <span class="field__label">並び順</span>
                    <input
                      class={errorOf(platform.key, 'sortOrder') ? 'input input--error' : 'input'}
                      name="sortOrder"
                      inputmode="numeric"
                      value={typed?.sortOrder ?? String(platform.sortOrder)}
                      aria-label={`${platform.label} の並び順`}
                    />
                    {errorOf(platform.key, 'sortOrder') ? (
                      <span class="field__error" id="field-sortOrder-error">
                        {errorOf(platform.key, 'sortOrder')}
                      </span>
                    ) : null}
                  </label>
                  <button class="btn btn--ghost" type="submit">
                    保存
                  </button>
                </form>
                <span class="row__col">{total ? `${total} 件の作品が使用中` : '未使用'}</span>
                <span class="row__actions">
                  <a
                    class="icon-btn icon-btn--danger"
                    href={`/admin/platforms/${platform.key}/delete`}
                    aria-label={`${platform.label} を消す`}
                  >
                    <TrashIcon />
                    <span class="icon-btn__text">消す</span>
                  </a>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <section class="catalog" aria-labelledby="platform-add-title">
        <h2 class="catalog__title" id="platform-add-title">
          足す
        </h2>
        <form method="post" action="/admin/platforms" class="option">
          <label class="field">
            <span class="field__label">表示名</span>
            <input
              class={errorOf(null, 'label') ? 'input input--error' : 'input'}
              name="label"
              value={fresh?.label ?? ''}
              maxlength={PLATFORM_LABEL_MAX}
              placeholder="例: VS Code"
              required
            />
            {errorOf(null, 'label') ? (
              <span class="field__error" id="field-label-error">
                {errorOf(null, 'label')}
              </span>
            ) : null}
          </label>
          <label class="field option__order">
            <span class="field__label">並び順</span>
            <input
              class={errorOf(null, 'sortOrder') ? 'input input--error' : 'input'}
              name="sortOrder"
              inputmode="numeric"
              value={fresh?.sortOrder ?? String(nextPlatformOrder(platforms))}
            />
            {errorOf(null, 'sortOrder') ? (
              <span class="field__error" id="field-sortOrder-error">
                {errorOf(null, 'sortOrder')}
              </span>
            ) : null}
          </label>
          <button class="btn btn--primary" type="submit">
            足す
          </button>
        </form>
      </section>
    </AdminLayout>,
    failed ? 400 : 200,
  )
}

platformRoutes.get('/platforms', (c) => page(c))

platformRoutes.post('/platforms', async (c) => {
  const database = db(c)
  const form = await c.req.formData()
  const label = str(form.get('label'))
  const platforms = await listPlatforms(database)
  const order = readSortOrder(form, nextPlatformOrder(platforms))
  const typed = { label, sortOrder: order.text }
  const problem =
    platformLabelError(label) ??
    (samePlatform(platforms, label) ? '同じ名前の選択肢がもうあります' : null)
  const error = { ...(problem ? { label: problem } : {}), ...order.error }
  if (Object.keys(error).length) return page(c, { key: null, typed, error })
  const key = platformKeyFor(label, platforms)
  await database
    .insert(schema.platforms)
    .values({ key, label, sortOrder: order.value })
    .onConflictDoNothing()
  return c.redirect(`/admin/platforms?added=1#platform-${key}`, 303)
})

platformRoutes.post('/platforms/:key', async (c) => {
  const key = c.req.param('key')
  if (!PLATFORM_KEY.test(key)) return c.notFound()
  const database = db(c)
  const platforms = await listPlatforms(database)
  const current = platforms.find((one) => one.key === key)
  if (!current) return c.notFound()
  const form = await c.req.formData()
  const label = str(form.get('label'))
  const order = readSortOrder(form, current.sortOrder)
  const twin = samePlatform(platforms, label)
  const problem =
    platformLabelError(label) ??
    (twin && twin.key !== key ? '同じ名前の選択肢がもうあります' : null)
  const error = { ...(problem ? { label: problem } : {}), ...order.error }
  if (Object.keys(error).length) {
    return page(c, { key, typed: { label, sortOrder: order.text }, error })
  }
  await database
    .update(schema.platforms)
    .set({ label, sortOrder: order.value })
    .where(eq(schema.platforms.key, key))
  return c.redirect(`/admin/platforms?saved=1#platform-${key}`, 303)
})

platformRoutes.get('/platforms/:key/delete', async (c) => {
  const key = c.req.param('key')
  if (!PLATFORM_KEY.test(key)) return c.notFound()
  const database = db(c)
  const platform = await database.query.platforms.findFirst({
    where: eq(schema.platforms.key, key),
  })
  if (!platform) return c.notFound()
  const total = (await usage(database)).get(key) ?? 0
  return c.html(
    <AdminLayout title="選択肢を消す" active="items" account={c.get('account')}>
      <Confirm
        title={`選択肢「${platform.label}」を消しますか？`}
        detail={
          total
            ? `この札を付けている ${total} 件の作品から、札が外れます。作品そのものは消えません。`
            : 'この札を付けている作品はありません。'
        }
        action={`/admin/platforms/${key}/delete`}
        cancelHref="/admin/platforms"
        verb="消す"
      >
        {total ? <p>名前を直したいだけなら、一覧で表示名を書き換えて保存してください。</p> : null}
      </Confirm>
    </AdminLayout>,
  )
})

platformRoutes.post('/platforms/:key/delete', async (c) => {
  const key = c.req.param('key')
  if (!PLATFORM_KEY.test(key)) return c.notFound()
  // 作品の platform_key は外部キーの ON DELETE SET NULL で外れる
  await db(c).delete(schema.platforms).where(eq(schema.platforms.key, key))
  return c.redirect('/admin/platforms?deleted=1', 303)
})
