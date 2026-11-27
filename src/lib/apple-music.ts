/*
  柱の底の音楽の札（src/ui/components.tsx の SiteMusic）の曲。持ち主が貼るのは Apple Music の
  曲の URL だけで、曲名・アーティスト名・ジャケットは保存のときに Apple の公開の検索 API
  （iTunes Lookup）から引く（src/routes/admin/site-settings.tsx の resolveMusic）。

  ジャケットはこのサイトの KV に写して配る（music/。src/routes/admin/images.ts の putImage）。
  ページの CSP は img-src 'self' なので、Apple の画像を直に読まない——広げると、外のサイトの
  画像を読む口がどのページにも開く。画像の URL はフォームから受け取らず、Apple の API が
  返した URL だけを、決まった置き場（mzstatic.com）に限って取りに行く。
*/

export type AppleTrackRef = { country: string; id: string }
export type AppleTrack = { title: string; artist: string; artwork: string }
export type LookupResult = { track: AppleTrack } | { problem: 'missing' | 'unreachable' }

// 外への問い合わせの待ちの上限。保存の画面を待たせるので、遅い応答は失敗として扱う
const LOOKUP_TIMEOUT_MS = 5000
// ジャケットの一辺。札は 48px（足元は 32px）で、3倍の画面でも足りる大きさを頼む
const ARTWORK_SIZE = 200
// 取りに行くジャケットの上限（画像の欄の静止画と同じ 1MB）
const ARTWORK_MAX_BYTES = 1_000_000
/*
  Apple の画像の置き場（is1-ssl.mzstatic.com など）。ここ以外へは取りに行かない。転送には
  付いていかない（redirect: 'manual'。Workers は 'error' を持たないので、3xx は失敗として扱う
  ——response.ok が偽になる）
*/
const ARTWORK_HOST = /^is\d{1,2}-ssl\.mzstatic\.com$/
const TRACK_ID = /^\d{1,15}$/

/*
  曲の URL から国と曲の番号を読む。受けるのは曲のリンクの2つの形だけ——ミュージックの
  「共有 → リンクをコピー」が作るアルバムの中の曲（/<国>/album/<名前>/<番号>?i=<曲の番号>）と、
  曲のページ（/<国>/song/<名前>/<曲の番号>）。アルバム・プレイリスト・アーティストは札に
  ならないので受けない
*/
export function appleMusicTrack(url: string): AppleTrackRef | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'music.apple.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    return null
  }
  const [country, kind, ...rest] = parsed.pathname.split('/').filter(Boolean)
  if (!country || !/^[a-z]{2}$/.test(country)) return null
  if (kind === 'album') {
    const id = parsed.searchParams.get('i')
    return id && TRACK_ID.test(id) && rest.length <= 2 ? { country, id } : null
  }
  if (kind === 'song') {
    const id = rest.at(-1)
    return id && TRACK_ID.test(id) && rest.length <= 2 ? { country, id } : null
  }
  return null
}

/*
  KV に写したジャケットの URL（src/routes/admin/images.ts の putImage が付ける形）。描く側も
  これで見る——手で DB に入った値から、外の画像や別の置き場を指す <img> を出さない
*/
export const isMusicArt = (url: string) =>
  /^\/images\/music\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(url)

// Apple の返す名前。空白を詰め、制御文字を含むものは無いものとして扱う
const name = (value: unknown) =>
  typeof value === 'string' && !/\p{Cc}/u.test(value) ? value.trim() : ''

/*
  曲を引く。見つからない（番号が違う・その国のストアに無い）と、届かない（Apple が落ちている・
  遅い）を分けて返す——前者は URL を直してもらい、後者は時間をおいてもらう。
  名前はそのストアの言葉で返る（日本のストアだとアーティスト名がカタカナのことがある）ので、
  呼ぶ側は書いた人の直しを残す
*/
export async function lookupAppleTrack(ref: AppleTrackRef): Promise<LookupResult> {
  const query = new URLSearchParams({ id: ref.id, country: ref.country, entity: 'song' })
  let body: unknown
  try {
    const response = await fetch(`https://itunes.apple.com/lookup?${query}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      redirect: 'manual',
    })
    if (!response.ok) return { problem: 'unreachable' }
    body = await response.json()
  } catch {
    return { problem: 'unreachable' }
  }
  const results = (body as { results?: unknown } | null)?.results
  const found = Array.isArray(results)
    ? (results as Record<string, unknown>[]).find(
        (result) => result?.kind === 'song' && String(result.trackId) === ref.id,
      )
    : undefined
  if (!found) return { problem: 'missing' }
  const title = name(found.trackName)
  const artist = name(found.artistName)
  const artwork = artworkAt(found.artworkUrl100)
  if (!title || !artist || !artwork) return { problem: 'missing' }
  return { track: { title, artist, artwork } }
}

/*
  Apple の返すジャケットの URL を、頼みたい大きさの URL にする（末尾の「100x100bb.jpg」の
  数を替える）。置き場が mzstatic.com の https でなければ使わない
*/
function artworkAt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || !ARTWORK_HOST.test(parsed.hostname)) return null
  const sized = parsed.pathname.replace(
    /\/\d{2,4}x\d{2,4}bb\.(jpg|png|webp)$/,
    `/${ARTWORK_SIZE}x${ARTWORK_SIZE}bb.jpg`,
  )
  if (sized === parsed.pathname) return null
  parsed.pathname = sized
  parsed.search = ''
  return parsed.href
}

/*
  ジャケットを取りに行く。種類はここでは決めない——受け取ったバイトは、画像の欄と同じ検査
  （src/routes/admin/images.ts の pickBlob。中身の先頭のバイトで決め、付け足しを外す）に通す
*/
export async function fetchArtwork(url: string): Promise<ArrayBuffer | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || !ARTWORK_HOST.test(parsed.hostname)) return null
  try {
    const response = await fetch(parsed.href, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      redirect: 'manual',
    })
    if (!response.ok) return null
    const declared = Number(response.headers.get('content-length'))
    if (declared > ARTWORK_MAX_BYTES) return null
    const bytes = await response.arrayBuffer()
    return bytes.byteLength && bytes.byteLength <= ARTWORK_MAX_BYTES ? bytes : null
  } catch {
    return null
  }
}
