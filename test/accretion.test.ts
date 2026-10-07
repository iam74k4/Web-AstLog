import { describe, expect, it } from 'vitest'
import { ACCRETION, accretionPoint, accretionStars } from '../src/lib/accretion'

describe('cover accretion', () => {
  it('spirals inward faster, stretches, and vanishes before crossing the shadow', () => {
    for (let index = 0; index < 18; index++) {
      const points = [0, 0.25, 0.5, 0.75, 1].map((at) => accretionPoint(index, at))
      expect(accretionPoint(index, 0).opacity).toBe(0)
      expect(accretionPoint(index, 1).opacity).toBe(0)
      for (let i = 1; i < points.length; i++) {
        const p = points[i]
        const previous = points[i - 1]
        if (!p || !previous) throw new Error('Missing sample')
        expect(p.radius).toBeLessThan(previous.radius)
        expect(p.radius).toBeGreaterThanOrEqual(114)
        expect(p.angle).toBeGreaterThan(previous.angle)
        expect(p.stretch).toBeGreaterThan(previous.stretch)
        const x = p.x - ACCRETION.x
        const y = p.y - ACCRETION.y
        const u = x * Math.cos(ACCRETION.tilt) + y * Math.sin(ACCRETION.tilt)
        const v = (-x * Math.sin(ACCRETION.tilt) + y * Math.cos(ACCRETION.tilt)) / ACCRETION.squash
        expect(Math.hypot(u, v)).toBeCloseTo(p.radius)
        const earlier = points[i - 2]
        if (earlier) {
          expect(previous.radius - p.radius).toBeGreaterThan(earlier.radius - previous.radius)
          expect(p.angle - previous.angle).toBeGreaterThan(previous.angle - earlier.angle)
        }
      }
    }
  })

  it('bakes deterministic, staggered 60 Hz paths without tangent flips', () => {
    const stars = accretionStars()
    expect(stars).toEqual(accretionStars())
    expect(stars).toHaveLength(18)
    expect(new Set(stars.map((star) => star.delay)).size).toBe(18)
    for (const star of stars) {
      expect(star.delay).toBeLessThan(0)
      expect(star.delay).toBeGreaterThan(-star.duration)
      expect(star.frames.length).toBeGreaterThanOrEqual(65)
      expect(star.frames.reduce((sum, frame) => sum + frame.steps, 0)).toBe(
        Math.round(star.duration * 60),
      )
      for (const [i, frame] of star.frames.entries()) {
        expect(Object.values(frame).every(Number.isFinite)).toBe(true)
        const previous = star.frames[i - 1]
        if (previous) expect(Math.abs(frame.turn - previous.turn)).toBeLessThan(180)
      }
    }
  })
})
