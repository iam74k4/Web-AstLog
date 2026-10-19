import { isSafeUrl, paragraphs } from './format'

/*
  長い文章の欄（紹介文・作品の本文・メモ）に書ける、小さな Markdown。

  読むのは3つだけ——行頭の「- 」の箇条書き、**太字**、[ラベル](URL) のリンク。見出し・
  HTML・画像は読まない（見出しの段はページの組み方が決める。CLAUDE.md「見出しと文書」）。
  例外は作品の文書（プライバシーポリシー・サポート）で、見出しを2段だけ読む（下の documentBlocks）。
  段落は今までどおり空行で分ける（src/lib/format.ts の paragraphs）。ここが開くのは
  1つの段落の中だけで、記号の無い文章は前と同じ1つの段落のまま。

  HTML の文字列は作らない。開いた形（Prose）を部品（src/ui/components.tsx の Note）が
  JSX の要素にするので、書いた字が要素として解釈されることは無い。リンクは isSafeUrl を
  通るものだけを要素にし、通らないもの（javascript: など）は書いた字のまま出す。
*/

// 欄の案内に添える書き方（紹介文・作品の本文・メモの欄）
export const MARKDOWN_HINT = '**太字**・[リンク](https://…)・行頭の「- 」で箇条書きが使える'

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }

export type Prose = { kind: 'paragraph'; inlines: Inline[] } | { kind: 'list'; items: Inline[][] }

const LIST_ITEM = /^\s*[-*]\s+/

// 1つの段落を、文と箇条書きのまとまりに開く。続いた「- 」の行が1つの箇条書き
export function prose(paragraph: string): Prose[] {
  const out: Prose[] = []
  let text: string[] = []
  let items: string[] = []
  const flushText = () => {
    if (text.length) out.push({ kind: 'paragraph', inlines: inline(text.join('\n')) })
    text = []
  }
  const flushItems = () => {
    if (items.length) out.push({ kind: 'list', items: items.map(inline) })
    items = []
  }
  for (const line of paragraph.split('\n')) {
    if (LIST_ITEM.test(line)) {
      flushText()
      items.push(line.replace(LIST_ITEM, ''))
    } else {
      flushItems()
      text.push(line)
    }
  }
  flushText()
  flushItems()
  return out
}

/*
  段落の中の **太字** と [ラベル](URL)。閉じていない記号は字のまま（「**」だけの行で
  残りの文が全部太字になる、を起こさない）。太字の中のリンクとリンクの中の太字も読む
*/
const TOKEN = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g

export function inline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const found of text.matchAll(TOKEN)) {
    const at = found.index ?? 0
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    const [whole, bold, label, href] = found
    if (bold !== undefined) {
      out.push({ kind: 'strong', children: inline(bold) })
    } else if (label !== undefined && href !== undefined && isSafeUrl(href)) {
      out.push({ kind: 'link', href, children: inline(label) })
    } else {
      out.push({ kind: 'text', text: whole })
    }
    last = at + whole.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  // 字のまま残した記号と続きの字は、1つの塊にまとめる（字が細切れのまま描かれない）
  return out.reduce<Inline[]>((joined, one) => {
    const before = joined.at(-1)
    if (one.kind === 'text' && before?.kind === 'text') before.text += one.text
    else joined.push(one)
    return joined
  }, [])
}

/*
  作品の文書（プライバシーポリシー・サポート。src/domain.ts の ITEM_DOCUMENTS）の書き方。
  上の小さな Markdown に、見出しを2段だけ足す——行頭の「## 」と「### 」。

  文書はそれだけで1ページの中身で、規約は「日本語 / English」と節の見出しで読む（見出しが
  無いと、読み上げで節を飛べない）。ほかの長い文章の欄（紹介文・本文・メモ）は今までどおり
  見出しを読まない——あちらの見出しの段はページの組み方が決める。文書のページは h1 が文書の
  名前（Privacy Policy）なので、## が h2、### が h3。# の行と #### 以下は書いた字のまま
  （h1 はページが持つ。段を飛ばした見出しを作らない）。

  段落は今までどおり空行で分け（paragraphs）、見出しの行は空行を挟まなくても段落を切る。
  見出しの字は記号を読まない（太字やリンクの見出しは要らない）。
*/
export const DOCUMENT_HINT = `行頭の「## 」「### 」で見出し · 「## 日本語」「## English」で分けると、ページの頭に言語の切り替えが出る · 空行で段落を分ける · ${MARKDOWN_HINT}`

export type DocumentBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'part'; blocks: Prose[] }

const HEADING = /^(#{2,3})\s+(\S.*)$/

export function documentBlocks(text: string): DocumentBlock[] {
  const out: DocumentBlock[] = []
  for (const paragraph of paragraphs(text)) {
    let lines: string[] = []
    const flush = () => {
      const body = lines.join('\n').trim()
      if (body) out.push({ kind: 'part', blocks: prose(body) })
      lines = []
    }
    for (const line of paragraph.split('\n')) {
      const found = HEADING.exec(line.trim())
      if (found) {
        flush()
        out.push({
          kind: 'heading',
          level: found[1] === '##' ? 2 : 3,
          text: (found[2] ?? '').trim(),
        })
      } else {
        lines.push(line)
      }
    }
    flush()
  }
  return out
}

/*
  文書の言語の節。規約は日本語と英語を1つの文書に並べて書くことが多い（AppMixer の
  プライバシーポリシーとサポート）。続けて全部を読ませると、英語で読みたい人は日本語を
  まるごと送ってから着く。そこで「## 日本語」「## English」のように、## の見出しが全部
  ここの言語の名前で2つ以上ある文書は、言語ごとの節に分ける——ページは選んだ言語の節だけを
  出し、頭に切り替え（components.tsx の LanguageLinks。?lang=en）を置く。

  最初の言語の見出しより前（最終更新日など）は、どの言語でも出す（preamble）。## の見出しに
  1つでも言語の名前でないもの（「## よくある質問」）があれば分けない（全部をそのまま出す）。
  同じ言語の見出しが2度出る文書も分けない（どちらの節を出すか決まらない）。見出しの字は
  そのまま比べる（「english」は分けない。管理画面の欄の案内が書き方を言う）。
*/
export const DOCUMENT_LANGUAGES = [
  { code: 'ja', heading: '日本語' },
  { code: 'en', heading: 'English' },
] as const

export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number]['code']

export type DocumentSection = {
  code: DocumentLanguage
  heading: string
  // 節の ## の見出しから、次の言語の見出しの前まで
  blocks: DocumentBlock[]
}

export function documentLanguages(
  blocks: DocumentBlock[],
): { preamble: DocumentBlock[]; sections: DocumentSection[] } | null {
  const preamble: DocumentBlock[] = []
  const sections: DocumentSection[] = []
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === 2) {
      const language = DOCUMENT_LANGUAGES.find((one) => one.heading === block.text)
      if (!language || sections.some((section) => section.code === language.code)) return null
      sections.push({ code: language.code, heading: block.text, blocks: [block] })
    } else {
      ;(sections.at(-1)?.blocks ?? preamble).push(block)
    }
  }
  return sections.length >= 2 ? { preamble, sections } : null
}

/*
  記号を外した字（検索結果の説明文・ページの題の頭）。リンクはラベルだけ、太字は中の字、
  箇条書きは「- 」を外して1つの文に並べる
*/
export function plainText(paragraph: string): string {
  return proseText(prose(paragraph))
}

// 開いた塊（prose の結果）の字。作品の文書の段落の言語を見るのにも使う（components.tsx の DocumentBody）
export function proseText(blocks: Prose[]): string {
  const flat = (inlines: Inline[]): string =>
    inlines.map((one) => (one.kind === 'text' ? one.text : flat(one.children))).join('')
  return blocks
    .map((block) =>
      block.kind === 'paragraph' ? flat(block.inlines) : block.items.map(flat).join(' '),
    )
    .join(' ')
}
