/* Observe decorative cover motion without changing product scripts or CSP. */
import assert from 'node:assert/strict'

export async function assertCoverMotion(page, name) {
  const report = await page.evaluate(() => {
    const art = document.querySelector('.astra-art')
    const animations = art.getAnimations()
    const saved = animations.map((animation) => ({
      animation,
      time: animation.currentTime,
      state: animation.playState,
    }))
    const read = () => {
      const style = getComputedStyle(art)
      return {
        translate: style.translate,
        rotate: style.rotate,
        scale: style.scale,
        opacity: style.opacity,
        anchor: style.transform,
        overflow: document.documentElement.scrollWidth - innerWidth,
        content: [...document.querySelectorAll('main h1, main a[href]')].map((node) => {
          const box = node.getBoundingClientRect()
          return [box.x, box.y, box.width, box.height]
        }),
      }
    }
    const frames = []
    try {
      for (const entry of saved) entry.animation.pause()
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        for (const { animation } of saved)
          animation.currentTime = animation.effect.getTiming().duration * fraction
        frames.push(read())
      }
    } finally {
      for (const { animation, time, state } of saved) {
        animation.currentTime = time
        if (state === 'running') animation.play()
      }
    }
    return {
      names: animations.map((animation) => animation.animationName).sort(),
      perpetual: animations.every(
        (animation) => animation.effect.getTiming().iterations === Infinity,
      ),
      ascii: document.querySelectorAll('.ascii-sky,.ascii-celestial').length,
      frames,
    }
  })
  assert.equal(report.ascii, 0, `${name}: ASCII decoration remains`)
  assert.deepEqual(report.names, ['cover-drift', 'cover-light'], `${name}: cover is static`)
  assert.ok(report.perpetual, `${name}: cover motion does not loop`)
  const [first, , middle] = report.frames
  for (const property of ['translate', 'rotate', 'scale', 'opacity'])
    assert.notEqual(first[property], middle[property], `${name}: ${property} is static`)
  for (const frame of report.frames) {
    assert.deepEqual(frame.content, first.content, `${name}: content moves with the cover`)
    assert.equal(frame.anchor, first.anchor, `${name}: desktop centering was overwritten`)
    assert.ok(frame.overflow <= 1, `${name}: cover overflows during motion`)
  }
  assert.deepEqual(report.frames.at(-1), first, `${name}: loop does not return to its first frame`)
  const infall = await page.evaluate(() => {
    const art = document.querySelector('.astra-art')
    const layer = document.querySelector('.astra-infall')
    if (!layer) return { expected: art.classList.contains('astra-art--hole'), count: 0 }
    const canvas = layer.querySelector('.astra-infall__canvas')
    const stars = [...layer.querySelectorAll('.astra-infall__star')]
    const frames = stars.map((star) => {
      const animation = star.getAnimations()[0]
      const time = animation.currentTime
      const state = animation.playState
      const timing = animation.effect.getTiming()
      animation.pause()
      try {
        return [0.04, 0.5, 0.95, 1].map((fraction) => {
          animation.currentTime = timing.delay + timing.duration * (1 + fraction)
          const style = getComputedStyle(star)
          const matrix = new DOMMatrixReadOnly(style.transform)
          const x = (matrix.e / canvas.clientWidth) * 1586 - 1045
          const y = (matrix.f / canvas.clientWidth) * 1586 - 477
          return {
            radius: Math.hypot(
              x * Math.cos(-0.48) + y * Math.sin(-0.48),
              (-x * Math.sin(-0.48) + y * Math.cos(-0.48)) / 0.64,
            ),
            opacity: Number(style.opacity),
            stretch: Math.hypot(matrix.a, matrix.b),
          }
        })
      } finally {
        animation.currentTime = time
        if (state === 'running') animation.play()
      }
    })
    return {
      expected: art.classList.contains('astra-art--hole'),
      count: stars.length,
      hidden: layer.getAttribute('aria-hidden'),
      pointer: getComputedStyle(layer).pointerEvents,
      box: [layer.offsetWidth, layer.offsetHeight],
      artBox: [art.offsetWidth, art.offsetHeight],
      canvasWidth: canvas.clientWidth,
      fitWidth: Math.max(art.clientWidth, art.clientHeight * (1586 / 992)),
      frames,
    }
  })
  assert.equal(infall.count, infall.expected ? 18 : 0, `${name}: infall on wrong cover`)
  if (!infall.count) return
  assert.equal(infall.hidden, 'true')
  assert.equal(infall.pointer, 'none')
  assert.deepEqual(infall.box, infall.artBox, `${name}: infall layer misaligned`)
  assert.ok(Math.abs(infall.canvasWidth - infall.fitWidth) < 2, `${name}: crop misaligned`)
  for (const [start, middle, end, restart] of infall.frames) {
    assert.ok(start.opacity > 0, `${name}: star does not appear`)
    assert.equal(restart.opacity, 0, `${name}: loop flashes`)
    assert.ok(
      start.radius > middle.radius && middle.radius > end.radius,
      `${name}: no infall ${JSON.stringify([start, middle, end])}`,
    )
    assert.ok(end.radius > 110, `${name}: star crosses the dark shadow`)
    assert.ok(end.stretch > middle.stretch, `${name}: no tidal stretch`)
  }
}
