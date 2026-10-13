import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { inline, plainText, prose } from '../src/lib/markdown'
import { db, okText, resetDb, seedItem, seedMember, touch } from './helpers'

/*
  長い文章の欄（紹介文・作品の本文・メモ）の小さな Markdown（src/lib/markdown.ts）。
  読むのは箇条書き・太字・リンクだけで、HTML の文字列は作らない
*/
describe('段落の中を開く', () => {
  it('記号の無い段落は、1つの文のまま', () => {
    expect(prose('コンピュータサイエンスを専攻し、\n開発に携わっています。')).toEqual([
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'text', text: 'コンピュータサイエンスを専攻し、\n開発に携わっています。' },
        ],
      },
    ])
  })

  it('続いた「- 」の行は1つの箇条書き。前後の文は段落のまま', () => {
    expect(prose('取り組んだこと:\n- 画面の自動テスト\n- 設計書の変換\n以上です。')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '取り組んだこと:' }] },
      {
        kind: 'list',
        items: [
          [{ kind: 'text', text: '画面の自動テスト' }],
          [{ kind: 'text', text: '設計書の変換' }],
        ],
      },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '以上です。' }] },
    ])
  })

  it('太字とリンクを読み、中に入れ子にもできる', () => {
    expect(inline('**生成 AI** で[AppMixer](/apps/item/appmixer)を作った')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: '生成 AI' }] },
      { kind: 'text', text: ' で' },
      {
        kind: 'link',
        href: '/apps/item/appmixer',
        children: [{ kind: 'text', text: 'AppMixer' }],
      },
      { kind: 'text', text: 'を作った' },
    ])
    expect(inline('[**太字の**リンク](https://example.com)')).toEqual([
      {
        kind: 'link',
        href: 'https://example.com',
        children: [
          { kind: 'strong', children: [{ kind: 'text', text: '太字の' }] },
          { kind: 'text', text: 'リンク' },
        ],
      },
    ])
  })

  it('受け取れない URL のリンクと、閉じていない記号は字のまま', () => {
    expect(inline('[押して](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[押して](javascript:alert(1))' },
    ])
    expect(inline('**閉じない')).toEqual([{ kind: 'text', text: '**閉じない' }])
    expect(inline('-5度でも箇条書きにしない')).toEqual([
      { kind: 'text', text: '-5度でも箇条書きにしない' },
    ])
    expect(prose('-5度の朝')[0]?.kind).toBe('paragraph')
  })

  it('説明文と題には、記号を外した字を使う', () => {
    expect(plainText('**生成 AI** で[AppMixer](/apps/item/appmixer)を作った')).toBe(
      '生成 AI でAppMixerを作った',
    )
    expect(plainText('取り組み:\n- 自動テスト\n- 変換')).toBe('取り組み: 自動テスト 変換')
  })
})

describe('公開ページでの描き方', () => {
  beforeEach(resetDb)

  it('紹介文の太字・リンク・箇条書きを要素にし、HTML は字のまま', async () => {
    await seedMember({
      slug: 'rich',
      bio: '**生成 AI** で効率化しています。詳しくは[AppMixer](/apps/item/appmixer)と[GitHub](https://github.com/iam74k4)。\n\n取り組み:\n- 画面の自動テスト\n- 設計書の変換\n\n<script>alert(1)</script>',
    })
    const html = await okText('/members/rich')
    const about = html.slice(html.indexOf('id="about"'))
    expect(about).toContain('<strong>生成 AI</strong>')
    // サイトの中は同じタブ、外は別タブ（作品の行き先と同じ決め方）
    expect(about).toContain('<a href="/apps/item/appmixer">AppMixer</a>')
    expect(about).toContain(
      '<a href="https://github.com/iam74k4" rel="noreferrer" target="_blank">GitHub</a>',
    )
    expect(about).toContain('<ul><li>画面の自動テスト</li><li>設計書の変換</li></ul>')
    expect(about).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(about).not.toContain('<script>alert(1)')
    // 説明文には記号を外した字
    expect(html).toMatch(/<meta name="description" content="[^"]*生成 AI で効率化しています/)
    expect(html).not.toMatch(/<meta name="description" content="[^"]*\*\*/)
  })

  it('作品の本文とメモでも読む。作品の説明（目録の2文）は字のまま', async () => {
    await seedItem({
      slug: 'rich-item',
      summary: '**太字にしない**説明。',
      storyApproach: '**自動化**しました。\n- 一覧\n- 詳細',
    })
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'projects', title: '', body: '', published: 1, sortOrder: 10 },
        {
          type: 'note',
          title: 'メモ',
          body: '[リンク](/projects)と**太字**。',
          published: 1,
          sortOrder: 20,
        },
      ])
    await touch()
    const page = await okText('/apps/item/rich-item')
    const story = page.slice(page.indexOf('id="story"'))
    expect(story).toContain('<strong>自動化</strong>')
    expect(story).toContain('<ul><li>一覧</li><li>詳細</li></ul>')
    // 説明は一覧の行と同じ字のまま
    expect(page).toContain('**太字にしない**説明。')
    const blocks = await db().select().from(schema.blocks)
    const note = blocks.find((one) => one.type === 'note')
    // メモのページ（打ち込むブロックは /block-<id>）と全体ページ
    for (const path of [`/block-${note?.id}`, '/all']) {
      expect(await okText(path), path).toContain(
        '<a href="/projects">リンク</a>と<strong>太字</strong>。',
      )
    }
  })
})
