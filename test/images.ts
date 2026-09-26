/*
  テストで上げる画像。中身は頭（署名と寸法）だけの最小の形で、描ける絵ではない。

  受け入れは先頭のバイトで種類を決める（src/lib/image.ts の sniffImage）ので、
  0 で埋めただけの「PNG」はもう通らない。寸法を名乗る場所まで本物と同じ並びで
  書いておき、種類と寸法の読み取りを本物の並びで確かめる。
*/

const bytes = (...parts: (number[] | string | Uint8Array)[]) => {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') for (const char of part) out.push(char.charCodeAt(0))
    else out.push(...part)
  }
  return new Uint8Array(out)
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const zeros = (n: number) => new Array<number>(n).fill(0)

export const png = (width = 1200, height = 630) =>
  bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32(13),
    'IHDR',
    u32(width),
    u32(height),
    [8, 2, 0, 0, 0],
    zeros(4),
    u32(0),
    'IEND',
    zeros(4),
  )

// orientation を渡すと EXIF（II = リトルエンディアン）の Orientation を1つ持つ
export const jpeg = (width = 800, height = 600, orientation?: number) => {
  const exif = orientation
    ? bytes(
        'Exif',
        [0, 0],
        'II',
        [0x2a, 0],
        [8, 0, 0, 0],
        u16le(1),
        u16le(0x0112),
        u16le(3),
        [1, 0, 0, 0],
        u16le(orientation),
        [0, 0],
        [0, 0, 0, 0],
      )
    : null
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0],
    u16(16),
    'JFIF',
    [0, 1, 1, 0],
    u16(1),
    u16(1),
    [0, 0],
    exif ? bytes([0xff, 0xe1], u16(exif.length + 2), exif) : [],
    [0xff, 0xc0],
    u16(17),
    [8],
    u16(height),
    u16(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda],
    u16(12),
    zeros(10),
    [0xff, 0xd9],
  )
}

export const gif = (width = 320, height = 200) =>
  bytes('GIF89a', u16le(width), u16le(height), [0, 0, 0], [0x3b])

// 拡張の形（VP8X）。寸法は 1 を引いて 24 ビットで持つ
export const webp = (width = 1024, height = 512) =>
  bytes(
    'RIFF',
    u32(0),
    'WEBP',
    'VP8X',
    [10, 0, 0, 0],
    zeros(4),
    u24le(width - 1),
    u24le(height - 1),
  )

// 可逆の形（VP8L）。寸法は 1 を引いて 14 ビットずつ詰める
export const webpLossless = (width = 640, height = 480) => {
  const bits = (width - 1) | ((height - 1) << 14)
  return bytes(
    'RIFF',
    u32(0),
    'WEBP',
    'VP8L',
    u32(0),
    [0x2f],
    [bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff],
  )
}

// 非可逆の形（VP8 ）。フレームの頭（3 バイト）と開始の印のあとに 14 ビットずつ
export const webpLossy = (width = 300, height = 200) =>
  bytes(
    'RIFF',
    u32(0),
    'WEBP',
    'VP8 ',
    u32(0),
    zeros(3),
    [0x9d, 0x01, 0x2a],
    u16le(width),
    u16le(height),
  )

const box = (type: string, ...body: (number[] | string | Uint8Array)[]) => {
  const inner = bytes(...body)
  return bytes(u32(inner.length + 8), type, inner)
}

// ISO BMFF の入れ物。brand が主ブランド、compatible が互換ブランド
const isobmff = (brand: string, compatible: string[], width: number, height: number) =>
  bytes(
    box('ftyp', brand, zeros(4), ...compatible),
    box(
      'meta',
      zeros(4),
      box('hdlr', zeros(8), 'pict', zeros(12), [0]),
      box('iprp', box('ipco', box('ispe', zeros(4), u32(width), u32(height)))),
    ),
  )

export const avif = (width = 1600, height = 900) =>
  isobmff('avif', ['avif', 'mif1', 'miaf'], width, height)

// HEIC は AVIF と同じ入れ物で、ブランドだけが違う
export const heic = (width = 4032, height = 3024) =>
  isobmff('heic', ['mif1', 'heic'], width, height)

export const svg = () =>
  bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>')

export const file = (content: Uint8Array, name: string, type: string) =>
  new File([content], name, { type })
