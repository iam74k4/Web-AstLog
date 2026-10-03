/*
  軌道を流れる星の HTML 描画用の形。UI を読まず、OrbitMap の楕円から位置と尾の姿勢を焼く。
  動く箱の位置は cqi、尾の matrix は無次元。keyframes に var() や毎コマの逆変換を持たせない。
*/
import { MOTION_RATE, type OrbitMap } from './orbits'

export type MotionFrame = {
  // 周期の中の割合。CSS の百分率にする側で 100 倍する
  at: number
  frame: number
  // 次の点までの整数コマ数。最後は区間を持たないので 0
  steps: number
}

/*
  端点を含む samples 点と明るさの折れ目を、位置と共用する時計へ寄せる。
  各区間を steps(steps) で進めれば、異なる点数の道も同じ 1/MOTION_RATE 秒で動く。
  duration は最も近い整数コマへ丸める。CSS の周期も最後の frame / MOTION_RATE にそろえる。
*/
export function motionFrames(
  samples: number,
  duration: number,
  breaks: readonly number[] = [],
): MotionFrame[] {
  if (!Number.isInteger(samples) || samples < 2)
    throw new RangeError('At least two samples required')
  const total = Math.round(duration * MOTION_RATE)
  if (!Number.isSafeInteger(total) || total < 1)
    throw new RangeError('Positive frame duration required')
  const frames = new Set<number>()
  for (let sample = 0; sample < samples; sample += 1) {
    frames.add(Math.round((sample / (samples - 1)) * total))
  }
  for (const at of breaks) {
    if (!Number.isFinite(at) || at < 0 || at > 1) throw new RangeError('Break outside the period')
    frames.add(Math.round(at * total))
  }
  const ordered = [...frames].sort((a, b) => a - b)
  return ordered.map((frame, index) => ({
    at: frame / total,
    frame,
    steps: (ordered[index + 1] ?? frame) - frame,
  }))
}

type Point = { x: number; y: number }
export type FlowFrame = Point & {
  // 周期の中の位置（%、0 と 100 を含む）。x / y は図の幅を基準にした cqi の数値
  at: number
  matrix: { a: number; b: number; c: number; d: number }
}
export type FlowMotion = {
  period: number
  turn: number
  size: number
  // 芯の半径と光芒の腕の長さ（枠の単位）
  core: number
  arm: number
  tail: {
    d: string
    viewBox: string
    // 星の中心を原点とした尾の箱（枠の単位。描く側で cqi に換算する）
    box: Point & { width: number; height: number }
    gradient: { x1: number; y1: number; x2: number; y2: number }
  }
  frames: FlowFrame[]
}

const TRAIL = 16
const TRAIL_W = 2.4
const CORE = 0.45
const GLINT = 1.2
const SAMPLES = 64
const rad = (degrees: number) => (degrees * Math.PI) / 180
const tenth = (value: number) => Math.round(value * 10) / 10
const four = (value: number) => Math.round(value * 10000) / 10000

/*
  元の単位円の楔を、星の中心 (1, 0) からの距離へ直し、rx 倍する。
  ローカルな尾はこの形のまま描き、R(angle)・diag(1, ry/rx)・R(theta) の matrix で動かす。
  SVG の小さい箱は box.x / box.y へ置き、その親の変換の原点を星の中心 (0, 0) にする。
*/
const flowTail = (rx: number): FlowMotion['tail'] => {
  const steps = 8
  const edge = (side: 1 | -1) =>
    Array.from({ length: steps + 1 }, (_, k) => {
      const angle = rad((-TRAIL * k) / steps)
      const radius = 1 + side * (TRAIL_W / rx) * (1 - k / steps)
      return {
        x: four(rx * (four(radius * Math.cos(angle)) - 1)),
        y: four(rx * four(radius * Math.sin(angle))),
      }
    })
  const points = [...edge(1), ...edge(-1).slice(0, -1).reverse()]
  const x = Math.min(...points.map((point) => point.x))
  const y = Math.min(...points.map((point) => point.y))
  const width = four(Math.max(...points.map((point) => point.x)) - x)
  const height = four(Math.max(...points.map((point) => point.y)) - y)
  return {
    d: `M${points.map((point) => `${point.x} ${point.y}`).join('L')}Z`,
    viewBox: `${x} ${y} ${width} ${height}`,
    box: { x, y, width, height },
    gradient: {
      x1: four(rx * (four(Math.cos(rad(-TRAIL))) - 1)),
      y1: four(rx * four(Math.sin(rad(-TRAIL)))),
      x2: 0,
      y2: 0,
    },
  }
}

export function orbitFlows(map: OrbitMap): FlowMotion[] {
  return map.orbits.map((orbit, index) => {
    const { cx, cy, rx, ry, angle } = orbit.ellipse
    const turn = tenth(((index * 0.618) % 1) * 360)
    const phi = rad(angle)
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    const ratio = ry / rx
    return {
      period: map.flows[index] ?? orbit.period,
      turn,
      size:
        Math.round((orbit.sway.reduce((sum, value) => sum + value, 0) / orbit.sway.length) * 100) /
        100,
      core: tenth(map.ring.rx * CORE),
      arm: tenth(map.ring.rx * GLINT),
      tail: flowTail(rx),
      frames: Array.from({ length: SAMPLES + 1 }, (_, sample) => {
        // 最後の点は初めと同じ数値。閉じるところで丸めの違いによる跳びを作らない
        const theta = rad(turn) + (sample === SAMPLES ? 0 : (sample / SAMPLES) * Math.PI * 2)
        const ct = Math.cos(theta)
        const st = Math.sin(theta)
        return {
          at: (sample / SAMPLES) * 100,
          x: ((cx + rx * ct * cp - ry * st * sp) * 100) / map.width,
          y: ((cy + rx * ct * sp + ry * st * cp) * 100) / map.width,
          matrix: {
            a: cp * ct - ratio * sp * st,
            b: sp * ct + ratio * cp * st,
            c: -cp * st - ratio * sp * ct,
            d: -sp * st + ratio * cp * ct,
          },
        }
      }),
    }
  })
}

// 半面の元の4頂点を、HTML の枠に対する百分率へ直す。位置は周期のあいだ変わらない
export function orbitHalfClip(map: OrbitMap, side: 'far' | 'near'): string {
  const points = [...map.halves[side].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => ({
    x: Number(x),
    y: Number(y),
  }))
  const [first, second, inside] = points
  // 水平な分け目は単純な矩形で切る。傾いた軌道面だけ元の4頂点を使う
  if (first && second && inside && first.y === second.y) {
    const at = (first.y * 100) / map.height
    return inside.y < first.y ? `inset(0 0 ${four(100 - at)}% 0)` : `inset(${four(at)}% 0 0 0)`
  }
  return `polygon(${points.map(({ x, y }) => `${four((x * 100) / map.width)}% ${four((y * 100) / map.height)}%`).join(',')})`
}
