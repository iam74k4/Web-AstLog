import { Hono } from 'hono'
import { loadTheme, saveTheme } from '../../db/queries'
import type { AppEnv } from '../../env'
import { str } from '../../lib/format'
import {
  isThemeValue,
  normalizeTheme,
  type PresetOption,
  THEME_CHOICES,
  THEME_GROUPS,
  THEME_KEYS,
  type Theme,
  type ThemeKey,
} from '../../theme'
import { FormActions } from '../../ui/AdminForm'
import { AdminLayout } from '../../ui/AdminLayout'
import { db } from './request'

export const appearanceRoutes = new Hono<AppEnv>()

/*
  骨格の見取り図。実物の縮小ではなく、どこに何が来るかだけを帯で見せる。
  本物を縮めて出すには CSS を二重に持つことになり、片方だけ古くなる。
*/
const Skeleton = ({ layout }: { layout: string }) => (
  <span class={`skel skel--${layout}`} aria-hidden="true">
    <i class="skel__mark" />
    <i />
    <i />
  </span>
)

// 見本は公開ページと同じ指定（data-*）で色と書体を出す。見本用の値を別に持たない
const PresetPreview = ({ group, option }: { group: ThemeKey; option: string }) => {
  if (group === 'layout') return <Skeleton layout={option} />
  if (group === 'accent') return <span class="swatch" data-accent={option} aria-hidden="true" />
  return (
    <span class="sample" data-typeface={option} aria-hidden="true">
      Aa 夜
    </span>
  )
}

const PresetChoice = (props: { group: ThemeKey; option: PresetOption; current: string }) => (
  <label class="preset">
    <input
      type="radio"
      name={props.group}
      value={props.option.key}
      checked={props.current === props.option.key}
    />
    <span class="preset__box">
      <PresetPreview group={props.group} option={props.option.key} />
      <span class="preset__label">{props.option.label}</span>
      <span class="preset__note">{props.option.note}</span>
    </span>
  </label>
)

const AppearancePage = (props: {
  account: string
  theme: Theme
  flash?: string | null
  error?: string
}) => (
  <AdminLayout title="見た目" active="appearance" account={props.account} flash={props.flash}>
    <div class="admin-head">
      <div class="admin-head__title">
        <span class="crumbs">サイト全体</span>
        <h1>見た目</h1>
      </div>
      <a class="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
        サイトを見る ↗
      </a>
    </div>

    {props.error ? <p class="banner banner--error">{props.error}</p> : null}

    {/* 選んだ色と書体は、この中の「選択中」の印にもそのまま効く */}
    <form
      method="post"
      action="/admin/appearance"
      class="form"
      data-accent={props.theme.accent}
      data-typeface={props.theme.typeface}
    >
      {THEME_GROUPS.map((group) => (
        <fieldset class="presets" key={group.key}>
          <legend class="presets__legend">
            {group.label}
            <span class="presets__note">{group.note}</span>
          </legend>
          <div class="presets__grid">
            {THEME_CHOICES[group.key].map((option) => (
              <PresetChoice
                key={option.key}
                group={group.key}
                option={option}
                current={props.theme[group.key]}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <FormActions cancelHref="/admin/appearance" />
    </form>
  </AdminLayout>
)

appearanceRoutes.get('/appearance', async (c) => {
  const theme = await loadTheme(db(c))
  return c.html(
    <AppearancePage
      account={c.get('account')}
      theme={theme}
      flash={c.req.query('saved') ? '保存しました' : null}
    />,
  )
})

appearanceRoutes.post('/appearance', async (c) => {
  const form = await c.req.formData()
  const picked: Partial<Record<ThemeKey, string>> = {}
  for (const key of THEME_KEYS) picked[key] = str(form.get(key))

  /*
    知らない値は受け取らない。CSS に無いものを保存すると、管理画面では
    選ばれているのにサイトは既定のまま、という食い違いが残る。
  */
  if (THEME_KEYS.some((key) => !isThemeValue(key, picked[key] ?? ''))) {
    return c.html(
      <AppearancePage
        account={c.get('account')}
        theme={await loadTheme(db(c))}
        error="選べない見た目です。もう一度選び直してください"
      />,
      400,
    )
  }

  await saveTheme(db(c), normalizeTheme(picked))
  return c.redirect('/admin/appearance?saved=1', 303)
})
