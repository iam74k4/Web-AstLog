/*
  AstLog のロゴの形（ここが正）。ページのロゴは src/ui/icons.tsx の Wordmark / HoleMark が
  ここから直に SVG を描く。素材のファイル（public/assets の astlog-wordmark.svg・favicon.svg と、
  favicon・iPhone のホーム画面の PNG）は scripts/logo/export.mjs がここから書き出す。

  ロゴは「字で組む ΛSTLOG の O をブラックホールにしたもの」。横棒の無い A（Λ）と、
  線の太さをそろえた幾何の大文字で、宇宙機関の字の系譜。O の位置には、入口と締めの軌道図の
  真ん中と同じブラックホールの絵（BLACKHOLE_ART）を、影の半径が HOLE.core になる大きさで
  置く——持ち主の「AstLog の o もブラックホールのデザインに合わせて」。前は黒い円・光の縁・
  後ろを通る横線の記号で、入口の
  絵と別のものに見えた。線で描き直した姿（輪のある玉）は、大きく描くと土星に見えた。印だけの
  とき（favicon・404・管理画面・作品の星図）も、同じ絵を1つで使う。

  - Λ だけは塗りの形で描く。線で描くと足の切り口が脚に直角になり、片方の角が
    字の底より下へ出る。塗りなら足を水平に切れる
  - 丸い字（S・G）と尖った頂（Λ）は字の高さから少しはみ出させる（0.3）。
    そろえると、丸と尖りのほうが小さく見える
  - 字間は字の高さの 0.34 を土台に、組み合わせごとに目で詰める。O の左右は光の翼の
    ぶんだけ少し開ける（SHIFT）
  - 光は字の外へはみ出す（ページでは字の箱は字だけで決め、SVG は overflow を見せる。
    ファイルは枠の外を切るので、枠を光のぶん広げる）

  字の高さ 20 の格子（原点は左下、上が負）。JSX を持たない（scripts から読むため）。
*/

const round = (value: number) => Math.round(value * 1000) / 1000

// 現画像の明るい翼が L と G につながらないよう、O の左右の字間を広げる。
const SHIFT = 14

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
  O の位置のブラックホール（字の高さ 20 の格子）。core は影の黒い円の半径で、前の O の
  内側の空きと同じ大きさ。絵はこの影の大きさに合わせて置く（holeArt）
*/
export const HOLE = {
  cx: round(93.97 + SHIFT),
  cy: -10,
  core: 7.2,
} as const

/*
  ほかの天体の表紙と質感をそろえたブラックホールの絵。入口と締めの軌道図の真ん中
  （components.tsx の Hole）、プロフィールの表紙（CelestialArt）、ロゴの O（HoleArt）が
  同じ1枚を使う。favicon とワードマークの素材も scripts/logo/export.mjs がこの絵から作る。

  外側の光は透過で、中央の黒い影は絵にも入っている。表示側でも影の黒い円を下に敷く——
  絵の濃さを揺らしても、影の後ろの軌道を透かさないため。width / height は透明余白を含む絵の
  画素、lightWidth は可視光（alpha が約2%以上）の横幅、shadow は中央の影の半径（いずれも画素）。
  画像の中央を影の中心として配置し、img と holeArt の寸法には余白を含む width / height を使う。

  URL には版（?v= はファイルの SHA-256 の頭8桁）を付け、public/_headers が1年・immutable で
  配る。上の帯のロゴがどのページでも読むので、既定（毎回確かめる）のままだと、ページを移る
  たびに O の光が1往復ぶん消えてから灯る。差し替えたら実寸・影の半径・版を合わせる
  （test/public.test.ts がファイルの寸法と版を突き合わせる）
*/
export const BLACKHOLE_ART = {
  src: '/assets/blackhole.webp?v=8c794528',
  width: 1672,
  height: 941,
  lightWidth: 1544,
  shadow: 184,
} as const

// 影の半径が core になるように置いた絵の箱（中心 (cx, cy) のまわり。字の格子の単位）
export const holeArt = (cx: number, cy: number, core: number = HOLE.core) => {
  const width = round((BLACKHOLE_ART.width / BLACKHOLE_ART.shadow) * core)
  const height = round((BLACKHOLE_ART.height / BLACKHOLE_ART.shadow) * core)
  return { x: round(cx - width / 2), y: round(cy - height / 2), width, height }
}

/*
  印だけのときの枠（O を真ん中に置く正方形）。MARK_HALF はその半分の幅。光の翼の淡い端
  は枠の外へ出して見せる（icons.tsx の HoleMark の overflow）——枠を翼に
  合わせると、影が小さな点になる
*/
export const MARK_HALF = 19
export const MARK_VIEWBOX = `${-MARK_HALF} ${-MARK_HALF} ${2 * MARK_HALF} ${2 * MARK_HALF}`

/*
  アイコン（favicon・iPhone のホーム画面）の枠の半分。印の枠より詰め、光の翼の端は枠で
  切る——16px のタブで影と光が潰れない大きさにするため（±19 のままだと影は 3px の点）
*/
const ICON_HALF = 16

/*
  素材のファイルの文字・地・下敷きの影に焼き込む色。ファイルは貼る先の字の色を継げない
  （currentColor が効くのはページに直に描いた SVG だけで、<img> や favicon では黒になる）ので、サイトと
  同じ黒基調の色を決め打つ。app.css の :root の --ink・--bg・--hole-core と同じ値
  （test/theme.test.ts が突き合わせる）
*/
export const LOGO_COLORS = { ink: '#f2f2f4', ground: '#0c0c0e', core: '#000' } as const

/*
  素材のファイルの中身（scripts/logo/export.mjs が書き、test/public.test.ts が
  ここと突き合わせる）。ファイルはページの外で開かれ、/assets の絵を読みに行けないので、
  絵を data URI で埋め込む（art は小さく描き直した WebP の base64。export.mjs が作る）
*/
const holeSvg = (cx: number, cy: number, art: string) => {
  const box = holeArt(cx, cy)
  return (
    `<circle cx="${cx}" cy="${cy}" r="${HOLE.core}" fill="${LOGO_COLORS.core}"/>` +
    `<image href="data:image/webp;base64,${art}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/>`
  )
}

const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>AstLog</title>${body}</svg>\n`

// 光の見える上下の広がり（影の半径に対して。alpha > 5 の実測上1.62・下1.56に少し余裕を足す）
const LIGHT_REACH = { up: 1.65, down: 1.6 }

// ワードマークのファイル。暗い地に貼る素材で、枠は光が上下に出るぶん広い
export const wordmarkSvg = (art: string) => {
  const top = Math.min(BOX.top, round(HOLE.cy - HOLE.core * LIGHT_REACH.up))
  const bottom = Math.max(BOX.bottom, round(HOLE.cy + HOLE.core * LIGHT_REACH.down))
  return svg(
    `0 ${top} ${BOX.width} ${round(bottom - top)}`,
    holeSvg(HOLE.cx, HOLE.cy, art) +
      `<path d="${WORDMARK.lambda}" fill="${LOGO_COLORS.ink}"/>` +
      `<path d="${WORDMARK.strokes}" fill="none" stroke="${LOGO_COLORS.ink}" stroke-width="${WORDMARK.stroke}"/>`,
  )
}

/*
  アイコン（favicon.svg と、favicon・iPhone のホーム画面の PNG）。どれも同じ1枚で、
  地の色の正方形に印を載せる——明るい光が白いタブに溶けず、サイトと同じ姿で見えるように
*/
export const iconSvg = (art: string) => {
  const edge = 2 * ICON_HALF
  return svg(
    `${-ICON_HALF} ${-ICON_HALF} ${edge} ${edge}`,
    `<rect x="${-ICON_HALF}" y="${-ICON_HALF}" width="${edge}" height="${edge}" fill="${LOGO_COLORS.ground}"/>` +
      holeSvg(0, 0, art),
  )
}
