/*
  AstLog のロゴの形（ここが正）。ページのロゴは src/ui/icons.tsx の Wordmark / HoleMark が
  ここから直に SVG を描く。入口と締めの軌道図の真ん中のブラックホールも、同じ O を大きく
  描いたもの（components.tsx の Hole。横線を軌道面の傾きに合わせて回し、縁を回る光の点
  SPOT を足す）。素材のファイル（public/assets の astlog-wordmark.svg・
  favicon.svg と、favicon・iPhone のホーム画面の PNG）は scripts/logo/export.mjs が
  ここから書き出す。GitHub の Organization の顔はロゴではなく、測地線を追って焼いた
  ブラックホールの絵（scripts/blackhole/render.py の avatar）。

  ロゴは「字で組む ΛSTLOG の O をブラックホールにしたもの」。横棒の無い A（Λ）と、
  線の太さをそろえた幾何の大文字で、宇宙機関の字の系譜。O の位置には黒い円（影）を置き、
  縁がくっきり光って外へやわらかく消える輪（光の縁）と、その後ろを通る横線（真横から
  見た円盤の光）を添える。印だけのとき（favicon・404・管理画面）は、この O を1つで使う。

  - Λ だけは塗りの形で描く。線で描くと足の切り口が脚に直角になり、片方の角が
    字の底より下へ出る。塗りなら足を水平に切れる
  - 丸い字（S・G）と尖った頂（Λ）は字の高さから少しはみ出させる（0.3）。
    そろえると、丸と尖りのほうが小さく見える
  - 字間は字の高さの 0.34 を土台に、組み合わせごとに目で詰める。O の左右は横線の
    ぶんだけ少し開ける（SHIFT）
  - 光の縁と横線は字の外へはみ出す（ページでは字の箱は字だけで決め、SVG は overflow を
    見せる。ファイルは枠の外を切るので、枠を光のぶん広げる）

  字の高さ 20 の格子（原点は左下、上が負）。JSX を持たない（scripts から読むため）。
*/

const round = (value: number) => Math.round(value * 1000) / 1000

// O の左右を開ける量（横線が L と G に触れないように）
const SHIFT = 2.2

// 字の箱（上の帯・ログイン画面のワードマークは、この箱の高さで置く）
const BOX = { top: -20.31, bottom: 0.31, width: round(131.67 + 2 * SHIFT) }

export const WORDMARK = {
  viewBox: `0 ${BOX.top} ${BOX.width} ${round(BOX.bottom - BOX.top)}`,
  lambda: 'M0 0L9.2 -20.3L18.4 0L15.55 0L9.2 -14L2.85 0Z',
  // S・T・L と G（O はブラックホールなので線に含めない）
  strokes: `M35.94 -16.61A5.3 4.5 0 0 0 25.96 -14.5A5.3 4.5 0 0 0 31.26 -10A5.3 4.5 0 0 1 36.56 -5.5A5.3 4.5 0 0 1 26.58 -3.39M44.66 -18.7H60.26M52.46 -18.7V0M67.68 -20V-1.3H78.78M${round(128.46 + 2 * SHIFT)} -15.54A9 9 0 1 0 ${round(130.37 + 2 * SHIFT)} -10H${round(122.45 + 2 * SHIFT)}`,
  stroke: 2.6,
} as const

/*
  O の位置のブラックホール（字の高さ 20 の格子）。core は黒い円の半径で、前の O の
  内側の空きと同じ大きさ。glow は光の縁が消えきる半径、line / thick は横線の半分の
  長さと、中ほどの半分の太さ
*/
export const HOLE = {
  cx: round(93.97 + SHIFT),
  cy: -10,
  core: 7.2,
  glow: 13,
  line: 17.5,
  thick: 1.15,
} as const

// 光の縁の坂（半径に対する位置と不透明度）。内縁でくっきり立ち、外へ消える
export const GLOW_STOPS: readonly (readonly [number, number])[] = [
  [round(HOLE.core / HOLE.glow - 0.005), 0],
  [round(HOLE.core / HOLE.glow), 1],
  [round((HOLE.core + 2.2) / HOLE.glow), 0.55],
  [1, 0],
]

// 横線の坂（線の長さに対する位置と不透明度）。両端で消える
export const LINE_STOPS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.25, 1],
  [0.75, 1],
  [1, 0],
]

// 横線の形。両端が尖る細い帯を、中心 (cx, cy) のまわりに
export function linePath(cx: number, cy: number): string {
  const steps = 48
  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const u = -1 + (2 * i) / steps
    const t = HOLE.thick * Math.max(0, 1 - Math.abs(u)) ** 1.2
    const x = round(cx + u * HOLE.line)
    top.push(`${x} ${round(cy - t)}`)
    bottom.unshift(`${x} ${round(cy + t)}`)
  }
  return `M${[...top, ...bottom].join('L')}Z`
}

/*
  縁を回る光の点（入口と締めのブラックホールだけ。ロゴには無い）。光の輪の中ほどの円を、
  頭が明るく尾が消える弧（sweep 度）で描き、SVG ごと回す（app.css の .hole__spin）。
  黒い円のすぐ外は輪がいちばん白く、そこに置くと白に埋もれて見えない。弧は短く保つ
  （長い弧が円のまわりを回ると、読み込み中のくるくるに見える）。r は弧の半径、width は芯の
  太さ、halo はにじみの太さ（どれも字の高さ 20 の格子）、haloOpacity はにじみの濃さ
*/
export const SPOT = { r: 9.6, width: 0.8, halo: 2.4, haloOpacity: 0.16, sweep: 32 } as const

// 光の点の弧。頭は右（角 0）、尾は時計と逆回りに sweep 度（回る向きは時計回り）
export function spotPath(): {
  d: string
  head: { x: number; y: number }
  tail: { x: number; y: number }
} {
  const at = (degrees: number) => ({
    x: round(SPOT.r * Math.cos((degrees * Math.PI) / 180)),
    y: round(SPOT.r * Math.sin((degrees * Math.PI) / 180)),
  })
  const head = at(0)
  const tail = at(-SPOT.sweep)
  return { d: `M${tail.x} ${tail.y}A${SPOT.r} ${SPOT.r} 0 0 1 ${head.x} ${head.y}`, head, tail }
}

// 印だけのときの枠（O を真ん中に、横線の端まで入る正方形）。MARK_HALF はその半分の幅
export const MARK_HALF = 19
export const MARK_VIEWBOX = `${-MARK_HALF} ${-MARK_HALF} ${2 * MARK_HALF} ${2 * MARK_HALF}`

/*
  アイコン（favicon・iPhone のホーム画面）の枠の半分。印の枠より詰め、横線の端は枠で
  切る——16px のタブで光の輪が潰れない大きさにするため（±19 のままだと影は 3px の点）
*/
const ICON_HALF = 16

/*
  素材のファイルに焼き込む色。ファイルは貼る先の字の色を継げない（currentColor が
  効くのはページに直に描いた SVG だけで、<img> や favicon では黒になる）ので、サイトと
  同じ黒基調の色を決め打つ。app.css の :root の --ink・--bg・--hole-core と同じ値
  （test/theme.test.ts が突き合わせる）
*/
export const LOGO_COLORS = { ink: '#f2f2f4', ground: '#0c0c0e', core: '#000' } as const

/*
  素材のファイルの中身（scripts/logo/export.mjs が書き、test/public.test.ts が
  ここと突き合わせる）
*/
const stops = (list: readonly (readonly [number, number])[]) =>
  list
    .map(
      ([at, alpha]) =>
        `<stop offset="${at}" stop-color="${LOGO_COLORS.ink}" stop-opacity="${alpha}"/>`,
    )
    .join('')

const holeSvg = (cx: number, cy: number, id: string) =>
  `<defs><radialGradient id="${id}-glow" cx="${cx}" cy="${cy}" r="${HOLE.glow}" gradientUnits="userSpaceOnUse">${stops(GLOW_STOPS)}</radialGradient>` +
  `<linearGradient id="${id}-line" x1="${round(cx - HOLE.line)}" x2="${round(cx + HOLE.line)}" gradientUnits="userSpaceOnUse">${stops(LINE_STOPS)}</linearGradient></defs>` +
  `<path d="${linePath(cx, cy)}" fill="url(#${id}-line)"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${HOLE.glow}" fill="url(#${id}-glow)"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${HOLE.core}" fill="${LOGO_COLORS.core}"/>`

const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>AstLog</title>${body}</svg>\n`

// ワードマークのファイル。暗い地に貼る素材で、枠は光の縁が上下に出るぶん広い
export const wordmarkSvg = () => {
  const top = Math.min(BOX.top, HOLE.cy - HOLE.glow)
  const bottom = Math.max(BOX.bottom, HOLE.cy + HOLE.glow)
  return svg(
    `0 ${top} ${BOX.width} ${round(bottom - top)}`,
    holeSvg(HOLE.cx, HOLE.cy, 'wm') +
      `<path d="${WORDMARK.lambda}" fill="${LOGO_COLORS.ink}"/>` +
      `<path d="${WORDMARK.strokes}" fill="none" stroke="${LOGO_COLORS.ink}" stroke-width="${WORDMARK.stroke}"/>`,
  )
}

/*
  アイコン（favicon.svg と、favicon・iPhone のホーム画面の PNG）。どれも同じ1枚で、
  地の色の正方形に印を載せる——光は白なので、透明のままだと明るいタブでは輪も横線も
  白に溶け、黒い点だけになる
*/
export const iconSvg = () => {
  const edge = 2 * ICON_HALF
  return svg(
    `${-ICON_HALF} ${-ICON_HALF} ${edge} ${edge}`,
    `<rect x="${-ICON_HALF}" y="${-ICON_HALF}" width="${edge}" height="${edge}" fill="${LOGO_COLORS.ground}"/>` +
      holeSvg(0, 0, 'mk'),
  )
}
