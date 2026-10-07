/* Verify real image-frame changes under the site's CSP, including script-free
   rendering and reduced-motion posters. Tests use an isolated local database. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'
import { importTs } from './lib/ts-import.mjs'

const { ASCII_ART } = await importTs('src/ui/ascii-art.ts')
const bodies = Object.keys(ASCII_ART).filter((key) => key !== 'nebula')
const hash = (value) => createHash('sha256').update(value).digest('hex')

for (const [kind, sources] of Object.entries(ASCII_ART)) {
  const assets = {}
  for (const [mode, url] of Object.entries(sources)) {
    const [path, query] = url.split('?v=')
    const content = await readFile(`${ROOT}public${path}`, 'utf8')
    assert.equal(hash(content).slice(0, 8), query, `${kind}/${mode}: stale asset URL`)
    assert.ok(
      !/<(?:script|style|image|foreignObject)\b|\bon\w+=|\bhref=/i.test(content),
      `${kind}: external or executable SVG content`,
    )
    assert.ok(content.includes('<text xml:space="preserve">'), `${kind}: not text artwork`)
    assets[mode] = content
  }
  assert.equal((assets.motion.match(/<animate\b/g) ?? []).length, 64, `${kind}: incomplete loop`)
  assert.ok(!assets.still.includes('<animate'), `${kind}: poster is animated`)
  assert.equal(
    assets.motion.match(/<text[\s\S]*?<\/text>/)?.[0],
    assets.still.match(/<text[\s\S]*?<\/text>/)?.[0],
    `${kind}: poster differs from first frame`,
  )
}

async function sqliteFiles(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await sqliteFiles(path)))
    else if (entry.name.endsWith('.sqlite')) files.push(path)
  }
  return files
}

const state = await scratchState('ascii-animation', [await readFile(`${ROOT}seed.sql`, 'utf8')])
let db
let server
let browser
let moving = 0
let still = 0
try {
  const candidates = (await sqliteFiles(state.dir)).filter((path) => {
    const candidate = new DatabaseSync(path, { readOnly: true })
    try {
      return candidate.prepare("SELECT name FROM sqlite_master WHERE name='members'").get()
    } finally {
      candidate.close()
    }
  })
  assert.equal(candidates.length, 1, 'Expected one isolated content database')
  db = new DatabaseSync(candidates[0])
  db.exec('PRAGMA busy_timeout=5000')
  server = await devServer(undefined, Number(process.env.ASCII_ANIMATION_PORT ?? 8943), state.dir)
  browser = await chromium.launch({ headless: true })

  for (const body of bodies) {
    db.prepare('UPDATE members SET celestial_body=? WHERE id=1').run(body)
    for (const path of ['/', '/contact']) {
      const kind = body === 'black-hole' && path === '/contact' ? 'nebula' : body
      for (const reduced of [false, true]) {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
          javaScriptEnabled: false,
        })
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        try {
          await page.goto(`${server.base}${path}?ascii=${body}-${reduced}`, {
            waitUntil: 'networkidle',
          })
          const picture = page.locator('.ascii-celestial')
          const image = picture.locator('img')
          await image.evaluate((node) => node.decode())
          const info = await image.evaluate((node) => ({
            src: node.currentSrc,
            width: node.naturalWidth,
            overflow: document.documentElement.scrollWidth - innerWidth,
          }))
          assert.ok(
            info.src.endsWith(ASCII_ART[kind][reduced ? 'still' : 'motion']),
            `${kind}: wrong motion preference source`,
          )
          assert.equal(info.width, 1586, `${kind}: broken image`)
          assert.ok(info.overflow <= 1, `${kind}: overflow`)
          // Isolate the picture's pixels; otherwise unrelated stars could make a
          // broken/static SVG appear animated. The artwork backdrop stays static.
          await page.evaluate(() => {
            const style = document.createElement('style')
            style.textContent = '.ascii-sky,.cosmos,.system,.orbits {visibility:hidden!important}'
            document.head.append(style)
          })
          const first = hash(await picture.screenshot())
          await page.waitForTimeout(750)
          const next = hash(await picture.screenshot())
          if (reduced) {
            assert.equal(first, next, `${kind}: reduced-motion changed pixels`)
            still++
          } else {
            assert.notEqual(first, next, `${kind}: ASCII image is static`)
            moving++
          }
          await page.emulateMedia({ media: 'print' })
          assert.equal(await picture.isVisible(), false, `${kind}: decoration is printed`)
          assert.deepEqual(errors, [], `${kind}: runtime/CSP errors`)
        } finally {
          await page.close()
        }
      }
    }
    console.log(`  ${body}: Home/Contact, JSなしのコマ変化と静止画を確認`)
  }
  console.log(
    `✓ ASCII animation: ${moving} animated / ${still} reduced-motion / 12 versioned assets`,
  )
} finally {
  await browser?.close()
  await server?.stop()
  db?.close()
  await state.cleanup()
}
