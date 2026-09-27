import { describe, expect, it } from 'vitest'
import { type Page, tableOfContents } from '../src/lib/sequence'

/*
  サイトのページの並びと目次。トップも個人ページも作品のページも、この1本で
  目次と印を組んでいる。

  ここが壊れると、どのページでも目次の行と印が同時に狂う。DOM も DB も要らない
  純関数なので、境界だけを直接突く。
*/

const page = (key: string, href: string, nav: string | null = key): Page => ({
  key,
  href,
  canonical: href,
  nav,
  title: `${key} — Noctifex`,
})

const PAGES: Page[] = [
  page('hero', '/', null),
  page('projects', '/projects', 'Projects'),
  page('profile', '/members/okazaki', 'Profile'),
  page('contact', '/contact', 'Contact'),
]

describe('目次', () => {
  it('名前のあるページを並びの順に1行ずつ。名前の無いページ（Hero・ひとこと）は出さない', () => {
    expect(tableOfContents(PAGES, null).map((link) => [link.label, link.href])).toEqual([
      ['Projects', '/projects'],
      ['Profile', '/members/okazaki'],
      ['Contact', '/contact'],
    ])
  })

  it('印は key が一致する行にだけ付く', () => {
    const toc = tableOfContents(PAGES, 'profile')
    expect(toc.filter((link) => link.active).map((link) => link.label)).toEqual(['Profile'])
  })

  /*
    並びの外のページ（Team を置いていないサイトの個人ページ・一覧を外したサイトの
    作品のページ）は、借りる行が無いので印はどこにも付かない
  */
  it('並びに無い key なら、どの行にも印は付かない。null も同じ', () => {
    expect(tableOfContents(PAGES, 'team').some((link) => link.active)).toBe(false)
    expect(tableOfContents(PAGES, null).some((link) => link.active)).toBe(false)
  })

  it('名前の無いページに印を付けても、目次には出ない（入口では目次に印が無い）', () => {
    expect(tableOfContents(PAGES, 'hero').some((link) => link.active)).toBe(false)
  })
})

describe('並びの重なり', () => {
  it('同じ URL が2度並んだ並びは、組む前に例外にする（目次に同じ行き先を2行出さない）', () => {
    const twice = [...PAGES, page('projects-2', '/projects', 'Projects')]
    expect(() => tableOfContents(twice, null)).toThrow(/同じ URL/)
  })

  it('同じ key が2度並んだ並びも例外にする（印が2行に付く）', () => {
    const twice = [...PAGES, page('contact', '/contact-2', 'Contact')]
    expect(() => tableOfContents(twice, null)).toThrow(/同じ key/)
  })

  it('重なりの無い並びはそのまま組める', () => {
    expect(() => tableOfContents(PAGES, null)).not.toThrow()
  })
})
