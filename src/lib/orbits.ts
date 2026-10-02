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

  星屑と天体は軌道ごと公転する（持ち主の「軌道の線を星と一緒に動かして」）。写した楕円を
  単位円に直した座標（OrbitPath の ellipse）で持ち、描く側がその中で回す——回しても楕円の
  上から外れない。向きは吸い込まれる粒と同じで、内側ほど速い（OrbitPath の period）。

  ブラックホールは光の曲がりを計算して焼いた絵（components.tsx の BLACKHOLE_ART）を、影の
  半径が枠の hole になる大きさで置く。軌道は奥の半分がブラックホールの後ろを、手前の半分が
  前を通る（orbitHalves）。

  いちばん後ろには、画面の端まで広がる星雲を敷く（nebulaMap。件数にも枠にも依らない1枚の箱）。

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
    円盤の明るい芯が乗る。天体はここに入れない
  */
  clear: { x: number; y: number }
  /*
    ブラックホールの黒い影の半径（viewBox の単位）。入口と締めは焼いた絵（components.tsx の
    BLACKHOLE_ART）をこの影の大きさで置く
  */
  hole: number
}

/*
  軌道1本。d は1周、far と near はその奥の半分と手前の半分（軌道面がブラックホールの
  向こうへ回る側と、こちらへ来る側）。奥の半分はブラックホールの後ろ、手前の半分は
  前に描く（components.tsx の OrbitSystem / ContactOrbits）。軌道は区分を持たない——
  区分は天体の形で分ける（業務は輪のある惑星）。業務の軌道を破線にしていたころは、
  線が図面に見えた（持ち主の「線と点が図面っぽい」）。

  - ellipse は写した楕円（枠の点。中心・横と縦の半径・回す角の度）。星屑と天体はこの楕円を
    単位円に直した座標で持ち、描く側が translate(cx cy) rotate(angle) scale(rx ry) の中で
    回す（components.tsx の Motion）
  - period は公転の周期（秒）。星屑と天体はこの秒数で1周する
  - ticks は星屑が1周を何回に分けて進むか（STARDUST_TICKS。描く側が steps() に渡す）
  - sway は、軌道の上の向き（写した楕円の媒介変数の角。右の端の 0° から、画面で時計回り＝
    手前へ）を SWAY_STEPS 等分した点ごとの天体の大きさの倍率（0° と 360° の両端を含む）。
    回る天体の大きさの揺れで、描く側が CSS の linear() に渡す——手前へ回ると大きく、奥へ
    回ると小さい。止まった天体の大きさ（OrbitBody の scale）と同じ式
  - stardust は星屑。明るさの段（STARDUST_CLASSES 段。0 がいちばん淡く小さい）ごとの path の d
    （単位円に直した座標の、長さ0の線の並び。描く側が丸い線端で点にする）
*/
export type OrbitPath = {
  d: string
  far: string
  near: string
  ellipse: { cx: number; cy: number; rx: number; ry: number; angle: number }
  period: number
  ticks: number
  sway: number[]
  stardust: string[]
}
/*
  天体。x と y は止まった姿の置き場所（枠の点）。orbit は乗る軌道（OrbitMap の orbits の
  何本目か）、u と v はその軌道の単位円に直した置き場所、turn はその向き（度。OrbitPath の
  sway と同じ角）——回る天体はここから動き出す。depth は奥行き（線の濃さの坂の奥の端で 0、
  手前の端で 1。OrbitMap の depth）、scale はそれを写した大きさの倍率（BODY_FAR から 1 まで）
  ——手前の天体ほど大きく、奥ほど小さい。描く側が点と輪の大きさに掛ける
*/
export type OrbitBody = {
  kind: ItemKind
  x: number
  y: number
  orbit: number
  u: number
  v: number
  turn: number
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
  // 軌道を流れる星の1周の秒数（orbits と同じ並び。公転より速く、星屑と天体を追い越す）
  flows: number[]
  /*
    枠を、軌道面の奥の側と手前の側に分ける半面（path）。軌道を流れる星や天体は同じ写しを
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
    outer に比例させる（枠ごと縮めても、同じ形に見える）
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
  まわりの空き。

  - ブラックホールの影（半径 hole）は小さく、光（上へ回り込む弧と、影の前を横切る円盤）が
    星系の幅の 1/4 ほどに広がる。円盤の光はいちばん内側の軌道の内に収まる。影が 76 の
    ころは平らな黒い円が見出しより先に目に入って日食に見え、45 でも星屑の円盤より
    目立った（持ち主の「ブラックホールの主張が強すぎる」）。光も淡く置く（app.css の
    --hole-light）。影も光も小さい印のころ（星系の幅の 1/9 ほど）は軌道ばかりが目に付いた
    （持ち主の「ブラックホールとの釣り合い」）
  - いちばん外側の軌道は、枠の幅いっぱい（左右に MARGIN）に収まる。透視で手前が広がるぶん
    星系を縮める（orbitMap の fitScale。幅で決まる）。軌道は外ほど間を広げる（orbitAt）
  - 焦点は枠の上寄り——軌道は焦点より手前（下）へ深く回り（近点が奥）、透視で手前ほど大きく
    写るので、星系の上下の真ん中を枠の真ん中にそろえると焦点は上の 3 割ほどに来る。上と下には
    空きが残る（締めの枠はこの空きを外したもの）
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
  低い横長の枠に置く——入口の枠から上下の空きを外しただけで、高さは星系の上下の
  広がりに MARGIN を足したもの。星系は枠の幅いっぱいで、電話の幅でも入口と同じ大きさに
  見える（持ち主の「星系を大きく」）。広い画面では枠の幅に上限を置く（app.css の --contact-w）
*/
export const CONTACT_FRAME: OrbitFrame = {
  ...HERO_FRAME,
  height: 512,
  focus: { x: 500, y: 142 },
}

/*
  公転の周期のもと（秒）。いちばん内側の軌道の1周で、外側ほど長い（ケプラーの第3法則。周期は
  長半径の 1.5 乗に比例。OrbitPath の period）。星屑と天体は軌道ごとこの周期で回り、外側ほど
  ゆっくり回る——円盤が渦を巻いて見える。速くすると図そのものが回って見え、目が字から離れる
*/
const INNER_PERIOD = 90

// 軌道を流れる星は、公転の周期のこの割合で1周する（星屑と天体を追い越して流れる）
const FLOW_SHARE = 0.2

// 回る天体の大きさの揺れ（OrbitPath の sway）を、1周の何等分の点で渡すか
const SWAY_STEPS = 24

/*
  星屑を1秒に何回進めるか（OrbitPath の ticks）。星屑は千を超える粒で、毎コマ描き直すと
  入口の描画の時間が3倍になった。公転はゆっくりで（いちばん速い内側の軌道の手前でも、机の
  幅で 1 秒に 10px ほど）、1回に進むのは 1px に満たないので、刻んで進めても滑らかに見える
*/
const STARDUST_TICKS = 12

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
  星屑（OrbitPath の stardust）。いちばん外側の軌道に散らす粒の数（内側は長半径に比例して
  少ない）と、明るさの段の境（STARDUST_CLASSES 段。描く側が段ごとに太さと濃さを決める）
*/
const STARDUST = 360
export const STARDUST_CLASSES = 4
const STARDUST_STEPS = [0.18, 0.42, 0.75] as const

/*
  天体を置く向きの刻み（度。画面の上の軌道の長さを1周 360° とみなした角）。黄金角と、同じ
  軌道に乗る次の天体までの角（orbitMap）。ROUND_TURN は1周（本数ぶん）進むごとに足す向きで、
  黄金角の列の続きを ROUND_SPREAD に直す。作品が本数より多いとき（本数は MAX_ORBITS）にだけ
  効く。186° は、前に天体の横に置いていた番号の札が重ならないように選んだ値（196.5° では
  16〜18 件で札が重なった）。札を外したいまは、同じ軌道の天体をほぼ反対側へ散らすためだけに
  効く。天体どうしの間は test/orbits.test.ts が 20 件まで確かめる
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
const round4 = (value: number) => Math.round(value * 10000) / 10000

type Ellipse = OrbitPath['ellipse']

/*
  単位円に直した星屑の粒1つを、長さ0の線の path にする。3 桁で、頭の 0 を落とす（粒は
  千を超えて、入口と締めの HTML に奥と手前の2回ずつ載る）。3 桁の丸めは、いちばん外側の
  軌道でも枠の単位で 0.3 に収まる
*/
const unitDot = (u: number, v: number) => {
  const text = (value: number) => String(round3(value)).replace(/^(-?)0\./, '$1.')
  const x = text(u)
  const y = text(v)
  return `M${x}${y.startsWith('-') ? '' : ' '}${y}h0`
}

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
  （5 × 137.5° の余り）の所に来て、同じ軌道の2つが寄った。そこで1周ごとに向きを足し、
  同じ軌道の次の天体を ROUND_SPREAD（186°。ほぼ反対側から少しずらす）先に置く。
  ちょうど半周にすると、入れ子の軌道で別の軌道の天体と同じ向きに一列に並んだ。
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
  const depthAt = (point: { x: number; y: number }) => {
    const dx = nearEnd.x - farEnd.x
    const dy = nearEnd.y - farEnd.y
    const t = ((point.x - farEnd.x) * dx + (point.y - farEnd.y) * dy) / (dx * dx + dy * dy)
    return Math.min(1, Math.max(0, t))
  }
  const depthOf = (point: { x: number; y: number }) => Math.round(depthAt(point) * 100) / 100
  // 天体の大きさの倍率。奥行きを BODY_FAR から 1 までに写す（止まった天体と回る天体で同じ式）
  const sizeAt = (depth: number) => BODY_FAR + (1 - BODY_FAR) * depth
  // 奥（焦点より上）の層か
  const isFar = (point: { x: number; y: number }) =>
    (point.x - frame.focus.x) * Math.sin(rad(TILT)) -
      (point.y - frame.focus.y) * Math.cos(rad(TILT)) >
    0

  /*
    軌道ごとの写した楕円（OrbitPath の ellipse）。線の d と同じ丸めで持つ——星屑と天体は
    この楕円の枠の中で回るので、線から外れない
  */
  const ellipses: Ellipse[] = orbits.map((orbit) => {
    const { center, rx, ry, angle } = seenEllipse(frame, orbit, scale)
    return {
      cx: round(center.x),
      cy: round(center.y),
      rx: round(rx),
      ry: round(ry),
      angle: round((angle * 180) / Math.PI),
    }
  })
  // 枠の点を、i 本目の軌道の単位円に直す（楕円の中心へ寄せ、回す角を戻し、半径で割る）
  const unitOf = (i: number, point: { x: number; y: number }) => {
    const { cx, cy, rx, ry, angle } = ellipses[i] as Ellipse
    const cos = Math.cos(rad(angle))
    const sin = Math.sin(rad(angle))
    const dx = point.x - cx
    const dy = point.y - cy
    return { u: (dx * cos + dy * sin) / rx, v: (-dx * sin + dy * cos) / ry }
  }
  // i 本目の軌道の写した楕円の、向き theta（度）の点
  const ellipseAt = (i: number, theta: number) => {
    const { cx, cy, rx, ry, angle } = ellipses[i] as Ellipse
    const cos = Math.cos(rad(angle))
    const sin = Math.sin(rad(angle))
    const u = rx * Math.cos(rad(theta))
    const v = ry * Math.sin(rad(theta))
    return { x: cx + u * cos - v * sin, y: cy + u * sin + v * cos }
  }

  /*
    軌道ごとの、画面の上の長さで測った置き場所の表（真近点角 1° ごとの、近点から測った長さの
    割合）。透視で奥の半分は短く写るので、角で等しく刻むと天体が奥に詰まった
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
    const x = round(at.x)
    const y = round(at.y)
    // 回る天体の出だし。止まった置き場所を、乗る軌道の単位円に直す
    const { u, v } = unitOf(j % n, { x, y })
    return {
      kind,
      x,
      y,
      orbit: j % n,
      u: round4(u),
      v: round4(v),
      turn: round(((Math.atan2(v, u) * 180) / Math.PI + 360) % 360),
      depth: depthOf(at),
      scale: Math.round(sizeAt(depthOf(at)) * 100) / 100,
    }
  })

  const aMin = orbits[0]?.a ?? 1
  // 公転の周期（OrbitPath の period）
  const periods = orbits.map((orbit) => round(INNER_PERIOD * (orbit.a / aMin) ** 1.5))
  /*
    回る天体の大きさの揺れ（OrbitPath の sway）。写した楕円を SWAY_STEPS 等分した向きごとの、
    止まった天体と同じ式の倍率（奥行きの坂を写す）
  */
  const sways = orbits.map((_, i) =>
    Array.from({ length: SWAY_STEPS + 1 }, (_, k) =>
      round3(sizeAt(depthAt(ellipseAt(i, (k / SWAY_STEPS) * 360)))),
    ),
  )
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
    多く、出だしで手前に居るものほど明るい段に寄る。乱数の種は軌道の順で決まる——入口と締めで
    同じ星屑になる。置き場所はその軌道の単位円に直して持つ（回るのは描く側。塊ごと回るので、
    軌道が回って見える）
  */
  const stardust = orbits.map(() => Array.from({ length: STARDUST_CLASSES }, () => [] as string[]))
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
      const { u, v } = unitOf(i, at)
      stardust[i]?.[level]?.push(unitDot(u, v))
      made += 1
    }
  })

  return {
    width: frame.width,
    height: frame.height,
    orbits: orbits.map((orbit, i) => ({
      d: orbitPath(frame, orbit, scale),
      ...orbitHalves(frame, orbit, scale),
      ellipse: ellipses[i] as Ellipse,
      period: periods[i] ?? INNER_PERIOD,
      ticks: Math.round((periods[i] ?? INNER_PERIOD) * STARDUST_TICKS),
      sway: sways[i] ?? [],
      stardust: (stardust[i] ?? []).map((dots) => dots.join('')),
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
  }
}

/*
  星雲（入口と締めの星空の中、ブラックホールのまわりから画面の端まで。描くのは
  components.tsx の Nebula）。持ち主の「もっと星雲っぽさがほしい」「星雲をもっと画面広く」
  ——軌道図の枠の中だけに淡く敷いていたころは雲が小さく霞に見え、軌道図のまわりだけに
  置いていたころは、900 以上の入口で星雲が画面の右半分に寄っていた。

  形は1枚の箱（NEBULA。ブラックホールが真ん中）の中で決め、描く側がブラックホールの
  位置に、図の幅に比例した大きさで置く（app.css の .cosmos__nebula。箱は図の幅の 3.5 倍ほど）。
  字の後ろで消すのは、字の塊が敷く暗がり（app.css の「字の暗がり」）。

  芯（軌道のまわり）がいちばん明るく、外の雲は芯から曲がって細りながら伸びる腕
  （NEBULA_ARMS）と、腕のあいだを埋める淡い広がりで、先ほど淡い。外の雲を芯と同じ明るさで
  画面に敷き詰めていたころは、大理石の壁紙に見え、ブラックホールが雲の真ん中に見えなかった。

  雲は楕円の塊（lobes）を放射の坂で塗ったもので、質感（綿のような雲・渦に流れる筋・
  暗い塵の帯）は描く側の SVG のフィルタが乱数の模様で付ける。ここが決めるのは塊の
  置き場所・大きさ・向き・濃さ・色の役だけ。模様の大きさは箱の単位で決まるので、外の雲も
  芯と同じ肌理になり、筋は塊と一緒に先ほど淡くなる。

  - 色の役は4つ——a・b・c はプリセットごとの3色（app.css の --nebula-a / -b / -c）、ink は
    字の白（明るい芯）。dust は地の色の塊で、明るい雲の上に暗い塵の帯を刻む
  - 明るい塊は軌道の帯の外（上と右下と右）に寄せ、軌道の帯の真後ろは中くらいに抑える。
    真後ろを明るくすると軌道の線が沈む（npm run check:contrast の「軌道の線と星屑」）
  - 腕は画面の縦横に沿わせず、左上と右下へ S の字に流す（右上と右下へは短く淡く）。外の雲を
    字の場所を避けて上の帯と右の列に並べていたころは、星雲が字の列の形に欠けた「Γ」の枠に
    見え、帯は横縞に見えた。同じ長さの腕を四方へ開くと、広い画面でバツ印に見えた
  - 左下は空ける——900 以上の入口では見出しの列、締めと 900 未満では図の下の字が居る所。
    明るい雲を置くと、字の暗がりの縁が雲を断ち切る線に見える
  - どの塊も箱の中で消えきる（箱の縁で雲を断ち切らない。test/orbits.test.ts）
*/
export const NEBULA = { width: 3600, height: 2000 } as const

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

/*
  外の雲の腕。根元・曲がり・先の3点（箱の座標）の2次のベジェに沿って、小さな塊を重ねて
  並べる。塊は流れの向きに長く（間隔より長くして重ねる）、根元から先へ細く（width）淡く
  （o）なり、決まった乱数（seed）で少しずつ横へずれて向きも揺れる。色の役は根元から先へ
  tones の順。大きな楕円を数個並べていたころは、塊の形が玉に見えた
*/
type NebulaArm = {
  path: readonly [readonly [number, number], readonly [number, number], readonly [number, number]]
  count: number
  width: readonly [number, number]
  o: readonly [number, number]
  tones: readonly NebulaTone[]
  seed: number
}

const NEBULA_ARMS: NebulaArm[] = [
  // 左上へ大きく、先で上へ反る。900 以上の入口では見出しの列の上を通り、画面の上の端へ抜ける
  {
    path: [
      [1500, 700],
      [900, 640],
      [380, 300],
    ],
    count: 13,
    width: [230, 110],
    o: [0.36, 0.12],
    tones: ['a', 'a', 'c', 'c'],
    seed: 11,
  },
  // 右下へ下がってから右へ上がる、太い尾（左上の腕と S の字に流れる）
  {
    path: [
      [2200, 1150],
      [2850, 1480],
      [3350, 1180],
    ],
    count: 13,
    width: [260, 120],
    o: [0.34, 0.12],
    tones: ['b', 'b', 'a', 'c'],
    seed: 37,
  },
  // 右上へ短く淡く
  {
    path: [
      [2150, 760],
      [2550, 600],
      [2950, 620],
    ],
    count: 7,
    width: [150, 70],
    o: [0.24, 0.08],
    tones: ['c', 'c', 'b'],
    seed: 23,
  },
  // 右下へ淡く。締めの字の右（900 以上の入口では件数の帯の下に入り、見えない）
  {
    path: [
      [2350, 1450],
      [2600, 1720],
      [3050, 1800],
    ],
    count: 7,
    width: [150, 80],
    o: [0.18, 0.06],
    tones: ['b', 'c'],
    seed: 41,
  },
]

const armLobes = (arm: NebulaArm): NebulaLobe[] => {
  const random = seeded(arm.seed)
  const [p0, p1, p2] = arm.path
  // 流れの上の点と、その向き
  const at = (t: number) => {
    const [a, b, c] = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2]
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]] as const
  }
  const along = (t: number) =>
    [
      2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]),
      2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]),
    ] as const
  const lerp = ([from, to]: readonly [number, number], t: number) => from + (to - from) * t
  let length = 0
  for (let k = 1; k <= 32; k += 1) {
    const [ax, ay] = at((k - 1) / 32)
    const [bx, by] = at(k / 32)
    length += Math.hypot(bx - ax, by - ay)
  }
  const step = length / (arm.count - 1)
  return Array.from({ length: arm.count }, (_, i) => {
    const t = i / (arm.count - 1)
    const [x, y] = at(t)
    const [dx, dy] = along(t)
    const angle = Math.atan2(dy, dx)
    const width = lerp(arm.width, t)
    const drift = (random() - 0.5) * width * 1.2
    const size = 0.6 + random() * 0.8
    return {
      cx: Math.round(x - Math.sin(angle) * drift),
      cy: Math.round(y + Math.cos(angle) * drift),
      rx: Math.round(step * (1.2 + random() * 0.6) * size),
      ry: Math.round(width * size),
      rot: Math.round((angle * 180) / Math.PI + (random() - 0.5) * 30),
      o: Math.round(lerp(arm.o, t) * (0.8 + random() * 0.4) * 100) / 100,
      tone: arm.tones[Math.min(arm.tones.length - 1, Math.floor(t * arm.tones.length))] ?? 'a',
    }
  })
}

// 塊（ブラックホールは箱の真ん中 1800, 1000）。光る塊を先に、塵の帯を最後に
const NEBULA_LOBES: NebulaLobe[] = [
  // 芯を包む淡い光
  { cx: 1760, cy: 970, rx: 700, ry: 400, rot: 14, o: 0.34, tone: 'a' },
  // 外の雲。腕のあいだを埋める淡い広がりと、腕
  { cx: 1950, cy: 950, rx: 1250, ry: 650, rot: 6, o: 0.1, tone: 'a' },
  ...NEBULA_ARMS.flatMap(armLobes),
  // 芯。左上の大きな塊と、その芯
  { cx: 1500, cy: 800, rx: 360, ry: 210, rot: 22, o: 0.62, tone: 'a' },
  { cx: 1560, cy: 830, rx: 170, ry: 95, rot: 18, o: 0.42, tone: 'ink' },
  // 右下の塊
  { cx: 2090, cy: 1180, rx: 390, ry: 190, rot: 18, o: 0.62, tone: 'b' },
  // 右上の塊
  { cx: 2200, cy: 800, rx: 300, ry: 170, rot: -18, o: 0.5, tone: 'c' },
  // 左下の淡い塊
  { cx: 1420, cy: 1200, rx: 260, ry: 140, rot: -10, o: 0.32, tone: 'c' },
  // ブラックホールのすぐ後ろの明かり
  { cx: 1820, cy: 970, rx: 260, ry: 140, rot: 10, o: 0.34, tone: 'ink' },
  // 暗い塵の帯（明るい塊と腕を斜めに横切る）
  { cx: 1640, cy: 880, rx: 420, ry: 70, rot: -24, o: 0.7, tone: 'dust' },
  { cx: 2080, cy: 1100, rx: 360, ry: 60, rot: 12, o: 0.6, tone: 'dust' },
  { cx: 1000, cy: 560, rx: 360, ry: 36, rot: -12, o: 0.4, tone: 'dust' },
  { cx: 2650, cy: 1350, rx: 320, ry: 34, rot: 8, o: 0.35, tone: 'dust' },
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
  細かいまま。字の後ろには星を出さない——それは字の塊が敷く暗がり（app.css の「字の暗がり」）が
  受ける。

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
