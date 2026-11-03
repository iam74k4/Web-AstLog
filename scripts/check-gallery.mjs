// ショーケースの実ブラウザ検査。使い捨てD1/KVで操作・JS無効・印刷・CSPを確かめる。
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'

const state = await scratchState('gallery', [await readFile(`${ROOT}seed.sql`, 'utf8')])
let server
let browser
try {
  server = await devServer(undefined, 8791, state.dir)
  browser = await chromium.launch({ headless: true })
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to execute/.test(message.text()))
        errors.push(message.text())
    })
    await page.goto(`${server.base}/apps/item/appmixer`)
    const root = page.locator('.shots--showcase')
    await root.waitFor()
    const thumbs = root.locator('.gallery__thumb')
    const slides = root.locator('.gallery__item')
    assert.equal(await slides.count(), 5)
    assert.equal(await root.locator('.gallery__item:visible').count(), 1)
    await root.scrollIntoViewIfNeeded()
    const toolbarY = await root
      .locator('.gallery__toolbar')
      .evaluate((el) => el.getBoundingClientRect().top + scrollY)
    await thumbs.nth(2).click()
    assert.equal(await slides.nth(2).getAttribute('data-active'), 'true')
    assert.equal(await root.locator('[data-gallery-count]').textContent(), '03 / 05')
    await thumbs.nth(2).press('End')
    assert.equal(await thumbs.nth(4).getAttribute('aria-pressed'), 'true')
    await thumbs.nth(4).press('ArrowRight')
    assert.equal(await thumbs.nth(0).getAttribute('aria-pressed'), 'true')
    await root.locator('[data-gallery-prev]').click()
    assert.equal(await slides.nth(4).getAttribute('data-active'), 'true')
    await root.locator('[data-gallery-next]').click()
    assert.equal(await slides.nth(0).getAttribute('data-active'), 'true')
    assert.ok(
      Math.abs(
        toolbarY -
          (await root
            .locator('.gallery__toolbar')
            .evaluate((el) => el.getBoundingClientRect().top + scrollY)),
      ) < 1,
    )
    assert.equal(await slides.nth(1).evaluate((el) => el.inert), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal(
      await root
        .locator('.gallery__frame')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
      'none',
    )
    // 動画を含む図でも、切り替えが標準の pause() を呼ぶこと（映像のコーデックには依存しない）。
    await slides.nth(0).evaluate((el) => {
      const video = document.createElement('video')
      video.pause = () => {
        video.dataset.paused = 'true'
      }
      el.append(video)
    })
    await thumbs.nth(1).click()
    assert.equal(await slides.nth(0).locator('video').getAttribute('data-paused'), 'true')
    await slides
      .nth(0)
      .locator('video')
      .evaluate((el) => el.remove())
    await thumbs.nth(0).click()
    if (process.env.GALLERY_SCREENSHOTS) {
      await mkdir(process.env.GALLERY_SCREENSHOTS, { recursive: true })
      await root.screenshot({ path: `${process.env.GALLERY_SCREENSHOTS}/gallery-${width}.png` })
    }
    await page.emulateMedia({ media: 'print' })
    assert.equal(await root.locator('.gallery__item:visible').count(), 5)
    assert.equal(await root.locator('.gallery__controls').isVisible(), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  const noJS = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  })
  await noJS.goto(`${server.base}/apps/item/appmixer`)
  assert.equal(await noJS.locator('.gallery__item:visible').count(), 5)
  assert.equal(await noJS.locator('.gallery__controls').isVisible(), false)
  assert.equal(await noJS.locator('.gallery__image').first().getAttribute('target'), '_blank')
  await noJS.close()
  console.log(
    '✓ Showcase: 3 widths, thumbnails, keyboard, arrows, stable layout, video pause, reduced motion, print, no-JS, CSP',
  )
} finally {
  await browser?.close()
  await server?.stop()
  await state.cleanup()
}
