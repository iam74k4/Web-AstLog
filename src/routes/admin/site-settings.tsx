import { Hono } from 'hono'
import { EDIT_CONFLICT, isEditConflict, settingsVersion } from '../../db/edit'
import { loadSiteSettings, saveSiteSettings } from '../../db/queries'
import type { AppEnv } from '../../env'
import { str } from '../../lib/format'
import {
  SITE_SETTING_KEYS,
  SITE_SETTING_LIMITS,
  type SiteSettings,
  siteSettingsErrors,
} from '../../site'
import { Area, Field, FormActions, FormSection, FormVersion, Select } from '../../ui/AdminForm'
import { AdminLayout } from '../../ui/AdminLayout'
import { PlacementHint } from '../../ui/AdminVisuals'
import { db } from './request'

export const siteSettingsRoutes = new Hono<AppEnv>()

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
      <PlacementHint label="表示される場所">
        入口の紹介文 → トップページ ／ Contact の案内文 → お問い合わせ ／ サイトの一言 → ページ下部
      </PlacementHint>
      <FormSection title="サイトの紹介" note="入口の文章と、サイト全体の短い紹介を設定します。">
        <Field
          label="サイトの一言"
          name="tagline"
          value={props.site.tagline}
          hint="ページ下部に出ます。公開中のメンバーが1人の場合、入口の大見出しはそのメンバーの見出しになります"
          required
          maxlength={SITE_SETTING_LIMITS.tagline}
          error={props.errors?.tagline}
        />
        <Area
          rows={3}
          label="入口の紹介文"
          name="heroLead"
          value={props.site.heroLead}
          hint="入口のリード文とサイトの説明文に出ます"
          required
          maxlength={SITE_SETTING_LIMITS.heroLead}
          error={props.errors?.heroLead}
        />
      </FormSection>
      <FormSection title="お問い合わせ" note="Contact とページ下部に表示する連絡先です。">
        <Area
          rows={3}
          label="Contact の案内文"
          name="contactLead"
          value={props.site.contactLead}
          hint="どのような相談を受けるかを1文で書きます"
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
      </FormSection>
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
        hint="Profile / Team は、公開中のメンバーが1人ならプロフィール、複数ならメンバー一覧です。画面の選択は設定として保存されません"
      />
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

siteSettingsRoutes.post('/site', async (c) => {
  const form = await c.req.formData()
  const site = Object.fromEntries(
    SITE_SETTING_KEYS.map((key) => [key, str(form.get(key))]),
  ) as SiteSettings
  const version = String(form.get('_version') ?? '')
  const back = (errors: Record<string, string>, status: 400 | 409) =>
    c.html(
      <SiteSettingsPage account={c.get('account')} site={site} version={version} errors={errors} />,
      status,
    )
  if (version !== (await settingsVersion(db(c), 'site.')))
    return back({ _version: EDIT_CONFLICT }, 409)
  const errors = siteSettingsErrors(site)
  if (errors) return back(errors, 400)
  try {
    await saveSiteSettings(db(c), site, version)
  } catch (error) {
    if (isEditConflict(error)) return back({ _version: EDIT_CONFLICT }, 409)
    throw error
  }
  return c.redirect('/admin/site?saved=1', 303)
})
