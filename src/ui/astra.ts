/*
  天体の飾りの素材の形（ここが正）。夜明けの窓の空（sky.svg。すばるとまばらな星）。
  ファイルは scripts/logo/export.mjs がここから public/assets に書き出し、ページは
  app.css の「天体の飾り」が夜明けの窓（骨格の .window）の星の形（mask）として読む——HTML には
  置かない（本文の HTML は字だけ。test/public.test.ts が main に svg が無いことを見ている）。

  点だけの図で、面・光・影を持たない。ページが読むのは点の形と濃さ（不透明度）だけで、
  色は app.css の段（--dawn-star）が塗る。ファイルに焼く色はロゴの素材の白（LOGO_COLORS.ink）
  で、窓の星と同じ色。点に色相は持たせない
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

/*
  まばらな星（x, y, 半径, 不透明度）。すばるの周りと、窓の左上の札（M45 — PLEIADES）の
  下を空け、明るさは揃えない。上の 300 は
  狭い画面の入口の帯に出るぶん、その下は 900 以上の縦に長い窓を埋めるぶん（窓の下の
  ほうは空が明けて、白い星は見えなくなる）
*/
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
  [252, 132, 0.7, 0.25],
  [508, 272, 0.8, 0.3],
  [356, 264, 0.9, 0.32],
  [24, 136, 0.7, 0.25],
  [60, 330, 0.9, 0.35],
  [188, 352, 1.1, 0.45],
  [318, 318, 0.8, 0.3],
  [452, 368, 1.0, 0.4],
  [522, 334, 0.7, 0.25],
  [104, 418, 0.8, 0.3],
  [246, 446, 1.2, 0.5],
  [398, 432, 0.8, 0.3],
  [36, 508, 1.0, 0.4],
  [170, 532, 0.7, 0.25],
  [300, 516, 0.9, 0.35],
  [486, 498, 1.1, 0.45],
  [122, 612, 0.9, 0.32],
  [262, 640, 0.7, 0.25],
  [414, 596, 1.0, 0.38],
  [540, 652, 0.8, 0.3],
  [58, 716, 1.1, 0.42],
  [208, 742, 0.8, 0.3],
  [352, 702, 0.9, 0.35],
  [476, 760, 0.7, 0.25],
  [132, 830, 0.9, 0.32],
  [286, 866, 1.0, 0.38],
  [430, 846, 0.8, 0.28],
  [30, 924, 0.7, 0.25],
  [226, 958, 0.9, 0.32],
  [512, 934, 1.0, 0.36],
]

/*
  夜明けの窓の空。窓の右上にすばるが来るように、app.css が窓の幅に合わせて置く（上端を
  窓の上端にそろえる）。縦に長いのは、900 以上の窓が画面の高さまで伸びるため
*/
export const SKY = { width: 560, height: 1000 } as const
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
