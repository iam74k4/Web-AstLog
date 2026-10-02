/*
  check:fit の2本目の中身。**重い中身の、複数人のサイト**。

  seed.sql は本人のサイトそのもの（1人・打ち込むブロック0本・本文0件）で、
  それだけを測っていたころは、打ち込むブロック6種・3人以上の Team・作品の本文・
  上限の長さの名前は一度も測られていなかった。

  公開ページは縦に読む（ページはスクロールし、中身は割らない）。だから測るのは
  「1画面に収まるか」ではなく、長い中身でも横にはみ出さない・切られない・目次が
  貼り付いたまま見える、のほう。中身は**長いほう**で作る。

  - 打ち込むブロック6種を2形ずつ。長い段落・行の多い一覧を、均等に割った形と
    1つに寄せた形（行末の空きが寄ると横の組みが変わる）で。見出しは上限の長さ
    （MAX_CHARS.blockHeading）、ひとことの一文も上限（MAX_STATEMENT_SENTENCE）
  - メンバー6人（Team のグリッド）。うち2人は長い肩書き・上限の大見出し・長い
    紹介文・技術3塊・長い経歴を、均等に割った形と寄せた形で持つ
  - 作品7件。いちばん重い一覧の行（画像あり・説明の上限 100 字・実績値・タグ5つ・
    リンク5本・担当者名）、画像の無い行、作品名が上限ちょうどの作品。
    2件は長い本文（6段落）を2形で持つ

  上限の数（src/blocks.ts の MAX_CHARS）はそこから読む（書き写さない）。上限を変えた日に、
  検査は新しい上限で測る。

  文は実際の文に近い和文（英字まじり）で作る。段落は word-break: auto-phrase で
  文節の切れ目でだけ折れるので、「あ」を並べた文より行末に空きが出て、行が増える。

  書いてあるのは検査のための作り話で、本人の中身ではない。seed.sql とは混ぜない
  （check:fit はこの中身を使い捨ての D1 に入れ、手元の D1 には触らない）。
*/

import { importTs } from './ts-import.mjs'

const { BLOCK_TYPES, MAX_CHARS, MAX_STATEMENT_SENTENCE, blockType, publishErrors } =
  await importTs('src/blocks.ts')

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
  1行1件のブロックの行を、per 行・合計およそ max 字で（リンク集の URL は数えない）。
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

/*
  打ち込むブロックの中身の量（1ページに並ぶぶん）。1画面に収めていたころの上限
  （メモ 400 字・いま 250 字…）の数倍にしてある——ページは縦に読むので、長いほうで測る。
*/
const HEAVY = {
  statement: 480,
  now: { chars: 900, rows: 16 },
  numbers: { chars: 480, rows: 10 },
  links: { chars: 640, rows: 16 },
  timeline: { chars: 900, rows: 12 },
  note: { chars: 1800, paragraphs: 8 },
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
        // 一文は上限ちょうど。添え書きは均等は短く、寄せは長く
        push({
          type: type.key,
          title: text(MAX_STATEMENT_SENTENCE, 1),
          body: text(shape === 'even' ? 60 : HEAVY.statement, 4),
        })
        continue
      }
      if (type.key === 'note') {
        // 段落。寄せた形の小さな段落は 12 字
        const body = split(HEAVY.note.chars, HEAVY.note.paragraphs, shape, 12)
          .map((n, i) => text(n, i))
          .join('\n\n')
        push({ type: type.key, title: words(heading, 2), body })
        continue
      }
      const heavy = HEAVY[type.key]
      push({
        type: type.key,
        title: words(heading, 5),
        body: rowsOf(type.key, heavy.chars, heavy.rows, shape).join('\n'),
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

// 経歴は10行。1画面に収めていたころの上限（1画面 5行・250 字）の倍を超える
function career(shape) {
  return rowsOf('timeline', 700, 10, shape).join('\n')
}

// 段落の列。total 字を parts 段落に（寄せた形の小さな段落は 12 字）
const paragraphed = (total, parts, shape, start) =>
  split(total, parts, shape, 12)
    .map((n, i) => text(n, i + start))
    .join('\n\n')

// 紹介文は6段落・900 字（以前の上限は 400 字・3段落）
function bio(shape) {
  return paragraphed(900, 6, shape, 1)
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
    // 長い職種。1人のサイトでは足元に名前と並び、入口の大見出しの上の札にも出る
    heavy(1, 'aoki', '青木 春香', 'シニアソフトウェアエンジニア / テックリード', 'even'),
    heavy(2, 'ishida', '石田 湊', 'Senior Software Engineer / Tech Lead', 'lump'),
    light(3, 'ueno', '上野 真央', 'Designer', true),
    light(4, 'eguchi', '江口 大和', 'プロダクトマネージャー', false),
    light(5, 'ogawa', '小川 結衣', 'Engineer', true),
    light(6, 'kato', '加藤 蒼', 'QA エンジニア', false),
  ]
}

/* ------------------------------------------------------------ 作品 */

// 作品の本文は6段落・900 字（以前の上限は 300 字・3段落）
function storyBody(shape) {
  return paragraphed(900, 6, shape, 2)
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
    // 題の左のアイコン（一覧の行と作品のページの見出し）
    icon_url: '/assets/apple-touch-icon.png',
    metric_value: '20',
    metric_unit: '人日',
    metric_note: '見込み 40人日から半減',
    published: 1,
    ...row,
  })
  return [
    // いちばん重い行が2件（画像・実績値・タグ・リンク・担当者名が全部そろう）
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
      // 作品名の上限ちょうど（MAX_CHARS.itemTitle）。行の題と見出しが2行に折れる姿
      title: words(MAX_CHARS.itemTitle, 3),
      slug: 'fixture-long-title',
      year: '2026',
      member_id: 2,
      body: storyBody('lump'),
      sort_order: 20,
    }),
    // 画像のある行と無い行
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
    // 説明の短い行（並びは下の2件のあと）
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
    /*
      実績値の無い行2件。説明は上限の 100 字、1件は作品名が上限ちょうどで
      題が2行に折れる姿。年は 2025 で、並びは 2025 の2件（sort_order 30・40）のあと、
      2024 の説明の短い行（上の id 5）の前（src/db/queries.ts の itemOrder）
    */
    ...[6, 7].map((id) =>
      heavy({
        id,
        type: 'app',
        platform_key: 'web',
        title: id === 6 ? words(MAX_CHARS.itemTitle, 6) : 'Fixture Lean',
        slug: `fixture-lean-${id}`,
        year: '2025',
        // 1件は画像あり（もう1件は画像なし）
        ...(id === 7
          ? { image_url: null, image_alt: '', image_width: null, image_height: null }
          : {}),
        metric_value: null,
        metric_unit: null,
        metric_note: null,
        member_id: id - 1,
        sort_order: id * 10,
      }),
    ),
  ]
}

/*
  作品のほかの画像（作品のページの横の帯）。画像のある行に、横長・正方形・寸法の分からない
  画像を混ぜて並べる（帯は高さを決めて幅を絵の比から取る。寸法の無い画像は比の枠）。
  いちばん重い行（id 1）は上限の 8 枚——帯がいちばん長く溢れる姿。どれも同梱の素材を指す
  （KV を持たない使い捨ての D1 でも絵が出る）
*/
const SHOT_SOURCES = [
  { url: '/assets/blackhole.webp', width: 1024, height: 576 },
  { url: '/assets/avatar.png', width: 144, height: 144 },
  { url: '/assets/apple-touch-icon.png', width: null, height: null },
]

function shotRows(items) {
  return items
    .filter((item) => item.image_url)
    .flatMap((item) =>
      Array.from({ length: item.id === 1 ? 8 : 2 }, (_, index) => {
        const source = SHOT_SOURCES[index % SHOT_SOURCES.length]
        return {
          item_id: item.id,
          url: source.url,
          alt: `作品の画面（${index + 1} 枚目）`,
          width: source.width,
          height: source.height,
          sort_order: (index + 1) * 10,
        }
      }),
    )
}

/*
  作った中身が公開の関門（publishErrors）を通るかを確かめる。通らない中身は公開
  できないので、それを測っても意味が無い（上限を超えた名前・空の説明・代替テキストの
  無い画像）。黙って起きるので、ここで止める。
*/
function audit(blocks, members, items, shots) {
  const problems = []
  for (const block of blocks) {
    const type = blockType(block.type)
    if (type.kind !== 'free') continue
    const errors = publishErrors({ kind: 'block', type, title: block.title, body: block.body })
    if (errors) problems.push(`block-${block.id}（${type.key}）: ${JSON.stringify(errors)}`)
  }
  for (const member of members) {
    const errors = publishErrors({ kind: 'member', headline: member.headline })
    if (errors) problems.push(`member ${member.slug}: ${JSON.stringify(errors)}`)
  }
  for (const item of items) {
    const errors = publishErrors({
      kind: 'item',
      title: item.title,
      summary: item.summary,
      imageAlt: item.image_alt,
      hasImage: Boolean(item.image_url),
      shotAlts: shots.filter((shot) => shot.item_id === item.id).map((shot) => shot.alt),
    })
    if (errors) problems.push(`item ${item.slug}: ${JSON.stringify(errors)}`)
  }
  if (problems.length) {
    throw new Error(`fit の中身が公開の関門を通らない:\n  ${problems.join('\n  ')}`)
  }
}

// タグとリンクは5つずつ（以前は作品のページの1枚目に収めるために3つまでだった）
const TAGS = ['TypeScript', 'Cloudflare Workers', 'Playwright', 'Hono', '生成AI']
const LINKS = ['Repository', 'Release', 'Website', 'Docs', 'Changelog']

/*
  使い捨ての D1 に流す SQL。移行（platforms を含む）を流したあとに当てる。
  expect は、この中身から sitemap に必ず載るはずの URL——検査はこれが1本でも
  欠けていたら止まる（「測ったつもりで、そのページが生えていなかった」を止める）。
*/
export function fixture({ solo = false } = {}) {
  const blocks = blockRows()
  /*
    solo は同じ中身の1人のサイト。公開中のメンバーが1人なら、Team の位置に
    その人のプロフィールが入り、足元が名前と職種で名乗る（src/routes/public/data.ts の
    soloMember）——複数人のサイトには無い姿で、本人のサイトはこちら。
    ほかの5人は下書きに置く（作品の担当はそのまま残る）
  */
  const members = memberRows().map((member) =>
    solo && member.id !== 1 ? { ...member, published: 0 } : member,
  )
  const items = itemRows()
  const tags = items.flatMap((item) =>
    TAGS.map((tag, sort_order) => ({
      item_id: item.id,
      tag,
      sort_order,
    })),
  )
  const links = items.flatMap((item) =>
    LINKS.map((label, sort_order) => ({
      item_id: item.id,
      label,
      url: `https://example.com/${item.slug}/${sort_order}`,
      sort_order,
    })),
  )

  const shots = shotRows(items)

  audit(blocks, members, items, shots)

  const text = [
    '-- scripts/lib/fit-fixture.mjs が作った、check:fit 専用の重い中身',
    'DELETE FROM item_shots;',
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
    insert('item_shots', shots),
  ].join('\n')

  const itemPath = (item) => `/${item.type === 'app' ? 'apps' : 'works'}/item/${item.slug}`
  const shown = members.filter((member) => member.published)
  const expect = [
    '/',
    '/projects',
    // 1人のサイトでは /team はプロフィールへの 301 で、sitemap に載らない
    ...(solo ? [] : ['/team']),
    '/contact',
    ...blocks
      .filter((block) => blockType(block.type)?.kind === 'free')
      .map((b) => `/block-${b.id}`),
    // 個人ページは1ページ（About・Skills・Career は小節）
    ...shown.map((member) => `/members/${member.slug}`),
    // 作品のページ（本文は小節 #story）
    ...items.map(itemPath),
  ]
  return { sql: text, expect }
}

/*
  check:fit の4本目の中身の足し分。**本人のサイト（seed.sql）に、打ち込むブロックを
  既定の見出しのまま3本**（いま・数字・リンク集。見出しは src/blocks.ts の title）。

  seed は目次が3行（Projects / Profile / Contact）で、どの寸法でも帯に収まる。
  重い fixture は目次が 12 行で、帯はいつも溢れる。そのあいだの、本人が
  ブロックを数本足しただけの姿を測る相手が無かった——390 の指ではこの3本で帯が
  126px 溢れ、並びの後ろの節（Links・Contact）に着くと、目次の印が帯の外に
  押し出されていた。中身の字数は上限ではなく、ふつうに書く長さ。

  seed の決まった4本（sort_order 10〜40）の、Team と Contact のあいだに差し込む。
  id を決めておくのは、生えるはずの URL（expect）を名指しするため。
*/
export function seedBlocks() {
  const rows = [
    {
      key: 'now',
      body: '個人サイトの作り直し | Cloudflare Workers で\nAI エージェントの設定の整理 | 3つの道具',
    },
    { key: 'numbers', body: '20 | 人日 | 見込み 40人日から半減\n14 | 画面 | 製造・単体テスト' },
    {
      key: 'links',
      body: 'GitHub | https://github.com/iam74k4 | コード\nZenn | https://zenn.dev/ | 記事',
    },
  ].map((row, index) => ({
    id: 91 + index,
    type: row.key,
    title: blockType(row.key).title,
    body: row.body,
    published: 1,
    sort_order: 31 + index,
  }))
  return {
    sql: [
      '-- scripts/lib/fit-fixture.mjs の seedBlocks: seed.sql に既定の見出しのブロックを3本',
      insert('blocks', rows),
    ].join('\n'),
    expect: rows.map((row) => `/block-${row.id}`),
  }
}
