import { describe, expect, it } from 'vitest'
import { motionFrames, orbitFlows, orbitHalfClip } from '../src/lib/orbit-motion'
import { CONTACT_FRAME, HERO_FRAME, MOTION_RATE, type OrbitMap, orbitMap } from '../src/lib/orbits'

const rad = (degrees: number) => (degrees * Math.PI) / 180
const four = (value: number) => Math.round(value * 10000) / 10000
const points = (d: string) =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => ({
    x: Number(x),
    y: Number(y),
  }))

// 元の SVG が掛けていた回転と楕円の変換を、点へ順に当てる（helper の matrix 式とは別の道）
const projected = (
  ellipse: OrbitMap['orbits'][number]['ellipse'],
  point: { x: number; y: number },
  turn: number,
) => {
  const theta = rad(turn)
  const x = ellipse.rx * (point.x * Math.cos(theta) - point.y * Math.sin(theta))
  const y = ellipse.ry * (point.x * Math.sin(theta) + point.y * Math.cos(theta))
  const phi = rad(ellipse.angle)
  return {
    x: ellipse.cx + x * Math.cos(phi) - y * Math.sin(phi),
    y: ellipse.cy + x * Math.sin(phi) + y * Math.cos(phi),
  }
}

describe('位置と明るさを共用する60Hzの時計', () => {
  it('追加した折れ目も同じ時計へ寄せ、次の点までのコマ数を返す', () => {
    expect(MOTION_RATE).toBe(60)
    expect(motionFrames(5, 1, [0.1, 0.9])).toEqual([
      { at: 0, frame: 0, steps: 6 },
      { at: 0.1, frame: 6, steps: 9 },
      { at: 0.25, frame: 15, steps: 15 },
      { at: 0.5, frame: 30, steps: 15 },
      { at: 0.75, frame: 45, steps: 9 },
      { at: 0.9, frame: 54, steps: 6 },
      { at: 1, frame: 60, steps: 0 },
    ])
  })

  it('Flow と Dust の実際の周期で、全区間が1/60秒の整数倍になり1周を欠かさない', () => {
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 8, work: 3 }, frame)
      const paths = [
        ...orbitFlows(map).map((flow) => ({
          samples: flow.frames.length,
          duration: flow.period,
          breaks: [],
        })),
        ...map.dust.map((grain) => ({
          samples: grain.path.length,
          duration: grain.dur,
          breaks: [0.1, 0.2, 0.8, 0.9],
        })),
      ]
      for (const { samples, duration, breaks } of paths) {
        const clock = motionFrames(samples, duration, breaks)
        const total = duration * MOTION_RATE
        expect(total).toBeCloseTo(Math.round(total), 10)
        expect(clock[0]).toMatchObject({ at: 0, frame: 0 })
        expect(clock.at(-1)).toEqual({ at: 1, frame: Math.round(total), steps: 0 })
        expect(clock.reduce((sum, point) => sum + point.steps, 0)).toBe(Math.round(total))
        for (const point of clock.slice(0, -1)) {
          expect(Number.isInteger(point.frame)).toBe(true)
          expect(Number.isInteger(point.steps)).toBe(true)
          expect(point.steps).toBeGreaterThan(0)
          expect(point.at * duration * MOTION_RATE).toBeCloseTo(point.frame, 10)
          // CSS の1区間を steps() で割った1コマは、道の点数によらず1/60秒
          expect(((point.steps / total) * duration) / point.steps).toBeCloseTo(1 / 60, 12)
        }
        for (const at of breaks) {
          expect(clock.some((point) => point.frame === Math.round(at * total))).toBe(true)
        }
      }
    }
  })

  it('短い周期や重複した折れ目で、0段の区間や重複した時刻を作らない', () => {
    const clock = motionFrames(65, 0.1, [1, 0.1, 0.1, 0.1001, 0, 0.9])
    expect(clock.map((point) => point.frame)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(clock.map((point) => point.steps)).toEqual([1, 1, 1, 1, 1, 1, 0])
    expect(clock.map((point) => point.at)).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1])
  })

  it('整数コマではない周期も半コマ以内へ寄せ、端点を保つ', () => {
    const duration = 1.01
    const clock = motionFrames(65, duration, [0.234])
    const last = clock.at(-1)
    if (!last) throw new Error('終点が無い')
    expect(last).toEqual({ at: 1, frame: 61, steps: 0 })
    expect(Math.abs(last.frame / MOTION_RATE - duration)).toBeLessThanOrEqual(0.5 / MOTION_RATE)
    expect(clock.some((point) => point.frame === 14)).toBe(true)
  })

  it('端点や正のコマを持てない入力、周期の外の折れ目は受け付けない', () => {
    for (const samples of [0, 1, 2.5, NaN])
      expect(() => motionFrames(samples, 1)).toThrow(RangeError)
    for (const duration of [0, -1, 0.001, Infinity, NaN]) {
      expect(() => motionFrames(65, duration)).toThrow(RangeError)
    }
    for (const at of [-0.1, 1.1, NaN, Infinity]) {
      expect(() => motionFrames(65, 1, [at])).toThrow(RangeError)
    }
  })
})

describe('HTML の流れる星の位置と尾', () => {
  it('1軌道に1星。元の初期位相・周期・固定サイズと芯/光芒の寸法を保つ', () => {
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 8, work: 3 }, frame)
      const flows = orbitFlows(map)
      expect(flows).toHaveLength(map.orbits.length)
      flows.forEach((flow, i) => {
        const orbit = map.orbits[i]
        if (!orbit) throw new Error('軌道が無い')
        expect(flow.turn).toBe(Math.round(((i * 0.618) % 1) * 3600) / 10)
        expect(flow.period).toBe(map.flows[i])
        const mean = orbit.sway.reduce((sum, value) => sum + value, 0) / orbit.sway.length
        expect(flow.size).toBe(Math.round(mean * 100) / 100)
        expect(flow.core).toBe(Math.round(map.ring.rx * 0.45 * 10) / 10)
        expect(flow.arm).toBe(Math.round(map.ring.rx * 1.2 * 10) / 10)
      })
      expect(orbitFlows({ ...map, flows: [] }).map((flow) => flow.period)).toEqual(
        map.orbits.map((orbit) => orbit.period),
      )
    }
    expect(orbitFlows(orbitMap({ app: 0, work: 0 }, HERO_FRAME))).toEqual([])
  })

  it('65点の cqi を枠へ戻すと、元の楕円に沿う。1周の継ぎ目は跳ねない', () => {
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 8, work: 3 }, frame)
      orbitFlows(map).forEach((flow, i) => {
        const orbit = map.orbits[i]
        if (!orbit) throw new Error('軌道が無い')
        expect(flow.frames).toHaveLength(65)
        flow.frames.forEach((sample) => {
          const expected = projected(orbit.ellipse, { x: 1, y: 0 }, flow.turn + sample.at * 3.6)
          expect((sample.x * map.width) / 100).toBeCloseTo(expected.x, 8)
          // y も幅を基準にする。Contact の高さを使うと同じ星系にならない
          expect((sample.y * map.width) / 100).toBeCloseTo(expected.y, 8)
        })
        expect(flow.frames[64]).toEqual({ ...flow.frames[0], at: 100 })
        // linear の区間の中でも、直線の近似は枠の1px以内に収まる
        for (let sample = 0; sample < 64; sample += 1) {
          const first = flow.frames[sample]
          const last = flow.frames[sample + 1]
          if (!first || !last) throw new Error('コマが無い')
          const expected = projected(
            orbit.ellipse,
            { x: 1, y: 0 },
            flow.turn + ((sample + 0.5) / 64) * 360,
          )
          const x = ((first.x + last.x) * map.width) / 200
          const y = ((first.y + last.y) * map.width) / 200
          expect(Math.hypot(x - expected.x, y - expected.y)).toBeLessThan(1)
        }
      })
    }
  })

  it('局所の尾へ matrix を掛けると、元の16°/2.4の楔と同じ位置と姿勢になる', () => {
    const base = orbitMap({ app: 8, work: 3 }, HERO_FRAME)
    const tilted = {
      ...base,
      orbits: base.orbits.map((orbit) => ({
        ...orbit,
        ellipse: { ...orbit.ellipse, angle: 23 },
      })),
    }
    for (const map of [base, orbitMap({ app: 8, work: 3 }, CONTACT_FRAME), tilted]) {
      orbitFlows(map).forEach((flow, i) => {
        const ellipse = map.orbits[i]?.ellipse
        if (!ellipse) throw new Error('軌道が無い')
        // 旧 Flows の、単位円の内と外の縁を囲んだ楔
        const edge = (side: 1 | -1) =>
          Array.from({ length: 9 }, (_, k) => {
            const theta = rad((-16 * k) / 8)
            const r = 1 + side * (2.4 / ellipse.rx) * (1 - k / 8)
            return { x: four(r * Math.cos(theta)), y: four(r * Math.sin(theta)) }
          })
        const original = [...edge(1), ...edge(-1).slice(0, -1).reverse()]
        const local = points(flow.tail.d)
        expect(local).toHaveLength(original.length)
        const { x, y, width, height } = flow.tail.box
        for (const point of local) {
          expect(point.x).toBeGreaterThanOrEqual(x)
          expect(point.x).toBeLessThanOrEqual(x + width + 1e-9)
          expect(point.y).toBeGreaterThanOrEqual(y)
          expect(point.y).toBeLessThanOrEqual(y + height + 1e-9)
        }
        expect(flow.tail.viewBox).toBe(`${x} ${y} ${width} ${height}`)
        for (const index of [0, 7, 16, 32, 47, 64]) {
          const sample = flow.frames[index]
          if (!sample) throw new Error('コマが無い')
          const { a, b, c, d } = sample.matrix
          local.forEach((point, vertex) => {
            const unit = original[vertex]
            if (!unit) throw new Error('頂点が無い')
            const expected = projected(ellipse, unit, flow.turn + sample.at * 3.6)
            const actual = {
              x: (sample.x * map.width) / 100 + a * point.x + c * point.y,
              y: (sample.y * map.width) / 100 + b * point.x + d * point.y,
            }
            expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(0.001)
          })
        }
        // 濃さの坂は尾の終わりから星の中心へ。ローカル座標の変換で向きを変えない
        expect(flow.tail.gradient).toEqual({
          x1: four(ellipse.rx * (four(Math.cos(rad(-16))) - 1)),
          y1: four(ellipse.rx * four(Math.sin(rad(-16)))),
          x2: 0,
          y2: 0,
        })
      })
    }
  })

  it('半面の遮蔽は固定。水平なら焦点を境に inset、傾いていれば元の頂点の polygon', () => {
    for (const frame of [HERO_FRAME, CONTACT_FRAME]) {
      const map = orbitMap({ app: 3, work: 2 }, frame)
      const boundary = (frame.focus.y * 100) / frame.height
      expect(orbitHalfClip(map, 'far')).toBe(`inset(0 0 ${four(100 - boundary)}% 0)`)
      expect(orbitHalfClip(map, 'near')).toBe(`inset(${four(boundary)}% 0 0 0)`)
      const angled = { ...map, halves: { ...map.halves, far: 'M1200 400L-200 0L0 -400L1400 0Z' } }
      const clip = orbitHalfClip(angled, 'far')
      expect(clip.startsWith('polygon(')).toBe(true)
      const percentages = [...clip.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)]
      const expected = points(angled.halves.far)
      percentages.forEach(([, x, y], index) => {
        expect((Number(x) * map.width) / 100).toBeCloseTo(expected[index]?.x ?? NaN, 2)
        expect((Number(y) * map.height) / 100).toBeCloseTo(expected[index]?.y ?? NaN, 2)
      })
      expect(percentages).toHaveLength(4)
    }
  })
})
