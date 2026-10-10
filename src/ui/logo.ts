/*
  AstLog のロゴの形（ここが正）。ページのロゴは src/ui/icons.tsx の Wordmark / Mark が
  ここから直に SVG を描く。素材のファイル（public/assets の astlog-wordmark.svg・favicon.svg と、
  favicon・iPhone のホーム画面・共有カードの PNG）は scripts/logo/export.mjs がここから書き出す。

  ロゴは「字で組む ΛSTLOG」。横棒の無い A（Λ）と、線の太さをそろえた幾何の大文字で、
  宇宙機関の字の系譜。前は O の位置に天体の絵を置き、選んだ天体に合わせて動かしていたが、
  サイトを装飾より中身が先に読める形へ簡素にしたときに外した（絵は画像の読み込みを待つ
  あいだ O が欠け、小さい帯では光の翼が隣の字に触れていた）。

  O は軌道に見立て、右上 45° に衛星を1つ置く。上の帯・ログイン・共有カード・素材のどれも
  この1つの形で、大きさで形を変えない。上の帯の 15px では、等倍の画面で衛星が O の上の
  アクセント（Ó）に読める恐れがある——それを並べて見たうえで、持ち主が衛星を選んだ。
  衛星の角度は、個人ページの顔と 404 の印の軌道（app.css の「天体の飾り」）と同じ。

  - Λ だけは塗りの形で描く。線で描くと足の切り口が脚に直角になり、片方の角が
    字の底より下へ出る。塗りなら足を水平に切れる
  - Λ の頂は平らに切る（幅 1.8）。2本の脚が約 49° で交わるので、尖らせたままだと頂に
    高さ 6.3（字の高さの3割）の黒いくさびができ、小さい字で頂だけ重く見えた
  - 丸い字（S・O・G）と尖った頂（Λ）は字の高さから少しはみ出させる（0.3）。
    そろえると、丸と尖りのほうが小さく見える
  - 字間は字の高さの 0.34 を土台に、組み合わせごとに目で詰める。丸い字どうしの O と G は
    いちばん詰める（前は 6.9 で、どの組より広く空いて見えた）

  字の高さ 20 の格子（原点は左下、上が負）。JSX を持たない（scripts から読むため）。
*/

const round = (value: number) => Math.round(value * 1000) / 1000

// 字の箱（上の帯・ログイン画面のワードマークは、この箱の高さで置く）
const BOX = { top: -20.31, bottom: 0.31, width: 130.07 }

// O の輪。半径は G の弧と同じ 9（線の太さの半分ぶん、字の高さからはみ出す）
const O = { cx: 93.97, cy: -10, r: 9 }

// S・T・L と G（O の前後）。G は O との組を詰めた位置（前より 1.6 左）
const STL =
  'M35.94 -16.61A5.3 4.5 0 0 0 25.96 -14.5A5.3 4.5 0 0 0 31.26 -10A5.3 4.5 0 0 1 36.56 -5.5A5.3 4.5 0 0 1 26.58 -3.39M44.66 -18.7H60.26M52.46 -18.7V0M67.68 -20V-1.3H78.78'
const G = 'M126.86 -15.54A9 9 0 1 0 128.77 -10H120.85'

/*
  Λ。外の脚は字の底の両端から、平らに切った頂（幅 APEX）の両端へ。内の脚は外の脚から
  線の太さ（2.6）だけ内へ平行に引き、底と交わる所と、左右が交わる頂を計算で決める
  （脚の太さが字の線の太さとそろう）
*/
const LAMBDA = { width: 18.4, height: 20.3, apex: 1.8, stroke: 2.6 }
const lambdaPath = () => {
  const { width, height, apex, stroke } = LAMBDA
  const mid = width / 2
  const run = mid - apex / 2
  const length = Math.hypot(run, height)
  const [nx, ny] = [(height / length) * stroke, (run / length) * stroke]
  const foot = nx + run * (ny / height)
  const top = ny - height * ((mid - nx) / run)
  return `M0 0L${round(run)} ${-height}L${round(width - run)} ${-height}L${width} 0L${round(width - foot)} 0L${mid} ${round(top)}L${round(foot)} 0Z`
}

/*
  衛星つきの O。輪は衛星のまわりだけ途切れさせ、衛星は輪の上に置く。
  切れ目は形で作る——地の色の円を重ねて線を隠すと、地の違う所（強制色・透けた地）で
  黒い円が浮く。切れ目の半角は、線の端の角から衛星の縁まで線の太さの7割ほど空く 24°
*/
const SATELLITE = { angle: -45, gap: 24, r: 1.8 }
const onRing = (deg: number) => {
  const rad = (deg * Math.PI) / 180
  return `${round(O.cx + O.r * Math.cos(rad))} ${round(O.cy + O.r * Math.sin(rad))}`
}
const circlePath = (center: string, r: number) => {
  const [x = 0, y = 0] = center.split(' ').map(Number)
  return `M${round(x - r)} ${y}A${r} ${r} 0 1 0 ${round(x + r)} ${y}A${r} ${r} 0 1 0 ${round(x - r)} ${y}Z`
}
// 衛星の先から時計回りに、衛星の手前まで（大きい弧）
const ORBIT = `M${onRing(SATELLITE.angle + SATELLITE.gap)}A${O.r} ${O.r} 0 1 1 ${onRing(SATELLITE.angle - SATELLITE.gap)}`

export const WORDMARK = {
  viewBox: `0 ${BOX.top} ${BOX.width} ${round(BOX.bottom - BOX.top)}`,
  lambda: lambdaPath(),
  strokes: `${STL}${ORBIT}${G}`,
  // 衛星は塗りの形（Λ と同じく字の色で塗る）
  satellite: circlePath(onRing(SATELLITE.angle), SATELLITE.r),
  stroke: 2.6,
} as const

/*
  印だけのとき（favicon・404・管理画面の頭）は Λ を1つで使う。字の中でいちばん形が立ち、
  16px のタブでも潰れない。MARK_HALF は印の枠（正方形）の半分の幅
*/
export const MARK_HALF = 14
export const MARK_VIEWBOX = `${-MARK_HALF} ${-MARK_HALF} ${2 * MARK_HALF} ${2 * MARK_HALF}`
// Λ の箱の中心を枠の中心へ（字の格子は原点が左下）
export const MARK_TRANSFORM = `translate(${-LAMBDA.width / 2} ${round(LAMBDA.height / 2)})`

/*
  素材のファイルの文字と地に焼き込む色。ファイルは貼る先の字の色を継げない
  （currentColor が効くのはページに直に描いた SVG だけで、<img> や favicon では黒になる）ので、
  色を決め打つ。サイトの塗りの押し手と同じ組——墨の面（--mono）に白い字（--accent-ink）。
  貼る先の地が白でも黒でも札として立つ（test/theme.test.ts が :root の段と突き合わせる）
*/
export const LOGO_COLORS = { ink: '#ffffff', ground: '#222226' } as const

const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>AstLog</title>${body}</svg>\n`

const wordmarkPaths = (ink: string) =>
  `<path d="${WORDMARK.lambda}" fill="${ink}"/>` +
  `<path d="${WORDMARK.strokes}" fill="none" stroke="${ink}" stroke-width="${WORDMARK.stroke}"/>` +
  `<path d="${WORDMARK.satellite}" fill="${ink}"/>`

// ワードマークのファイル。暗い地に貼る素材
export const wordmarkSvg = () => svg(WORDMARK.viewBox, wordmarkPaths(LOGO_COLORS.ink))

/*
  アイコン（favicon.svg と、favicon・iPhone のホーム画面の PNG）。どれも同じ1枚で、
  地の色の正方形に Λ を載せる——白い字が明るいタブに溶けず、サイトと同じ姿で見えるように
*/
export const iconSvg = () => {
  const edge = 2 * MARK_HALF
  return svg(
    MARK_VIEWBOX,
    `<rect x="${-MARK_HALF}" y="${-MARK_HALF}" width="${edge}" height="${edge}" fill="${LOGO_COLORS.ground}"/>` +
      `<path d="${WORDMARK.lambda}" transform="${MARK_TRANSFORM}" fill="${LOGO_COLORS.ink}"/>`,
  )
}

/*
  共有カード（og:image。1200×630）の SVG。サイトの1枚で、個人の名前や顔は焼き込まない
  （空の DB で個人の情報を公開しない。人の名前はページの <title> と本文が言う）。
  ワードマークを左に大きく、下にサイトの所在（astlog.dev）を置く。字は輪郭で描くので、
  書き出す環境の書体に左右されない——所在だけはワードマークと同じ線の字ではないので、
  scripts/logo/export.mjs が HTML の字として重ねて撮る
*/
export const CARD = { width: 1200, height: 630, pad: 96, wordmarkHeight: 72 } as const
export const cardSvg = () => {
  const scale = round(CARD.wordmarkHeight / (BOX.bottom - BOX.top))
  return svg(
    `0 0 ${CARD.width} ${CARD.height}`,
    `<rect width="${CARD.width}" height="${CARD.height}" fill="${LOGO_COLORS.ground}"/>` +
      `<g transform="translate(${CARD.pad} ${round(CARD.height / 2 + CARD.wordmarkHeight / 2 - BOX.bottom * scale)}) scale(${scale})">${wordmarkPaths(LOGO_COLORS.ink)}</g>`,
  )
}
