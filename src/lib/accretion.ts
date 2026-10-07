import { motionFrames } from './orbit-motion'

// Coordinates belong to the 1586 × 992 cover, not the viewport. Keep the dark
// shadow clear: particles disappear at the luminous rim, before entering it.
export const ACCRETION = { width: 1586, height: 992, x: 1045, y: 477, tilt: -0.48, squash: 0.64 }

export function accretionPoint(index: number, at: number) {
  const start = 390 + ((index * 47) % 160)
  const radius = start - (start - 114) * at ** 1.7
  const angle = index * 2.399963 + Math.PI * 2 * (0.22 * at + 0.95 * at * at)
  const u = radius * Math.cos(angle)
  const v = radius * Math.sin(angle) * ACCRETION.squash
  return {
    x: ACCRETION.x + u * Math.cos(ACCRETION.tilt) - v * Math.sin(ACCRETION.tilt),
    y: ACCRETION.y + u * Math.sin(ACCRETION.tilt) + v * Math.cos(ACCRETION.tilt),
    radius,
    angle,
    opacity: Math.max(0, Math.min(1, (at - 0.025) / 0.055, (0.985 - at) / 0.115)) * 0.85,
    stretch: 1 + 8 * at ** 3,
  }
}

export function accretionStars() {
  return Array.from({ length: 18 }, (_, index) => {
    const duration = 9 + (index % 5) * 0.7
    let previous = 0
    const frames = motionFrames(65, duration, [0.025, 0.08, 0.87, 0.985]).map(
      ({ at, steps }, sample) => {
        const point = accretionPoint(index, at)
        const before = accretionPoint(index, Math.max(0, at - 0.0001))
        const after = accretionPoint(index, Math.min(1, at + 0.0001))
        let turn = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI
        if (sample) {
          while (turn - previous > 180) turn -= 360
          while (turn - previous < -180) turn += 360
        }
        previous = turn
        return { ...point, at, steps, turn }
      },
    )
    return { duration, delay: -duration * ((index * 0.618034 + 0.17) % 1), frames }
  })
}
