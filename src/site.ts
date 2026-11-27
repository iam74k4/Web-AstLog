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
  // Discord のユーザー名（@ は付けない）。名前から開ける URL が無いので、Contact に字で出す
  discord: '',
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
    柱の底の音楽の札（components.tsx の SiteMusic）。書くのは Apple Music の曲の URL だけで、
    曲名・アーティスト名・ジャケットは保存のときに Apple から引く（src/lib/apple-music.ts）。
    名前は直せる（日本のストアだとアーティスト名がカタカナで返ることがある）。ジャケットは
    KV に写した画像の URL で、フォームからは受け取らない。4つ揃わなければ札を出さない
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
  availability: 16,
  // 受付状況の行は札（Response・Hours・Format）の横の1行。短い言い切りで書く長さ
  availabilityReply: 40,
  availabilityHours: 60,
  availabilityFormat: 60,
  contactSteps: 1200,
  musicUrl: 2048,
  // 曲名とアーティスト名は字の幅でも見る（MUSIC_NAME_WIDTH）。ここは欄の maxlength
  musicTitle: 40,
  musicArtist: 24,
  musicArt: 200,
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
  URL が無いので、Contact に字で出し、足元の印はその行（/contact#discord）へ送る
*/
export const isDiscordName = (name: string) => /^[a-z0-9_.]{2,32}$/i.test(name)

/*
  サイトに連絡の手があるか。Contact のページを出すかを決める（src/blocks.ts の blockShown）。
  形の通らない値は無いものとして数える——描く部品（components.tsx の Contact）も同じ検査で落とす
*/
export const hasContact = (site: Pick<SiteSettings, 'email' | 'github' | 'discord'>) =>
  isContactEmail(site.email) || isHttpsUrl(site.github) || isDiscordName(site.discord)

/*
  音楽の札を出せるか。曲の URL・曲名・アーティスト名・KV に写したジャケットの4つが揃ったときだけ
  （描く部品 components.tsx の SiteMusic が見る）。URL の形とジャケットの置き場はここでも見る
*/
export const hasMusic = (
  site: Pick<SiteSettings, 'musicUrl' | 'musicTitle' | 'musicArtist' | 'musicArt'>,
) =>
  Boolean(appleMusicTrack(site.musicUrl)) &&
  Boolean(site.musicTitle) &&
  Boolean(site.musicArtist) &&
  isMusicArt(site.musicArt)

export function siteSettingsErrors(site: SiteSettings): Record<string, string> | null {
  const errors: Record<string, string> = {}
  for (const key of SITE_SETTING_KEYS) {
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
    'musicTitle',
    'musicArtist',
  ] as const) {
    if (CONTROL.test(site[key])) errors[key] = '改行や制御文字を含めないでください'
  }
  if (site.musicUrl && (CONTROL.test(site.musicUrl) || !appleMusicTrack(site.musicUrl))) {
    errors.musicUrl =
      'Apple Music の曲の URL を入れてください（ミュージックで曲の「共有 → リンクをコピー」。アルバムやプレイリストのリンクは使えません）'
  }
  // 字数の知らせより先に、幅の知らせを出す（全角を2字に数えるので、こちらが厳しい）
  for (const key of ['musicTitle', 'musicArtist'] as const) {
    const width = MUSIC_NAME_WIDTH[key]
    if (!CONTROL.test(site[key]) && textWidth(site[key]) > width) {
      errors[key] =
        `半角 ${width} 字（全角 ${width / 2} 字）までにしてください。柱の幅に収まる長さです` +
        '（Apple Music の名前が長いときは、ここで短くして保存します。例: (feat. …) を外す）'
    }
  }
  if (site.musicArt && !isMusicArt(site.musicArt)) {
    errors.musicArt = 'ジャケットを読み直してください（曲の URL を入れ直して保存）'
  }
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
  return Object.keys(errors).length ? errors : null
}

/*
  読む側でも検査する。手動で DB に入った値や、検査を通る前の古い値から
  メールや URL を組み立てない。未設定だけ既定文に戻し、空の連絡先は空のまま。
*/
export function normalizeSiteSettings(raw: Partial<SiteSettings>): SiteSettings {
  const site = Object.fromEntries(
    SITE_SETTING_KEYS.map((key) => [key, (raw[key] ?? SITE[key]).trim()]),
  ) as SiteSettings
  const errors = siteSettingsErrors(site)
  if (errors) {
    for (const key of SITE_SETTING_KEYS) if (errors[key]) site[key] = SITE[key]
  }
  return site
}
