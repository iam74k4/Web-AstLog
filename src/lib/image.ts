/*
  受け取る画像の種類と、その見分け方。アバターと作品の画像で1本。

  **種類はファイルの先頭のバイト（マジックナンバー）で決める。** ブラウザが
  名乗る file.type も、ファイル名の拡張子も見ない。どちらも送る側が好きに
  書ける——image/png を名乗った SVG は、名乗りのとおりに保存して配ると、
  開いた人のブラウザがこのサイトのオリジンでその中の <script> を走らせる
  （管理画面と同じオリジンなので、owner のクッキーのまま管理画面を読み書き
  できる）。保存する content-type と拡張子も、ここで判定した結果からだけ作る。

  通すのは5種類だけ。SVG はスクリプトを持てる文書なので受けない。HEIC は
  Safari 以外で表示できない（Mac の Safari から上げると「保存しました」と
  出て、Chrome と Firefox の訪問者にだけ壊れて見えていた）。

  配る側（src/routes/public/images.ts の /images/*）も同じ一覧を読み、一覧に無い
  content-type が KV に残っていたら、画像として返さずに添付として返す。
*/

export type ImageFormat = {
  type: string
  extension: string
  label: string
}

export const IMAGE_FORMATS: readonly ImageFormat[] = [
  { type: 'image/png', extension: 'png', label: 'PNG' },
  { type: 'image/jpeg', extension: 'jpg', label: 'JPEG' },
  { type: 'image/webp', extension: 'webp', label: 'WebP' },
  { type: 'image/avif', extension: 'avif', label: 'AVIF' },
  { type: 'image/gif', extension: 'gif', label: 'GIF' },
]

// <input type="file" accept="…">。選ぶ画面で最初から5種類に絞る（検査はサーバーでもう一度やる）
export const IMAGE_ACCEPT = IMAGE_FORMATS.map((format) => format.type).join(',')

export const IMAGE_LABELS = IMAGE_FORMATS.map((format) => format.label).join('・')

export const isImageType = (type: string | undefined | null): type is string =>
  IMAGE_FORMATS.some((format) => format.type === type)

/*
  経路の拡張子から種類を引く（og:image:type）。拡張子は putImage が判定の
  結果から付けたものなので、こちらが上げた画像ならそのまま信じてよい。
  知らない拡張子は undefined（そのときは種類を名乗らない）。
  以前の拡張子（名乗りから作っていた jpeg）も読めるようにしておく。
*/
export function imageTypeOfPath(path: string): string | undefined {
  const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  if (extension === 'jpeg') return 'image/jpeg'
  return IMAGE_FORMATS.find((format) => format.extension === extension)?.type
}

/*
  判定の結果。width / height は読めたときだけ（共有カードの og:image:width /
  height と twitter:card の大きさを決めるのに使う）。読めないときは無しで
  返し、呼ぶ側は寸法を名乗らない。
*/
export type SniffedImage = ImageFormat & { width?: number; height?: number }

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  const format = formatOf(bytes)
  if (!format) return null
  const size = sizeOf(format.type, bytes)
  return size ? { ...format, ...size } : { ...format }
}

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length))

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte)

const formatByType = (type: string) => IMAGE_FORMATS.find((format) => format.type === type)

function formatOf(bytes: Uint8Array): ImageFormat | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return formatByType('image/png')
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return formatByType('image/jpeg')
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return formatByType('image/gif')
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return formatByType('image/webp')
  }
  /*
    AVIF と HEIC は同じ入れ物（ISO BMFF）で、先頭の ftyp 箱のブランドだけが
    違う。主ブランドか互換ブランドに avif / avis があるものだけを AVIF とする
    （HEIC は heic / heix / mif1 などで、avif を名乗らない）。
  */
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const size = readU32(bytes, 0)
    const end = Math.min(size, bytes.length)
    for (let at = 8; at + 4 <= end; at += 4) {
      // 8..12 が主ブランド、12..16 は版なので飛ばす、16.. が互換ブランド
      if (at === 12) continue
      const brand = ascii(bytes, at, 4)
      if (brand === 'avif' || brand === 'avis') return formatByType('image/avif')
    }
  }
  return undefined
}

/* ------------------------------------------------------------ 寸法 */

const readU16 = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
const readU16le = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
const readU24le = (bytes: Uint8Array, at: number) =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)
const readU32 = (bytes: Uint8Array, at: number) =>
  readU16(bytes, at) * 0x10000 + readU16(bytes, at + 2)

type Size = { width: number; height: number }

const sized = (width: number, height: number): Size | null =>
  width > 0 && height > 0 ? { width, height } : null

function sizeOf(type: string, bytes: Uint8Array): Size | null {
  switch (type) {
    case 'image/png':
      // 署名の直後が IHDR（長さ 4・型 4・幅 4・高さ 4）
      return ascii(bytes, 12, 4) === 'IHDR' ? sized(readU32(bytes, 16), readU32(bytes, 20)) : null
    case 'image/gif':
      return sized(readU16le(bytes, 6), readU16le(bytes, 8))
    case 'image/webp':
      return webpSize(bytes)
    case 'image/jpeg':
      return jpegSize(bytes)
    case 'image/avif':
      return avifSize(bytes)
    default:
      return null
  }
}

function webpSize(bytes: Uint8Array): Size | null {
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') return sized(readU24le(bytes, 24) + 1, readU24le(bytes, 27) + 1)
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = readU16le(bytes, 21) | (readU16le(bytes, 23) << 16)
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8 ' && startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
    return sized(readU16le(bytes, 26) & 0x3fff, readU16le(bytes, 28) & 0x3fff)
  }
  return null
}

/*
  JPEG は区切り（FF xx）ごとに進み、最初の SOF（フレームの頭）から寸法を読む。
  EXIF の向き（Orientation）が 5〜8 なら、表示では縦横が入れ替わる——ブラウザも
  貼り先も向きを当ててから描くので、名乗る寸法も入れ替える。
*/
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function jpegSize(bytes: Uint8Array): Size | null {
  let at = 2
  let turned = false
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] ?? 0
    // 詰め物の FF と、長さを持たない区切り（RSTn・TEM）
    if (marker === 0xff) {
      at += 1
      continue
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2
      continue
    }
    const length = readU16(bytes, at + 2)
    if (length < 2) return null
    if (marker === 0xe1 && ascii(bytes, at + 4, 6) === 'Exif\0\0') {
      turned = exifTurned(bytes, at + 10, at + 2 + length)
    }
    if (SOF.has(marker)) {
      const height = readU16(bytes, at + 5)
      const width = readU16(bytes, at + 7)
      return turned ? sized(height, width) : sized(width, height)
    }
    // 画像データ（SOS）より先に SOF が無ければ読めない
    if (marker === 0xda || marker === 0xd9) return null
    at += 2 + length
  }
  return null
}

// EXIF（TIFF）の IFD0 から Orientation（0x0112）を読み、縦横が入れ替わるか
function exifTurned(bytes: Uint8Array, tiff: number, end: number): boolean {
  const order = ascii(bytes, tiff, 2)
  if (order !== 'II' && order !== 'MM') return false
  const little = order === 'II'
  const u16 = (at: number) => (little ? readU16le(bytes, at) : readU16(bytes, at))
  const u32 = (at: number) => (little ? u16(at) + u16(at + 2) * 0x10000 : readU32(bytes, at))
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return false
  const count = u16(ifd)
  for (let entry = 0; entry < count; entry += 1) {
    const at = ifd + 2 + entry * 12
    if (at + 12 > end) return false
    if (u16(at) === 0x0112) return u16(at + 8) >= 5 && u16(at + 8) <= 8
  }
  return false
}

/*
  AVIF は箱（size・type）の入れ子。meta > iprp > ipco の中の ispe が寸法。
  ispe は下絵（グリッドの1枚・アルファ）ぶんも並ぶので、いちばん大きいものを
  採る。irot（90° 単位の回転）が奇数なら縦横を入れ替える。
*/
function avifSize(bytes: Uint8Array): Size | null {
  const meta = findBox(bytes, 0, bytes.length, 'meta')
  if (!meta) return null
  // meta は full box（版と印の 4 バイトのあとに子が続く）
  const iprp = findBox(bytes, meta.body + 4, meta.end, 'iprp')
  const ipco = iprp ? findBox(bytes, iprp.body, iprp.end, 'ipco') : null
  if (!ipco) return null

  let best: Size | null = null
  let turned = false
  for (const box of boxes(bytes, ipco.body, ipco.end)) {
    if (box.type === 'ispe' && box.body + 12 <= box.end) {
      const size = sized(readU32(bytes, box.body + 4), readU32(bytes, box.body + 8))
      if (size && (!best || size.width * size.height > best.width * best.height)) best = size
    }
    if (box.type === 'irot' && box.body < box.end)
      turned = ((bytes[box.body] ?? 0) & 0x03) % 2 === 1
  }
  return best && turned ? { width: best.height, height: best.width } : best
}

type Box = { type: string; body: number; end: number }

function* boxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
  let at = start
  while (at + 8 <= end) {
    let size = readU32(bytes, at)
    const type = ascii(bytes, at + 4, 4)
    let body = at + 8
    if (size === 1) {
      // 64 ビットの長さ。上位 32 ビットが 0 でなければ、1MB までの画像ではありえない
      if (readU32(bytes, at + 8) !== 0) return
      size = readU32(bytes, at + 12)
      body = at + 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < body - at || at + size > end) return
    yield { type, body, end: at + size }
    at += size
  }
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
  for (const box of boxes(bytes, start, end)) if (box.type === type) return box
  return null
}
