/*
  入口と締めの軌道図の形（描くのは src/ui/components.tsx の OrbitSystem /
  ContactOrbits）。

  真ん中にブラックホールを置き、公開中の作品を1つずつ楕円の軌道に載せる。
  ブラックホールは楕円の中心ではなく焦点に居る（ケプラーの第一法則）——中心に置くと、
  軌道の1本1本がただの同心の輪になり、原子のマークと見分けがつかない。

  形は件数（区分ごとの数）だけから決める。作品の名前や slug には依らないので、
  同じ件数なら同じ絵になり、描き直しで天体が跳ねない。天体は光る惑星で、業務は輪のある
  惑星（区分の呼び名は src/domain.ts の KIND_LABEL）。手前の天体ほど大きい。

  座標は SVG の viewBox の単位。軌道は「軌道面の楕円を、斜め上の近い所から透視で見た」
  形にする——手前は大きく広がり、奥はブラックホールの後ろで詰まる（ELEVATION と CAMERA。
  画面の中で回す量は TILT。いまは水平）。透視で見た楕円も楕円なので、その形を求めて SVG の
  円弧（A）で描く。点を並べた折れ線にしないのは、どの拡大でも角が出ないようにするため。

  軌道は線だけでなく、光の帯（bands。手前ほど太く明るい）と星屑（stardust。軌道に沿って
  散る光の粒）で描く——細い線だけのころは、同じ形の輪が並んだ図面に見えた（持ち主の
  「軌道がださい。もっと壮大に」）。

  ブラックホールは光の曲がりを計算して焼いた絵（components.tsx の BLACKHOLE_ART）を、影の
  半径が枠の hole になる大きさで置く。軌道は奥の半分がブラックホールの後ろを、手前の半分が
  前を通る（orbitHalves）。

  いちばん後ろには星雲を敷く（nebulaMap。件数には依らず、枠だけから決まる）。

  ここは UI を読まない（層の向き。test/source.test.ts）。
*/
import { ITEM_KIND_KEYS, type ItemKind, type KindCounts } from '../domain'

// 軌道図の枠。焦点（ブラックホール）の位置は枠ごとに決める
export type OrbitFrame = {
  width: number
  height: number
  // 焦点の位置（viewBox の単位）
  focus: { x: number; y: number }
  // いちばん内側と外側の軌道の長半径（軌道面の単位。斜めから見る前）
  inner: number
  outer: number
  /*
    天体を置かない矩形（焦点からの半幅・半高）。ブラックホールの影と、上へ回り込む光の弧と
    円盤の明るい芯が乗る。天体と番号の札はここに入れない
  */
  clear: { x: number; y: number }
  /*
    ブラックホールの黒い影の半径（viewBox の単位）。入口と締めは焼いた絵（components.tsx の
    BLACKHOLE_ART）をこの影の大きさで置き、作品の星図はロゴの O の黒い円をこの半径で描く
  */
  hole: number
}

/*
  軌道1本。d は1周、far と near はその奥の半分と手前の半分（軌道面がブラックホールの
  向こうへ回る側と、こちらへ来る側）。奥の半分はブラックホールの後ろ、手前の半分は
  前に描く（components.tsx の OrbitSystem / ContactOrbits）。軌道は区分を持たない——
  区分は天体の形で分ける（業務は輪のある惑星）。業務の軌道を破線にしていたころは、
  線が図面に見えた（持ち主の「線と点が図面っぽい」）
*/
export type OrbitPath = { d: string; far: string; near: string }
/*
  天体。side は札を先に試す側——枠の右の端に近い天体は左から試す（右へ出すと
  札が枠の外で切れる。placeLabels）。orbit は乗っている軌道（orbits の何番目か。作品が
  軌道の本数より多いときは、内側から順に相乗りする）。depth は奥行き（線の濃さの坂の
  奥の端で 0、手前の端で 1。OrbitMap の depth）、scale はそれを写した大きさの倍率
  （BODY_FAR から 1 まで）——手前の天体ほど大きく、奥ほど小さい。描く側が点と輪の
  大きさに掛ける
*/
export type OrbitBody = {
  kind: ItemKind
  x: number
  y: number
  side: 'left' | 'right'
  orbit: number
  depth: number
  scale: number
}
/*
  ブラックホールへ吸い込まれる光の粒（入口と締め。app.css の .orbit-dust）。軌道面の上の
  向き a（度）から1周回りながら、半径 r0 から r1 まで落ちる。1周して元の向きで落ち切る
  ので、r1 はその向きで、斜めから見て黒い円の縁に来る半径（手前と奥の向きほど長い）。
  dur 秒で1回、delay（負）で散らす。o は明るさ、w は点の太さ（px）
*/
export type OrbitDust = {
  a: number
  r0: number
  r1: number
  dur: number
  delay: number
  o: number
  w: number
}
export type OrbitMap = {
  width: number
  height: number
  orbits: OrbitPath[]
  bodies: OrbitBody[]
  // 軌道面を枠へ写す変換（焦点へ動かし、傾け、潰す。SVG の transform 属性）。粒はこの中の点
  plane: string
  dust: OrbitDust[]
  // 軌道に沿って流れる光の1周の秒数（orbits と同じ並び）
  flows: number[]
  /*
    枠を、軌道面の奥の側と手前の側に分ける半面（path）。軌道を流れる光は同じ写しを
    奥と手前の層に1つずつ置き、それぞれをこの半面で切る——ブラックホールの向こうを
    流れるあいだは後ろの層に、こちらへ来るあいだは前の層に見える
  */
  halves: { far: string; near: string }
  /*
    軌道の線の濃さの坂の両端（枠の点）。軌道面のいちばん奥（x1, y1）から、焦点を通って
    いちばん手前（x2, y2）へ。線は奥ほど薄く、手前へ続けて濃くなる（app.css の
    .orbit-depth__far / __near）。奥と手前の半分が同じ坂を読むので、継ぎ目で濃さが跳ばない
  */
  depth: { x1: number; y1: number; x2: number; y2: number }
  /*
    業務の天体の輪（輪のある惑星。components.tsx の Bodies）の半径（viewBox の単位）と傾き
    （度）。軌道面と同じ角度から見た楕円（横の半径 rx と、それに sin(ELEVATION) を掛けた縦の
    半径 ry）を、tilt だけ回す
  */
  ring: { rx: number; ry: number; tilt: number }
  /*
    軌道に沿う光の帯（components.tsx の OrbitBands）。軌道1本を BAND_STEPS の区間に分け、
    区間ごとの太さ w（viewBox の単位）と濃さ o を持つ——手前ほど太く明るい（透視の手がかり）。
    side は奥と手前のどちらの層に描くか（区間の真ん中が焦点より上なら奥）
  */
  bands: OrbitBand[]
  /*
    軌道に沿って散る星屑（components.tsx の Stardust）。奥と手前の層ごとに、明るさの段
    （STARDUST_CLASSES 段。0 がいちばん淡く小さい）ごとの path の d（長さ0の線の並び。
    描く側が丸い線端で点にする）
  */
  stardust: { far: string[]; near: string[] }
}

export type OrbitBand = { d: string; w: number; o: number; side: 'far' | 'near' }

// 軌道の本数の上限。これより多い作品は、内側から順に同じ軌道へ相乗りさせる
export const MAX_ORBITS = 5

/*
  軌道の形。どの軌道も同じ離心率（ECCENTRICITY）と同じ近点の向き（PERIAPSIS。軌道面の上の
  度）で、長半径だけが違う——焦点のまわりに相似に広げた入れ子なので、隣の軌道と交わらない。
  1本ずつ散らしていたころは、4本から隣どうしが交わり（7本で14か所）、潰れ方と中心のずれが
  1本ずつ違って、別々の傾きの面に乗って見えた。そろえても焦点は楕円の中心からずれたまま
  （同心の輪にはならない）。

  近点は軌道面の奥（270°。斜めから見ると上）——焦点は楕円の中心より奥に寄り、軌道は
  ブラックホールの手前（下）へ深く回り込む。左右は対称のまま。近点を横に向けていたころは、
  斜めから見た楕円の長軸が回って、面そのものが傾いて見えた
*/
const ECCENTRICITY = 0.1
const PERIAPSIS = 270

/*
  軌道面を見る量。面から見上げる角度（度。0 で真横から、90 で真上から）と、画面の中での
  面の回転（度）と、カメラの距離（枠の outer の何倍か）。縦の潰しは sin(ELEVATION)。

  - 透視で見る（CAMERA）。手前は大きく広がり、奥はブラックホールの後ろで詰まる——広い円盤を
    手前から見渡す奥行きが出る。どの距離も同じ大きさで見る（正射影）ころは、同じ形の輪が
    等しく並び、的か図面に見えた（持ち主の「軌道がださい。もっと壮大に」）。距離は枠の
    outer に比例させる（星図のように枠ごと縮めても、同じ形に見える）
  - ELEVATION 26°。14° のころは、7本の楕円が縦に潰れて詰まり、レコード盤か土星の輪に
    見えた（持ち主の「平たく詰まって見える」）
  - TILT 0°（水平）。−8° のころは、狙った傾きではなく曲がって見えた（持ち主の「傾きが
    中途半端」）。ブラックホールの絵も、app.css が同じ TILT で回す（--system-tilt。
    test/theme.test.ts が突き合わせる）
*/
export const ELEVATION = 26
export const TILT = 0
export const CAMERA = 2.4
const SQUASH = Math.sin((ELEVATION * Math.PI) / 180)
const FORESHORTEN = Math.cos((ELEVATION * Math.PI) / 180)

// 枠の縁から軌道を離す量（viewBox の単位）
const MARGIN = 14

/*
  入口の枠。縦横比は app.css の --system-ratio と同じ（test/theme.test.ts が見る）。

  真ん中（焦点）にはブラックホールを置く（components.tsx の OrbitSystem）。名前は
  置かない——名乗りは足元と Profile が持つ。天体を置かない矩形（clear）は影と光の芯の
  まわりの空き（番号の札もここを避ける）。

  - ブラックホールの影（半径 hole）は小さく、光（上へ回り込む弧と、影の前を横切る円盤）が
    星系の幅の 1/4 ほどに広がる。円盤の光はいちばん内側の軌道の内に収まる。影が 76 の
    ころは平らな黒い円が見出しより先に目に入って日食に見え、45 でも星屑の円盤より
    目立った（持ち主の「ブラックホールの主張が強すぎる」）。光も淡く置く（app.css の
    --hole-light）。影も光も小さい印のころ（星系の幅の 1/9 ほど）は軌道ばかりが目に付いた
    （持ち主の「ブラックホールとの釣り合い」）
  - いちばん外側の軌道は、枠の幅いっぱい（左右に MARGIN）に収まる。透視で手前が広がるぶん
    星系を縮める（orbitMap の fitScale。幅で決まる）。軌道は外ほど間を広げる（orbitAt）
  - 焦点は枠の上寄り——軌道は焦点より手前（下）へ深く回り（近点が奥）、透視で手前ほど大きく
    写るので、星系の上下の真ん中を枠の真ん中にそろえると焦点は上の 3 割ほどに来る。上と下の
    残りは番号の札の場所
*/
export const HERO_FRAME: OrbitFrame = {
  width: 1000,
  height: 560,
  focus: { x: 500, y: 166 },
  inner: 230,
  outer: 470,
  clear: { x: 150, y: 110 },
  hole: 35,
}

/*
  締めの枠。入口と同じ星系（軌道・天体・ブラックホールの大きさは入口の枠のまま）を、背の
  低い横長の枠に置く——番号の札を持たないので、上下の空きが要らない。高さは星系の上下の
  広がりに MARGIN を足しただけ。星系は枠の幅いっぱいで、電話の幅でも入口と同じ大きさに
  見える（持ち主の「星系を大きく」）。広い画面では枠の幅に上限を置く（app.css の --contact-w）
*/
export const CONTACT_FRAME: OrbitFrame = {
  ...HERO_FRAME,
  height: 512,
  focus: { x: 500, y: 142 },
}

/*
  作品の星図の枠（components.tsx の OrbitChart。画像の無い作品の、作品のページと一覧の
  行の絵）。締めの星系をそのまま縮めて、一覧のサムネイルと同じ背の低い横長（--chart-ratio。
  画像の枠の --thumb-ratio とほぼ同じ）に収める。軌道・ブラックホール・天体を置かない
  矩形を同じ比で縮めるので、天体は入口と締めと同じ向きに並ぶ（同じ件数なら同じ絵）。
  左右は余る
*/
const shrink = (frame: OrbitFrame, height: number): OrbitFrame => {
  const s = (height - 2 * MARGIN) / (frame.height - 2 * MARGIN)
  const k = (value: number) => Math.round(value * s * 100) / 100
  return {
    width: frame.width,
    height,
    focus: { x: frame.focus.x, y: MARGIN + k(frame.focus.y - MARGIN) },
    inner: k(frame.inner),
    outer: k(frame.outer),
    clear: { x: k(frame.clear.x), y: k(frame.clear.y) },
    hole: k(frame.hole),
  }
}
export const CHART_FRAME: OrbitFrame = shrink(CONTACT_FRAME, 320)

// 札を左へ出す境（枠の幅に対する割合）。これより右の天体は札を左へ
const LABEL_FLIP = 0.7

/*
  軌道を流れる光の1周の長さのもと（秒）。いちばん内側の軌道の公転の周期で、外側ほど長い
  （ケプラーの第3法則。周期は長半径の 1.5 乗に比例）。天体そのものは公転させない——
  天体は番号の札と同じ止まった場所に居る（札と食い違う天体を、重ねたときに札へ寄せると、
  跳ぶか軌道を外れて飛んだ）。動くのは光だけで、外側ほどゆっくり流れる
*/
const INNER_PERIOD = 90

// 軌道を流れる光は、公転の周期のこの割合で1周する
const FLOW_SHARE = 0.2

/*
  業務の天体の輪（OrbitMap の ring）。横の半径はいちばん内側の軌道の長半径に対する割合で、
  星系と一緒に伸び縮みする（ブラックホールの影の大きさには依らない）。傾き（度。負は
  左下から右上へ）は輪を軌道面から起こす量——水平のままだと、横長の楕円の真ん中に点が
  乗った姿が「目」の記号に見えた
*/
const RING_SHARE = 0.066
const RING_TILT = -22

// いちばん奥の天体の大きさ（手前の天体に対する倍率。OrbitBody の scale）
const BODY_FAR = 0.5

/*
  光の帯（OrbitMap の bands）。軌道1本の区間の数、太さ（viewBox の単位。奥の端と手前の端）、
  いちばん外側の軌道の濃さ（内側を 1 として）
*/
const BAND_STEPS = 16
const BAND_WIDTH = [4, 18] as const
const BAND_OUTER = 0.6

/*
  星屑（OrbitMap の stardust）。いちばん外側の軌道に散らす粒の数（内側は長半径に比例して
  少ない）と、明るさの段の境（STARDUST_CLASSES 段。描く側が段ごとに太さと濃さを決める）
*/
const STARDUST = 360
export const STARDUST_CLASSES = 4
const STARDUST_STEPS = [0.18, 0.42, 0.75] as const

/*
  天体を置く向きの刻み（度。画面の上の軌道の長さを1周 360° とみなした角）。黄金角と、同じ
  軌道に乗る次の天体までの角（orbitMap）。ROUND_TURN は1周（本数ぶん）進むごとに足す向きで、
  黄金角の列の続きを ROUND_SPREAD に直す。作品が本数より多いとき（本数は MAX_ORBITS）にだけ
  効く。札が重ならないことは test/orbits.test.ts が 20 件まで確かめる（透視にしたとき、
  196.5° のままでは 16〜18 件で札が重なった）
*/
const GOLDEN = 137.508
const ROUND_SPREAD = 186
const ROUND_TURN = (((ROUND_SPREAD - MAX_ORBITS * GOLDEN) % 360) + 360) % 360

/*
  決まった乱数（0〜1）。粒の置き場所と速さを、読み込むたびに同じにする（写しの HTML が
  毎回同じになり、テストも同じ形を見る）
*/
const seeded = (seed: number) => {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

const rad = (degrees: number) => (degrees * Math.PI) / 180
const round = (value: number) => Math.round(value * 10) / 10
const round3 = (value: number) => Math.round(value * 1000) / 1000

/*
  軌道面の点（焦点が原点。y は奥が負）を、透視で見た枠の点へ。カメラは焦点から
  CAMERA × outer の距離で、面から ELEVATION だけ上——面の y が手前（正）ほど近く、大きく
  写る。scale は星系を枠に収める倍率（fitScale）。最後に画面の中で TILT だけ回す
*/
const project = (frame: OrbitFrame, x: number, y: number, scale: number) => {
  const distance = CAMERA * frame.outer
  const near = (distance / (distance - y * FORESHORTEN)) * scale
  const cos = Math.cos(rad(TILT))
  const sin = Math.sin(rad(TILT))
  const sx = x * near
  const sy = y * SQUASH * near
  return { x: frame.focus.x + sx * cos - sy * sin, y: frame.focus.y + sx * sin + sy * cos }
}

/*
  区分を1列に並べる。少ないほうの区分を、多いほうの中へ均等に散らす
  （5 と 2 なら 個・業・個・個・業・個・個）。区分の順は ITEM_KIND_KEYS。
  残りの割合がいちばん大きい区分を次に置く。
*/
export function interleaveKinds(counts: KindCounts): ItemKind[] {
  const placed = Object.fromEntries(ITEM_KIND_KEYS.map((kind) => [kind, 0])) as KindCounts
  const total = ITEM_KIND_KEYS.reduce((sum, kind) => sum + counts[kind], 0)
  const order: ItemKind[] = []
  for (let step = 0; step < total; step += 1) {
    let best: ItemKind | null = null
    let bestShare = -1
    for (const kind of ITEM_KIND_KEYS) {
      if (counts[kind] === 0) continue
      const share = (counts[kind] - placed[kind]) / counts[kind]
      if (share > bestShare) {
        best = kind
        bestShare = share
      }
    }
    if (!best) break
    order.push(best)
    placed[best] += 1
  }
  return order
}

type Orbit = { a: number; e: number; omega: number }

/*
  i 本目の軌道（n 本のうち）。長半径だけが内から外へ同じ比で増える——外ほど間が広い
  （形は上の ECCENTRICITY）。等しい間隔で並べていたころは、線が縞のように詰まって見えた
*/
const orbitAt = (frame: OrbitFrame, i: number, n: number): Orbit => ({
  a: frame.inner * (frame.outer / frame.inner) ** (i / Math.max(1, n - 1)),
  e: ECCENTRICITY,
  omega: PERIAPSIS,
})

// 軌道面の楕円（焦点が原点）の、真近点角 nu の点。dr は半径を外へずらす割合（星屑の散り）
const pointAt = ({ a, e, omega }: Orbit, nu: number, dr = 0) => {
  const r = ((a * (1 - e * e)) / (1 + e * Math.cos(rad(nu)))) * (1 + dr)
  return { x: r * Math.cos(rad(nu + omega)), y: r * Math.sin(rad(nu + omega)) }
}

/*
  透視で見た軌道の楕円（枠の点。中心・横と縦の半径・回す角）。近点が面の奥（PERIAPSIS
  270°）にあるので、軌道は視線を含む縦の面について左右対称——写した楕円も縦の軸について
  対称で、軸は横と縦（を TILT だけ回したもの）。縦の半径は、軌道のいちばん奥といちばん
  手前の点を写した高さから。横の半径は、その真ん中の高さに写る面の点の横の広がりから
  （左右対称な楕円の、いちばん広い所は真ん中の高さ）
*/
function seenEllipse(frame: OrbitFrame, { a, e }: Orbit, scale: number) {
  const distance = CAMERA * frame.outer
  const b = a * Math.sqrt(1 - e * e)
  // 面の y を写した、焦点からの縦の離れ（回す前）
  const lift = (y: number) => ((y * SQUASH * distance) / (distance - y * FORESHORTEN)) * scale
  const top = lift(-a * (1 - e))
  const bottom = lift(a * (1 + e))
  const middle = (top + bottom) / 2
  // middle に写る面の y（lift の逆）と、そこでの軌道の横の広がり（面の楕円の中心は y = a·e）
  const lifted = middle / (SQUASH * scale)
  const y = (lifted * distance) / (distance + lifted * FORESHORTEN)
  const x = b * Math.sqrt(Math.max(0, 1 - ((y - a * e) / a) ** 2))
  const cos = Math.cos(rad(TILT))
  const sin = Math.sin(rad(TILT))
  return {
    center: { x: frame.focus.x - middle * sin, y: frame.focus.y + middle * cos },
    rx: ((x * distance) / (distance - y * FORESHORTEN)) * scale,
    ry: (bottom - top) / 2,
    angle: rad(TILT),
  }
}

// 透視で見た楕円を SVG の path にする（円弧2本で1周。長軸の向きは横）
function orbitPath(frame: OrbitFrame, orbit: Orbit, scale: number): string {
  const { center, rx, ry, angle } = seenEllipse(frame, orbit, scale)
  const dx = rx * Math.cos(angle)
  const dy = rx * Math.sin(angle)
  const deg = round((angle * 180) / Math.PI)
  const start = `${round(center.x + dx)} ${round(center.y + dy)}`
  const end = `${round(center.x - dx)} ${round(center.y - dy)}`
  const arc = `A${round(rx)} ${round(ry)} ${deg} 0 1`
  return `M${start}${arc} ${end}${arc} ${start}Z`
}

/*
  軌道を奥の半分と手前の半分に分ける。分け目は軌道面の上で焦点を通り、視線と直交する
  線（面の x 軸）と軌道が交わる2点——そこより奥（面の y が負。斜めから見ると上）が奥の
  半分。楕円の上の点を、写した楕円の媒介変数（中心からの角 θ）に直して、奥の半分が
  どちら回りかを奥の真ん中の点で確かめ、円弧1本ずつにする。
*/
function orbitHalves(
  frame: OrbitFrame,
  orbit: Orbit,
  scale: number,
): { far: string; near: string } {
  const { omega } = orbit
  const { center, rx, ry, angle } = seenEllipse(frame, orbit, scale)
  // 写した楕円の上の点の、中心からの媒介変数の角
  const thetaOf = (point: { x: number; y: number }) => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    const along = dx * Math.cos(angle) + dy * Math.sin(angle)
    const across = -dx * Math.sin(angle) + dy * Math.cos(angle)
    return Math.atan2(across / Math.max(ry, 1e-9), along / rx)
  }
  const seen = (nu: number) => {
    const point = pointAt(orbit, nu)
    return project(frame, point.x, point.y, scale)
  }
  // 面の y が 0 になる2点（真近点角 −ω と 180° − ω）と、奥の真ん中（270° − ω）
  const first = seen(-omega)
  const second = seen(180 - omega)
  const farMid = seen(270 - omega)
  const turn = 2 * Math.PI
  const wrap = (value: number) => ((value % turn) + turn) % turn
  const t1 = thetaOf(first)
  const span = wrap(thetaOf(second) - t1)
  const forward = wrap(thetaOf(farMid) - t1) < span
  // 奥の半分: first から second へ、奥の真ん中を通る向き
  const farSpan = forward ? span : turn - span
  const sweep = forward ? 1 : 0
  const deg = round((angle * 180) / Math.PI)
  const radii = `${round(rx)} ${round(ry)} ${deg}`
  const at = (point: { x: number; y: number }) => `${round(point.x)} ${round(point.y)}`
  return {
    far: `M${at(first)}A${radii} ${farSpan > Math.PI ? 1 : 0} ${sweep} ${at(second)}`,
    near: `M${at(second)}A${radii} ${turn - farSpan > Math.PI ? 1 : 0} ${sweep} ${at(first)}`,
  }
}

/*
  星系が枠の縁から MARGIN の内側に収まる倍率（外側の軌道の点を回って、透視で写して測る）。
  上下と左右は別々に測る——軌道は焦点より手前（下）へ深く回り、透視で手前ほど大きく
  写るので、上と下で届く量が違う
*/
function fitScale(frame: OrbitFrame, n: number): number {
  const reach = { left: 0, right: 0, up: 0, down: 0 }
  for (let i = 0; i < n; i += 1) {
    const orbit = orbitAt(frame, i, n)
    for (let nu = 0; nu < 360; nu += 2) {
      const point = pointAt(orbit, nu)
      const seen = project(frame, point.x, point.y, 1)
      reach.left = Math.max(reach.left, frame.focus.x - seen.x)
      reach.right = Math.max(reach.right, seen.x - frame.focus.x)
      reach.up = Math.max(reach.up, frame.focus.y - seen.y)
      reach.down = Math.max(reach.down, seen.y - frame.focus.y)
    }
  }
  const room = {
    left: frame.focus.x - MARGIN,
    right: frame.width - MARGIN - frame.focus.x,
    up: frame.focus.y - MARGIN,
    down: frame.height - MARGIN - frame.focus.y,
  }
  return Math.min(
    1,
    ...(['left', 'right', 'up', 'down'] as const).map(
      (side) => room[side] / Math.max(reach[side], 1),
    ),
  )
}

/*
  件数から軌道図を組む。作品が0件なら軌道も天体も無い（ブラックホールだけが残る）。

  j 番目の天体は (j mod 本数) 本目の軌道に乗り、画面の上の軌道の長さで黄金角ずつ回した
  所に置く（件数が増えても、天体が片側に固まらない。透視で詰まる奥には少ない）。作品が軌道の本数より多いと、
  同じ軌道に2つ目が乗る。黄金角の列の続きのままだと、本数 5 では1つ目からたった 32.5°
  （5 × 137.5° の余り）の所に来て、番号の札が重なった。そこで1周ごとに向きを足し、
  同じ軌道の次の天体を ROUND_SPREAD（186°。ほぼ反対側から少しずらす）先に置く。
  ちょうど半周にすると、入れ子の軌道で別の軌道の天体と同じ向きに並び、札が重なった。
  置いた点がブラックホールのまわりの矩形（frame.clear）に入ったら、軌道の上を先へ
  送って矩形の外に出す。
*/
export function orbitMap(counts: KindCounts, frame: OrbitFrame): OrbitMap {
  const kinds = interleaveKinds(counts)
  const n = Math.min(kinds.length, MAX_ORBITS)
  const scale = n > 0 ? fitScale(frame, n) : 1
  const orbits = Array.from({ length: n }, (_, i) => orbitAt(frame, i, n))
  const seen = (x: number, y: number) => project(frame, x, y, scale)

  /*
    線の濃さの坂の両端。軌道面の y（奥行き）のいちばん遠い所まで——楕円の中心の y に、
    その向きの半径（長半径と短半径を向きで混ぜたもの）を足した値の、全部の軌道での最大
  */
  const deepest = Math.max(
    frame.clear.y,
    ...orbits.map(({ a, e, omega }) => {
      const b = a * Math.sqrt(1 - e * e)
      return (
        Math.abs(a * e * Math.sin(rad(omega))) +
        Math.hypot(a * Math.sin(rad(omega)), b * Math.cos(rad(omega)))
      )
    }),
  )
  const farEnd = seen(0, -deepest)
  const nearEnd = seen(0, deepest)
  // 枠の点の奥行き。坂の奥の端で 0、手前の端で 1（天体の大きさ。OrbitBody の depth）
  const depthOf = (point: { x: number; y: number }) => {
    const dx = nearEnd.x - farEnd.x
    const dy = nearEnd.y - farEnd.y
    const t = ((point.x - farEnd.x) * dx + (point.y - farEnd.y) * dy) / (dx * dx + dy * dy)
    return Math.round(Math.min(1, Math.max(0, t)) * 100) / 100
  }
  // 奥（焦点より上）の層か
  const isFar = (point: { x: number; y: number }) =>
    (point.x - frame.focus.x) * Math.sin(rad(TILT)) -
      (point.y - frame.focus.y) * Math.cos(rad(TILT)) >
    0

  /*
    軌道ごとの、画面の上の長さで測った置き場所の表（真近点角 1° ごとの、近点から測った長さの
    割合）。透視で奥の半分は短く写るので、角で等しく刻むと天体が奥に詰まり、札が重なった
  */
  const lengths = orbits.map((orbit) => {
    const marks = [0]
    let last = seen(pointAt(orbit, 0).x, pointAt(orbit, 0).y)
    for (let degree = 1; degree <= 360; degree += 1) {
      const next = seen(pointAt(orbit, degree).x, pointAt(orbit, degree).y)
      marks.push((marks[degree - 1] ?? 0) + Math.hypot(next.x - last.x, next.y - last.y))
      last = next
    }
    const total = marks[360] ?? 1
    return marks.map((mark) => mark / total)
  })
  // 長さの割合 share（0〜1）に来る真近点角
  const nuAt = (i: number, share: number) => {
    const marks = lengths[i] ?? []
    const degree = Math.max(
      0,
      marks.findIndex((mark) => mark >= share),
    )
    const before = marks[degree - 1] ?? 0
    const after = marks[degree] ?? 1
    return degree - 1 + (after > before ? (share - before) / (after - before) : 0)
  }

  const bodies: OrbitBody[] = kinds.map((kind, j) => {
    const orbit = orbits[j % n] as Orbit
    /*
      置き場所を黄金角ずつ回して決める——角ではなく、画面の上の軌道の長さの割合で（1周を
      360° とみなした黄金角ずつ。近点から測る）。透視で詰まる奥には少なく、広がる手前には
      多く散る
    */
    // 何周目か（同じ軌道に乗る何番目の天体か）
    const lap = Math.floor(j / n)
    const turn = (((j * GOLDEN + lap * ROUND_TURN + 20 - orbit.omega) % 360) + 360) % 360
    let nu = nuAt(j % n, turn / 360)
    let at = seen(pointAt(orbit, nu).x, pointAt(orbit, nu).y)
    for (let tries = 0; tries < 16; tries += 1) {
      const inside =
        Math.abs(at.x - frame.focus.x) < frame.clear.x &&
        Math.abs(at.y - frame.focus.y) < frame.clear.y
      if (!inside) break
      nu = (nu + 23) % 360
      const point = pointAt(orbit, nu)
      at = seen(point.x, point.y)
    }
    return {
      kind,
      x: round(at.x),
      y: round(at.y),
      side: at.x > frame.width * LABEL_FLIP ? ('left' as const) : ('right' as const),
      orbit: j % n,
      depth: depthOf(at),
      scale: Math.round((BODY_FAR + (1 - BODY_FAR) * depthOf(at)) * 100) / 100,
    }
  })

  const aMin = orbits[0]?.a ?? 1
  /*
    軌道面を枠へ写す変換（粒の層）。透視は SVG の変換で書けないので、焦点のまわりで透視に
    いちばん近い平行の写し（焦点での縮みと潰し）にする——粒はブラックホールへ落ちるので、
    ほとんどの時間を焦点の近くで過ごし、そこでは透視とほぼ重なる
  */
  const plane = `translate(${frame.focus.x} ${frame.focus.y}) rotate(${TILT}) scale(${round3(scale)} ${round3(scale * SQUASH)})`

  /*
    吸い込まれる粒。軌道の内側の7割から外側の軌道の少し外までのどこかから、1周渦を巻いて
    黒い円の縁まで落ちる。落ち切る半径 r1 は、その向きで斜めから見て黒い円の縁に来る半径
    （手前と奥の向きは面が潰れて見えるぶん長い）で、始まりはそれより外。数は枠の大きさ
    （外側の軌道の長半径）に比例する。作品が0件でもブラックホールは粒を吸い込む
  */
  const inner = (orbits[0]?.a ?? frame.inner) * 0.7
  const outer = (orbits[orbits.length - 1]?.a ?? frame.outer) * 1.02
  const random = seeded(frame.width * 7 + frame.height)
  const dust: OrbitDust[] = Array.from({ length: Math.round(frame.outer / 8) }, () => {
    const a = round(random() * 360)
    const edge = frame.hole / (scale * Math.hypot(Math.cos(rad(a)), SQUASH * Math.sin(rad(a))))
    const r1 = round(edge * (1 + random() * 0.1))
    const from = Math.max(inner, r1 * 1.3)
    const dur = round(6 + random() * 6)
    return {
      a,
      r0: round(from + random() * Math.max(0, outer - from)),
      r1,
      dur,
      delay: -round(random() * dur),
      o: Math.round((0.35 + random() * 0.55) * 100) / 100,
      w: round(1.2 + random() * 1.2),
    }
  })

  // 奥と手前の半面。焦点を通る交線（面の x 軸を斜めから見た向き）と、その奥の向き
  const along = { x: Math.cos(rad(TILT)), y: Math.sin(rad(TILT)) }
  const back = { x: Math.sin(rad(TILT)), y: -Math.cos(rad(TILT)) }
  const reach = (frame.width + frame.height) * 2
  const half = (toward: { x: number; y: number }) => {
    const corner = (s: number, t: number) =>
      `${round(frame.focus.x + along.x * reach * s + toward.x * reach * t)} ${round(frame.focus.y + along.y * reach * s + toward.y * reach * t)}`
    return `M${corner(1, 0)}L${corner(-1, 0)}L${corner(-1, 1)}L${corner(1, 1)}Z`
  }

  /*
    光の帯。軌道を BAND_STEPS の区間に分け、区間ごとに折れ線（ぼかして描くので角は見えない）と
    太さと濃さを決める。手前ほど太く明るく（BAND_WIDTH の奥の端から手前の端まで）、外の軌道
    ほど淡い（BAND_OUTER）
  */
  const bands: OrbitBand[] = orbits.flatMap((orbit, i) =>
    Array.from({ length: BAND_STEPS }, (_, k) => {
      const points = Array.from({ length: 5 }, (_, m) => {
        const point = pointAt(orbit, ((k + m / 4) / BAND_STEPS) * 360)
        return seen(point.x, point.y)
      })
      const middle = points[2] as { x: number; y: number }
      const depth = depthOf(middle)
      const reach = i / Math.max(1, n - 1)
      return {
        d: `M${points.map((p) => `${round(p.x)} ${round(p.y)}`).join('L')}`,
        w: round(BAND_WIDTH[0] + (BAND_WIDTH[1] - BAND_WIDTH[0]) * depth),
        o: Math.round((0.2 + 0.8 * depth) * (1 - (1 - BAND_OUTER) * reach) * 100) / 100,
        side: isFar(middle) ? ('far' as const) : ('near' as const),
      }
    }),
  )

  /*
    星屑。軌道ごとに、長さ（長半径）に比例した数の粒を、軌道に沿って塊（濃い所）と疎らな所が
    できるように散らす。半径の向きにも少し散らす（帯の幅に収まる程度）。明るさは暗いものほど
    多く、手前ほど明るい段に寄る。乱数の種は軌道の順で決まる——入口と締めで同じ星屑になる
  */
  const stardust = {
    far: Array.from({ length: STARDUST_CLASSES }, () => [] as string[]),
    near: Array.from({ length: STARDUST_CLASSES }, () => [] as string[]),
  }
  const aMax = orbits[orbits.length - 1]?.a ?? frame.outer
  orbits.forEach((orbit, i) => {
    const random = seeded(1009 + i * 7919)
    const lumps = Array.from({ length: 3 }, () => ({ at: random() * 360, w: 40 + random() * 70 }))
    const count = Math.round((STARDUST * orbit.a) / aMax)
    for (let made = 0, tries = 0; made < count && tries < count * 20; tries += 1) {
      const nu = random() * 360
      const near = Math.max(
        ...lumps.map((lump) => Math.exp(-(((((nu - lump.at + 540) % 360) - 180) / lump.w) ** 2))),
      )
      if (random() > 0.3 + 0.7 * near) continue
      const dr = (random() + random() + random() - 1.5) * 0.03
      const point = pointAt(orbit, nu, dr)
      const at = seen(point.x, point.y)
      const score = random() ** 2.6 + 0.3 * depthOf(at)
      const step = STARDUST_STEPS.findIndex((edge) => score < edge)
      const level = step < 0 ? STARDUST_CLASSES - 1 : step
      ;(isFar(at) ? stardust.far : stardust.near)[level]?.push(`M${round(at.x)} ${round(at.y)}h0`)
      made += 1
    }
  })

  return {
    width: frame.width,
    height: frame.height,
    orbits: orbits.map((orbit) => ({
      d: orbitPath(frame, orbit, scale),
      ...orbitHalves(frame, orbit, scale),
    })),
    bodies,
    plane,
    dust,
    flows: orbits.map((orbit) => round(INNER_PERIOD * (orbit.a / aMin) ** 1.5 * FLOW_SHARE)),
    halves: { far: half(back), near: half({ x: -back.x, y: -back.y }) },
    depth: { x1: round(farEnd.x), y1: round(farEnd.y), x2: round(nearEnd.x), y2: round(nearEnd.y) },
    ring: {
      rx: round(frame.inner * RING_SHARE * scale),
      ry: round(frame.inner * RING_SHARE * SQUASH * scale),
      tilt: RING_TILT,
    },
    bands,
    stardust: {
      far: stardust.far.map((dots) => dots.join('')),
      near: stardust.near.map((dots) => dots.join('')),
    },
  }
}

/*
  星雲（入口と締めの星空の中、ブラックホールのまわり。描くのは components.tsx の Nebula）。
  持ち主の「もっと星雲っぽさがほしい」——軌道図の枠の中だけに淡く敷いていたころは、
  雲が小さく、星雲より霞に見えた。

  形は1枚の箱（NEBULA。ブラックホールが真ん中）の中で決め、描く側がブラックホールの
  位置に、図の幅に比例した大きさで置く（app.css の .cosmos__nebula）。箱は図より大きく、
  雲は軌道のまわりから画面の端の先まで広がる。字の後ろで消すのは星空の覆い（.cosmos）。

  雲は楕円の塊（lobes）を放射の坂で塗ったもので、質感（綿のような雲・渦に流れる筋・
  暗い塵の帯）は描く側の SVG のフィルタが乱数の模様で付ける。ここが決めるのは塊の
  置き場所・大きさ・向き・濃さ・色の役だけ。

  - 色の役は4つ——a・b・c はプリセットごとの3色（app.css の --nebula-a / -b / -c）、ink は
    字の白（明るい芯）。dust は地の色の塊で、明るい雲の上に暗い塵の帯を刻む
  - 明るい塊は軌道の帯の外（上と右下と右）に寄せ、軌道の帯の真後ろは中くらいに抑える。
    真後ろを明るくすると軌道の線が沈む（npm run check:contrast の「軌道の線と点」）
  - どの塊も箱の中で消えきる（箱の縁で雲を断ち切らない。test/orbits.test.ts）
*/
export const NEBULA = { width: 1600, height: 1000 } as const

export type NebulaTone = 'a' | 'b' | 'c' | 'ink' | 'dust'
export type NebulaLobe = {
  cx: number
  cy: number
  rx: number
  ry: number
  // 回す角（度）
  rot: number
  // 坂の真ん中の濃さ（0〜1）
  o: number
  tone: NebulaTone
}
export type NebulaMap = { width: number; height: number; lobes: NebulaLobe[] }

// 塊（ブラックホールは箱の真ん中 800, 500）。光る塊を先に、塵の帯を最後に
const NEBULA_LOBES: NebulaLobe[] = [
  // 全体を包む淡い光
  { cx: 760, cy: 470, rx: 700, ry: 400, rot: 14, o: 0.34, tone: 'a' },
  // 左上の大きな塊と、その芯
  { cx: 500, cy: 300, rx: 360, ry: 210, rot: 22, o: 0.62, tone: 'a' },
  { cx: 560, cy: 330, rx: 170, ry: 95, rot: 18, o: 0.42, tone: 'ink' },
  // 右下の塊
  { cx: 1090, cy: 680, rx: 390, ry: 190, rot: 18, o: 0.62, tone: 'b' },
  // 右上の塊
  { cx: 1200, cy: 300, rx: 300, ry: 170, rot: -18, o: 0.5, tone: 'c' },
  // 左下の淡い塊
  { cx: 420, cy: 700, rx: 260, ry: 140, rot: -10, o: 0.32, tone: 'c' },
  // ブラックホールのすぐ後ろの明かり
  { cx: 820, cy: 470, rx: 260, ry: 140, rot: 10, o: 0.34, tone: 'ink' },
  // 暗い塵の帯（明るい塊を斜めに横切る）
  { cx: 640, cy: 380, rx: 420, ry: 70, rot: -24, o: 0.7, tone: 'dust' },
  { cx: 1080, cy: 600, rx: 360, ry: 60, rot: 12, o: 0.6, tone: 'dust' },
]

export function nebulaMap(): NebulaMap {
  return { ...NEBULA, lobes: NEBULA_LOBES.map((lobe) => ({ ...lobe })) }
}

/*
  宇宙（入口と締めで、軌道図のまわりを画面の幅いっぱいに広げる星空。描くのは
  components.tsx の Cosmos）。持ち主の「もっと壮大に」——軌道図だけが枠の中の絵に見え、
  まわりの画面は空いていた。

  星は、画面の大きさに依らない1枚の視野（COSMOS）の中に、決まった乱数で置く。描く側が
  その視野を枠いっぱいに切り取って敷く（SVG の preserveAspectRatio slice）。点の太さは
  画面の px（描く側が non-scaling-stroke で保つ）なので、切り取る倍率が変わっても星は
  細かいまま。字の後ろには星を出さない——それは描く側の覆い（app.css の .cosmos）が受ける。

  - 暗い星ほど多い（明るさを累乗で偏らせる）。5つに1つほどが瞬く
  - いちばん明るい GLINTS 個には十字の光芒（glint）を付ける。望遠鏡で撮った星の印
  - 流れ星（meteors）は3本。置き場所・向き（度）・周期・遅れだけを決め、流し方は app.css
*/
export const COSMOS = { width: 1600, height: 1000 } as const
const COSMOS_STARS = 340
const GLINTS = 6
const COSMOS_TWINKLE = 0.2

export type CosmosStar = {
  x: number
  y: number
  o: number
  w: number
  twinkle: { dur: number; delay: number } | null
  glint: boolean
}
export type CosmosMeteor = { x: number; y: number; angle: number; dur: number; delay: number }
export type CosmosMap = {
  width: number
  height: number
  stars: CosmosStar[]
  meteors: CosmosMeteor[]
}

export function cosmosMap(): CosmosMap {
  const random = seeded(48271)
  const drawn = Array.from({ length: COSMOS_STARS }, () => {
    const x = round(random() * COSMOS.width)
    const y = round(random() * COSMOS.height)
    const bright = random() ** 2.2
    const dur = round(2.5 + random() * 4.5)
    return {
      x,
      y,
      o: Math.round((0.18 + bright * 0.72) * 100) / 100,
      w: round(0.6 + bright * 1.3),
      twinkle: random() < COSMOS_TWINKLE ? { dur, delay: -round(random() * dur) } : null,
    }
  })
  // 光芒を付ける明るさの境（明るいほうから GLINTS 番目）
  const glintFrom = [...drawn].sort((a, b) => b.o - a.o)[GLINTS - 1]?.o ?? 1
  return {
    ...COSMOS,
    stars: drawn.map((star) => ({ ...star, glint: star.o >= glintFrom })),
    // 右上から左下へ流れる（角は x 軸から時計回り）。画面の上のほう、字の無い所
    meteors: [
      { x: 1180, y: 90, angle: 160, dur: 13, delay: -2 },
      { x: 960, y: 40, angle: 150, dur: 17, delay: -9 },
      { x: 1460, y: 250, angle: 165, dur: 21, delay: -15 },
    ],
  }
}

/*
  天体と作品を結ぶ。天体は区分ごとの件数から並ぶ（interleaveKinds）ので、区分 k の
  j 番目の天体に、区分 k の作品の j 番目（一覧の並び）を載せる。載せる作品が足りない
  天体は null（件数と作品の列を別々に引いたとき、数えたあとに1件減っていても落ちない）。
*/
export function bodyItems<T extends { type: ItemKind }>(
  bodies: readonly { kind: ItemKind }[],
  items: readonly T[],
) {
  const taken = Object.fromEntries(ITEM_KIND_KEYS.map((kind) => [kind, 0])) as KindCounts
  return bodies.map((body) => {
    const item = items.filter((one) => one.type === body.kind)[taken[body.kind]] ?? null
    taken[body.kind] += 1
    return item
  })
}

/*
  作品ごとに、載っている天体（orbitMap の bodies の何番目か）を引く表。結び方は bodyItems と
  同じ1本で、天体の並びは件数だけから決まる（interleaveKinds。枠には依らない）。items は
  公開中の全件を一覧の並びで——絞り込んだ一覧の行だけを渡すと、区分の中の順が変わって
  別の天体を指す。

  作品の星図（components.tsx の OrbitChart）が、入口の軌道図で同じ作品が載っている天体と
  その軌道を灯すのに使う。載る天体の無い作品（件数を数えたあとに増えた行）は表に無い。
*/
export function bodyIndexOf<T extends { id: number; type: ItemKind }>(
  counts: KindCounts,
  items: readonly T[],
): Map<number, number> {
  const index = new Map<number, number>()
  bodyItems(
    interleaveKinds(counts).map((kind) => ({ kind })),
    items,
  ).forEach((item, j) => {
    if (item) index.set(item.id, j)
  })
  return index
}

/*
  入口の軌道図の札の置き場所（components.tsx の OrbitSystem）。

  札は天体の右上・左上・右下・左下のどれかに出す（ne / nw / se / sw）。天体の横に
  置くのは作品の番号（01・02 …）だけで、名前は札にマウスを重ねたときとキーボードで
  選んだときに出る（app.css の .system__name）——名前まで並べると、どの幅でも札が
  ブラックホールの光の縁に掛かった。置き場所は番号の札の大きさで選ぶ。

  枠の中に収まり、ほかの札・ほかの天体・ブラックホールに重ならない向きを選ぶ。どれも
  重なるなら、重なりのいちばん小さいもの。先に試す側は天体の side。重ならない向きが
  いくつかあれば、名前を出したときに伸びる側（ne / se は右、nw / sw は左）の枠の端
  までの空きが広いほう——狭い側では名前が省かれる（札の幅は labelRoom で止める）。

  札の大きさは画面の px で決まり（字の段）、枠は画面に合わせて伸び縮みする。札を
  出すのは枠が LABEL_MIN_WIDTH 以上のときだけ（app.css の @container）で、その
  いちばん小さい枠で重ならなければ、枠が大きいほど札は相対的に小さくなるので
  重ならない。だから札の箱は LABEL_MIN_WIDTH の枠の単位で測る。
*/
export type LabelSide = 'ne' | 'nw' | 'se' | 'sw'

// 札を出す枠の幅の下限（px）。app.css の @container (min-width: …) と同じ数（test/theme.test.ts が見る）
export const LABEL_MIN_WIDTH = 520
// 天体から札の角までの離れ（px）と、名前を出したときの札の幅の上限（px。長い名前は末尾を省く）
export const LABEL_GAP = { x: 10, y: 6 }
export const LABEL_MAX_WIDTH = 180
// 番号の札の大きさ（px。等幅の2字（--fs-label）と左右の余白、1行の高さ）
export const LABEL_SIZE = { width: 28, height: 18 }
// 札のまわりに空ける間（px）と、天体の点の半径（px。--orbit-body の上限の半分より大きめ）
const LABEL_PAD = 3
const BODY_RADIUS = 6
/*
  名前の伸びる空きが LABEL_MAX_WIDTH に足りない分の重さ（1 単位あたり）。重なりの
  重さ（面積）よりずっと軽く、重ならない向きどうしの比べにだけ効く
*/
const ROOM_WEIGHT = 0.01

/*
  札の伸びる向きの、天体から枠の端までの空き（枠の幅に対する %）。名前を出すと札は
  伸びる向きへ長くなる（ne / se は右へ、nw / sw は左へ）。app.css はこの空きから
  --label-dx を引いた幅で札を止める（部品が cqi で渡す。札の箱の % は幅 0 の li に
  対して解かれるので使えない）——止めないと、伸びた札が枠の overflow-x: clip に
  番号ごと切られる
*/
export function labelRoom(frame: OrbitFrame, body: OrbitBody, side: LabelSide): number {
  const room = side === 'ne' || side === 'se' ? frame.width - body.x : body.x
  return Math.round((room / frame.width) * 10000) / 100
}

type Box = { x0: number; y0: number; x1: number; y1: number }

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))

export function placeLabels(frame: OrbitFrame, bodies: OrbitBody[]): LabelSide[] {
  // px → viewBox の単位（いちばん小さい枠で）
  const unit = frame.width / LABEL_MIN_WIDTH
  const boxOf = (i: number, side: LabelSide): Box => {
    const body = bodies[i] as OrbitBody
    const w = LABEL_SIZE.width * unit
    const h = LABEL_SIZE.height * unit
    const gx = LABEL_GAP.x * unit
    const gy = LABEL_GAP.y * unit
    const x0 = side === 'ne' || side === 'se' ? body.x + gx : body.x - gx - w
    const y0 = side === 'ne' || side === 'nw' ? body.y - gy - h : body.y + gy
    return { x0, y0, x1: x0 + w, y1: y0 + h }
  }
  const grow = (box: Box, by: number): Box => ({
    x0: box.x0 - by,
    y0: box.y0 - by,
    x1: box.x1 + by,
    y1: box.y1 + by,
  })
  const dots = bodies.map((body) => ({
    x0: body.x - BODY_RADIUS * unit,
    y0: body.y - BODY_RADIUS * unit,
    x1: body.x + BODY_RADIUS * unit,
    y1: body.y + BODY_RADIUS * unit,
  }))
  // ブラックホールの黒い円と光の縁（天体を置かない矩形。viewBox の単位のまま）
  const hole: Box = {
    x0: frame.focus.x - frame.clear.x,
    y0: frame.focus.y - frame.clear.y,
    x1: frame.focus.x + frame.clear.x,
    y1: frame.focus.y + frame.clear.y,
  }
  const whole: Box = { x0: 0, y0: 0, x1: frame.width, y1: frame.height }
  /*
    札 i を side に置いたときの重さ。枠の外へ出る分は、どんな重なりより重い（切れた札は
    読めない。ほかに向きが無いときだけ、はみ出しのいちばん小さい向きに置く）。
    ブラックホールに重なる分がその次（光の縁の上に乗った札は絵を隠す）。ほかの天体と、
    ほかの札（labels に向きが決まっているもの）に重なる分はそのまま数える。名前の
    伸びる空きの足りなさは、いちばん軽い（ROOM_WEIGHT）
  */
  const costOf = (i: number, side: LabelSide, labels: (LabelSide | null)[]) => {
    const box = boxOf(i, side)
    const padded = grow(box, LABEL_PAD * unit)
    const outside = (box.x1 - box.x0) * (box.y1 - box.y0) - overlap(box, whole)
    const room = side === 'ne' || side === 'se' ? frame.width - box.x0 : box.x1
    let cost =
      outside * 1e6 +
      overlap(padded, hole) * 2 +
      Math.max(0, LABEL_MAX_WIDTH * unit - room) * ROOM_WEIGHT
    dots.forEach((dot, j) => {
      if (j !== i) cost += overlap(padded, dot)
    })
    labels.forEach((other, j) => {
      if (j !== i && other) cost += overlap(padded, boxOf(j, other))
    })
    return cost
  }
  const orderOf = (i: number): LabelSide[] =>
    bodies[i]?.side === 'right' ? ['ne', 'se', 'nw', 'sw'] : ['nw', 'sw', 'ne', 'se']
  const best = (i: number, labels: (LabelSide | null)[]) => {
    let chosen: { side: LabelSide; cost: number } | null = null
    for (const side of orderOf(i)) {
      const cost = costOf(i, side, labels)
      if (!chosen || cost < chosen.cost) chosen = { side, cost }
      if (cost === 0) break
    }
    // orderOf は4つの向きを返すので、必ず決まる
    return chosen as { side: LabelSide; cost: number }
  }

  // 1. 天体の順に、先に置いた札を避けて1つずつ置く
  const labels: (LabelSide | null)[] = bodies.map(() => null)
  bodies.forEach((_, i) => {
    labels[i] = best(i, labels).side
  })
  /*
    2. 全部置いたあとで、1つずつ置き直す（ほかの札を全部見て、いまより軽い向きが
    あれば移す）。先着順だけだと、先に置いた札が後の天体の唯一の逃げ場をふさいで
    いることがある（枠の右の端の天体は左にしか出せない、など）。軽くなる限り回すが、
    同じ入力なら同じ答え（向きを試す順も天体の順も決まっている）
  */
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false
    bodies.forEach((_, i) => {
      const now = costOf(i, labels[i] as LabelSide, labels)
      const next = best(i, labels)
      if (next.cost < now) {
        labels[i] = next.side
        moved = true
      }
    })
    if (!moved) break
  }
  return labels as LabelSide[]
}
