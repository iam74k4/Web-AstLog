import { isHttpsUrl } from './lib/format'

/*
  ブランドと公開先はデプロイの設定。紹介文と連絡先は settings に保存し、
  管理画面の「サイト設定」から変更する。空の DB に個人の連絡先を埋め込まない。
*/
export const SITE = {
  name: 'AstLog',
  origin: 'https://astlog.dev',
  tagline: 'つくる人の、置き場所。',
  heroLead: 'つくったものと、取り組んできたことをまとめています。',
  contactLead: 'ご相談やお問い合わせは、こちらからお願いします。',
  email: '',
  github: '',
} as const

export const SITE_SETTING_KEYS = ['tagline', 'heroLead', 'contactLead', 'email', 'github'] as const
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number]
export type SiteSettings = Record<SiteSettingKey, string>

// 大きな見出しと表紙の文は、管理画面から変えても既存のレイアウトに収まる長さにする。
export const SITE_SETTING_LIMITS = {
  tagline: 80,
  heroLead: 160,
  contactLead: 120,
  email: 254,
  github: 2048,
} as const

// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を弾くのがこの検査の目的
const CONTROL = /[\u0000-\u001f\u007f]/

// mailto にヘッダや複数の宛先を混ぜさせない。空は連絡先を掲載しない指定。
export const isContactEmail = (email: string) =>
  /^[^\s@?&#,;]+@[^\s@?&#,;]+\.[^\s@?&#,;]+$/.test(email) &&
  !CONTROL.test(email) &&
  !/[<>"\\]/.test(email) &&
  !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(email)

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
  if (site.email && !isContactEmail(site.email)) errors.email = 'メールアドレスを1つ入れてください'
  if (site.github && !isHttpsUrl(site.github))
    errors.github = 'https:// で始まる URL を入れてください'
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
