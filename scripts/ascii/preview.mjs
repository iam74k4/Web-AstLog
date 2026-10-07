/* Render the shipped SVG's actual 64 frames to PNGs for an animated preview.
   ASCII_PREVIEW_OUTPUT is required; ASCII_PREVIEW_KIND defaults to black-hole.
   This is an offline authoring tool, not code delivered to visitors. */
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { ROOT } from '../lib/dev-server.mjs'

const kind = process.env.ASCII_PREVIEW_KIND ?? 'black-hole'
assert.ok(['black-hole', 'saturn', 'neptune', 'moon', 'sun', 'nebula'].includes(kind))
assert.ok(process.env.ASCII_PREVIEW_OUTPUT, 'Provide ASCII_PREVIEW_OUTPUT')
const output = resolve(process.env.ASCII_PREVIEW_OUTPUT)
await mkdir(output, { recursive: true })
const svg = (await readFile(`${ROOT}public/assets/ascii-${kind}.svg`, 'utf8')).replace(
  'viewBox="0 0 1586 992"',
  'viewBox="550 80 1036 832"',
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 620, height: 498 },
    deviceScaleFactor: 1,
  })
  await page.setContent(
    `<style>html,body{margin:0;background:#0b0b0d}svg{display:block;width:620px;height:498px}</style>${svg}`,
  )
  await page.evaluate(() => document.querySelector('svg').pauseAnimations())
  for (let frame = 0; frame < 64; frame++) {
    await page.evaluate(
      async (time) => {
        document.querySelector('svg').setCurrentTime(time)
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      },
      frame / 8 + 0.001,
    )
    await page.screenshot({ path: `${output}/${kind}-${String(frame).padStart(2, '0')}.png` })
  }
  console.log(`Rendered ${kind}: 64 frames to ${output}`)
} finally {
  await browser.close()
}
