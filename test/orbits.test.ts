import { describe, expect, it } from 'vitest'
import {
  bodyIndexOf,
  bodyItems,
  CAMERA,
  CHART_FRAME,
  CONTACT_FRAME,
  COSMOS,
  cosmosMap,
  ELEVATION,
  HERO_FRAME,
  interleaveKinds,
  LABEL_GAP,
  LABEL_MIN_WIDTH,
  LABEL_SIZE,
  type LabelSide,
  MAX_ORBITS,
  NEBULA,
  nebulaMap,
  orbitMap,
  placeLabels,
  STARDUST_CLASSES,
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
      「軌道がださい。もっと壮大に」）。カメラの距離は枠の outer に比例する（星図のように枠ごと
      縮めても同じ形）
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
    // 星屑: 明るさの段ごとの点の並び。奥と手前の両方に散り、読み込むたびに同じ
    const dots = (levels: string[]) => levels.join('').match(/M[\d.]+ [\d.]+h0/g) ?? []
    expect(map.stardust.far).toHaveLength(STARDUST_CLASSES)
    expect(map.stardust.near).toHaveLength(STARDUST_CLASSES)
    expect(dots(map.stardust.far).length).toBeGreaterThan(100)
    expect(dots(map.stardust.near).length).toBeGreaterThan(dots(map.stardust.far).length)
    expect(orbitMap({ app: 5, work: 2 }, HERO_FRAME).stardust).toEqual(map.stardust)
    // 入口と締めは同じ星屑（焦点の高さのずれだけ動く）
    const shift = CONTACT_FRAME.focus.y - HERO_FRAME.focus.y
    const heroDots = dots([...map.stardust.far, ...map.stardust.near])
    const contactMap = orbitMap({ app: 5, work: 2 }, CONTACT_FRAME)
    const contactDots = dots([...contactMap.stardust.far, ...contactMap.stardust.near])
    expect(contactDots).toHaveLength(heroDots.length)
    const first = (list: string[]) => (list[0]?.match(/[\d.]+/g) ?? []).map(Number)
    const [hx = 0, hy = 0] = first(heroDots)
    const [cx = 0, cy = 0] = first(contactDots)
    expect(Math.abs(cx - hx)).toBeLessThan(0.11)
    expect(Math.abs(cy - shift - hy)).toBeLessThan(0.11)
    // 作品が0件なら、帯も星屑も無い
    const empty = orbitMap({ app: 0, work: 0 }, HERO_FRAME)
    expect(empty.bands).toEqual([])
    expect(dots([...empty.stardust.far, ...empty.stardust.near])).toEqual([])
  })

  it('軌道は区分を持たない。区分は天体が持つ（業務は輪のある惑星）', () => {
    /*
      業務の軌道を破線にしていたころは、線が図面に見えた（持ち主の「線と点が図面っぽい」）。
      作品が軌道の本数より多いと1本に2つ以上が乗り、区分の混ざる軌道の線も決めかねた
    */
    const map = orbitMap({ app: 3, work: 9 }, HERO_FRAME)
    for (const orbit of map.orbits) expect(Object.keys(orbit).sort()).toEqual(['d', 'far', 'near'])
    expect(map.bodies.filter((body) => body.kind === 'work')).toHaveLength(9)
    // 輪は軌道面と同じ角度から見た楕円を、少し起こして傾ける（水平のままだと「目」の記号に見えた）
    expect(map.ring.ry / map.ring.rx).toBeCloseTo(Math.sin((ELEVATION * Math.PI) / 180), 1)
    expect(Math.abs(map.ring.tilt)).toBeGreaterThanOrEqual(10)
    expect(Math.abs(map.ring.tilt)).toBeLessThanOrEqual(35)
    // 輪の大きさは星系と一緒に伸び縮みする（ブラックホールの影の大きさには依らない）
    expect(orbitMap({ app: 3, work: 9 }, CHART_FRAME).ring.rx / map.ring.rx).toBeCloseTo(
      CHART_FRAME.inner / HERO_FRAME.inner,
      1,
    )
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
    // 入口は星系の上下の真ん中を枠の真ん中にそろえる（上と下の残りは番号の札の場所）
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
      締めの枠（CONTACT_FRAME）は札を持たないぶん背が低いだけで、軌道・天体・ブラック
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
    天体は公転させない（札と同じ止まった場所に居る）。動くのは軌道を流れる光で、外側の
    軌道ほどゆっくり流れる（公転の周期は長半径の 1.5 乗。光はその一定の割合で1周する）
  */
  it('天体は回らない。軌道を流れる光は外側ほどゆっくり', () => {
    const map = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    expect(Object.keys(map)).not.toContain('movers')
    for (let i = 1; i < map.flows.length; i += 1) {
      expect(map.flows[i] ?? 0).toBeGreaterThan(map.flows[i - 1] ?? 0)
    }
    expect(map.flows).toHaveLength(map.orbits.length)
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

describe('番号の札', () => {
  it('枠の右の端に近い天体は、札を左へ出す（右へ出すと枠の外で切れる）', () => {
    const map = orbitMap({ app: 14, work: 6 }, HERO_FRAME)
    for (const body of map.bodies) {
      expect(body.side).toBe(body.x > HERO_FRAME.width * 0.7 ? 'left' : 'right')
    }
    expect(map.bodies.some((body) => body.side === 'left')).toBe(true)
  })

  it('天体と作品は区分ごとに一覧の順で結ぶ。足りない天体は null', () => {
    const map = orbitMap({ app: 2, work: 1 }, HERO_FRAME)
    const items = [
      { type: 'work' as const, title: '業務' },
      { type: 'app' as const, title: 'アプリ壱' },
      { type: 'app' as const, title: 'アプリ弐' },
    ]
    const on = bodyItems(map.bodies, items)
    // 区分 k の j 番目の天体に、区分 k の作品の j 番目
    expect(map.bodies.map((body) => body.kind)).toEqual(on.map((item) => item?.type))
    expect(on.filter((item) => item?.type === 'app').map((item) => item?.title)).toEqual([
      'アプリ壱',
      'アプリ弐',
    ])
    // 数えたあとに作品が減っていても落ちない（その天体は札を持たない）
    expect(bodyItems(map.bodies, items.slice(0, 2)).filter((item) => item === null)).toHaveLength(1)
  })

  /*
    作品の星図（components.tsx の OrbitChart）は、入口の札が付く天体と同じ天体を灯す。
    結び方は bodyItems の1本で、作品の id から引く表にしただけ
  */
  it('作品ごとの天体の表（bodyIndexOf）は、入口の札と同じ結び方', () => {
    const counts = { app: 3, work: 2 }
    const items = [
      { id: 11, type: 'app' as const },
      { id: 12, type: 'work' as const },
      { id: 13, type: 'app' as const },
      { id: 14, type: 'app' as const },
      { id: 15, type: 'work' as const },
    ]
    const on = bodyItems(orbitMap(counts, HERO_FRAME).bodies, items)
    const index = bodyIndexOf(counts, items)
    expect(index.size).toBe(items.length)
    on.forEach((item, j) => {
      expect(item, `天体 ${j}`).not.toBeNull()
      expect(index.get(item?.id ?? -1), `天体 ${j}`).toBe(j)
    })
    // 天体の並びは件数だけで決まる。枠を変えても同じ天体を指す（星図は締めの枠で描く）
    expect(orbitMap(counts, CHART_FRAME).bodies.map((body) => body.kind)).toEqual(
      orbitMap(counts, HERO_FRAME).bodies.map((body) => body.kind),
    )
    // 数えたあとに増えた行（載る天体が無い）は表に無い。星図を持たないだけで落ちない
    expect(bodyIndexOf(counts, [...items, { id: 16, type: 'app' as const }]).has(16)).toBe(false)
  })

  it('天体は乗っている軌道を知っている。作品が本数より多いときは内側から相乗り', () => {
    for (const counts of [
      { app: 2, work: 1 },
      { app: 9, work: 4 },
    ]) {
      const map = orbitMap(counts, HERO_FRAME)
      map.bodies.forEach((body, j) => {
        expect(body.orbit, `天体 ${j}`).toBe(j % map.orbits.length)
      })
    }
  })

  it('星図の星系は締めの星系をそのまま縮めたもの。天体は同じ向きに並ぶ', () => {
    /*
      星図は一覧のサムネイルと同じ背の低い横長（--chart-ratio）に収めるため、締めの星系を
      縮める。軌道・ブラックホール・天体を置かない矩形を同じ比で縮めるので、天体は入口と
      締めの天体と同じ向きに並ぶ（同じ件数なら同じ絵）
    */
    const s = CHART_FRAME.hole / CONTACT_FRAME.hole
    expect(s).toBeLessThan(1)
    expect(CHART_FRAME.width).toBe(CONTACT_FRAME.width)
    for (const key of ['inner', 'outer'] as const) {
      expect(CHART_FRAME[key] / CONTACT_FRAME[key]).toBeCloseTo(s, 3)
    }
    for (const counts of [
      { app: 1, work: 0 },
      { app: 5, work: 2 },
      { app: 14, work: 6 },
    ]) {
      const chart = orbitMap(counts, CHART_FRAME)
      const contact = orbitMap(counts, CONTACT_FRAME)
      chart.bodies.forEach((body, j) => {
        const same = contact.bodies[j] ?? body
        expect(body.x - CHART_FRAME.focus.x).toBeCloseTo((same.x - CONTACT_FRAME.focus.x) * s, 0)
        expect(body.y - CHART_FRAME.focus.y).toBeCloseTo((same.y - CONTACT_FRAME.focus.y) * s, 0)
      })
    }
  })

  /*
    札の箱（viewBox の単位。札を出すいちばん小さい枠 LABEL_MIN_WIDTH で測る）。
    orbits.ts の placeLabels と同じ置き方で組み直して、重なりと枠からのはみ出しを見る
  */
  const unit = HERO_FRAME.width / LABEL_MIN_WIDTH
  const boxOf = (body: { x: number; y: number }, side: LabelSide) => {
    const w = LABEL_SIZE.width * unit
    const h = LABEL_SIZE.height * unit
    const x0 = side.endsWith('e') ? body.x + LABEL_GAP.x * unit : body.x - LABEL_GAP.x * unit - w
    const y0 = side.startsWith('n') ? body.y - LABEL_GAP.y * unit - h : body.y + LABEL_GAP.y * unit
    return { x0, y0, x1: x0 + w, y1: y0 + h }
  }
  const overlapOf = (
    a: { x0: number; y0: number; x1: number; y1: number },
    b: { x0: number; y0: number; x1: number; y1: number },
  ) =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const frame = HERO_FRAME
  const hole = {
    x0: frame.focus.x - frame.clear.x,
    y0: frame.focus.y - frame.clear.y,
    x1: frame.focus.x + frame.clear.x,
    y1: frame.focus.y + frame.clear.y,
  }

  it('番号の札は枠の中に収まり、ブラックホールに掛からない。どの件数でも', () => {
    for (let total = 1; total <= 20; total += 1) {
      for (let work = 0; work <= total; work += 1) {
        const map = orbitMap({ app: total - work, work }, frame)
        const sides = placeLabels(frame, map.bodies)
        map.bodies.forEach((body, i) => {
          const box = boxOf(body, sides[i] as LabelSide)
          const where = `${total - work}+${work} の ${i} 番目`
          expect(box.x0, where).toBeGreaterThanOrEqual(0)
          expect(box.x1, where).toBeLessThanOrEqual(frame.width)
          expect(box.y0, where).toBeGreaterThanOrEqual(0)
          expect(box.y1, where).toBeLessThanOrEqual(frame.height)
          expect(overlapOf(box, hole), where).toBe(0)
        })
      }
    }
  })

  it('番号の札どうしは重ならない（20件まで）', () => {
    /*
      作品が軌道の本数より多いと、同じ軌道に2つ目が乗る。黄金角の列の続きのままだと、本数 5 では
      1つ目からたった 32.5° の所に来て札が重なった（orbits.ts の ROUND_SPREAD）
    */
    for (let total = 1; total <= 20; total += 1) {
      for (let work = 0; work <= total; work += 1) {
        const map = orbitMap({ app: total - work, work }, frame)
        const sides = placeLabels(frame, map.bodies)
        const boxes = map.bodies.map((body, i) => boxOf(body, sides[i] as LabelSide))
        boxes.forEach((a, i) => {
          for (const b of boxes.slice(i + 1)) {
            expect(overlapOf(a, b), `${total - work}+${work}`).toBe(0)
          }
        })
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

  it('星雲はブラックホールのまわりに広がる。箱の真ん中を、いちばん大きい塊が包む', () => {
    // 描く側は箱の真ん中をブラックホールの位置に置く（app.css の .cosmos__nebula）
    const [haze] = nebulaMap().lobes
    const box = extentOf(haze ?? { cx: 0, cy: 0, rx: 0, ry: 0, rot: 0 })
    expect(box.x0).toBeLessThan(NEBULA.width / 2 - 400)
    expect(box.x1).toBeGreaterThan(NEBULA.width / 2 + 400)
    expect(box.y0).toBeLessThan(NEBULA.height / 2 - 300)
    expect(box.y1).toBeGreaterThan(NEBULA.height / 2 + 300)
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
