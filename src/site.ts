import { isHttpsUrl } from './lib/format'

/*
  ブランドと公開先はデプロイの設定。紹介文と連絡先は settings に保存し、
  管理画面の「サイト設定」から変更する。空の DB に個人の連絡先を埋め込まない。
*/
export const SITE = {
  name: 'AstLog',
  origin: 'https://astlog.dev',
  tagline: 'つくったものを、ひとつずつ記録する。',
  heroLead: 'つくったものと、取り組んできたことをまとめています。',
  // 入口の大見出しの下で打ち替える言葉（1行に1つ）。空なら出さない
  heroRoles: '',
  contactLead: 'お仕事のご相談や取り組みについて、話しませんか。',
  email: '',
  github: '',
  instagram: '',
  x: '',
} as const

/*
  足元の行き先は GitHub → Instagram → X → Mail の順（components.tsx の Socials）。
  Contact のページを出すかを決めるのはメールと GitHub だけ（hasContact）——Instagram と X は
  足元に添える行き先で、Contact の本文には置かない
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
] as const
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number]

/*
  あとから足した欄（入口の打ち替える言葉・Instagram・X）。既定は空（出さない）なので、行がまだ無くても管理画面の
  概要では「保存済み」に数える——欄を足した日に、保存済みのサイトが「一部保存済み」に戻らない
  ように（src/routes/admin/dashboard.tsx）
*/
export const SITE_SETTING_LATER_KEYS: readonly SiteSettingKey[] = ['heroRoles', 'instagram', 'x']
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
const roleWidth = (word: string) =>
  [...word].reduce((sum, letter) => sum + (/[\u0020-\u007e]/.test(letter) ? 1 : 2), 0)
export const heroRoleWords = (site: Pick<SiteSettings, 'heroRoles'>) =>
  site.heroRoles
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter(Boolean)

// mailto にヘッダや複数の宛先を混ぜさせない。空は連絡先を掲載しない指定。
export const isContactEmail = (email: string) =>
  /^[^\s@?&#,;]+@[^\s@?&#,;]+\.[^\s@?&#,;]+$/.test(email) &&
  !CONTROL.test(email) &&
  !/[<>"\\]/.test(email) &&
  !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(email)

/*
  サイトに連絡の手があるか。Contact のページを出すかを決める（src/blocks.ts の blockShown）。
  形の通らない値は無いものとして数える——描く部品（components.tsx の Contact）も同じ検査で落とす
*/
export const hasContact = (site: Pick<SiteSettings, 'email' | 'github'>) =>
  isContactEmail(site.email) || isHttpsUrl(site.github)

export function siteSettingsErrors(site: SiteSettings): Record<string, string> | null {
  const errors: Record<string, string> = {}
  for (const key of SITE_SETTING_KEYS) {
    if ([...site[key]].length > SITE_SETTING_LIMITS[key]) {
      errors[key] = `${SITE_SETTING_LIMITS[key]} 字までにしてください`
    }
  }
  for (const key of ['tagline', 'heroLead', 'contactLead'] as const) {
    if (!site[key]) errors[key] = '文を入れてください'
    else if (CONTROL.test(site[key])) errors[key] = '改行や制御文字を含めないでください'
  }
  const roles = heroRoleWords(site)
  if (CONTROL_BUT_NEWLINE.test(site.heroRoles)) errors.heroRoles = '制御文字を含めないでください'
  else if (roles.length > HERO_ROLES.words) {
    errors.heroRoles = `言葉は ${HERO_ROLES.words} つまでにしてください`
  } else if (roles.some((word) => roleWidth(word) > HERO_ROLES.width)) {
    errors.heroRoles = `1つの言葉は半角 ${HERO_ROLES.width} 字（全角 ${HERO_ROLES.width / 2} 字）までにしてください`
  }
  if (site.email && !isContactEmail(site.email)) errors.email = 'メールアドレスを1つ入れてください'
  for (const key of ['github', 'instagram', 'x'] as const) {
    if (site[key] && !isHttpsUrl(site[key])) errors[key] = 'https:// で始まる URL を入れてください'
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
