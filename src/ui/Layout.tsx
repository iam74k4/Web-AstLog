import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import { SITE } from '../site'

export type NavItem = { href: string; label: string; active?: boolean }

/*
  公開ページの外枠。head と骨格（左の名札 + 右の本文）はここだけで決める。

  JavaScript は絞り込みだけに使う。切っても全件が読める状態を保つこと。
*/
export const Layout = (props: {
  title: string
  description: string
  canonical: string
  jsonLd?: unknown
  nav: NavItem[]
  sidebar: Child
  withFilterScript?: boolean
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
    <body>
      <a class="skip" href="#main">
        本文へスキップ
      </a>
      <div class="shell">
        <aside class="rail">
          {props.sidebar}
          <nav class="toc" aria-label="ページ内の移動">
            {props.nav.map((item, index) => (
              <a key={item.href} href={item.href} aria-current={item.active ? 'true' : undefined}>
                <span class="toc__num">{String(index + 1).padStart(2, '0')}</span>
                {item.label}
              </a>
            ))}
          </nav>
          <footer class="rail__footer">© 2026 {SITE.name}</footer>
        </aside>
        <main id="main">{props.children}</main>
      </div>
      {props.withFilterScript ? <script src="/filter.js" defer /> : null}
      {raw('')}
    </body>
  </html>
)
