import { env } from 'cloudflare:test'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { MEDIA_QUOTA_BYTES } from '../src/lib/media-usage'
import { MAX_FORM_BYTES } from '../src/routes/admin/request'
import { db, form, get, okText, resetDb, seedItem, signIn, touch } from './helpers'
import { file, gif, mp4, padded, png } from './images'

/*
  管理画面から上げる画像と動画の上限（種類ごとの1枚の上限・1回の送信の上限・全体の容量）と、
  動画（MP4。作品のほかの画像の欄だけ）の受け取りと配り方。
  - 1枚の上限: 静止画 1MB・GIF 3MB・動画 10MB（src/routes/admin/images.ts）
  - 1回の送信: 24MB（src/routes/admin/request.ts の readAdminForm。Worker のメモリに収める）
  - 全体: 300MB（src/lib/media-usage.ts。外した画像の控えは数えない）
*/

const PREFIXES = ['avatars/', 'items/', 'archive/']

const mediaKeys = async (prefix = 'items/') =>
  (await env.MEDIA.list({ prefix })).keys.map((key) => key.name).sort()

// KV は resetDb が触らない（D1 だけ）。前のテストが置いたものを数えないよう、置き場を空にする
beforeEach(async () => {
  await resetDb()
  for (const prefix of PREFIXES) {
    for (const key of await mediaKeys(prefix)) await env.MEDIA.delete(key)
  }
})

const withFiles = (values: Record<string, string | string[]>, files: [string, File][]) => {
  const body = form(values)
  for (const [name, one] of files) body.append(name, one)
  return body
}

const mp4File = (bytes = mp4(), name = 'demo.mp4') => file(bytes, name, 'video/mp4')

const shotsOf = (itemId: number) =>
  db()
    .select()
    .from(schema.itemShots)
    .where(eq(schema.itemShots.itemId, itemId))
    .orderBy(asc(schema.itemShots.sortOrder), asc(schema.itemShots.id))

// 公開する作品に、ほかの画像の欄から足す（画像1枚と動画1本の組がふつうの形）
const postShots = async (files: [string, File][], alts: string[]) => {
  const signed = await signIn()
  return signed('/admin/items', {
    method: 'POST',
    body: withFiles(
      {
        type: 'app',
        title: 'Demo',
        slug: 'demo',
        summary: '動画で動きを見せるアプリ。',
        newShotAlt: alts,
        published: '1',
      },
      files,
    ),
  })
}

describe('動画を上げる', () => {
  it('ほかの画像の欄に MP4 を上げると items/ に置き、作品のページで押して再生する', async () => {
    const response = await postShots(
      [
        ['newShot', file(png(), 'a.png', 'image/png')],
        ['newShot', mp4File(mp4({ width: 1920, height: 1080, turned: true }))],
      ],
      ['設定の画面', '音量を分ける操作'],
    )
    expect(response.status).toBe(303)

    const [row] = await db().select().from(schema.items)
    const shots = await shotsOf(row?.id ?? 0)
    const video = shots[1]
    expect(video?.url).toMatch(/^\/images\/items\/demo-[0-9a-f]{8}\.mp4$/)
    // 寸法は表示の向き（縦の動画）
    expect([video?.width, video?.height]).toEqual([1080, 1920])

    // KV には種類と大きさを添える（容量は一覧の metadata だけで数える）
    const stored = await env.MEDIA.getWithMetadata<{ contentType: string; size: number }>(
      (video?.url ?? '').replace('/images/', ''),
      'arrayBuffer',
    )
    expect(stored.metadata).toEqual({ contentType: 'video/mp4', size: mp4().byteLength })

    const html = await okText('/apps/item/demo')
    const gallery = html.slice(html.indexOf('<section class="gallery"'))
    // 自動では動かさない（autoplay も loop も無い）。最初の絵を出す #t=0.1
    expect(gallery).toContain(
      `<video src="${video?.url}#t=0.1" controls="" muted="" playsinline="" preload="metadata" width="1080" height="1920" aria-label="動画2「音量を分ける操作」"></video>`,
    )
    expect(gallery).not.toMatch(/autoplay|loop/)
    // 動画はリンクで包まない（覆いが再生の手を塞ぐ）。原寸の手は画像だけ
    expect(gallery).not.toContain(`href="${video?.url}"`)
    expect(gallery.match(/Full size ↗/g)).toHaveLength(1)

    // 共有カードと構造化データの画像は絵だけ
    expect(html).not.toMatch(/og:image" content="[^"]*\.mp4/)
    const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1] ?? ''
    expect(jsonLd).toContain('.png')
    expect(jsonLd).not.toContain('.mp4')
  })

  it('ほかの画像の先頭が動画でも、共有カードは次の絵を使う', async () => {
    await postShots(
      [
        ['newShot', mp4File()],
        ['newShot', file(png(1600, 900), 'b.png', 'image/png')],
      ],
      ['動く画面', '止まった画面'],
    )
    const html = await okText('/apps/item/demo')
    expect(html).toMatch(
      /<meta property="og:image" content="https:\/\/[^"]+\/images\/items\/demo-[0-9a-f]{8}\.png"/,
    )
  })

  it('動画はメインの画像・アイコン・アバターの欄では受けない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withFiles({ type: 'app', title: 'Demo', slug: 'demo' }, [['image', mp4File()]]),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('の画像を選んでください')
    expect(await mediaKeys()).toEqual([])
  })

  it('MOV と HEVC は理由を言って弾き、何も置かない', async () => {
    for (const [bytes, reason] of [
      [mp4({ brand: 'qt  ' }), 'MOV（QuickTime）の動画は受け付けません'],
      [mp4({ codec: 'hvc1' }), 'HEVC（H.265）の動画は Chrome などで再生できません'],
    ] as const) {
      const response = await postShots([['newShot', mp4File(bytes)]], ['動く画面'])
      expect(response.status).toBe(400)
      expect(await response.text()).toContain(reason)
    }
    expect(await mediaKeys()).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('まだ保存していない動画は、プレビューの応答に埋めない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/preview/items', {
      method: 'POST',
      body: withFiles(
        { type: 'app', title: 'Demo', slug: 'demo', newShotAlt: ['動く画面', '止まった画面'] },
        [
          ['newShot', mp4File()],
          ['newShot', file(png(), 'b.png', 'image/png')],
        ],
      ),
    })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).not.toContain('data:video')
    expect(html).toContain('選んだ動画は、保存したあとで再生できます')
    // 絵はこれまでどおり応答の中に閉じ込める
    expect(html).toContain('data:image/png;base64,')
    expect(await mediaKeys()).toEqual([])
  })
})

describe('1枚の上限は種類ごと', () => {
  it('静止画は 1MB、GIF は 3MB まで', async () => {
    const signed = await signIn()
    const send = (image: File) =>
      signed('/admin/items', {
        method: 'POST',
        body: withFiles({ type: 'app', title: 'Demo', slug: 'demo' }, [['image', image]]),
      })

    const big = await send(file(padded(png(), 1_200_000), 'big.png', 'image/png'))
    expect(big.status).toBe(400)
    expect(await big.text()).toContain('画像は 1MB まで（GIF は 3MB まで）です')

    const bigGif = await send(file(padded(gif(), 3_100_000), 'big.gif', 'image/gif'))
    expect(bigGif.status).toBe(400)
    expect(await bigGif.text()).toContain('画像は 1MB まで（GIF は 3MB まで）です')
    expect(await mediaKeys()).toEqual([])

    // 1MB を超えても GIF なら 3MB まで通る
    expect((await send(file(padded(gif(), 2_500_000), 'ok.gif', 'image/gif'))).status).toBe(303)
    expect(await mediaKeys()).toHaveLength(1)
  })

  it('動画は 10MB まで', async () => {
    const response = await postShots(
      [['newShot', mp4File(padded(mp4(), 10_500_000))]],
      ['長い動画'],
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('動画は 10MB までです')
    expect(await mediaKeys()).toEqual([])
  })

  it('1回の送信は合計 24MB まで。読む前に止める', async () => {
    const response = await postShots(
      [
        ['newShot', mp4File(padded(mp4(), 9_000_000))],
        ['newShot', mp4File(padded(mp4(), 9_000_000))],
        ['newShot', mp4File(padded(mp4(), 9_000_000))],
      ],
      ['1本目', '2本目', '3本目'],
    )
    expect(MAX_FORM_BYTES).toBe(24_000_000)
    expect(response.status).toBe(413)
    expect(await response.text()).toContain('合計 24MB まで')
    expect(await mediaKeys()).toEqual([])
  })
})

describe('全体の容量', () => {
  it('上限を超える保存は止め、何も置かない。外した画像の控えは数えない', async () => {
    // 上限の手前まで使っている（大きさは metadata の size で数える）
    await env.MEDIA.put('items/old-aaaa1111.png', 'x', {
      metadata: { contentType: 'image/png', size: MEDIA_QUOTA_BYTES - 1_000 },
    })
    // 控えはどれだけあっても数えない
    await env.MEDIA.put('archive/items/gone-bbbb2222.png', 'x', {
      metadata: { contentType: 'image/png', size: 50_000_000 },
    })
    const response = await postShots(
      [['newShot', file(padded(png(), 200_000), 'a.png', 'image/png')]],
      ['設定の画面'],
    )
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('画像と動画の容量の上限（300.0MB）を超えます')
    expect(await mediaKeys()).toEqual(['items/old-aaaa1111.png'])

    // 収まる大きさなら通る
    const small = await postShots([['newShot', file(png(), 'b.png', 'image/png')]], ['設定の画面'])
    expect(small.status).toBe(303)
  })

  it('大きさを添える前に置いたものは、中身を読んで数える', async () => {
    await env.MEDIA.put('items/legacy-cccc3333.png', new Uint8Array(MEDIA_QUOTA_BYTES / 1000), {
      metadata: { contentType: 'image/png' },
    })
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('画像と動画の容量')
    expect(html).toContain('<strong>0.3MB</strong> / 300.0MB')
  })

  it('概要に使っている容量と、数えない控えを出す', async () => {
    await env.MEDIA.put('items/a-dddd4444.png', 'x', {
      metadata: { contentType: 'image/png', size: 120_000_000 },
    })
    await env.MEDIA.put('avatars/b-eeee5555.png', 'x', {
      metadata: { contentType: 'image/png', size: 3_000_000 },
    })
    await env.MEDIA.put('archive/items/c-ffff6666.png', 'x', {
      metadata: { contentType: 'image/png', size: 7_500_000 },
    })
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('<strong>123.0MB</strong> / 300.0MB（41%）')
    expect(html).toContain('外した画像の控えが 7.5MB')
    expect(html).not.toContain('残りわずか')
  })
})

describe('動画を配る', () => {
  const key = 'items/clip-0123abcd.mp4'
  const bytes = mp4()

  beforeEach(async () => {
    await env.MEDIA.put(key, bytes, { metadata: { contentType: 'video/mp4', size: bytes.length } })
  })

  it('範囲の要求に 206 で答える（iPhone の Safari は範囲で取れない動画を再生しない）', async () => {
    const whole = await get(`/images/${key}`)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('video/mp4')
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(whole.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect((await whole.arrayBuffer()).byteLength).toBe(bytes.length)

    const head = await get(`/images/${key}`, { headers: { range: 'bytes=0-7' } })
    expect(head.status).toBe(206)
    expect(head.headers.get('content-range')).toBe(`bytes 0-7/${bytes.length}`)
    expect(head.headers.get('content-type')).toBe('video/mp4')
    expect(head.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await head.arrayBuffer())).toEqual(bytes.subarray(0, 8))

    const tail = await get(`/images/${key}`, { headers: { range: 'bytes=-4' } })
    expect(tail.status).toBe(206)
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.subarray(bytes.length - 4))

    const outside = await get(`/images/${key}`, { headers: { range: `bytes=${bytes.length}-` } })
    expect(outside.status).toBe(416)
    expect(outside.headers.get('content-range')).toBe(`bytes */${bytes.length}`)
  })

  it('管理画面のほかの画像の行は、動画の見本を最初の絵で出す', async () => {
    const item = await seedItem({ slug: 'clip' })
    await db()
      .insert(schema.itemShots)
      .values({ itemId: item.id, url: `/images/${key}`, alt: '動く画面', sortOrder: 10 })
    await touch()
    const signed = await signIn()
    const html = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(html).toContain(`<video class="shot-row__image" src="/images/${key}#t=0.1"`)
    expect(html).not.toContain(`<img class="shot-row__image" src="/images/${key}"`)
    // 足す欄は動画も選べる
    expect(html).toMatch(/name="newShot" accept="[^"]*video\/mp4"/)
    // 一覧の見本に動画を <img> で出さない
    const list = await (await signed('/admin/items')).text()
    expect(list).not.toContain(`src="/images/${key}"`)
  })
})
