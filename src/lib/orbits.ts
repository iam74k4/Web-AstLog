/*
  入口と締めの軌道図の形（描くのは src/ui/components.tsx の OrbitSystem /
  ContactOrbits）。

  真ん中にブラックホールを置き、公開中の作品を1つずつ楕円の軌道に載せる。
  ブラックホールは楕円の中心ではなく焦点に居る（ケプラーの第一法則）——中心に置くと、
  軌道の1本1本がただの同心の輪になり、原子のマークと見分けがつかない。

  形は件数（区分ごとの数）だけから決める。作品の名前や slug には依らないので、
  同じ件数なら同じ絵になり、描き直しで天体が跳ねない。個人開発は塗りの点、業務は
  輪と破線の軌道（区分の呼び名は src/domain.ts の KIND_LABEL）。

  座標は SVG の viewBox の単位。軌道は「軌道面の楕円を、低い角度から斜めに見た」
  形にする——面を縦に潰し（sin(ELEVATION)）、少し回す（TILT）。斜めから見た楕円も
  楕円なので、潰して回したあとの主軸を求めて、SVG の円弧（A）で描く。点を並べた
  折れ線にしないのは、どの拡大でも角が出ないようにするため。

  ブラックホールはロゴの O と同じ絵（黒い円と光の縁と横線。src/ui/logo.ts）で、横線
  （真横から見た円盤）も同じ面にある。軌道は奥の半分がブラックホールの後ろを、手前の
  半分が前を通る（orbitHalves）。

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
    天体を置かない矩形（焦点からの半幅・半高）。ブラックホールの黒い円と光の縁と横線が
    乗る。天体と番号の札はここに入れない
  */
  clear: { x: number; y: number }
  /*
    ブラックホールの黒い円の半径（viewBox の単位）。光の縁と横線は、ロゴの O と同じ比で
    そのまわりに描く（src/ui/logo.ts の HOLE）
  */
  hole: number
}

/*
  軌道1本。d は1周、far と near はその奥の半分と手前の半分（軌道面がブラックホールの
  向こうへ回る側と、こちらへ来る側）。奥の半分はブラックホールの後ろ、手前の半分は
  前に描く（components.tsx の OrbitSystem / ContactOrbits）
*/
export type OrbitPath = { kind: ItemKind; d: string; far: string; near: string }
/*
  天体。side は札を先に試す側——枠の右の端に近い天体は左から試す（右へ出すと
  札が枠の外で切れる。placeLabels）。orbit は乗っている軌道（orbits の何番目か。作品が
  軌道の本数より多いときは、内側から順に相乗りする）
*/
export type OrbitBody = {
  kind: ItemKind
  x: number
  y: number
  side: 'left' | 'right'
  orbit: number
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
}

/*
  入口の枠。縦横比は app.css の --system-ratio と同じ（test/theme.test.ts が見る）。

  真ん中（焦点）にはブラックホールを置く（components.tsx の OrbitSystem）。名前は
  置かない——名乗りは足元と Profile が持つ。天体を置かない矩形（clear）は黒い円と
  光の縁のまわりの空き。
*/
export const HERO_FRAME: OrbitFrame = {
  width: 1000,
  height: 560,
  focus: { x: 500, y: 280 },
  inner: 280,
  outer: 470,
  clear: { x: 130, y: 170 },
  hole: 50,
}

/*
  締めの枠。入口と同じ星系（軌道・天体・ブラックホールの数は入口の枠のまま）を、背の低い
  横長の枠の真ん中に置く——番号の札を持たないので、上下の空きが要らない。星系は枠の幅
  いっぱいで、電話の幅でも入口と同じ大きさに見える（持ち主の「星系を大きく」）。広い画面
  では枠の幅に上限を置く（app.css の --contact-w）
*/
export const CONTACT_FRAME: OrbitFrame = {
  ...HERO_FRAME,
  height: 320,
  focus: { x: 500, y: 160 },
}

/*
  作品の星図の枠（components.tsx の OrbitChart。画像の無い作品の、作品のページと一覧の
  行の絵）。締めと同じ枠——入口と同じ星系を背の低い横長に描いたもので、縦横比も同じ
  app.css の --contact-ratio を読む。枠を分けないのは、星図の天体が入口と締めの天体と
  同じ向きに並んで見えるように（同じ件数なら同じ絵。枠を変えると並びが変わる）
*/
export const CHART_FRAME: OrbitFrame = CONTACT_FRAME

// 軌道の本数の上限。これより多い作品は、内側から順に同じ軌道へ相乗りさせる
export const MAX_ORBITS = 7

/*
  軌道の形。どの軌道も同じ離心率（ECCENTRICITY）と同じ近点の向き（PERIAPSIS。軌道面の上の
  度）で、長半径だけが違う——焦点のまわりに相似に広げた入れ子なので、隣の軌道と交わらず、
  上下の間隔もそろう。1本ずつ散らしていたころは、4本から隣どうしが交わり（7本で14か所）、
  潰れ方と中心のずれが1本ずつ違って、別々の傾きの面に乗って見えた。そろえても焦点は
  楕円の中心からずれたまま（同心の輪にはならない）
*/
const ECCENTRICITY = 0.1
const PERIAPSIS = 20

/*
  軌道面を斜めから見る量。面から見上げる角度（度。0 で真横から、90 で真上から）と、
  画面の中での面の回転（度）。ブラックホールの横線（真横から見た円盤）も同じ面にあり、
  app.css が同じ TILT で回す（--system-tilt。test/theme.test.ts が突き合わせる）。
  縦の潰しは sin(ELEVATION)
*/
export const ELEVATION = 14
export const TILT = -8
const SQUASH = Math.sin((ELEVATION * Math.PI) / 180)

// 枠の縁から軌道を離す量（viewBox の単位）
const MARGIN = 14

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

// 軌道面の点（焦点が原点）を、斜めから見た枠の点へ
const project = (frame: OrbitFrame, x: number, y: number) => {
  const cos = Math.cos(rad(TILT))
  const sin = Math.sin(rad(TILT))
  const squashed = y * SQUASH
  return {
    x: frame.focus.x + x * cos - squashed * sin,
    y: frame.focus.y + x * sin + squashed * cos,
  }
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

// i 本目の軌道（n 本のうち）。長半径だけが内から外へ等しい間隔で増える（形は上の ECCENTRICITY）
const orbitAt = (frame: OrbitFrame, i: number, n: number, scale: number): Orbit => ({
  a: (frame.inner + ((frame.outer - frame.inner) * i) / Math.max(1, n - 1)) * scale,
  e: ECCENTRICITY,
  omega: PERIAPSIS,
})

// 軌道面の楕円（焦点が原点）の、真近点角 nu の点
const pointAt = ({ a, e, omega }: Orbit, nu: number) => {
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(rad(nu)))
  return { x: r * Math.cos(rad(nu + omega)), y: r * Math.sin(rad(nu + omega)) }
}

/*
  斜めから見た楕円を SVG の path にする。

  軌道面の楕円は、中心と2本の共役半径（長軸と短軸の向きのベクトル）で決まる。
  潰して回すと共役半径も同じ行列で写るので、写した2本から主軸（特異値）と
  その向きを求め、円弧2本で1周する。
*/
function orbitPath(frame: OrbitFrame, orbit: Orbit): string {
  const { a, e, omega } = orbit
  const b = a * Math.sqrt(1 - e * e)
  const cos = Math.cos(rad(omega))
  const sin = Math.sin(rad(omega))
  // 中心は焦点から近点と逆の向きへ a·e
  const center = project(frame, -a * e * cos, -a * e * sin)
  const origin = project(frame, 0, 0)
  const u = project(frame, a * cos, a * sin)
  const v = project(frame, -b * sin, b * cos)
  const ux = u.x - origin.x
  const uy = u.y - origin.y
  const vx = v.x - origin.x
  const vy = v.y - origin.y
  // M·Mᵀ の固有値が主軸の長さの2乗
  const p = ux * ux + vx * vx
  const q = ux * uy + vx * vy
  const r = uy * uy + vy * vy
  const mid = (p + r) / 2
  const spread = Math.sqrt(((p - r) / 2) ** 2 + q * q)
  const major = Math.sqrt(mid + spread)
  const minor = Math.sqrt(Math.max(0, mid - spread))
  const angle = Math.atan2(2 * q, p - r) / 2
  const dx = major * Math.cos(angle)
  const dy = major * Math.sin(angle)
  const deg = round((angle * 180) / Math.PI)
  const start = `${round(center.x + dx)} ${round(center.y + dy)}`
  const end = `${round(center.x - dx)} ${round(center.y - dy)}`
  const arc = `A${round(major)} ${round(minor)} ${deg} 0 1`
  return `M${start}${arc} ${end}${arc} ${start}Z`
}

/*
  軌道を奥の半分と手前の半分に分ける。分け目は軌道面の上で焦点を通り、視線と直交する
  線（面の x 軸）と軌道が交わる2点——そこより奥（面の y が負。斜めから見ると上）が奥の
  半分。楕円の上の点を、斜めから見た楕円の媒介変数（中心からの角 θ）に直して、奥の
  半分がどちら回りかを奥の真ん中の点で確かめ、円弧1本ずつにする。
*/
function orbitHalves(frame: OrbitFrame, orbit: Orbit): { far: string; near: string } {
  const { a, e, omega } = orbit
  const b = a * Math.sqrt(1 - e * e)
  const cos = Math.cos(rad(omega))
  const sin = Math.sin(rad(omega))
  const center = project(frame, -a * e * cos, -a * e * sin)
  const origin = project(frame, 0, 0)
  const u = project(frame, a * cos, a * sin)
  const v = project(frame, -b * sin, b * cos)
  const ux = u.x - origin.x
  const uy = u.y - origin.y
  const vx = v.x - origin.x
  const vy = v.y - origin.y
  const p = ux * ux + vx * vx
  const q = ux * uy + vx * vy
  const r = uy * uy + vy * vy
  const mid = (p + r) / 2
  const spread = Math.sqrt(((p - r) / 2) ** 2 + q * q)
  const major = Math.sqrt(mid + spread)
  const minor = Math.sqrt(Math.max(0, mid - spread))
  const angle = Math.atan2(2 * q, p - r) / 2
  // 斜めから見た楕円の上の点の、中心からの媒介変数の角
  const thetaOf = (point: { x: number; y: number }) => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    const along = dx * Math.cos(angle) + dy * Math.sin(angle)
    const across = -dx * Math.sin(angle) + dy * Math.cos(angle)
    return Math.atan2(across / Math.max(minor, 1e-9), along / major)
  }
  const seen = (nu: number) => {
    const point = pointAt(orbit, nu)
    return project(frame, point.x, point.y)
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
  const radii = `${round(major)} ${round(minor)} ${deg}`
  const at = (point: { x: number; y: number }) => `${round(point.x)} ${round(point.y)}`
  return {
    far: `M${at(first)}A${radii} ${farSpan > Math.PI ? 1 : 0} ${sweep} ${at(second)}`,
    near: `M${at(second)}A${radii} ${turn - farSpan > Math.PI ? 1 : 0} ${sweep} ${at(first)}`,
  }
}

// 軌道が枠の縁から MARGIN の内側に収まる倍率（外側の軌道の点を回って測る）
function fitScale(frame: OrbitFrame, n: number): number {
  let reachX = 0
  let reachY = 0
  for (let i = 0; i < n; i += 1) {
    const orbit = orbitAt(frame, i, n, 1)
    for (let nu = 0; nu < 360; nu += 5) {
      const point = pointAt(orbit, nu)
      const seen = project(frame, point.x, point.y)
      reachX = Math.max(reachX, Math.abs(seen.x - frame.focus.x))
      reachY = Math.max(reachY, Math.abs(seen.y - frame.focus.y))
    }
  }
  const roomX = Math.min(frame.focus.x, frame.width - frame.focus.x) - MARGIN
  const roomY = Math.min(frame.focus.y, frame.height - frame.focus.y) - MARGIN
  return Math.min(1, roomX / Math.max(reachX, 1), roomY / Math.max(reachY, 1))
}

/*
  件数から軌道図を組む。作品が0件なら軌道も天体も無い（ブラックホールだけが残る）。

  j 番目の天体は (j mod 本数) 本目の軌道に乗り、軌道面の上で黄金角ずつ回した向きに
  置く（件数が増えても、天体が面の片側に固まらない）。同じ軌道に乗る2つ目からも同じ
  列の続きで、1つ目から 117° 以上離れる（本数 7 の黄金角の倍）。2つ目を半周ずらして
  いたころは、入れ子の軌道で別の軌道の天体と同じ向きに並び、番号の札が重なった。
  置いた点がブラックホールのまわりの矩形（frame.clear）に入ったら、軌道の上を先へ
  送って矩形の外に出す。
*/
export function orbitMap(counts: KindCounts, frame: OrbitFrame): OrbitMap {
  const kinds = interleaveKinds(counts)
  const n = Math.min(kinds.length, MAX_ORBITS)
  const scale = n > 0 ? fitScale(frame, n) : 1
  const orbits = Array.from({ length: n }, (_, i) => orbitAt(frame, i, n, scale))

  const placed = kinds.map((kind, j) => {
    const orbit = orbits[j % n] as Orbit
    /*
      軌道面の上の向き（焦点から見た角）を黄金角ずつ回して決め、その向きになる真近点角に
      直す。向きで刻むので、軌道の向き（omega）を変えても天体は焦点のまわりに散ったまま
    */
    let nu = (((j * 137.508 + 20 - orbit.omega) % 360) + 360) % 360
    let seen = project(frame, pointAt(orbit, nu).x, pointAt(orbit, nu).y)
    for (let tries = 0; tries < 16; tries += 1) {
      const inside =
        Math.abs(seen.x - frame.focus.x) < frame.clear.x &&
        Math.abs(seen.y - frame.focus.y) < frame.clear.y
      if (!inside) break
      nu = (nu + 23) % 360
      const point = pointAt(orbit, nu)
      seen = project(frame, point.x, point.y)
    }
    return {
      kind,
      nu,
      x: round(seen.x),
      y: round(seen.y),
      side: seen.x > frame.width * LABEL_FLIP ? ('left' as const) : ('right' as const),
    }
  })
  const bodies: OrbitBody[] = placed.map(({ kind, x, y, side }, j) => ({
    kind,
    x,
    y,
    side,
    orbit: j % n,
  }))

  const aMin = orbits[0]?.a ?? 1
  const plane = `translate(${frame.focus.x} ${frame.focus.y}) rotate(${TILT}) scale(1 ${round3(SQUASH)})`

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
    const edge = frame.hole / Math.hypot(Math.cos(rad(a)), SQUASH * Math.sin(rad(a)))
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
  const farEnd = project(frame, 0, -deepest)
  const nearEnd = project(frame, 0, deepest)

  /*
    軌道の区分（破線にするかを決める）。乗る天体の区分がそろっていればその区分、
    混ざっていれば最初の区分（個人開発。実線）——破線（業務）の軌道に個人開発の
    点が乗ると、線と点で区分が食い違って見える（作品が本数より多いときに起きる）
  */
  const kindOf = (i: number): ItemKind => {
    const riding = kinds.filter((_, j) => j % n === i)
    const first = riding[0] as ItemKind
    return riding.every((kind) => kind === first) ? first : ITEM_KIND_KEYS[0]
  }

  return {
    width: frame.width,
    height: frame.height,
    orbits: orbits.map((orbit, i) => ({
      kind: kindOf(i),
      d: orbitPath(frame, orbit),
      ...orbitHalves(frame, orbit),
    })),
    bodies,
    plane,
    dust,
    flows: orbits.map((orbit) => round(INNER_PERIOD * (orbit.a / aMin) ** 1.5 * FLOW_SHARE)),
    halves: { far: half(back), near: half({ x: -back.x, y: -back.y }) },
    depth: { x1: round(farEnd.x), y1: round(farEnd.y), x2: round(nearEnd.x), y2: round(nearEnd.y) },
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
