import { beforeEach, describe, expect, it } from 'vitest'
import { CELESTIAL_BODY_KEYS } from '../src/celestial'
import { okText, resetDb, seedMember } from './helpers'

beforeEach(resetDb)

const mainOf = (html: string) => (html.split(/<main[^>]*>/)[1] ?? '').split('</main>')[0] ?? ''

describe('メンバーの天体を公開する', () => {
  it.each(CELESTIAL_BODY_KEYS)('%s の表紙と記号を、名前や顔写真とは別に出す', async (body) => {
    await seedMember({
      name: '星野 光',
      headline: '',
      avatarUrl: '/images/avatars/profile.png',
      celestialBody: body,
      celestialAccent: 'mint',
    })
    const main = mainOf(await okText('/members/okazaki'))
    expect(main).toContain(`<div class="celestial celestial--art" data-celestial-body="${body}"`)
    expect(main).toContain(
      `<span class="celestial celestial--symbol" data-celestial-body="${body}"`,
    )
    expect(main).toContain('data-celestial-accent="mint" aria-hidden="true"')
    expect(main).toContain('src="/images/avatars/profile.png"')
    // The ornament does not enter the accessible heading's text or replace the photo.
    expect(main).toContain('<h1 class="nameplate__name">星野 光</h1>')
    expect(main.match(/<h1\b/g)).toHaveLength(1)
    expect(main).toContain('<section id="about"')
  })

  it('未知の DB 値は既定に戻し、属性や CSS に持ち込まない', async () => {
    await seedMember({ celestialBody: 'future-body', celestialAccent: 'unknown-colour' })
    const main = mainOf(await okText('/members/okazaki'))
    expect(main).toContain('data-celestial-body="black-hole" data-celestial-accent="inherit"')
    expect(main).not.toContain('future-body')
    expect(main).not.toContain('unknown-colour')
    expect(main).toContain('<header class="hero hero--profile">')
  })

  it('複数メンバーの記号は独立し、同じ文書内の id を重複させない', async () => {
    for (const [index, body] of CELESTIAL_BODY_KEYS.entries()) {
      await seedMember({
        slug: `member-${index}`,
        name: `メンバー ${index + 1}`,
        celestialBody: body,
        celestialAccent: index % 2 ? 'sky' : 'ember',
      })
    }
    const main = mainOf(await okText('/team'))
    expect(main.match(/class="celestial celestial--symbol"/g)).toHaveLength(5)
    expect(main).not.toContain('celestial--art')
    for (const body of CELESTIAL_BODY_KEYS) expect(main).toContain(`data-celestial-body="${body}"`)
    const ids = [...main.matchAll(/\bid="([^"]+)"/g)].map((one) => one[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(main).not.toContain('url(#celestial')
  })

  it('全体ページは小さな記号だけを出し、読み物に大きな装飾を挟まない', async () => {
    await seedMember({ celestialBody: 'moon', celestialAccent: 'rose' })
    const main = mainOf(await okText('/all'))
    expect(main).toContain('class="celestial celestial--symbol" data-celestial-body="moon"')
    expect(main).not.toContain('celestial--art')
    expect(main).toContain('data-celestial-accent="rose"')
  })

  it('公開中の単独メンバーの選択を、入口と Contact の中心に揃える', async () => {
    await seedMember({ celestialBody: 'saturn', celestialAccent: 'sky' })
    await seedMember({
      slug: 'draft',
      published: 0,
      celestialBody: 'sun',
      celestialAccent: 'ember',
    })
    for (const path of ['/', '/contact']) {
      const main = mainOf(await okText(path))
      expect(main, path).toContain('class="orbit-center"')
      expect(main, path).toContain('data-celestial-body="saturn" data-celestial-accent="sky"')
      expect(main, path).toContain('data-accent="sky"')
      expect(main, path).not.toContain('data-celestial-body="sun"')
    }
  })

  it('未登録・下書きのみ・複数人では、入口と Contact は既存のブラックホールを維持する', async () => {
    const existing = async () => {
      for (const path of ['/', '/contact']) {
        const main = mainOf(await okText(path))
        expect(main, path).toContain('class="hole"')
        expect(main, path).not.toContain('class="orbit-center"')
      }
    }
    await existing()
    await seedMember({ slug: 'draft', published: 0, celestialBody: 'sun' })
    await existing()
    await seedMember({ celestialBody: 'moon', celestialAccent: 'rose' })
    await seedMember({ slug: 'second', celestialBody: 'neptune', celestialAccent: 'sky' })
    await existing()
  })
})
