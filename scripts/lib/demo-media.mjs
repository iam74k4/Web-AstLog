/*
  検査用の作品画像は public/ に置かず、ローカルの KV にだけ入れる。置き場は名前で決める
  （avatar.png は顔、music- で始まるものは音楽の札のジャケット、ほかは作品の画像）。
*/
const folderOf = (name) =>
  name === 'avatar.png' ? 'avatars' : name.startsWith('music-') ? 'music' : 'items'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const MEDIA = fileURLToPath(new URL('../fixtures/media/', import.meta.url))

export async function demoMediaFile(directory) {
  const entries = await Promise.all(
    (await readdir(MEDIA)).map(async (name) => ({
      key: `${folderOf(name)}/${name}`,
      value: (await readFile(`${MEDIA}${name}`)).toString('base64'),
      base64: true,
      metadata: { contentType: name.endsWith('.png') ? 'image/png' : 'image/jpeg' },
    })),
  )
  const file = `${directory}/media.json`
  await writeFile(file, JSON.stringify(entries))
  return file
}
