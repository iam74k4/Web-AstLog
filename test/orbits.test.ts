import { describe, expect, it } from 'vitest'
import {
  BODY_TICK,
  CAMERA,
  CONTACT_FRAME,
  COSMOS,
  cosmosMap,
  ELEVATION,
  HERO_FRAME,
  interleaveKinds,
  MAX_ORBITS,
  MOTION_RATE,
  NEBULA,
  nebulaMap,
  orbitMap,
  STARDUST_CLASSES,
  TICK,
  TILT,
} from '../src/lib/orbits'
import { BLACKHOLE_ART } from '../src/ui/logo'

/*
  入口と締めの軌道図の形（src/lib/orbits.ts）。描いた姿そのもの（線が字に
  かからないか・画面に収まるか）はブラウザで npm run check:fit と
  npm run check:contrast が測る。ここは形を決める計算の約束だけを見る。
*/

// path の d から点の座標を拾う（M / L / A の終点）。円弧の半径も数として拾わないよう、A は終点だけ
const pointsOf = (d: string) => {
  const points: { x: number; y: number }[] = []
  for (const [, command, args] of d.matchAll(/([MLA])([^MLAZ]*)/g)) {
    const numbers = (args ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    const [x, y] = command === 'A' ? numbers.slice(5, 7) : numbers.slice(0, 2)
    if (x !== undefined && y !== undefined) points.push({ x, y })
  }
  return points
}

// 軌道の楕円の主軸の半径（A の最初の2つの数）
const radiiOf = (d: string) => {
  const [rx, ry] = (d.match(/A([\d.]+) ([\d.]+)/) ?? []).slice(1).map(Number)
  return { rx: rx ?? 0, ry: ry ?? 0 }
}

/*
  円弧1本の path（M x y A rx ry 角 大 向き x y）を、中心の形に直して弧の真ん中の点を
  返す（SVG 1.1 の付録 F.6.5 の式）。orbits.ts の計算とは別の道で、奥の半分がどちらを
  回っているかを確かめるため
*/
const arcMiddle = (d: string) => {
  const found = d.match(
    /^M([\d.-]+) ([\d.-]+)A([\d.]+) ([\d.]+) ([\d.-]+) ([01]) ([01]) ([\d.-]+) ([\d.-]+)$/,
  )
  expect(found, d).not.toBeNull()
  const [x1, y1, rx0, ry0, deg, large, sweep, x2, y2] = (found ?? []).slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const phi = (deg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const xp = cos * dx + sin * dy
  const yp = -sin * dx + cos * dy
  const grow = Math.max(1, Math.sqrt((xp * xp) / (rx0 * rx0) + (yp * yp) / (ry0 * ry0)))
  const rx = rx0 * grow
  const ry = ry0 * grow
  const sign = large === sweep ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
  const den = rx * rx * yp * yp + ry * ry * xp * xp
  const coef = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * rx * yp) / ry
  const cyp = (-coef * ry * xp) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
  let turn = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
  if (sweep === 0 && turn > 0) turn -= 2 * Math.PI
  if (sweep === 1 && turn < 0) turn += 2 * Math.PI
  const mid = start + turn / 2
  return {
    x: cx + rx * Math.cos(mid) * cos - ry * Math.sin(mid) * sin,
    y: cy + rx * Math.cos(mid) * sin + ry * Math.sin(mid) * cos,
    large,
  }
}

/*
  描いた楕円（d の円弧2本）を式に戻す。d は「M 始点 A 長半径 短半径 角 0 1 終点 A … 始点 Z」で、
  始点と終点は長軸の両端（真ん中が中心）
*/
const ellipseOf = (d: string) => {
  const [start, end] = pointsOf(d)
  const { rx, ry } = radiiOf(d)
  const deg = Number(d.match(/A[\d.]+ [\d.]+ ([\d.-]+)/)?.[1] ?? 0)
  return {
    cx: ((start?.x ?? 0) + (end?.x ?? 0)) / 2,
    cy: ((start?.y ?? 0) + (end?.y ?? 0)) / 2,
    rx,
    ry,
    t: (deg * Math.PI) / 180,
  }
}

// 星屑の d（単位円の座標の、長さ0の線の並び。M.123-.988h0 …）から点を拾う
const unitDots = (d: string) =>
  [...d.matchAll(/M(-?[\d.]+) ?(-?[\d.]+)h0/g)].map((found) => ({
    u: Number(found[1]),
    v: Number(found[2]),
  }))

// 単位円の点を、軌道の楕円の枠（orbits.ts の OrbitPath の ellipse）で枠の点に写す
const onScreen = (
  e: { cx: number; cy: number; rx: number; ry: number; angle: number },
  { u, v }: { u: number; v: number },
) => {
  const t = (e.angle * Math.PI) / 180
  const x = e.rx * u
  const y = e.ry * v
  return {
    x: e.cx + x * Math.cos(t) - y * Math.sin(t),
    y: e.cy + x * Math.sin(t) + y * Math.cos(t),
  }
}

describe('入口の軌道図の形', () => {
  it('作品1つに天体1つ。区分ごとの数もそのまま', () => {
    const map = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    expect(map.bodies).toHaveLength(7)
    expect(map.bodies.filter((body) => body.kind === 'app')).toHaveLength(5)
    expect(map.bodies.filter((body) => body.kind === 'work')).toHaveLength(2)
    expect(map.orbits).toHaveLength(Math.min(7, MAX_ORBITS))
  })

  it('少ないほうの区分を均等に散らす（業務の軌道が1か所に固まらない）', () => {
    expect(interleaveKinds({ app: 5, work: 2 })).toEqual([
      'app',
      'work',
      'app',
      'app',
      'work',
      'app',
      'app',
    ])
    expect(interleaveKinds({ app: 0, work: 3 })).toEqual(['work', 'work', 'work'])
  })

  it('作品が0件なら軌道も天体も無い', () => {
    const map = orbitMap({ app: 0, work: 0 }, HERO_FRAME)
    expect(map.orbits).toEqual([])
    expect(map.bodies).toEqual([])
  })

  it('軌道は MAX_ORBITS 本まで。多い作品は同じ軌道に相乗りする', () => {
    const map = orbitMap({ app: 14, work: 6 }, HERO_FRAME)
    expect(map.orbits).toHaveLength(MAX_ORBITS)
    expect(map.bodies).toHaveLength(20)
  })

  it('同じ件数なら同じ絵（描き直しで天体が跳ねない）', () => {
    expect(orbitMap({ app: 5, work: 2 }, HERO_FRAME)).toEqual(
      orbitMap({ app: 5, work: 2 }, HERO_FRAME),
    )
  })

  it('天体はブラックホールのまわりの矩形の外にだけ置く', () => {
    for (const counts of [
      { app: 1, work: 0 },
      { app: 5, work: 2 },
      { app: 14, work: 6 },
      { app: 30, work: 10 },
    ]) {
      const frame = HERO_FRAME
      for (const body of orbitMap(counts, frame).bodies) {
        const inside =
          Math.abs(body.x - frame.focus.x) < frame.clear.x &&
          Math.abs(body.y - frame.focus.y) < frame.clear.y
        expect(inside, `${JSON.stringify(counts)} の天体 ${body.x},${body.y}`).toBe(false)
      }
    }
  })

  it('軌道も天体も枠の中に収まる（線が枠の縁で断ち切られない）', () => {
    for (const counts of [
      { app: 1, work: 0 },
      { app: 5, work: 2 },
      { app: 14, work: 6 },
    ]) {
      const map = orbitMap(counts, HERO_FRAME)
      for (const orbit of map.orbits) {
        // 円弧2本で1周する楕円。主軸の端（始点と中間点）と半径から外接の箱を見積もる
        const [start, middle] = pointsOf(orbit.d)
        const { rx } = radiiOf(orbit.d)
        const cx = ((start?.x ?? 0) + (middle?.x ?? 0)) / 2
        const cy = ((start?.y ?? 0) + (middle?.y ?? 0)) / 2
        expect(cx - rx).toBeGreaterThan(0)
        expect(cx + rx).toBeLessThan(map.width)
        expect(cy).toBeGreaterThan(0)
        expect(cy).toBeLessThan(map.height)
      }
      for (const body of map.bodies) {
        expect(body.x).toBeGreaterThan(0)
        expect(body.x).toBeLessThan(map.width)
        expect(body.y).toBeGreaterThan(0)
        expect(body.y).toBeLessThan(map.height)
      }
    }
  })

  it('軌道は奥の半分と手前の半分に分かれる。分け目は焦点を通る線で、奥の半分は上を回る', () => {
    /*
      奥の半分はブラックホールの後ろ、手前の半分は前に描く（components.tsx の
      OrbitSystem / ContactOrbits）。分け目がずれると、軌道が黒い円の前後で途切れて見える
    */
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      for (const counts of [
        { app: 1, work: 0 },
        { app: 5, work: 2 },
        { app: 14, work: 6 },
      ]) {
        for (const orbit of orbitMap(counts, frame).orbits) {
          const [farStart, farEnd] = pointsOf(orbit.far)
          const [nearStart, nearEnd] = pointsOf(orbit.near)
          // 2本で1周する（奥の終わりが手前の始まり、手前の終わりが奥の始まり）
          expect(nearStart).toEqual(farEnd)
          expect(nearEnd).toEqual(farStart)
          const a = farStart ?? { x: 0, y: 0 }
          const b = farEnd ?? { x: 0, y: 0 }
          // 分け目の2点と焦点は1本の線の上（丸めのぶんだけ許す）
          const cross = (b.x - a.x) * (frame.focus.y - a.y) - (b.y - a.y) * (frame.focus.x - a.x)
          expect(Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.5)
          // 奥の半分の真ん中は分け目の線より上、手前の半分の真ん中は下
          const chordY = (x: number) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
          const far = arcMiddle(orbit.far)
          const near = arcMiddle(orbit.near)
          expect(far.y).toBeLessThan(chordY(far.x))
          expect(near.y).toBeGreaterThan(chordY(near.x))
          // 焦点は楕円の中心からずれているので、2本の長さは違う（大きい弧は片方だけ）
          expect(far.large + near.large).toBe(1)
        }
      }
    }
  })

  it('軌道は透視で見る。手前は大きく広がり、奥はブラックホールの後ろで詰まる', () => {
    /*
      どの距離も同じ大きさで見ていたころは、同じ形の輪が等しく並び、的か図面に見えた（持ち主の
      「軌道がださい。もっと壮大に」）。カメラの距離は枠の outer に比例する（枠ごと縮めても
      同じ形）
    */
    expect(CAMERA).toBeGreaterThan(1.5)
    expect(CAMERA).toBeLessThan(4)
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 5, work: 2 }, frame)
      // いちばん手前は、いちばん奥より焦点から遠くに写る（外の軌道ほど差が大きい）
      map.orbits.forEach((orbit, i) => {
        const { cy, ry } = ellipseOf(orbit.d)
        const ratio = (cy + ry - frame.focus.y) / (frame.focus.y - (cy - ry))
        expect(ratio).toBeGreaterThan(i === map.orbits.length - 1 ? 2.5 : 1.5)
      })
      // 隣の軌道との間は、手前のほうが奥より広い
      const ellipses = map.orbits.map((orbit) => ellipseOf(orbit.d))
      ellipses.slice(1).forEach((outer, i) => {
        const inner = ellipses[i] as ReturnType<typeof ellipseOf>
        const below = outer.cy + outer.ry - (inner.cy + inner.ry)
        const above = inner.cy - inner.ry - (outer.cy - outer.ry)
        expect(below).toBeGreaterThan(above)
      })
    }
  })

  it('軌道は光の帯と星屑で描く。帯は手前ほど太く明るい', () => {
    /*
      細い線だけのころは、同じ形の輪が並んだ図面に見えた。帯は軌道ごとに区間に分け、手前の
      区間ほど太く濃い（透視の手がかり）。奥の区間は奥の層（ブラックホールの後ろ）に描く
    */
    const map = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    expect(map.bands.length).toBeGreaterThanOrEqual(map.orbits.length * 12)
    const near = map.bands.filter((band) => band.side === 'near')
    const far = map.bands.filter((band) => band.side === 'far')
    expect(near.length).toBeGreaterThan(0)
    expect(far.length).toBeGreaterThan(0)
    const widest = (bands: typeof map.bands) => Math.max(...bands.map((band) => band.w))
    const brightest = (bands: typeof map.bands) => Math.max(...bands.map((band) => band.o))
    expect(widest(near)).toBeGreaterThan(widest(far) * 1.5)
    expect(brightest(near)).toBeGreaterThan(brightest(far))
    /*
      星屑: 軌道ごと、明るさの段ごとの点の並び。点はその軌道の写した楕円を単位円に直した
      座標で、軌道の線のそば（帯の幅）に居る。奥と手前の両方に散り、読み込むたびに同じ
    */
    expect(map.orbits.every((orbit) => orbit.stardust.length === STARDUST_CLASSES)).toBe(true)
    const seen = map.orbits.flatMap((orbit) =>
      unitDots(orbit.stardust.join('')).map((point) => onScreen(orbit.ellipse, point)),
    )
    const nearDots = seen.filter((point) => point.y > HERO_FRAME.focus.y)
    expect(seen.length - nearDots.length).toBeGreaterThan(100)
    expect(nearDots.length).toBeGreaterThan(seen.length - nearDots.length)
    for (const orbit of map.orbits) {
      for (const { u, v } of unitDots(orbit.stardust.join(''))) {
        expect(Math.hypot(u, v)).toBeGreaterThan(0.9)
        expect(Math.hypot(u, v)).toBeLessThan(1.1)
      }
    }
    expect(orbitMap({ app: 5, work: 2 }, HERO_FRAME).orbits).toEqual(map.orbits)
    // 入口と締めは同じ星屑（焦点の高さのずれだけ動く。単位円の上では同じ点）
    const contactMap = orbitMap({ app: 5, work: 2 }, CONTACT_FRAME)
    expect(contactMap.orbits.map((orbit) => orbit.stardust)).toEqual(
      map.orbits.map((orbit) => orbit.stardust),
    )
    // 作品が0件なら、帯も星屑も無い（軌道が無い）
    const empty = orbitMap({ app: 0, work: 0 }, HERO_FRAME)
    expect(empty.bands).toEqual([])
    expect(empty.orbits).toEqual([])
  })

  it('軌道は区分を持たない。区分は天体が持つ（業務は輪のある惑星）', () => {
    /*
      業務の軌道を破線にしていたころは、線が図面に見えた（持ち主の「線と点が図面っぽい」）。
      作品が軌道の本数より多いと1本に2つ以上が乗り、区分の混ざる軌道の線も決めかねた
    */
    const map = orbitMap({ app: 3, work: 9 }, HERO_FRAME)
    for (const orbit of map.orbits) {
      expect(Object.keys(orbit).sort()).toEqual([
        'bodyTicks',
        'd',
        'ellipse',
        'far',
        'near',
        'period',
        'stardust',
        'sway',
        'ticks',
      ])
    }
    expect(map.bodies.filter((body) => body.kind === 'work')).toHaveLength(9)
    // 輪は軌道面と同じ角度から見た楕円を、少し起こして傾ける（水平のままだと「目」の記号に見えた）
    expect(map.ring.ry / map.ring.rx).toBeCloseTo(Math.sin((ELEVATION * Math.PI) / 180), 1)
    expect(Math.abs(map.ring.tilt)).toBeGreaterThanOrEqual(10)
    expect(Math.abs(map.ring.tilt)).toBeLessThanOrEqual(35)
  })

  it('軌道は水平に並び、外ほど間を広げる', () => {
    /*
      面を −8° 傾けていたころは、狙った傾きではなく曲がって見えた（持ち主の「傾きが中途
      半端」）。14° の低い角度から見た7本を等しい間隔で並べていたころは、レコード盤か土星の
      輪に見えた（「平たく詰まって見える」）
    */
    expect(TILT).toBe(0)
    expect(ELEVATION).toBeGreaterThanOrEqual(24)
    expect(MAX_ORBITS).toBeLessThanOrEqual(5)
    const ellipses = orbitMap({ app: 5, work: 2 }, HERO_FRAME).orbits.map((orbit) =>
      ellipseOf(orbit.d),
    )
    for (const ellipse of ellipses) expect(ellipse.t).toBe(0)
    const gaps = ellipses.slice(1).map((outer, i) => outer.rx - (ellipses[i]?.rx ?? 0))
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i] ?? 0).toBeGreaterThan(gaps[i - 1] ?? 0)
    }
  })

  it('星系は枠に収まる。いちばん外側の軌道は枠の幅いっぱい', () => {
    /*
      透視で手前が広がるぶん星系を縮めて、外側の軌道の左右の端が枠の縁（MARGIN 14）に来る。
      入口と締めは同じ倍率（幅で決まる）で、上下は枠の中に収まる
    */
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 5, work: 2 }, frame)
      const outer = ellipseOf(map.orbits.at(-1)?.d ?? '')
      expect(outer.cx - outer.rx).toBeCloseTo(14, 0)
      expect(outer.cx + outer.rx).toBeCloseTo(frame.width - 14, 0)
      expect(outer.cy - outer.ry).toBeGreaterThanOrEqual(13)
      expect(outer.cy + outer.ry).toBeLessThanOrEqual(frame.height - 13)
    }
    // 入口は星系の上下の真ん中を枠の真ん中にそろえる（上と下には空きが残る）
    const hero = ellipseOf(orbitMap({ app: 5, work: 2 }, HERO_FRAME).orbits.at(-1)?.d ?? '')
    expect(Math.abs(hero.cy - hero.ry - (HERO_FRAME.height - hero.cy - hero.ry))).toBeLessThan(4)
    // 締めの枠は星系に MARGIN を足しただけの高さ
    const contact = ellipseOf(orbitMap({ app: 5, work: 2 }, CONTACT_FRAME).orbits.at(-1)?.d ?? '')
    expect(contact.cy - contact.ry).toBeCloseTo(14, 0)
    expect(contact.cy + contact.ry).toBeLessThanOrEqual(CONTACT_FRAME.height - 13)
    /*
      ブラックホールの影は小さく、光は星系の幅の 1/5 から 1/3 のあいだ。影の半径が 76 のころは
      平らな黒い円が見出しより先に目に入り、45 でも星屑の円盤より目立った（持ち主の「主張が
      強すぎる」）。影も光も小さい印だったころ（星系の幅の 1/9 ほど）は軌道ばかりが目に付いた
      （持ち主の「ブラックホールとの釣り合い」）
    */
    expect(HERO_FRAME.hole / HERO_FRAME.outer).toBeLessThan(1 / 10)
    const art = (BLACKHOLE_ART.width / BLACKHOLE_ART.shadow) * HERO_FRAME.hole
    expect(art / (2 * HERO_FRAME.outer)).toBeGreaterThan(1 / 5)
    expect(art / (2 * HERO_FRAME.outer)).toBeLessThan(1 / 3)
  })

  it('天体は手前ほど大きい（奥行きの倍率は 1 まで）', () => {
    const map = orbitMap({ app: 9, work: 3 }, HERO_FRAME)
    const sorted = [...map.bodies].sort((a, b) => a.y - b.y)
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]?.scale ?? 0).toBeGreaterThanOrEqual(sorted[i - 1]?.scale ?? 0)
    }
    for (const body of map.bodies) {
      expect(body.scale).toBeGreaterThan(0.5)
      expect(body.scale).toBeLessThanOrEqual(1)
    }
  })

  it('締めの星系は入口と同じ。違うのは枠の高さと焦点の高さだけ', () => {
    /*
      締めの枠（CONTACT_FRAME）は入口の枠から上下の空きを外しただけで、軌道・天体・ブラック
      ホールは入口のまま。枠を低くしすぎると、星系が高さで縮んで入口より小さくなる
    */
    const shift = CONTACT_FRAME.focus.y - HERO_FRAME.focus.y
    for (const counts of [
      { app: 1, work: 0 },
      { app: 5, work: 2 },
      { app: 14, work: 6 },
    ]) {
      const hero = orbitMap(counts, HERO_FRAME)
      const contact = orbitMap(counts, CONTACT_FRAME)
      expect(contact.bodies).toHaveLength(hero.bodies.length)
      contact.bodies.forEach((body, j) => {
        const same = hero.bodies[j] ?? body
        expect(Math.abs(body.x - same.x)).toBeLessThan(0.11)
        expect(Math.abs(body.y - shift - same.y)).toBeLessThan(0.11)
      })
    }
    expect(CONTACT_FRAME.hole).toBe(HERO_FRAME.hole)
  })

  type Ellipse = ReturnType<typeof ellipseOf>
  // 楕円の式の値（内側なら 1 より小さい）
  const level = (e: Ellipse, p: { x: number; y: number }) => {
    const dx = p.x - e.cx
    const dy = p.y - e.cy
    const u = (dx * Math.cos(e.t) + dy * Math.sin(e.t)) / e.rx
    const v = (-dx * Math.sin(e.t) + dy * Math.cos(e.t)) / e.ry
    return u * u + v * v
  }
  const around = (e: Ellipse) =>
    Array.from({ length: 720 }, (_, k) => {
      const s = (2 * Math.PI * k) / 720
      return {
        x: e.cx + e.rx * Math.cos(s) * Math.cos(e.t) - e.ry * Math.sin(s) * Math.sin(e.t),
        y: e.cy + e.rx * Math.cos(s) * Math.sin(e.t) + e.ry * Math.sin(s) * Math.cos(e.t),
      }
    })

  it('軌道は入れ子で、隣どうしが交わらない（どの件数でも）', () => {
    /*
      向きと離心率を1本ずつ散らしていたころは、4本から隣どうしが交わり（7本で14か所）、
      1本ずつ別の傾きの面に乗って見えた。外側の軌道の点がどれも内側の軌道の外にあれば、
      交わらない
    */
    for (let total = 1; total <= 12; total += 1) {
      const work = Math.floor(total / 3)
      const ellipses = orbitMap({ app: total - work, work }, HERO_FRAME).orbits.map((orbit) =>
        ellipseOf(orbit.d),
      )
      for (let i = 1; i < ellipses.length; i += 1) {
        const inner = ellipses[i - 1] as Ellipse
        const outer = ellipses[i] as Ellipse
        const nearest = Math.min(...around(outer).map((point) => level(inner, point)))
        expect(nearest, `${total}件の ${i - 1} 本目と ${i} 本目`).toBeGreaterThan(1)
      }
    }
  })

  it('いちばん内側の軌道は、黒い円の縁から離れて回る（かすめない）', () => {
    /*
      黒い円の半径と内側の軌道の見かけの近さがほぼ同じだったころ、軌道が黒い円の縁に
      接して見えた（重ねるでも離すでもない、いちばん落ち着かない位置）
    */
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      for (let total = 1; total <= 12; total += 1) {
        const first = orbitMap({ app: total, work: 0 }, frame).orbits[0]
        const closest = Math.min(
          ...around(ellipseOf(first?.d ?? '')).map((point) =>
            Math.hypot(point.x - frame.focus.x, point.y - frame.focus.y),
          ),
        )
        expect(closest, `${total}件`).toBeGreaterThan(frame.hole * 1.15)
      }
    }
  })

  it('線の濃さの坂は、軌道面の奥から焦点を通って手前へ。どの軌道も坂の中に入る', () => {
    const map = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    const { x1, y1, x2, y2 } = map.depth
    // 奥が上、手前が下。焦点は両端を結ぶ線の上（透視で手前の端のほうが遠い）
    expect(y1).toBeLessThan(HERO_FRAME.focus.y)
    expect(y2).toBeGreaterThan(HERO_FRAME.focus.y)
    expect(y2 - HERO_FRAME.focus.y).toBeGreaterThan(HERO_FRAME.focus.y - y1)
    const cross = (HERO_FRAME.focus.x - x1) * (y2 - y1) - (HERO_FRAME.focus.y - y1) * (x2 - x1)
    expect(Math.abs(cross) / Math.hypot(x2 - x1, y2 - y1)).toBeLessThan(0.2)
    // 奥と手前を分ける交線（画面の中の傾き TILT）と直交する
    const along = { x: Math.cos((TILT * Math.PI) / 180), y: Math.sin((TILT * Math.PI) / 180) }
    const span = Math.hypot(x2 - x1, y2 - y1)
    expect(Math.abs(((x2 - x1) * along.x + (y2 - y1) * along.y) / span)).toBeLessThan(0.01)
    // 軌道の点はどれも坂の両端のあいだ（外に出ると、そこから先の濃さが頭打ちになる）
    for (const orbit of map.orbits) {
      for (const point of around(ellipseOf(orbit.d))) {
        const at = ((point.x - x1) * (x2 - x1) + (point.y - y1) * (y2 - y1)) / (span * span)
        expect(at).toBeGreaterThanOrEqual(-0.01)
        expect(at).toBeLessThanOrEqual(1.01)
      }
    }
  })

  it('ブラックホールは楕円の中心ではなく焦点に居る（同心の輪にしない）', () => {
    const map = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    const centers = map.orbits.map((orbit) => {
      const [start, middle] = pointsOf(orbit.d)
      return {
        x: ((start?.x ?? 0) + (middle?.x ?? 0)) / 2,
        y: ((start?.y ?? 0) + (middle?.y ?? 0)) / 2,
      }
    })
    // どの楕円の中心も焦点（枠の真ん中）からずれている
    for (const center of centers) {
      const off = Math.hypot(center.x - HERO_FRAME.focus.x, center.y - HERO_FRAME.focus.y)
      expect(off).toBeGreaterThan(1)
    }
  })
})

describe('動き続けるもの', () => {
  // SVG の transform 属性の並び（translate(x y) rotate(deg) scale(x y)）を右から点に当てる
  const apply = (list: string, point: { x: number; y: number }) => {
    let { x, y } = point
    const fns = [...list.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)].reverse()
    for (const [, fn, raw = ''] of fns) {
      const [first = 0, second] = raw
        .trim()
        .split(/[\s,]+/)
        .map((value) => Number.parseFloat(value))
      if (fn === 'translate') {
        x += first
        y += second ?? 0
      } else if (fn === 'scale') {
        x *= first
        y *= second ?? first
      } else {
        const t = (first * Math.PI) / 180
        ;[x, y] = [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]
      }
    }
    return { x, y }
  }

  it('吸い込まれる粒は読み込むたびに同じ。1周して、斜めから見て黒い円の縁で落ち切る', () => {
    const map = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    // 写しの HTML が毎回同じになるように、乱数は決まった種から
    expect(orbitMap({ app: 5, work: 2 }, HERO_FRAME).dust).toEqual(map.dust)
    const squash = Math.sin((ELEVATION * Math.PI) / 180)
    for (const grain of map.dust) {
      // 落ち切る所（1周して元の向き a、半径 r1）を斜めから見た、焦点からの離れ
      const end = apply(`${map.plane} rotate(${grain.a})`, { x: grain.r1, y: 0 })
      const seen = Math.hypot(end.x - HERO_FRAME.focus.x, end.y - HERO_FRAME.focus.y)
      expect(seen).toBeGreaterThanOrEqual(HERO_FRAME.hole * 0.99)
      expect(seen).toBeLessThanOrEqual(HERO_FRAME.hole * 1.11)
      expect(grain.r0).toBeGreaterThan(grain.r1)
      expect(grain.delay).toBeLessThanOrEqual(0)
      expect(Math.abs(grain.delay)).toBeLessThanOrEqual(grain.dur)
      // 描画側へ渡す道は64区間。始まり・半周の節点・落ち切る所が以前の写しと一致する
      const points = [...grain.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({
        x: Number(match[1]),
        y: Number(match[2]),
      }))
      expect(points).toHaveLength(65)
      expect(grain.d.length).toBeLessThan(2048)
      expect(grain.d).not.toContain('Z')
      const start = apply(`${map.plane} rotate(${grain.a})`, { x: grain.r0, y: 0 })
      const middle = apply(`${map.plane} rotate(${grain.a + 62.6})`, {
        x: grain.r1 + (Math.round((grain.r0 - grain.r1) * 10) / 10) * 0.826,
        y: 0,
      })
      for (const [i, expected] of [
        [0, start],
        [32, middle],
        [64, end],
      ] as const) {
        expect(points[i]?.x).toBeCloseTo(expected.x, 1)
        expect(points[i]?.y).toBeCloseTo(expected.y, 1)
      }
    }
    /*
      面の潰しと傾きは軌道と同じ（粒は軌道と同じ面を落ちる）。透視は SVG の変換で書けないので、
      焦点での縮みと潰しの平行の写し（横と縦の倍率の比が sin(ELEVATION)）
    */
    const [sx = 0, sy = 0] = (map.plane.match(/scale\(([\d.]+) ([\d.]+)\)/) ?? [])
      .slice(1)
      .map(Number)
    expect(map.plane).toContain(`rotate(${TILT}) scale(`)
    expect(sy / sx).toBeCloseTo(squash, 2)
    // 作品が0件でも、ブラックホールは粒を吸い込む
    const empty = orbitMap({ app: 0, work: 0 }, HERO_FRAME)
    expect(empty.dust.length).toBeGreaterThan(0)
  })

  /*
    星屑と天体は軌道ごと公転する（持ち主の「軌道の線を星と一緒に動かして」）。写した楕円を
    単位円に直した座標で持ち、描く側がその枠の中で回す——回しても線から外れない。周期は
    外側ほど長く（長半径の 1.5 乗）、軌道を流れる星はそれより速く流れて追い越す
  */
  it('星屑と天体は軌道ごと回る。外側ほどゆっくりで、流れる星はそれを追い越す', () => {
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 9, work: 3 }, frame)
      expect(map.flows).toHaveLength(map.orbits.length)
      map.orbits.forEach((orbit, i) => {
        // 回る枠は、描いた線の楕円そのもの
        const drawn = ellipseOf(orbit.d)
        expect(Math.abs(orbit.ellipse.cx - drawn.cx)).toBeLessThan(0.11)
        expect(Math.abs(orbit.ellipse.cy - drawn.cy)).toBeLessThan(0.11)
        expect(orbit.ellipse.rx).toBeCloseTo(drawn.rx, 5)
        expect(orbit.ellipse.ry).toBeCloseTo(drawn.ry, 5)
        // 流れる星は公転より速い
        expect(map.flows[i] ?? 0).toBeLessThan(orbit.period)
        // 星屑は1秒に十数回だけ進む（1回に進むのは画面で 1px に満たない）
        expect(orbit.ticks / orbit.period).toBeGreaterThanOrEqual(8)
        expect(orbit.ticks / orbit.period).toBeLessThanOrEqual(20)
        if (i > 0) {
          expect(orbit.period).toBeGreaterThan(map.orbits[i - 1]?.period ?? 0)
          expect(map.flows[i] ?? 0).toBeGreaterThan(map.flows[i - 1] ?? 0)
        }
      })
      // 天体は乗る軌道の単位円の上から回り出す（枠に写すと、止まった置き場所に戻る）
      for (const body of map.bodies) {
        const orbit = map.orbits[body.orbit]
        expect(orbit, `${body.orbit} 本目`).toBeDefined()
        if (!orbit) continue
        expect(Math.hypot(body.u, body.v)).toBeCloseTo(1, 2)
        const back = onScreen(orbit.ellipse, body)
        expect(Math.abs(back.x - body.x)).toBeLessThan(0.11)
        expect(Math.abs(back.y - body.y)).toBeLessThan(0.11)
        const turn = ((Math.atan2(body.v, body.u) * 180) / Math.PI + 360) % 360
        expect(body.turn).toBeCloseTo(turn, 0)
      }
    }
    /*
      吸い込まれる粒と同じ向き（どちらも描く側の rotate(1turn)。画面で時計回り）——単位円の
      上の向きが増えると、右の端（0°）から手前（90°。下）へ回る
    */
    const outer = orbitMap({ app: 5, work: 2 }, HERO_FRAME).orbits.at(-1)
    if (!outer) throw new Error('軌道が無い')
    expect(onScreen(outer.ellipse, { u: 0, v: 1 }).y).toBeGreaterThan(HERO_FRAME.focus.y)
    expect(onScreen(outer.ellipse, { u: 0, v: -1 }).y).toBeLessThan(HERO_FRAME.focus.y)
  })

  /*
    動くものはどれも決まった刻みの格子に乗る。層は刻みの瞬間にだけ姿を変え、そのあいだは描き
    直さない——刻みが動くものごとにばらけると、層はほぼ毎コマ描き直しになる。毎コマ描き直して
    いたころは、144Hz の画面で GPU の仕事が1コマの枠を超え、ブラウザごと重くなった（持ち主の
    「edge などで開くと異常に重い」）
  */
  it('動くものは同じ刻みの格子に乗る（層を毎コマ描き直さない）', () => {
    // ms の値が格子の倍数か（浮動小数のずれは千分の1まで許す）
    const onGrid = (seconds: number, stepMs: number) =>
      Math.abs((seconds * 1000) / stepMs - Math.round((seconds * 1000) / stepMs)) < 1e-3
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 14, work: 6 }, frame)
      map.orbits.forEach((orbit, i) => {
        // 星屑は TICK ごと、天体は BODY_TICK ごとに1回進む
        expect(onGrid(orbit.period, TICK), `${orbit.period}`).toBe(true)
        expect(orbit.ticks).toBe(Math.round((orbit.period * 1000) / TICK))
        expect(orbit.bodyTicks).toBe(Math.round((orbit.period * 1000) / BODY_TICK))
        // 流れる星は整数の秒で、1/MOTION_RATE 秒ごとに進む
        expect(Number.isInteger(map.flows[i])).toBe(true)
      })
      for (const grain of map.dust) {
        // 粒は 10 の区間のどれも 1/MOTION_RATE 秒の倍数。遅れも格子の上
        expect(grain.ticks).toBeCloseTo((grain.dur * MOTION_RATE) / 10, 10)
        expect(onGrid(grain.delay, 1000 / MOTION_RATE)).toBe(true)
      }
    }
    // 星の瞬きは明暗の片道が TICK の倍数。遅れも格子の上
    for (const star of cosmosMap().stars) {
      if (!star.twinkle) continue
      expect(star.twinkle.ticks).toBe((star.twinkle.dur * 1000) / (2 * TICK))
      expect(onGrid(star.twinkle.delay, TICK)).toBe(true)
    }
  })

  it('回る天体は手前へ来るほど大きい。大きさの揺れは止まった天体と同じ式', () => {
    for (const counts of [
      { app: 1, work: 0 },
      { app: 5, work: 2 },
      { app: 14, work: 6 },
    ]) {
      const map = orbitMap(counts, HERO_FRAME)
      for (const orbit of map.orbits) {
        // 1周ぶんの点（両端は同じ向きなので同じ値。描く側が linear() に渡す）
        const steps = orbit.sway.length - 1
        expect(steps).toBeGreaterThanOrEqual(12)
        expect(orbit.sway[0]).toBe(orbit.sway[steps])
        // いちばん大きいのは手前（90°）、いちばん小さいのは奥（270°）
        expect(orbit.sway.indexOf(Math.max(...orbit.sway)) / steps).toBeCloseTo(0.25, 1)
        expect(orbit.sway.indexOf(Math.min(...orbit.sway)) / steps).toBeCloseTo(0.75, 1)
        for (const value of orbit.sway) {
          expect(value).toBeGreaterThanOrEqual(0.5)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
      // 天体の出だしの向きで揺れを引くと、止まった天体の大きさ（scale）になる
      for (const body of map.bodies) {
        const sway = map.orbits[body.orbit]?.sway ?? []
        const at = (body.turn / 360) * (sway.length - 1)
        const k = Math.floor(at)
        const value = (sway[k] ?? 0) + ((sway[k + 1] ?? 0) - (sway[k] ?? 0)) * (at - k)
        expect(Math.abs(value - body.scale), JSON.stringify(counts)).toBeLessThan(0.012)
      }
    }
  })

  it('奥と手前の半面は、焦点を通る交線で枠を2つに分ける（奥が上）', () => {
    const { halves } = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    const top = { x: HERO_FRAME.focus.x, y: 0 }
    const bottom = { x: HERO_FRAME.focus.x, y: HERO_FRAME.height }
    const inside = (d: string, point: { x: number; y: number }) => {
      // 凸の四角形（M a L b L c L d Z）の中か
      const corners = pointsOf(d)
      return (
        corners.every((a, i) => {
          const b = corners[(i + 1) % corners.length] ?? a
          return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= 0
        }) ||
        corners.every((a, i) => {
          const b = corners[(i + 1) % corners.length] ?? a
          return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) <= 0
        })
      )
    }
    expect(inside(halves.far, top)).toBe(true)
    expect(inside(halves.far, bottom)).toBe(false)
    expect(inside(halves.near, bottom)).toBe(true)
    expect(inside(halves.near, top)).toBe(false)
  })
})

/*
  天体の散らばり。前は天体の横に番号の札を置き、札が重ならないことで間を確かめていた
  （札は持ち主が「いらない」と外した）。いまは天体どうしの間を直に見る
*/
describe('天体の散らばり', () => {
  it('天体どうしは寄らない（20件まで。いちばん近い2つでも 30 以上離れる）', () => {
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      for (let total = 2; total <= 20; total += 1) {
        for (let work = 0; work <= total; work += 1) {
          const map = orbitMap({ app: total - work, work }, frame)
          map.bodies.forEach((a, i) => {
            for (const b of map.bodies.slice(i + 1)) {
              expect(
                Math.hypot(a.x - b.x, a.y - b.y),
                `${total - work}+${work}`,
              ).toBeGreaterThanOrEqual(30)
            }
          })
        }
      }
    }
  })
})

/*
  星雲と星空（orbits.ts の nebulaMap / cosmosMap。描くのは components.tsx の Nebula / Cosmos）。
  雲の質感は描く側のフィルタが付けるので、ここで見るのは塊と星の置き場所だけ
*/
describe('星雲と星空', () => {
  // 回した楕円の外接の箱
  const extentOf = (lobe: { cx: number; cy: number; rx: number; ry: number; rot: number }) => {
    const t = (lobe.rot * Math.PI) / 180
    const hx = Math.hypot(lobe.rx * Math.cos(t), lobe.ry * Math.sin(t))
    const hy = Math.hypot(lobe.rx * Math.sin(t), lobe.ry * Math.cos(t))
    return { x0: lobe.cx - hx, x1: lobe.cx + hx, y0: lobe.cy - hy, y1: lobe.cy + hy }
  }

  it('星雲は読み込むたびに同じ。件数にも枠にも依らない1枚の箱', () => {
    expect(nebulaMap()).toEqual(nebulaMap())
    expect(nebulaMap()).toMatchObject(NEBULA)
    // 色の役は3色と明るい芯と塵。暗い塵の帯は光る塊の上に重ねる（最後）
    const tones = nebulaMap().lobes.map((lobe) => lobe.tone)
    for (const tone of ['a', 'b', 'c', 'ink', 'dust']) expect(tones).toContain(tone)
    expect(tones.slice(tones.indexOf('dust')).every((tone) => tone === 'dust')).toBe(true)
  })

  it('どの塊も箱の中で消えきる（箱の縁で雲を断ち切らない）', () => {
    for (const lobe of nebulaMap().lobes) {
      const box = extentOf(lobe)
      expect(box.x0, JSON.stringify(lobe)).toBeGreaterThanOrEqual(0)
      expect(box.x1, JSON.stringify(lobe)).toBeLessThanOrEqual(NEBULA.width)
      expect(box.y0, JSON.stringify(lobe)).toBeGreaterThanOrEqual(0)
      expect(box.y1, JSON.stringify(lobe)).toBeLessThanOrEqual(NEBULA.height)
    }
  })

  it('星雲はブラックホールのまわりに広がる。箱の真ん中を、芯を包む淡い光が包む', () => {
    // 描く側は箱の真ん中をブラックホールの位置に置く（app.css の .cosmos__nebula）
    const [haze] = nebulaMap().lobes
    const box = extentOf(haze ?? { cx: 0, cy: 0, rx: 0, ry: 0, rot: 0 })
    expect(box.x0).toBeLessThan(NEBULA.width / 2 - 400)
    expect(box.x1).toBeGreaterThan(NEBULA.width / 2 + 400)
    expect(box.y0).toBeLessThan(NEBULA.height / 2 - 300)
    expect(box.y1).toBeGreaterThan(NEBULA.height / 2 + 300)
  })

  it('外の雲は箱の左・上・右の端の近くまで届く。左下（字の居る所）には光る塊を置かない', () => {
    // 持ち主の「星雲をもっと画面広く」。900 以上の入口では、本文の左の端と画面の上と右の端に届く
    const glow = nebulaMap().lobes.filter((lobe) => lobe.tone !== 'dust')
    const boxes = glow.map(extentOf)
    expect(Math.min(...boxes.map((box) => box.x0))).toBeLessThan(NEBULA.width * 0.1)
    expect(Math.min(...boxes.map((box) => box.y0))).toBeLessThan(NEBULA.height * 0.15)
    expect(Math.max(...boxes.map((box) => box.x1))).toBeGreaterThan(NEBULA.width * 0.9)
    /*
      左下は、900 以上の入口では見出しの列、締めと 900 未満では図の下の字が居る所。字の後ろは
      字の暗がり（app.css）が消すが、明るい雲を置くと、暗がりの縁が雲を断ち切る線に見えた
    */
    for (const lobe of glow) {
      if (lobe.cx < NEBULA.width * 0.375) {
        expect(lobe.cy, JSON.stringify(lobe)).toBeLessThan(NEBULA.height / 2)
      }
    }
  })

  it('いちばん明るいのは芯。外の雲はブラックホールから離れるほど淡い', () => {
    /*
      外の雲を芯と同じ明るさで画面に敷き詰めていたころは、大理石の壁紙に見え、ブラックホールが
      雲の真ん中に見えなかった。明るい塊（濃さ 0.5 以上）は芯の中、遠い塊は淡く
    */
    const center = { x: NEBULA.width / 2, y: NEBULA.height / 2 }
    const away = (lobe: { cx: number; cy: number }) =>
      Math.hypot(lobe.cx - center.x, lobe.cy - center.y)
    const glow = nebulaMap().lobes.filter((lobe) => lobe.tone !== 'dust')
    for (const lobe of glow.filter((one) => one.o >= 0.5)) {
      expect(away(lobe), JSON.stringify(lobe)).toBeLessThan(600)
    }
    for (const lobe of glow.filter((one) => away(one) > 1200)) {
      expect(lobe.o, JSON.stringify(lobe)).toBeLessThan(0.25)
    }
  })

  it('星空は読み込むたびに同じ。視野の中に、暗い星ほど多く置く。光芒と瞬きは一部だけ', () => {
    const map = cosmosMap()
    expect(cosmosMap()).toEqual(map)
    expect(map.stars.length).toBeGreaterThan(200)
    for (const star of map.stars) {
      expect(star.x).toBeGreaterThanOrEqual(0)
      expect(star.x).toBeLessThanOrEqual(COSMOS.width)
      expect(star.y).toBeGreaterThanOrEqual(0)
      expect(star.y).toBeLessThanOrEqual(COSMOS.height)
      if (star.twinkle) {
        expect(star.twinkle.delay).toBeLessThanOrEqual(0)
        expect(Math.abs(star.twinkle.delay)).toBeLessThanOrEqual(star.twinkle.dur)
      }
    }
    const faint = map.stars.filter((star) => star.o < 0.5).length
    expect(faint).toBeGreaterThan(map.stars.length / 2)
    const glints = map.stars.filter((star) => star.glint)
    expect(glints.length).toBeGreaterThanOrEqual(4)
    expect(glints.length).toBeLessThanOrEqual(8)
    // 光芒はいちばん明るい星に
    const dimmestGlint = Math.min(...glints.map((star) => star.o))
    expect(map.stars.filter((star) => !star.glint).every((star) => star.o <= dimmestGlint)).toBe(
      true,
    )
    const share = map.stars.filter((star) => star.twinkle).length / map.stars.length
    expect(share).toBeGreaterThan(0.1)
    expect(share).toBeLessThan(0.35)
  })

  it('流れ星は数本。視野の上のほうから、遅れを散らして流れる', () => {
    const { meteors } = cosmosMap()
    expect(meteors.length).toBeGreaterThanOrEqual(2)
    expect(meteors.length).toBeLessThanOrEqual(5)
    for (const meteor of meteors) {
      expect(meteor.y).toBeLessThan(COSMOS.height / 3)
      expect(meteor.delay).toBeLessThanOrEqual(0)
      expect(Math.abs(meteor.delay)).toBeLessThan(meteor.dur)
    }
    expect(new Set(meteors.map((meteor) => meteor.dur)).size).toBe(meteors.length)
  })
})
