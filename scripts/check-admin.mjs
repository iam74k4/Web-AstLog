// 管理画面の実フォーム・ブラウザ標準送信を検査する。使い捨て D1/KV 以外には触らない。
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'

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
  '/admin/platforms',
  '/admin/platforms/web/delete',
  '/admin/media',
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
      // 名前は2か所にある（本文の名札と、900 以上でだけ見える左の柱の名札）。見えているほうを待つ
      .filter({ visible: true })
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
    // 保存済み・保存前・横の完成形を、公開と同じショーケースで操作できる。
    await go(page, '/admin/items')
    const savedLink = page.locator('[data-saved-preview]').first()
    await savedLink.click()
    const modal = page.frameLocator('#editor-preview iframe')
    await modal.locator('.shots--showcase').waitFor()
    assert.equal(context.pages().length, 1)
    await modal.locator('.gallery__thumb').nth(1).click()
    assert.equal(await modal.locator('[data-gallery-count]').textContent(), '02 / 05')
    assert.equal(
      await page.locator('#editor-preview [role=status]').textContent(),
      '保存済みの内容',
    )
    await page.keyboard.press('Escape')
    await page.locator('#editor-preview[open]').waitFor({ state: 'hidden' })
    assert.ok(await savedLink.evaluate((node) => node === document.activeElement))
    await go(page, '/admin/items/1/edit')
    const itemVersion = await page.locator('[name=_version]').inputValue()
    const live = page.frameLocator('iframe[name=live-preview]')
    if (width === 1440) {
      await live.locator('.shots--showcase').waitFor()
      await live.locator('.gallery__thumb').nth(2).click()
      await page.locator('[name=summary]').fill('ショーケースの保存前検査。')
      await live.getByText('ショーケースの保存前検査。', { exact: true }).waitFor()
      assert.equal(await live.locator('[data-gallery-count]').textContent(), '03 / 05')
    }
    await page
      .locator('details')
      .filter({ has: page.locator('[name^="shotAlt-"]') })
      .locator('summary')
      .click()
    await page.locator('[name^="shotAlt-"]').nth(1).fill('保存前に変えた画像の説明')
    await page.locator('[name^="shotOrder-"]').nth(1).fill('1')
    await page.locator('[name^="shotRemove-"]').first().check()
    await page.locator('[name=newShotAlt]').first().fill('保存前に追加した画像')
    await page
      .locator('[name=newShot]')
      .first()
      .setInputFiles(join(ROOT, 'scripts/fixtures/media/sample-icon-mixer.png'))
    await page.locator('button[formaction]').click()
    await modal.locator('.shots--showcase').waitFor()
    await modal.locator('.gallery__thumb').nth(1).click()
    assert.equal(
      await modal.locator('.gallery__item[data-active=true] .gallery__description').textContent(),
      '保存前に変えた画像の説明',
    )
    await modal.locator('.gallery__thumb').last().click()
    assert.equal(
      await modal.locator('.gallery__item[data-active=true] .gallery__description').textContent(),
      '保存前に追加した画像',
    )
    assert.match(
      await modal.locator('.gallery__item[data-active=true] img').getAttribute('src'),
      /^data:image\/png;base64,/,
    )
    // iframe内へ実行scriptを加えず、親の許可済みコードからDOMを初期化する。
    assert.equal(await modal.locator('script').count(), 0)
    assert.ok(
      !(await page.locator('#editor-preview iframe').getAttribute('sandbox')).includes(
        'allow-scripts',
      ),
    )
    assert.equal(await page.locator('[name=_version]').inputValue(), itemVersion)
    await page.keyboard.press('Escape')
    await page.locator('#editor-preview[open]').waitFor({ state: 'hidden' })
    assert.ok(
      await page.locator('button[formaction]').evaluate((node) => node === document.activeElement),
    )
    await go(page, '/admin/items/1/edit')
    assert.equal(await page.locator('[name=_version]').inputValue(), itemVersion)
    assert.notEqual(
      await page.locator('[name^="shotAlt-"]').nth(1).inputValue(),
      '保存前に変えた画像の説明',
    )
    if (width === 1440) {
      /*
        押して開くプレビューと、横の完成形の描き直しがぶつかる並び。どちらも同じフォームを別の枠へ
        送り、フォームが予定している送信は1つだけなので、後から送ったほうが前の予定を取り消す。
        「印を変える（横が送る）→ 押す → 横の枠の読み込みが届いて、待たせていた描き直しを送る」の順に
        なると、ダイアログへの送信が取り消されて空のまま開いた（CI でだけ時々落ちた。本番前の検査が
        これで止まった）。同じ並びをここで必ず起こす——読み込みの知らせは、届く順をこちらで決める
      */
      await go(page, '/admin/items/1/edit')
      await live.locator('.shots--showcase').waitFor()
      await page.evaluate(() => {
        const form = document.querySelector('.live__edit form[method=post]')
        const mark = form.querySelector('[name=leadLink]')
        mark.click() // 横の完成形が送る
        mark.click() // 送っている最中なので、次の描き直しを待たせる
        form.querySelector('button[formaction]').click() // 押して開く
        document.querySelector('iframe[name=live-preview]').dispatchEvent(new Event('load'))
      })
      await modal.locator('.shots--showcase').waitFor()
      await page.keyboard.press('Escape')
      await page.locator('#editor-preview[open]').waitFor({ state: 'hidden' })
      // 待たせた横の描き直しも、ダイアログが読み込まれたあとで送られる（止まったままにならない）
      await page.locator('.live__status').filter({ hasText: 'まだ保存されていません' }).waitFor()
      await live.locator('.shots--showcase').waitFor()
    }
    await context.close()
  }
  const forced = await contextFor(390)
  const forcedPage = await forced.newPage()
  await forcedPage.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await go(forcedPage, '/admin/members/1/edit')
  assert.ok(
    await forcedPage
      .locator('.toggle input')
      .evaluateAll(
        (inputs) =>
          inputs.length > 0 && inputs.every((input) => getComputedStyle(input).opacity === '1'),
      ),
    '強制色で公開の切り替えが消える',
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
  // 行は保存せずに足せる（AddRow。足した行は空で、番号と読み上げの名前が続きになる）
  assert.equal(await page.locator('.block-fields__row').count(), 3)
  await page.getByRole('button', { name: '＋ 行を足す' }).click()
  assert.equal(await page.locator('.block-fields__row').count(), 4)
  assert.equal(await page.locator('.block-fields__number').last().textContent(), '04')
  await page.getByRole('textbox', { name: '4件目のラベル', exact: true }).fill('Fourth')
  await page
    .getByRole('textbox', { name: '4件目のURL', exact: true })
    .fill('https://example.test/4')
  await submit(page)
  await page.getByRole('link', { name: '項目別のリンク を編集', exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: '1件目のURL', exact: true }).inputValue(),
    'https://example.test/',
  )
  // 空の2行は捨てられ、足した行は2件目として残る
  assert.equal(
    await page.getByRole('textbox', { name: '2件目のURL', exact: true }).inputValue(),
    'https://example.test/4',
  )
  // 作品のリンクも同じ手で足せる
  await go(page, '/admin/items/1/edit')
  await page
    .locator('details')
    .filter({ has: page.locator('[name=linkUrl]') })
    .locator('summary')
    .click()
  const linkRows = await page.locator('.link-row').count()
  await page.getByRole('button', { name: '＋ 行を足す' }).click()
  assert.equal(await page.locator('.link-row').count(), linkRows + 1)
  assert.equal(await page.locator('.link-row').last().locator('input').first().inputValue(), '')
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
    // 名前は本文の名札と左の柱の名札（900 以上でだけ見える）にある。見えているほうを確かめる
    await popup
      .getByText('JSなしのプレビュー', { exact: true })
      .filter({ visible: true })
      .first()
      .isVisible(),
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
