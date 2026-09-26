/*
  check:fit の2本目の中身。**上限ちょうどの、複数人のサイト**。

  seed.sql は本人のサイトそのもの（1人・打ち込むブロック0本・本文0件）で、
  それだけを測っていたころは、打ち込むブロック6種・3人以上の Team・作品の本文の
  画面・上限ちょうどの字数は一度も測られていなかった。src/blocks.ts の maxChars は
  手で測った数で、字の段や余白を動かす変更が来ても、検査はその姿を見ないまま
  緑を出した。

  だからこの中身は**上限の数から作る**（src/blocks.ts を読む。書き写さない）。
  上限を変えた日に、検査は新しい上限で測る。

  - 打ち込むブロック6種を、上限ちょうどで2形ずつ。同じ字数でも1つに寄せたほうが
    高くつくことがある（行末の空きが寄る）ので、均等に割った形と1つに寄せた形の
    両方を置く。見出しも上限の長さ（MAX_CHARS.blockHeading）
  - メンバー6人（Team の1画面ぶん・グリッド）。うち2人は長い肩書き・上限の大見出し・
    上限の紹介文・技術3塊・上限の経歴を、均等に割った形と寄せた形で持つ
  - 作品5件。1画面目は、画像あり・説明 100 字・実績値・タグ3つ・リンク3本・担当者名の
    カード2枚（いちばん重いカードの行）。2画面目は画像の有る無しが混ざる行。
    本文は上限（300 字・3段落）を2形で持ち、1件は 390 で2行に折れる長い作品名

  文は実際の文に近い和文（英字まじり）で作る。段落は word-break: auto-phrase で
  文節の切れ目でだけ折れるので、「あ」を並べた文より行末に空きが出て、行が増える。
  同じ数を測るなら重いほうで測る。

  書いてあるのは検査のための作り話で、本人の中身ではない。seed.sql とは混ぜない
  （check:fit はこの中身を使い捨ての D1 に入れ、手元の D1 には触らない）。
*/

import { importTs } from './ts-import.mjs'

const {
  BLOCK_TYPES,
  MAX_CHARS,
  MEMBER_PER_SCREEN,
  MAX_STATEMENT_SENTENCE,
  blockType,
  publishErrors,
  screenChars,
} = await importTs('src/blocks.ts')

const len = (text) => [...text].length

// 検査のための文。実在の人・作品の文ではない
const CORPUS = [
  '設計書を Markdown に変換し、画面コードの生成とテストの支援を組み合わせて工程を短くしました。',
  '問い合わせの記録を読み返し、よく聞かれる質問から順に回答の手順を整えています。',
  'TypeScript と Cloudflare Workers で、公開ページを JavaScript なしで組み立てました。',
  'レビューで見つかった指摘を種類ごとに分け、同じ不具合が次の案件で起きないようにしました。',
  '週に一度チームで小さな勉強会を開き、試した道具の良し悪しを持ち寄って共有しています。',
  'データベースの移行を二段に分けて、古い版と新しい版が同じ画面を出すことを確かめました。',
  '画面の数を増やす前に、1画面に何件まで置けるかを実際のブラウザで測っています。',
]

/*
  ちょうど n 字の文。文の並びを start からずらして重ね、n 字で切って句点で閉じる。
  字数はコードポイントで数える（src/blocks.ts の chars と同じ）。
*/
export function text(n, start = 0) {
  if (n <= 0) return ''
  let out = ''
  for (let i = start; len(out) < n; i += 1) out += CORPUS[i % CORPUS.length]
  const cut = [...out].slice(0, n - 1).join('')
  return `${cut.replace(/[、。\s]$/, 'ま')}。`
}

// ちょうど n 字の語（句点で閉じない。見出し・ラベル・名前用）
export function words(n, start = 0) {
  const body = text(n + 1, start)
  return [...body].slice(0, n).join('').replace(/\s$/, 'す')
}

/*
  total 字を parts 個に。even は均等に、lump は1つに寄せる（残りは小さな単位）。
  返すのは各単位の字数。
*/
function split(total, parts, shape, least) {
  if (shape === 'even') {
    const base = Math.floor(total / parts)
    return Array.from({ length: parts }, (_, i) => base + (i < total % parts ? 1 : 0))
  }
  return [total - least * (parts - 1), ...Array.from({ length: parts - 1 }, () => least)]
}

const sql = (value) =>
  value === null || value === undefined
    ? 'NULL'
    : typeof value === 'number'
      ? String(value)
      : `'${String(value).replaceAll("'", "''")}'`

const insert = (table, rows) => {
  if (rows.length === 0) return ''
  const columns = Object.keys(rows[0])
  const values = rows.map((row) => `  (${columns.map((column) => sql(row[column])).join(', ')})`)
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values.join(',\n')};\n`
}

/* ------------------------------------------------------------ ブロックの中身 */

const YEAR = '2024.03 — 現在' // 12字。経歴・できごとの年月でいちばん長い書き方

/*
  1行1件のブロックの行を、1画面ぶん（perScreen 行）ちょうど max 字で。
  数える列は src/blocks.ts の blockVisibleParts と同じ（リンク集の URL は数えない）。
*/
function rowsOf(key, max, per, shape) {
  switch (key) {
    case 'now': {
      // 「何を | 補足」。最小の行は6字
      return split(max, per, shape, 6).map((n, i) => {
        const what = words(Math.min(n - 2, 18), i)
        return `${what} | ${words(n - len(what), i + 3)}`
      })
    }
    case 'numbers': {
      // 「値 | 単位 | 説明」。値2字・単位2字、最小の行は8字
      return split(max, per, shape, 8).map((n, i) => `${10 + i} | 人日 | ${words(n - 4, i)}`)
    }
    case 'links': {
      // 「ラベル | URL | 補足」。URL は数えない。最小の行は8字
      return split(max, per, shape, 8).map(
        (n, i) => `Link ${i} | https://example.com/${i} | ${words(n - len(`Link ${i}`), i)}`,
      )
    }
    case 'timeline': {
      // 「年月 | 何を | 補足」。最小の行は年月（12字）+ 4字
      return split(max, per, shape, len(YEAR) + 4).map((n, i) => {
        const rest = n - len(YEAR)
        const what = words(Math.min(rest - 2, 24), i)
        return `${YEAR} | ${what} | ${words(rest - len(what), i + 2)}`
      })
    }
    default:
      throw new Error(`${key} の行の作り方を知らない`)
  }
}

function blockRows() {
  const rows = []
  let order = 10
  const push = (row) => {
    rows.push({ id: rows.length + 1, published: 1, sort_order: order, ...row })
    order += 10
  }
  push({ type: 'hero', title: '', body: '' })
  push({ type: 'projects', title: '', body: '' })
  push({ type: 'team', title: '', body: '' })

  const heading = MAX_CHARS.blockHeading
  for (const type of BLOCK_TYPES) {
    if (type.kind !== 'free') continue
    for (const shape of ['even', 'lump']) {
      if (type.key === 'statement') {
        // 一文と添え書きの合計が上限。均等は一文を上限いっぱい、寄せは添え書きに寄せる
        const sentence = shape === 'even' ? MAX_STATEMENT_SENTENCE : 30
        push({
          type: type.key,
          title: text(sentence, 1),
          body: text(type.maxChars - sentence, 4),
        })
        continue
      }
      const per = type.perScreen
      if (type.key === 'note') {
        // 段落。寄せた形の小さな段落は 12 字
        const body = split(type.maxChars, per, shape, 12)
          .map((n, i) => text(n, i))
          .join('\n\n')
        push({ type: type.key, title: words(heading, 2), body })
        continue
      }
      push({
        type: type.key,
        title: words(heading, 5),
        body: rowsOf(type.key, type.maxChars, per, shape).join('\n'),
      })
    }
  }
  push({ type: 'contact', title: '', body: '' })
  return rows
}

/* ------------------------------------------------------------ メンバー */

const SKILLS = `LANGUAGES:
C# | 3年以上
SQL | 3年以上
JavaScript | 3年以上
HTML / CSS | 3年以上
Python | 1年以上
TypeScript
Swift
FRAMEWORKS / INFRA:
.NET Framework | 3年以上
ASP.NET | 3年以上
SQL Server | 3年以上
Oracle Database | 3年以上
Docker
Google Cloud
PRACTICE:
生成AI・開発効率化
基本設計 / 詳細設計 | 3年以上
開発・実装 | 3年以上
テスト（単体〜シナリオ） | 3年以上
Git / GitHub Actions
Playwright`

function career(shape) {
  const max = blockType('timeline').maxChars
  return rowsOf('timeline', max, MEMBER_PER_SCREEN.career, shape).join('\n')
}

/*
  紹介文と作品の本文は「打った文字列そのまま」で数える（空行も字。src/blocks.ts の
  memberPublishErrors / itemPublishErrors）。段落の区切り（\n\n）のぶんを引いて割る
*/
const paragraphed = (max, parts, shape, start) =>
  split(max - 2 * (parts - 1), parts, shape, 12)
    .map((n, i) => text(n, i + start))
    .join('\n\n')

function bio(shape) {
  return paragraphed(MAX_CHARS.memberBio, MAX_CHARS.memberBioParagraphs, shape, 1)
}

function memberRows() {
  const heavy = (id, slug, name, role, shape) => ({
    id,
    slug,
    name,
    role,
    location: 'Kanagawa, Japan',
    headline: text(MAX_CHARS.memberHeadline, id),
    bio: bio(shape),
    skills_text: SKILLS,
    career_text: career(shape),
    avatar_url: '/assets/avatar.png',
    github: `https://github.com/${slug}`,
    email: `${slug}@example.com`,
    published: 1,
    sort_order: id * 10,
  })
  const light = (id, slug, name, role, avatar) => ({
    ...heavy(id, slug, name, role, 'even'),
    headline: text(16, id),
    bio: text(80, id),
    skills_text: '',
    career_text: '',
    avatar_url: avatar ? '/assets/avatar.png' : null,
    github: null,
    email: null,
  })
  return [
    // 長い職種。1人のサイトでは柱の帯に名前と並ぶ（中央寄せの帯で末尾を省く相手）
    heavy(1, 'aoki', '青木 春香', 'シニアソフトウェアエンジニア / テックリード', 'even'),
    heavy(2, 'ishida', '石田 湊', 'Senior Software Engineer / Tech Lead', 'lump'),
    light(3, 'ueno', '上野 真央', 'Designer', true),
    light(4, 'eguchi', '江口 大和', 'プロダクトマネージャー', false),
    light(5, 'ogawa', '小川 結衣', 'Engineer', true),
    light(6, 'kato', '加藤 蒼', 'QA エンジニア', false),
  ]
}

/* ------------------------------------------------------------ 作品 */

function storyBody(shape) {
  return paragraphed(MAX_CHARS.itemBody, MAX_CHARS.itemBodyParagraphs, shape, 2)
}

function itemRows() {
  const heavy = (row) => ({
    member_id: 1,
    platform_key: null,
    category: '',
    year: '2024 — 現在',
    summary: text(MAX_CHARS.itemSummary, row.id),
    body: '',
    image_url: '/assets/avatar.png',
    image_alt: '作品の画面',
    image_width: 144,
    image_height: 144,
    metric_value: '20',
    metric_unit: '人日',
    metric_note: '見込み 40人日から半減',
    published: 1,
    ...row,
  })
  return [
    // 1画面目: いちばん重いカード2枚の行
    heavy({
      id: 1,
      type: 'app',
      platform_key: 'macos',
      title: 'Fixture App',
      slug: 'fixture-app',
      year: '2026',
      body: storyBody('even'),
      sort_order: 10,
    }),
    heavy({
      id: 2,
      type: 'work',
      category: '金融系基幹システム',
      // 390 で2行に折れる長さ（24字）。本文の画面の見出しが2行になる姿
      title: '長い作品名の問い合わせ対応エージェントの刷新計画',
      slug: 'fixture-long-title',
      year: '2026',
      member_id: 2,
      body: storyBody('lump'),
      sort_order: 20,
    }),
    // 2画面目: 画像の有る無しが混ざる行
    heavy({
      id: 3,
      type: 'work',
      category: '製造業',
      title: 'Fixture Work',
      slug: 'fixture-work',
      year: '2025',
      sort_order: 30,
    }),
    heavy({
      id: 4,
      type: 'app',
      platform_key: 'web',
      title: 'Fixture Web',
      slug: 'fixture-web',
      year: '2025',
      image_url: null,
      image_alt: '',
      image_width: null,
      image_height: null,
      member_id: 3,
      sort_order: 40,
    }),
    // 3画面目: 1枚だけの行
    heavy({
      id: 5,
      type: 'app',
      platform_key: 'cli',
      title: 'Fixture CLI',
      slug: 'fixture-cli',
      year: '2024',
      image_url: null,
      image_alt: '',
      image_width: null,
      image_height: null,
      metric_value: null,
      metric_unit: null,
      metric_note: null,
      summary: text(42, 5),
      member_id: 4,
      sort_order: 50,
    }),
  ]
}

/*
  作った中身が「上限ちょうど」かを、公開の関門そのもの（publishErrors）と字数の
  数え方（screenChars）で確かめる。上限を超えていれば検査は通らない中身を測る
  ことになり、足りなければ上限を測っていない。どちらも黙って起きるので、ここで止める。
*/
function audit(blocks, members, items, tags, links) {
  const problems = []
  for (const block of blocks) {
    const type = blockType(block.type)
    if (type.kind !== 'free') continue
    const errors = publishErrors({ kind: 'block', type, title: block.title, body: block.body })
    if (errors) problems.push(`block-${block.id}（${type.key}）: ${JSON.stringify(errors)}`)
    if (type.key !== 'statement') {
      const most = Math.max(...screenChars(type, block.body))
      if (most !== type.maxChars) {
        problems.push(
          `block-${block.id}（${type.key}）: 1画面が ${most} 字（上限 ${type.maxChars}）`,
        )
      }
    } else if (len(block.title) + len(block.body) !== type.maxChars) {
      problems.push(`block-${block.id}（statement）: 上限ちょうどでない`)
    }
  }
  for (const member of members) {
    const errors = publishErrors({
      kind: 'member',
      headline: member.headline,
      bio: member.bio,
      careerText: member.career_text,
    })
    if (errors) problems.push(`member ${member.slug}: ${JSON.stringify(errors)}`)
  }
  for (const item of items) {
    const errors = publishErrors({
      kind: 'item',
      summary: item.summary,
      body: item.body,
      imageAlt: item.image_alt,
      hasImage: Boolean(item.image_url),
      tags: tags.filter((tag) => tag.item_id === item.id).length,
      links: links.filter((link) => link.item_id === item.id).length,
    })
    if (errors) problems.push(`item ${item.slug}: ${JSON.stringify(errors)}`)
  }
  if (problems.length) {
    throw new Error(`fit の中身が上限ちょうどになっていない:\n  ${problems.join('\n  ')}`)
  }
}

const TAGS = ['TypeScript', 'Cloudflare Workers', 'Playwright']
const LINKS = ['Repository', 'Release', 'Website']

/*
  使い捨ての D1 に流す SQL。移行（platforms を含む）を流したあとに当てる。
  expect は、この中身から sitemap に必ず載るはずの URL——検査はこれが1本でも
  欠けていたら止まる（「測ったつもりで、その画面が生えていなかった」を止める）。
*/
export function fixture({ solo = false } = {}) {
  const blocks = blockRows()
  /*
    solo は同じ中身の1人のサイト。公開中のメンバーが1人なら、Team の位置に
    その人のプロフィールが入り、柱が名前と職種で名乗る（src/routes/public/data.ts の
    soloMember）——複数人のサイトには無い姿で、本人のサイトはこちら。
    ほかの5人は下書きに置く（作品の担当はそのまま残る）
  */
  const members = memberRows().map((member) =>
    solo && member.id !== 1 ? { ...member, published: 0 } : member,
  )
  const items = itemRows()
  const tags = items.flatMap((item) =>
    TAGS.slice(0, MAX_CHARS.itemTags).map((tag, sort_order) => ({
      item_id: item.id,
      tag,
      sort_order,
    })),
  )
  const links = items.flatMap((item) =>
    LINKS.slice(0, MAX_CHARS.itemLinks).map((label, sort_order) => ({
      item_id: item.id,
      label,
      url: `https://example.com/${item.slug}/${sort_order}`,
      sort_order,
    })),
  )

  audit(blocks, members, items, tags, links)

  const text = [
    '-- scripts/lib/fit-fixture.mjs が src/blocks.ts の上限から作った、check:fit 専用の中身',
    'DELETE FROM item_links;',
    'DELETE FROM item_tags;',
    'DELETE FROM items;',
    'DELETE FROM members;',
    'DELETE FROM blocks;',
    insert('blocks', blocks),
    insert('members', members),
    insert('items', items),
    insert('item_tags', tags),
    insert('item_links', links),
  ].join('\n')

  const itemPath = (item) => `/${item.type === 'app' ? 'apps' : 'works'}/item/${item.slug}`
  const shown = members.filter((member) => member.published)
  const expect = [
    '/',
    '/projects',
    '/projects/2',
    '/projects/3',
    // 1人のサイトでは /team はプロフィールへの 301 で、sitemap に載らない
    ...(solo ? [] : ['/team']),
    '/contact',
    ...blocks
      .filter((block) => blockType(block.type)?.kind === 'free')
      .map((b) => `/block-${b.id}`),
    ...shown.flatMap((member) => [`/members/${member.slug}`, `/members/${member.slug}/about`]),
    ...shown
      .filter((member) => member.career_text)
      .flatMap((member) => [`/members/${member.slug}/skills`, `/members/${member.slug}/career`]),
    ...items.map(itemPath),
    ...items.filter((item) => item.body).map((item) => `${itemPath(item)}/story`),
  ]
  return { sql: text, expect }
}
