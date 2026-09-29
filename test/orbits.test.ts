import { describe, expect, it } from 'vitest'
import {
  bodyItems,
  ESCAPE_FRAME,
  escapePath,
  HERO_FRAME,
  interleaveKinds,
  LABEL_GAP,
  LABEL_MAX_WIDTH,
  LABEL_MIN_WIDTH,
  type LabelSide,
  MAX_ORBITS,
  orbitMap,
  placeLabels,
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

  it('天体は真ん中の星のまわりの矩形の外にだけ置く', () => {
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

  it('恒星は楕円の中心ではなく焦点に居る（同心の輪にしない）', () => {
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

describe('締めの脱出軌道', () => {
  it('星系から右上へ抜け、枠の外まで伸びる（画面の外へ出ていくように見せる）', () => {
    const { d, probe } = escapePath(ESCAPE_FRAME)
    const points = pointsOf(d)
    const first = points[0]
    const last = points[points.length - 1]
    expect(first?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(ESCAPE_FRAME.width / 2)
    // 終わりは枠の右か上の縁の外
    expect((last?.x ?? 0) > ESCAPE_FRAME.width || (last?.y ?? 0) < 0).toBe(true)
    // 探査機は道の後半、枠の中
    expect(probe.x).toBeGreaterThan(ESCAPE_FRAME.width / 2)
    expect(probe.x).toBeLessThan(ESCAPE_FRAME.width)
    expect(probe.y).toBeGreaterThan(0)
  })
})

describe('入口のレーダーと名前の札', () => {
  it('走査線が天体を通る時刻は、真上から時計回りの1周に対する割合', () => {
    const frame = HERO_FRAME
    const map = orbitMap({ app: 5, work: 2 }, frame)
    for (const body of map.bodies) {
      expect(body.sweep).toBeGreaterThanOrEqual(0)
      expect(body.sweep).toBeLessThan(1)
      // 焦点の右（画面で東）にある天体は 1周の 0〜0.5、左（西）は 0.5〜1
      if (body.x > frame.focus.x + 1) expect(body.sweep).toBeLessThan(0.5)
      if (body.x < frame.focus.x - 1) expect(body.sweep).toBeGreaterThan(0.5)
    }
  })

  it('枠の右の端に近い天体は、名前の札を左へ出す（右へ出すと枠の外で切れる）', () => {
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
  const boxOf = (body: { x: number; y: number }, side: LabelSide, width: number) => {
    const w = Math.min(width, LABEL_MAX_WIDTH) * unit
    const h = 18 * unit
    const x0 = side.endsWith('e') ? body.x + LABEL_GAP.x * unit : body.x - LABEL_GAP.x * unit - w
    const y0 = side.startsWith('n') ? body.y - LABEL_GAP.y * unit - h : body.y + LABEL_GAP.y * unit
    return { x0, y0, x1: x0 + w, y1: y0 + h }
  }

  it('名前の札は枠の中に収まる。いちばん長い札でも、どの件数でも', () => {
    for (let total = 1; total <= 12; total += 1) {
      for (let work = 0; work <= total; work += 1) {
        const map = orbitMap({ app: total - work, work }, HERO_FRAME)
        const sides = placeLabels(
          HERO_FRAME,
          map.bodies,
          map.bodies.map(() => LABEL_MAX_WIDTH * 2),
        )
        map.bodies.forEach((body, i) => {
          const box = boxOf(body, sides[i] as LabelSide, LABEL_MAX_WIDTH)
          const where = `${total - work}+${work} の ${i} 番目`
          expect(box.x0, where).toBeGreaterThanOrEqual(0)
          expect(box.x1, where).toBeLessThanOrEqual(HERO_FRAME.width)
          expect(box.y0, where).toBeGreaterThanOrEqual(0)
          expect(box.y1, where).toBeLessThanOrEqual(HERO_FRAME.height)
        })
      }
    }
  })

  it('名前の札どうしは重ならない（ふつうの長さの名前で、7件まで）', () => {
    // 札の幅は番号と 10 字前後の名前（110px）。7件はいまの本人のサイトと同じくらい
    for (let total = 1; total <= 7; total += 1) {
      for (let work = 0; work <= total; work += 1) {
        const map = orbitMap({ app: total - work, work }, HERO_FRAME)
        const sides = placeLabels(
          HERO_FRAME,
          map.bodies,
          map.bodies.map(() => 110),
        )
        const boxes = map.bodies.map((body, i) => boxOf(body, sides[i] as LabelSide, 110))
        boxes.forEach((a, i) => {
          for (const b of boxes.slice(i + 1)) {
            const overlap =
              Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
              Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
            expect(overlap, `${total - work}+${work}`).toBe(0)
          }
        })
      }
    }
  })
})
