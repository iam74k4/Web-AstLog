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
  const disk = await page.evaluate(() => {
    const art = document.querySelector('.astra-art')
    const layer = document.querySelector('.astra-disk')
    const rotors = [...document.querySelectorAll('.astra-disk__rotor')]
    if (!layer) return { expected: art.classList.contains('astra-art--hole'), count: 0 }
    const canvas = layer.querySelector('.astra-disk__canvas')
    const tracks = rotors.map((rotor) => {
      const animation = rotor.getAnimations()[0]
      const time = animation.currentTime
      const state = animation.playState
      animation.pause()
      try {
        const frames = [0, 0.25, 0.5, 1].map((fraction) => {
          animation.currentTime = animation.effect.getTiming().duration * fraction
          return getComputedStyle(rotor).transform
        })
        return { frames, duration: animation.effect.getTiming().duration }
      } finally {
        animation.currentTime = time
        if (state === 'running') animation.play()
      }
    })
    return {
      expected: art.classList.contains('astra-art--hole'),
      count: rotors.length,
      hidden: layer.getAttribute('aria-hidden'),
      box: [layer.offsetWidth, layer.offsetHeight],
      artBox: [art.offsetWidth, art.offsetHeight],
      canvasWidth: canvas.clientWidth,
      fitWidth: Math.max(art.clientWidth, art.clientHeight * (1586 / 992)),
      shadowMask: getComputedStyle(canvas).maskImage,
      particles: layer.querySelectorAll('.astra-infall__star').length,
      tracks,
    }
  })
  assert.equal(disk.count, disk.expected ? 2 : 0, `${name}: disk on wrong cover`)
  if (!disk.count) return
  assert.equal(disk.hidden, 'true')
  assert.equal(disk.particles, 0)
  assert.deepEqual(disk.box, disk.artBox, `${name}: disk layer misaligned`)
  assert.ok(Math.abs(disk.canvasWidth - disk.fitWidth) < 2, `${name}: crop misaligned`)
  assert.match(disk.shadowMask, /radial-gradient/)
  assert.deepEqual(
    disk.tracks.map((track) => track.duration),
    [24000, 16000],
  )
  for (const { frames } of disk.tracks) {
    assert.notEqual(frames[0], frames[1], `${name}: disk is static`)
    assert.notEqual(frames[1], frames[2], `${name}: disk does not rotate`)
    const quarterTurn = frames[1].match(/-?[\d.e+]+/g).map(Number)
    assert.ok(quarterTurn[1] > 0.99, `${name}: orbit runs against the marked arrows`)
    // A complete rotation returns to identity (allow CSS's floating point epsilon).
    for (const value of [frames[0], frames[3]]) {
      const values = value.match(/-?[\d.e+]+/g).map(Number)
      assert.ok(Math.abs(values[0] - 1) < 0.0001 && Math.abs(values[1]) < 0.0001)
    }
  }
}
