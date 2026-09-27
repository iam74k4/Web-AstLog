import { describe, expect, it } from 'vitest'
import { IMAGE_ACCEPT, imageTypeOfPath, isImageType, sniffImage } from '../src/lib/image'
import { avif, gif, heic, jpeg, png, svg, webp, webpLossless, webpLossy } from './images'

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
