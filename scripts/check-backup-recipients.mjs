/*
  本番の写しを暗号化する公開鍵（.github/backup-recipients.txt）の番兵。

  deploy は本番の D1 と画像の写しを artifact に残す。このリポジトリは公開で、artifact は
  GitHub に入れる人なら誰でも落とせるので、写しは age の公開鍵で暗号化してから置く
  （deploy.yml の「写しを暗号化する」）。公開鍵が1本も無い・形の違う行があるなら、
  本番の写しを取り始める前に、直し方を言って止まる。deploy ワークフローの guard で動く。

  秘密鍵（AGE-SECRET-KEY-1…）が書かれていたら、それも止める。コミットした秘密鍵は
  履歴から消えないので、鍵ごと作り直してもらう。
*/

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(new URL('../.github/backup-recipients.txt', import.meta.url))
// age-keygen の公開鍵（X25519）。age1 と bech32 の 58 字
const RECIPIENT = /^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/

const lines = readFileSync(FILE, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

if (lines.some((line) => line.startsWith('AGE-SECRET-KEY-'))) {
  console.error(
    [
      '.github/backup-recipients.txt に秘密鍵（AGE-SECRET-KEY-1…）が書かれています。',
      'コミットした秘密鍵は履歴に残るので、その鍵は捨てて作り直してください。',
      'ここに書くのは age-keygen -y が出す公開鍵（age1…）だけです（README の「本番に出す」）。',
    ].join('\n'),
  )
  process.exit(1)
}

const wrong = lines.filter((line) => !RECIPIENT.test(line))
if (lines.length === 0 || wrong.length > 0) {
  console.error(
    [
      lines.length === 0
        ? '.github/backup-recipients.txt に、写しを暗号化する公開鍵がありません。'
        : `.github/backup-recipients.txt に age の公開鍵でない行があります: ${wrong.join(', ')}`,
      '鍵を作り、公開鍵（age1…）を1行に1本書いてコミットしてください:',
      '  age-keygen -o astlog-backup.key   # 秘密鍵。パスワードマネージャーへ移す',
      '  age-keygen -y astlog-backup.key   # 公開鍵',
      '（README の「本番に出す」）',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(`写しを暗号化する公開鍵は ${lines.length} 本あります`)
