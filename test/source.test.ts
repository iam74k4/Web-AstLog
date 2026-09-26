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
    画面ごとの URL に分けたあとの目次は、節（#projects）ではなく画面の URL
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
