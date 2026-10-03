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
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// Windows の .bin/wrangler は shell 用の入口なので、Node で CLI 本体を起動する。
export const WRANGLER =
  process.platform === 'win32' ? process.execPath : `${ROOT}node_modules/.bin/wrangler`
export const WRANGLER_ARGS =
  process.platform === 'win32' ? [`${ROOT}node_modules/wrangler/wrangler-dist/cli.js`] : []

// dev サーバが返事をするまで待つ。起動は初回だけ数秒かかる。
// gaveUp() が true を返したら（子が先に終わった）、待つのをやめる
async function waitForServer(base, gaveUp, limitMs = 120_000) {
  const until = Date.now() + limitMs
  while (Date.now() < until && !gaveUp()) {
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
  const server = spawn(WRANGLER, [...WRANGLER_ARGS, ...args], {
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
    exited,
  }
}

/*
  そのポートで誰かが待ち受けているか。localhost は IPv4 と IPv6 の両方に解ける
  （fetch がどちらへ行くかは環境しだい）ので、両方を叩く。
*/
const listening = (port) =>
  Promise.all(
    ['127.0.0.1', '::1'].map(
      (host) =>
        new Promise((resolve) => {
          const socket = connect({ host, port })
          const done = (answer) => {
            socket.destroy()
            resolve(answer)
          }
          socket.once('connect', () => done(true))
          socket.once('error', () => done(false))
          socket.setTimeout(1_000, () => done(false))
        }),
    ),
  ).then((answers) => answers.includes(true))

/*
  測る相手を決めて、必要なら自分で立てる。返すのは行き先と後始末の2つだけ。

  persistTo を渡すと、その置き場の D1 と KV で立てる（scratchState が作ったもの）。

  given（FIT_BASE / CONTRAST_BASE）を渡したときは、そこに向けて測るだけで
  何も起動しない——手元で `npm run dev` を動かしたまま測りたいとき用。
  そのときの stop() は何もしない関数なので、呼ぶ側は立てたかどうかを
  覚えておかなくてよい（`dev?.stop()` の ? を忘れる余地を残さない）。

  **測るのは自分が立てたサーバだけ。** ポートが塞がっていると wrangler は
  「Address already in use」ですぐ終わるが、待つ側（waitForServer）は誰の返事でも
  受けるので、そのポートを持っている**別のサーバ**（別のワークツリーの dev や検査）を
  測って緑を出していた——月を壊した作業ツリーの check:contrast が、相手の無傷の
  画面を測って「✓ 360 通り」を出したことがある。そこで2つ止める。
  - 立てる前に、そのポートで誰も待ち受けていないことを確かめる（使われていれば止まる）
  - 準備ができる前に wrangler が終わったら、返事を待たずに止まる（確かめたあとで
    取られた・移行を忘れた、など）

  立ち上がらなかったときだけ、ためてあった出力を吐いてから投げ直す。
*/
export async function devServer(given, port, persistTo) {
  const base = given ?? `http://localhost:${port}`
  if (given) return { base, stop: async () => {} }

  // 前のサーバを落とした直後は、ポートが手放されるまで少しかかることがある
  const freeBy = Date.now() + 5_000
  while ((await listening(port)) && Date.now() < freeBy) await sleep(250)
  if (await listening(port)) {
    throw new Error(
      `ポート ${port} はもう使われている。別のサーバを測らないよう、ここで止める` +
        '（空いているポートを FIT_PORT / CONTRAST_PORT で渡すか、使っているプロセスを止める）',
    )
  }

  const dev = spawnServer(port, persistTo)
  let ended = false
  dev.exited.then(() => {
    ended = true
  })
  try {
    await Promise.race([
      waitForServer(base, () => ended),
      dev.exited.then((code) => {
        throw new Error(
          `wrangler dev が立ち上がる前に終わった（終了コード ${code}。ポート ${port} が使われていないか、上の出力を見ること）`,
        )
      }),
    ])
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

  check:fit は seed（1人のサイト）と fixture（複数人・上限ちょうど）など4つの中身を
  測る。手元の D1 に流すと、開発中のデータを消してしまう（seed.sql も fixture も
  先に全部消してから入れる）。置き場を分ければ、手元の D1 には一切触らず、
  「migrate / seed を忘れたワークツリーで、ほとんど何も測らずに緑」も起きない。

  返す cleanup() が置き場ごと消す。
*/
export async function scratchState(label, sqlTexts) {
  const dir = await mkdtemp(join(tmpdir(), `astlog-${label}-`))
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(WRANGLER, [...WRANGLER_ARGS, ...args], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.once('error', reject)
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
    await run(['d1', 'migrations', 'apply', 'astlog', '--local', '--persist-to', dir])
    for (const [index, sql] of sqlTexts.entries()) {
      const file = join(dir, `data-${index}.sql`)
      await writeFile(file, sql)
      await run(['d1', 'execute', 'astlog', '--local', '--persist-to', dir, `--file=${file}`])
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    throw error
  }
  // Windows は dev 終了直後も観測ログのハンドルが閉じるまで少し掛かる。
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }),
  }
}
