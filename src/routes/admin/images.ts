import { newToken } from '../../lib/auth'
import { toSlug } from '../../lib/format'
import { IMAGE_LABELS, type SniffedImage, sniffImage, sniffVideo } from '../../lib/image'
import { archiveImage } from '../../lib/media-retention'
import { MEDIA_QUOTA_BYTES, mediaUsage, megabytes } from '../../lib/media-usage'

/*
  1枚（1本）の上限。種類ごとに決める——静止画は 1MB、動く GIF は 3MB、動画は 10MB。
  判定の前に、その欄で受けうるいちばん大きい上限（file.size）で先に止め、大きなファイルを
  読み込まない。全部の欄を合わせた1回の送信の上限は src/routes/admin/request.ts の
  readAdminForm（Worker のメモリに収める）
*/
export const IMAGE_MAX_BYTES = 1_000_000
export const GIF_MAX_BYTES = 3_000_000
export const VIDEO_MAX_BYTES = 10_000_000

// 欄の案内に添える上限（フォームの field__hint）
export const IMAGE_LIMIT_NOTE = `${IMAGE_LABELS}（1MB まで。GIF は 3MB まで）`
export const SHOT_LIMIT_NOTE = `${IMAGE_LIMIT_NOTE}・動画は MP4（H.264）で 10MB まで`

/*
  画像は KV に置く。R2 が未有効なのと、画像は読むばかりで書き換えが稀なため。
  置き場は2つ——メンバーの顔（avatars/）と作品のスクリーンショット（items/）。
  取り込みの経路と検査（種類と大きさ）は1本で、置き場の名前だけが違う。

  種類は中身の先頭のバイトで決める（src/lib/image.ts の sniffImage）。ブラウザが
  名乗る file.type は見ない——image/png を名乗った SVG を名乗りのまま保存して
  配ると、開いた人のブラウザがこのサイトのオリジンでスクリプトを走らせる。
  通すのは PNG・JPEG・WebP・AVIF・GIF だけで、SVG と HEIC は理由を添えて弾く。作品の
  ほかの画像の欄（pickImages）だけは MP4（H.264）の動画も通す（src/lib/image.ts の sniffVideo）。

  検査（pickImage）と書き込み（putImage）を分けてあるのは、作品のフォームが
  「画像があるか」を知ってから保存してよいかを決めるため（代替テキストの
  要否）。検査に通っただけの画像は、まだどこにも書いていない——弾かれた
  保存で KV に孤児の画像を残さない。

  戻り値で「選ばれていない」と「弾いた」を区別する。同じ null にすると、
  大きすぎる画像を選んだ人に「保存しました」と出てしまう。
*/
type ImageFolder = 'avatars' | 'items'
export type PickedImage = SniffedImage & { bytes: ArrayBuffer }
type Picked = { image: PickedImage | null; error?: string }

const IMAGE_TYPE_ERROR = `${IMAGE_LABELS} の画像を選んでください（SVG と HEIC は受け付けません。iPhone の写真は JPEG で書き出してください）`
const SHOT_TYPE_ERROR = `${IMAGE_LABELS} の画像か、MP4（H.264）の動画を選んでください（SVG・HEIC・MOV は受け付けません）`
const IMAGE_SIZE_ERROR = '画像は 1MB まで（GIF は 3MB まで）です。小さくしてから選び直してください'
const VIDEO_SIZE_ERROR = '動画は 10MB までです。短くするか小さくしてから選び直してください'
const VIDEO_ERRORS = {
  quicktime: 'MOV（QuickTime）の動画は受け付けません。MP4（H.264）で書き出してください',
  hevc: 'HEVC（H.265）の動画は Chrome などで再生できません。MP4（H.264）で書き出してください',
  codec: 'この動画の形式は受け付けません。MP4（H.264）で書き出してください',
} as const

async function pickFile(file: File | string | null, video = false): Promise<Picked> {
  if (!(file instanceof File) || file.size === 0) return { image: null }
  if (file.size > (video ? VIDEO_MAX_BYTES : GIF_MAX_BYTES)) {
    return { image: null, error: video ? VIDEO_SIZE_ERROR : IMAGE_SIZE_ERROR }
  }
  const bytes = await file.arrayBuffer()
  const view = new Uint8Array(bytes)
  const sniffed = sniffImage(view)
  if (sniffed) {
    const limit = sniffed.type === 'image/gif' ? GIF_MAX_BYTES : IMAGE_MAX_BYTES
    if (bytes.byteLength > limit) return { image: null, error: IMAGE_SIZE_ERROR }
    return { image: { ...sniffed, bytes } }
  }
  if (!video) return { image: null, error: IMAGE_TYPE_ERROR }
  const clip = sniffVideo(view)
  if (!clip) return { image: null, error: SHOT_TYPE_ERROR }
  if ('problem' in clip) return { image: null, error: VIDEO_ERRORS[clip.problem] }
  return { image: { ...clip.video, bytes } }
}

// アバター・作品のメインの画像とアイコン。画像だけ（動画は作品のほかの画像の欄だけ）
export const pickImage = (form: FormData, field: string): Promise<Picked> =>
  pickFile(form.get(field))

/*
  同じ名前の欄が並ぶとき（作品のほかの画像の、追加の欄）。欄の順に1つずつ同じ検査を
  通す。空の欄も「選ばれていない」として並びに残す——並んだ代替テキストの欄と、
  何番目かで組にするため
*/
export const pickImages = (form: FormData, field: string): Promise<Picked[]> =>
  Promise.all(form.getAll(field).map((file) => pickFile(file, true)))

/*
  キーは /images/ 側の検査（src/routes/public/images.ts の IMAGE_KEY——置き場の
  名前 / 英数字で始まり英数字と . _ - だけ）を必ず通る形にする。name は
  slug から作るので toSlug を通す（空なら置き場ごとの控えの名前）。
  拡張子と content-type は判定の結果から付ける（名乗りを KV に入れない）。
*/
export async function putImage(
  kv: KVNamespace,
  image: PickedImage,
  folder: ImageFolder,
  name: string,
) {
  const fallback = folder === 'avatars' ? 'member' : 'item'
  const key = `${folder}/${toSlug(name) || fallback}-${newToken(4)}.${image.extension}`
  // 大きさも添える（容量を数えるとき、中身を読まずに一覧の metadata だけで足せる。src/lib/media-usage.ts）
  await kv.put(key, image.bytes, {
    metadata: { contentType: image.type, size: image.bytes.byteLength },
  })
  return `/images/${key}`
}

/*
  置く前に容量を確かめる（上限は src/lib/media-usage.ts の MEDIA_QUOTA_BYTES）。上げるものが
  無ければ KV の一覧を引かない。超えるなら、選んだ欄のうち最初の欄に理由を付けて止める
  （どの欄も KV にはまだ書いていない）。差し替えで外れる前の画像は保存のあと控え（数えない）へ
  移るが、ここでは差し引かない——上限の近くで差し替えるときは、先に外して保存する
*/
export async function quotaErrors(
  kv: KVNamespace,
  picks: readonly (readonly [field: string, image: PickedImage | null])[],
): Promise<Record<string, string> | null> {
  const chosen = picks.filter((pick): pick is readonly [string, PickedImage] => pick[1] !== null)
  const incoming = chosen.reduce((sum, [, image]) => sum + image.bytes.byteLength, 0)
  const field = chosen[0]?.[0]
  if (!field) return null
  const { used } = await mediaUsage(kv)
  if (used + incoming <= MEDIA_QUOTA_BYTES) return null
  return {
    [field]: `画像と動画の容量の上限（${megabytes(MEDIA_QUOTA_BYTES)}）を超えます（使っているのは ${megabytes(used)}、足すのは ${megabytes(incoming)}）。使わない画像を外して保存してから、選び直してください`,
  }
}

/*
  差し替え・外す・削除で使われなくなった画像は KV に残さない。
  残すと、URL を知っている人がいつまでも取得できる。

  消すのはこちらが上げた画像（/images/<置き場>/…）だけ。同梱の /assets/… や
  外の URL は KV に無いので触らない。
*/
export async function removeImage(kv: KVNamespace, url: string | null | undefined) {
  if (!url || !/^\/images\/(avatars|items)\//.test(url)) return
  await kv.delete(url.replace('/images/', ''))
}

/*
  D1 に書けたあとで、使われなくなった画像をまとめて消す（差し替え・外す・削除）。1枚ずつ
  消し、消せなかった画像は記録だけ残して続ける——D1 はもう書けているので、片付けの失敗で
  保存を 500 にしない。1枚の失敗で残りを消し損ねない（作品は1度の保存で何枚も外せる）
*/
export async function discardImages(kv: KVNamespace, urls: readonly (string | null | undefined)[]) {
  for (const url of urls) {
    if (!url || !/^\/images\/(avatars|items)\//.test(url)) continue
    try {
      // 控えが取れなければ原本を消さない。公開URLからは外し、控えは別の名前で期限付きにする。
      await archiveImage(kv, url.replace('/images/', ''))
      await removeImage(kv, url)
    } catch (error) {
      console.error('media-retirement-failed', error)
    }
  }
}

/*
  KV と D1 は1つのトランザクションにできない。だから順序で守る。

  1. 新しい画像を KV に置く（putImage）
  2. D1 を書く（write）。ここで落ちたら、1 で置いた画像を全部消してから投げ直す
     ——どの行からも指されない画像を KV に残さない。作品はメインの画像・アイコン・
     ほかの画像を1度の保存で何枚も置くので、placed は置いた URL の並び
  3. D1 が通ってから、使われなくなった前の画像を消す（呼ぶ側。removeImage）

  逆（D1 を先に書いて、あとで KV に置く）にすると、KV で落ちたときに D1 が
  無い画像を指したまま残り、公開ページに壊れた画像が出る。前の画像を D1 より
  先に消しても同じことが起きる。

  片付けの失敗は元の失敗を隠さない（記録だけ残して、元の例外を投げる）。
*/
export async function commitWithImage<T>(
  kv: KVNamespace,
  placed: string | null | readonly (string | null)[],
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    const urls = Array.isArray(placed) ? placed : [placed]
    for (const url of urls) {
      if (url) await removeImage(kv, url).catch((cleanup) => console.error(cleanup))
    }
    throw error
  }
}

/*
  選んだ画像を受け取らずに戻すときの知らせ。ブラウザはファイルの欄を描き直せ
  ないので、何も言わないと「選んだ画像も保存された」と読める。保存を止めた
  ときは KV にも書いていない（putImage は検査が全部通ってから）。
  アバターと作品の画像で同じ（field が欄の名前）。
*/
export const imageNotKept = (
  form: FormData,
  field: string | readonly string[],
  errors: Record<string, string>,
) => {
  let kept = errors
  for (const name of Array.isArray(field) ? field : [field]) {
    const chosen = form.getAll(name).some((file) => file instanceof File && file.size > 0)
    if (kept[name] || !chosen) continue
    kept = {
      ...kept,
      [name]: '画像はまだ保存していません。直したあとで、もう一度選んでください',
    }
  }
  return kept
}
