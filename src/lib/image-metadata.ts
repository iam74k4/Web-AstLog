import {
  ascii,
  type Box,
  boxes,
  exifOrientation,
  findBox,
  readTiff,
  readU16,
  readU16le,
  readU32,
} from './image'

/*
  上げた写真と動画から、絵に要らない付け足し（メタデータ）を外す。取り込みの1本
  （src/routes/admin/images.ts の pickFile）が、種類を決めたあと KV に置く前に通す。

  公開の画像は URL を知る誰にでも1年配る。スマートフォンの写真は EXIF に撮った場所（GPS）・
  日時・機種の製造番号を持ち、家で撮れば家の位置がそのまま出る。iPhone の「JPEG で書き出す」も
  既定では位置を残す。

  - JPEG・PNG・WebP: 付け足しの区画をバイトの並びのまま落とす（絵は描き直さないので画質は
    変わらない）。向き（Orientation）が 1 でなければ、向きだけを持つ最小の EXIF を元の場所に
    置き直す——向きごと外すと、縦に撮った写真が横に寝て出る
  - AVIF・MP4・MOV: 区画を落とすと、中身の位置を指す表（iloc・stco）を組み直すことになる。
    位置を見つけたら置かずに断り（'location'）、外して書き出し直してもらう。位置の無いものは
    そのまま置く
  - GIF: 写真の入れ物ではないので、そのまま

  並びを読めなくなったところ（途中で切れた・長さが合わない）から後ろは、そのまま写す。
  上げるのはログインした持ち主だけで、守る相手は手元の機器が書いた付け足しのうっかりした
  公開。機器が書く並びは読めるので、壊れた並びを直したり断ったりはしない（描けるかは
  ブラウザが決める）。付け足しの無いファイルは同じバイトのまま返す。
*/

export type Cleaned = Uint8Array<ArrayBuffer> | 'location'

export function stripMetadata(type: string, bytes: Uint8Array<ArrayBuffer>): Cleaned {
  switch (type) {
    case 'image/jpeg':
      return stripJpeg(bytes)
    case 'image/png':
      return stripPng(bytes)
    case 'image/webp':
      return stripWebp(bytes)
    case 'image/avif':
      return avifHasLocation(bytes) ? 'location' : bytes
    case 'video/mp4':
      return movieHasLocation(bytes, 0, bytes.length, 0) ? 'location' : bytes
    default:
      return bytes
  }
}

/* ------------------------------------------------------------ 組み立て */

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
const readU32le = (bytes: Uint8Array, at: number) =>
  readU16le(bytes, at) + readU16le(bytes, at + 2) * 0x10000
const text = (value: string) => [...value].map((char) => char.charCodeAt(0))

/*
  向きだけを持つ EXIF（TIFF。MM・IFD0 に Orientation の1項目）。JPEG は頭に Exif\0\0 を足して
  APP1 に、PNG は eXIf、WebP は EXIF のチャンクにそのまま入れる
*/
const orientationTiff = (orientation: number) => [
  ...text('MM'),
  0,
  0x2a,
  ...u32(8),
  ...u16(1),
  ...u16(0x0112),
  ...u16(3),
  ...u32(1),
  ...u16(orientation),
  0,
  0,
  ...u32(0),
]

/* ------------------------------------------------------------ JPEG */

/*
  落とすのは APP1（Exif・XMP）・APP13（IPTC）・APP3〜15（APP14 の Adobe は色の解き方を持つので
  残す）・COM と、APP2 のうち ICC（色の約束）でないもの（MPF・FlashPix）。主画像の終わり（EOI）
  より後ろ（MPF が指すゲインマップ・動く写真の動画・機種の付け足し）も落とす——付け足しの中にも
  位置が入る。MPF はその後ろを指す表なので、後ろと一緒に外す。

  区画は FF xx と長さで進む。画像データ（SOS のあと）は長さを持たないので、次の区画の頭
  （FF のあとが 00 でも RSTn でもない）まで送る。
*/
const ICC = 'ICC_PROFILE\0'

function dropsSegment(bytes: Uint8Array, marker: number, at: number): boolean {
  if (marker === 0xe1 || marker === 0xfe) return true
  if (marker === 0xe2) return ascii(bytes, at + 4, ICC.length) !== ICC
  if (marker === 0xee) return ascii(bytes, at + 4, 5) !== 'Adobe'
  return marker >= 0xe3 && marker <= 0xef
}

// 長さを持たない区画（TEM・RSTn・SOI）
const standalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)

// 画像データの終わり（次の区画の頭）。FF 00 は詰め物、FF D0〜D7 はデータの中の区切り
function scanEnd(bytes: Uint8Array, from: number): number {
  let at = from
  for (;;) {
    at = bytes.indexOf(0xff, at)
    if (at < 0 || at + 1 >= bytes.length) return bytes.length
    const next = bytes[at + 1] ?? 0
    if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) return at
    at += 2
  }
}

function stripJpeg(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  let changed = false
  let orientation = 1
  let exifSlot = -1
  let at = 2
  while (at < bytes.length) {
    const marker = bytes[at + 1] ?? 0
    if (bytes[at] !== 0xff || at + 1 >= bytes.length) {
      parts.push(bytes.subarray(at))
      break
    }
    if (marker === 0xff || standalone(marker)) {
      // 詰め物の FF は1バイト、長さを持たない区画は2バイト
      const size = marker === 0xff ? 1 : 2
      parts.push(bytes.subarray(at, at + size))
      at += size
      continue
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(at, at + 2))
      changed ||= at + 2 < bytes.length
      break
    }
    const end = at + 2 + readU16(bytes, at + 2)
    if (end < at + 4 || end > bytes.length) {
      parts.push(bytes.subarray(at))
      break
    }
    if (dropsSegment(bytes, marker, at)) {
      changed = true
      if (marker === 0xe1 && exifSlot < 0 && ascii(bytes, at + 4, 6) === 'Exif\0\0') {
        orientation = exifOrientation(bytes, at + 10, end)
        exifSlot = parts.length
      }
    } else {
      parts.push(bytes.subarray(at, end))
    }
    at = end
    if (marker === 0xda) {
      const next = scanEnd(bytes, at)
      parts.push(bytes.subarray(at, next))
      at = next
    }
  }
  if (!changed) return bytes
  if (exifSlot >= 0 && orientation !== 1) {
    const exif = [...text('Exif\0\0'), ...orientationTiff(orientation)]
    parts.splice(exifSlot, 0, new Uint8Array([0xff, 0xe1, ...u16(exif.length + 2), ...exif]))
  }
  return concat(parts)
}

/* ------------------------------------------------------------ PNG */

// チャンクは 長さ 4・型 4・中身・CRC 4。IEND より後ろも落とす
const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'])

function stripPng(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  let changed = false
  let orientation = 1
  let exifSlot = -1
  let at = 8
  while (at < bytes.length) {
    const end = at + 12 + readU32(bytes, at)
    if (at + 12 > bytes.length || end > bytes.length) {
      parts.push(bytes.subarray(at))
      break
    }
    const type = ascii(bytes, at + 4, 4)
    if (PNG_DROPPED.has(type)) {
      changed = true
      if (type === 'eXIf' && exifSlot < 0) {
        orientation = exifOrientation(bytes, at + 8, end - 4)
        exifSlot = parts.length
      }
    } else {
      parts.push(bytes.subarray(at, end))
    }
    at = end
    if (type === 'IEND') {
      changed ||= at < bytes.length
      break
    }
  }
  if (!changed) return bytes
  if (exifSlot >= 0 && orientation !== 1) {
    parts.splice(exifSlot, 0, pngChunk('eXIf', orientationTiff(orientation)))
  }
  return concat(parts)
}

function pngChunk(type: string, data: number[]): Uint8Array {
  const body = [...text(type), ...data]
  return new Uint8Array([...u32(data.length), ...body, ...u32(crc32(body))])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(bytes: readonly number[]): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/* ------------------------------------------------------------ WebP */

/*
  RIFF の中のチャンク（型 4・長さ 4（リトルエンディアン）・中身・奇数なら詰め物 1）。EXIF と
  XMP を落とし、拡張の頭（VP8X）の印（EXIF 0x08・XMP 0x04）を下ろし、RIFF の長さを書き直す。
  RIFF の長さより後ろも落とす
*/
function stripWebp(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const declared = 8 + readU32le(bytes, 4)
  const end = declared >= 12 && declared <= bytes.length ? declared : bytes.length
  const parts: Uint8Array[] = [bytes.subarray(0, 12)]
  let changed = end < bytes.length
  let orientation = 1
  let exifSlot = -1
  let at = 12
  while (at < end) {
    const size = readU32le(bytes, at + 4)
    const next = at + 8 + size + (size % 2)
    if (at + 8 > end || next > end) {
      parts.push(bytes.subarray(at, end))
      break
    }
    const type = ascii(bytes, at, 4)
    if (type === 'EXIF' || type === 'XMP ') {
      changed = true
      if (type === 'EXIF' && exifSlot < 0) {
        // 中身は TIFF。頭に Exif\0\0 を付けて書く道具もある
        const tiff = ascii(bytes, at + 8, 6) === 'Exif\0\0' ? at + 14 : at + 8
        orientation = exifOrientation(bytes, tiff, at + 8 + size)
        exifSlot = parts.length
      }
    } else {
      parts.push(bytes.subarray(at, next))
    }
    at = next
  }
  if (!changed) return bytes
  const keptExif = exifSlot >= 0 && orientation !== 1
  if (keptExif) {
    const tiff = orientationTiff(orientation)
    parts.splice(exifSlot, 0, new Uint8Array([...text('EXIF'), ...u32le(tiff.length), ...tiff]))
  }
  const out = concat(parts)
  out.set(u32le(out.length - 8), 4)
  if (ascii(out, 12, 4) === 'VP8X') out[20] = ((out[20] ?? 0) & ~0x0c) | (keptExif ? 0x08 : 0)
  return out
}

/* ------------------------------------------------------------ 位置を探す */

// 位置を持つ EXIF か。IFD0 が GPS の IFD を指し、そこに緯度（2）か経度（4）がある
function exifHasLocation(bytes: Uint8Array, tiff: number, end: number): boolean {
  const reader = readTiff(bytes, tiff, end)
  const pointer = reader?.entry(reader.ifd0, 0x8825)
  if (!reader || pointer == null) return false
  const gps = reader.u32(pointer + 8)
  return reader.entry(gps, 2) !== null || reader.entry(gps, 4) !== null
}

// XMP（文字の RDF）が位置を持つか（exif:GPSLatitude / exif:GPSLongitude）
const xmpHasLocation = (bytes: Uint8Array, start: number, end: number) =>
  includes(bytes, start, end, 'GPSLatitude') || includes(bytes, start, end, 'GPSLongitude')

function includes(bytes: Uint8Array, start: number, end: number, value: string): boolean {
  const first = value.charCodeAt(0)
  for (let at = bytes.indexOf(first, start); at >= 0; at = bytes.indexOf(first, at + 1)) {
    if (at + value.length > end) return false
    if (ascii(bytes, at, value.length) === value) return true
  }
  return false
}

/*
  AVIF（HEIF の入れ物）。EXIF と XMP は絵と同じ「品目」で、meta > iinf が品目の種類（Exif・
  mime）を、meta > iloc が中身の場所（ファイルの頭か idat からの位置と長さ）を持つ。EXIF の
  品目の中身は、TIFF の頭までの offset（4 バイト）のあとに TIFF が続く
*/
function avifHasLocation(bytes: Uint8Array): boolean {
  const meta = findBox(bytes, 0, bytes.length, 'meta')
  if (!meta) return false
  // meta は full box（版と印の 4 バイトのあとに子が続く）
  const iinf = findBox(bytes, meta.body + 4, meta.end, 'iinf')
  const iloc = findBox(bytes, meta.body + 4, meta.end, 'iloc')
  if (!iinf || !iloc) return false
  const kinds = metadataItems(bytes, iinf)
  if (!kinds.size) return false
  const idat = findBox(bytes, meta.body + 4, meta.end, 'idat')
  for (const [id, data] of itemData(bytes, iloc, idat, kinds)) {
    if (kinds.get(id) === 'mime' ? xmpHasLocation(data, 0, data.length) : exifItemHasLocation(data))
      return true
  }
  return false
}

function exifItemHasLocation(data: Uint8Array): boolean {
  let tiff = 4 + readU32(data, 0)
  if (ascii(data, tiff, 6) === 'Exif\0\0') tiff += 6
  return exifHasLocation(data, tiff, data.length)
}

// iinf の品目のうち、EXIF（Exif）と XMP などの文字（mime）の id。infe は版 2 以上だけが種類を持つ
function metadataItems(bytes: Uint8Array, iinf: Box): Map<number, 'Exif' | 'mime'> {
  const kinds = new Map<number, 'Exif' | 'mime'>()
  const first = iinf.body + 4 + ((bytes[iinf.body] ?? 0) === 0 ? 2 : 4)
  for (const infe of boxes(bytes, first, iinf.end)) {
    const version = bytes[infe.body] ?? 0
    if (infe.type !== 'infe' || version < 2) continue
    const id = version === 2 ? readU16(bytes, infe.body + 4) : readU32(bytes, infe.body + 4)
    const type = ascii(bytes, infe.body + (version === 2 ? 8 : 10), 4)
    if (type === 'Exif' || type === 'mime') kinds.set(id, type)
  }
  return kinds
}

/*
  iloc から品目の中身を引く（範囲が分かれていればつなぐ）。欄の幅（offset・長さ・基点・番号）は
  0・4・8 バイトのどれかで、それ以外なら読まない。場所の作り方（construction_method）は
  0 がファイルの頭から、1 が idat の中身から
*/
function itemData(
  bytes: Uint8Array,
  iloc: Box,
  idat: Box | null,
  wanted: ReadonlyMap<number, unknown>,
): Map<number, Uint8Array> {
  const found = new Map<number, Uint8Array>()
  const version = bytes[iloc.body] ?? 0
  const sizes = bytes[iloc.body + 4] ?? 0
  const more = bytes[iloc.body + 5] ?? 0
  const indexed = version === 1 || version === 2
  const offsetSize = sizes >> 4
  const lengthSize = sizes & 0x0f
  const baseSize = more >> 4
  const indexSize = indexed ? more & 0x0f : 0
  if (![offsetSize, lengthSize, baseSize, indexSize].every((size) => [0, 4, 8].includes(size))) {
    return found
  }
  let at = iloc.body + 6
  const field = (size: number) => {
    const value =
      size === 0
        ? 0
        : size === 4
          ? readU32(bytes, at)
          : readU32(bytes, at) === 0
            ? readU32(bytes, at + 4)
            : Number.POSITIVE_INFINITY
    at += size
    return value
  }
  const count = version === 2 ? field(4) : readU16(bytes, at)
  if (version !== 2) at += 2
  for (let item = 0; item < count && at < iloc.end; item += 1) {
    const id = version === 2 ? field(4) : readU16(bytes, at)
    if (version !== 2) at += 2
    const method = indexed ? readU16(bytes, at) & 0x0f : 0
    // 版 1・2 の作り方 2 バイトと、data_reference_index 2 バイト
    at += indexed ? 4 : 2
    const base = field(baseSize)
    // 欄の幅がどれも 0 なら範囲は先へ進まない。同じ範囲を何万回も読まないよう 1 つで止める
    const extents = offsetSize + lengthSize + indexSize ? readU16(bytes, at) : 1
    at += 2
    const parts: Uint8Array[] = []
    for (let extent = 0; extent < extents && at < iloc.end; extent += 1) {
      field(indexSize)
      const offset = field(offsetSize)
      const length = field(lengthSize)
      const origin = method === 0 ? 0 : method === 1 && idat ? idat.body : null
      if (origin === null) continue
      const from = origin + base + offset
      const to = length === 0 ? (method === 1 && idat ? idat.end : bytes.length) : from + length
      if (from <= to && to <= bytes.length) parts.push(bytes.subarray(from, to))
    }
    if (wanted.has(id) && parts.length) found.set(id, concat(parts))
  }
  return found
}

/*
  MP4・MOV（ISO BMFF / QuickTime）。位置の書き方は3つあり、どれも moov の下の付け足しの箱に
  入る（中身の mdat は読まない）——
  - iPhone の写真アプリと QuickTime: meta > keys の com.apple.quicktime.location.ISO6709
  - Android と以前の QuickTime: udta > ©xyz（「+35.6812+139.7671/」の文字）。3GPP の loci も
  - Adobe などの XMP: udta > XMP_ か、XMP の uuid の箱
  meta は ISO の形（版と印の 4 バイトのあとに hdlr）と QuickTime の形（すぐ hdlr）があるので、
  中の最初の箱が hdlr と読める方を採る
*/
const LOCATION_KEY = 'com.apple.quicktime.location.ISO6709'
const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
]
const MOVIE_CONTAINERS = new Set(['moov', 'trak', 'udta', 'ilst'])

function movieHasLocation(bytes: Uint8Array, start: number, end: number, depth: number): boolean {
  if (depth > 6) return false
  for (const box of boxes(bytes, start, end)) {
    switch (box.type) {
      case '©xyz':
      case 'loci':
        return true
      case 'keys':
        if (includes(bytes, box.body, box.end, LOCATION_KEY)) return true
        break
      case 'XMP_':
        if (xmpHasLocation(bytes, box.body, box.end)) return true
        break
      case 'uuid':
        if (
          XMP_UUID.every((byte, index) => bytes[box.body + index] === byte) &&
          xmpHasLocation(bytes, box.body + 16, box.end)
        )
          return true
        break
      case 'meta': {
        const first = ascii(bytes, box.body + 4, 4) === 'hdlr' ? box.body : box.body + 4
        if (movieHasLocation(bytes, first, box.end, depth + 1)) return true
        break
      }
      default:
        if (MOVIE_CONTAINERS.has(box.type) && movieHasLocation(bytes, box.body, box.end, depth + 1))
          return true
    }
  }
  return false
}
