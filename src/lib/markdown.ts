import { isSafeUrl } from './format'

/*
  長い文章の欄（紹介文・作品の本文・メモ）に書ける、小さな Markdown。

  読むのは3つだけ——行頭の「- 」の箇条書き、**太字**、[ラベル](URL) のリンク。見出し・
  HTML・画像は読まない（見出しの段はページの組み方が決める。CLAUDE.md「見出しと文書」）。
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
  記号を外した字（検索結果の説明文・ページの題の頭）。リンクはラベルだけ、太字は中の字、
  箇条書きは「- 」を外して1つの文に並べる
*/
export function plainText(paragraph: string): string {
  const flat = (inlines: Inline[]): string =>
    inlines.map((one) => (one.kind === 'text' ? one.text : flat(one.children))).join('')
  return prose(paragraph)
    .map((block) =>
      block.kind === 'paragraph' ? flat(block.inlines) : block.items.map(flat).join(' '),
    )
    .join(' ')
}
