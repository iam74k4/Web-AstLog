// 管理画面の実フォーム・ブラウザ標準送信を検査する。使い捨て D1/KV 以外には触らない。
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'
import { importTs } from './lib/ts-import.mjs'

const { ADMIN_ART } = await importTs('src/ui/admin-art.ts')
const { BLACKHOLE_ART } = await importTs('src/ui/logo.ts')
const { CELESTIAL_ART } = await importTs('src/ui/celestial-art.ts')
const originals = { 'black-hole': BLACKHOLE_ART, ...CELESTIAL_ART }
let artBytes = 0
for (const [key, art] of Object.entries(ADMIN_ART)) {
  assert.equal(art.source, originals[key].src, '原画を変えたら export-admin-art を実行する')
  assert.ok(
    Math.abs(art.width / art.height - originals[key].width / originals[key].height) < 0.01,
    '縮小見本の縦横比が原画と違う',
  )
  const [path, version] = art.src.split('?v=')
  const bytes = await readFile(join(ROOT, 'public', path))
  assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 8), version)
  artBytes += bytes.length
}
assert.ok(artBytes < 64 * 1024, '管理用の選択見本が64KiBを超えている')
const token = randomBytes(32).toString('hex')
const hash = createHash('sha256').update(token).digest('hex')
const fixture = `INSERT INTO users(id,role) VALUES(9001,'owner'); INSERT INTO sessions(id,user_id,expires_at) VALUES('${hash}',9001,'${new Date(Date.now() + 3_600_000).toISOString()}'); INSERT INTO user_identities(user_id,provider,subject,label) VALUES(9001,'github','check-admin','画面検査');`
const state = await scratchState('admin-check', [
  await readFile(join(ROOT, 'seed.sql'), 'utf8'),
  fixture,
])
let dev, browser
const errors = []
let screens = 0
const screenshotDir = join(ROOT, 'dist', 'admin-check')
const paths = [
  '/admin',
  '/admin/items',
  '/admin/items?type=work',
  '/admin/members',
  '/admin/blocks',
  '/admin/appearance',
  '/admin/site',
  '/admin/account',
  '/admin/items/new?type=app',
  '/admin/members/new',
  '/admin/items/1/edit',
  '/admin/members/1/edit',
  '/admin/blocks/new?type=numbers',
  '/admin/blocks/new?type=links',
  '/admin/blocks/new?type=now',
  '/admin/blocks/1/edit',
  '/admin/items/1/delete',
  '/admin/members/1/delete',
]
try {
  dev = await devServer(undefined, Number(process.env.ADMIN_PORT ?? 8816), state.dir)
  browser = await chromium.launch()
  await mkdir(screenshotDir, { recursive: true })
  const contextFor = async (width, javaScriptEnabled = true) => {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      javaScriptEnabled,
      hasTouch: width < 900,
    })
    await context.addCookies([
      { name: 'astlog_session', value: token, url: dev.base, httpOnly: true, sameSite: 'Lax' },
    ])
    context.on('page', (page) => {
      page.on('pageerror', (error) => errors.push(String(error)))
      page.on('console', (message) => {
        if (message.text().includes('Content Security Policy')) errors.push(message.text())
      })
    })
    return context
  }
  const go = async (page, path) => {
    const response = await page.goto(dev.base + path, { waitUntil: 'networkidle' })
    assert.equal(response.status(), 200, path)
  }
  const submit = async (page, status = 303) => {
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && !r.url().includes('/preview'),
    )
    await page.locator('.form-actions button[type=submit]:not([formaction])').click()
    assert.equal((await response).status(), status)
    await page.waitForLoadState('networkidle')
  }
  for (const width of [390, 768, 1440]) {
    const context = await contextFor(width)
    const page = await context.newPage()
    for (const path of paths) {
      await go(page, path)
      assert.equal(await page.locator('main h1').count(), 1, path)
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${width}: ${path} 横はみ出し`,
      )
      if (path.includes('/new') && !path.includes('/blocks/')) {
        assert.ok(
          (await page.locator('input:not([type=hidden])').first().boundingBox()).y < 600,
          `${width}: ${path} 最初の入力が遠い`,
        )
      }
      if (path === '/admin/items') {
        assert.ok(
          await page
            .locator('.icon-btn')
            .evaluateAll((buttons) =>
              buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
            ),
          '操作ラベルが枠からはみ出す',
        )
      }
      if (path === '/admin/members/1/edit') {
        const cards = page.locator('.celestial-choice')
        assert.equal(await cards.count(), 5)
        await cards.last().scrollIntoViewIfNeeded()
        assert.ok(
          await cards
            .locator('img')
            .evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)),
        )
        // キーボードのラジオ操作と選択状態。
        await page.locator('[name=celestialBody]:checked').focus()
        await page.keyboard.press('ArrowRight')
        assert.notEqual(
          await page.locator('[name=celestialBody]:checked').inputValue(),
          'black-hole',
        )
      }
      if (path === '/admin/items/1/edit') {
        const field = page.locator('[name=summary]')
        await field.focus()
        const box = await field.boundingBox()
        const bar = await page.locator('.form-foot').boundingBox()
        assert.ok(box.y + box.height <= bar.y + 1, `${width}: 入力欄が保存バーに隠れる`)
        if (width === 390) assert.ok(bar.height <= 136, '保存バーが大きすぎる')
      }
      await page.screenshot({
        path: join(screenshotDir, `${width}-${path.replace(/[^a-z0-9]+/gi, '-')}.png`),
        fullPage: true,
      })
      screens++
    }
    // 保存前プレビューは同じ画面で開き、ESC で入力とフォーカスを保持して戻る。
    await go(page, '/admin/members/1/edit')
    await page.locator('[name=name]').fill('プレビューだけの名前')
    const beforeVersion = await page.locator('[name=_version]').inputValue()
    await page.locator('button[formaction]').click()
    await page.locator('#editor-preview[open]').waitFor()
    await page
      .frameLocator('#editor-preview iframe')
      .getByText('プレビューだけの名前', { exact: true })
      .first()
      .waitFor()
    assert.equal(context.pages().length, 1)
    await page.keyboard.press('Escape')
    await page.locator('#editor-preview[open]').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('[name=name]').inputValue(), 'プレビューだけの名前')
    assert.equal(await page.locator('[name=_version]').inputValue(), beforeVersion)
    assert.ok(
      await page.locator('button[formaction]').evaluate((node) => node === document.activeElement),
    )
    await go(page, '/admin/members/1/edit')
    assert.notEqual(await page.locator('[name=name]').inputValue(), 'プレビューだけの名前')

    // 見た目の見本は選択直後に変化する。
    await go(page, '/admin/appearance')
    await page.locator('[name=accent][value=ember]').check({ force: true })
    await page.locator('[name=typeface][value=serif]').check({ force: true })
    assert.equal(await page.locator('form[data-accent]').getAttribute('data-accent'), 'ember')
    assert.ok(
      await page
        .locator('.design-sample h2')
        .evaluate((node) => getComputedStyle(node).fontFamily.includes('serif')),
    )
    await context.close()
  }
  const forced = await contextFor(390)
  const forcedPage = await forced.newPage()
  await forcedPage.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await go(forcedPage, '/admin/members/1/edit')
  assert.ok(
    await forcedPage
      .locator('.celestial-choice input, .accent-choice input')
      .evaluateAll((inputs) => inputs.every((input) => getComputedStyle(input).opacity === '1')),
    '強制色で選択状態が消える',
  )
  await forced.close()
  const context = await contextFor(390)
  const page = await context.newPage()
  // サーバー検証の失敗が、閉じた詳細欄に埋もれない。
  await go(page, '/admin/members/new')
  await page.locator('[name=name]').fill('消えない入力')
  await page
    .locator('details')
    .filter({ has: page.locator('[name=sortOrder]') })
    .locator('summary')
    .click()
  await page.locator('[name=sortOrder]').fill('bad')
  await submit(page, 400)
  assert.equal(await page.locator('[name=name]').inputValue(), '消えない入力')
  assert.ok(await page.locator('.form-errors').evaluate((node) => node === document.activeElement))
  await page.locator('.form-errors a[href="#field-sortOrder-error"]').click()
  assert.ok(await page.locator('#field-sortOrder-error').isVisible())

  // 2枚の実際の編集画面。サーバーの版と hidden フィールドまで含めて検査する。
  const other = await context.newPage()
  for (const one of [page, other]) await go(one, '/admin/items/1/edit')
  await page.locator('[name=title]').fill('先に保存した作品')
  await submit(page)
  await other.locator('[name=title]').fill('後からの入力は保持')
  await submit(other, 409)
  assert.equal(await other.locator('[name=title]').inputValue(), '後からの入力は保持')
  assert.ok(await other.getByRole('link', { name: '最新の編集画面と比較する ↗' }).isVisible())
  await go(page, '/admin/items/1/edit')
  assert.equal(await page.locator('[name=title]').inputValue(), '先に保存した作品')

  await go(page, '/admin/blocks/new?type=links')
  await page.locator('[name=title]').fill('項目別のリンク')
  await page.getByRole('textbox', { name: '1件目のラベル', exact: true }).fill('Example')
  await page.getByRole('textbox', { name: '1件目のURL', exact: true }).fill('https://example.test/')
  await page.getByRole('textbox', { name: '1件目の補足', exact: true }).fill('入力した補足')
  await submit(page)
  await page.getByRole('link', { name: '項目別のリンク を編集', exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: '1件目のURL', exact: true }).inputValue(),
    'https://example.test/',
  )
  await context.close()

  const native = await contextFor(390, false)
  const nativePage = await native.newPage()
  await go(nativePage, '/admin/members/1/edit')
  await nativePage.locator('[name=name]').fill('JSなしのプレビュー')
  const popupEvent = native.waitForEvent('page')
  await nativePage.locator('button[formaction]').click()
  const popup = await popupEvent
  await popup.waitForLoadState('networkidle')
  assert.equal(
    await popup.getByText('JSなしのプレビュー', { exact: true }).first().isVisible(),
    true,
  )
  assert.equal(await nativePage.locator('[name=name]').inputValue(), 'JSなしのプレビュー')
  await native.close()
  assert.deepEqual(errors, [])
  console.log(
    `✓ 管理画面 ${screens} 画面: 3寸法・入力位置・保存バー・画像・キーボード・プレビュー・競合・エラー・項目別入力・JS無しを確認`,
  )
} finally {
  await browser?.close()
  await dev?.stop()
  await state.cleanup()
}
