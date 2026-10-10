/*
  天体の飾りの素材の形（ここが正）。夜空の窓の空（sky.svg。すばるとまばらな星）。
  ファイルは scripts/logo/export.mjs がここから public/assets に書き出し、ページは
  app.css の「天体の飾り」が夜空の窓（骨格の .window）の背景として読む——HTML には
  置かない（本文の HTML は字だけ。test/public.test.ts が main に svg が無いことを見ている）。

  点だけの図で、面・光・影を持たない。色はロゴの素材と同じ白（LOGO_COLORS.ink。窓の
  --night-ink）を不透明度で薄めるだけで、色相を持たない
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

// 夜空の窓の空。窓の右上にすばるが来るように、app.css が窓の幅に合わせて置く
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
