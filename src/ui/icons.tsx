/*
  アイコンはインライン SVG のみ。絵文字は使わない。currentColor を継ぐので、置いた
  場所の文字色になる。
*/

import { BLACKHOLE_ART, HOLE, holeArt, MARK_VIEWBOX, WORDMARK } from './logo'

/*
  ロゴの O のブラックホール。入口と締めの軌道図の真ん中と同じ絵（logo.ts の BLACKHOLE_ART）を、
  影の黒い円（CSS の --hole-core。app.css の .logo-core）の上に、影の半径が HOLE.core になる
  大きさで置く。絵は外側の光が透過し、中央の黒い影も含む WebP。/assets から読む
  （入口と同じ1枚。版つきの URL で1年持つので、ページを移っても取り直さない。
  CSP の img-src 'self' の中）。

  強制色のモードでは絵の色を変えられない（白い光が明るい地に溶ける）ので、app.css が絵を隠して
  影の円を字の色の輪にする——O の字の形だけは残る。輪の太さは字の線と同じ（stroke-width。
  ふだんは stroke が無いので引かれない）
*/
export const HoleArt = ({ cx, cy }: { cx: number; cy: number }) => {
  const box = holeArt(cx, cy)
  return (
    <>
      <circle class="logo-core" cx={cx} cy={cy} r={HOLE.core} stroke-width={WORDMARK.stroke} />
      <image
        class="logo-art"
        href={BLACKHOLE_ART.src}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
      />
    </>
  )
}

/*
  ワードマーク（ΛSTLOG。O がブラックホール）。大きさは置く側の CSS が高さで決める
  （幅は viewBox の縦横比から。O の光は字の箱の外へはみ出して見せる——overflow visible）。読み上げには出さない——名前は置く側が字で持つ（.sr-only の AstLog）
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
    <HoleArt cx={HOLE.cx} cy={HOLE.cy} />
    <path d={WORDMARK.lambda} />
    <path d={WORDMARK.strokes} fill="none" stroke="currentColor" stroke-width={WORDMARK.stroke} />
  </svg>
)

/*
  印だけ（ワードマークの O を1つで）。404 と管理画面の頭で使う。
  size は必須——app.css は印に寸法を与える規則を持たないので、渡し忘れると素の
  300x150 に落ちて版面が崩れる。光の翼の淡い端は枠の外へ出して見せる（logo.ts の MARK_HALF）
*/
export const HoleMark = ({ size }: { size: number }) => (
  <svg
    viewBox={MARK_VIEWBOX}
    width={size}
    height={size}
    overflow="visible"
    aria-hidden="true"
    focusable="false"
  >
    <HoleArt cx={0} cy={0} />
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
