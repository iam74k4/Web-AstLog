/*
  天体の CSS motion を隔離した D1/KV と実 CSP のまま測る。既存の軌道同期検査とは別。
  pause/currentTime は検査ページだけの観測。製品の script や時計は変更しない。
  CELESTIAL_MOTION_PORT / CELESTIAL_MOTION_OUTPUT でポートと結果の保存先を指定できる。
*/
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { assertCoverMotion } from './lib/cover-motion.mjs'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'
import { importTs } from './lib/ts-import.mjs'

const { CELESTIAL_BODY_KEYS } = await importTs('src/celestial.ts')
const { BLACKHOLE_ART } = await importTs('src/ui/logo.ts')
const { ASTRA_CONTACT_ART, ASTRA_COVER_ART, CELESTIAL_ART } =
  await importTs('src/ui/celestial-art.ts')
const { HERO_FRAME, CONTACT_FRAME } = await importTs('src/lib/orbits.ts')
const SCOPE = '.celestial--art, .hole'
const EXPECTED = {
  'black-hole': 'celestial-flow',
  moon: 'celestial-float',
  neptune: 'celestial-drift',
  saturn: 'celestial-rock',
  sun: 'celestial-radiance',
}
const VIEWS = [
  { key: 'desktop', width: 1440, height: 900 },
  { key: 'phone', width: 390, height: 844 },
]
const SCREENS = [
  { key: 'profile', path: '/members/okazaki' },
  { key: 'hero', path: '/', frame: HERO_FRAME },
  { key: 'contact', path: '/contact', frame: CONTACT_FRAME },
]
const hash = (value) => createHash('sha256').update(value).digest('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const report = {
  startedAt: new Date().toISOString(),
  isolated: true,
  productionTouched: false,
  developmentDatabaseTouched: false,
  cells: [],
  previews: [],
  performance: [],
  failures: [],
}

async function sqliteFiles(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await sqliteFiles(path)))
    else if (entry.name.endsWith('.sqlite')) found.push(path)
  }
  return found.sort()
}

const tableNames = (db) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_METADATA','d1_migrations') ORDER BY name",
    )
    .all()
    .map(({ name }) => name)

// Wrangler's local observability store records every request. Identify by its own path AND schema,
// never by a content table's name alone. All other databases, including cache and KV, remain audited.
function isTraceStore(file, db, tables) {
  if (
    !file.replaceAll('\\', '/').includes('/observability/miniflare-wobs-trace-store/') ||
    tables.length !== 2 ||
    !tables.includes('logs') ||
    !tables.includes('spans')
  )
    return false
  return [
    ['logs', ['trace_id', 'span_id', 'seq', 'ts_ms', 'level', 'operation', 'created_at']],
    ['spans', ['trace_id', 'span_id', 'start_ms', 'duration_ms', 'outcome', 'attributes']],
  ].every(([table, required]) => {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map(({ name }) => name)
    return required.every((name) => columns.includes(name))
  })
}

function traceCounts(files) {
  return files.flatMap((file) => {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      if (!isTraceStore(file, db, tableNames(db))) return []
      return [
        {
          logs: db.prepare('SELECT count(*) AS n FROM logs').get().n,
          spans: db.prepare('SELECT count(*) AS n FROM spans').get().n,
        },
      ]
    } finally {
      db.close()
    }
  })
}

// Logical values, not WAL/file bytes: reading or checkpointing must not look like a content write.
function fingerprint(files) {
  const values = files.flatMap((file) => {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const tables = tableNames(db)
      if (isTraceStore(file, db, tables)) return []
      return [
        tables.map((name) => ({
          name,
          rows: db
            .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
            .all()
            .map((row) =>
              JSON.stringify(row, (_key, value) =>
                value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value,
              ),
            )
            .sort(),
        })),
      ]
    } finally {
      db.close()
    }
  })
  return { databases: values.length, sha256: hash(JSON.stringify(values)) }
}

async function ready(page) {
  await page.waitForLoadState('load')
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.images].map(async (img) => {
        img.loading = 'eager'
        await img.decode()
        if (!img.naturalWidth) throw new Error(`画像が欠けている: ${img.currentSrc}`)
      }),
    )
    // Cache the nontransparent artwork bounds once. Halo and masked duplicate pixels are excluded.
    window.__celestialPixels = new Map()
    for (const img of document.querySelectorAll(
      '.celestial__image, .celestial__black-hole > img, .hole__art',
    )) {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let left = canvas.width
      let top = canvas.height
      let right = -1
      let bottom = -1
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (bytes[(y * canvas.width + x) * 4 + 3] < 5) continue
          left = Math.min(left, x)
          top = Math.min(top, y)
          right = Math.max(right, x + 1)
          bottom = Math.max(bottom, y + 1)
        }
      }
      if (right <= left || bottom <= top) throw new Error('天体画像が透明だけ')
      window.__celestialPixels.set(img.currentSrc, { left, top, right, bottom })
    }
  })
  await page.waitForFunction(() => {
    const h1 = document.querySelector('main h1')
    return h1 && Number(getComputedStyle(h1).opacity) >= 0.95
  })
  if (await page.locator('html[data-motion-staged]').count()) {
    // Existing BH brightness starts through the original helper; do not count it mid-start.
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.hole__art, .brand__word .logo-art')].every((node) =>
          node.hasAttribute('data-motion-ready'),
        ),
      undefined,
      { timeout: 12_000 },
    )
  }
}

async function animations(page) {
  return page.evaluate((scope) => {
    return document
      .getAnimations()
      .filter((animation) => {
        const target = animation.effect?.target
        return (
          animation instanceof CSSAnimation && target instanceof Element && target.closest(scope)
        )
      })
      .map((animation) => {
        const target = animation.effect.target
        const timing = animation.effect.getTiming()
        const frames = animation.effect.getKeyframes()
        return {
          name: animation.animationName,
          target: target.className,
          state: animation.playState,
          at: animation.currentTime,
          duration: timing.duration,
          infinite: timing.iterations === Infinity,
          easing: timing.easing,
          intervals: frames.slice(0, -1).map((frame, index) => ({
            offset: frame.computedOffset,
            end: frames[index + 1].computedOffset,
            easing: frame.easing,
          })),
          transform: getComputedStyle(target).transform,
          opacity: getComputedStyle(target).opacity,
          properties: [...new Set(frames.flatMap((frame) => Object.keys(frame)))],
        }
      })
  }, SCOPE)
}

async function geometry(page, screen) {
  return page.evaluate(
    ({ screen, scope }) => {
      const need = (yes, message) => {
        if (!yes) throw new Error(message)
      }
      const rect = (element) => {
        const box = element.getBoundingClientRect()
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        }
      }
      const inside = (a, b, tolerance = 2) =>
        a.left >= b.left - tolerance &&
        a.top >= b.top - tolerance &&
        a.right <= b.right + tolerance &&
        a.bottom <= b.bottom + tolerance
      const overlap = (a, b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      const root =
        screen.key === 'profile' || screen.key === 'preview'
          ? document.querySelector('.hero--profile > .celestial--art')
          : document.querySelector(
              `${screen.key === 'hero' ? '.system' : '.orbits'} :is(.hole,.celestial--art)`,
            )
      need(root, '天体の枠が無い')
      const stage = rect(root)
      need(stage.width > 0 && stage.height > 0, '天体の枠が見えない')
      const frameNode = screen.frame
        ? root.closest(screen.key === 'hero' ? '.system' : '.orbits')
        : root
      const frame = rect(frameNode)
      const center = { x: (stage.left + stage.right) / 2, y: (stage.top + stage.bottom) / 2 }
      if (screen.frame) {
        const expected = {
          x: frame.left + (frame.width * screen.frame.focus.x) / screen.frame.width,
          y: frame.top + (frame.height * screen.frame.focus.y) / screen.frame.height,
        }
        need(
          Math.abs(center.x - expected.x) < 2 && Math.abs(center.y - expected.y) < 2,
          '中心が軌道の焦点からずれた',
        )
      }
      const copy = document.querySelector(
        screen.key === 'hero'
          ? '.hero__copy'
          : screen.key === 'contact'
            ? '.contact'
            : '.profile-cover__copy',
      )
      need(copy, '本文の枠が無い')
      const copyBox = rect(copy)
      const visible = []
      for (const img of root.querySelectorAll(
        '.celestial__image, .celestial__black-hole > img, .hole__art',
      )) {
        const pixels = window.__celestialPixels.get(img.currentSrc)
        const style = getComputedStyle(img)
        const box = rect(img)
        const width = Number.parseFloat(style.width)
        const height = Number.parseFloat(style.height)
        const scale =
          style.objectFit === 'contain'
            ? Math.min(width / img.naturalWidth, height / img.naturalHeight)
            : width / img.naturalWidth
        let matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform)
        const turn = Number.parseFloat(getComputedStyle(root).rotate)
        if (Number.isFinite(turn)) matrix = new DOMMatrix().rotate(turn).multiply(matrix)
        need(matrix.is2D, '想定外の3D transform')
        const points = [
          [pixels.left, pixels.top],
          [pixels.right, pixels.top],
          [pixels.right, pixels.bottom],
          [pixels.left, pixels.bottom],
        ].map(([x, y]) => {
          const point = matrix.transformPoint({
            x: (x - img.naturalWidth / 2) * scale,
            y: (y - img.naturalHeight / 2) * scale,
          })
          return {
            x: (box.left + box.right) / 2 + point.x - matrix.e,
            y: (box.top + box.bottom) / 2 + point.y - matrix.f,
          }
        })
        const light = {
          left: Math.min(...points.map((p) => p.x)),
          top: Math.min(...points.map((p) => p.y)),
          right: Math.max(...points.map((p) => p.x)),
          bottom: Math.max(...points.map((p) => p.y)),
        }
        need(inside(light, screen.frame ? frame : stage), '可視の天体が枠から切れた')
        need(!overlap(light, copyBox), '可視の天体が本文と重なる')
        visible.push(light)
      }
      const shadowHost = root.matches('.hole') ? root : root.querySelector('.celestial__black-hole')
      let shadow = null
      if (shadowHost) {
        const style = getComputedStyle(shadowHost, '::before')
        need(
          Number.parseFloat(style.width) > 0 &&
            Math.abs(Number.parseFloat(style.width) - Number.parseFloat(style.height)) < 0.5,
          '黒い影が真円でない',
        )
        need(style.opacity === '1' && style.backgroundColor === 'rgb(0, 0, 0)', '黒い影が透けた')
        need(getComputedStyle(shadowHost).opacity === '1', '黒い影の親が透けた')
        need(shadowHost.getAnimations({ subtree: false }).length === 0, '黒い影自身が動いている')
        shadow = {
          width: style.width,
          height: style.height,
          left: style.left,
          top: style.top,
          transform: style.transform,
          translate: style.translate,
          opacity: style.opacity,
          background: style.backgroundColor,
        }
      }
      const duplicates = [...root.querySelectorAll('.blackhole-flow, .celestial__corona')].map(
        (node) => {
          const style = getComputedStyle(node)
          need(style.maskImage !== 'none', '複製画像のmaskが無い')
          need(inside(rect(node), stage), 'maskの固定枠が天体stageから出た')
          if (node.matches('.blackhole-flow')) {
            const texture = node.querySelector('.blackhole-flow__texture')
            need(texture, '円盤の固定texture maskが無い')
            const textureStyle = getComputedStyle(texture)
            need(textureStyle.maskMode === 'luminance', '円盤が輝度maskでない')
            need(
              textureStyle.maskImage.includes('/assets/blackhole.webp'),
              '円盤maskが共通素材でない',
            )
            need(
              texture.getAnimations({ subtree: false }).length === 0,
              '円盤のtexture自体が動いた',
            )
            need(textureStyle.overflow === 'hidden', '流れる光がmask枠から溢れる')
            need(
              texture.querySelectorAll('.blackhole-flow__beam').length === 2,
              '流れる光が2本でない',
            )
            need(node.querySelectorAll('img').length === 0, '円盤に移動する複製画像が残った')
          }
          return { className: node.className, bounds: rect(node), mask: style.maskImage }
        },
      )
      need(document.documentElement.scrollWidth <= innerWidth + 1, '横方向に溢れた')
      const identityAnimations = document
        .getAnimations()
        .filter(
          (a) =>
            a.effect?.target instanceof Element &&
            (a.effect.target.closest('.celestial--symbol, .logo-core') ||
              (a.effect.target.closest('.brand__word') && !a.effect.target.matches('.logo-art'))),
        )
      need(identityAnimations.length === 0, '小記号/ロゴの文字や影が動いている')
      need(document.querySelectorAll('main h1').length === 1, 'h1が1つでない')
      need(document.querySelectorAll(scope).length > 0, '検査対象が無い')
      const primary = root.querySelector('.celestial__image')
      const primaryBox = primary ? rect(primary) : null
      const primaryCenterY = primaryBox ? (primaryBox.top + primaryBox.bottom) / 2 : null
      return { center, stage, shadow, duplicates, visible, primaryCenterY }
    },
    { screen, scope: SCOPE },
  )
}

async function wordmark(page, body) {
  const result = await page.locator('.brand__word').evaluate((svg) => {
    const image = svg.querySelector('.logo-art')
    const animations = svg.getAnimations({ subtree: true })
    const animation = animations[0]
    const fixed = [svg, ...svg.querySelectorAll('path, circle')].map((node) => {
      const rect = node.getBoundingClientRect()
      return [rect.x, rect.y, rect.width, rect.height, getComputedStyle(node).opacity]
    })
    const style = getComputedStyle(image)
    return {
      body: svg.dataset.celestialBody,
      src: image.getAttribute('href'),
      count: animations.length,
      name: animation?.animationName,
      state: animation?.playState,
      at: animation?.currentTime,
      fixed,
      appearance: [style.transform, style.opacity],
    }
  })
  assert.equal(result.body, body, 'ワードマークの天体がページと一致しない')
  assert.equal(result.src, body === 'black-hole' ? BLACKHOLE_ART.src : CELESTIAL_ART[body].src)
  assert.equal(result.count, 1, 'ワードマークはOの画像だけを動かす')
  assert.equal(
    result.name,
    body === 'black-hole'
      ? 'celestial-breathe'
      : body === 'sun'
        ? 'wordmark-radiance'
        : EXPECTED[body],
  )
  assert.equal(result.state, 'running')
  return result
}

async function motion(page, body, screen) {
  const wordBefore = await wordmark(page, body)
  const before = await animations(page)
  assert.ok(
    before.some((a) => a.name === EXPECTED[body]),
    `${body}: 専用motionが無い`,
  )
  for (const animation of before) {
    assert.equal(animation.state, 'running')
    assert.ok(animation.infinite && Number.isFinite(animation.at) && animation.duration > 0)
    assert.match(
      animation.name,
      /^(celestial-(float|drift|rock|radiance|breathe|flow)|orbit-breathe)$/,
    )
    if (animation.name.startsWith('celestial-'))
      assert.ok(
        animation.duration <= 18000,
        `${animation.name}: 1周期が18秒を超え、動きが見えにくい`,
      )
    assert.ok(animation.intervals.length > 0)
    for (const interval of animation.intervals) {
      assert.match(interval.easing, /^steps\(/)
      const ticks = Number(interval.easing.match(/^steps\((\d+)/)?.[1])
      const seconds = ((interval.end - interval.offset) * animation.duration) / 1000
      assert.ok(seconds > 0)
      assert.ok(
        Math.abs(ticks - seconds * 10) <= 0.500001,
        `${animation.name}: 区間 ${seconds}s が約10Hzのstepsでない (${ticks})`,
      )
    }
    for (const property of animation.properties)
      assert.ok(
        ['offset', 'computedOffset', 'easing', 'composite', 'transform', 'opacity'].includes(
          property,
        ),
        `${property}を毎frame動かしている`,
      )
  }
  await page.waitForTimeout(350)
  const wordAfter = await wordmark(page, body)
  assert.deepEqual(wordAfter.fixed, wordBefore.fixed, 'ロゴの文字・影・レイアウトが動いた')
  assert.ok(wordAfter.at > wordBefore.at + 200, 'ロゴの時計が進まない')
  assert.notDeepEqual(wordAfter.appearance, wordBefore.appearance, 'ロゴのOが動かない')
  const after = await animations(page)
  assert.equal(after.length, before.length)
  assert.ok(
    after.some(
      (a, i) =>
        a.at > before[i].at + 200 &&
        (a.transform !== before[i].transform || a.opacity !== before[i].opacity),
    ),
    '実際の時刻/描画が進んでいない',
  )
  await page.evaluate((scope) => {
    window.__celestialAnimations = document
      .getAnimations()
      .filter(
        (a) =>
          a instanceof CSSAnimation &&
          a.effect?.target instanceof Element &&
          a.effect.target.closest(scope),
      )
    for (const animation of window.__celestialAnimations) animation.pause()
  }, SCOPE)
  const samples = []
  for (const fraction of [0, 0.25, 0.5, 0.75]) {
    await page.evaluate((fraction) => {
      for (const animation of window.__celestialAnimations) {
        const timing = animation.effect.getTiming()
        animation.currentTime = timing.duration * fraction
      }
    }, fraction)
    const sample = await geometry(page, screen)
    if (samples.length) {
      assert.deepEqual(sample.center, samples[0].center, 'stageの中心が動いた')
      assert.deepEqual(sample.shadow, samples[0].shadow, '黒い影が動いた')
      assert.deepEqual(sample.duplicates, samples[0].duplicates, 'maskの枠が動いた')
    }
    samples.push(sample)
  }
  const primaryCenterYs = samples
    .map((sample) => sample.primaryCenterY)
    .filter((value) => Number.isFinite(value))
  const verticalTravelPx = primaryCenterYs.length
    ? Math.max(...primaryCenterYs) - Math.min(...primaryCenterYs)
    : null
  if (screen.key === 'profile' && ['moon', 'neptune', 'saturn'].includes(body))
    assert.ok(
      verticalTravelPx >= 5,
      `${body}: Profileの上下移動が${verticalTravelPx}pxしかなく、5pxに届かない`,
    )
  const paused = await animations(page)
  await page.waitForTimeout(250)
  assert.deepEqual(await animations(page), paused, 'pause後に天体が動いた')
  await page.evaluate(() => {
    for (const animation of window.__celestialAnimations) animation.play()
  })
  return {
    names: [...new Set(before.map((a) => a.name))],
    animations: before.length,
    timings: before.map(({ name, duration, intervals }) => ({ name, duration, intervals })),
    samples: samples.length,
    primaryCenterYs,
    verticalTravelPx,
    paused: true,
    wordmark: { body, animation: wordAfter.name, fixedLetters: true },
  }
}

async function stopped(page, mode) {
  await page.emulateMedia(mode)
  assert.equal((await animations(page)).length, 0, '停止設定でも天体が動く')
  assert.equal(
    await page
      .locator('.brand__word')
      .evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    0,
    '停止設定でもロゴが動く',
  )
  if (mode.forcedColors === 'active') {
    const fallback = await page.locator('.brand__word .logo-core').evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      stroke: getComputedStyle(node).stroke,
    }))
    assert.ok(fallback.width > 0 && fallback.stroke !== 'none', '強制色でOが読めない')
  }
  if (mode.reducedMotion === 'reduce') {
    assert.equal(
      await page.evaluate(() => document.getAnimations().length),
      0,
      'reduceで動きが残る',
    )
  } else {
    assert.equal(
      await page.locator(SCOPE).evaluateAll((nodes) =>
        nodes.some((node) => {
          const box = node.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        }),
      ),
      false,
      '印刷/強制色で天体が残る',
    )
  }
  assert.equal(
    await page.locator('.blackhole-flow, .celestial__corona').evaluateAll(
      (nodes, reduced) =>
        nodes.some((node) => {
          if (reduced) return getComputedStyle(node).display !== 'none'
          const box = node.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        }),
      mode.reducedMotion === 'reduce',
    ),
    false,
    '追加layerが残る',
  )
  assert.ok((await page.locator('main h1').textContent()).trim(), '本文が消えた')
}

async function contextFor(browser, base, token, viewport, options = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'no-preference',
    ...options,
  })
  await context.addCookies([
    { name: 'astlog_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' },
  ])
  return context
}

async function checkCell(browser, base, token, body, screen, view) {
  const context = await contextFor(browser, base, token, view)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const response = await page.goto(base + screen.path, { waitUntil: 'load' })
    assert.equal(response.status(), 200)
    const scriptPolicy =
      response.headers()['content-security-policy'].match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1] ??
      ''
    assert.match(scriptPolicy, /^'sha256-[^']+'$/)
    await ready(page)
    if (screen.key !== 'profile') {
      // All five bodies share one image-motion layout. The wordmark still
      // animates independently, while the hidden orbit drawing does not.
      const brand = await wordmark(page, body)
      const art = page.locator('.astra-art')
      assert.ok(await art.isVisible(), 'Astra の表紙画像が見えない')
      await assertCoverMotion(page, `${body}/${screen.key}/${view.key}`)
      assert.equal(
        await art.getAttribute('src'),
        body === 'black-hole' && screen.key === 'contact'
          ? ASTRA_CONTACT_ART
          : ASTRA_COVER_ART[body],
        'ページと天体の表紙画像が一致しない',
      )
      assert.equal((await animations(page)).length, 0, '隠した軌道に motion が残る')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
      assert.equal(await page.locator('.astra-infall:visible').count(), 0)
      await page.emulateMedia({ reducedMotion: 'no-preference', media: 'print' })
      assert.equal(await art.isVisible(), false, '印刷で表紙画像が残る')
      assert.equal(await page.locator('.astra-infall:visible').count(), 0)
      await page.emulateMedia({ media: 'screen', forcedColors: 'active' })
      assert.equal(await art.isVisible(), false, '強制色で表紙画像が残る')
      assert.equal(await page.locator('.astra-infall:visible').count(), 0)
      assert.deepEqual(errors, [])
      const fallback = await contextFor(browser, base, token, view, {
        javaScriptEnabled: false,
      })
      try {
        const next = await fallback.newPage()
        await next.goto(base + screen.path, { waitUntil: 'load' })
        await ready(next)
        assert.ok(await next.locator('.astra-art').isVisible(), 'JS 無効で表紙画像が消える')
        await assertCoverMotion(next, `${body}/${screen.key}/${view.key}/JS無効`)
        assert.ok((await next.locator('main h1').textContent()).trim())
      } finally {
        await fallback.close()
      }
      return {
        body,
        screen: screen.key,
        viewport: view.key,
        names: ['astra-static-cover'],
        wordmark: brand,
        print: true,
        forcedColors: true,
        javaScriptDisabled: true,
      }
    }
    const result = await motion(page, body, screen)
    await stopped(page, { reducedMotion: 'reduce' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await stopped(page, { media: 'print' })
    await page.emulateMedia({ media: 'screen' })
    await stopped(page, { forcedColors: 'active' })
    assert.deepEqual(errors, [])
    for (const option of [{ reducedMotion: 'reduce' }, { javaScriptEnabled: false }]) {
      const fallback = await contextFor(browser, base, token, view, option)
      try {
        const next = await fallback.newPage()
        await next.goto(base + screen.path, { waitUntil: 'load' })
        await ready(next)
        if (option.reducedMotion) await stopped(next, { reducedMotion: 'reduce' })
        else await motion(next, body, screen)
        assert.equal(await next.locator('html').getAttribute('data-motion-staged'), null)
      } finally {
        await fallback.close()
      }
    }
    return {
      body,
      screen: screen.key,
      viewport: view.key,
      ...result,
      reducedInitial: true,
      reducedToggle: true,
      print: true,
      forcedColors: true,
      javaScriptDisabled: true,
    }
  } finally {
    await context.close()
  }
}

async function previews(browser, base, token, files) {
  // 通常のダイアログは check-admin が測る。ここでは JS 無効時の標準フォームを測る。
  const context = await contextFor(browser, base, token, VIEWS[0], { javaScriptEnabled: false })
  try {
    const editor = await context.newPage()
    const response = await editor.goto(`${base}/admin/members/1/edit`, { waitUntil: 'load' })
    assert.equal(response.status(), 200)
    const before = fingerprint(files)
    const traceBefore = traceCounts(files)
    const editorUrl = editor.url()
    const original = await editor
      .locator('form.form')
      .evaluate((form) =>
        [...new FormData(form)]
          .filter(([key]) => key !== 'celestialBody')
          .map(([key, value]) => [
            key,
            typeof value === 'string' ? value : `file:${value.name}:${value.size}`,
          ]),
      )
    for (const body of CELESTIAL_BODY_KEYS) {
      await editor.locator(`[name="celestialBody"][value="${body}"]`).check({ force: true })
      const popup = context.waitForEvent('page')
      const posted = context.waitForEvent('response', {
        predicate: (reply) =>
          reply.request().method() === 'POST' &&
          new URL(reply.url()).pathname === '/admin/preview/members/1',
      })
      await editor.getByRole('button', { name: '保存前にプレビュー', exact: true }).click()
      const page = await popup
      try {
        const response = await posted
        assert.equal(response.status(), 200)
        assert.match(response.headers()['content-security-policy'], /script-src 'none'/)
        assert.equal(response.headers()['cache-control'], 'private, no-store')
        await ready(page)
        assert.equal(await page.locator('script').count(), 0)
        assert.equal(
          await page.locator('.celestial--art').getAttribute('data-celestial-body'),
          body,
        )
        for (const view of VIEWS) {
          await page.setViewportSize({ width: view.width, height: view.height })
          const result = await motion(page, body, { key: 'preview' })
          report.previews.push({
            body,
            viewport: view.key,
            status: 200,
            scriptNone: true,
            ...result,
          })
        }
        assert.equal(editor.url(), editorUrl)
        assert.equal(await editor.locator('[name="celestialBody"]:checked').inputValue(), body)
        assert.deepEqual(
          await editor
            .locator('form.form')
            .evaluate((form) =>
              [...new FormData(form)]
                .filter(([key]) => key !== 'celestialBody')
                .map(([key, value]) => [
                  key,
                  typeof value === 'string' ? value : `file:${value.name}:${value.size}`,
                ]),
            ),
          original,
        )
        assert.deepEqual(fingerprint(files), before, `${body}: native previewがD1/KVへ書いた`)
      } finally {
        await page.close()
      }
    }
    report.privateNonpersistent = {
      before,
      after: fingerprint(files),
      unchanged: true,
      observability: {
        recognizedBy:
          'Miniflare observability/miniflare-wobs-trace-store path and logs/spans schema',
        before: traceBefore,
        after: traceCounts(files),
        traceOnlyChanges: true,
      },
    }
  } finally {
    await context.close()
  }
}

async function performance(browser, base, token, body) {
  const context = await contextFor(browser, base, token, VIEWS[0])
  try {
    const page = await context.newPage()
    await page.goto(`${base}/members/okazaki`, { waitUntil: 'load' })
    await ready(page)
    const client = await context.newCDPSession(page)
    const capture = async (state) => {
      const events = []
      const add = ({ value }) => events.push(...value)
      client.on('Tracing.dataCollected', add)
      await client.send('Tracing.start', {
        categories: 'devtools.timeline',
        transferMode: 'ReportEvents',
      })
      await page.waitForTimeout(800)
      const done = new Promise((resolve) => client.once('Tracing.tracingComplete', resolve))
      await client.send('Tracing.end')
      await done
      client.off('Tracing.dataCollected', add)
      return {
        body,
        state,
        paints: events.filter((event) => event.name === 'Paint').length,
        layouts: events.filter((event) => event.name === 'Layout').length,
        durationMs: 800,
      }
    }
    await page.waitForTimeout(2200)
    report.performance.push(await capture('visible'))
    await page.locator('#career').scrollIntoViewIfNeeded()
    const offscreen = await page
      .locator('.celestial--art')
      .evaluate((node) => node.getBoundingClientRect().bottom <= 0)
    if (offscreen) {
      await page.waitForTimeout(200)
      report.performance.push(await capture('offscreen'))
    } else
      report.performance.push({
        body,
        state: 'offscreen',
        measured: false,
        reason: 'ページ末尾でも天体がviewportに残った',
      })
    const other = await context.newPage()
    await other.goto('about:blank')
    await other.bringToFront()
    const hidden = await page.evaluate(() => document.visibilityState === 'hidden')
    if (hidden) report.performance.push(await capture('hidden-tab'))
    else
      report.performance.push({
        body,
        state: 'hidden-tab',
        measured: false,
        reason: 'headless browserがdocument.visibilityState=visibleのまま。非表示tab停止は未確認',
      })
    await client.detach()
    // Paint counts are observations, not an FPS/compositor guarantee. Inspect root-frame attribution if nonzero.
    report.performanceLimit =
      '短時間Chromium trace。全ブラウザ/実機FPS/paint対象のpixel面積は保証しない。'
  } finally {
    await context.close()
  }
}

async function main() {
  let state
  let server
  let browser
  let db
  const output = process.env.CELESTIAL_MOTION_OUTPUT ?? join(ROOT, 'dist', 'celestial-motion')
  try {
    assert.ok(
      !process.env.CELESTIAL_MOTION_BASE,
      '使い捨てD1を更新する検査なので既存serverは指定しない',
    )
    const token = randomBytes(32).toString('hex')
    const fixture = `INSERT INTO users (id,role) VALUES (9001,'owner');
INSERT INTO sessions (id,user_id,expires_at) VALUES (${quote(hash(token))},9001,${quote(new Date(Date.now() + 7200000).toISOString())});
INSERT INTO user_identities (user_id,provider,subject,label) VALUES (9001,'github','celestial-motion-fixture','隔離検査用');`
    state = await scratchState('celestial-motion', [
      await readFile(join(ROOT, 'seed.sql'), 'utf8'),
      fixture,
    ])
    const files = await sqliteFiles(state.dir)
    const d1 = files.filter((file) => {
      const candidate = new DatabaseSync(file, { readOnly: true })
      try {
        if (
          !candidate
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='members'")
            .get()
        )
          return false
        return (
          candidate.prepare("SELECT id FROM members WHERE id=1 AND slug='okazaki'").get() !==
          undefined
        )
      } finally {
        candidate.close()
      }
    })
    assert.equal(d1.length, 1, 'seedのメンバーを持つ隔離D1が1つでない')
    db = new DatabaseSync(d1[0])
    db.exec('PRAGMA busy_timeout=5000')
    server = await devServer(
      undefined,
      Number(process.env.CELESTIAL_MOTION_PORT ?? 8920),
      state.dir,
    )
    browser = await chromium.launch({ headless: true })
    for (const body of CELESTIAL_BODY_KEYS) {
      db.prepare('UPDATE members SET celestial_body=?, celestial_accent=? WHERE id=1').run(
        body,
        'mint',
      )
      for (const view of VIEWS)
        for (const screen of SCREENS) {
          const label = `${body}/${screen.key}/${view.key}`
          try {
            report.cells.push(await checkCell(browser, server.base, token, body, screen, view))
          } catch (error) {
            report.failures.push({ cell: label, reason: error.message })
            console.error(`✗ ${label}: ${error.message}`)
          }
        }
      console.log(`  ${body}: PC/phone × profile/hero/contact`)
    }
    try {
      await previews(browser, server.base, token, await sqliteFiles(state.dir))
    } catch (error) {
      report.failures.push({ cell: 'private-native-preview', reason: error.message })
    }
    for (const body of ['black-hole', 'sun']) {
      db.prepare('UPDATE members SET celestial_body=? WHERE id=1').run(body)
      try {
        await performance(browser, server.base, token, body)
      } catch (error) {
        report.performance.push({ body, measured: false, reason: error.message })
      }
    }
  } catch (error) {
    report.failures.push({ cell: 'setup', reason: error.message })
  } finally {
    await browser?.close()
    await server?.stop()
    db?.close()
    await state?.cleanup()
    report.finishedAt = new Date().toISOString()
    report.cleanedUp = true
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(
    `${report.failures.length ? '✗' : '✓'} 天体motion: ${report.cells.length}/30公開、${report.previews.length}/10非保存preview、${report.failures.length}失敗`,
  )
  if (report.failures.length) process.exitCode = 1
}

await main()
