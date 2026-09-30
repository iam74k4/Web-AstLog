/*
  アイコンはインライン SVG のみ。絵文字は使わない。currentColor を継ぐので、置いた
  場所の文字色になる。
*/

import {
  GLOW_STOPS,
  HOLE,
  LINE_STOPS,
  linePath,
  MARK_VIEWBOX,
  SPOT,
  spotPath,
  WORDMARK,
} from './logo'

/*
  ロゴのブラックホール（O の位置の、光の縁・横線・黒い円）。形は src/ui/logo.ts が正。
  色は currentColor（光と横線）と CSS の --hole-core（黒い円。app.css の .logo-core）。
  グラデーションの id は置く部品ごとに変える（ワードマークと印を同じページに置いたとき、
  id が重なると片方の光が消える。いま並べているページは無いが、並べた日に黙って消えない）。

  光（HoleLight）と黒い円（HoleCore）を分けて出すのは、入口と締めのブラックホール
  （components.tsx の Hole）がそのあいだに縁を回る光の点（HoleSpot）を挟むため
*/
export const HoleLight = ({ cx, cy, id }: { cx: number; cy: number; id: string }) => (
  <>
    <defs>
      <radialGradient
        id={`${id}-glow`}
        cx={cx}
        cy={cy}
        r={HOLE.glow}
        gradientUnits="userSpaceOnUse"
      >
        {GLOW_STOPS.map(([at, alpha]) => (
          <stop key={at} offset={at} stop-color="currentColor" stop-opacity={alpha} />
        ))}
      </radialGradient>
      <linearGradient
        id={`${id}-line`}
        x1={cx - HOLE.line}
        x2={cx + HOLE.line}
        gradientUnits="userSpaceOnUse"
      >
        {LINE_STOPS.map(([at, alpha]) => (
          <stop key={at} offset={at} stop-color="currentColor" stop-opacity={alpha} />
        ))}
      </linearGradient>
    </defs>
    <path d={linePath(cx, cy)} fill={`url(#${id}-line)`} />
    <circle cx={cx} cy={cy} r={HOLE.glow} fill={`url(#${id}-glow)`} />
  </>
)

export const HoleCore = ({ cx, cy }: { cx: number; cy: number }) => (
  <circle class="logo-core" cx={cx} cy={cy} r={HOLE.core} />
)

/*
  縁を回る光の点（入口と締めのブラックホールだけ）。頭から尾へ消える短い弧を、にじみと芯の
  2本の線で描く（尾へ消える坂は弧の弦に沿った直線のグラデーション。sweep が 90 度より
  小さいので、弦の上の並びが弧の上の並びと同じ向きになる）。中心は (0, 0)
*/
export const HoleSpot = ({ id }: { id: string }) => {
  const { d, head, tail } = spotPath()
  return (
    <>
      <defs>
        <linearGradient
          id={`${id}-spot`}
          x1={head.x}
          y1={head.y}
          x2={tail.x}
          y2={tail.y}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="currentColor" stop-opacity="1" />
          <stop offset="1" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={`url(#${id}-spot)`}
        stroke-width={SPOT.halo}
        stroke-linecap="round"
        stroke-opacity={SPOT.haloOpacity}
      />
      <path
        d={d}
        fill="none"
        stroke={`url(#${id}-spot)`}
        stroke-width={SPOT.width}
        stroke-linecap="round"
      />
    </>
  )
}

const Hole = ({ cx, cy, id }: { cx: number; cy: number; id: string }) => (
  <>
    <HoleLight cx={cx} cy={cy} id={id} />
    <HoleCore cx={cx} cy={cy} />
  </>
)

/*
  ワードマーク（ΛSTLOG。O がブラックホール）。大きさは置く側の CSS が高さで決める
  （幅は viewBox の縦横比から。光の縁と横線は字の箱の外へはみ出して見せる——
  overflow visible）。読み上げには出さない——名前は置く側が字で持つ（.sr-only の AstLog）
*/
export const Wordmark = ({ class: className }: { class: string }) => (
  <svg
    class={className}
    viewBox={WORDMARK.viewBox}
    fill="currentColor"
    overflow="visible"
    aria-hidden="true"
    focusable="false"
  >
    <Hole cx={HOLE.cx} cy={HOLE.cy} id="wm" />
    <path d={WORDMARK.lambda} />
    <path d={WORDMARK.strokes} fill="none" stroke="currentColor" stroke-width={WORDMARK.stroke} />
  </svg>
)

/*
  印だけ（ワードマークの O を1つで）。404 と管理画面の頭で使う。
  size は必須——app.css は印に寸法を与える規則を持たないので、渡し忘れると素の
  300x150 に落ちて版面が崩れる
*/
export const HoleMark = ({ size }: { size: number }) => (
  <svg viewBox={MARK_VIEWBOX} width={size} height={size} aria-hidden="true" focusable="false">
    <Hole cx={0} cy={0} id="mk" />
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

export const MailIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.2 1.4 6.3 4.1 6.3-4.1H1.7Z" />
  </svg>
)
