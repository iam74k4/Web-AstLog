/*
  検査用に dev サーバを立てる。check-fit.mjs と check-contrast.mjs の共通部分。

  2本に写してあったころは、SIGTERM の届け方（下記）のような「一度踏んだ罠」の
  直しが片方にしか入らない危険が常にあった。実際コメントには
  「check-fit.mjs と同じ理由で」とだけ書いてあり、理由そのものは片方にしか
  無かった——写しのほうを読んだ人には、なぜそう書いてあるのか分からない。

  scripts/ は tsc も vitest も見ない。ここが壊れても検査は「落ちる」のではなく
  「立ち上がらない」になるので、壊れたことには気づける（緑のまま素通りしない）。
*/

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// dev サーバが返事をするまで待つ。起動は初回だけ数秒かかる
async function waitForServer(base, limitMs = 120_000) {
  const until = Date.now() + limitMs
  while (Date.now() < until) {
    try {
      const response = await fetch(base, { redirect: 'manual' })
      if (response.status < 500) return
    } catch {
      // まだ立っていない
    }
    await sleep(500)
  }
  throw new Error(`${base} が ${limitMs / 1000} 秒たっても応えない`)
}

/*
  npx を挟まず node_modules/.bin/wrangler を直に起動する。npx を挟むと
  SIGTERM が届くのは npx のほうで、本体の wrangler がポートを掴んだまま
  残ることがある（次の実行がそのポートで立てられなくなる）。

  サーバの出力はためておいて、うまくいったときは捨てる。成功した run の
  最後に 160 行のアクセスログが出ると、肝心の1行が読めなくなる。
*/
function spawnServer(port) {
  const server = spawn(`${ROOT}node_modules/.bin/wrangler`, ['dev', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = []
  const keep = (chunk) => log.push(String(chunk))
  server.stdout.on('data', keep)
  server.stderr.on('data', keep)

  return {
    stop: () => {
      server.stdout.off('data', keep)
      server.stderr.off('data', keep)
      server.kill('SIGTERM')
    },
    spill: () => console.error(log.join('')),
  }
}

/*
  測る相手を決めて、必要なら自分で立てる。返すのは行き先と後始末の2つだけ。

  given（FIT_BASE / CONTRAST_BASE）を渡したときは、そこに向けて測るだけで
  何も起動しない——手元で `npm run dev` を動かしたまま測りたいとき用。
  そのときの stop() は何もしない関数なので、呼ぶ側は立てたかどうかを
  覚えておかなくてよい（`dev?.stop()` の ? を忘れる余地を残さない）。

  立ち上がらなかったときだけ、ためてあった出力を吐いてから投げ直す。
  ポートが塞がっていた・migrate を忘れた、はここに出る。
*/
export async function devServer(given, port) {
  const base = given ?? `http://localhost:${port}`
  if (given) return { base, stop: () => {} }

  const dev = spawnServer(port)
  try {
    await waitForServer(base)
  } catch (error) {
    dev.spill()
    dev.stop()
    throw error
  }
  return { base, stop: dev.stop, spill: dev.spill }
}
