import { describe, expect, it } from 'vitest'
import {
  IMAGE_ACCEPT,
  imageTypeOfPath,
  isImageType,
  isMediaType,
  isVideoUrl,
  SHOT_ACCEPT,
  sniffImage,
  sniffVideo,
} from '../src/lib/image'
import { stripMetadata } from '../src/lib/image-metadata'
import { byteRange } from '../src/routes/public/images'
import {
  androidLocation,
  appleLocation,
  avif,
  avifWithMetadata,
  gif,
  heic,
  isoMetaLocation,
  jpeg,
  lociLocation,
  mp4,
  PLACE,
  photoJpeg,
  photoPng,
  photoWebp,
  plainMovieMeta,
  png,
  svg,
  timedTrack,
  unpaddedExifWebp,
  webp,
  webpLossless,
  webpLossy,
  xmpLocation,
  xmpUuid,
} from './images'

/*
  受け取る画像の種類は中身の先頭のバイトで決める（SEC-2 / ADM-4）。
  名乗り（file.type）と拡張子はここには渡ってこない——渡せない形にしてある。
*/
describe('画像の種類は中身で決める', () => {
  it('5種類を見分け、拡張子と content-type を判定の結果から付ける', () => {
    expect(sniffImage(png())).toMatchObject({ type: 'image/png', extension: 'png' })
    expect(sniffImage(jpeg())).toMatchObject({ type: 'image/jpeg', extension: 'jpg' })
    expect(sniffImage(webp())).toMatchObject({ type: 'image/webp', extension: 'webp' })
    expect(sniffImage(avif())).toMatchObject({ type: 'image/avif', extension: 'avif' })
    expect(sniffImage(gif())).toMatchObject({ type: 'image/gif', extension: 'gif' })
  })

  it('SVG・HEIC・HTML・空・途中で切れたものは通さない', () => {
    expect(sniffImage(svg())).toBeNull()
    // AVIF と同じ入れ物（ISO BMFF）でも、ブランドが avif でなければ通さない
    expect(sniffImage(heic())).toBeNull()
    expect(sniffImage(new TextEncoder().encode('<!doctype html><script>1</script>'))).toBeNull()
    expect(sniffImage(new Uint8Array(0))).toBeNull()
    expect(sniffImage(png().subarray(0, 4))).toBeNull()
    // 以前のテストが「PNG」として上げていた 0 埋め
    expect(sniffImage(new Uint8Array(64))).toBeNull()
  })

  it('寸法を読む。読めないときは名乗らない', () => {
    expect(sniffImage(png(1200, 630))).toMatchObject({ width: 1200, height: 630 })
    expect(sniffImage(gif(320, 200))).toMatchObject({ width: 320, height: 200 })
    expect(sniffImage(jpeg(800, 600))).toMatchObject({ width: 800, height: 600 })
    expect(sniffImage(webp(1024, 512))).toMatchObject({ width: 1024, height: 512 })
    expect(sniffImage(webpLossless(640, 480))).toMatchObject({ width: 640, height: 480 })
    expect(sniffImage(webpLossy(300, 200))).toMatchObject({ width: 300, height: 200 })
    expect(sniffImage(avif(1600, 900))).toMatchObject({ width: 1600, height: 900 })

    // 頭だけで寸法の手前で切れた PNG。種類は分かるが、寸法は名乗らない
    const cut = sniffImage(png().subarray(0, 12))
    expect(cut?.type).toBe('image/png')
    expect(cut).not.toHaveProperty('width')
  })

  it('JPEG の EXIF の向きが縦横を入れ替えるなら、表示される向きの寸法を名乗る', () => {
    expect(sniffImage(jpeg(800, 600, 1))).toMatchObject({ width: 800, height: 600 })
    expect(sniffImage(jpeg(800, 600, 6))).toMatchObject({ width: 600, height: 800 })
  })

  it('選ぶ画面の accept と、配る側の許可リストは同じ5種類', () => {
    expect(IMAGE_ACCEPT).toBe('image/png,image/jpeg,image/webp,image/avif,image/gif')
    for (const type of IMAGE_ACCEPT.split(',')) expect(isImageType(type), type).toBe(true)
    for (const type of ['image/svg+xml', 'image/heic', 'text/html', undefined]) {
      expect(isImageType(type), String(type)).toBe(false)
    }
  })

  it('経路の拡張子から種類を引く（以前の jpeg も読む）。知らない拡張子は名乗らない', () => {
    expect(imageTypeOfPath('/images/items/a-1234abcd.png')).toBe('image/png')
    expect(imageTypeOfPath('/images/items/a-1234abcd.jpg')).toBe('image/jpeg')
    expect(imageTypeOfPath('/images/items/a-1234abcd.jpeg')).toBe('image/jpeg')
    expect(imageTypeOfPath('/images/items/a-1234abcd.svgxml')).toBeUndefined()
    expect(imageTypeOfPath('/images/items/a-1234abcd')).toBeUndefined()
  })
})

/*
  動画は作品のほかの画像の欄でだけ受ける H.264（MP4 と、Mac の画面収録の MOV）。iPhone の
  Safari と Chrome のどちらでも再生できる組だけを通し、書き出し直せば通るもの（HEVC）は理由で分ける
*/
describe('動画の種類も中身で決める', () => {
  it('MP4（H.264）を通し、寸法を表示の向きで読む', () => {
    expect(sniffVideo(mp4())).toEqual({
      video: { type: 'video/mp4', extension: 'mp4', label: 'MP4', width: 1280, height: 720 },
    })
    // iPhone の縦の動画は横長の絵に 90° の回転が付く
    expect(sniffVideo(mp4({ width: 1920, height: 1080, turned: true }))).toMatchObject({
      video: { width: 1080, height: 1920 },
    })
    expect(sniffVideo(mp4({ codec: 'avc3' }))).toMatchObject({ video: { type: 'video/mp4' } })
  })

  it('H.264 の MOV（QuickTime の入れ物）も通し、MP4 として置く形を返す', () => {
    expect(sniffVideo(mp4({ brand: 'qt  ' }))).toEqual({
      video: { type: 'video/mp4', extension: 'mp4', label: 'MP4', width: 1280, height: 720 },
    })
    // 入れ物が MOV でも、映像が HEVC なら弾く（iPhone のカメラの既定）
    expect(sniffVideo(mp4({ brand: 'qt  ', codec: 'hvc1' }))).toEqual({ problem: 'hevc' })
  })

  it('HEVC・ほかの符号化は理由を分けて弾く', () => {
    expect(sniffVideo(mp4({ codec: 'hvc1' }))).toEqual({ problem: 'hevc' })
    expect(sniffVideo(mp4({ codec: 'hev1' }))).toEqual({ problem: 'hevc' })
    expect(sniffVideo(mp4({ codec: 'av01' }))).toEqual({ problem: 'codec' })
  })

  it('動画でないものは動画として読まない（画像の判定とも混ざらない）', () => {
    // 音だけの MP4 は映像を持たない
    expect(sniffVideo(mp4({ handler: 'soun' }))).toBeNull()
    for (const image of [png(), jpeg(), gif(), webp(), avif(), heic(), svg()]) {
      expect(sniffVideo(image)).toBeNull()
    }
    expect(sniffImage(mp4())).toBeNull()
    expect(sniffVideo(mp4().subarray(0, 40))).toBeNull()
    expect(sniffVideo(new Uint8Array(0))).toBeNull()
  })

  it('ほかの画像の欄は MOV も選べ、配る側の許可リストは画像の5種類と MP4 だけ', () => {
    expect(SHOT_ACCEPT).toBe(`${IMAGE_ACCEPT},video/mp4,video/quicktime`)
    // MOV は MP4 として置いて配るので、video/quicktime は配る側の許可リストに入れない
    for (const type of SHOT_ACCEPT.split(',').filter((one) => one !== 'video/quicktime')) {
      expect(isMediaType(type), type).toBe(true)
    }
    expect(isImageType('video/mp4')).toBe(false)
    for (const type of ['video/quicktime', 'image/svg+xml', 'text/html', undefined]) {
      expect(isMediaType(type), String(type)).toBe(false)
    }
    expect(isVideoUrl('/images/items/demo-1234abcd.mp4')).toBe(true)
    expect(isVideoUrl('/images/items/demo-1234abcd.png')).toBe(false)
  })
})

// iPhone の Safari は範囲で取れない動画を再生しない（/images/* の 206）
describe('範囲の要求', () => {
  it('1つの範囲を読み、終わりは中身の長さで切る', () => {
    expect(byteRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 })
    expect(byteRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 })
    expect(byteRange('bytes=-5', 100)).toEqual({ start: 95, end: 99 })
    expect(byteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
  })

  it('範囲でない・読めない・複数の範囲は全体（null）、中身の外は 416', () => {
    expect(byteRange(undefined, 100)).toBeNull()
    expect(byteRange('bytes=0-1,5-9', 100)).toBeNull()
    expect(byteRange('items=0-1', 100)).toBeNull()
    expect(byteRange('bytes=-', 100)).toBeNull()
    expect(byteRange('bytes=9-2', 100)).toBeNull()
    expect(byteRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(byteRange('bytes=-0', 100)).toBe('unsatisfiable')
  })
})

/*
  上げた写真の付け足し（撮った場所・日時・機種）は、置く前に外す（src/lib/image-metadata.ts）。
  JPEG・PNG・WebP は絵に要る区画だけを残し、外せない AVIF と動画は位置があれば断る。外したあとも
  同じ種類・同じ寸法として読め、向きが 1 でなければ向きだけを残す。並びが途中で読めず付け足しが
  残るものは断る
*/
describe('写真の付け足しを外す', () => {
  const latin1 = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  const cleaned = (type: string, bytes: Uint8Array<ArrayBuffer>) => {
    const result = stripMetadata(type, bytes)
    if (typeof result === 'string') throw new Error(`${type} を ${result} として断った`)
    return result
  }
  const join = (...parts: (Uint8Array | number[])[]) =>
    new Uint8Array(parts.flatMap((part) => Array.from(part)))
  const leaks = (bytes: Uint8Array) =>
    [PLACE, 'GPSLatitude', 'MotionPhoto', 'Photoshop', 'MPF\0'].filter((mark) =>
      latin1(bytes).includes(mark),
    )

  it('JPEG は APP1・APP13・COM・ICC でない APP2・EOI の後ろを落とし、APP0・ICC・Adobe と画像データを残す', () => {
    for (const orientation of [undefined, 1, 6]) {
      const photo = photoJpeg({ orientation })
      expect(leaks(photo), String(orientation)).not.toEqual([])
      const clean = cleaned('image/jpeg', photo)
      expect(clean, String(orientation)).toEqual(photoJpeg({ orientation, clean: true }))
      expect(leaks(clean), String(orientation)).toEqual([])
      expect(sniffImage(clean), String(orientation)).toEqual(sniffImage(photo))
    }
    // 向きが 6 なら、向きだけの EXIF を残す（表示の寸法は縦横が入れ替わったまま）
    expect(sniffImage(cleaned('image/jpeg', photoJpeg({ orientation: 6 })))).toMatchObject({
      width: 600,
      height: 800,
    })
    expect(latin1(cleaned('image/jpeg', photoJpeg({ orientation: 1 })))).not.toContain('Exif')
  })

  /*
    区画の間の余計なバイト（FF でない字・FF 00）は libjpeg が読み飛ばし、ブラウザは何事もなく
    描く。そこで読むのをやめると、後ろの EXIF の位置がそのまま出る
  */
  it('JPEG の区画の間の余計なバイトは読み飛ばして落とし、後ろの EXIF も外す', () => {
    const photo = photoJpeg({ orientation: 6 })
    // APP0（SOI の 2 バイトのあと 18 バイト）と EXIF の APP1 のあいだ
    for (const stray of [[0x00], [0x12, 0x34], [0x12, 0xff, 0x00]]) {
      const label = stray.join(',')
      const broken = join(photo.subarray(0, 20), stray, photo.subarray(20))
      expect(sniffImage(broken), label).toMatchObject({ type: 'image/jpeg' })
      const clean = cleaned('image/jpeg', broken)
      expect(clean, label).toEqual(photoJpeg({ orientation: 6, clean: true }))
      expect(leaks(clean), label).toEqual([])
    }
  })

  it('PNG は絵に要るチャンクだけを残し、eXIf・tEXt・iTXt・zTXt・tIME・知らないチャンク（exIf・caBX）と IEND の後ろを落とす', () => {
    for (const orientation of [undefined, 1, 8]) {
      const photo = photoPng({ orientation })
      expect(leaks(photo), String(orientation)).not.toEqual([])
      const clean = cleaned('image/png', photo)
      expect(clean, String(orientation)).toEqual(photoPng({ orientation, clean: true }))
      expect(leaks(clean), String(orientation)).toEqual([])
      expect(sniffImage(clean), String(orientation)).toEqual(sniffImage(photo))
    }
  })

  it('WebP は絵に要るチャンクだけを残し、EXIF・XMP・知らないチャンク（C2PA）を落とし、VP8X の印と RIFF の長さを合わせる', () => {
    for (const orientation of [undefined, 1, 6]) {
      const photo = photoWebp({ orientation })
      expect(leaks(photo), String(orientation)).not.toEqual([])
      const clean = cleaned('image/webp', photo)
      expect(clean, String(orientation)).toEqual(photoWebp({ orientation, clean: true }))
      expect(leaks(clean), String(orientation)).toEqual([])
      expect(sniffImage(clean), String(orientation)).toEqual(sniffImage(photo))
    }
  })

  it('WebP の最後の EXIF が奇数の長さで詰め物を欠いていても、落とす', () => {
    const photo = unpaddedExifWebp()
    expect(leaks(photo)).toEqual([PLACE])
    const clean = cleaned('image/webp', photo)
    expect(clean).toEqual(unpaddedExifWebp({ clean: true }))
    expect(leaks(clean)).toEqual([])
    expect(sniffImage(clean)).toEqual(sniffImage(photo))
  })

  it('付け足しの無いもの・GIF・途中で切れたものは、同じバイトのまま返す', () => {
    const cases: [string, Uint8Array<ArrayBuffer>][] = [
      ['image/png', png()],
      ['image/jpeg', jpeg()],
      ['image/webp', webp()],
      ['image/webp', webpLossless()],
      ['image/webp', webpLossy()],
      ['image/gif', gif()],
      ['image/avif', avif()],
      ['video/mp4', mp4()],
      ['video/mp4', mp4({ brand: 'qt  ', extra: [plainMovieMeta()] })],
      ['video/mp4', mp4({ extra: [timedTrack('mebx', 'com.apple.quicktime.video-orientation')] })],
      // 絵の頭や中身の途中で切れたもの（後ろに付け足しは無い）
      ['image/jpeg', jpeg().slice(0, 25)],
      ['image/png', photoPng().slice(0, 40)],
      ['image/webp', photoWebp().slice(0, 40)],
    ]
    for (const [type, bytes] of cases) expect(stripMetadata(type, bytes), type).toBe(bytes)
  })

  /*
    並びが途中で読めないと、そこから後ろは区画に分けられず外せない。そこが落とす区画か、後ろに
    付け足しの目印があれば、黙って写さずに断る
  */
  it('途中で読めなくなり、その後ろに付け足しが残るものは断る', () => {
    const photo = photoPng()
    const exifAt = latin1(photo).indexOf('eXIf') - 4
    const webpPhoto = photoWebp()
    const webpExifAt = latin1(webpPhoto).indexOf('EXIF')
    const cases: [string, string, Uint8Array<ArrayBuffer>][] = [
      // 落とす区画（EXIF の APP1・eXIf・EXIF）の途中で切れた
      ['JPEG の EXIF の途中', 'image/jpeg', photoJpeg().slice(0, 30)],
      ['PNG の eXIf の途中', 'image/png', photo.slice(0, exifAt + 20)],
      ['WebP の EXIF の途中', 'image/webp', webpPhoto.slice(0, webpExifAt + 20)],
      // 残す区画の長さがファイルの外を指し、その後ろに EXIF が続く
      [
        'JPEG の長さの合わない DQT のあとの EXIF',
        'image/jpeg',
        join([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xff], photoJpeg().subarray(2)),
      ],
    ]
    for (const [label, type, bytes] of cases) {
      expect(stripMetadata(type, bytes), label).toBe('unreadable')
    }
  })

  it('AVIF は EXIF か XMP に位置があれば断る（mdat に置いても idat に置いても、iloc の版と欄の幅を問わず）', () => {
    const layouts = [
      { version: 0, inIdat: false },
      { version: 1, inIdat: false },
      { version: 1, inIdat: true },
      { version: 2, inIdat: false },
      { version: 2, inIdat: true },
    ] as const
    for (const xmp of [false, true]) {
      for (const layout of layouts) {
        for (const wide of [false, true]) {
          const label = `xmp: ${xmp}, iloc: v${layout.version}, idat: ${layout.inIdat}, wide: ${wide}`
          const photo = avifWithMetadata({ xmp, wide, ...layout })
          expect(sniffImage(photo), label).toMatchObject({ type: 'image/avif', width: 1600 })
          expect(stripMetadata('image/avif', photo), label).toBe('location')
          const plain = avifWithMetadata({ gps: false, xmp, wide, ...layout })
          expect(stripMetadata('image/avif', plain), label).toBe(plain)
        }
      }
    }
  })

  it('AVIF が EXIF・XMP の品目を名乗るのに中身を引けなければ、位置が無いとは言わずに断る', () => {
    // offset と長さの幅が 2 バイト（0・4・8 のどれでもない）の iloc は読まない
    for (const gps of [true, false]) {
      expect(stripMetadata('image/avif', avifWithMetadata({ gps, sizes: 0x22 })), String(gps)).toBe(
        'unreadable',
      )
    }
  })

  it('MP4・MOV は付け足しの箱の位置（Apple の ISO6709・©xyz・loci・XMP）があれば、置き場を問わず断る', () => {
    const movies: Record<string, Parameters<typeof mp4>[0]> = {
      'moov > meta > keys（QuickTime の形）': { extra: [appleLocation()] },
      'moov > udta > ©xyz': { extra: [androidLocation()] },
      'moov > udta > XMP_': { extra: [xmpLocation()] },
      'moov > udta > loci': { extra: [lociLocation()] },
      'moov > udta > meta（ISO の形）> ilst > ©xyz': { extra: [isoMetaLocation()] },
      'moov > uuid（XMP）': { extra: [xmpUuid()] },
      '最上段の uuid（XMP）': { trailing: [xmpUuid()] },
      'trak > udta > ©xyz': { inTrack: [androidLocation()] },
    }
    for (const [label, options] of Object.entries(movies)) {
      for (const brand of ['isom', 'qt  ']) {
        const movie = mp4({ brand, ...options })
        expect(sniffVideo(movie), `${label} ${brand}`).toMatchObject({
          video: { type: 'video/mp4' },
        })
        expect(stripMetadata('video/mp4', movie), `${label} ${brand}`).toBe('location')
      }
    }
  })

  /*
    アクションカメラ・ドローン・iPhone は、位置を時刻ごとの記録のトラックに書く。記録の中身は
    mdat にあって読まないので、トラックの見本の種類で断る
  */
  it('MP4・MOV は位置を記録するトラック（gpmd・camm・djmd・位置の mebx）があれば断る', () => {
    const tracks = [
      timedTrack('gpmd'),
      timedTrack('camm'),
      timedTrack('djmd'),
      timedTrack('mebx', 'com.apple.quicktime.location.ISO6709'),
    ]
    for (const track of tracks) {
      const movie = mp4({ extra: [track] })
      expect(sniffVideo(movie)).toMatchObject({ video: { type: 'video/mp4' } })
      expect(stripMetadata('video/mp4', movie)).toBe('location')
    }
  })
})
