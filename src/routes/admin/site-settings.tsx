import { Hono } from 'hono'
import { EDIT_CONFLICT, isEditConflict, settingsVersion } from '../../db/edit'
import { loadSiteSettings, saveSiteSettings, saveSiteSettingValues } from '../../db/queries'
import type { AppEnv } from '../../env'
import { appleMusicTrack, fetchArtwork, lookupAppleTrack } from '../../lib/apple-music'
import { parsePairs, str } from '../../lib/format'
import {
  AVAILABILITY_KEYS,
  SITE_SETTING_KEYS,
  SITE_SETTING_LIMITS,
  type SiteSettings,
  siteSettingsErrors,
} from '../../site'
import {
  Area,
  AvailabilityFields,
  Field,
  FormActions,
  FormSection,
  FormVersion,
  PairRows,
  readPairRows,
  Select,
} from '../../ui/AdminForm'
import { AdminLayout } from '../../ui/AdminLayout'
import { PlacementHint } from '../../ui/AdminVisuals'
import {
  commitWithImage,
  discardImages,
  pickBlob,
  putImage,
  quotaErrors,
  removeImage,
} from './images'
import { db } from './request'

export const siteSettingsRoutes = new Hono<AppEnv>()

/*
  サイト設定のフォームを読む（保存と「保存前にプレビュー」の2か所が読む）。相談の流れは組ごとの
  欄（PairRows）で受けて1行1件に畳み、ほかは欄の名前のまま。知らせはサイト設定の検査
  （siteSettingsErrors）と、組の欄の何行目か（readPairRows）を合わせたもの。

  音楽の札のジャケット（musicArt）はフォームから受け取らない——画像の URL は、保存のときに
  Apple から引いて KV に写したもの（resolveMusic）だけ。ここでは空にし、呼ぶ側が保存済みの
  値を重ねる
*/
export function readSiteForm(form: FormData): {
  site: SiteSettings
  errors: Record<string, string> | null
} {
  const steps = readPairRows(form, 'step')
  const site = Object.fromEntries(
    SITE_SETTING_KEYS.map((key) => [
      key,
      key === 'contactSteps' ? steps.text : key === 'musicArt' ? '' : str(form.get(key)),
    ]),
  ) as SiteSettings
  const errors = {
    ...siteSettingsErrors(site),
    ...(steps.error ? { contactSteps: steps.error } : {}),
  }
  return { site, errors: Object.keys(errors).length ? errors : null }
}

const SiteSettingsPage = (props: {
  account: string
  site: SiteSettings
  version: string
  flash?: string | null
  errors?: Record<string, string> | null
}) => (
  <AdminLayout
    title="サイト設定"
    active="site"
    account={props.account}
    flash={props.flash}
    errors={props.errors}
    latestHref="/admin/site"
    live
  >
    <div class="admin-head">
      <div class="admin-head__title">
        <span class="crumbs">サイト全体</span>
        <h1>サイト設定</h1>
      </div>
      <a class="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
        公開中のサイトを見る ↗
      </a>
    </div>
    <p class="form-note">
      公開する文章と連絡先を編集します。保存前にプレビューで表示位置を確認できます。保存すると公開中のサイトに反映されます。プレビューは保存されません。
    </p>
    <form method="post" action="/admin/site" class="form">
      <FormVersion value={props.version} />
      {/*
        どの画面で確かめるかは、フォームの頭で選ぶ（横の完成形と「保存前にプレビュー」の行き先）。
        いちばん下に置いていたころは、欄を直して完成形を見るたびに、下まで送って画面を選び直していた
      */}
      <Select
        label="プレビューする画面"
        name="previewScreen"
        value="hero"
        options={[
          { value: 'hero', label: '入口' },
          { value: 'projects', label: 'Projects' },
          { value: 'team', label: 'Profile / Team' },
          { value: 'contact', label: 'Contact' },
          { value: 'all', label: '全体' },
        ]}
        hint="欄に触れると、その欄が出る画面に切り替わります。Profile / Team は、公開中のメンバーが1人ならプロフィール、複数ならメンバー一覧です。画面の選択は設定として保存されません"
      />
      <PlacementHint label="表示される場所">
        入口の紹介文 → トップページ ／ Contact の案内文・受付状況・相談の流れ → お問い合わせ ／
        GitHub・Instagram・X・Discord・Mail → ページ下部 ／ 音楽 →
        左の柱の下（狭い画面はページ下部）
      </PlacementHint>
      <FormSection
        title="サイトの紹介"
        note="入口の文章と、サイト全体の短い紹介を設定します。"
        preview="hero"
      >
        <Field
          label="サイトの一言"
          name="tagline"
          value={props.site.tagline}
          hint="公開中のメンバーが2人以上の場合に、入口の大見出しになります。1人の場合はそのメンバーの見出しが出ます"
          required
          maxlength={SITE_SETTING_LIMITS.tagline}
          error={props.errors?.tagline}
        />
        <Area
          rows={3}
          label="入口の紹介文"
          name="heroLead"
          value={props.site.heroLead}
          hint="入口の大見出しの下のリード文と、サイトの説明文に出ます。空なら出しません"
          maxlength={SITE_SETTING_LIMITS.heroLead}
          error={props.errors?.heroLead}
        />
        <Area
          rows={4}
          label="入口で打ち替える言葉"
          name="heroRoles"
          value={props.site.heroRoles}
          hint="1行に1つ、4つまで（例: System Engineer）。入口の大見出しの下で1字ずつ打っては消して入れ替わります。空なら出さず、大見出しの上に肩書きを出します"
          maxlength={SITE_SETTING_LIMITS.heroRoles}
          error={props.errors?.heroRoles}
        />
      </FormSection>
      <FormSection
        title="お問い合わせ"
        note="Contact とページ下部に表示する連絡先です。"
        preview="contact"
      >
        <Area
          rows={3}
          label="Contact の案内文"
          name="contactLead"
          value={props.site.contactLead}
          hint="どのような相談を受けるかを「です・ます」の1文で書きます。Contact の見出しの下（連絡先の表の上）に出し、検索結果の説明文にも使います。受け付けていない時期は、その旨に書き換えます"
          required
          maxlength={SITE_SETTING_LIMITS.contactLead}
          error={props.errors?.contactLead}
        />
        <Field
          label="公開するメールアドレス"
          name="email"
          type="email"
          value={props.site.email}
          hint="空ならメールのリンクを出しません。ログイン用のアカウント設定とは別です"
          maxlength={SITE_SETTING_LIMITS.email}
          error={props.errors?.email}
        />
        <Field
          label="公開する GitHub URL"
          name="github"
          type="url"
          value={props.site.github}
          hint="https:// で始まる URL。空なら GitHub のリンクを出しません"
          maxlength={SITE_SETTING_LIMITS.github}
          error={props.errors?.github}
        />
        <Field
          label="公開する Instagram URL"
          name="instagram"
          type="url"
          value={props.site.instagram}
          hint="https:// で始まる URL。Contact とページ下部に出ます。空なら出しません"
          maxlength={SITE_SETTING_LIMITS.instagram}
          error={props.errors?.instagram}
        />
        <Field
          label="公開する X URL"
          name="x"
          type="url"
          value={props.site.x}
          hint="https:// で始まる URL。Contact とページ下部に出ます。空なら出しません"
          maxlength={SITE_SETTING_LIMITS.x}
          error={props.errors?.x}
        />
        <Field
          label="公開する Discord のユーザー名"
          name="discord"
          value={props.site.discord}
          hint="@ は付けない（例: iam74k4）。Contact に名前を出します。下の URL が空なら、ページ下部の印はその行へ移ります。空なら出しません"
          maxlength={SITE_SETTING_LIMITS.discord}
          error={props.errors?.discord}
        />
        <Field
          label="公開する Discord URL"
          name="discordUrl"
          type="url"
          value={props.site.discordUrl}
          hint="プロフィール（https://discord.com/users/数字の ID）か招待リンク（https://discord.gg/…）。入れると、ページ下部の印と Contact の Discord の行から Discord を開けます。ID は Discord の設定で開発者モードをオンにし、自分のプロフィールの「ユーザーIDをコピー」で取れます"
          maxlength={SITE_SETTING_LIMITS.discordUrl}
          error={props.errors?.discordUrl}
        />
      </FormSection>
      <FormSection
        title="受付状況"
        note="Contact の連絡先の表の横に出します。状態は概要の画面からも変えられます。"
        preview="contact"
      >
        <AvailabilityFields site={props.site} errors={props.errors} />
      </FormSection>
      <FormSection
        title="相談の流れ"
        note="Contact の下に、連絡から始まる手順を横に並べます。"
        preview="contact"
      >
        <PairRows
          legend="手順"
          name="contactSteps"
          field="step"
          pairs={parsePairs(props.site.contactSteps)}
          rows={4}
          titlePlaceholder="見出し（例: ご連絡）"
          textPlaceholder="説明（例: メールで、やりたいことを一言いただければ十分です。）"
          hint="上から順に 01・02 … と番号を付けて出します。説明は「です・ます」の1文。空なら出しません"
          error={props.errors?.contactSteps}
        />
      </FormSection>
      <FormSection
        title="音楽"
        note="いま繰り返し聴いている1曲を、ジャケットと一緒に左の柱の下（狭い画面ではページ下部）に出します。押すと Apple Music の曲のページが別のタブで開きます。"
        preview="hero"
      >
        <Field
          label="Apple Music の曲の URL"
          name="musicUrl"
          type="url"
          inputmode="url"
          value={props.site.musicUrl}
          hint="ミュージックで曲の「共有 → リンクをコピー」で取った URL を貼ります。保存のときに、曲名・アーティスト名・ジャケットを Apple Music から読み込みます。空にして保存すると札を外します"
          maxlength={SITE_SETTING_LIMITS.musicUrl}
          error={props.errors?.musicUrl ?? props.errors?.musicArt}
        />
        <Field
          label="曲名"
          name="musicTitle"
          value={props.site.musicTitle}
          hint="空なら Apple Music の曲名を入れます。曲を替えると、新しい曲の名前に入れ替わります。半角 40 字（全角 20 字）まで"
          maxlength={SITE_SETTING_LIMITS.musicTitle}
          error={props.errors?.musicTitle}
        />
        <Field
          label="アーティスト名"
          name="musicArtist"
          value={props.site.musicArtist}
          hint="名前がカタカナで入ったとき（例: アヴィーチー）は、ここで直して保存します（例: Avicii）。空なら Apple Music の名前に戻します。半角 24 字（全角 12 字）まで"
          maxlength={SITE_SETTING_LIMITS.musicArtist}
          error={props.errors?.musicArtist}
        />
        {props.site.musicArt ? (
          <div class="field">
            <span class="field__label">いまのジャケット</span>
            <img class="icon-preview" src={props.site.musicArt} alt="" width="64" height="64" />
          </div>
        ) : null}
      </FormSection>
      <FormActions cancelHref="/admin/site" previewAction="/admin/preview/site" />
    </form>
  </AdminLayout>
)

siteSettingsRoutes.get('/site', async (c) =>
  c.html(
    <SiteSettingsPage
      account={c.get('account')}
      version={await settingsVersion(db(c), 'site.')}
      site={await loadSiteSettings(db(c))}
      flash={c.req.query('saved') ? '保存しました' : null}
    />,
  ),
)

const MUSIC_ERRORS = {
  missing:
    'この URL の曲が Apple Music で見つかりませんでした。曲の「共有 → リンクをコピー」で取り直してください',
  unreachable:
    'Apple Music から曲の情報を読み込めませんでした。少し時間をおいて、もう一度保存してください',
  artwork:
    'Apple Music からジャケットを読み込めませんでした。少し時間をおいて、もう一度保存してください',
} as const

type MusicValues = Pick<SiteSettings, 'musicTitle' | 'musicArtist' | 'musicArt'>
type ResolvedMusic =
  | { values: MusicValues; placed: string | null; retired: string | null }
  | { field: string; error: string; status: 400 | 502 }

/*
  音楽の札の曲を決める（保存の前。KV に置くのは検査が通ってから）。
  - URL が空: 札を外す（名前も消し、前のジャケットは保存のあとで控えへ）
  - 同じ曲: 書いた名前を残す。名前が空なら Apple の名前に戻す。ジャケットはそのまま
  - 曲が替わった: Apple から名前とジャケットを引き直す。名前の欄は、前に保存した名前のまま
    なら新しい曲の名前に入れ替え、書き替えてあればそれを残す（カタカナの直しを同じ保存で書ける）
  ジャケットは KV の music/ に写す（placed）。保存が落ちたら commitWithImage が消す
*/
async function resolveMusic(
  kv: KVNamespace,
  site: SiteSettings,
  saved: SiteSettings,
): Promise<ResolvedMusic> {
  if (!site.musicUrl) {
    return {
      values: { musicTitle: '', musicArtist: '', musicArt: '' },
      placed: null,
      retired: saved.musicArt || null,
    }
  }
  const sameSong = site.musicUrl === saved.musicUrl && Boolean(saved.musicArt)
  const kept = (key: 'musicTitle' | 'musicArtist') =>
    Boolean(site[key]) && (sameSong || site[key] !== saved[key])
  if (sameSong && kept('musicTitle') && kept('musicArtist')) {
    return {
      values: {
        musicTitle: site.musicTitle,
        musicArtist: site.musicArtist,
        musicArt: saved.musicArt,
      },
      placed: null,
      retired: null,
    }
  }
  const ref = appleMusicTrack(site.musicUrl)
  if (!ref) return { field: 'musicUrl', error: MUSIC_ERRORS.missing, status: 400 }
  const found = await lookupAppleTrack(ref)
  if ('problem' in found) {
    return {
      field: 'musicUrl',
      error: MUSIC_ERRORS[found.problem],
      status: found.problem === 'missing' ? 400 : 502,
    }
  }
  const values: MusicValues = {
    musicTitle: kept('musicTitle') ? site.musicTitle : found.track.title,
    musicArtist: kept('musicArtist') ? site.musicArtist : found.track.artist,
    musicArt: saved.musicArt,
  }
  if (sameSong) return { values, placed: null, retired: null }
  const bytes = await fetchArtwork(found.track.artwork)
  const picked = bytes ? await pickBlob(new File([bytes], 'artwork')) : null
  if (!picked?.image) return { field: 'musicUrl', error: MUSIC_ERRORS.artwork, status: 502 }
  const quota = await quotaErrors(kv, [['musicUrl', picked.image]])
  if (quota) return { field: 'musicUrl', error: quota.musicUrl ?? '', status: 400 }
  const art = await putImage(kv, picked.image, 'music', values.musicTitle)
  return { values: { ...values, musicArt: art }, placed: art, retired: saved.musicArt || null }
}

siteSettingsRoutes.post('/site', async (c) => {
  const form = await c.req.formData()
  const { site: sent, errors } = readSiteForm(form)
  const saved = await loadSiteSettings(db(c))
  // ジャケットは送られてこない（readSiteForm）。描き直す画面には保存済みのものを見せる
  let site: SiteSettings = { ...sent, musicArt: saved.musicArt }
  const version = String(form.get('_version') ?? '')
  const back = (errors: Record<string, string>, status: 400 | 409 | 502) =>
    c.html(
      <SiteSettingsPage account={c.get('account')} site={site} version={version} errors={errors} />,
      status,
    )
  if (version !== (await settingsVersion(db(c), 'site.')))
    return back({ _version: EDIT_CONFLICT }, 409)
  if (errors) return back(errors, 400)
  const music = await resolveMusic(c.env.MEDIA, site, saved)
  if ('error' in music) return back({ [music.field]: music.error }, music.status)
  /*
    Apple の名前が欄の上限を超えたときは、Apple の名前を欄に入れて書き直してもらう。置いた
    ジャケットは片付け、画面には保存済みのジャケットを見せる（消した画像を指さない）
  */
  const late = siteSettingsErrors({ ...site, ...music.values })
  if (late) {
    await removeImage(c.env.MEDIA, music.placed)
    site = { ...site, ...music.values, musicArt: saved.musicArt }
    return back(late, 400)
  }
  site = { ...site, ...music.values }
  try {
    await commitWithImage(c.env.MEDIA, music.placed, () => saveSiteSettings(db(c), site, version))
  } catch (error) {
    if (isEditConflict(error)) return back({ _version: EDIT_CONFLICT }, 409)
    throw error
  }
  if (music.retired && music.retired !== site.musicArt) {
    await discardImages(c.env.MEDIA, [music.retired])
  }
  return c.redirect('/admin/site?saved=1', 303)
})

/*
  概要の「受付状況」（src/ui/AdminDashboard.tsx）。受付状況の4つの欄だけを書く——状態はよく
  変わるので、サイト設定を開かずに1回の保存で変えられるようにした。検査はサイト設定と同じ
  1本（いまの設定に重ねてから siteSettingsErrors）。弾いたときは、直す欄のあるサイト設定の
  画面を、送った受付状況のまま描き直す
*/
siteSettingsRoutes.post('/site/availability', async (c) => {
  const form = await c.req.formData()
  const sent = Object.fromEntries(AVAILABILITY_KEYS.map((key) => [key, str(form.get(key))]))
  const site = { ...(await loadSiteSettings(db(c))), ...sent }
  const errors = siteSettingsErrors(site)
  const ours = errors
    ? Object.fromEntries(
        Object.entries(errors).filter(([key]) =>
          (AVAILABILITY_KEYS as readonly string[]).includes(key),
        ),
      )
    : {}
  if (Object.keys(ours).length) {
    return c.html(
      <SiteSettingsPage
        account={c.get('account')}
        site={site}
        version={await settingsVersion(db(c), 'site.')}
        errors={ours}
      />,
      400,
    )
  }
  await saveSiteSettingValues(db(c), sent)
  return c.redirect('/admin?availability=saved', 303)
})
