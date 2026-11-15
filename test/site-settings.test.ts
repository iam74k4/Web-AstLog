import { beforeEach, describe, expect, it } from 'vitest'
import { settingsVersion } from '../src/db/edit'
import { loadSiteSettings, saveSiteSettings } from '../src/db/queries'
import * as schema from '../src/db/schema'
import { parsePairs } from '../src/lib/format'
import { AVAILABILITY, SITE, SITE_SETTING_LIMITS, type SiteSettings } from '../src/site'
import { ADMIN_BEHAVIOR } from '../src/ui/admin-behavior'
import {
  db,
  form,
  get,
  okText,
  resetDb,
  seedItem,
  seedMember,
  signIn,
  TEST_SITE,
  touch,
} from './helpers'

beforeEach(resetDb)

const configured: SiteSettings = {
  tagline: '小さなものを、丁寧につくる。',
  heroLead: '開発したサービスと取り組みを紹介しています。',
  heroRoles: 'System Engineer\niOS Developer',
  contactLead: '開発に関するご相談をお待ちしています。',
  email: 'hello@example.test',
  github: 'https://github.com/astlog-example',
  instagram: 'https://www.instagram.com/astlog.example',
  x: 'https://x.com/astlog_example',
  discord: 'astlog_example',
  availability: 'open',
  availabilityReply: '2日以内',
  availabilityHours: '平日の夜と土日',
  availabilityFormat: 'オンライン',
  contactSteps:
    'ご連絡 | メールで一言いただければ十分です。\nお話し | オンラインで30分ほど伺います。',
}

const plain = (html: string) => html.replace(/<[^>]*>/g, '')

const emptyAvailability = {
  availability: '',
  availabilityReply: '',
  availabilityHours: '',
  availabilityFormat: '',
}

// サイト設定のフォームの形。相談の流れは組ごとの欄で送る（src/routes/admin/site-settings.tsx の readSiteForm）
const siteForm = ({ contactSteps, ...rest }: SiteSettings) => {
  const steps = parsePairs(contactSteps)
  return form({
    ...rest,
    stepTitle: steps.map((step) => step.title),
    stepText: steps.map((step) => step.text),
  })
}

describe('サイト設定', () => {
  it('空の DB は個人データや無効な連絡先リンクを公開しない', async () => {
    await db().delete(schema.settings)
    await touch()
    expect(await loadSiteSettings(db())).toEqual({
      tagline: SITE.tagline,
      heroLead: SITE.heroLead,
      heroRoles: '',
      contactLead: SITE.contactLead,
      email: '',
      github: '',
      instagram: '',
      x: '',
      discord: '',
      availability: '',
      availabilityReply: '',
      availabilityHours: '',
      availabilityFormat: '',
      contactSteps: '',
    })
    for (const path of ['/', '/all']) {
      const html = await okText(path)
      expect(html).not.toContain('iam74k4')
      expect(html).not.toContain('noctifex.dev')
      expect(html).not.toContain('href="mailto:')
      expect(html).not.toContain('/assets/avatar.png')
      // 連絡の手が無いのに誘うページは作らない（src/blocks.ts の blockShown）
      expect(html).not.toContain('href="/contact"')
    }
    expect((await get('/contact')).status).toBe(404)
  })

  it('ログインと送信元の検査を通ってから編集できる', async () => {
    expect((await get('/admin/site')).status).toBe(303)
    expect((await get('/admin/site', { method: 'POST', body: siteForm(configured) })).status).toBe(
      303,
    )
    const signed = await signIn()
    expect((await signed('/admin/site')).status).toBe(200)
    expect(await (await signed('/')).text()).toContain('class="top__admin" href="/admin/site"')
    expect(
      (
        await signed('/admin/site', {
          method: 'POST',
          body: siteForm(configured),
          headers: { origin: 'https://other.example' },
        })
      ).status,
    ).toBe(403)
    expect((await loadSiteSettings(db())).email).not.toBe(configured.email)
  })

  it('保存した文言と連絡先をすべての公開ページ・メタデータに反映する', async () => {
    const signed = await signIn()
    const response = await signed('/admin/site', { method: 'POST', body: siteForm(configured) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/site?saved=1')
    expect(await loadSiteSettings(db())).toEqual(configured)
    const member = await seedMember({ github: configured.github, email: configured.email })
    await seedItem({ slug: 'sample', summary: '作品の説明。' })
    for (const path of ['/', '/all', '/projects', `/members/${member.slug}`, '/apps/item/sample']) {
      const html = await okText(path)
      expect(html).toContain(`href="mailto:${configured.email}"`)
      expect(html).toContain(`href="${configured.github}"`)
      expect(html).not.toContain('contact@example.test')
      // 足元の行き先は GitHub → Instagram → X → メール の順
      const foot = html.slice(html.indexOf('<footer class="foot"'))
      const at = (needle: string) => foot.indexOf(needle)
      expect(at(`href="${configured.github}"`), path).toBeGreaterThan(-1)
      expect(at(`href="${configured.instagram}"`), path).toBeGreaterThan(
        at(`href="${configured.github}"`),
      )
      expect(at(`href="${configured.x}"`), path).toBeGreaterThan(
        at(`href="${configured.instagram}"`),
      )
      expect(at(`href="mailto:${configured.email}"`), path).toBeGreaterThan(
        at(`href="${configured.x}"`),
      )
    }
    // 1人のサイトの名乗り（構造化データ）は、Instagram と X も同じ人の別の口として並べる
    expect(await okText('/')).toContain(
      `"sameAs":["${configured.github}","${configured.instagram}","${configured.x}"]`,
    )
    const top = await okText('/')
    expect(plain(top)).toContain(configured.heroLead)
    expect(top).toContain(`"description":"${configured.heroLead}"`)
    const contact = await okText('/contact')
    // 案内文は見出しと表のあいだに出し、説明文にも使う
    expect(plain(contact)).toContain(configured.contactLead)
    expect(contact).toContain(`name="description" content="${configured.contactLead}"`)
    expect((contact.match(/href="mailto:/g) ?? []).length).toBe(1)
    // 足元と、左の柱（900 以上で足元の代わりに見える。src/ui/Layout.tsx の Pillar）に1つずつ
    expect((await okText(`/members/${member.slug}`)).match(/href="mailto:/g)).toHaveLength(2)
    expect((await okText('/all')).match(/href="mailto:/g)).toHaveLength(2)
  })

  it('連絡先を消すとリンクと構造化データからも外れる', async () => {
    await saveSiteSettings(db(), configured)
    await touch()
    await okText('/')
    const signed = await signIn()
    expect(
      (
        await signed('/admin/site', {
          method: 'POST',
          body: siteForm({
            ...configured,
            email: '',
            github: '',
            instagram: '',
            x: '',
            discord: '',
          }),
        })
      ).status,
    ).toBe(303)
    const html = await okText('/')
    expect(html).not.toContain('href="mailto:')
    expect(html).not.toContain('"sameAs"')
    // 連絡の手が無くなったので、Contact のページも目次の行も無くなる
    expect(html).not.toContain('href="/contact"')
    expect((await get('/contact')).status).toBe(404)
  })

  it('入口の紹介文は空にでき、空ならリード文・説明文・構造化データから外れる', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    await saveSiteSettings(db(), configured)
    await touch()
    expect(await okText('/')).toContain('class="hero__lead"')
    const signed = await signIn()
    const response = await signed('/admin/site', {
      method: 'POST',
      body: siteForm({ ...configured, heroLead: '' }),
    })
    expect(response.status).toBe(303)
    expect((await loadSiteSettings(db())).heroLead).toBe('')
    for (const path of ['/', '/all']) {
      const html = await okText(path)
      expect(html, path).not.toContain('class="hero__lead"')
      expect(html, path).not.toContain(configured.heroLead)
    }
    const top = await okText('/')
    // 説明文は名乗りだけ。「。」で終わり、空の文を足さない
    expect(top).toContain(
      'name="description" content="岡崎 昂功（System Engineer）のポートフォリオ。"',
    )
    // 空の description を名乗らない
    expect(top).not.toMatch(/"@type":"Person"[^}]*"description"/)
  })

  it('不正な URL・メールや長すぎる文は保存せず、入力欄で理由を返す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/site', {
      method: 'POST',
      body: form({
        ...configured,
        tagline: 'あ'.repeat(SITE_SETTING_LIMITS.tagline + 1),
        email: 'hello@example.test?bcc=other@example.test',
        github: 'javascript:alert(1)',
        instagram: 'instagram.com/astlog',
        x: 'http://x.com/astlog',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('80 字まで')
    expect(html).toContain('メールアドレスを1つ')
    // GitHub・Instagram・X の3欄とも、欄ごとに理由を返す
    expect(html.match(/https:\/\/ で始まる URL/g)?.length).toBeGreaterThanOrEqual(3)
    expect((await loadSiteSettings(db())).email).toBe('contact@example.test')
  })

  it('手動で入った不正な連絡先も公開時に落とす', async () => {
    await db().delete(schema.settings)
    await db()
      .insert(schema.settings)
      .values([
        { key: 'site.email', value: 'person@example.test?subject=unexpected' },
        { key: 'site.github', value: '//evil.example' },
        { key: 'site.instagram', value: 'javascript:alert(1)' },
        { key: 'site.x', value: '//evil.example/x' },
      ])
    await touch()
    // 形の通らない連絡先は無いものとして数える（src/site.ts の hasContact）。Contact は出ない
    expect((await get('/contact')).status).toBe(404)
    for (const path of ['/', '/all']) {
      const html = await okText(path)
      expect(html).not.toContain('href="mailto:')
      expect(html).not.toContain('evil.example')
      expect(html).not.toContain('javascript:')
    }
  })

  it('メンバーのメールも同じ単一宛先の検査を通す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '新しい人',
        slug: 'new-member',
        email: 'person@example.test?bcc=other@example.test',
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('メールアドレスを1つ')
    expect(await db().query.members.findMany()).toHaveLength(0)
  })
})

/*
  入口で打ち替える言葉（サイト設定の heroRoles。Cavani の入口）。言葉は1行に1つで、
  大見出しの下で1字ずつ打っては消す。改行させずに組むので、言葉の数と長さに上限がある
  （src/site.ts の HERO_ROLES）。
*/
describe('入口で打ち替える言葉', () => {
  const words = ['System Engineer', 'iOS / macOS Developer', 'AI Workflow Engineer']
  const withRoles = (heroRoles: string) => saveSiteSettings(db(), { ...TEST_SITE, heroRoles })

  it('言葉を1字ずつの列にして大見出しの下に置き、読み上げには1行で渡す', async () => {
    await seedMember()
    await withRoles(words.join('\r\n'))
    await touch()
    const html = await okText('/')
    expect(html).toContain('<p class="typed" lang="en">')
    /*
      区切りは「, 」。「 / 」でつないでいたころは、言葉の中の「/」と区別が付かず、
      3つの言葉が「System Engineer / iOS / macOS Developer / …」と4つに読めた
    */
    expect(html).toContain(
      '<span class="sr-only">System Engineer, iOS / macOS Developer, AI Workflow Engineer</span>',
    )
    expect(html).toContain(
      '<span class="typed__words typed__words--3" aria-hidden="true" style="--words: 3">',
    )
    expect(html).toContain('<span class="typed__word" style="--k: 2; --len: 20">')
    // 大見出しのあと、リード文の前
    expect(html.indexOf('class="typed"')).toBeGreaterThan(html.indexOf('</h1>'))
    expect(html.indexOf('class="typed"')).toBeLessThan(html.indexOf('class="hero__lead"'))
    // 札から肩書きを外す（打ち替える言葉の1つ目と同じ語を2度言わない）
    expect(html).not.toContain('<span lang="en">System Engineer</span>')
  })

  it('言葉が無ければ出さず、札に肩書きを出す。1つなら打ち替えずに置くだけ', async () => {
    await seedMember()
    const none = await okText('/')
    expect(none).not.toContain('class="typed"')
    expect(none).toContain('<span lang="en">System Engineer</span>')

    await withRoles('System Engineer')
    await touch()
    const one = await okText('/')
    expect(one).toContain('<span class="typed__words" aria-hidden="true" style="--words: 1">')
    expect(one).not.toContain('typed__words--')
  })

  it('和文を含む言葉は、読み上げの1行を「、」でつなぐ', async () => {
    await seedMember()
    await withRoles('システムエンジニア\r\niOS / macOS Developer')
    await touch()
    const html = await okText('/')
    expect(html).toContain('<p class="typed">')
    expect(html).toContain('<span class="sr-only">システムエンジニア、iOS / macOS Developer</span>')
  })

  it('言葉は4つまで、1つは半角24字（全角12字）まで。管理画面で止めて欄を示す', async () => {
    const signed = await signIn()
    for (const [heroRoles, message] of [
      ['a\nb\nc\nd\ne', '言葉は 4 つまで'],
      ['Senior Software Engineers', '半角 24 字'],
      ['とても長い日本語の肩書きの言葉です', '全角 12 字'],
    ] as const) {
      const response = await signed('/admin/site', {
        method: 'POST',
        body: form({ ...TEST_SITE, heroRoles }),
      })
      expect(response.status, heroRoles).toBe(400)
      expect(await response.text(), heroRoles).toContain(message)
    }
    // 上限ちょうどは通る（4つ・半角24字・全角12字）
    const ok = await signed('/admin/site', {
      method: 'POST',
      body: form({
        ...TEST_SITE,
        heroRoles: 'Senior Software Engineer\r\n日本語の肩書きは十二字迄\r\nC\r\nD',
      }),
    })
    expect(ok.status).toBe(303)
  })
})

/*
  Discord はユーザー名から開ける URL が無い。Contact の表に名前を字で出し（リンクにしない）、
  足元の印はその行（/contact#discord）へ送る。Discord だけでも Contact のページを作る
*/
describe('Discord', () => {
  it('Contact に名前を字で出し、足元の印はその行へ送る', async () => {
    await saveSiteSettings(db(), { ...TEST_SITE, discord: 'iam74k4' })
    await touch()
    const contact = await okText('/contact')
    expect(contact).toMatch(
      /<div class="contact-list__row" id="discord"><dt lang="en"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Discord<\/dt><dd>iam74k4<\/dd><\/div>/,
    )
    // Contact のページの足元には行き先を出さない（表と同じ行き先を2つ置かない）
    expect(contact).not.toContain('href="/contact#discord"')
    const top = await okText('/')
    expect(top).toContain('<a href="/contact#discord" title="Discord: iam74k4">')
    // 足元の並びは GitHub → Instagram → X → Discord → Mail
    const foot = top.slice(top.indexOf('<footer'))
    expect(foot.indexOf('github.com')).toBeLessThan(foot.indexOf('/contact#discord'))
    expect(foot.indexOf('/contact#discord')).toBeLessThan(foot.indexOf('mailto:'))
  })

  it('Discord だけでも Contact のページを作る', async () => {
    await saveSiteSettings(db(), { ...SITE, discord: 'iam74k4' })
    await touch()
    expect(await okText('/')).toContain('href="/contact"')
    expect(await okText('/contact')).toContain('<dd>iam74k4</dd>')
  })

  it('ユーザー名の形でないものは保存せず、理由を返す', async () => {
    const signed = await signIn()
    for (const discord of ['@iam74k4', 'iam74k4#1234', 'https://discord.com/users/1', 'a']) {
      const response = await signed('/admin/site', {
        method: 'POST',
        body: siteForm({ ...configured, discord }),
      })
      expect(response.status, discord).toBe(400)
      expect(await response.text(), discord).toContain('Discord のユーザー名を入れてください')
    }
  })
})

/*
  Contact の受付状況（Availability）と相談の流れ（How it works）。どちらもサイト設定で書いた
  ときだけ出す。受付の状態は選ぶだけで、文は src/site.ts の AVAILABILITY が決める。状態は
  よく変わるので、概要の「受付状況」から受付状況の4つの欄だけを1回で保存できる
*/
describe('受付状況と相談の流れ', () => {
  it('書いた行だけを、連絡先の表の横（受付状況）と下（相談の流れ）に出す', async () => {
    await saveSiteSettings(db(), configured)
    await touch()
    const html = await okText('/contact')
    const at = (needle: string) => html.indexOf(needle)
    expect(html).toContain('<h2 class="side-head" lang="en">Availability</h2>')
    expect(html).toContain(
      `<dt lang="en">Status</dt><dd><span class="availability__dot availability__dot--open" aria-hidden="true"></span>${AVAILABILITY.open.text}</dd>`,
    )
    expect(html).toContain('<dt lang="en">Response</dt><dd>2日以内</dd>')
    expect(html).toContain('<dt lang="en">Hours</dt><dd>平日の夜と土日</dd>')
    expect(html).toContain('<dt lang="en">Format</dt><dd>オンライン</dd>')
    // 並びに意味がある組なので <ol>。番号は見た目だけ（読み上げは ol が渡す）
    expect(html).toContain(
      '<h2 class="side-head" lang="en">How it works</h2><ol class="pairs pairs--numbered">',
    )
    expect(html).toContain(
      '<li class="pairs__item"><span class="pairs__number" aria-hidden="true">01</span><strong class="pairs__title">ご連絡</strong><span class="pairs__text">メールで一言いただければ十分です。</span></li>',
    )
    expect(html).toContain('<span class="pairs__number" aria-hidden="true">02</span>')
    // 表 → 受付状況（同じ段の横）→ 相談の流れ（下の段）
    expect(at('class="contact-list"')).toBeLessThan(at('class="availability"'))
    expect(at('class="availability"')).toBeLessThan(at('class="steps"'))
    expect(at('class="contact__body"')).toBeLessThan(at('class="availability"'))
    // ページの h1 は1つのまま。全体ページでは Contact が h2 なので小見出しは h3
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
    const whole = await okText('/all')
    expect(whole).toContain('<h3 class="side-head" lang="en">Availability</h3>')
    expect(whole).toContain('<h3 class="side-head" lang="en">How it works</h3>')
  })

  it('書いていない行は出さず、4つとも空なら受付状況ごと出さない', async () => {
    await saveSiteSettings(db(), {
      ...configured,
      availability: '',
      availabilityHours: '',
      availabilityFormat: '',
      contactSteps: '',
    })
    await touch()
    const some = await okText('/contact')
    expect(some).toContain('<dt lang="en">Response</dt>')
    expect(some).not.toContain('<dt lang="en">Status</dt>')
    expect(some).not.toContain('<dt lang="en">Hours</dt>')
    expect(some).not.toContain('class="steps"')

    await saveSiteSettings(db(), { ...configured, ...emptyAvailability })
    await touch()
    expect(await okText('/contact')).not.toContain('class="availability"')
  })

  it('状態ごとに点の形と文が決まっている。知らない状態は保存させない', async () => {
    for (const state of Object.keys(AVAILABILITY) as (keyof typeof AVAILABILITY)[]) {
      await saveSiteSettings(db(), { ...configured, availability: state })
      await touch()
      const html = await okText('/contact')
      expect(html, state).toContain(`availability__dot--${state}`)
      expect(html, state).toContain(AVAILABILITY[state].text)
    }
    const signed = await signIn()
    const response = await signed('/admin/site', {
      method: 'POST',
      body: siteForm({ ...configured, availability: 'busy' }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('受付の状態を選び直してください')
  })

  it('相談の流れは見出しと説明の組の欄で受け、説明だけの行と見出しの「|」は何行目かを言って止める', async () => {
    const signed = await signIn()
    const sent = await signed('/admin/site', {
      method: 'POST',
      body: form({
        ...configured,
        contactSteps: '',
        stepTitle: ['ご連絡', '', 'お話し'],
        stepText: ['メールで。', '', 'オンラインで。'],
      }),
    })
    expect(sent.status).toBe(303)
    // 空いた行は畳み、1行1件の形で持つ
    expect((await loadSiteSettings(db())).contactSteps).toBe(
      'ご連絡 | メールで。\nお話し | オンラインで。',
    )

    const before = await loadSiteSettings(db())
    const broken = await signed('/admin/site', {
      method: 'POST',
      body: form({
        ...configured,
        contactSteps: '',
        stepTitle: ['ご連絡', '', 'a|b'],
        stepText: ['メールで。', '説明だけ', 'x'],
      }),
    })
    expect(broken.status).toBe(400)
    const page = await broken.text()
    expect(page).toContain('2 行目は見出しを入れてください')
    expect(page).toContain('3 行目の見出しに「|」は使えません')
    // 打った説明は欄に残して返す
    expect(page).toMatch(/<textarea[^>]*>説明だけ<\/textarea>/)
    expect(await loadSiteSettings(db())).toEqual(before)
  })

  it('サイト設定の節は、触れると横の完成形をその欄が出る画面へ替える', async () => {
    const signed = await signIn()
    const page = await (await signed('/admin/site')).text()
    expect(page).toContain('<section class="form-section" data-preview-screen="hero">')
    expect(page.match(/data-preview-screen="contact"/g)).toHaveLength(3)
    // 替えるのは管理画面の補助（許可したハッシュの1本）。補助が動かなければ頭の選択で選ぶ
    expect(ADMIN_BEHAVIOR).toContain("document.querySelectorAll('[data-preview-screen]')")
    expect(page).toContain('欄に触れると、その欄が出る画面に切り替わります')
  })

  it('組の説明の欄は2行。打った改行は文の継ぎ目に畳んで1組1行で持つ', async () => {
    const signed = await signIn()
    const sent = await signed('/admin/site', {
      method: 'POST',
      body: form({
        ...configured,
        contactSteps: '',
        stepTitle: ['ご連絡'],
        stepText: ['メールで、\r\nやりたいことを一言。\r\nDiscord\r\nでも。'],
      }),
    })
    expect(sent.status).toBe(303)
    expect((await loadSiteSettings(db())).contactSteps).toBe(
      'ご連絡 | メールで、やりたいことを一言。 Discord でも。',
    )
    const page = await (await signed('/admin/site')).text()
    expect(page).toMatch(/<textarea class="input input--area" name="stepText" rows="2"/)
  })

  it('概要の「受付状況」から、受付状況の4つの欄だけを1回で保存できる', async () => {
    await saveSiteSettings(db(), configured)
    await touch()
    const signed = await signIn()
    const dashboard = await (await signed('/admin')).text()
    expect(dashboard).toContain('<form method="post" action="/admin/site/availability"')
    expect(dashboard).toMatch(/<input type="radio" name="availability" value="open" checked=""\/>/)
    expect(dashboard).toContain(AVAILABILITY.closed.text)

    const response = await signed('/admin/site/availability', {
      method: 'POST',
      body: form({
        availability: 'closed',
        availabilityReply: '1週間以内',
        availabilityHours: '',
        availabilityFormat: 'オンライン',
      }),
    })
    expect(response.status).toBe(303)
    // 頭の知らせ（保存しました）が見えるよう、節へは飛ばさない（節は概要の2つ目で、頭のすぐ下）
    expect(response.headers.get('location')).toBe('/admin?availability=saved')
    // 受付状況の欄だけが変わる（ほかの欄は送っていないが消えない）
    expect(await loadSiteSettings(db())).toEqual({
      ...configured,
      availability: 'closed',
      availabilityReply: '1週間以内',
      availabilityHours: '',
    })
    // 公開ページの写しの版も上がる（管理画面の書き込み。touchSiteOnWrite）
    const contact = await okText('/contact')
    expect(contact).toContain('availability__dot--closed')
    expect(contact).toContain(AVAILABILITY.closed.text)
    expect(contact).not.toContain('平日の夜と土日')
    expect(await (await signed('/admin?availability=saved')).text()).toContain(
      '受付状況を保存しました',
    )
  })

  it('概要で受付状況を変えたあと、開いたままのサイト設定は上書きせず競合を返す', async () => {
    await saveSiteSettings(db(), configured)
    const signed = await signIn()
    const opened = await settingsVersion(db(), 'site.')
    await signed('/admin/site/availability', {
      method: 'POST',
      body: form({ ...emptyAvailability, availability: 'closed' }),
    })
    const stale = await signed('/admin/site', {
      method: 'POST',
      body: (() => {
        const body = siteForm(configured)
        body.set('_version', opened)
        return body
      })(),
    })
    expect(stale.status).toBe(409)
    expect((await loadSiteSettings(db())).availability).toBe('closed')
  })

  it('知らない状態を概要から送ると、サイト設定の画面で欄を示して返し、何も書かない', async () => {
    await saveSiteSettings(db(), configured)
    const before = await loadSiteSettings(db())
    const signed = await signIn()
    const response = await signed('/admin/site/availability', {
      method: 'POST',
      body: form({ ...emptyAvailability, availability: 'busy' }),
    })
    expect(response.status).toBe(400)
    const page = await response.text()
    expect(page).toContain('受付の状態を選び直してください')
    expect(page).toContain('action="/admin/site"')
    expect(await loadSiteSettings(db())).toEqual(before)
  })
})
