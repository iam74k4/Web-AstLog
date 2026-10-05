import { describe, expect, it } from 'vitest'
import { Area, Field, FormActions, FormDetails, Select } from '../src/ui/AdminForm'

describe('管理フォームの入力と説明', () => {
  it.each([
    [
      'input',
      () =>
        Field({ label: '名前', name: 'title', error: '名前が必要です', hint: '作品名を書きます' }),
    ],
    [
      'textarea',
      () => Area({ label: '説明', name: 'title', error: '説明が必要です', hint: '2文で書きます' }),
    ],
    [
      'select',
      () =>
        Select({
          label: '種類',
          name: 'title',
          error: '選び直してください',
          hint: '一覧から選びます',
          options: [],
        }),
    ],
  ])('%s のエラーとヒントがその欄へ結び付く', async (tag, component) => {
    const html = await component().toString()
    const input = html.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? ''
    expect(input).toContain('aria-invalid="true"')
    expect(input).toContain('aria-labelledby="field-title-label"')
    expect(input).toContain('aria-describedby="field-title-error field-title-hint"')
    expect(html).toContain('id="field-title-error"')
    expect(html).toContain('id="field-title-hint"')
  })

  it('注意だけの欄はエラーと名乗らず、説明の無い欄は存在しない説明を指さない', async () => {
    const warned = await Field({
      label: '年',
      name: 'year',
      warning: '並びに使われません',
    }).toString()
    expect(warned).toContain('aria-describedby="field-year-warning"')
    expect(warned).not.toContain('aria-invalid')
    expect(warned).not.toContain('field-year-error')
    const plain = await Field({ label: '名前', name: 'name' }).toString()
    expect(plain).not.toContain('aria-describedby')
    expect(plain).not.toContain('aria-invalid')
  })

  it('任意の設定は最初は畳み、その中のエラーがあるときだけ開いて返す', async () => {
    const props = { title: '詳細設定', fields: ['slug', 'sortOrder'] }
    expect(await FormDetails(props).toString()).not.toMatch(/<details[^>]*\bopen\b/)
    expect(
      await FormDetails({ ...props, errors: { title: '名前が必要です' } }).toString(),
    ).not.toMatch(/<details[^>]*\bopen\b/)
    expect(
      await FormDetails({ ...props, errors: { slug: '別の URL を選んでください' } }).toString(),
    ).toMatch(/<details[^>]*\bopen\b/)
  })

  it('保存前プレビューは同じフォームを別タブへ送り、保存先は変えない', async () => {
    const html = await FormActions({
      cancelHref: '/admin/site',
      previewAction: '/admin/preview/site',
    }).toString()
    const preview = html.match(/<button[^>]*formaction[^>]*>/)?.[0] ?? ''
    expect(preview).toContain('type="submit"')
    expect(preview).toContain('formaction="/admin/preview/site"')
    expect(preview).toContain('formtarget="_blank"')
    expect(preview).toContain('formnovalidate')
    expect(html).toContain('保存前にプレビュー ↗')
    expect(html).toContain('<button class="btn btn--primary" type="submit">保存</button>')
    expect(html.match(/<button[^>]*>/)?.[0]).toContain('class="btn btn--primary"')
  })
})
