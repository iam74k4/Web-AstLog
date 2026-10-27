import type { Context } from 'hono'
import type { AppEnv } from '../../env'
import { isMediaType } from '../../lib/image'

/*
  管理画面からアップロードした画像。KV から出す。

  この URL は KV のキーをそのまま外に開く口なので、キーの形を縛る。いまの KV には
  画像と、公開ページの写しの版の1行（site:version。src/lib/page-cache.ts）が
  同居していて、版の行がここから読めないのはこの縛りのおかげ。縛らないと、
  あとから同じ KV に何かを置いた日に、それが黙って読み出せるようになる。

  通すのは、こちらが付けた名前の2つの置き場だけ——avatars/（メンバーの顔）と
  items/（作品のスクリーンショット）。名前は src/routes/admin/images.ts の
  putImage が付ける形（英数字で始まり、英数字と . _ - だけ）。乱数の長さは見ない——
  いまの 32 字のキーも、それより前に置いた 8 字のキーも同じ形で通る（貼られた URL を
  殺さない）。名前の上限 121 字は、slug（64 字）・乱数・拡張子が収まる長さ。

  置き場を足すときは、ここの ( | ) に1語足すだけにすること。形の検査
  （名前の文字の種類と、/ を1つしか含まないこと）を緩めて通すと、
  置き場の外のキーや、../ で置き場の外を指すキーが届くようになる。

  **この URL はサイトと同じオリジンで配る。** だから中身が画像のふりをした
  文書（SVG の <script>、HTML）だったときに、開いた人のブラウザで走らせない
  ことをここで決める。受け入れは先頭のバイトで5種類に絞ってある
  （src/lib/image.ts）が、それより前に上げたものが KV に残っている。

  - X-Content-Type-Options: nosniff——中身を嗅いで型を読み替えさせない
  - Content-Security-Policy: default-src 'none'; sandbox——直に開かれても
    スクリプトも読み込みも走らない（<img> で埋め込む分には効かず、邪魔もしない）。
    src/index.tsx のヘッダの1本は、ルートが付けた CSP を上書きしない
  - Cross-Origin-Resource-Policy: same-site——ほかのサイトのページには埋め込ませない（使うのは
    このサイトのページだけ）。共有カードを取りに来る SNS のサーバーはブラウザではないので止まらない。
    ヘッダの1本はこれを付けも上書きもしない
  - 画像の5種類と動画（MP4）に無い content-type（以前の image/svg+xml や image/heic）は
    application/octet-stream の添付として返す。画像としては描かせない

  動画のために、範囲の要求（Range: bytes=…）に 206 で答える。iPhone の Safari は範囲で
  取れない動画を再生しない。範囲は1つだけ読み、複数の範囲は無視して全体を返す（許される
  答え方）。中身は KV から全体を読んで切り出す——1本 10MB までなので Worker のメモリに収まる。
*/
const IMAGE_KEY = /^(?:avatars|items)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

export async function serveImage(c: Context<AppEnv>) {
  const key = c.req.path.replace(/^\/images\//, '')
  if (!IMAGE_KEY.test(key)) return c.notFound()

  /*
    キーは置くたびに乱数が付き、同じキーの中身は変わらない（putImage）。だから KV の端の写しを
    1日持たせる（cacheTtl。既定の 60 秒だと、しばらく見られていない画像は毎回中央まで読みに行き、
    初めの1枚に 0.3〜0.5 秒かかっていた）。消した画像がその端に最長1日残るが、ブラウザには
    immutable で1年持たせているので、出回り方は変わらない
  */
  const object = await c.env.MEDIA.getWithMetadata<{ contentType?: string }>(key, {
    type: 'arrayBuffer',
    cacheTtl: 86_400,
  })
  if (!object.value) return c.notFound()

  const type = object.metadata?.contentType
  const headers = {
    ...(isMediaType(type)
      ? { 'content-type': type }
      : { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' }),
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'same-site',
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  }
  const total = object.value.byteLength
  const range = byteRange(c.req.header('range'), total)
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'content-range': `bytes */${total}` },
    })
  }
  if (!range) return new Response(object.value, { headers })
  return new Response(object.value.slice(range.start, range.end + 1), {
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${total}` },
  })
}

/*
  Range の1つの範囲（bytes=始め-終わり・bytes=始め-・bytes=-末尾の長さ）を読む。範囲の
  要求でない・読めない・複数の範囲なら null（全体を 200 で返す）。始めが中身の外なら 416
*/
export function byteRange(
  header: string | undefined,
  total: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const found = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!found || (!found[1] && !found[2])) return null
  if (!found[1]) {
    const suffix = Number(found[2])
    if (suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }
  const start = Number(found[1])
  const end = found[2] ? Math.min(Number(found[2]), total - 1) : total - 1
  if (start >= total) return 'unsatisfiable'
  return start <= end ? { start, end } : null
}
