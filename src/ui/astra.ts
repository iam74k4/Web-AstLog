/*
  天体の飾りの素材の形（ここが正）。入口の空（sky.svg）と Contact の軌道（orbit.svg）。
  ファイルは scripts/logo/export.mjs がここから public/assets に書き出し、ページは
  app.css の「天体の飾り」が背景として読む——HTML には置かない（本文の HTML は字だけ。
  test/public.test.ts が main に svg が無いことを見ている）。

  どちらも線と点だけの図で、面・光・影を持たない（公開ページは面も影も持たない）。
  色はロゴの素材と同じ字の白（LOGO_COLORS.ink）を不透明度で薄めるだけで、色相を持たない
  ——既定のモノクロの中に1色だけ色の点を置くと、目がそこへ寄り道した。

  JSX を持たない（scripts から読むため）。
*/

import { LOGO_COLORS } from './logo'

const round = (value: number) => Math.round(value * 100) / 100
// title はロゴの素材と同じく置く（素材を直に開いた人と、SVG の a11y の検査のため）。ページでは背景なので読み上げに出ない
const svg = (width: number, height: number, title: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><title>${title}</title>${body}</svg>\n`
const dot = (x: number, y: number, r: number, opacity: number) =>
  `<circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}" fill="${LOGO_COLORS.ink}" fill-opacity="${round(opacity)}"/>`

/*
  すばる（プレアデス星団）。持ち主の名の「昂」の字。赤経・赤緯の差を分角で持ち（東が左）、
  点の大きさと明るさは等級から決める。Alcyone を原点にした8つ——Atlas と Pleione は
  空でも寄り添って見える2つ
*/
const PLEIADES: [x: number, y: number, magnitude: number][] = [
  [0, 0, 2.87], // Alcyone
  [-22.8, 3, 3.62], // Atlas
  [-23.3, -2, 5.05], // Pleione
  [35.8, 0, 3.7], // Electra
  [22.8, -16, 3.86], // Maia
  [16, 10, 4.17], // Merope
  [31.2, -22, 4.29], // Taygeta
  [36.7, -11, 5.45], // Celaeno
]

// まばらな星（x, y, 半径, 不透明度）。すばるの周りを空け、明るさは揃えない
const FIELD: [number, number, number, number][] = [
  [40, 250, 0.9, 0.35],
  [96, 168, 1.1, 0.45],
  [150, 262, 0.8, 0.3],
  [182, 112, 1.0, 0.4],
  [214, 206, 1.3, 0.55],
  [256, 236, 1.2, 0.5],
  [292, 48, 0.9, 0.35],
  [318, 180, 0.8, 0.3],
  [470, 214, 0.9, 0.38],
  [530, 40, 1.2, 0.5],
  [546, 160, 0.8, 0.3],
  [70, 70, 0.8, 0.28],
  [140, 24, 1.0, 0.35],
  [252, 132, 0.7, 0.25],
  [508, 272, 0.8, 0.3],
  [356, 264, 0.9, 0.32],
  [24, 136, 0.7, 0.25],
]

// 入口の空。惑星の縁（app.css の背景の弧）の上、右下の字の無い所に置く
export const SKY = { width: 560, height: 300 } as const
export const skySvg = () => {
  const center = { x: 392, y: 92, scale: 1.9 }
  const cluster = PLEIADES.map(([x, y, magnitude]) =>
    dot(
      center.x + x * center.scale,
      center.y + y * center.scale,
      2.6 - (magnitude - 2.87) * 0.55,
      0.95 - (magnitude - 2.87) * 0.17,
    ),
  )
  const field = FIELD.map(([x, y, r, opacity]) => dot(x, y, r, opacity))
  return svg(SKY.width, SKY.height, 'すばると星', [...field, ...cluster].join(''))
}

/*
  Contact の軌道。傾いた軌道が2本（内は実線、外は点線）、中心の星と、軌道の上の惑星と月。
  軌道は惑星と月のまわりだけ途切れさせる——切れ目は形で作り、地の色の円を重ねない
  （地の違う所で黒い円が浮く）。中心の星も惑星も、本文のメールの手より目立たない明るさに抑える
*/
export const ORBIT = { width: 380, height: 230 } as const
export const orbitSvg = () => {
  const cx = ORBIT.width / 2
  const cy = ORBIT.height / 2
  const tilt = -14
  const t = (tilt * Math.PI) / 180
  // 傾いた楕円の上の、媒介変数 deg の点
  const at = (rx: number, ry: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    const x = rx * Math.cos(a)
    const y = ry * Math.sin(a)
    return [cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t)]
  }
  // 楕円の弧。body（半径 r）のまわりを、縁から clear だけ空けて切る
  const orbit = (rx: number, ry: number, deg: number, r: number, clear: number, style: string) => {
    const a = (deg * Math.PI) / 180
    const speed = Math.hypot(rx * Math.sin(a), ry * Math.cos(a))
    const half = (((r + clear) / speed) * 180) / Math.PI
    const [x1 = 0, y1 = 0] = at(rx, ry, deg + half)
    const [x2 = 0, y2 = 0] = at(rx, ry, deg - half)
    return `<path d="M${round(x1)} ${round(y1)}A${rx} ${ry} ${tilt} 1 1 ${round(x2)} ${round(y2)}" fill="none" stroke="${LOGO_COLORS.ink}" ${style}/>`
  }
  const planet = { rx: 140, ry: 40, deg: 62, r: 4 }
  const moon = { rx: 178, ry: 54, deg: 206, r: 1.8 }
  const [px = 0, py = 0] = at(planet.rx, planet.ry, planet.deg)
  const [mx = 0, my = 0] = at(moon.rx, moon.ry, moon.deg)
  return svg(
    ORBIT.width,
    ORBIT.height,
    '軌道',
    orbit(
      moon.rx,
      moon.ry,
      moon.deg,
      moon.r,
      3.5,
      'stroke-opacity="0.14" stroke-dasharray="1.5 5" stroke-linecap="round"',
    ) +
      orbit(planet.rx, planet.ry, planet.deg, planet.r, 4, 'stroke-opacity="0.2"') +
      dot(cx, cy, 2.2, 0.5) +
      dot(px, py, planet.r, 0.7) +
      dot(mx, my, moon.r, 0.5),
  )
}
