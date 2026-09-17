/*
  見た目のプリセット。

  変えられるのは「骨格・アクセント色・書体」の3つだけ。1つずつ自由に
  色や余白を指定できるようにはしない。値を自由に入れられると、
  public/app.css の :root で揃えた段が意味を失う。

  選べる値はここが正で、対応する指定は public/app.css の
  [data-layout] / [data-accent] / [data-typeface] にある。
  platforms のように表で持たないのは、CSS に無い値を行として足せてしまうと、
  管理画面では選べるのに何も変わらない選択肢ができるため。
*/

export const LAYOUTS = [
  { key: 'rail', label: '左サイドバー', note: 'ロゴと目次を左に固定する' },
  { key: 'center', label: '中央寄せ', note: '名札を上に積み、1列で読ませる' },
  { key: 'magazine', label: '雑誌風', note: '見出しを大きく取り、罫線で区切る' },
] as const

export const ACCENTS = [
  { key: 'iris', label: 'アイリス', note: '夜の紫' },
  { key: 'ember', label: 'エンバー', note: '熾火の橙' },
  { key: 'mint', label: 'ミント', note: '夜明けの緑' },
  { key: 'sky', label: 'スカイ', note: '薄明の青' },
  { key: 'rose', label: 'ローズ', note: '灯りの桃' },
] as const

export const TYPEFACES = [
  { key: 'sans', label: 'ゴシック', note: '見出しも本文も同じ書体' },
  { key: 'serif', label: '明朝', note: '見出しだけ明朝にする' },
  { key: 'mono', label: '等幅', note: '見出しだけ等幅にする' },
] as const

export type LayoutKey = (typeof LAYOUTS)[number]['key']
export type AccentKey = (typeof ACCENTS)[number]['key']
export type TypefaceKey = (typeof TYPEFACES)[number]['key']

export type Theme = {
  layout: LayoutKey
  accent: AccentKey
  typeface: TypefaceKey
}

export const THEME_KEYS = ['layout', 'accent', 'typeface'] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

// 何も選んでいないサイトの姿。テストとフォームの初期値もここを見る
export const THEME_DEFAULT: Theme = { layout: 'rail', accent: 'iris', typeface: 'sans' }

export type PresetOption = { key: string; label: string; note: string }

export const THEME_CHOICES: Record<ThemeKey, readonly PresetOption[]> = {
  layout: LAYOUTS,
  accent: ACCENTS,
  typeface: TYPEFACES,
}

export const THEME_GROUPS: { key: ThemeKey; label: string; note: string }[] = [
  { key: 'layout', label: '骨格', note: 'ページの組み立て方' },
  { key: 'accent', label: 'アクセント色', note: 'リンクと選択中の印' },
  { key: 'typeface', label: '書体', note: '見出しの雰囲気' },
]

export function isThemeValue<K extends ThemeKey>(key: K, value: string): value is Theme[K] {
  return THEME_CHOICES[key].some((option) => option.key === value)
}

/*
  保存されている値を Theme に直す。

  知らない値は既定に戻す。プリセットを1つ減らしたときに、
  それを選んだままのサイトが真っ白にならないようにするため。
*/
export function normalizeTheme(raw: Partial<Record<ThemeKey, string | null | undefined>>): Theme {
  return {
    layout: pick('layout', raw.layout),
    accent: pick('accent', raw.accent),
    typeface: pick('typeface', raw.typeface),
  }
}

function pick<K extends ThemeKey>(key: K, value: string | null | undefined): Theme[K] {
  return value && isThemeValue(key, value) ? value : THEME_DEFAULT[key]
}
