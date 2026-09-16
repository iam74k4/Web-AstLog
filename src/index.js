/*
  Noctifex — Cloudflare Worker.

  Phase 0 の目的は「見た目を1ミリも変えずに、配信元だけ Workers に移す」こと。
  そのため、ここではリポジトリ直下の index.html と assets/ をそのまま返している。
  DB もセッションもまだ見ない。

  Phase 1 で "/" の分岐を、D1 から組み立てる描画に差し替える。
  そのとき index.html は src/render/ のテンプレートへ分解して消える。
*/

import indexHtml from '../index.html'
import avatarPng from '../assets/avatar.png'
import markSvg from '../assets/noctifex-mark.svg'
import wordmarkSvg from '../assets/noctifex-wordmark.svg'

// パス → [中身, Content-Type]。増えるのはこの表だけで済むようにしている
const FILES = {
  '/assets/avatar.png': [avatarPng, 'image/png'],
  '/assets/noctifex-mark.svg': [markSvg, 'image/svg+xml'],
  '/assets/noctifex-wordmark.svg': [wordmarkSvg, 'image/svg+xml'],
}

export default {
  fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname === '/' || pathname === '/index.html') {
      return new Response(indexHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // 中身は毎回組み立て直す前提なので、長く持たせない
          'cache-control': 'public, max-age=60',
        },
      })
    }

    const file = FILES[pathname]
    if (file) {
      const [body, type] = file
      return new Response(body, {
        headers: { 'content-type': type, 'cache-control': 'public, max-age=3600' },
      })
    }

    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
}
