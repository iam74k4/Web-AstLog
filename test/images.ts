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
const u32le = (n: number) => [...u24le(n), (n >>> 24) & 0xff]
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

/*
  撮った場所を持つ写真の付け足し（src/lib/image-metadata.ts が外すもの・断るもの）。
  PLACE は外れたかを探す目印で、GPS の IFD・XMP・コメント・EOI の後ろなどに入れておく
*/
export const PLACE = 'Tokyo Station +35.6812+139.7671'
export const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description exif:GPSLatitude="35,40.872N" exif:GPSLongitude="139,46.026E" photoshop:City="${PLACE}"/></rdf:RDF></x:xmpmeta>`

const ifdEntry = (tag: number, type: number, count: number, value: number[]) => [
  ...u16(tag),
  ...u16(type),
  ...u32(count),
  ...value,
]

/*
  EXIF の中身（TIFF。MM）。IFD0 に向き（あれば）と GPS の IFD への印、GPS の IFD に緯度・
  経度（有理数3つずつ）と、場所の名前（GPSAreaInformation に PLACE）
*/
export const gpsTiff = (orientation?: number) => {
  const ifd0 = orientation ? 2 : 1
  const gps = 8 + 2 + ifd0 * 12 + 4
  const latitude = gps + 2 + 5 * 12 + 4
  const longitude = latitude + 24
  const area = longitude + 24
  return bytes(
    'MM',
    [0, 0x2a],
    u32(8),
    u16(ifd0),
    orientation ? ifdEntry(0x0112, 3, 1, [...u16(orientation), 0, 0]) : [],
    ifdEntry(0x8825, 4, 1, u32(gps)),
    u32(0),
    u16(5),
    ifdEntry(1, 2, 2, [0x4e, 0, 0, 0]),
    ifdEntry(2, 5, 3, u32(latitude)),
    ifdEntry(3, 2, 2, [0x45, 0, 0, 0]),
    ifdEntry(4, 5, 3, u32(longitude)),
    ifdEntry(0x1c, 7, 8 + PLACE.length, u32(area)),
    u32(0),
    ...[35, 1, 40, 1, 5232, 100, 139, 1, 46, 1, 156, 100].map(u32),
    'ASCII',
    zeros(3),
    PLACE,
  )
}

// 外したあとに残す、向きだけの EXIF（TIFF。MM・IFD0 に Orientation の1項目）
export const orientationTiff = (orientation: number) =>
  bytes(
    'MM',
    [0, 0x2a],
    u32(8),
    u16(1),
    ifdEntry(0x0112, 3, 1, [...u16(orientation), 0, 0]),
    u32(0),
  )

const segment = (marker: number, ...payload: (number[] | string | Uint8Array)[]) => {
  const body = bytes(...payload)
  return bytes([0xff, marker], u16(body.length + 2), body)
}

/*
  スマートフォンの写真の形の JPEG。APP0（JFIF）・APP1（EXIF と XMP）・APP2（ICC と MPF）・
  APP13（IPTC）・APP14（Adobe）・COM・表と頭・画像データ（詰め物の FF 00 と区切りの RSTn を
  含む）・EOI と、EOI の後ろの付け足し（動く写真の動画など）。clean で、外したあとの形
  （残すのは APP0・ICC・Adobe・表と頭・画像データ・EOI と、向きが 1 でなければ向きだけの EXIF）
*/
export const photoJpeg = ({
  width = 800,
  height = 600,
  orientation,
  clean = false,
}: {
  width?: number
  height?: number
  orientation?: number
  clean?: boolean
} = {}) => {
  const turned = orientation && orientation !== 1
  return bytes(
    [0xff, 0xd8],
    segment(0xe0, 'JFIF', [0, 1, 1, 0], u16(1), u16(1), [0, 0]),
    clean
      ? turned
        ? segment(0xe1, 'Exif', [0, 0], orientationTiff(orientation))
        : []
      : segment(0xe1, 'Exif', [0, 0], gpsTiff(orientation)),
    clean ? [] : segment(0xe1, 'http://ns.adobe.com/xap/1.0/', [0], XMP),
    segment(0xe2, 'ICC_PROFILE', [0, 1, 1], 'sRGB profile'),
    clean ? [] : segment(0xe2, 'MPF', [0], 'MM', [0, 0x2a], u32(8)),
    clean ? [] : segment(0xed, 'Photoshop 3.0', [0], '8BIM', PLACE),
    segment(0xee, 'Adobe', [0, 100, 0, 0, 0, 0, 1]),
    clean ? [] : segment(0xfe, PLACE),
    segment(0xdb, [0], zeros(64)),
    segment(0xc0, [8], u16(height), u16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    segment(0xc4, [0], zeros(16)),
    segment(0xdd, u16(4)),
    segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd1, 0x78, 0xff, 0x00],
    [0xff, 0xd9],
    clean ? [] : bytes('MotionPhoto', PLACE),
  )
}

// PNG のチャンク（長さ・型・中身・CRC）。CRC は本物（外したあとに置き直す eXIf と比べる）
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type: string, ...data: (number[] | string | Uint8Array)[]) => {
  const body = bytes(type, ...data)
  return bytes(u32(body.length - 4), body, u32(crc32(body)))
}

/*
  付け足しを持つ PNG。eXIf（GPS）・tEXt・iTXt（XMP）・zTXt・tIME と、残す pHYs・IDAT・IEND・
  IEND の後ろの付け足し。clean で外したあとの形
*/
export const photoPng = ({
  width = 1200,
  height = 630,
  orientation,
  clean = false,
}: {
  width?: number
  height?: number
  orientation?: number
  clean?: boolean
} = {}) =>
  bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', u32(width), u32(height), [8, 2, 0, 0, 0]),
    chunk('pHYs', u32(2835), u32(2835), [1]),
    clean
      ? orientation && orientation !== 1
        ? chunk('eXIf', orientationTiff(orientation))
        : []
      : chunk('eXIf', gpsTiff(orientation)),
    clean ? [] : chunk('tEXt', 'Comment', [0], PLACE),
    clean ? [] : chunk('iTXt', 'XML:com.adobe.xmp', zeros(5), XMP),
    clean ? [] : chunk('zTXt', 'Location', [0, 0], PLACE),
    clean ? [] : chunk('tIME', u16(2026), [10, 27, 9, 30, 0]),
    chunk('IDAT', [0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1]),
    chunk('IEND'),
    clean ? [] : bytes(PLACE),
  )

/*
  付け足しを持つ WebP（拡張の形）。VP8X（ICC・EXIF・XMP の印）・ICCP・VP8L・EXIF（GPS。長さが
  奇数なら詰め物）・XMP と、RIFF の後ろの付け足し。clean で外したあとの形（印を下ろし、
  向きが 1 でなければ向きだけの EXIF を同じ場所に置き、RIFF の長さを合わせる）
*/
export const photoWebp = ({
  width = 1024,
  height = 512,
  orientation,
  clean = false,
}: {
  width?: number
  height?: number
  orientation?: number
  clean?: boolean
} = {}) => {
  const turned = clean && orientation !== undefined && orientation !== 1
  const riffChunk = (type: string, data: Uint8Array) =>
    bytes(type, u32le(data.length), data, data.length % 2 ? [0] : [])
  const flags = 0x20 | (clean ? (turned ? 0x08 : 0) : 0x08 | 0x04)
  const bits = (width - 1) | ((height - 1) << 14)
  const body = bytes(
    'WEBP',
    riffChunk('VP8X', bytes([flags], zeros(3), u24le(width - 1), u24le(height - 1))),
    riffChunk('ICCP', bytes('sRGB profile')),
    riffChunk(
      'VP8L',
      bytes([0x2f], [bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff]),
    ),
    clean
      ? turned
        ? riffChunk('EXIF', orientationTiff(orientation))
        : []
      : riffChunk('EXIF', gpsTiff(orientation)),
    clean ? [] : riffChunk('XMP ', bytes(XMP)),
  )
  return bytes('RIFF', u32le(body.length), body, clean ? [] : bytes(PLACE))
}

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

/*
  動画（MP4）。ftyp → mdat → moov の順（moov が後ろの、ネット向けに並べ替えていない形）。
  moov > trak > tkhd（版 0。幅と高さは 16.16）・mdia > hdlr（vide）・minf > stbl > stsd > 見本。
  codec が見本の種類（avc1 = H.264・hvc1 = HEVC）、turned で 90° の回転の行列、handler を
  soun にすると音だけ。中身は頭だけで再生はできない
*/
export const mp4 = ({
  brand = 'isom',
  codec = 'avc1',
  width = 1280,
  height = 720,
  turned = false,
  handler = 'vide',
  extra = [],
}: {
  brand?: string
  codec?: string
  width?: number
  height?: number
  turned?: boolean
  handler?: string
  // moov の終わりに足す箱（付け足しの udta・meta。位置の書き方は下の movieLocation）
  extra?: Uint8Array[]
} = {}) => {
  const one = 0x00010000
  const matrix = turned
    ? [0, one, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000]
    : [one, 0, 0, 0, one, 0, 0, 0, 0x40000000]
  const tkhd = box(
    'tkhd',
    [0, 0, 0, 3],
    zeros(20),
    zeros(8),
    zeros(8),
    ...matrix.map((value) => u32(value)),
    u32(width * 0x10000),
    u32(height * 0x10000),
  )
  const sample = box(codec, zeros(6), u16(1), zeros(16), u16(width), u16(height), zeros(50))
  return bytes(
    box('ftyp', brand, zeros(4), 'isom', 'iso2', 'mp41'),
    box('mdat', zeros(64)),
    box(
      'moov',
      box('mvhd', zeros(100)),
      box(
        'trak',
        tkhd,
        box(
          'mdia',
          box('hdlr', zeros(8), handler, zeros(12), [0]),
          box('minf', box('stbl', box('stsd', zeros(4), u32(1), sample))),
        ),
      ),
      ...extra,
    ),
  )
}

/*
  付け足しの品目を持つ AVIF。iinf に絵（av01）と付け足し（EXIF なら Exif、XMP なら mime）、iloc に
  それぞれの場所。EXIF の中身は TIFF の頭までの offset（4 バイト）と TIFF。gps で位置を持たせる。
  inIdat なら付け足しを meta > idat に置き（iloc 版 1・作り方 1）、そうでなければ mdat に置く
  （iloc 版 0。場所はファイルの頭から）
*/
export const avifWithMetadata = ({ gps = true, inIdat = false, xmp = false } = {}) => {
  const extra = xmp
    ? bytes(gps ? XMP : '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')
    : bytes(u32(0), gps ? gpsTiff() : orientationTiff(1))
  const picture = bytes(zeros(16))
  const infe = (id: number, type: string, ...rest: (number[] | string)[]) =>
    box('infe', [2, 0, 0, 0], u16(id), u16(0), type, [0], ...rest)
  const iloc = (pictureAt: number, extraAt: number) =>
    inIdat
      ? box(
          'iloc',
          [1, 0, 0, 0],
          [0x44, 0],
          u16(2),
          [...u16(1), ...u16(0), ...u16(0), ...u16(1), ...u32(pictureAt), ...u32(picture.length)],
          [...u16(2), ...u16(1), ...u16(0), ...u16(1), ...u32(0), ...u32(extra.length)],
        )
      : box(
          'iloc',
          zeros(4),
          [0x44, 0],
          u16(2),
          [...u16(1), ...u16(0), ...u16(1), ...u32(pictureAt), ...u32(picture.length)],
          [...u16(2), ...u16(0), ...u16(1), ...u32(extraAt), ...u32(extra.length)],
        )
  const meta = (pictureAt: number, extraAt: number) =>
    box(
      'meta',
      zeros(4),
      box('hdlr', zeros(8), 'pict', zeros(12), [0]),
      box(
        'iinf',
        zeros(4),
        u16(2),
        infe(1, 'av01'),
        xmp ? infe(2, 'mime', 'application/rdf+xml', [0]) : infe(2, 'Exif'),
      ),
      iloc(pictureAt, extraAt),
      box('iprp', box('ipco', box('ispe', zeros(4), u32(1600), u32(900)))),
      inIdat ? box('idat', extra) : [],
    )
  const ftyp = box('ftyp', 'avif', zeros(4), 'avif', 'mif1', 'miaf')
  // iloc の大きさは場所の値に依らないので、一度組んだ長さから mdat の中身の位置を決める
  const data = ftyp.length + meta(0, 0).length + 8
  return bytes(ftyp, meta(data, data + picture.length), box('mdat', picture, inIdat ? [] : extra))
}

/*
  動画の位置の書き方（mp4 の extra に渡す）。iPhone の写真アプリと QuickTime は meta（QuickTime の
  形。版と印を持たない）の keys に名前・ilst に値、Android は udta > ©xyz、Adobe は udta > XMP_
*/
export const LOCATION_ISO6709 = '+35.6812+139.7671+003.000/'
export const appleLocation = () =>
  box(
    'meta',
    box('hdlr', zeros(8), 'mdta', zeros(12), [0]),
    box('keys', zeros(4), u32(1), box('mdta', 'com.apple.quicktime.location.ISO6709')),
    box(
      'ilst',
      u32(8 + 8 + 8 + LOCATION_ISO6709.length),
      u32(1),
      box('data', u32(1), u32(0), LOCATION_ISO6709),
    ),
  )
export const androidLocation = () =>
  box('udta', box('\u00a9xyz', u16(LOCATION_ISO6709.length), u16(0x15c7), LOCATION_ISO6709))
export const xmpLocation = () => box('udta', box('XMP_', XMP))
// 位置ではない付け足し（作った道具の名前）。これだけなら断らない
export const plainMovieMeta = () =>
  box(
    'meta',
    box('hdlr', zeros(8), 'mdta', zeros(12), [0]),
    box('keys', zeros(4), u32(1), box('mdta', 'com.apple.quicktime.software')),
  )

// 頭のあとを 0 で埋めて、決まった大きさにする（上限を確かめる。種類は頭で決まる）
export const padded = (head: Uint8Array, size: number) => {
  const out = new Uint8Array(size)
  out.set(head)
  return out
}

export const svg = () =>
  bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>')

export const file = (content: Uint8Array, name: string, type: string) =>
  new File([content], name, { type })
