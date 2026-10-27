import { env } from 'cloudflare:test'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { sniffImage } from '../src/lib/image'
import { MEDIA_QUOTA_BYTES } from '../src/lib/media-usage'
import { MAX_FORM_BYTES } from '../src/routes/admin/request'
import { db, form, get, okText, resetDb, seedItem, signIn, touch } from './helpers'
import {
  androidLocation,
  appleLocation,
  avifWithMetadata,
  file,
  gif,
  mp4,
  PLACE,
  padded,
  photoJpeg,
  photoPng,
  photoWebp,
  png,
} from './images'

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
    expect(video?.url).toMatch(/^\/images\/items\/demo-[0-9a-f]{32}\.mp4$/)
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
      /<meta property="og:image" content="https:\/\/[^"]+\/images\/items\/demo-[0-9a-f]{32}\.png"/,
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

  it('Mac の画面収録の MOV（H.264）は MP4 として置き、作品のページで動画として描く', async () => {
    const mov = mp4({ brand: 'qt  ' })
    const response = await postShots(
      [['newShot', file(mov, '画面収録 2026-10-13.mov', 'video/quicktime')]],
      ['設定を切り替える動き'],
    )
    expect(response.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    const [shot] = await shotsOf(row?.id ?? 0)
    // 拡張子と content-type は判定の結果から（名乗りの video/quicktime は使わない）
    expect(shot?.url).toMatch(/^\/images\/items\/demo-[0-9a-f]{32}\.mp4$/)
    const key = (shot?.url ?? '').replace('/images/', '')
    const stored = await env.MEDIA.getWithMetadata<{ contentType: string }>(key, 'arrayBuffer')
    expect(stored.metadata?.contentType).toBe('video/mp4')
    expect(new Uint8Array(stored.value ?? new ArrayBuffer(0))).toEqual(mov)
    const served = await get(`/images/${key}`)
    expect(served.headers.get('content-type')).toBe('video/mp4')
    expect(await okText('/apps/item/demo')).toContain(`<video src="${shot?.url}#t=0.1"`)
  })

  it('HEVC は理由を言って弾き、何も置かない（MOV でも MP4 でも）', async () => {
    for (const bytes of [mp4({ codec: 'hvc1' }), mp4({ brand: 'qt  ', codec: 'hvc1' })]) {
      const response = await postShots([['newShot', mp4File(bytes)]], ['動く画面'])
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('HEVC（H.265）の動画は Chrome などで再生できません')
    }
    expect(await mediaKeys()).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('絵が保存していない動画1本だけでも、空の <img> を出さない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/preview/items', {
      method: 'POST',
      body: withFiles({ type: 'app', title: 'Demo', slug: 'demo', newShotAlt: ['動く画面'] }, [
        ['newShot', mp4File()],
      ]),
    })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<figure class="shot"><video controls="" muted=""')
    expect(html).not.toMatch(/<img src=""/)
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

  /*
    上限は名乗った長さ（Content-Length）で見るので、名乗らない送信（chunked）は読まずに断る。
    ブラウザのフォーム（ここのほかのテストの FormData も）は長さを名乗るので、そちらは通る
  */
  it('長さを名乗らないフォームの送信は、読まずに 411 で断る', async () => {
    const signed = await signIn()
    const encoder = new TextEncoder()
    for (const type of ['multipart/form-data; boundary=x', 'application/x-www-form-urlencoded']) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('--x--\r\n'))
          controller.close()
        },
      })
      const response = await signed('/admin/items', {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      })
      expect(response.status, type).toBe(411)
      expect(await response.text(), type).toContain('Content-Length')
    }
    expect(await db().select().from(schema.items)).toHaveLength(0)

    // 名乗る送信はこれまでどおり読む（作品が1件できる）
    const ok = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'Demo', slug: 'demo' }),
    })
    expect(ok.status).toBe(303)
    expect(await db().select().from(schema.items)).toHaveLength(1)
  })

  /*
    保存のルートは種類を見ずに formData を呼び、workerd は種類を断る前に本文を全部読む。
    フォームの種類でない本文（text/plain・重ねて送られて畳まれた種類）も、長さを名乗らなければ
    411、名乗れば 415 で、上限を越える本文を読み切る前に断る
  */
  it('フォームでない種類の本文も、上限を素通りさせずに読まずに断る', async () => {
    const signed = await signIn()
    const chunk = 1_000_000
    const chunks = Math.ceil(MAX_FORM_BYTES / chunk) + 2
    const folded = 'multipart/form-data, text/plain; boundary=x'
    for (const type of ['text/plain', folded, 'application/octet-stream']) {
      let pulled = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled >= chunks * chunk) return controller.close()
          pulled += chunk
          controller.enqueue(new Uint8Array(chunk))
        },
      })
      const chunked = await signed('/admin/items', {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      })
      expect(chunked.status, type).toBe(411)
      expect(pulled, type).toBeLessThan(MAX_FORM_BYTES)

      const sized = await signed('/admin/items', {
        method: 'POST',
        headers: { 'content-type': type },
        body: 'type=app&title=Demo&slug=demo',
      })
      expect(sized.status, type).toBe(415)
      expect(await sized.text(), type).toContain('フォームの送信')
    }
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })
})

/*
  写真の付け足し（撮った場所・日時・機種）は KV に置く前に外し、/images/* から配るのも外した
  あとのバイトだけ（src/lib/image-metadata.ts）。外せない AVIF と動画は、位置があれば断る
*/
describe('写真の付け足しを外して置く', () => {
  const latin1 = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

  it('JPEG・PNG・WebP の位置は、保存した中身にも配る中身にも残らない', async () => {
    const photos = {
      image: photoJpeg({ orientation: 6 }),
      icon: photoPng({ width: 512, height: 512 }),
      newShot: photoWebp(),
    }
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withFiles({ type: 'app', title: 'Demo', slug: 'demo', newShotAlt: '設定の画面' }, [
        ['image', file(photos.image, 'IMG_0001.jpg', 'image/jpeg')],
        ['icon', file(photos.icon, 'icon.png', 'image/png')],
        ['newShot', file(photos.newShot, 'shot.webp', 'image/webp')],
      ]),
    })
    expect(response.status).toBe(303)

    const [row] = await db().select().from(schema.items)
    const [shot] = await shotsOf(row?.id ?? 0)
    const urls = { image: row?.imageUrl, icon: row?.iconUrl, newShot: shot?.url }
    for (const [field, url] of Object.entries(urls)) {
      // 乱数は 16 バイト（16進 32 字）。当てられない長さにして、/images/* はこの形も通す
      expect(url, field).toMatch(/^\/images\/items\/demo-(?:icon-)?[0-9a-f]{32}\.(?:jpg|png|webp)$/)
      const key = (url ?? '').replace('/images/', '')
      const stored = await env.MEDIA.getWithMetadata<{ size: number }>(key, 'arrayBuffer')
      const served = await get(`/images/${key}`)
      expect(served.status, field).toBe(200)
      const bytes = new Uint8Array(await served.arrayBuffer())
      expect(bytes, field).toEqual(new Uint8Array(stored.value ?? new ArrayBuffer(0)))
      expect(stored.metadata?.size, field).toBe(bytes.length)
      for (const mark of [PLACE, 'GPSLatitude', 'MotionPhoto']) {
        expect(latin1(bytes), `${field}: ${mark}`).not.toContain(mark)
      }
      // 外したあとも同じ種類・同じ寸法として読める
      const original = sniffImage(photos[field as keyof typeof photos])
      expect(sniffImage(bytes), field).toEqual(original)
    }
    // 向き（6）は残すので、縦の写真の寸法は縦のまま
    expect([row?.imageWidth, row?.imageHeight]).toEqual([600, 800])
  })

  it('位置を持つ AVIF・MOV・MP4 は理由を言って断り、何も置かない', async () => {
    const signed = await signIn()
    const avifResponse = await signed('/admin/items', {
      method: 'POST',
      body: withFiles({ type: 'app', title: 'Demo', slug: 'demo' }, [
        ['image', file(avifWithMetadata(), 'photo.avif', 'image/avif')],
      ]),
    })
    expect(avifResponse.status).toBe(400)
    expect(await avifResponse.text()).toContain(
      '撮った場所（位置情報）が入っているので受け付けません',
    )

    for (const movie of [
      mp4({ brand: 'qt  ', extra: [appleLocation()] }),
      mp4({ extra: [androidLocation()] }),
    ]) {
      const response = await postShots([['newShot', mp4File(movie)]], ['動く画面'])
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('位置情報を外して書き出してから選び直してください')
    }
    expect(await mediaKeys()).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)
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
    // 数えるのは置く大きさ。PNG の後ろの詰め物は付け足しとして外れるので、そのまま置く GIF で量る
    const response = await postShots(
      [['newShot', file(padded(gif(), 200_000), 'a.gif', 'image/gif')]],
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
    // 足す欄は動画も選べる（MP4 と、Mac の画面収録の MOV）
    expect(html).toMatch(/name="newShot" accept="[^"]*video\/mp4,video\/quicktime"/)
    // 一覧の見本に動画を <img> で出さない
    const list = await (await signed('/admin/items')).text()
    expect(list).not.toContain(`src="/images/${key}"`)
  })
})

/*
  KV のキーの乱数は 16 バイト（16進 32 字。src/routes/admin/images.ts の putImage）。/images/* は
  公開かどうかを見ずに返すので、下書きの画像を守るのは当てられない URL だけ。前に置いた 8 字の
  キーも同じ形の検査で配り続ける（貼られた URL を殺さない）
*/
describe('画像のキー', () => {
  it('上げた画像のキーは 32 字の乱数。前の 8 字のキーも配る', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withFiles({ type: 'app', title: 'Demo', slug: 'demo' }, [
        ['image', file(png(), 'a.png', 'image/png')],
      ]),
    })
    expect(response.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.imageUrl).toMatch(/^\/images\/items\/demo-[0-9a-f]{32}\.png$/)

    const old = 'items/legacy-0123abcd.png'
    await env.MEDIA.put(old, png(), { metadata: { contentType: 'image/png' } })
    for (const url of [row?.imageUrl ?? '', `/images/${old}`]) {
      const served = await get(url)
      expect(served.status, url).toBe(200)
      expect(served.headers.get('content-type'), url).toBe('image/png')
    }
  })
})
