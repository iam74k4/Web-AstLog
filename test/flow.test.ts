import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, form, get, okText, resetDb, seedItem, seedMember, signIn } from './helpers'

/*
  導線。あるページから次のページへ（目次とページの中のリンクで）、行き止まらずに進めるか。
  構成でブロックを外したときに切れやすいので、その形をここで押さえる。
*/

beforeEach(resetDb)

type BlockKey = (typeof schema.blocks.$inferInsert)['type']

const place = (types: BlockKey[]) =>
  db()
    .insert(schema.blocks)
    .values(types.map((type, index) => ({ type, published: 1, sortOrder: (index + 1) * 10 })))

const bandOf = (html: string) => {
  const from = html.indexOf('class="band"')
  return from < 0 ? '' : html.slice(from, html.indexOf('</a>', from))
}

const tocOf = (html: string) => html.split('<nav class="toc"')[1]?.split('</nav>')[0] ?? ''

describe('独立ページの目次', () => {
  it('ひとことと見出しのないメモにも、どの公開ページからでも行ける', async () => {
    const member = await seedMember()
    await seedItem({ memberId: member.id, slug: 'appmixer' })
    const [statement, note] = await db()
      .insert(schema.blocks)
      .values([
        { type: 'statement', title: 'つくり続ける', published: 1, sortOrder: 20 },
        { type: 'note', body: '見出しを置かない文章です。', published: 1, sortOrder: 30 },
      ])
      .returning()
    if (!statement || !note) throw new Error('書くブロックが無い')
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero', published: 1, sortOrder: 10 },
        { type: 'projects', published: 1, sortOrder: 40 },
        { type: 'contact', published: 1, sortOrder: 50 },
      ])

    const targets = [
      { href: `/block-${statement.id}`, label: 'ひとこと' },
      { href: `/block-${note.id}`, label: 'メモ' },
    ]
    for (const path of [
      '/',
      ...targets.map(({ href }) => href),
      '/projects',
      '/contact',
      '/apps/item/appmixer',
      '/members/okazaki',
    ]) {
      const toc = tocOf(await okText(path))
      for (const { href, label } of targets) {
        expect(toc, path).toContain(`href="${href}"`)
        expect(toc, path).toContain(`>${label}</a>`)
      }
      if (targets.some(({ href }) => href === path)) {
        expect(toc).toContain(`href="${path}" aria-current="page"`)
      }
      // 先頭の Hero へは、どのページからもロゴで戻れる
      expect(toc).not.toContain('href="/hero"')
    }
    const wholeToc = tocOf(await okText('/all'))
    for (const { href } of targets) expect(wholeToc).not.toContain(`href="#${href.slice(1)}"`)
  })

  it('先頭以外の Hero は、ほかの独立ページと同じく目次から開ける', async () => {
    await seedItem()
    await place(['projects', 'hero', 'contact'])
    expect(tocOf(await okText('/'))).toContain('href="/hero" lang="en">Hero</a>')
    expect(tocOf(await okText('/hero'))).toContain(
      'href="/hero" aria-current="page" lang="en">Hero</a>',
    )
    expect(tocOf(await okText('/contact'))).toContain('href="/hero" lang="en">Hero</a>')
  })
})

describe('個人ページ → 一覧', () => {
  it('構成で Projects を外したら、一覧へは案内しない', async () => {
    const member = await seedMember()
    // 2人のサイト。1人で Team を置くと、帯はもともと出ない（入口の1本と重なる）
    await seedMember({ slug: 'hoshino', name: '星野' })
    await seedItem({ type: 'app', memberId: member.id })
    await seedItem({ type: 'work', title: '業務の実績', memberId: member.id })
    await place(['hero', 'team', 'contact'])

    // 送った先に節が無いと、行き止まり（404）になる
    const html = await okText('/members/okazaki')
    expect(bandOf(html)).toBe('')
    expect(html).not.toContain('href="/projects')
  })

  it('帯の件数は区分ごと。その人に項目の無い区分は数えない', async () => {
    const member = await seedMember()
    await seedItem({ type: 'app', memberId: member.id })
    await seedItem({ type: 'work', title: '業務の実績' })
    /*
      Team を置かない1人のサイト（一覧の行の担当者名から入る並びの外のページ）。
      Team を置くと個人ページはサイトの並びに入り、帯は出さない
    */
    await place(['hero', 'projects', 'contact'])

    const band = bandOf(await okText('/members/okazaki'))
    expect(band).toContain('href="/projects"')
    expect(band).toContain('個人開発 1')
    // 業務はほかの人のもの。その人の帯で「業務 1」と出すと、どこにも無い1件になる
    expect(band).not.toContain('業務')
    /*
      題は Projects の説明文（つくったもの N 件）と同じ言葉で、誰のものかを足す。
      「このメンバーの Projects」のころは、節の名前（英語）を札の題に使っていた
    */
    expect(band).toContain('<strong>このメンバーのつくったもの</strong>')
  })

  it('入口は、個人開発と業務を区分を問わず1つの一覧へ送る。件数の帯は置かない', async () => {
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work', title: '業務の実績' })
    await place(['hero', 'projects', 'contact'])

    const html = await okText('/')
    expect(html).toContain('<a class="cta" href="/projects">')
    // 件数（07 Projects・Since 2024）は数の少なさを目立たせるだけだった（components.tsx の Hero）
    expect(html).not.toContain('class="tally')
  })
})

describe('1人のサイトの ?member=', () => {
  it('帯は ?member= を付けずに一覧へ送る', async () => {
    const member = await seedMember()
    await seedItem({ memberId: member.id })
    // 帯が出るのは Team を置かない1人のサイト（置くと帯は出さない。入口の1本と重なる）
    await place(['hero', 'projects', 'contact'])

    const html = await okText('/members/okazaki')
    expect(bandOf(html)).toContain('href="/projects"')
    expect(html).not.toContain('?member=')
  })

  it('URL に付いていても絞り込まない。「すべて」に印が付いたまま全件を出す', async () => {
    const member = await seedMember()
    await seedItem({ title: '本人のアプリ', memberId: member.id })
    await seedItem({ title: '担当の無いアプリ', sortOrder: 20 })

    // 名前の絞り込みが無いので、効かせると「すべて」にも名前にも印が付かなくなる
    const html = await okText('/projects?member=okazaki')
    expect(html).toContain('担当の無いアプリ')
    expect(html).toContain('href="/projects" aria-current="true"')
  })
})

describe('トップ → 個人ページ', () => {
  it('Team を外したら、メンバーが1人でも一覧の行から個人ページへ行ける', async () => {
    const member = await seedMember()
    await seedItem({ slug: 'appmixer', memberId: member.id })
    await place(['hero', 'projects', 'contact'])

    expect(await okText('/projects')).toContain('class="entry__member" href="/members/okazaki"')
    // 作品1件のページの「担当」も同じ条件
    expect(await okText('/apps/item/appmixer')).toContain('href="/members/okazaki"')
  })

  it('Team があってメンバーが1人なら、一覧の行には名前を出さない', async () => {
    const member = await seedMember()
    await seedItem({ memberId: member.id })

    expect(await okText('/projects')).not.toContain('entry__member')
  })
})

/* ------------------------------------------------------------- 管理側 */

describe('ログインの戻り先', () => {
  it('弾かれた画面は、ログイン画面の提供元のリンクへ持ち回される', async () => {
    const bounced = await get('/admin/site')
    expect(bounced.headers.get('location')).toBe('/admin/login?next=%2Fadmin%2Fsite')

    // ログイン画面はフォームではなく、提供元ごとの GET のリンク。戻り先はその query に乗る
    const page = await okText('/admin/login?next=%2Fadmin%2Fsite')
    expect(page).toContain('href="/admin/auth/github/start?next=%2Fadmin%2Fsite"')
    expect(page).toContain('href="/admin/auth/google/start?next=%2Fadmin%2Fsite"')
    // 往復のあとで実際にそこへ戻ることは test/oauth.test.ts（next の安全化）
  })

  it('管理画面の外やログインの往復そのものは、リンクに持ち回さない', async () => {
    for (const next of [
      'https://evil.example',
      '//evil.example',
      '/admin/../..//evil',
      '/members/okazaki',
      '/admin/logout',
      '/admin/auth/github/start',
    ]) {
      const page = await okText(`/admin/login?next=${encodeURIComponent(next)}`)
      expect(page, next).toContain('href="/admin/auth/github/start"')
      expect(page, next).not.toContain('start?next=')
    }
  })
})

describe('構成', () => {
  it('↑↓ のあとは、動かした行へ戻る', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    const response = await signed(`/admin/blocks/${team.id}/move`, {
      method: 'POST',
      body: form({ dir: 'up' }),
    })
    expect(response.headers.get('location')).toBe(`/admin/blocks#block-${team.id}`)
    expect(await (await signed('/admin/blocks')).text()).toContain(`id="block-${team.id}"`)
  })

  it('足したものは Contact の手前に入り、その行へ戻る', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: 'あとがき', body: '本文です', published: '1' }),
    })
    const rows = await db().query.blocks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] })
    expect(rows.map((row) => row.type).slice(-2)).toEqual(['note', 'contact'])
    expect(response.headers.get('location')).toBe(`/admin/blocks?saved=1#block-${rows.at(-2)?.id}`)
  })
})

describe('管理画面からサイトへ', () => {
  it('公開中のメンバーは、一覧からそのページを開ける', async () => {
    await seedMember()
    await seedMember({ slug: 'draft', name: '下書きの人', published: 0 })
    const signed = await signIn()

    const html = await (await signed('/admin/members')).text()
    expect(html).toContain('href="/members/okazaki"')
    // 下書きの人のページは 404 なので、リンクを出さない
    expect(html).not.toContain('href="/members/draft"')
  })

  it('どの画面の左ナビにもプレビューと公開サイトへの入口がある', async () => {
    const signed = await signIn()
    for (const path of ['/admin/members', '/admin/items', '/admin/blocks', '/admin/site']) {
      const html = await (await signed(path)).text()
      expect(html, path).toContain('href="/admin/preview"')
      expect(html, path).toContain('公開サイト ↗')
    }
  })
})

describe('下書きの扱い', () => {
  it('下書きで保存したら、サイトにまだ出ていないと知らせる', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '寝かせておくアプリ' }),
    })
    expect(response.headers.get('location')).toBe('/admin/items?type=app&saved=draft')
    expect(await (await signed('/admin/items?type=app&saved=draft')).text()).toContain(
      'サイトにはまだ出ていません',
    )
  })

  it('書くブロックは、メンバー・項目と同じく下書きから始まる', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/blocks/new?type=note')).text()
    expect(html).toContain('name="published" value="1"')
    expect(html).not.toContain('name="published" value="1" checked')
  })
})

describe('削除の確認から戻る', () => {
  it('編集画面から来たなら、キャンセルで編集画面へ戻る', async () => {
    const member = await seedMember()
    const item = await seedItem()
    const signed = await signIn()

    const fromEdit = await (await signed(`/admin/members/${member.id}/delete?from=edit`)).text()
    expect(fromEdit).toContain(`href="/admin/members/${member.id}/edit"`)
    const itemFromEdit = await (await signed(`/admin/items/${item.id}/delete?from=edit`)).text()
    expect(itemFromEdit).toContain(`href="/admin/items/${item.id}/edit"`)

    // 一覧から来たなら一覧へ
    const fromList = await (await signed(`/admin/members/${member.id}/delete`)).text()
    expect(fromList).not.toContain(`href="/admin/members/${member.id}/edit"`)
  })
})
