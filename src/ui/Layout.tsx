import type { Child } from 'hono/jsx'
import { SITE } from '../site'
import type { Theme } from '../theme'

export type NavItem = { href: string; label: string; active?: boolean }

/*
  共有カードの画像。サイトに1枚だけ持つ。

  このサイトへの流入は、貼られたリンク（Slack / DM / 職務経歴書）から来る。
  og:image が無いと、貼った先は灰色の箱か文字だけの行になり、画面が7つに
  分かれたいまはどの画面を貼っても同じ無地のカードになっていた。

  素材はリポジトリにある public/assets/avatar.png。raster はこれ1枚しか
  無い——noctifex-mark.svg と noctifex-wordmark.svg は SVG で、貼り先の
  どれも og:image の SVG を読まない（Slack / LinkedIn / X）。
  144x144 は og:image の推奨（1200x630）に届かないので、出るのは大きな
  カードではなく小さな正方形のサムネイル。だから twitter:card は summary
  のままにしてある（summary_large_image にすると、横長の枠に 144px の絵を
  引き伸ばした札になる）。1200x630 の PNG を1枚足す日が来たら、
  差し替えるのはここの3行と twitter:card の1語だけ。

  width と height を添えるのは、取りに行く前に「小さい」と分かるようにするため。

  twitter:image は置かない。X は twitter:* が無ければ og:* に落ちるので、
  同じ URL を2か所に持つと、片方だけ古くなる形が1つ増えるだけになる。
*/
const OG_IMAGE = { path: '/assets/avatar.png', type: 'image/png', width: 144, height: 144 }

/*
  公開ページの外枠。head と骨格（名札 + 本文）はここだけで決める。

  骨格の並べ替えは body の data-* だけで済ませる。マークアップは
  どのプリセットでも同じで、変わるのは app.css の [data-layout] 側。
  出し分けを JSX に持たせると、プリセットの数だけ画面が分かれてしまう。

  公開ページは JavaScript を持たない。絞り込みも画面の移動もサーバーが決め、
  リンクをたどるだけで動く。ここに <script> を1つ足すと、切られた環境で
  何が落ちるかを毎回考えることになる。
*/
export const Layout = (props: {
  title: string
  description: string
  canonical: string
  jsonLd?: unknown
  nav: NavItem[]
  theme: Theme
  sidebar: Child
  /*
    縦に積んだ全体ページ（/all）のときだけ立てる。app.css は body のこの印で
    「画面に収める外枠」を外す。印の無いページは1画面に収まり、動かない。
  */
  whole?: boolean
  children?: Child
}) => (
  <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      <meta name="color-scheme" content="dark" />
      <title>{props.title}</title>
      <meta name="description" content={props.description} />
      <link rel="canonical" href={props.canonical} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE.name} />
      <meta property="og:title" content={props.title} />
      <meta property="og:description" content={props.description} />
      <meta property="og:url" content={props.canonical} />
      <meta property="og:locale" content="ja_JP" />
      <meta property="og:image" content={`${SITE.origin}${OG_IMAGE.path}`} />
      <meta property="og:image:type" content={OG_IMAGE.type} />
      <meta property="og:image:width" content={String(OG_IMAGE.width)} />
      <meta property="og:image:height" content={String(OG_IMAGE.height)} />
      <meta property="og:image:alt" content={`${SITE.name} のアイコン`} />
      <meta name="twitter:card" content="summary" />

      <link
        rel="icon"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%230c0c0e'/%3E%3Cpolygon points='14.96,2.50 7.71,6.10 5.68,13.93 10.27,20.60 18.32,21.50 12.09,16.78 10.73,9.07' fill='%23f2f2f4'/%3E%3C/svg%3E"
      />
      <link rel="stylesheet" href="/app.css" />
      {props.jsonLd ? (
        <script
          type="application/ld+json"
          // JSON の中の < を潰しておく。</script> で早期に閉じられるのを防ぐため
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(props.jsonLd).replace(/</g, '\\u003c'),
          }}
        />
      ) : null}
    </head>
    <body
      data-layout={props.theme.layout}
      data-accent={props.theme.accent}
      data-typeface={props.theme.typeface}
      data-whole={props.whole ? '' : undefined}
    >
      <a class="skip" href="#main">
        本文へスキップ
      </a>
      <div class="shell">
        <aside class="rail">
          {props.sidebar}
          {/*
            いま見ている画面には aria-current="page"。'true' ではなく 'page' な
            のは、目次の行き先が節（#apps）ではなく別の URL（/apps）になったため。
            'true' は「この一覧の中のいま」で、ページそのものは指さない。

            番号（01〜04）は振らない。画面の底のページャが 01 · 07 を同じ 11px
            mono で出しているので、同じ姿の数が2組あると同じ数え上げに見える。
            しかも目次の番号はブロックの並び順なので /apps でも /apps/3 でも
            「01」のまま動かない。数えるのはページャ1つに寄せる。

            aria-label は行き先で出し分ける。全体ページの目次だけが本当に
            ページ内（#apps）を指していて、画面ごとの URL では別ページへ移る。
            片方に固定した文字列は、必ずどちらかで嘘になる。
          */}
          <nav class="toc" aria-label={props.whole ? 'ページ内の移動' : '画面の移動'}>
            {props.nav.map((item) => (
              <a key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          {/*
            全体ページ（/all）への1本道。

            公開側にも管理画面にも /all への href が1本も無かった。@media print は
            「紙の上では『次の画面へ』は押せない。全体ページを刷ること」と書いて
            いるのに、そこへ行く手段が URL を手で打つことしか無い。カードの説明が
            2行で切られない唯一の姿も、Ctrl-F もブラウザ翻訳も、同じ1本が無いために
            届かなかった。

            全体ページ自身には出さない（自分への行き先）。

            899 以下ではこの足元ごと畳まれる（.rail__footer は帯に入らない6つの
            うちの1つ）。畳んで「どこにも無くなる」ものは無い——一覧は画面ごとの
            URL で読めるし、切られた説明の全文はカードの題からたどる作品1件の
            ページにある。sitemap.xml にも載るので、検索からも届く。
          */}
          <footer class="rail__footer">
            © 2026 {SITE.name}
            {props.whole ? null : (
              <>
                {' · '}
                <a href="/all">全体を1ページで見る ↗</a>
              </>
            )}
          </footer>
        </aside>
        {/*
          tabindex={-1} は「本文へスキップ」のため。Safari（と iOS の全ブラウザ）は
          フラグメントで移った先が素でフォーカスを受けない要素だと、見た目だけ動いて
          キーボードの位置は帯に残る。このサイトに迂回路はこの1本しか無いので、
          外すと目次を毎回たどる以外の手が消える。-1 なので Tab の順番には入らない。
        */}
        <main id="main" tabindex={-1}>
          {props.children}
        </main>
      </div>
    </body>
  </html>
)
