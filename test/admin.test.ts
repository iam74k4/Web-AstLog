import { beforeEach, describe, expect, it } from 'vitest'
import { type BlockKey, blockType, MAX_CHARS } from '../src/blocks'
import * as schema from '../src/db/schema'
import { chunk } from '../src/lib/paginate'
import { db, form, get, OWNER, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

/*
  管理から書いたものが公開側に出たか（消えたか）は `/all` で見る。
  公開中のものが全部1ページに出る URL なので、書いた種類ごとに宛先を選ばずに済む。
*/

describe('認証', () => {
  it('ログインしていなければ管理画面に入れない', async () => {
    const response = await get('/admin/members')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
  })

  it('ログインせずに書き込めない', async () => {
    const response = await get('/admin/items', { method: 'POST', body: form({ title: '侵入' }) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
  })

  it('別のサイトからの送信は受け付けない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '侵入' }),
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })

  it('ログイン画面への CSRF も止める', async () => {
    const response = await get('/admin/login', {
      method: 'POST',
      body: form({ email: OWNER.email, password: OWNER.password }),
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })

  it('間違ったパスワードでは入れない', async () => {
    await signIn()
    const response = await get('/admin/login', {
      method: 'POST',
      body: form({ email: OWNER.email, password: 'wrong' }),
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('owner は二度作れない', async () => {
    await signIn()
    const response = await get('/admin/setup', {
      method: 'POST',
      body: form({
        token: 'test-setup-token',
        email: 'another@example.test',
        password: 'x'.repeat(12),
      }),
    })
    expect(response.status).toBe(404)
  })

  it('ログアウトするとセッションが即座に切れる', async () => {
    const signed = await signIn()
    expect((await signed('/admin/members')).status).toBe(200)
    await signed('/admin/logout', { method: 'POST' })
    expect((await signed('/admin/members')).headers.get('location')).toBe('/admin/login')
  })
})

describe('Members', () => {
  it('追加すると公開側に出る', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: '岡崎 昂功', slug: 'okazaki', role: 'System Engineer', published: '1' }),
    })
    expect(response.status).toBe(303)
    expect(await (await get('/all')).text()).toContain('岡崎 昂功')
  })

  it('slug が重なったら弾き、打った内容は残す', async () => {
    await seedMember({ slug: 'taken' })
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: '重複テスト', slug: 'taken', role: '残ってほしい肩書' }),
    })
    const html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toContain('この slug は既に使われています')
    expect(html).toContain('残ってほしい肩書')
  })

  it('大きすぎる画像は黙って捨てず、保存も止める', async () => {
    const signed = await signIn()
    const body = form({ name: '画像テスト', slug: 'image-test' })
    body.append('avatar', new File([new Uint8Array(1_200_000)], 'big.png', { type: 'image/png' }))

    const response = await signed('/admin/members', { method: 'POST', body })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('1MB まで')
    expect(await (await signed('/admin/members')).text()).not.toContain('image-test')
  })

  it('削除しても、担当していた項目は残る', async () => {
    const member = await seedMember()
    await seedItem({ memberId: member.id, title: '残るアプリ' })

    const signed = await signIn()
    await signed(`/admin/members/${member.id}/delete`, { method: 'POST' })

    expect(await (await get('/all')).text()).toContain('残るアプリ')
    expect((await get('/members/okazaki')).status).toBe(404)
  })
})

describe('Items', () => {
  it('作って、下書きに戻して、消せる', async () => {
    const signed = await signIn()
    await seedMember()

    await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'テスト用アプリ',
        platformKey: 'web',
        published: '1',
        tags: 'Swift, SwiftUI',
        linkLabel: ['Repository', ''],
        linkUrl: ['https://example.com/repo', ''],
      }),
    })
    const html = await (await get('/all')).text()
    expect(html).toContain('テスト用アプリ')
    expect(html).toContain('SwiftUI')
    expect(html).toContain('https://example.com/repo')

    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]
    expect(id).toBeDefined()

    // published を送らなければ下書きに戻る
    await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'テスト用アプリ' }),
    })
    expect(await (await get('/all')).text()).not.toContain('テスト用アプリ')

    await signed(`/admin/items/${id}/delete`, { method: 'POST' })
    expect(await (await signed('/admin/items?type=app')).text()).not.toContain('テスト用アプリ')
  })

  it('存在しない id は 404（500 にも、保存済みの見せかけにもしない）', async () => {
    const signed = await signIn()
    const missing = await signed('/admin/items/99999', {
      method: 'POST',
      body: form({ type: 'app', title: 'x' }),
    })
    expect(missing.status).toBe(404)

    const notANumber = await signed('/admin/items/abc', {
      method: 'POST',
      body: form({ type: 'app', title: 'x' }),
    })
    expect(notANumber.status).toBe(404)
  })

  it('タイトルが空なら弾き、打った内容は残す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '', summary: '消えてはいけない文章', tags: 'KeepMe' }),
    })
    const html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toContain('消えてはいけない文章')
    expect(html).toContain('KeepMe')
  })

  it('タグとリンクは総入れ替えになる', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '入れ替え', published: '1', tags: '古いタグ' }),
    })
    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]

    await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({ type: 'app', title: '入れ替え', published: '1', tags: '新しいタグ' }),
    })

    const html = await (await get('/all')).text()
    expect(html).toContain('新しいタグ')
    expect(html).not.toContain('古いタグ')
  })
})

/*
  作品1件の恒久リンク（slug）を、書く側から見る。

  公開側（test/public.test.ts）が押さえているのは「slug で名指しした URL は
  動かない」こと。こちらで押さえるのは、その slug が必ず付くことと、
  1つの slug が2つの作品を指す状態を保存させないこと。
*/
describe('Items — 恒久リンクの slug', () => {
  it('打たなければ作品名から作る。一覧に貼れる URL が出る', async () => {
    const signed = await signIn()

    expect(await (await signed('/admin/items/new?type=app')).text()).toContain('name="slug"')

    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'App Mixer', published: '1' }),
    })

    // 貼るための URL なので、探しに行かずに読めるところに出す
    expect(await (await signed('/admin/items?type=app')).text()).toContain('/apps/item/app-mixer')
    expect((await get('/apps/item/app-mixer')).status).toBe(200)
  })

  it('日本語だけの題でも、恒久リンクの無い作品は作らない', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'work', title: '開発工程の効率化', published: '1' }),
    })

    // toSlug は空を返す。読めない代わりに重ならない名前にする
    const html = await (await signed('/admin/items?type=work')).text()
    const slug = html.match(/\/works\/item\/([a-z0-9-]+)/)?.[1]
    expect(slug, '恒久リンクが付いていない').toBeDefined()
    expect((await get(`/works/item/${slug}`)).status).toBe(200)
  })

  it('slug が重なったら弾き、打った内容は残す', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer', slug: 'appmixer', published: '1' }),
    })

    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '別のアプリ',
        slug: 'appmixer',
        summary: '消えてはいけない文章',
        published: '1',
      }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain('この slug は既に使われています')
    expect(html).toContain('消えてはいけない文章')
    // 1つの URL が2つの作品を指す状態は保存されない
    expect(await (await get('/apps/item/appmixer')).text()).not.toContain('別のアプリ')
  })

  it('この列より前からある行は、一度保存すれば恒久リンクが付く', async () => {
    // 移行で足した列なので、既にある行の slug は null（埋められる既定値が無い）
    const item = await seedItem({ title: 'AppMixer', published: 1 })
    expect(item.slug).toBeNull()
    expect((await get('/apps/item/appmixer')).status).toBe(404)

    const signed = await signIn()
    // 一覧には「恒久リンクなし」と出ているので、放置されたことに気づける
    expect(await (await signed('/admin/items?type=app')).text()).toContain('恒久リンクなし')

    // 編集画面を開いて、slug の欄に何も足さずに保存し直すだけ
    await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer', published: '1' }),
    })
    expect((await get('/apps/item/appmixer')).status).toBe(200)
  })

  it('同じ slug の行は DB が受け付けない（書く口が増えても最後に効く）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    // フォームの検査より外側の最後の受け。seed.sql も将来の書き口もここを通る
    await expect(
      seedItem({ title: '別のアプリ', slug: 'appmixer', sortOrder: 20 }),
    ).rejects.toThrow()
  })

  it('自分の slug は重なりにしない（付けたあとも編集して保存できる）', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer', slug: 'appmixer', published: '1' }),
    })
    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]

    const response = await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer 2', slug: 'appmixer', published: '1' }),
    })
    expect(response.status).toBe(303)
    expect(await (await get('/apps/item/appmixer')).text()).toContain('AppMixer 2')
  })
})

/*
  構成の「N 画面」と、自由文の長さ。

  置く・外す・並べ替えそのものは test/blocks.test.ts の「管理の構成」にある。
  ここに置くのは、公開ページが1画面に収まることを管理画面側から支える2つ——
  結果を見せること（何画面になったか）と、収まらない中身を入口で止めること。
*/

/*
  一覧の行に出る「N 画面」を、行の順に拾う。

  拾えなかったこと自体を落とす。0件のまま toEqual([]) を通すと、バッジが
  丸ごと消えていてもこのテストは緑のままになる。
*/
const screenBadges = (html: string) => {
  const found = [...html.matchAll(/class="row__col">(\d+) 画面</g)].map((m) => Number(m[1]))
  expect(found.length, '「N 画面」を1つも拾えていない（バッジの形が変わった？）').toBeGreaterThan(0)
  return found
}

// 1画面あたりの件数は src/blocks.ts が正。テストに数を書き写さない
const perScreenOf = (key: string) => {
  const type = blockType(key)
  if (!type || !('perScreen' in type)) throw new Error(`${key} に perScreen が無い`)
  return type.perScreen
}

describe('構成 — 何画面になるかを見せる', () => {
  it('行の「N 画面」は chunk() と同じ数で、合計は公開ページの画面数と一致する', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    // Apps だけ登録する。works と members は0件なので、その2節は画面にならない
    const titles = ['アプリ 1', 'アプリ 2', 'アプリ 3', 'アプリ 4']
    for (const [index, title] of titles.entries()) {
      await seedItem({ title, sortOrder: (index + 1) * 10 })
    }
    const per = perScreenOf('apps')

    const before = await (await signed('/admin/blocks')).text()
    // hero・apps・works・team・contact の順
    expect(screenBadges(before)).toEqual([1, chunk(titles, per).length, 0, 0, 1])
    expect(before).toContain('合計 4 画面')
    // 公開ページが実際に何画面あるか（ページャの読み上げ）と突き合わせる
    expect(await (await get('/')).text()).toContain('4 画面のうち 1 画面目')

    // 1件足すと画面が1枚増える。それが管理画面から見えることがこのテストの主題
    const grown = [...titles, 'アプリ 5']
    await seedItem({ title: 'アプリ 5', sortOrder: 50 })

    const after = await (await signed('/admin/blocks')).text()
    expect(screenBadges(after)).toEqual([1, chunk(grown, per).length, 0, 0, 1])
    expect(after).toContain('合計 5 画面')
    expect(await (await get('/')).text()).toContain('5 画面のうち 1 画面目')
  })

  /*
    画面ごとに割ったあと、置いたものを通しで見る手はここにしか無い。
    「サイトを見る ↗」は入口（/）に着くだけで、そこから全部を見るには
    めくり続けるしかない——並べ替えたあとに確かめるのは全体のほう。
  */
  it('構成から全体ページを開ける', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const html = await (await signed('/admin/blocks')).text()
    expect(html).toContain('href="/all"')
    expect(html).toContain('全体を1ページで見る ↗')
    // 入口への1本も残す。読む人が着くのはこちら
    expect(html).toContain('href="/"')
  })

  it('下書きのブロックは 0 画面と出る', async () => {
    await seedMember()
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    // 見出しだけ送れば下書きに戻る（決まった中身のものは公開/下書きしか変わらない）
    await signed(`/admin/blocks/${team.id}`, { method: 'POST', body: form({}) })

    const html = await (await signed('/admin/blocks')).text()
    // hero・apps(0件)・works(0件)・team(下書き)・contact
    expect(screenBadges(html)).toEqual([1, 0, 0, 0, 1])
    expect(html).toContain('合計 2 画面')
  })

  /*
    自由文の5種を1つずつ突き合わせる。

    「N 画面」は公開ページとは別の関数（blockScreens）が数えている。行の開き方が
    公開側とずれると、置いた本人だけが古い数を見続ける——「13件目を公開したら
    画面が1枚増えた」と気づかせるのがこの表示の存在理由なので、いちばん要る
    ときに嘘をつく。数え方の出どころは src/blocks.ts の blockUnitCount 1本。
  */
  it('自由文のどの種類でも、「N 画面」と公開ページの画面数が一致する', async () => {
    const signed = await signIn()
    const rows = (n: number, make: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => make(i + 1)).join('\n')

    /*
      key は BlockKey。素の string のままだと、打ち間違えた種類名でも
      `.values({ type: one.key })` が通ってしまい、この一覧が
      src/blocks.ts の BLOCK_TYPES から外れても誰も気づかない
    */
    const cases: { key: BlockKey; body: string; screens?: number }[] = [
      { key: 'now', body: rows(perScreenOf('now') + 1, (i) => `いま${i} | 補足`), screens: 2 },
      { key: 'numbers', body: rows(perScreenOf('numbers') + 1, (i) => `${i} | 件 | 説明`) },
      { key: 'timeline', body: rows(perScreenOf('timeline') + 1, (i) => `2024.0${i} | こと`) },
      {
        /*
          段落は1行とはかぎらない。行で数えると、同じ中身でも画面数がずれる
          （メモを割る単位は空行で分けた段落）。だからここは2行ずつの段落にする
        */
        key: 'note',
        body: rows(perScreenOf('note') + 1, (i) => `段落${i}の一文。\n続きの行。`).replaceAll(
          '\n段落',
          '\n\n段落',
        ),
      },
      {
        /*
          通らない URL の行は公開ページが落とす。落ちた行を数えると、ちょうど
          1画面に収まっているのに「2 画面」と出る（この1件だけが 1 画面）
        */
        key: 'links',
        body: `${rows(perScreenOf('links'), (i) => `ラベル${i} | https://example.com/${i}`)}\nだめ | javascript:alert(1)`,
        screens: 1,
      },
    ]

    for (const one of cases) {
      await db().delete(schema.blocks)
      const [block] = await db()
        .insert(schema.blocks)
        .values({ type: one.key, title: '見出し', body: one.body, published: 1, sortOrder: 10 })
        .returning()
      if (!block) throw new Error(`${one.key} を置けなかった`)
      const want = one.screens ?? 2

      const admin = await (await signed('/admin/blocks')).text()
      expect(screenBadges(admin), one.key).toEqual([want])
      expect(admin, one.key).toContain(`合計 ${want} 画面`)

      // 公開ページ側の数。置いてあるのはこの1つだけなので、サイトの画面数と同じ
      const home = await (await get('/')).text()
      if (want > 1) expect(home, one.key).toContain(`${want} 画面のうち 1 画面目`)
      else expect(home, one.key).not.toContain('画面のうち')

      /*
        数えた画面には URL があり、数えていない画面には無い。1画面目は
        /block-<id> ひとつに寄せてあるので、2枚目から先だけを URL で確かめる
      */
      if (want > 1) expect((await get(`/block-${block.id}/${want}`)).status, one.key).toBe(200)
      expect((await get(`/block-${block.id}/${want + 1}`)).status, one.key).toBe(404)
    }
  })
})

// 1画面に出せる字数も src/blocks.ts が正。テストに数を書き写さない
const maxCharsOf = (key: string) => {
  const type = blockType(key)
  if (!type || !('maxChars' in type)) throw new Error(`${key} に maxChars が無い`)
  return type.maxChars
}

describe('構成 — 1画面に収まらない自由文は保存させない', () => {
  it('長すぎるメモは 400 で戻し、打った内容は残す', async () => {
    const signed = await signIn()
    const max = maxCharsOf('note')
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: 'あとがき', body: 'あ'.repeat(max + 1), published: '1' }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain('1画面に収まりません')
    expect(html).toContain('あとがき')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  /*
    上限は「割ったあとの1画面」あたり。段落は1画面に perScreen 個まとめて
    出るので、空行で分けても同じ画面に居る限り合計で見る。ここを段落あたりに
    すると、規則どおり空行で分けた perScreen 倍の字数が素通りする
    （メモなら 3 倍。no-scroll を支える上限がその時点で成り立たなくなる）。
  */
  it('空行で分けても、同じ画面に出るぶんは合計で見る', async () => {
    const signed = await signIn()
    const max = maxCharsOf('note')
    // 2つ合わせて上限をちょうど1字だけ超える。どちらの段落も単独では上限以内
    const half = Math.ceil((max + 1) / 2)

    const split = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'note',
        title: 'あとがき',
        body: `${'あ'.repeat(half)}\n\n${'い'.repeat(half)}`,
        published: '1',
      }),
    })
    expect(split.status).toBe(400)
    expect(await split.text()).toContain('1画面に収まりません')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  /*
    次の画面に回るぶんは、いまの画面の字数ではない。1画面ぶんが上限ちょうどの
    段落を perScreen の倍だけ並べても、画面ごとに見れば上限どおりなので通る。
    ここで落ちるようだと、長いメモがどこにも書けなくなる
  */
  it('次の画面に回るぶんまで足して数えない', async () => {
    const signed = await signIn()
    const per = perScreenOf('note')
    const max = maxCharsOf('note')
    const paragraph = 'あ'.repeat(Math.floor(max / per))

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'note',
        title: 'あとがき',
        body: Array.from({ length: per * 2 }, () => paragraph).join('\n\n'),
        published: '1',
      }),
    })
    expect(response.status).toBe(303)
  })

  it('1行1件のものも、1画面ぶんの合計で止める', async () => {
    const signed = await signIn()
    const per = perScreenOf('now')
    const max = maxCharsOf('now')
    // 1画面ぶんの行に、上限をちょうど1字だけ超える字数を配る
    const line = 'あ'.repeat(Math.ceil((max + 1) / per))

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'now',
        title: 'Now',
        body: Array.from({ length: per }, () => line).join('\n'),
        published: '1',
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('1画面に収まりません')
  })

  /*
    リンク集の URL は href であって、画面に文字としては出ない。数えてしまうと、
    長い URL を1つ置いただけで書ける説明が減る
  */
  it('リンク集は URL を字数に数えない', async () => {
    const signed = await signIn()
    const max = maxCharsOf('links')
    const url = `https://example.com/${'a'.repeat(max)}`

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'links', title: 'Links', body: `ラベル | ${url}`, published: '1' }),
    })
    expect(response.status).toBe(303)
  })

  it('ひとことは一文の長さと、添え書きを足した長さの両方を見る', async () => {
    const signed = await signIn()
    const max = maxCharsOf('statement')

    // 一文そのものが長い（大きく出る一文としての決まり）
    const sentence = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'statement', title: 'あ'.repeat(121), published: '1' }),
    })
    expect(sentence.status).toBe(400)
    expect(await sentence.text()).toContain('120 字まで')

    // 一文は短くても、添え書きと足すと1画面に収まらない
    const together = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'statement',
        title: 'あ'.repeat(100),
        body: 'い'.repeat(max - 100 + 1),
        published: '1',
      }),
    })
    expect(together.status).toBe(400)
    expect(await together.text()).toContain('1画面に収まりません')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  it('上限は書く前に見える（保存を押すまで分からない、にしない）', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/blocks/new?type=now')).text()
    expect(html).toContain(`1画面 ${perScreenOf('now')} 件`)
    expect(html).toContain(`1画面 ${maxCharsOf('now')} 字まで`)
  })
})

/*
  上限は「公開するもの」に掛ける。下書きに戻す道まで塞ぐと、上限より前に
  保存された長い中身を持つ行が、編集フォームからも一覧からも引っ込められなく
  なる（残る手が本文ごと削除だけになる）。
*/
describe('構成 — 上限に引っかかる行でも、引っ込められる', () => {
  const seedLongNote = async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({
        type: 'note',
        title: '前に書いた長いメモ',
        body: 'あ'.repeat(maxCharsOf('note') * 3),
        published: 1,
        sortOrder: 10,
      })
      .returning()
    if (!block) throw new Error('block を作れなかった')
    return block
  }

  it('編集フォームから下書きに戻せる（公開したままは止める）', async () => {
    const block = await seedLongNote()
    const signed = await signIn()
    const body = { type: 'note', title: '前に書いた長いメモ', body: 'あ'.repeat(1200) }

    // 公開したままの保存は、いままでどおり止める
    const keep = await signed(`/admin/blocks/${block.id}`, {
      method: 'POST',
      body: form({ ...body, published: '1' }),
    })
    expect(keep.status).toBe(400)

    // 「公開する」を外した保存は通る
    const draft = await signed(`/admin/blocks/${block.id}`, {
      method: 'POST',
      body: form(body),
    })
    expect(draft.status).toBe(303)

    const row = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) })
    expect(row?.published).toBe(0)
    expect(row?.body).toHaveLength(1200)
  })

  it('一覧のトグルからも、フォームを通らずに切り替えられる', async () => {
    const block = await seedLongNote()
    const signed = await signIn()

    const off = await signed(`/admin/blocks/${block.id}/publish`, {
      method: 'POST',
      body: form({}),
    })
    expect(off.status).toBe(303)
    expect(
      (await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) }))?.published,
    ).toBe(0)

    // 戻すほうも同じ口から。中身は触らない
    const on = await signed(`/admin/blocks/${block.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(on.status).toBe(303)
    const row = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) })
    expect(row?.published).toBe(1)
    expect(row?.body).toHaveLength(maxCharsOf('note') * 3)
  })

  it('一覧にその切り替えの口がある', async () => {
    const block = await seedLongNote()
    const signed = await signIn()
    const html = await (await signed('/admin/blocks')).text()

    expect(html).toContain(`/admin/blocks/${block.id}/publish`)
    expect(html).toContain('下書きにする')
  })

  it('存在しない行の切り替えは 404', async () => {
    const signed = await signIn()
    const response = await signed('/admin/blocks/99999/publish', {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(response.status).toBe(404)
  })
})

/*
  ブロックではない「書く場所」。どちらも1画面に全部出るので、割る先が無い。
*/
describe('項目とメンバー — 書く場所の上限', () => {
  it('長すぎる説明文は止め、打った内容は残す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '長い説明',
        summary: 'あ'.repeat(MAX_CHARS.itemSummary + 1),
        tags: 'KeepMe',
      }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain('カードに収まりません')
    expect(html).toContain('KeepMe')
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('説明文の上限は書く前に見える', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    expect(html).toContain(`maxlength="${MAX_CHARS.itemSummary}"`)
    expect(html).toContain(`${MAX_CHARS.itemSummary} 字まで`)
    // カードは2行で切る。上限まで書けば全部読まれる、とは書かない
    expect(html).toContain(`${MAX_CHARS.itemSummaryVisible} 字までしか出ません`)
  })

  it('紹介文は字数と段落の数の両方で止める', async () => {
    const signed = await signIn()
    const long = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: 'あ'.repeat(MAX_CHARS.memberBio + 1),
      }),
    })
    expect(long.status).toBe(400)
    expect(await long.text()).toContain('1画面に収まりません')

    // 字数が足りていても、段落を増やせば空行のぶんだけ高くなる
    const manyParagraphs = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: Array.from({ length: MAX_CHARS.memberBioParagraphs + 1 }, () => 'あ').join('\n\n'),
      }),
    })
    expect(manyParagraphs.status).toBe(400)
    expect(await manyParagraphs.text()).toContain('段落は')
    expect(await db().select().from(schema.members)).toHaveLength(0)
  })

  it('上限のうちに収まる紹介文は通る', async () => {
    const signed = await signIn()
    const parts = MAX_CHARS.memberBioParagraphs
    // 空行も字として数える（打った文字列そのままの長さで見る）
    const each = Math.floor((MAX_CHARS.memberBio - (parts - 1) * 2) / parts)
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: Array.from({ length: parts }, () => 'あ'.repeat(each)).join('\n\n'),
        published: '1',
      }),
    })
    expect(response.status).toBe(303)
  })
})
