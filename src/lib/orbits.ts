/*
  入口の軌道図と、締めの脱出軌道の形（描くのは src/ui/components.tsx の OrbitSystem /
  OrbitEscape）。

  入口では真ん中に星を1つ置き（恒星）、公開中の作品を1つずつ楕円の軌道に載せる。
  恒星は楕円の中心ではなく焦点に居る（ケプラーの第一法則）——中心に置くと、軌道の
  1本1本がただの同心の輪になり、原子のマークと見分けがつかない。

  形は件数（区分ごとの数）だけから決める。作品の名前や slug には依らないので、
  同じ件数なら同じ絵になり、描き直しで天体が跳ねない。個人開発は塗りの点、業務は
  輪と破線の軌道（区分の呼び名は src/domain.ts の KIND_LABEL）。

  座標は SVG の viewBox の単位。軌道は「軌道面の楕円を、少し傾けて斜めから見た」
  形にする——面を縦に潰し（SQUASH）、少し回す（TILT）。斜めから見た楕円も楕円なので、
  潰して回したあとの主軸を求めて、SVG の円弧（A）2本で閉じる。点を並べた折れ線に
  しないのは、どの拡大でも角が出ないようにするため。

  ここは UI を読まない（層の向き。test/source.test.ts）。
*/
import { ITEM_KIND_KEYS, type ItemKind, type KindCounts } from '../domain'

// 軌道図の枠。焦点（恒星）は枠の真ん中
export type OrbitFrame = {
  width: number
  height: number
  // 焦点の位置（viewBox の単位）
  focus: { x: number; y: number }
  // いちばん内側と外側の軌道の長半径（軌道面の単位。斜めから見る前）
  inner: number
  outer: number
  /*
    天体を置かない矩形（焦点からの半幅・半高）。入口では星とその光が乗る。星の
    すぐ脇を天体が通ると、どちらが恒星か読み分けにくい
  */
  clear: { x: number; y: number }
}

export type OrbitPath = { kind: ItemKind; d: string }
/*
  天体。sweep は入口のレーダー（星を中心に真上から時計回りに1周する走査線）が
  この天体を通る時刻を、1周に対する割合で（0〜1）。side は名前の札を先に試す側
  ——枠の右の端に近い天体は左から試す（右へ出すと札が枠の外で切れる。placeLabels）
*/
export type OrbitBody = {
  kind: ItemKind
  x: number
  y: number
  sweep: number
  side: 'left' | 'right'
}
export type OrbitMap = {
  width: number
  height: number
  orbits: OrbitPath[]
  bodies: OrbitBody[]
}

/*
  入口の枠。縦横比は app.css の --system-ratio と同じ（test/theme.test.ts が見る）。

  真ん中（焦点）には星を1つ置く（components.tsx の OrbitSystem）。名前は置かない——
  名乗りは足元と Profile が持つ。天体を置かない矩形（clear）は星のまわりの空き。
  星のすぐ脇を天体が通ると、どちらが恒星か読み分けにくい。
*/
export const HERO_FRAME: OrbitFrame = {
  width: 1000,
  height: 560,
  focus: { x: 500, y: 280 },
  inner: 280,
  outer: 470,
  clear: { x: 250, y: 110 },
}

/*
  締めの枠。同じ星系を小さく左に置き、1本の軌道だけが右の端から外へ抜ける。
  字は枠の外（下）に並ぶので、天体を避ける矩形は小さくてよい。
*/
export const ESCAPE_FRAME: OrbitFrame = {
  width: 1000,
  height: 320,
  focus: { x: 210, y: 185 },
  inner: 70,
  outer: 150,
  clear: { x: 16, y: 10 },
}

// 軌道の本数の上限。これより多い作品は、内側から順に同じ軌道へ相乗りさせる
export const MAX_ORBITS = 7

// 軌道面を斜めから見る量。縦の潰し（1 で真上から、0 で真横から）と、面の回転（度）
const SQUASH = 0.46
const TILT = -8

// 枠の縁から軌道を離す量（viewBox の単位）
const MARGIN = 14

// 名前の札を左へ出す境（枠の幅に対する割合）。これより右の天体は札を左へ
const LABEL_FLIP = 0.7

/*
  焦点から見た点の向きを、真上から時計回りの1周に対する割合で（画面の y は下向き）。
  入口のレーダーの走査線が真上から時計回りに回るので、その線が点を通る時刻になる
*/
const sweepOf = (frame: OrbitFrame, point: { x: number; y: number }) => {
  const degrees = (Math.atan2(point.x - frame.focus.x, frame.focus.y - point.y) * 180) / Math.PI
  return Math.round(((degrees + 360) % 360) * 10) / 3600
}

const rad = (degrees: number) => (degrees * Math.PI) / 180
const round = (value: number) => Math.round(value * 10) / 10
const frac = (value: number) => value - Math.floor(value)

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

// i 本目の軌道（n 本のうち）。離心率と向きは黄金角で散らす（隣り合う軌道が同じ向きに寄らない）
const orbitAt = (frame: OrbitFrame, i: number, n: number, scale: number): Orbit => ({
  a: (frame.inner + ((frame.outer - frame.inner) * i) / Math.max(1, n - 1)) * scale,
  e: 0.05 + 0.11 * frac(i * 0.618 + 0.2),
  omega: (i * 137.508 + 24) % 360,
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
  件数から軌道図を組む。作品が0件なら軌道も天体も無い（星だけが残る）。

  j 番目の天体は (j mod 本数) 本目の軌道に乗る。同じ軌道に乗る2つ目からは、
  1つ目から半周ずつ離す。置いた点が星のまわりの矩形（frame.clear）に入ったら、軌道の
  上を先へ送って矩形の外に出す。
*/
export function orbitMap(counts: KindCounts, frame: OrbitFrame): OrbitMap {
  const kinds = interleaveKinds(counts)
  const n = Math.min(kinds.length, MAX_ORBITS)
  const scale = n > 0 ? fitScale(frame, n) : 1
  const orbits = Array.from({ length: n }, (_, i) => orbitAt(frame, i, n, scale))

  const bodies = kinds.map((kind, j) => {
    const orbit = orbits[j % n] as Orbit
    const lap = Math.floor(j / n)
    let nu = (j * 97 + 40 + lap * 180) % 360
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
      x: round(seen.x),
      y: round(seen.y),
      sweep: sweepOf(frame, seen),
      side: seen.x > frame.width * LABEL_FLIP ? ('left' as const) : ('right' as const),
    }
  })

  return {
    width: frame.width,
    height: frame.height,
    // 軌道の区分は、その軌道に最初に乗った天体の区分（破線にするかを決める）
    orbits: orbits.map((orbit, i) => ({
      kind: kinds[i] as ItemKind,
      d: orbitPath(frame, orbit),
    })),
    bodies,
  }
}

/*
  天体と作品を結ぶ。天体は区分ごとの件数から並ぶ（interleaveKinds）ので、区分 k の
  j 番目の天体に、区分 k の作品の j 番目（一覧の並び）を載せる。載せる作品が足りない
  天体は null（件数と作品の列を別々に引いたとき、数えたあとに1件減っていても落ちない）。
*/
export function bodyItems<T extends { type: ItemKind }>(bodies: OrbitBody[], items: T[]) {
  const taken = Object.fromEntries(ITEM_KIND_KEYS.map((kind) => [kind, 0])) as KindCounts
  return bodies.map((body) => {
    const item = items.filter((one) => one.type === body.kind)[taken[body.kind]] ?? null
    taken[body.kind] += 1
    return item
  })
}

/*
  入口の軌道図の名前の札の置き場所（components.tsx の OrbitSystem）。

  札は天体の右上・左上・右下・左下のどれかに出す（ne / nw / se / sw）。枠の中に
  収まり、先に置いた札・ほかの天体・恒星に重ならない最初の1つを選ぶ。どれも
  重なるなら、重なりのいちばん小さいもの。先に試す側は天体の side。

  札の大きさは画面の px で決まり（字の段）、枠は画面に合わせて伸び縮みする。札を
  出すのは枠が LABEL_MIN_WIDTH 以上のときだけ（app.css の @container）で、その
  いちばん小さい枠で重ならなければ、枠が大きいほど札は相対的に小さくなるので
  重ならない。だから札の箱は LABEL_MIN_WIDTH の枠の単位で測る。

  sizes は札ごとの幅（px。字の数から見積もったもの。呼ぶ側が決める）。幅は
  LABEL_MAX_WIDTH で止まる（それより長い名前は CSS が末尾を省く）ので、どんな
  名前でも枠の中に置ける向きが残る。
*/
export type LabelSide = 'ne' | 'nw' | 'se' | 'sw'

// 札を出す枠の幅の下限（px）。app.css の @container (min-width: …) と同じ数（test/theme.test.ts が見る）
export const LABEL_MIN_WIDTH = 520
// 天体から札の角までの離れ（px）と、札の幅の上限（px。長い名前は末尾を省く）
export const LABEL_GAP = { x: 10, y: 6 }
export const LABEL_MAX_WIDTH = 180
// 札の高さ（px。--fs-label / --fs-meta の1行）
const LABEL_HEIGHT = 18
// 札のまわりに空ける間（px）と、天体の点の半径（px。--orbit-body の上限の半分より大きめ）
const LABEL_PAD = 3
const BODY_RADIUS = 6
// 恒星の箱の半幅（px。--star-size の上限の半分）
const STAR_RADIUS = 12

type Box = { x0: number; y0: number; x1: number; y1: number }

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))

export function placeLabels(frame: OrbitFrame, bodies: OrbitBody[], sizes: number[]): LabelSide[] {
  // px → viewBox の単位（いちばん小さい枠で）
  const unit = frame.width / LABEL_MIN_WIDTH
  const boxOf = (body: OrbitBody, side: LabelSide, width: number): Box => {
    const w = Math.min(width, LABEL_MAX_WIDTH) * unit
    const h = LABEL_HEIGHT * unit
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
  const dot = (x: number, y: number, r: number): Box => ({
    x0: x - r * unit,
    y0: y - r * unit,
    x1: x + r * unit,
    y1: y + r * unit,
  })
  const star = dot(frame.focus.x, frame.focus.y, STAR_RADIUS)
  const placed: Box[] = []
  return bodies.map((body, i) => {
    const order: LabelSide[] =
      body.side === 'right' ? ['ne', 'se', 'nw', 'sw'] : ['nw', 'sw', 'ne', 'se']
    const others = bodies
      .filter((_, j) => j !== i)
      .map((other) => dot(other.x, other.y, BODY_RADIUS))
    let best: { side: LabelSide; box: Box; cost: number } | null = null
    for (const side of order) {
      const box = boxOf(body, side, sizes[i] ?? 0)
      const padded = grow(box, LABEL_PAD * unit)
      // 枠の外へ出る分は、重なりより重く数える（切れた札は読めない）
      const outside =
        (box.x1 - box.x0) * (box.y1 - box.y0) -
        overlap(box, { x0: 0, y0: 0, x1: frame.width, y1: frame.height })
      const cost =
        outside * 4 +
        overlap(padded, star) +
        others.reduce((sum, other) => sum + overlap(padded, other), 0) +
        placed.reduce((sum, other) => sum + overlap(padded, other), 0)
      if (!best || cost < best.cost) best = { side, box, cost }
      if (cost === 0) break
    }
    // bodies が空でなければ order の1つ目で必ず決まる
    const chosen = best as { side: LabelSide; box: Box }
    placed.push(chosen.box)
    return chosen.side
  })
}

/*
  締めの脱出軌道。同じ星系から1本だけ、双曲線（離心率 1 より大）で外へ抜ける。

  近点のすこし手前から描き始め、枠の右の端を越えるまで伸ばす（越えたぶんは SVG が
  切る。画面の外へ出ていくように見せるため）。probe はその道の上の探査機の位置。
*/
export function escapePath(frame: OrbitFrame): { d: string; probe: { x: number; y: number } } {
  const e = 1.55
  const periapsis = frame.inner * 0.72
  const p = periapsis * (1 + e)
  // 出ていく漸近線の向き（真近点角の上限）
  const limit = (Math.acos(-1 / e) * 180) / Math.PI
  /*
    軌道面の向き（近点の向き）。出ていく漸近線の向きは omega + limit（離心率 1.55 で
    約 130°）なので、225° で 355°。斜めから見るとさらに 8° 起きて、右の縁のやや上から
    外へ抜ける。入ってくる側は左下から来て、恒星の上を回り込む
  */
  const omega = 225
  const points: { x: number; y: number }[] = []
  for (let nu = -35; nu < limit - 0.5; nu += 1.5) {
    const r = p / (1 + e * Math.cos(rad(nu)))
    const seen = project(frame, r * Math.cos(rad(nu + omega)), r * Math.sin(rad(nu + omega)))
    points.push(seen)
    if (seen.x > frame.width + 40 || seen.y < -40 || seen.y > frame.height + 40) break
  }
  const d = points
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join('')
  // 探査機は枠の幅の 8 割を越えた最初の点。角度で刻んだ点は近点のまわりに詰まるので、数で数えない
  const probe =
    points.find((point) => point.x >= frame.width * 0.8) ?? points[points.length - 1] ?? frame.focus
  return { d, probe: { x: round(probe.x), y: round(probe.y) } }
}
