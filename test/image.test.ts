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
import { byteRange } from '../src/routes/public/images'
import { avif, gif, heic, jpeg, mp4, png, svg, webp, webpLossless, webpLossy } from './images'

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
