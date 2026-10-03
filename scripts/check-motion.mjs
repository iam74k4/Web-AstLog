/*
  CSS の動作を実 CSP のままブラウザで測る。npm run check:motion。
  初期化は12秒以内に終わり、奥/手前と回転/打ち消しは同じ時計を使う。
  JS 無効・reduced-motion・紙でも本文を読み、リンクをたどれる。
  FPS は実機の検査に任せる。ここでは開始漏れ・時計のずれ・CSP の緩みを止める。

  既定は使い捨て D1 に seed を入れる。MOTION_BASE=http://localhost:8790 なら既存の
  ローカル dev を読むだけ。Playwright の evaluate は観測用で、CSP を外さない。
*/
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'

const SCREENS = [
  { name: '入口', path: '/', diagram: '.system' },
  { name: 'Contact', path: '/contact', diagram: '.orbits' },
]
const GRAPH = '.system, .orbits, .cosmos'
const TARGETS = [
  '.stardust .orbit-spin',
  '.orbit-bodies :is(.orbit-spin, .orbit-unspin, .orbit-body)',
  '.hole__art',
  '.cosmos__nebula',
  '.orbit-flow',
  '.orbit-flow__tail',
  '.cosmos__twinkle',
  '.cosmos__meteor',
  '.orbit-grain__dot',
].join(',')
const OPTIONS = { viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' }

const perpetualCount = () =>
  document.getAnimations().filter((animation) => {
    const target = animation.effect?.target
    return (
      animation instanceof CSSAnimation &&
      animation.effect.getTiming().iterations === Infinity &&
      target instanceof Element &&
      target.closest('.system, .orbits, .cosmos')
    )
  }).length

async function open(browser, base, screen, options = {}) {
  const page = await browser.newPage({ ...OPTIONS, ...options })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const response = await page.goto(base + screen.path, { waitUntil: 'load' })
  assert.equal(response?.status(), 200, `${screen.name}: HTTP 200 でない`)
  const policy = response.headers()['content-security-policy']
  const scriptPolicy = policy?.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1]
  assert.match(scriptPolicy ?? '', /'sha256-[^']+'/, `${screen.name}: CSP に helper の許可がない`)
  assert.ok(
    !scriptPolicy.includes("'unsafe-inline'"),
    `${screen.name}: 任意の inline JS を許可している`,
  )
  return { page, errors }
}

async function readable(page, screen) {
  await page.waitForFunction(
    () => {
      const heading = document.querySelector('main h1')
      return heading && Number(getComputedStyle(heading).opacity) >= 0.95
    },
    undefined,
    { timeout: 6_000 },
  )
  const content = await page.evaluate((diagram) => {
    const main = document.querySelector('main')
    const headings = main?.querySelectorAll('h1') ?? []
    const art = document.querySelector(diagram)
    const box = art?.getBoundingClientRect()
    return {
      headings: headings.length,
      heading: headings[0]?.textContent.trim(),
      links: [...(main?.querySelectorAll('a[href]') ?? [])].map((link) => [
        link.getAttribute('href'),
        link.textContent.trim(),
      ]),
      art: Boolean(
        box && box.width > 0 && box.height > 0 && getComputedStyle(art).display !== 'none',
      ),
    }
  }, screen.diagram)
  assert.equal(content.headings, 1, `${screen.name}: 本文の h1 が1つでない`)
  assert.ok(content.heading && content.links.length > 0, `${screen.name}: 内容/リンクがない`)
  assert.ok(content.art, `${screen.name}: 軌道図の枠が見えない`)
  return { heading: content.heading, links: content.links }
}

async function pairs(page) {
  return page.evaluate(() => {
    const need = (condition, reason) => {
      if (!condition) throw new Error(reason)
    }
    const animations = (element) =>
      element
        .getAnimations()
        .filter((animation) => animation.effect.getTiming().iterations === Infinity)
    const compare = (first, second, label) => {
      const a = animations(first)[0]
      const b = animations(second)[0]
      need(a && b, `${label}: animation がない`)
      need(a.startTime === b.startTime && a.currentTime === b.currentTime, `${label}: 時計が違う`)
      need(a.effect.getTiming().duration === b.effect.getTiming().duration, `${label}: 周期が違う`)
    }
    let checked = 0
    for (const selector of ['.orbit-flows', '.stardust', '.orbit-bodies']) {
      const layers = [...document.querySelectorAll(selector)]
      need(layers.length === 2, `${selector}: 奥/手前の2層でない`)
      const child = selector === '.orbit-flows' ? '.orbit-flow' : '.orbit-spin'
      const far = [...layers[0].querySelectorAll(child)]
      const near = [...layers[1].querySelectorAll(child)]
      need(far.length > 0 && far.length === near.length, `${selector}: 奥/手前の要素数が違う`)
      far.forEach((element, index) => {
        compare(element, near[index], `${selector} ${index}`)
        need(
          getComputedStyle(element).transform === getComputedStyle(near[index]).transform,
          `${selector} ${index}: 奥/手前の位置が違う`,
        )
        checked += 1
        if (selector === '.orbit-flows') {
          const tail = element.querySelector('.orbit-flow__tail')
          const other = near[index].querySelector('.orbit-flow__tail')
          need(tail && other, 'Flow: 尾がない')
          compare(element, tail, 'Flow: 星/尾')
          compare(tail, other, 'Flow: 奥/手前の尾')
          need(
            getComputedStyle(tail).transform === getComputedStyle(other).transform,
            'Flow: 奥/手前の尾の姿勢が違う',
          )
        }
      })
    }
    for (const unspin of document.querySelectorAll('.orbit-bodies .orbit-unspin')) {
      const spin = unspin.closest('.orbit-spin')
      need(spin, '天体: 回転の親がない')
      compare(spin, unspin, '天体: 回転/打ち消し')
      const product = new DOMMatrix(getComputedStyle(spin).transform).multiply(
        new DOMMatrix(getComputedStyle(unspin).transform),
      )
      need(
        Math.abs(product.a - 1) < 0.00002 &&
          Math.abs(product.d - 1) < 0.00002 &&
          Math.abs(product.b) < 0.00002 &&
          Math.abs(product.c) < 0.00002,
        '天体: 回転が打ち消されていない',
      )
      checked += 1
    }
    return checked
  })
}

async function blockedInline(page, name) {
  await page.evaluate(() => {
    window.__motionCsp = []
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.blockedURI === 'inline' && event.effectiveDirective.startsWith('script-src')) {
        window.__motionCsp.push(event.effectiveDirective)
      }
    })
  })
  try {
    await page.addScriptTag({
      content: "document.documentElement.setAttribute('data-motion-probe-executed','')",
    })
  } catch {
    // 任意の inline script は実 CSP に止められる。これは検査の期待したエラー。
  }
  await page.waitForFunction(() => window.__motionCsp.length > 0, undefined, { timeout: 2_000 })
  assert.equal(
    await page.locator('html').getAttribute('data-motion-probe-executed'),
    null,
    `${name}: 無許可 inline JS が実行された`,
  )
}

async function normal(browser, base, screen) {
  const { page, errors } = await open(browser, base, screen)
  try {
    assert.notEqual(
      await page.locator('html').getAttribute('data-motion-staged'),
      null,
      `${screen.name}: helper が開始していない`,
    )
    await page.waitForFunction(
      (targets) => {
        const nodes = [...document.querySelectorAll(targets)]
        const ready = nodes.filter((node) => node.hasAttribute('data-motion-ready'))
        if (ready.length > 0) {
          const count = document.getAnimations().filter((animation) => {
            const target = animation.effect?.target
            return (
              animation instanceof CSSAnimation &&
              animation.effect.getTiming().iterations === Infinity &&
              target instanceof Element &&
              target.closest('.system, .orbits, .cosmos')
            )
          }).length
          if (count === 0) throw new Error('開始した後に継続 animation が全て消えた')
        }
        return nodes.length > 0 && ready.length === nodes.length
      },
      TARGETS,
      { timeout: 12_000, polling: 100 },
    )
    const content = await readable(page, screen)
    const animations = await page.evaluate(perpetualCount)
    assert.ok(animations > 0, `${screen.name}: 図の継続 animation がない`)
    const clock = await page.evaluate((targets) => {
      const nodes = [...document.querySelectorAll(targets)]
      const starts = []
      for (const node of nodes) {
        const animations = node
          .getAnimations()
          .filter(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.effect.getTiming().iterations === Infinity,
          )
        if (!animations.length)
          throw new Error(`${node.className.baseVal ?? node.className}: 開始済みの動きがない`)
        starts.push(...animations.map((animation) => animation.startTime))
      }
      if (starts.some((start) => !Number.isFinite(start) || start !== starts[0]))
        throw new Error('継続 animation の startTime がそろっていない')
      return { start: starts[0], count: starts.length, ready: nodes.length }
    }, TARGETS)
    const paired = await pairs(page)
    await page.evaluate(() => {
      window.__motionSnapshot = new Map(
        document
          .getAnimations()
          .filter((animation) => animation.effect.getTiming().iterations === Infinity)
          .map((animation) => [
            animation,
            { start: animation.startTime, at: animation.currentTime },
          ]),
      )
      window.__motionReadyChanges = 0
      window.__motionObserver = new MutationObserver((records) => {
        window.__motionReadyChanges += records.length
      })
      window.__motionObserver.observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-motion-ready', 'data-motion-staged'],
      })
      window.__motionAt = document.timeline.currentTime
    })
    await page.waitForTimeout(2_000)
    await page.evaluate(() => {
      window.__motionObserver.disconnect()
      if (window.__motionReadyChanges !== 0)
        throw new Error('完了後も ready 属性を更新し続けている')
      const current = document
        .getAnimations()
        .filter((animation) => animation.effect.getTiming().iterations === Infinity)
      if (current.length !== window.__motionSnapshot.size)
        throw new Error('完了後に animation 数が変わった')
      const elapsed = document.timeline.currentTime - window.__motionAt
      for (const animation of current) {
        const old = window.__motionSnapshot.get(animation)
        if (!old || old.start !== animation.startTime)
          throw new Error('完了後に animation が再作成された/時計が変わった')
        if (Math.abs(animation.currentTime - old.at - elapsed) > 1)
          throw new Error('完了後に animation の時計が進んでいない')
      }
    })
    assert.deepEqual(errors, [], `${screen.name}: helper の実行時エラー`)
    await blockedInline(page, screen.name)
    console.log(
      `  ${screen.name}: ${clock.ready}要素/${clock.count}動作が共通時計、${paired}対が一致。CSP と完了後の継続を確認`,
    )
    return content
  } finally {
    await page.close()
  }
}

async function fallback(browser, base, screen, content, reduced) {
  const { page, errors } = await open(
    browser,
    base,
    screen,
    reduced ? { reducedMotion: 'reduce' } : { javaScriptEnabled: false },
  )
  const name = reduced ? 'reduced-motion' : 'JS 無効'
  try {
    assert.deepEqual(
      await readable(page, screen),
      content,
      `${screen.name}/${name}: 内容とリンクが変わった`,
    )
    assert.equal(
      await page.locator('html').getAttribute('data-motion-staged'),
      null,
      `${screen.name}/${name}: 動きを抑止する印が残った`,
    )
    const moving = await page.evaluate(perpetualCount)
    if (reduced)
      assert.equal(
        await page.evaluate(() => document.getAnimations().length),
        0,
        `${screen.name}: reduced-motion で動いている`,
      )
    else {
      assert.ok(moving > 0, `${screen.name}: JS 無効で CSS の動きが消えた`)
      const inactive = await page
        .locator(TARGETS)
        .evaluateAll((nodes) =>
          nodes
            .filter(
              (node) =>
                !node
                  .getAnimations()
                  .some(
                    (animation) =>
                      animation instanceof CSSAnimation &&
                      animation.effect.getTiming().iterations === Infinity,
                  ),
            )
            .map((node) => String(node.className.baseVal ?? node.className)),
        )
      assert.deepEqual(inactive, [], `${screen.name}: JS 無効で開始していない装飾がある`)
      await pairs(page)
    }
    await page.emulateMedia({ media: 'print' })
    assert.equal(
      await page
        .locator(GRAPH)
        .evaluateAll((nodes) =>
          nodes.some(
            (node) =>
              node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
          ),
        ),
      false,
      `${screen.name}: 印刷で装飾図が見える`,
    )
    assert.equal(
      (await page.locator('main h1').textContent()).trim(),
      content.heading,
      `${screen.name}: 印刷で見出しが変わった`,
    )
    assert.deepEqual(errors, [], `${screen.name}/${name}: 実行時エラー`)
    console.log(`  ${screen.name}/${name}: 本文・リンク・図枠と印刷を確認`)
  } finally {
    await page.close()
  }
}

async function main() {
  const given = process.env.MOTION_BASE
  if (given)
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(given).hostname),
      'MOTION_BASE はローカル dev の URL を指定する',
    )
  let state
  let server
  let browser
  try {
    if (!given) state = await scratchState('motion', [await readFile(`${ROOT}seed.sql`, 'utf8')])
    server = await devServer(given, Number(process.env.MOTION_PORT ?? 8794), state?.dir)
    browser = await chromium.launch({ headless: true })
    for (const screen of SCREENS) {
      const content = await normal(browser, server.base, screen)
      await fallback(browser, server.base, screen, content, false)
      await fallback(browser, server.base, screen, content, true)
    }
    console.log('✓ 入口/Contact の開始・共通時計・CSP・フォールバック')
  } finally {
    await browser?.close()
    await server?.stop()
    await state?.cleanup()
  }
}

await main()
