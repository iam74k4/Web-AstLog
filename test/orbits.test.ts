import { describe, expect, it } from 'vitest'
import {
  bodyItems,
  CONTACT_FRAME,
  ELEVATION,
  HERO_FRAME,
  interleaveKinds,
  LABEL_GAP,
  LABEL_MIN_WIDTH,
  LABEL_SIZE,
  type LabelSide,
  MAX_ORBITS,
  orbitMap,
  placeLabels,
  TILT,
} from '../src/lib/orbits'

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
    expect(map.orbits).toHaveLength(7)
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

  it('破線（業務）の軌道に乗るのは業務の天体だけ。区分が混ざる軌道は実線', () => {
    // 作品が軌道の本数より多いと、1本に2つ以上が乗る。最初の天体で線を決めていたころ、
    // 破線の軌道に個人開発の点が乗っていた
    for (const counts of [
      { app: 8, work: 2 },
      { app: 14, work: 6 },
      { app: 3, work: 9 },
    ]) {
      const map = orbitMap(counts, HERO_FRAME)
      const n = map.orbits.length
      map.orbits.forEach((orbit, i) => {
        const riding = map.bodies.filter((_, j) => j % n === i).map((body) => body.kind)
        if (orbit.kind === 'work') expect(riding.every((kind) => kind === 'work')).toBe(true)
        if (riding.every((kind) => kind === 'work')) expect(orbit.kind).toBe('work')
      })
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
    // 奥が上、手前が下。両端の真ん中が焦点
    expect(y1).toBeLessThan(HERO_FRAME.focus.y)
    expect(y2).toBeGreaterThan(HERO_FRAME.focus.y)
    expect(Math.abs((x1 + x2) / 2 - HERO_FRAME.focus.x)).toBeLessThan(0.2)
    expect(Math.abs((y1 + y2) / 2 - HERO_FRAME.focus.y)).toBeLessThan(0.2)
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

describe('公転', () => {
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

  it('回る天体の止まった姿は、止まった天体と同じ場所（札が指す場所）', () => {
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      for (const counts of [
        { app: 1, work: 0 },
        { app: 5, work: 2 },
        { app: 14, work: 6 },
      ]) {
        const map = orbitMap(counts, frame)
        expect(map.movers).toHaveLength(map.bodies.length)
        map.movers.forEach((mover, j) => {
          const body = map.bodies[j]
          // app.css は at の内側で単位円を1周回す。回り終えた姿が点 (1, 0)
          const at = apply(mover.at, { x: 1, y: 0 })
          expect(Math.hypot(at.x - (body?.x ?? 0), at.y - (body?.y ?? 0))).toBeLessThan(0.5)
          expect(mover.kind).toBe(body?.kind)
        })
      }
    }
  })

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
    // 面の潰しと傾きは軌道と同じ（粒は軌道と同じ面を落ちる）
    expect(map.plane).toContain(`rotate(${TILT}) scale(1 ${Math.round(squash * 1000) / 1000})`)
    // 作品が0件でも、ブラックホールは粒を吸い込む
    const empty = orbitMap({ app: 0, work: 0 }, HERO_FRAME)
    expect(empty.dust.length).toBeGreaterThan(0)
    expect(empty.movers).toHaveLength(0)
  })

  it('外側の軌道ほどゆっくり回る（周期は長半径の 1.5 乗）', () => {
    const map = orbitMap({ app: 5, work: 2 }, HERO_FRAME)
    const periods = map.movers.map((mover) => mover.period)
    for (let i = 1; i < periods.length; i += 1) {
      expect(periods[i] ?? 0).toBeGreaterThan(periods[i - 1] ?? 0)
    }
    // ゆっくり——いちばん速い内側でも1周に1分以上
    expect(Math.min(...periods)).toBeGreaterThanOrEqual(60)
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
    for (let total = 1; total <= 12; total += 1) {
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

  it('番号の札どうしは重ならない（12件まで）', () => {
    for (let total = 1; total <= 12; total += 1) {
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
