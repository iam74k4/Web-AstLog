import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSiteSettings, saveSiteSettings } from '../src/db/queries'
import { appleMusicTrack, lookupAppleTrack } from '../src/lib/apple-music'
import { mediaUsage } from '../src/lib/media-usage'
import { MUSIC_KEYS, musicTracks, SITE_SETTING_KEYS, type SiteSettings } from '../src/site'
import { db, form, get, okText, resetDb, seedItem, seedMember, signIn, touch } from './helpers'
import { jpeg, png } from './images'

/*
  柱の底の音楽の札（サイト設定の「音楽」）。持ち主が貼るのは Apple Music の曲の URL だけで、
  曲名・アーティスト名・ジャケットは保存のときに Apple の公開の検索 API から引き、ジャケットは
  KV の music/ に写す（src/lib/apple-music.ts・src/routes/admin/site-settings.tsx の resolveMusic）。

  Apple への fetch は globalThis.fetch を差し替えて受ける（テストは SELF と同じ isolate で動く）。
  差し替えに無い宛先へ出たら例外にする——本物の Apple へ出ていく道を残さない。
*/

beforeEach(async () => {
  await resetDb()
  // KV は D1 と違って毎回は空にならない。この試験が置く置き場だけを空にする
  for (const prefix of ['music/', 'archive/music/']) {
    for (const key of (await env.MEDIA.list({ prefix })).keys) await env.MEDIA.delete(key.name)
  }
})
afterEach(() => {
  vi.restoreAllMocks()
})

const HIGH_ON_LIFE =
  'https://music.apple.com/jp/album/high-on-life-feat-bonn/1416740613?i=1416740913'
const THE_NIGHTS = 'https://music.apple.com/jp/album/the-nights/1440835790?i=1440836873'
const ART = (name: string) =>
  `https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/58/a2/33/${name}.jpg/100x100bb.jpg`

type Song = { trackId: number; trackName: string; artistName: string; art: string }
const SONGS: Record<string, Song> = {
  '1416740913': {
    trackId: 1416740913,
    trackName: 'High on Life (feat. Bonn)',
    artistName: 'Martin Garrix',
    art: 'high',
  },
  '1440836873': {
    trackId: 1440836873,
    trackName: 'The Nights',
    // 日本のストアはアーティスト名をカタカナで返すことがある
    artistName: 'アヴィーチー',
    art: 'nights',
  },
  '1453438470': {
    trackId: 1453438470,
    trackName: 'No Sleep (feat. Bonn)',
    artistName: 'Martin Garrix',
    art: 'sleep',
  },
  '1500000001': {
    trackId: 1500000001,
    // 柱の幅に収まらない長さ（半角 40 字を超える）
    trackName: 'Piano Concerto No. 2 in C Minor, Op. 18: II. Adagio sostenuto',
    artistName: 'Sergei Rachmaninoff',
    art: 'long',
  },
}

type AppleOptions = { down?: boolean; artwork?: Uint8Array | null }

// Apple の検索 API とジャケットの置き場の偽物。呼ばれた宛先と、打ち切りの signal の有無を残す
function apple(options: AppleOptions = {}) {
  const calls: { url: string; timed: boolean }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(new Request(input as RequestInfo, init).url)
    calls.push({ url: url.href, timed: init?.signal instanceof AbortSignal })
    if (url.origin === 'https://itunes.apple.com' && url.pathname === '/lookup') {
      if (options.down) throw new TypeError('network down')
      const song = SONGS[url.searchParams.get('id') ?? '']
      const results = song
        ? [
            {
              wrapperType: 'track',
              kind: 'song',
              trackId: song.trackId,
              trackName: song.trackName,
              artistName: song.artistName,
              artworkUrl100: ART(song.art),
            },
          ]
        : []
      return Response.json({ resultCount: results.length, results })
    }
    if (url.hostname === 'is1-ssl.mzstatic.com') {
      const bytes = options.artwork === undefined ? jpeg(200, 200) : options.artwork
      return bytes
        ? new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })
        : new Response('', { status: 404 })
    }
    throw new Error(`想定していない fetch: ${url.href}`)
  })
  return calls
}

type MusicForm = Record<string, string | string[]>

/*
  サイト設定のフォーム。いまの設定に音楽の欄だけを重ねて送る。曲は行ごとの欄（同じ名前の欄が
  並ぶ。AdminForm.tsx の MusicRows）で、いまの曲を行に並べてから重ねる
*/
async function siteForm(music: MusicForm) {
  const site = await loadSiteSettings(db())
  const values: MusicForm = {}
  for (const key of SITE_SETTING_KEYS) {
    if (key === 'contactSteps' || (MUSIC_KEYS as readonly string[]).includes(key)) continue
    values[key] = site[key]
  }
  const tracks = musicTracks(site)
  values.musicUrl = tracks.map((track) => track.url)
  values.musicTitle = tracks.map((track) => track.title)
  values.musicArtist = tracks.map((track) => track.artist)
  return form({ ...values, ...music })
}

const keys = async (prefix: string) =>
  (await env.MEDIA.list({ prefix })).keys.map((key) => key.name).sort()

async function save(music: MusicForm) {
  const signed = await signIn()
  return signed('/admin/site', { method: 'POST', body: await siteForm(music) })
}

describe('曲の URL', () => {
  it('曲のリンクの2つの形だけを読む（アルバム・プレイリスト・ほかのサイトは読まない）', () => {
    expect(appleMusicTrack(HIGH_ON_LIFE)).toEqual({ country: 'jp', id: '1416740913' })
    expect(appleMusicTrack(`${HIGH_ON_LIFE}&ls`)).toEqual({ country: 'jp', id: '1416740913' })
    expect(appleMusicTrack('https://music.apple.com/us/song/the-nights/1440836873')).toEqual({
      country: 'us',
      id: '1440836873',
    })
    for (const url of [
      'https://music.apple.com/jp/album/high-on-life-feat-bonn/1416740613',
      'https://music.apple.com/jp/playlist/today/pl.123',
      'https://music.apple.com/jp/artist/martin-garrix/599092',
      'http://music.apple.com/jp/album/x/1?i=2',
      'https://music.apple.com.evil.test/jp/album/x/1?i=2',
      'https://user@music.apple.com/jp/album/x/1?i=2',
      'https://music.apple.com/japan/album/x/1?i=2',
      'https://music.apple.com/jp/album/x/1?i=abc',
      'javascript:alert(1)',
      '',
    ]) {
      expect(appleMusicTrack(url), url).toBeNull()
    }
  })

  it('Apple から名前と、頼んだ大きさのジャケットの URL を引く。待ちには打ち切りを付ける', async () => {
    const calls = apple()
    const found = await lookupAppleTrack({ country: 'jp', id: '1416740913' })
    expect(found).toEqual({
      track: {
        title: 'High on Life (feat. Bonn)',
        artist: 'Martin Garrix',
        artwork: ART('high').replace('100x100bb', '200x200bb'),
      },
    })
    expect(calls).toEqual([
      {
        url: 'https://itunes.apple.com/lookup?id=1416740913&country=jp&entity=song',
        timed: true,
      },
    ])
    expect(await lookupAppleTrack({ country: 'jp', id: '1' })).toEqual({ problem: 'missing' })
  })
})

describe('音楽の札を保存する', () => {
  it('曲の URL を貼るだけで、名前とジャケットを引いて柱の底と足元に出す', async () => {
    const member = await seedMember()
    await seedItem({ slug: 'sample', summary: '作品の説明。' })
    const calls = apple()
    const response = await save({ musicUrl: HIGH_ON_LIFE })
    expect(response.status).toBe(303)
    const site = await loadSiteSettings(db())
    expect(site.musicTitle).toBe('High on Life (feat. Bonn)')
    expect(site.musicArtist).toBe('Martin Garrix')
    expect(site.musicArt).toMatch(/^\/images\/music\/high-on-life-feat-bonn-[0-9a-f]{32}\.jpg$/)
    expect(await keys('music/')).toEqual([site.musicArt.replace('/images/', '')])
    // 外への問い合わせは検索とジャケットの2本だけで、どちらも打ち切りを持つ
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual([
      'itunes.apple.com',
      'is1-ssl.mzstatic.com',
    ])
    expect(calls.every((call) => call.timed)).toBe(true)
    // ジャケットは数える置き場に入る
    expect((await mediaUsage(env.MEDIA)).used).toBeGreaterThan(0)

    for (const path of ['/', '/projects', `/members/${member.slug}`, '/apps/item/sample']) {
      const html = await okText(path)
      // 左の柱（900 以上）と足元（900 未満）に1つずつ。同時に見えるのは片方だけ
      expect(html.match(/class="music"/g), path).toHaveLength(2)
      const pillar = html.slice(html.indexOf('class="pillar__music"'))
      expect(pillar.indexOf('class="music"'), path).toBeLessThan(pillar.indexOf('pillar__foot'))
      const foot = html.slice(html.indexOf('<footer class="foot"'))
      expect(foot.indexOf('class="music"'), path).toBeLessThan(foot.indexOf('foot__meta'))
      expect(html).toContain(`href="${HIGH_ON_LIFE}" target="_blank" rel="noreferrer"`)
      expect(html).toContain(`<img class="music__art" src="${site.musicArt}" alt=""`)
      expect(html).toContain('<span class="music__label" lang="en">On repeat</span>')
    }
    // 全体ページ（紙にも刷る1本の文書）には出さない
    expect(await okText('/all')).not.toContain('class="music"')
    // 写したジャケットはサイトから配る
    const image = await get(site.musicArt)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/jpeg')
  })

  it('同じ曲のまま名前を直せる（カタカナの直し）。Apple には聞き直さない', async () => {
    apple()
    await save({ musicUrl: THE_NIGHTS })
    const before = await loadSiteSettings(db())
    expect(before.musicArtist).toBe('アヴィーチー')
    const calls = apple()
    expect(
      (await save({ musicUrl: THE_NIGHTS, musicTitle: 'The Nights', musicArtist: 'Avicii' }))
        .status,
    ).toBe(303)
    expect(calls).toEqual([])
    const after = await loadSiteSettings(db())
    expect(after.musicArtist).toBe('Avicii')
    expect(after.musicArt).toBe(before.musicArt)
    await touch()
    expect(await okText('/')).toContain('<span class="music__artist" lang="en">Avicii</span>')
    // 名前を空にして保存すると、Apple の名前に戻す（ジャケットはそのまま）
    await save({ musicUrl: THE_NIGHTS, musicTitle: 'The Nights', musicArtist: '' })
    expect((await loadSiteSettings(db())).musicArtist).toBe('アヴィーチー')
    expect((await loadSiteSettings(db())).musicArt).toBe(before.musicArt)
  })

  it('曲を替えると名前とジャケットを入れ替え、前のジャケットは控えへ移す', async () => {
    apple()
    await save({ musicUrl: HIGH_ON_LIFE })
    const first = await loadSiteSettings(db())
    // 前の曲の名前が欄に残ったまま URL だけを替えて保存する（画面で URL を貼り替えたとき）
    await save({
      musicUrl: THE_NIGHTS,
      musicTitle: first.musicTitle,
      musicArtist: 'Avicii',
    })
    const second = await loadSiteSettings(db())
    expect(second.musicTitle).toBe('The Nights')
    // 書き替えた名前は残す（カタカナの直しを同じ保存で書ける）
    expect(second.musicArtist).toBe('Avicii')
    expect(second.musicArt).not.toBe(first.musicArt)
    expect(await keys('music/')).toEqual([second.musicArt.replace('/images/', '')])
    expect(await keys('archive/music/')).toEqual([
      `archive/${first.musicArt.replace('/images/', '')}`,
    ])
    // 外した画像は公開の URL から読めない
    expect((await get(first.musicArt)).status).toBe(404)
  })

  it('URL を空にして保存すると札を外し、ジャケットは控えへ移す', async () => {
    apple()
    await save({ musicUrl: HIGH_ON_LIFE })
    const saved = await loadSiteSettings(db())
    expect((await save({ musicUrl: '', musicTitle: 'x', musicArtist: 'y' })).status).toBe(303)
    const site = await loadSiteSettings(db())
    expect([site.musicUrl, site.musicTitle, site.musicArtist, site.musicArt]).toEqual([
      '',
      '',
      '',
      '',
    ])
    expect(await keys('music/')).toEqual([])
    expect(await keys('archive/music/')).toHaveLength(1)
    await touch()
    expect(await okText('/')).not.toContain('class="music"')
    expect(saved.musicArt).not.toBe('')
  })

  it('Apple に届かなければ 502 で入力を残し、何も書かない', async () => {
    apple({ down: true })
    const response = await save({ musicUrl: HIGH_ON_LIFE })
    expect(response.status).toBe(502)
    const html = await response.text()
    expect(html).toContain('Apple Music から曲の情報を読み込めませんでした')
    expect(html).toContain(`value="${HIGH_ON_LIFE.replaceAll('&', '&amp;')}"`)
    expect((await loadSiteSettings(db())).musicUrl).toBe('')
    expect(await keys('music/')).toEqual([])
  })

  it('ジャケットが取れない・画像でないときも 502 で、KV に何も置かない', async () => {
    for (const artwork of [null, new TextEncoder().encode('<svg onload="alert(1)"/>')]) {
      apple({ artwork })
      const response = await save({ musicUrl: HIGH_ON_LIFE })
      expect(response.status).toBe(502)
      expect(await response.text()).toContain('ジャケットを読み込めませんでした')
      expect(await keys('music/')).toEqual([])
      vi.restoreAllMocks()
    }
  })

  it('曲でない URL・見つからない曲は 400 で欄を示す', async () => {
    apple()
    const album = await save({
      musicUrl: 'https://music.apple.com/jp/album/high-on-life-feat-bonn/1416740613',
    })
    expect(album.status).toBe(400)
    expect(await album.text()).toContain('Apple Music の曲の URL を入れてください')
    const missing = await save({ musicUrl: 'https://music.apple.com/jp/album/x/1?i=999' })
    expect(missing.status).toBe(400)
    expect(await missing.text()).toContain('この URL の曲が Apple Music で見つかりませんでした')
    expect(await keys('music/')).toEqual([])
  })

  it('Apple の名前が柱に収まらない長さなら 400 で欄を示し、短くすれば保存できる', async () => {
    const LONG = 'https://music.apple.com/jp/album/piano-concerto/1500000000?i=1500000001'
    apple()
    const response = await save({ musicUrl: LONG })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('半角 40 字（全角 20 字）までにしてください')
    // Apple の名前は欄に入れて返す（短くするところから始められる）
    expect(html).toContain('value="Piano Concerto No. 2 in C Minor, Op. 18: II. Adagio sostenuto"')
    expect(await keys('music/')).toEqual([])
    // 片付けたジャケットを「いまのジャケット」に出さない
    expect(html).not.toContain('/images/music/')
    expect((await loadSiteSettings(db())).musicUrl).toBe('')
    expect(
      (await save({ musicUrl: LONG, musicTitle: 'Piano Concerto No. 2: II. Adagio' })).status,
    ).toBe(303)
    const site = await loadSiteSettings(db())
    expect(site.musicTitle).toBe('Piano Concerto No. 2: II. Adagio')
    expect(site.musicArtist).toBe('Sergei Rachmaninoff')
    expect(await keys('music/')).toHaveLength(1)
    // 全角は2字に数える
    expect((await save({ musicUrl: LONG, musicTitle: '夜'.repeat(21) })).status).toBe(400)
  })

  it('ジャケットの URL はフォームから受け取らない', async () => {
    await env.MEDIA.put('items/other-1234abcd.png', png())
    apple()
    await save({ musicUrl: HIGH_ON_LIFE, musicArt: '/images/items/other-1234abcd.png' })
    const site = await loadSiteSettings(db())
    expect(site.musicArt).toMatch(/^\/images\/music\//)
  })
})

const NO_SLEEP = 'https://music.apple.com/jp/album/no-sleep-feat-bonn/1453438469?i=1453438470'

describe('曲を並べる', () => {
  it('3曲を一度に貼ると、上から順に名前とジャケットを引き、札に重ねて並べる', async () => {
    await seedMember()
    const calls = apple()
    const response = await save({ musicUrl: [HIGH_ON_LIFE, NO_SLEEP, THE_NIGHTS, '', ''] })
    expect(response.status).toBe(303)
    const tracks = musicTracks(await loadSiteSettings(db()))
    expect(tracks.map((track) => track.title)).toEqual([
      'High on Life (feat. Bonn)',
      'No Sleep (feat. Bonn)',
      'The Nights',
    ])
    expect(tracks.every((track) => /^\/images\/music\//.test(track.art))).toBe(true)
    expect(new Set(tracks.map((track) => track.art)).size).toBe(3)
    expect(await keys('music/')).toHaveLength(3)
    expect(calls).toHaveLength(6)
    await touch()
    const html = await okText('/')
    // 柱と足元に1つずつ。曲は同じ升に重ね、数を data-count で渡す（app.css の music-<数>）
    expect(html.match(/<div class="music" data-count="3">/g)).toHaveLength(2)
    expect(html.match(/class="music__song"/g)).toHaveLength(6)
    const card = html.slice(html.indexOf('class="pillar__music"'))
    expect(card.indexOf('High on Life')).toBeLessThan(card.indexOf('No Sleep'))
    expect(card.indexOf('No Sleep')).toBeLessThan(card.indexOf('The Nights'))
  })

  it('並べ替えても Apple には聞き直さず、ジャケットは曲について動く', async () => {
    apple()
    await save({ musicUrl: [HIGH_ON_LIFE, NO_SLEEP, THE_NIGHTS] })
    const before = musicTracks(await loadSiteSettings(db()))
    const calls = apple()
    const sent = [before[2], before[0], before[1]].filter((track) => track !== undefined)
    expect(
      (
        await save({
          musicUrl: sent.map((track) => track.url),
          musicTitle: sent.map((track) => track.title),
          musicArtist: sent.map((track) => track.artist),
        })
      ).status,
    ).toBe(303)
    expect(calls).toEqual([])
    const after = musicTracks(await loadSiteSettings(db()))
    expect(after).toEqual(sent)
  })

  it('外した曲のジャケットだけを控えへ移す', async () => {
    apple()
    await save({ musicUrl: [HIGH_ON_LIFE, NO_SLEEP, THE_NIGHTS] })
    const [first, second, third] = musicTracks(await loadSiteSettings(db()))
    await save({
      musicUrl: [HIGH_ON_LIFE, '', THE_NIGHTS],
      musicTitle: [first?.title ?? '', '', third?.title ?? ''],
      musicArtist: [first?.artist ?? '', '', third?.artist ?? ''],
    })
    const after = musicTracks(await loadSiteSettings(db()))
    expect(after.map((track) => track.url)).toEqual([HIGH_ON_LIFE, THE_NIGHTS])
    expect(after.map((track) => track.art)).toEqual([first?.art, third?.art])
    expect(await keys('archive/music/')).toEqual([
      `archive/${(second?.art ?? '').replace('/images/', '')}`,
    ])
  })

  it('同じ曲を2つ並べる・6曲以上を送ると 400 で、何曲目かを言う', async () => {
    apple()
    const twice = await save({ musicUrl: [HIGH_ON_LIFE, HIGH_ON_LIFE] })
    expect(twice.status).toBe(400)
    expect(await twice.text()).toContain('2 曲目: 同じ曲がもう並んでいます')
    const many = await save({
      musicUrl: Array.from(
        { length: 6 },
        (_, index) => `https://music.apple.com/jp/album/x/1?i=${index + 10}`,
      ),
    })
    expect(many.status).toBe(400)
    expect(await many.text()).toContain('曲は 5 曲までにしてください')
    expect(await keys('music/')).toEqual([])
  })

  it('2曲目で止まったら、1曲目で置いたジャケットも片付けて何も書かない', async () => {
    apple()
    const response = await save({
      musicUrl: [HIGH_ON_LIFE, 'https://music.apple.com/jp/album/x/1?i=999'],
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(
      '2 曲目: この URL の曲が Apple Music で見つかりませんでした',
    )
    expect(await keys('music/')).toEqual([])
    expect((await loadSiteSettings(db())).musicUrl).toBe('')
  })

  it('管理画面は曲の行を5つ並べ、いまのジャケットを行ごとに見せる', async () => {
    apple()
    await save({ musicUrl: [HIGH_ON_LIFE, NO_SLEEP] })
    const signed = await signIn()
    const html = await (await signed('/admin/site')).text()
    expect(html.match(/class="music-row"/g)).toHaveLength(5)
    expect(html).toContain('aria-label="1 曲目の Apple Music の URL"')
    expect(html).toContain('aria-label="5 曲目のアーティスト名"')
    expect(html.match(/class="music-row__art" src="\/images\/music\//g)).toHaveLength(2)
  })
})

describe('音楽の札を描く', () => {
  const music: Partial<SiteSettings> = {
    musicUrl: HIGH_ON_LIFE,
    musicTitle: 'High on Life (feat. Bonn)',
    musicArtist: 'Martin Garrix',
    musicArt: '/images/music/high-on-life-feat-bonn-0123456789abcdef0123456789abcdef.jpg',
  }

  it('4つ揃ったときだけ出す。ジャケットが KV の music/ でなければ出さない', async () => {
    await seedMember()
    const base = await loadSiteSettings(db())
    await saveSiteSettings(db(), { ...base, ...music })
    await touch()
    expect(await okText('/')).toContain('class="music"')
    for (const broken of [
      { musicArt: '/images/items/x-1234abcd.png' },
      { musicArt: 'https://is1-ssl.mzstatic.com/x.jpg' },
      { musicUrl: 'https://example.test/song' },
      { musicTitle: '' },
    ]) {
      await saveSiteSettings(db(), { ...base, ...music, ...broken })
      await touch()
      expect(await okText('/'), JSON.stringify(broken)).not.toContain('class="music"')
    }
  })

  it('和文の曲名には lang="en" を付けない（Poppins を和文に掛けない）', async () => {
    await seedMember()
    const base = await loadSiteSettings(db())
    await saveSiteSettings(db(), { ...base, ...music, musicTitle: '夜に駆ける' })
    await touch()
    const html = await okText('/')
    expect(html).toContain('<span class="music__title"><span class="music__name">夜に駆ける</span>')
    expect(html).toContain('<span class="music__artist" lang="en">Martin Garrix</span>')
  })
})
