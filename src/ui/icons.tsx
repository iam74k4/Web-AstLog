/*
  アイコンはインライン SVG のみ。絵文字は使わない。
  三日月は assets/noctifex-mark.svg と同じ形。currentColor を継ぐので、
  置いた場所の文字色になる。
*/

/*
  三日月。明るい側が左（外周は x=5.68 まで張り出し、内周は x≈10.7〜12.1）。
  入口の背景の月（scripts/moon/render.py）も同じ向きに光を当ててある。
*/
export const MarkIcon = ({ size = 24 }: { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <polygon points="14.96,2.50 7.71,6.10 5.68,13.93 10.27,20.60 18.32,21.50 12.09,16.78 10.73,9.07" />
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

export const MailIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.2 1.4 6.3 4.1 6.3-4.1H1.7Z" />
  </svg>
)
