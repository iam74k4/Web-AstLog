import sources from 'virtual:sources'
import { describe, expect, it } from 'vitest'

/*
  ソースと文書の形を見る。実装の振る舞いではなく、置き場所と名指しの決まり。
  中身は vitest.config.ts の sourcePlugin が Node 側で読んで渡す（workerd の中からは
  ファイルを読めない）。
*/

const { files, texts } = sources
const exists = new Set(files)

// import の行き先を、リポジトリの根からのパスにする（拡張子は付けない）
const importsOf = (file: string) => {
  const dir = file.split('/').slice(0, -1)
  return [...(texts[file] ?? '').matchAll(/^(?:import|export)[^'"]*from '(\.[^']+)'/gm)].map(
    ([, spec = '']) => {
      const parts = [...dir]
      for (const step of spec.split('/')) {
        if (step === '..') parts.pop()
        else if (step !== '.') parts.push(step)
      }
      return parts.join('/')
    },
  )
}

const sourceFiles = Object.keys(texts).filter((file) => /^src\/.*\.tsx?$/.test(file))

describe('層の向き', () => {
  /*
    DB の層（src/db）と規則（src/blocks.ts・src/domain.ts・src/lib・src/theme.ts・
    src/site.ts）は、UI（src/ui）とルート（src/routes）を読まない。UI と DB が
    共有する型は src/domain.ts に置く。

    queries.ts が components.tsx から作品の型を借りていたころは、DB の問い合わせが
    画面の部品のファイルに依っていた——部品を1つ動かすと、DB の層の型が壊れる向き。
  */
  it('DB と規則のファイルは、UI とルートを import しない', () => {
    const lower = sourceFiles.filter(
      (file) =>
        file.startsWith('src/db/') ||
        file.startsWith('src/lib/') ||
        ['src/blocks.ts', 'src/domain.ts', 'src/theme.ts', 'src/site.ts'].includes(file),
    )
    expect(lower.length).toBeGreaterThan(5)
    const upward = lower.flatMap((file) =>
      importsOf(file)
        .filter((to) => to.startsWith('src/ui/') || to.startsWith('src/routes/'))
        .map((to) => `${file} → ${to}`),
    )
    expect(upward).toEqual([])
  })

  it('UI の部品はルートを import しない', () => {
    const upward = sourceFiles
      .filter((file) => file.startsWith('src/ui/'))
      .flatMap((file) =>
        importsOf(file)
          .filter((to) => to.startsWith('src/routes/'))
          .map((to) => `${file} → ${to}`),
      )
    expect(upward).toEqual([])
  })
})

describe('名指しの先', () => {
  /*
    コメントと文書（CLAUDE.md・README.md・docs/）が名指しするファイルは実在する。

    ファイルを分けたり名前を変えたりした日に、それを説明していた散文だけが
    前の名前を指して残る。コメントは検査より強い権威として読まれるので、
    無いファイルを指す1行は、無いよりたちが悪い。
  */
  it('ソースと文書が名指しするリポジトリのパスは、どれも在る', () => {
    const PATH =
      /(?<![\w./-])((?:src|scripts|public|docs|test|drizzle|\.github)\/[A-Za-z0-9_\-./]+\.(?:tsx?|mjs|css|md|sql|py|json|ya?ml|toml))(?![\w-])/g
    const missing = Object.entries(texts).flatMap(([file, text]) =>
      [...text.matchAll(PATH)]
        .map(([, path = '']) => path)
        .filter((path) => !exists.has(path))
        .map((path) => `${file}: ${path}`),
    )
    expect(missing).toEqual([])
  })

  /*
    コメントと文書が名指しするテストの名前（「test/public.test.ts の『URL の登録順』」）は、
    そのファイルの describe / it の題に実在する。パスが在るかだけを見ていたころは、
    名前の違うテストを根拠に挙げた1行（src/routes/public/site.ts の絞り込みの理由）が
    通っていた——根拠を探した人は見つけられず、守られていない決まりに見える。

    題は名指しと同じか、名指しで始まる（長い題の頭の句で呼ぶ）。行をまたいだ名指しは、
    行頭のコメントの印と空白を落としてから比べる。
  */
  it('名指しされたテストの名前は、そのファイルの題に在る', () => {
    const squash = (text: string) => text.replace(/\s+/g, '')
    const titles = (file: string) =>
      [...(texts[file] ?? '').matchAll(/\b(?:describe|it|test)(?:\.\w+)?\(\s*(['"`])(.*?)\1/g)].map(
        ([, , title = '']) => squash(title),
      )
    const NAMED =
      /(test\/[\w./-]+\.ts)`?\s*の(?:\s|\/\/|\*|#)*「((?:[^」\n]|\n\s*(?:\/\/|\*|#)?)+)」/g
    const named = Object.entries(texts).flatMap(([file, text]) =>
      [...text.matchAll(NAMED)].map(([, test = '', name = '']) => ({
        at: `${file}: ${test} の「${name.replace(/\n\s*(?:\/\/|\*|#)?\s*/g, '')}」`,
        test,
        name: squash(name.replace(/\n\s*(?:\/\/|\*|#)?/g, '')),
      })),
    )
    // 名指しを1つも拾えないなら、この検査の読み方が壊れている
    expect(named.length).toBeGreaterThan(15)
    const missing = named
      .filter(({ test, name }) => !titles(test).some((title) => title.startsWith(name)))
      .map(({ at }) => at)
    expect(missing).toEqual([])
  })

  /*
    「src/… の `名前`」と名指しした関数・定数は、そのファイルに在る。関数の名前を変えた日に、
    それを説明していた散文だけが前の名前を指して残るのを止める。
  */
  it('名指しされた関数と定数は、そのファイルに在る', () => {
    const NAMED = /((?:src|scripts)\/[\w./-]+\.(?:tsx?|mjs))`?\s*の\s*`([A-Za-z_$][\w$]*)/g
    const named = Object.entries(texts).flatMap(([file, text]) =>
      [...text.matchAll(NAMED)].map(([, target = '', name = '']) => ({
        at: `${file}: ${target} の \`${name}\``,
        target,
        name,
      })),
    )
    expect(named.length).toBeGreaterThan(30)
    const missing = named
      .filter(
        ({ target, name }) =>
          !new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(texts[target] ?? ''),
      )
      .map(({ at }) => at)
    expect(missing).toEqual([])
  })

  /*
    節ごとのページに分けたあとの目次は、節（#projects）ではなくページの URL
    （/projects）を指す。前の一覧の名前（#apps）が「いまのアンカー」として
    コメントに残っていたので、消えた名前として見張る。
  */
  it('消えたアンカー（#apps・#works）をコメントに残さない', () => {
    const stale = Object.entries(texts)
      .filter(([file]) => file.startsWith('src/') || file.startsWith('public/'))
      .flatMap(([file, text]) =>
        [...text.matchAll(/#(?:apps|works)\b/g)].map((found) => `${file}: ${found[0]}`),
      )
    expect(stale).toEqual([])
  })
})

describe('CLAUDE.md の大きさ', () => {
  /*
    CLAUDE.md は毎回のセッションが最初に読む「迷ったらこうする」の束で、手順と経緯は
    README と docs/ に置く（書き写すと片方だけ古くなる）。手順を足し続けて 53,000 字まで
    膨らみ、README と同じ手順を別の言葉で二重に持っていた。締め直した日の大きさ
    （約 26,600 字）に余白を足した数で止め、また膨らんだ日に気づけるようにする。
    超えたら、足した段落が決まりか手順かを見直す——手順なら README へ。
  */
  it('30,000 字を超えない', () => {
    const text = texts['CLAUDE.md'] ?? ''
    expect(text.length).toBeGreaterThan(10_000)
    expect(text.length).toBeLessThanOrEqual(30_000)
  })
})
