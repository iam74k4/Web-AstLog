import { Hono } from 'hono'
import type { AppEnv } from '../../env'
import { timeInJapan } from '../../lib/format'
import { isMediaType } from '../../lib/image'
import { MEDIA_ARCHIVE_PREFIX, MEDIA_RETENTION_SECONDS } from '../../lib/media-retention'
import { megabytes } from '../../lib/media-usage'
import { AdminLayout } from '../../ui/AdminLayout'

/*
  外した画像の控え（KV の archive/。src/lib/media-retention.ts）を、管理画面から見て取り出す。

  作品やメンバーから外した・差し替えた・一緒に消した画像は、公開の置き場から消す前に控えへ移し、
  90日持つ。削除の確認もそう言うのに、取り出す口が管理画面に無く、
  戻すには wrangler で KV を直に読むしかなかった。ここで一覧して保存し、編集画面で選び直す
  ——どの作品のどの欄へ戻すかは人が決める（消した作品は行ごと無いので、自動では戻せない）。

  控えは公開の /images/* からは読めない（キーの形で弾く。src/routes/public/images.ts）。
  ここは認証の壁の内側で、同じキーの形だけを通す。
*/
export const mediaRoutes = new Hono<AppEnv>()

// 控えのキー。公開の置き場のキー（images.ts の IMAGE_KEY）の頭に archive/ を付けた形だけ
const ARCHIVE_KEY = /^archive\/(avatars|items)\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/

const PLACE_LABEL = { avatars: 'アバター', items: '作品の画像' } as const

type ArchiveMeta = { contentType?: string; size?: number; archivedAt?: string }

type Archived = {
  place: keyof typeof PLACE_LABEL
  name: string
  type: string | undefined
  size: number | undefined
  archivedAt: string | undefined
  // 消える時刻（KV の期限。秒）
  expiration: number | undefined
}

async function listArchive(kv: KVNamespace): Promise<Archived[]> {
  const found: Archived[] = []
  let cursor: string | undefined
  do {
    const page = await kv.list<ArchiveMeta>({ prefix: MEDIA_ARCHIVE_PREFIX, cursor })
    for (const key of page.keys) {
      const parts = key.name.match(ARCHIVE_KEY)
      if (!parts) continue
      found.push({
        place: parts[1] as Archived['place'],
        name: parts[2] ?? '',
        type: key.metadata?.contentType,
        size: key.metadata?.size,
        archivedAt: key.metadata?.archivedAt,
        expiration: key.expiration,
      })
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  // 外したのが新しい順（外した直後に探しに来る）
  return found.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
}

const fileHref = (one: Pick<Archived, 'place' | 'name'>) =>
  `/admin/media/file/${one.place}/${one.name}`

// 「2026-11-12」。日本の日付で言う（外した日・消える日）
const day = (iso: string | undefined) => (iso ? timeInJapan(iso).slice(0, 10) : '')

mediaRoutes.get('/media', async (c) => {
  const archived = await listArchive(c.env.MEDIA)
  const days = Math.round(MEDIA_RETENTION_SECONDS / 86_400)
  return c.html(
    <AdminLayout title="外した画像" active="dashboard" account={c.get('account')}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">概要 / 外した画像</span>
          <h1>外した画像</h1>
        </div>
      </div>
      <p class="form-note">
        作品やメンバーから外した・差し替えた・一緒に消した画像と動画の控えです。外してから{days}
        日で消えます。
        戻すときは、ここで保存してから、作品やプロフィールの編集画面で選び直してください。
      </p>
      {archived.length === 0 ? (
        <div class="empty-state">
          <p>外した画像の控えはありません</p>
        </div>
      ) : (
        <ul class="rows">
          {archived.map((one) => {
            const image = isMediaType(one.type) && one.type.startsWith('image/')
            return (
              <li class="row row--project" key={`${one.place}/${one.name}`}>
                {image ? (
                  <img
                    class="row__thumb"
                    src={fileHref(one)}
                    alt=""
                    width={112}
                    height={70}
                    loading="lazy"
                  />
                ) : (
                  <span class="row__thumb row__thumb--empty" aria-hidden="true" />
                )}
                <span class="row__main">
                  <strong>{one.name}</strong>
                  <span class="row__sub">
                    {PLACE_LABEL[one.place]}
                    {one.type?.startsWith('video/') ? ' · 動画' : ''}
                    {typeof one.size === 'number' ? ` · ${megabytes(one.size)}` : ''}
                  </span>
                </span>
                {one.archivedAt ? (
                  <span class="row__col">{day(one.archivedAt)} に外した</span>
                ) : null}
                {one.expiration ? (
                  <span class="row__col">
                    {day(new Date(one.expiration * 1000).toISOString())} に消える
                  </span>
                ) : null}
                <span class="row__actions">
                  <a
                    class="icon-btn"
                    href={`${fileHref(one)}?download=1`}
                    aria-label={`${one.name} を保存する`}
                  >
                    <span class="icon-btn__text">保存する</span>
                  </a>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </AdminLayout>,
  )
})

/*
  控えの中身。一覧の見本（<img>）と、保存（?download=1 で添付として返す）。公開の /images/* と
  同じ守りを付ける——nosniff、文書として開かれても何も走らない CSP、画像と動画の許可リストに
  無い種類は添付の application/octet-stream。写しは持たせない（認証の壁の内側）
*/
mediaRoutes.get('/media/file/:place/:name', async (c) => {
  const key = `${MEDIA_ARCHIVE_PREFIX}${c.req.param('place')}/${c.req.param('name')}`
  const parts = key.match(ARCHIVE_KEY)
  if (!parts) return c.notFound()
  const object = await c.env.MEDIA.getWithMetadata<ArchiveMeta>(key, 'arrayBuffer')
  if (!object.value) return c.notFound()
  const type = object.metadata?.contentType
  const known = isMediaType(type)
  const attach = !known || c.req.query('download') === '1'
  return new Response(object.value, {
    headers: {
      'content-type': known ? type : 'application/octet-stream',
      // 名前はこちらが付けた形（英数字と . _ -）だけなので、そのまま載せてよい
      ...(attach ? { 'content-disposition': `attachment; filename="${parts[2]}"` } : {}),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    },
  })
})
