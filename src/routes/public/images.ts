import type { Context } from 'hono'
import type { AppEnv } from '../../env'
import { isImageType } from '../../lib/image'

/*
  管理画面からアップロードした画像。KV から出す。

  この URL は KV のキーをそのまま外に開く口なので、キーの形を縛る。いまの KV には
  画像と、公開ページの写しの版の1行（site:version。src/lib/page-cache.ts）が
  同居していて、版の行がここから読めないのはこの縛りのおかげ。縛らないと、
  あとから同じ KV に何かを置いた日に、それが黙って読み出せるようになる。

  通すのは、こちらが付けた名前の2つの置き場だけ——avatars/（メンバーの顔）と
  items/（作品のスクリーンショット）。名前は src/routes/admin/images.ts の
  putImage が付ける形（英数字で始まり、英数字と . _ - だけ）。

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
  - 5種類に無い content-type（以前の image/svg+xml や image/heic）は
    application/octet-stream の添付として返す。画像としては描かせない
*/
const IMAGE_KEY = /^(?:avatars|items)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

export async function serveImage(c: Context<AppEnv>) {
  const key = c.req.path.replace(/^\/images\//, '')
  if (!IMAGE_KEY.test(key)) return c.notFound()

  const object = await c.env.MEDIA.getWithMetadata<{ contentType?: string }>(key, 'arrayBuffer')
  if (!object.value) return c.notFound()

  const type = object.metadata?.contentType
  return new Response(object.value, {
    headers: {
      ...(isImageType(type)
        ? { 'content-type': type }
        : { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' }),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
