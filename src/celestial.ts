import { ACCENTS } from './theme'

/*
  メンバーの天体と色。フォームの選択肢・保存の検査・公開描画が同じ許可リストを読む。
  色は既存のプリセットを使い、inherit だけがサイト全体のアクセントを引き継ぐ。
*/
export const CELESTIAL_BODIES = [
  { key: 'black-hole', label: 'ブラックホール', note: '光の輪を持つ天体' },
  { key: 'saturn', label: '土星', note: '環のある惑星' },
  { key: 'neptune', label: '海王星', note: '遠くの惑星' },
  { key: 'moon', label: '月', note: '静かな衛星' },
  { key: 'sun', label: '太陽', note: '光を放つ恒星' },
] as const

export const CELESTIAL_BODY_KEYS: readonly CelestialBody[] = CELESTIAL_BODIES.map(
  (body) => body.key,
)
export const CELESTIAL_ACCENTS = [
  { key: 'inherit', label: 'サイトの色を使う', note: '「見た目」で選んだ色を引き継ぐ' },
  ...ACCENTS,
] as const

export type CelestialBody = (typeof CELESTIAL_BODIES)[number]['key']
export type CelestialAccent = (typeof CELESTIAL_ACCENTS)[number]['key']
export type Celestial = { body: CelestialBody; accent: CelestialAccent }
export type CelestialMember = {
  celestialBody?: string | null
  celestialAccent?: string | null
}

export const DEFAULT_CELESTIAL = {
  body: 'black-hole',
  accent: 'inherit',
} as const satisfies Celestial

export const isCelestialBody = (value: string): value is CelestialBody =>
  CELESTIAL_BODY_KEYS.some((key) => key === value)

export const isCelestialAccent = (value: string): value is CelestialAccent =>
  CELESTIAL_ACCENTS.some((option) => option.key === value)

// 手動で入った値や、将来なくなった選択肢も、SSRでは安全な既定値に戻す。
export function normalizeCelestial(raw: CelestialMember = {}): Celestial {
  return {
    body:
      raw.celestialBody && isCelestialBody(raw.celestialBody)
        ? raw.celestialBody
        : DEFAULT_CELESTIAL.body,
    accent:
      raw.celestialAccent && isCelestialAccent(raw.celestialAccent)
        ? raw.celestialAccent
        : DEFAULT_CELESTIAL.accent,
  }
}
