/*
  アイコンはインライン SVG のみ。絵文字は使わない。currentColor を継ぐので、置いた
  場所の文字色になる。
*/

import { WORDMARK } from './logo'

/*
  ワードマーク（ΛSTLOG。O は衛星つきの軌道）。形は logo.ts が正で、字の色を継ぐ（currentColor）。大きさは CSS の
  高さで決める（幅は viewBox の縦横比から）。読み上げには出さない——名前は置く側が字で持つ
  （.sr-only の AstLog）
*/
export const Wordmark = ({ class: className }: { class: string }) => (
  <svg
    class={className}
    viewBox={WORDMARK.viewBox}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d={WORDMARK.lambda} />
    <path d={WORDMARK.strokes} fill="none" stroke="currentColor" stroke-width={WORDMARK.stroke} />
    <path d={WORDMARK.satellite} />
  </svg>
)

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.4',
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
}

export const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" {...stroke}>
    <path d="M11 2l3 3-7.5 7.5L3 13l.5-3.5L11 2z" />
  </svg>
)

// 別のタブで開くもの（公開ページへ）
export const ExternalIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" {...stroke}>
    <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />
  </svg>
)

export const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" {...stroke}>
    <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.5 9h6l.5-9" />
  </svg>
)

export const GithubIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)

// Instagram の印（角の丸い枠・レンズ・光の点）。線で描き、字の色を継ぐ
export const InstagramIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <rect
      x="1.6"
      y="1.6"
      width="12.8"
      height="12.8"
      rx="3.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
    />
    <circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4" />
    <circle cx="11.9" cy="4.1" r="0.95" fill="currentColor" />
  </svg>
)

// X の印
export const XIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

// Discord の印（Simple Icons の形。CC0）。塗りで描き、字の色を継ぐ
export const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
  </svg>
)

export const MailIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.2 1.4 6.3 4.1 6.3-4.1H1.7Z" />
  </svg>
)
