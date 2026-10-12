import { MEDIA_ARCHIVE_PREFIX } from './media-retention'

/*
  管理画面から上げた画像と動画が KV で使っている容量と、その上限。

  数えるのは公開に使っている2つの置き場（avatars/・items/）だけ。外した画像の控え
  （archive/。90日で消える）は数えない——数えると、外して空けたつもりの容量が90日戻らず、
  上限の近くで何も足せなくなる。控えは概要に別に出す。

  大きさは置くときに metadata に添えたもの（putImage の size）を一覧から読む。添える前に
  置いたものは中身を読んで測る（数は少なく、控えは90日で入れ替わる）。KV の一覧は最大
  60 秒ほど遅れるので、上限の判定はおおよそ——1回の保存で上げられるのは多くても数十 MB。
*/
export const MEDIA_QUOTA_BYTES = 300_000_000

const LIVE_PREFIXES = ['avatars/', 'items/']

export type MediaUsage = { used: number; archived: number }

async function sizeOfPrefix(kv: KVNamespace, prefix: string): Promise<number> {
  let total = 0
  let cursor: string | undefined
  do {
    const page = await kv.list<{ size?: number }>({ prefix, cursor })
    for (const key of page.keys) {
      const size = key.metadata?.size
      if (typeof size === 'number') {
        total += size
        continue
      }
      const value = await kv.get(key.name, 'arrayBuffer')
      total += value?.byteLength ?? 0
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return total
}

export async function mediaUsage(kv: KVNamespace): Promise<MediaUsage> {
  const [live, archived] = await Promise.all([
    Promise.all(LIVE_PREFIXES.map((prefix) => sizeOfPrefix(kv, prefix))),
    sizeOfPrefix(kv, MEDIA_ARCHIVE_PREFIX),
  ])
  return { used: live.reduce((sum, size) => sum + size, 0), archived }
}

// 容量の見せ方（10進の MB で小数1桁。上限の 300MB と同じ単位）
export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)}MB`
