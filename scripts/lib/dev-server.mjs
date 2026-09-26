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
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
function spawnServer(port, persistTo) {
  const args = ['dev', '--port', String(port)]
  if (persistTo) args.push('--persist-to', persistTo)
  const server = spawn(`${ROOT}node_modules/.bin/wrangler`, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise((resolve) => server.once('exit', resolve))
  const log = []
  const keep = (chunk) => log.push(String(chunk))
  server.stdout.on('data', keep)
  server.stderr.on('data', keep)

  /*
    stop() は落ちきるまで待てる Promise を返す。同じポートで2つ目のサーバを立てる
    （check:fit は seed と fixture を続けて測る）とき、前のサーバがまだポートを
    掴んでいると、2つ目は立ち上がれず、待つ側は**前のサーバ**の返事を受けて
    そのまま測り始める——別の中身を測って緑を出す。10 秒で落ちなければ SIGKILL。
  */
  return {
    stop: () => {
      server.stdout.off('data', keep)
      server.stderr.off('data', keep)
      if (server.exitCode !== null || server.signalCode !== null) return exited
      server.kill('SIGTERM')
      const force = setTimeout(() => server.kill('SIGKILL'), 10_000)
      return exited.finally(() => clearTimeout(force))
    },
    spill: () => console.error(log.join('')),
  }
}

/*
  測る相手を決めて、必要なら自分で立てる。返すのは行き先と後始末の2つだけ。

  persistTo を渡すと、その置き場の D1 と KV で立てる（scratchState が作ったもの）。

  given（FIT_BASE / CONTRAST_BASE）を渡したときは、そこに向けて測るだけで
  何も起動しない——手元で `npm run dev` を動かしたまま測りたいとき用。
  そのときの stop() は何もしない関数なので、呼ぶ側は立てたかどうかを
  覚えておかなくてよい（`dev?.stop()` の ? を忘れる余地を残さない）。

  立ち上がらなかったときだけ、ためてあった出力を吐いてから投げ直す。
  ポートが塞がっていた・migrate を忘れた、はここに出る。
*/
export async function devServer(given, port, persistTo) {
  const base = given ?? `http://localhost:${port}`
  if (given) return { base, stop: async () => {} }

  const dev = spawnServer(port, persistTo)
  try {
    await waitForServer(base)
  } catch (error) {
    dev.spill()
    await dev.stop()
    throw error
  }
  return { base, stop: dev.stop, spill: dev.spill }
}

/*
  使い捨ての D1（と KV）を作る。wrangler の --persist-to で、手元の .wrangler/state とは
  別の置き場に移行を流し、渡した SQL を順に当てる。

  check:fit は seed（1人のサイト）と fixture（複数人・上限ちょうど）の2つの中身を
  測る。手元の D1 に流すと、開発中のデータを消してしまう（seed.sql も fixture も
  先に全部消してから入れる）。置き場を分ければ、手元の D1 には一切触らず、
  「migrate / seed を忘れたワークツリーで、ほとんど何も測らずに緑」も起きない。

  返す cleanup() が置き場ごと消す。
*/
export async function scratchState(label, sqlTexts) {
  const dir = await mkdtemp(join(tmpdir(), `noctifex-${label}-`))
  const wrangler = `${ROOT}node_modules/.bin/wrangler`
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(wrangler, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
      const log = []
      child.stdout.on('data', (chunk) => log.push(String(chunk)))
      child.stderr.on('data', (chunk) => log.push(String(chunk)))
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `wrangler ${args.slice(0, 3).join(' ')} が ${code} で落ちた\n${log.join('')}`,
              ),
            ),
      )
    })

  try {
    await run(['d1', 'migrations', 'apply', 'noctifex', '--local', '--persist-to', dir])
    for (const [index, sql] of sqlTexts.entries()) {
      const file = join(dir, `data-${index}.sql`)
      await writeFile(file, sql)
      await run(['d1', 'execute', 'noctifex', '--local', '--persist-to', dir, `--file=${file}`])
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
