import css from 'virtual:app-css'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { ACCENTS, LAYOUTS, TYPEFACES } from '../src/theme'
import { db, form, get, resetDb, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const save = async (values: Record<string, string>) => {
  const signed = await signIn()
  return signed('/admin/appearance', { method: 'POST', body: form(values) })
}

const MAGAZINE = { layout: 'magazine', accent: 'ember', typeface: 'serif' }

describe('見た目のプリセット', () => {
  it('何も選んでいなければ既定の姿で出す', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('data-layout="rail"')
    expect(html).toContain('data-accent="iris"')
    expect(html).toContain('data-typeface="sans"')
  })

  it('選んだものが公開ページに出る', async () => {
    const response = await save(MAGAZINE)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/appearance?saved=1')

    const html = await (await get('/')).text()
    expect(html).toContain('data-layout="magazine"')
    expect(html).toContain('data-accent="ember"')
    expect(html).toContain('data-typeface="serif"')
  })

  it('個人ページも同じ姿になる', async () => {
    await seedMember()
    await save(MAGAZINE)

    const html = await (await get('/members/okazaki')).text()
    expect(html).toContain('data-layout="magazine"')
  })

  it('二度保存しても行が増えない', async () => {
    await save(MAGAZINE)
    await save({ layout: 'center', accent: 'mint', typeface: 'mono' })

    const rows = await db().select().from(schema.settings)
    expect(rows).toHaveLength(3)
    expect(await (await get('/')).text()).toContain('data-layout="center"')
  })

  it('知らない値は保存しない', async () => {
    const response = await save({ layout: 'chaos', accent: 'ember', typeface: 'serif' })
    expect(response.status).toBe(400)

    // 1つでも知らなければ、まとめて受け取らない
    const html = await (await get('/')).text()
    expect(html).toContain('data-layout="rail"')
    expect(html).toContain('data-accent="iris"')
  })

  it('DB に知らない値が入っていても既定に戻して描く', async () => {
    // プリセットを1つ減らした後の、選んだままのサイトを想定する
    await db().insert(schema.settings).values({ key: 'theme.layout', value: '消えた骨格' })

    const response = await get('/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data-layout="rail"')
  })

  it('ログインしていなければ見た目を変えられない', async () => {
    const response = await get('/admin/appearance', { method: 'POST', body: form(MAGAZINE) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')

    expect(await (await get('/')).text()).toContain('data-layout="rail"')
  })

  it('選べるものだけを並べ、いま選んでいるものに印を付ける', async () => {
    await save(MAGAZINE)
    const signed = await signIn()
    const html = await (await signed('/admin/appearance')).text()

    expect(html).toContain('value="magazine" checked=""')
    expect(html).toContain('value="ember" checked=""')
    // 見本は全種類ぶん出るので、data-typeface を見ても選択中は分からない
    expect(html).toContain('value="serif" checked=""')
    expect(html).not.toContain('value="sans" checked=""')
  })
})

/*
  選択肢は src/theme.ts が正だが、実際に姿を変えるのは app.css。
  片方だけ足すと、選べるのに何も変わらない選択肢ができる。
*/
describe('プリセットと CSS', () => {
  it('CSS を読めている（読めていないと、以下の検査が素通りする）', () => {
    expect(css.length).toBeGreaterThan(1000)
  })

  it('骨格には body[data-layout] の指定がある', () => {
    for (const layout of LAYOUTS) {
      if (layout.key === 'rail') continue // 既定。素の指定がそのまま骨格になる
      expect(css).toContain(`body[data-layout='${layout.key}']`)
    }
  })

  it('アクセント色と書体には [data-accent] / [data-typeface] の指定がある', () => {
    for (const accent of ACCENTS) expect(css).toContain(`[data-accent='${accent.key}']`)
    for (const typeface of TYPEFACES) expect(css).toContain(`[data-typeface='${typeface.key}']`)
  })
})
