/*
  CSS の動作を実 CSP のままブラウザで測る。npm run check:motion。
  初期化は12秒以内に終わり、同期が必要な群（奥/手前・星屑/天体・回転/打ち消し）は同じ時計を使う。
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
// Blink の snap と ms/seconds の double 往復で変わり得る端数だけを吸収する。1nsで、ms差は許さない。
const CLOCK_EPSILON = 1e-6

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

const animationStartState = (nodes) => {
  const animations = nodes.flatMap((node) =>
    node
      .getAnimations()
      .filter(
        (animation) =>
          animation instanceof CSSAnimation && animation.effect.getTiming().iterations === Infinity,
      )
      .map((animation) => ({
        target: String(node.className.baseVal ?? node.className),
        name: animation.animationName,
        state: animation.playState,
        pending: animation.pending,
        start: animation.startTime,
        current: animation.currentTime,
        rate: animation.playbackRate,
      })),
  )
  const unready = animations.filter(
    (animation) =>
      animation.pending ||
      animation.state !== 'running' ||
      animation.rate !== 1 ||
      !Number.isFinite(animation.start) ||
      !Number.isFinite(animation.current),
  )
  return {
    visibility: document.visibilityState,
    readyState: document.readyState,
    fonts: document.fonts.status,
    timeline: document.timeline.currentTime,
    targets: nodes.length,
    animations: animations.length,
    unready: unready.length,
    sample: unready.slice(0, 16),
  }
}

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

async function pairs(page, exactClock = true) {
  return page.evaluate(
    ({ exactClock, clockEpsilon }) => {
      const need = (condition, reason) => {
        if (!condition) throw new Error(reason)
      }
      const animations = (element) =>
        element
          .getAnimations()
          .filter(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.effect.getTiming().iterations === Infinity,
          )
      /*
      通常の群内の共通時計は motion.ts が保証する（CLAUDE.md「JavaScript とリンク」）。JS 無効時は
      通常の CSS 動作へ戻る。CSS Animations §2 は、style と keyframes が共に解決された時点で
      開始すると定め、別の DOM 要素へ同じ開始時刻を保証しない。
      https://www.w3.org/TR/css-animations-1/#animations

      fallback は自然の開始差を記録して周期・delay・easing を検査する。幾何だけは検査ページで
      3つの共通時刻へ送る。製品の同期補助ではない。最後に元の時計と playing 状態へ戻す。
    */
      const saved = exactClock
        ? []
        : document
            .getAnimations()
            .filter((animation) => {
              const target = animation.effect?.target
              return (
                animation instanceof CSSAnimation &&
                animation.effect.getTiming().iterations === Infinity &&
                target instanceof Element &&
                target.closest('.system, .orbits, .cosmos')
              )
            })
            .map((animation) => ({
              animation,
              startTime: animation.startTime,
              currentTime: animation.currentTime,
              playState: animation.playState,
            }))
      const natural = new Map(saved.map((entry) => [entry.animation, entry]))
      let maxStartSkew = 0
      const compare = (first, second, label) => {
        const a = animations(first)[0]
        const b = animations(second)[0]
        need(a && b, `${label}: animation がない`)
        if (exactClock)
          need(
            Number.isFinite(a.startTime) &&
              Number.isFinite(b.startTime) &&
              Number.isFinite(a.currentTime) &&
              Number.isFinite(b.currentTime) &&
              Math.abs(a.startTime - b.startTime) <= clockEpsilon &&
              Math.abs(a.currentTime - b.currentTime) <= clockEpsilon,
            `${label}: 時計が違う（start ${a.startTime}/${b.startTime}, current ${a.currentTime}/${b.currentTime}）`,
          )
        else
          maxStartSkew = Math.max(
            maxStartSkew,
            Math.abs(natural.get(a).startTime - natural.get(b).startTime),
          )
        const one = a.effect.getTiming()
        const two = b.effect.getTiming()
        for (const name of [
          'duration',
          'delay',
          'endDelay',
          'easing',
          'iterations',
          'iterationStart',
          'direction',
          'fill',
        ])
          need(one[name] === two[name], `${label}: ${name} が違う`)
        const intervals = (animation) =>
          JSON.stringify(
            animation.effect.getKeyframes().map(({ offset, easing }) => [offset, easing]),
          )
        need(intervals(a) === intervals(b), `${label}: keyframe の区間/easing が違う`)
      }
      let checked = 0
      try {
        for (const at of exactClock ? [null] : [0, 4275, 15325]) {
          if (at !== null)
            for (const { animation } of saved) {
              animation.pause()
              animation.currentTime = at
            }
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
        }
        return exactClock ? checked : { checked, maxStartSkew }
      } finally {
        for (const { animation, startTime, currentTime, playState } of saved) {
          if (playState === 'running') {
            animation.play()
            animation.startTime = startTime
          } else {
            animation.currentTime = currentTime
          }
        }
      }
    },
    { exactClock, clockEpsilon: CLOCK_EPSILON },
  )
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

// Observe the actual handoff, before the next paint can hide a seek or an opacity jump.
// A held image must not prevent DOM-ready ornaments from starting.
async function initialDisplay(browser, base, screen, phone = false, slowImage = false) {
  const page = await browser.newPage({
    ...OPTIONS,
    ...(phone ? { viewport: { width: 390, height: 844 } } : {}),
  })
  const name = `${screen.name}/${phone ? 'phone' : 'PC'}${slowImage ? '/画像待機' : ''}`
  let releaseImage
  const held = new Promise((resolve) => {
    releaseImage = resolve
  })
  if (slowImage)
    await page.route('**/assets/blackhole.webp*', async (route) => {
      await held
      await route.continue()
    })
  try {
    await page.addInitScript(() => {
      const report = {
        checked: 0,
        expected: 0,
        domReady: 0,
        firstReady: 0,
        firstStarReady: 0,
        loaded: false,
        failures: [],
      }
      window.__initialMotion = report
      addEventListener('load', () => {
        report.loaded = true
      })
      addEventListener(
        'DOMContentLoaded',
        async () => {
          report.domReady = performance.now()
          // DOMContentLoaded は外部CSSの到着を待たない。装飾が描かれる初回の姿を測る。
          await Promise.all(
            [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
              link.sheet
                ? Promise.resolve()
                : new Promise((resolve) => link.addEventListener('load', resolve, { once: true })),
            ),
          )
          const before = new Map()
          const state = (node) => {
            const css = getComputedStyle(node)
            const box = node.getBoundingClientRect()
            const matrix = new DOMMatrix(css.transform)
            return [
              box.x,
              box.y,
              box.width,
              box.height,
              Number(css.opacity),
              css.scale === 'none' ? 1 : Number(css.scale),
              ...matrix.toFloat64Array(),
            ]
          }
          const selector =
            '.stardust .orbit-spin, .orbit-bodies :is(.orbit-spin, .orbit-unspin, .orbit-body), .hole__art, .cosmos__nebula, .cosmos__twinkle, .brand__word .logo-art'
          for (const node of document.querySelectorAll(selector)) {
            before.set(node, state(node))
            if (
              !node.getAnimations().length ||
              node.getAnimations().some((a) => a.playState !== 'paused')
            )
              report.failures.push('初期フレームで待機していない')
          }
          report.expected = before.size
          const observer = new MutationObserver((records) => {
            for (const { target } of records) {
              const previous = before.get(target)
              if (!previous) continue
              before.delete(target)
              const current = state(target)
              const delta = Math.max(...current.map((value, i) => Math.abs(value - previous[i])))
              if (delta > 0.001)
                report.failures.push(`${target.getAttribute('class')}: 開始時の段差 ${delta}`)
              if (target.getAnimations().some((a) => Math.abs(a.currentTime) > 0.001))
                report.failures.push('開始時にアニメーションの途中へ送った')
              report.checked += 1
              report.firstReady ||= performance.now()
              if (target.matches('.cosmos__twinkle')) report.firstStarReady ||= performance.now()
            }
            if (!before.size) observer.disconnect()
          })
          observer.observe(document, {
            subtree: true,
            attributes: true,
            attributeFilter: ['data-motion-ready'],
          })
        },
        { once: true },
      )
    })
    await page.goto(base + screen.path, { waitUntil: 'domcontentloaded' })
    // Trigger headless rendering without changing animations or their clocks.
    await page.screenshot({ animations: 'allow' })
    await page.waitForFunction(() => window.__initialMotion.firstReady > 0, undefined, {
      timeout: 5_000,
      polling: 100,
    })
    if (slowImage)
      assert.equal(
        await page.evaluate(() => window.__initialMotion.loaded),
        false,
        `${name}: load前に始まらない`,
      )
    releaseImage()
    await page.waitForFunction(
      () => {
        const report = window.__initialMotion
        return report.expected > 0 && report.checked === report.expected
      },
      undefined,
      { timeout: 12_000, polling: 100 },
    )
    const report = await page.evaluate(() => window.__initialMotion)
    assert.deepEqual(report.failures, [], `${name}: 初期表示から動作への切り替え`)
    assert.ok(
      report.firstReady - report.domReady < 800,
      `${name}: 装飾の開始が初回描画から遅い (${Math.round(report.firstReady - report.domReady)}ms)`,
    )
    assert.ok(
      report.firstStarReady - report.domReady < 800,
      `${name}: heroの星の開始が初回描画から遅い (${Math.round(report.firstStarReady - report.domReady)}ms)`,
    )
    console.log(`  ${name}: ${report.checked}要素の開始フレームに位置・明るさの段差なし`)
  } finally {
    releaseImage()
    await page.close()
  }
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
    const clock = await page.evaluate(
      ({ targets, clockEpsilon }) => {
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
        if (starts.some((start) => !Number.isFinite(start)))
          throw new Error('継続 animation の startTime が無効')
        // 独立した群を過去の時計へ送らない。同期の必要な公転は星屑と天体を一緒に測る。
        for (const selector of [
          '.stardust .orbit-spin, .orbit-bodies :is(.orbit-spin, .orbit-unspin, .orbit-body)',
          '.hole__art',
          '.cosmos__nebula',
          '.cosmos__twinkle',
          '.cosmos__meteor',
          '.orbit-grain__dot',
        ]) {
          const times = [...document.querySelectorAll(selector)].flatMap((node) =>
            node.getAnimations().map((animation) => animation.startTime),
          )
          if (times.some((start) => Math.abs(start - times[0]) > clockEpsilon))
            throw new Error(`${selector}: 群内の時計がずれている`)
        }
        return { count: starts.length, ready: nodes.length }
      },
      { targets: TARGETS, clockEpsilon: CLOCK_EPSILON },
    )
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
    await page.evaluate((clockEpsilon) => {
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
        if (
          !old ||
          !Number.isFinite(old.start) ||
          !Number.isFinite(animation.startTime) ||
          Math.abs(old.start - animation.startTime) > clockEpsilon
        )
          throw new Error('完了後に animation が再作成された/時計が変わった')
        if (
          !Number.isFinite(old.at) ||
          !Number.isFinite(animation.currentTime) ||
          !Number.isFinite(elapsed) ||
          Math.abs(animation.currentTime - old.at - elapsed) > 1
        )
          throw new Error('完了後に animation の時計が進んでいない')
      }
    }, CLOCK_EPSILON)
    assert.deepEqual(errors, [], `${screen.name}: helper の実行時エラー`)
    await blockedInline(page, screen.name)
    console.log(
      `  ${screen.name}: ${clock.ready}要素/${clock.count}動作が群内で同期、${paired}対が一致。CSP と完了後の継続を確認`,
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
      // JS 無効の Linux headless では初回描画と RAF の開始が揺れる。撮影で描画を
      // 促すが動作は止めず、RAF に依存しない条件待ちの後も既存の時計検査を維持する。
      const beforeStart = await page.locator(TARGETS).evaluateAll(animationStartState)
      try {
        await page.screenshot({ animations: 'allow', timeout: 6_000 })
        await page.waitForFunction(
          (targets) => {
            const animations = [...document.querySelectorAll(targets)].flatMap((node) =>
              node
                .getAnimations()
                .filter(
                  (animation) =>
                    animation instanceof CSSAnimation &&
                    animation.effect.getTiming().iterations === Infinity,
                ),
            )
            return (
              animations.length > 0 &&
              animations.every(
                (animation) =>
                  !animation.pending &&
                  Number.isFinite(animation.startTime) &&
                  Number.isFinite(animation.currentTime),
              )
            )
          },
          TARGETS,
          { timeout: 6_000, polling: 100 },
        )
      } catch (error) {
        const afterStart = await page
          .locator(TARGETS)
          .evaluateAll(animationStartState)
          .catch((diagnosticError) => ({ error: diagnosticError.message }))
        console.error(
          `${screen.name}/JS 無効: 開始待ち失敗の診断 ${JSON.stringify({ beforeStart, afterStart })}`,
        )
        throw error
      }
      const invalid = await page.locator(TARGETS).evaluateAll((nodes) =>
        nodes.flatMap((node) =>
          node
            .getAnimations()
            .filter(
              (animation) =>
                animation instanceof CSSAnimation &&
                animation.effect.getTiming().iterations === Infinity &&
                (animation.playState !== 'running' ||
                  animation.playbackRate !== 1 ||
                  !Number.isFinite(animation.startTime) ||
                  !Number.isFinite(animation.currentTime)),
            )
            .map((animation) => ({
              name: animation.animationName,
              state: animation.playState,
              start: animation.startTime,
              current: animation.currentTime,
            })),
        ),
      )
      assert.deepEqual(invalid, [], `${screen.name}: JS 無効で動作の時計が無効/止まっている`)
      const paired = await pairs(page, false)
      console.log(
        `  ${screen.name}/JS 無効: CSS 周期・delay・easing、検査用3時刻の幾何${paired.checked}対。自然の開始差最大${paired.maxStartSkew.toFixed(3)}ms`,
      )
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

// Astra Minimal uses a static cover image in place of the original orbit
// drawing. The starfield and wordmark still use the motion helper, so verify
// their real first frame and both CSS-only accessibility fallbacks.
async function coverMotion(browser, base, screen, phone = false, slowImage = false) {
  const viewport = phone ? { width: 390, height: 844 } : OPTIONS.viewport
  const name = `${screen.name}/${phone ? 'phone' : 'PC'}${slowImage ? '/画像待機' : ''}`
  const page = await browser.newPage({ ...OPTIONS, viewport })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let releaseImage = () => {}
  if (slowImage) {
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    releaseImage = release
    await page.route('**/assets/astra-*.webp*', async (route) => {
      await held
      await route.continue()
    })
  }
  try {
    await page.addInitScript(() => {
      const report = { domReady: 0, firstStarReady: 0, loaded: false }
      window.__coverMotion = report
      addEventListener('load', () => {
        report.loaded = true
      })
      addEventListener('DOMContentLoaded', () => {
        report.domReady = performance.now()
        const ready = () => document.querySelector('.cosmos__twinkle[data-motion-ready]')
        if (ready()) {
          report.firstStarReady = performance.now()
          return
        }
        const observer = new MutationObserver(() => {
          if (!ready()) return
          report.firstStarReady = performance.now()
          observer.disconnect()
        })
        observer.observe(document.documentElement, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-motion-ready'],
        })
      })
    })
    const response = await page.goto(base + screen.path, { waitUntil: 'domcontentloaded' })
    assert.equal(response?.status(), 200, `${name}: HTTP 200 でない`)
    assert.match(
      response.headers()['content-security-policy'] ?? '',
      /script-src[^;]*'sha256-[^']+'?/,
      `${name}: CSP に helper の許可がない`,
    )
    await page.waitForFunction(() => window.__coverMotion.firstStarReady > 0, undefined, {
      timeout: 5_000,
      polling: 50,
    })
    const timing = await page.evaluate(() => window.__coverMotion)
    assert.ok(
      timing.firstStarReady - timing.domReady < 800,
      `${name}: heroの星の開始が遅い (${Math.round(timing.firstStarReady - timing.domReady)}ms)`,
    )
    if (slowImage) assert.equal(timing.loaded, false, `${name}: 画像の読み込み前に星が始まらない`)
    releaseImage()
    await page.locator('.astra-art').evaluate((image) => image.decode())
    await page.screenshot({ animations: 'allow' })
    const state = await page.evaluate(() => {
      const art = document.querySelector('.astra-art')
      const stars = [...document.querySelectorAll('.cosmos__twinkle')]
      const heading = document.querySelector('main h1')
      return {
        art:
          art instanceof HTMLImageElement &&
          art.naturalWidth > 0 &&
          art.getBoundingClientRect().width > 0,
        heading: heading?.textContent.trim(),
        links: document.querySelectorAll('main a[href]').length,
        stars: stars.length,
        active: stars.filter((node) =>
          node
            .getAnimations()
            .some(
              (animation) =>
                animation instanceof CSSAnimation &&
                animation.effect.getTiming().iterations === Infinity &&
                animation.playState === 'running',
            ),
        ).length,
      }
    })
    assert.ok(state.art && state.heading && state.links > 0, `${name}: 表紙/内容が描かれない`)
    assert.ok(state.stars > 0 && state.active === state.stars, `${name}: 星空が動いていない`)
    const ascii = await page.evaluate(() => {
      const rings = [...document.querySelectorAll('.ascii-sky__orbit')]
      const glyphs = [...document.querySelectorAll('.ascii-sky__glyph')]
      const movement = rings.map((ring) => {
        const animation = ring.getAnimations()[0]
        if (!(animation instanceof CSSAnimation)) return null
        const at = animation.currentTime
        animation.pause()
        animation.currentTime = 0
        const start = getComputedStyle(ring).transform
        animation.currentTime = animation.effect.getTiming().duration / 8
        const turn = getComputedStyle(ring).transform
        const overflow = document.documentElement.scrollWidth - innerWidth
        animation.currentTime = at
        animation.play()
        return { name: animation.animationName, start, turn, overflow }
      })
      return {
        rings: movement,
        glyphs: glyphs.length,
        characters: glyphs.map((glyph) => glyph.textContent),
        spinning: glyphs.filter((glyph) => glyph.getAnimations().length === 2).length,
      }
    })
    assert.equal(ascii.rings.length, 2, `${name}: ASCII軌道が2層でない`)
    assert.equal(ascii.glyphs, 29, `${name}: ASCIIの星が欠けている`)
    assert.ok(
      ascii.characters.every((char) => /^[+.*:]$/.test(char)),
      `${name}: ASCII以外の星がある`,
    )
    assert.equal(ascii.spinning, 29, `${name}: 星の自転・明滅が動いていない`)
    for (const ring of ascii.rings) {
      assert.ok(
        ring && ['orbit-swirl', 'orbit-unswirl'].includes(ring.name),
        `${name}: 星群の回転がない`,
      )
      assert.notEqual(ring.start, ring.turn, `${name}: 星群が実際には回っていない`)
      assert.ok(ring.overflow <= 1, `${name}: 回転中に星が横へはみ出す`)
    }
    assert.deepEqual(errors, [], `${name}: 実行時エラー`)
    await blockedInline(page, name)
    console.log(
      `  ${name}: 星 ${state.stars} 個が ${Math.round(timing.firstStarReady - timing.domReady)}ms で開始`,
    )
  } finally {
    releaseImage()
    await page.close()
  }
}

async function coverFallback(browser, base, screen, reduced) {
  const name = reduced ? 'reduced-motion' : 'JS 無効'
  const { page, errors } = await open(
    browser,
    base,
    screen,
    reduced ? { reducedMotion: 'reduce' } : { javaScriptEnabled: false },
  )
  try {
    const art = page.locator('.astra-art')
    await art.evaluate((image) => image.decode())
    const state = await page.evaluate(() => ({
      heading: document.querySelector('main h1')?.textContent.trim(),
      links: document.querySelectorAll('main a[href]').length,
      ascii: document.querySelectorAll('.ascii-sky__glyph').length,
      asciiMotion: [...document.querySelectorAll('.ascii-sky__orbit')].filter((node) =>
        node.getAnimations().some((animation) => animation instanceof CSSAnimation),
      ).length,
      active: [...document.querySelectorAll('.cosmos__twinkle')].filter((node) =>
        node
          .getAnimations()
          .some(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.effect.getTiming().iterations === Infinity,
          ),
      ).length,
    }))
    assert.ok(state.heading && state.links > 0, `${screen.name}/${name}: 内容/リンクがない`)
    assert.ok(await art.isVisible(), `${screen.name}/${name}: 表紙が見えない`)
    assert.equal(state.ascii, 29, `${screen.name}/${name}: 静止時のASCIIが欠けている`)
    if (reduced) {
      assert.equal(state.asciiMotion, 0, `${screen.name}/${name}: reduced-motionでASCIIが回る`)
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
    } else {
      assert.ok(state.active > 0, `${screen.name}/${name}: CSS の星が動いていない`)
      assert.equal(state.asciiMotion, 2, `${screen.name}/${name}: JSなしでASCIIが回らない`)
    }
    await page.emulateMedia({ media: 'print' })
    assert.equal(await art.isVisible(), false, `${screen.name}/${name}: 印刷で表紙が見える`)
    assert.equal(
      await page.locator('.ascii-sky').isVisible(),
      false,
      `${screen.name}/${name}: 印刷でASCIIが見える`,
    )
    assert.deepEqual(errors, [], `${screen.name}/${name}: 実行時エラー`)
    console.log(`  ${screen.name}/${name}: 本文・リンク・星空と印刷を確認`)
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
    const cover = await browser.newPage()
    await cover.goto(server.base)
    const astra = await cover.locator('.astra-art').count()
    await cover.close()
    if (astra) {
      for (const screen of SCREENS) {
        await coverMotion(browser, server.base, screen)
        await coverMotion(browser, server.base, screen, true)
        await coverFallback(browser, server.base, screen, false)
        await coverFallback(browser, server.base, screen, true)
      }
      await coverMotion(browser, server.base, SCREENS[0], false, true)
      console.log('✓ Astra 表紙の星・初期表示・CSP・フォールバック')
      return
    }
    for (const screen of SCREENS) {
      await initialDisplay(browser, server.base, screen)
      await initialDisplay(browser, server.base, screen, true)
      const content = await normal(browser, server.base, screen)
      await fallback(browser, server.base, screen, content, false)
      await fallback(browser, server.base, screen, content, true)
    }
    await initialDisplay(browser, server.base, SCREENS[0], false, true)
    console.log('✓ 入口/Contact の初期表示・群内同期・CSP・フォールバック')
  } finally {
    await browser?.close()
    await server?.stop()
    await state?.cleanup()
  }
}

await main()
