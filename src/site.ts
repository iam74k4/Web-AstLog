import { appleMusicTrack, isMusicArt } from './lib/apple-music'
import { isHttpsUrl } from './lib/format'

/*
  ブランドと公開先はデプロイの設定。紹介文と連絡先は settings に保存し、
  管理画面の「サイト設定」から変更する。空の DB に個人の連絡先を埋め込まない。
*/
export const SITE = {
  name: 'AstLog',
  origin: 'https://astlog.dev',
  tagline: 'つくったものを、ひとつずつ記録する。',
  // 入口の大見出しの下のリード文。空なら出さない（説明文は名前と肩書きだけで組む）
  heroLead: '',
  // 入口の大見出しの下で打ち替える言葉（1行に1つ）。空なら出さない
  heroRoles: '',
  contactLead: 'お仕事のご相談や取り組みについて、話しませんか。',
  email: '',
  github: '',
  instagram: '',
  x: '',
  // Discord のユーザー名（@ は付けない）。Contact に字で出す
  discord: '',
  /*
    Discord を開く URL（プロフィール https://discord.com/users/<数字の ID> か招待リンク）。
    ユーザー名からは開ける URL が作れないので、開けるようにするならこちらを入れる。空なら
    足元の印は Contact の Discord の行へ送る
  */
  discordUrl: '',
  /*
    Contact の受付状況（Availability）。状態は AVAILABILITY の鍵か空（状態の行を出さない）。
    返信の目安・連絡のつく時間・進め方は書いた行だけ出す。4つとも空なら Availability ごと出さない
  */
  availability: '',
  availabilityReply: '',
  availabilityHours: '',
  availabilityFormat: '',
  // Contact の相談の流れ（How it works）。1行 = 「見出し | 説明」（parsePairs）。空なら出さない
  contactSteps: '',
  /*
    柱の底の音楽の札（components.tsx の SiteMusic）。曲は MUSIC_MAX 曲まで、4つの欄の同じ行が
    1曲（1行に1曲。musicTracks）。書くのは Apple Music の曲の URL だけで、曲名・アーティスト名・
    ジャケットは保存のときに Apple から引く（src/lib/apple-music.ts）。名前は直せる（日本の
    ストアだとアーティスト名がカタカナで返ることがある）。ジャケットは KV に写した画像の URL で、
    フォームからは受け取らない。揃わない曲は札に出さない（shownMusic）
  */
  musicUrl: '',
  musicTitle: '',
  musicArtist: '',
  musicArt: '',
} as const

/*
  受付状況の状態。公開ページの文はここで決め、管理画面では選ぶだけにする——状態は
  よく変わるので、変えるたびに文を書き直させない（概要の「受付状況」から1回の保存で
  変えられる。src/routes/admin/dashboard.tsx）。label は管理画面の選択肢、text は公開
  ページの文。状態は字で言う（点の形だけで分けない）
*/
export const AVAILABILITY = {
  open: { label: '受付中', text: '新しいご相談を受け付けています' },
  later: {
    label: '受付中（着手は先）',
    text: 'ご相談は受け付けています（着手は少し先になります）',
  },
  closed: { label: '受付を止めている', text: 'いまは新しいご依頼を受け付けていません' },
} as const
export type AvailabilityState = keyof typeof AVAILABILITY
export const isAvailabilityState = (value: string): value is AvailabilityState =>
  Object.hasOwn(AVAILABILITY, value)

// 受付状況の欄（概要の「受付状況」が保存するのはこの4つだけ）
export const AVAILABILITY_KEYS = [
  'availability',
  'availabilityReply',
  'availabilityHours',
  'availabilityFormat',
] as const

// 音楽の札の欄（ジャケットの musicArt はフォームから受け取らない。readSiteForm）
export const MUSIC_KEYS = ['musicUrl', 'musicTitle', 'musicArtist', 'musicArt'] as const

/*
  足元の行き先は GitHub → Instagram → X → Discord → Mail の順（components.tsx の Socials）。
  Contact のページを出すかを決めるのはメール・GitHub・Discord（hasContact）——Instagram と X は
  ほかの手に添える行き先で、それだけではページを作らない
*/
export const SITE_SETTING_KEYS = [
  'tagline',
  'heroLead',
  'heroRoles',
  'contactLead',
  'email',
  'github',
  'instagram',
  'x',
  'discord',
  'discordUrl',
  ...AVAILABILITY_KEYS,
  'contactSteps',
  ...MUSIC_KEYS,
] as const
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number]

/*
  あとから足した欄（入口の打ち替える言葉・Instagram・X・Discord・受付状況・相談の流れ・音楽）。既定は空（出さない）なので、行がまだ無くても管理画面の
  概要では「保存済み」に数える——欄を足した日に、保存済みのサイトが「一部保存済み」に戻らない
  ように（src/routes/admin/dashboard.tsx）
*/
export const SITE_SETTING_LATER_KEYS: readonly SiteSettingKey[] = [
  'heroRoles',
  'instagram',
  'x',
  'discord',
  'discordUrl',
  ...AVAILABILITY_KEYS,
  'contactSteps',
  ...MUSIC_KEYS,
]
export type SiteSettings = Record<SiteSettingKey, string>

// 大きな見出しと表紙の文は、管理画面から変えても既存のレイアウトに収まる長さにする。
export const SITE_SETTING_LIMITS = {
  tagline: 80,
  heroLead: 160,
  // 4つ × 24 字と改行（フォームからは \r\n で届く）。1つの言葉の長さは HERO_ROLES が見る
  heroRoles: 110,
  contactLead: 120,
  email: 254,
  github: 2048,
  instagram: 2048,
  x: 2048,
  discord: 32,
  discordUrl: 200,
  availability: 16,
  // 受付状況の行は札（Response・Hours・Format）の横の1行。短い言い切りで書く長さ
  availabilityReply: 40,
  availabilityHours: 60,
  availabilityFormat: 60,
  contactSteps: 1200,
  // 音楽の4つの欄は1行に1曲を並べた全体の長さ。1曲ずつは musicProblems が見る
  musicUrl: 10_250,
  musicTitle: 250,
  musicArtist: 250,
  musicArt: 1_000,
} as const

// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を弾くのがこの検査の目的
const CONTROL = /[\u0000-\u001f\u007f]/
// 改行だけは通す（1行に1つ書く欄）
// biome-ignore lint/suspicious/noControlCharactersInRegex: 同上
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/

/*
  入口で打ち替える言葉（components.tsx の TypedWords）。言葉は4つまで、1つの言葉は半角で
  24 字（全角は2字に数える）まで——打っている途中で行が変わらないよう改行させずに組むので、
  電話の幅（390）の大見出しの段（--fs-display-xs）で1行に収まる長さで止める
*/
export const HERO_ROLES = { words: 4, width: 24 } as const
// 字の幅。半角を 1、それ以外（全角）を 2 と数える
const textWidth = (word: string) =>
  [...word].reduce((sum, letter) => sum + (/[\u0020-\u007e]/.test(letter) ? 1 : 2), 0)

/*
  音楽の札の名前の幅の上限（半角で数え、全角は2字）。札は柱の目次と行き先のあいだの余りに
  置き、余りが札より狭い窓では畳む（app.css の @container music-slot）。いちばん狭い柱
  （161px）でも、曲名は3行・アーティスト名は2行までに収まる長さにして、畳む高さを1つに決める。
  Apple の名前が長いとき（feat. や Remastered の付いたもの）は、欄で短くしてもらう
*/
export const MUSIC_NAME_WIDTH = { musicTitle: 40, musicArtist: 24 } as const

/*
  音楽の札に並べる曲の数の上限。札は 4 秒ごとに1曲ずつ横へ送り（app.css の music-art-<数>）、
  入れ替わりの動きは曲の数ごとに書いてあるので、上限を変えるならそこも一緒に
*/
export const MUSIC_MAX = 5
// 1曲の URL・Apple Music の曲のページの URL の長さ
export const MUSIC_URL_MAX = 2048

export type MusicTrack = { url: string; title: string; artist: string; art: string }

// 4つの欄の同じ行を1曲に組む（URL の無い行は曲にならない）
export function musicTracks(
  site: Pick<SiteSettings, 'musicUrl' | 'musicTitle' | 'musicArtist' | 'musicArt'>,
): MusicTrack[] {
  const lines = (value: string) => value.split(/\r?\n/)
  const titles = lines(site.musicTitle)
  const artists = lines(site.musicArtist)
  const arts = lines(site.musicArt)
  return lines(site.musicUrl)
    .map((url, index) => ({
      url: url.trim(),
      title: (titles[index] ?? '').trim(),
      artist: (artists[index] ?? '').trim(),
      art: (arts[index] ?? '').trim(),
    }))
    .filter((track) => track.url)
}

// 保存済みの曲（同じ URL）のジャケットを重ねる。ほかは空（まだ引いていない・片付けた）
export const musicWithArt = (tracks: readonly MusicTrack[], saved: readonly MusicTrack[]) =>
  tracks.map((track) => ({ ...track, art: saved.find((one) => one.url === track.url)?.art ?? '' }))

// 曲の並びを4つの欄に戻す（1行に1曲）
export const musicFields = (tracks: readonly MusicTrack[]) => ({
  musicUrl: tracks.map((track) => track.url).join('\n'),
  musicTitle: tracks.map((track) => track.title).join('\n'),
  musicArtist: tracks.map((track) => track.artist).join('\n'),
  musicArt: tracks.map((track) => track.art).join('\n'),
})
export const heroRoleWords = (site: Pick<SiteSettings, 'heroRoles'>) =>
  site.heroRoles
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter(Boolean)

/*
  mailto にヘッダや複数の宛先を混ぜさせない。空は連絡先を掲載しない指定。
  % も通さない——%2C（,）や %3F（?）は、宛先を分けたあとで読む決まり（RFC 6068）でも、
  先に読んで宛先を2つにするメールソフトがある。ドメインは「.」で区切った空でない語の
  並びとして読む（同じ字を2つの部分で取り合う書き方にすると、長い入力で読むのが遅くなる）
*/
export const isContactEmail = (email: string) =>
  /^[^\s@?&#,;%]+@[^\s@?&#,;%.]+(?:\.[^\s@?&#,;%.]+)+$/.test(email) &&
  !CONTROL.test(email) &&
  !/[<>"\\]/.test(email)

/*
  Discord のユーザー名（2〜32 字の英数字・_・.）。@ と旧来の #0000 は付けない。名前から開ける
  URL は無いので、Contact に字で出す。開く URL（discordUrl）が無ければ、足元の印はその行
  （/contact#discord）へ送る
*/
export const isDiscordName = (name: string) => /^[a-z0-9_.]{2,32}$/i.test(name)

/*
  Discord を開く URL。Discord のプロフィール（数字の ID）か招待リンクだけを通す——どこへでも
  行ける URL にすると、Discord の印から別のサイトへ出る。query やフラグメントも持たせない
*/
export const isDiscordUrl = (url: string) =>
  /^https:\/\/(?:(?:www\.)?discord\.com\/(?:users\/\d{15,21}|invite\/[A-Za-z0-9-]{2,32})|discord\.gg\/[A-Za-z0-9-]{2,32})\/?$/.test(
    url,
  )

/*
  サイトに連絡の手があるか。Contact のページを出すかを決める（src/blocks.ts の blockShown）。
  形の通らない値は無いものとして数える——描く部品（components.tsx の Contact）も同じ検査で落とす
*/
export const hasContact = (
  site: Pick<SiteSettings, 'email' | 'github' | 'discord' | 'discordUrl'>,
) =>
  isContactEmail(site.email) ||
  isHttpsUrl(site.github) ||
  isDiscordName(site.discord) ||
  isDiscordUrl(site.discordUrl)

/*
  音楽の札に出す曲。曲の URL・曲名・アーティスト名・KV に写したジャケットの4つが揃った曲だけを、
  上限まで（描く部品 components.tsx の SiteMusic が使う）。URL の形・名前の字・ジャケットの置き場は
  ここでも見る——手で DB に入った値から、外の画像や別の置き場を指す <img> を出さない
*/
export const shownMusic = (
  site: Pick<SiteSettings, 'musicUrl' | 'musicTitle' | 'musicArtist' | 'musicArt'>,
) =>
  musicTracks(site)
    .filter(
      (track) =>
        Boolean(appleMusicTrack(track.url)) &&
        Boolean(track.title) &&
        Boolean(track.artist) &&
        !CONTROL.test(track.title + track.artist) &&
        isMusicArt(track.art),
    )
    .slice(0, MUSIC_MAX)

export const hasMusic = (
  site: Pick<SiteSettings, 'musicUrl' | 'musicTitle' | 'musicArtist' | 'musicArt'>,
) => shownMusic(site).length > 0

/*
  曲の並びの検査。何曲目の何が通らないかを1つの知らせにまとめる（管理画面の欄は曲ごとの行で、
  知らせは行の並びの下に1つ。AdminForm.tsx の MusicRows）。名前が空なのは通す——保存のときに
  Apple から引く（site-settings.tsx の resolveMusic）
*/
export function musicProblems(tracks: readonly MusicTrack[]): string | null {
  const problems: string[] = []
  if (tracks.length > MUSIC_MAX) problems.push(`曲は ${MUSIC_MAX} 曲までにしてください`)
  tracks.forEach((track, index) => {
    const at = `${index + 1} 曲目`
    if (
      [...track.url].length > MUSIC_URL_MAX ||
      CONTROL.test(track.url) ||
      !appleMusicTrack(track.url)
    ) {
      problems.push(
        `${at}: Apple Music の曲の URL を入れてください（ミュージックで曲の「共有 → リンクをコピー」。アルバムやプレイリストのリンクは使えません）`,
      )
    } else if (tracks.findIndex((other) => other.url === track.url) < index) {
      problems.push(`${at}: 同じ曲がもう並んでいます`)
    }
    for (const [key, name] of [
      ['musicTitle', '曲名'],
      ['musicArtist', 'アーティスト名'],
    ] as const) {
      const value = key === 'musicTitle' ? track.title : track.artist
      const width = MUSIC_NAME_WIDTH[key]
      if (CONTROL.test(value)) problems.push(`${at}: ${name}に改行や制御文字を含めないでください`)
      else if (textWidth(value) > width) {
        problems.push(
          `${at}: ${name}は半角 ${width} 字（全角 ${width / 2} 字）までにしてください。柱の幅に収まる長さです（Apple Music の名前が長いときは、ここで短くして保存します。例: (feat. …) を外す）`,
        )
      }
    }
    if (track.art && !isMusicArt(track.art)) {
      problems.push(`${at}: ジャケットを読み直してください（曲の URL を入れ直して保存）`)
    }
  })
  return problems.length ? `${problems.join('。')}。` : null
}

export function siteSettingsErrors(site: SiteSettings): Record<string, string> | null {
  const errors: Record<string, string> = {}
  for (const key of SITE_SETTING_KEYS) {
    if ((MUSIC_KEYS as readonly string[]).includes(key)) continue
    if ([...site[key]].length > SITE_SETTING_LIMITS[key]) {
      errors[key] = `${SITE_SETTING_LIMITS[key]} 字までにしてください`
    }
  }
  for (const key of ['tagline', 'contactLead'] as const) {
    if (!site[key]) errors[key] = '文を入れてください'
  }
  for (const key of [
    'tagline',
    'heroLead',
    'contactLead',
    'availabilityReply',
    'availabilityHours',
    'availabilityFormat',
  ] as const) {
    if (CONTROL.test(site[key])) errors[key] = '改行や制御文字を含めないでください'
  }
  const music = musicProblems(musicTracks(site))
  if (music) errors.music = music
  if (site.availability && !isAvailabilityState(site.availability)) {
    errors.availability = '受付の状態を選び直してください'
  }
  if (CONTROL_BUT_NEWLINE.test(site.contactSteps))
    errors.contactSteps = '制御文字を含めないでください'
  const roles = heroRoleWords(site)
  if (CONTROL_BUT_NEWLINE.test(site.heroRoles)) errors.heroRoles = '制御文字を含めないでください'
  else if (roles.length > HERO_ROLES.words) {
    errors.heroRoles = `言葉は ${HERO_ROLES.words} つまでにしてください`
  } else if (roles.some((word) => textWidth(word) > HERO_ROLES.width)) {
    errors.heroRoles = `1つの言葉は半角 ${HERO_ROLES.width} 字（全角 ${HERO_ROLES.width / 2} 字）までにしてください`
  }
  if (site.email && !isContactEmail(site.email)) errors.email = 'メールアドレスを1つ入れてください'
  for (const key of ['github', 'instagram', 'x'] as const) {
    if (site[key] && !isHttpsUrl(site[key])) errors[key] = 'https:// で始まる URL を入れてください'
  }
  if (site.discord && !isDiscordName(site.discord)) {
    errors.discord =
      'Discord のユーザー名を入れてください（英数字・_・. の 2〜32 字。@ は付けない）'
  }
  if (site.discordUrl && !isDiscordUrl(site.discordUrl)) {
    errors.discordUrl =
      'Discord のプロフィール（https://discord.com/users/数字の ID）か招待リンク（https://discord.gg/…）を入れてください'
  }
  return Object.keys(errors).length ? errors : null
}

/*
  読む側でも検査する。手動で DB に入った値や、検査を通る前の古い値から
  メールや URL を組み立てない。未設定だけ既定文に戻し、空の連絡先は空のまま。
*/
export function normalizeSiteSettings(raw: Partial<SiteSettings>): SiteSettings {
  const site = Object.fromEntries(
    SITE_SETTING_KEYS.map((key) => {
      const value = raw[key] ?? SITE[key]
      // 音楽の欄は1行に1曲で、行の位置が曲を組む。全体を trim すると、空の行が抜けて曲がずれる
      return [key, (MUSIC_KEYS as readonly string[]).includes(key) ? value : value.trim()]
    }),
  ) as SiteSettings
  const errors = siteSettingsErrors(site)
  if (errors) {
    for (const key of SITE_SETTING_KEYS) if (errors[key]) site[key] = SITE[key]
  }
  return site
}
