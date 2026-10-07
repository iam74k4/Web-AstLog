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
}
