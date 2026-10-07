import { timeInJapan } from '../lib/format'
import { AdminLayout } from './AdminLayout'
import { ADMIN_ART } from './admin-art'
import { StatusPill } from './components'

export type DashboardCounts = {
  published: number
  drafts: number
  total: number
  firstDraft: number | null
}

export type DashboardAction = {
  title: string
  note: string
  href: string
  label: string
  newTab?: boolean
}

const CountSummary = ({ counts }: { counts: DashboardCounts }) => (
  <span class="dashboard-counts">
    {counts.total === 0 ? (
      <span class="dashboard-state">未登録</span>
    ) : (
      <>
        <span>公開 {counts.published} 件</span>
        <span>下書き {counts.drafts} 件</span>
      </>
    )}
  </span>
)

export const AdminDashboard = (props: {
  account: string
  recent?: {
    id: number
    title: string
    imageUrl: string | null
    published: number
    updatedAt: string
  }[]
  next: DashboardAction
  members: DashboardCounts
  apps: DashboardCounts
  works: DashboardCounts
  profilesShown: boolean
  projectsShown: boolean
  siteSaved: boolean
  siteStarted: boolean
  hasContact: boolean
  blockCount: number
  blockDrafts: number
  pages: number
  appearance: string
}) => (
  <AdminLayout title="概要" active="dashboard" account={props.account}>
    <div class="admin-head">
      <div class="admin-head__title">
        <span class="crumbs">サイト全体</span>
        <h1>概要</h1>
      </div>
    </div>

    <section
      class="dashboard-preview dashboard-observatory"
      aria-labelledby="dashboard-preview-title"
    >
      <div class="dashboard-observatory__copy">
        <span class="crumbs">あなたのサイト</span>
        <h2 id="dashboard-preview-title">つくったものを、届けよう。</h2>
        <p>公開状況を確認して、続きの編集へ。</p>
        <div class="dashboard-preview__actions">
          <a class="btn btn--primary" href="/admin/items/new?type=app">
            ＋ 作品を追加
          </a>
          <a class="btn btn--ghost" href="/admin/preview" target="_blank" rel="noreferrer">
            全体をプレビュー ↗
          </a>
        </div>
      </div>
      <img
        src={ADMIN_ART['black-hole'].src}
        alt=""
        width={160}
        height={160}
        class="dashboard-observatory__art"
      />
      <dl class="dashboard-metrics">
        <div>
          <dt>公開中の作品</dt>
          <dd>
            {props.apps.published + props.works.published}
            <small>件</small>
          </dd>
        </div>
        <div>
          <dt>下書きの作品</dt>
          <dd>
            {props.apps.drafts + props.works.drafts}
            <small>件</small>
          </dd>
        </div>
        <div>
          <dt>公開ページ</dt>
          <dd>
            {props.pages}
            <small>ページ</small>
          </dd>
        </div>
      </dl>
    </section>

    <section class="dashboard-next" aria-labelledby="dashboard-next-title">
      <div>
        <span class="dashboard-next__label">次にできること</span>
        <h2 id="dashboard-next-title">{props.next.title}</h2>
        <p>{props.next.note}</p>
      </div>
      <a
        class="btn btn--ghost"
        href={props.next.href}
        target={props.next.newTab ? '_blank' : undefined}
        rel={props.next.newTab ? 'noreferrer' : undefined}
      >
        {props.next.label}
      </a>
    </section>

    {props.recent?.length ? (
      <section class="dashboard-recent" aria-labelledby="dashboard-recent-title">
        <div class="dashboard-settings__head">
          <h2 id="dashboard-recent-title">最近編集した作品</h2>
          <a href="/admin/items">作品一覧 →</a>
        </div>
        <div class="dashboard-recent__grid">
          {props.recent.map((item) => (
            <a class="dashboard-recent__item" href={`/admin/items/${item.id}/edit`} key={item.id}>
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" width={112} height={70} loading="lazy" />
              ) : null}
              <span>
                <strong>{item.title}</strong>
                <small>{timeInJapan(item.updatedAt)}</small>
              </span>
              <StatusPill published={item.published} />
            </a>
          ))}
        </div>
      </section>
    ) : null}

    <section class="dashboard-settings" aria-labelledby="dashboard-settings-title">
      <div class="dashboard-settings__head">
        <h2 id="dashboard-settings-title">設定する場所</h2>
        <p>必要な内容から整えられます。下書きは公開サイトに出ません。</p>
      </div>
      <div class="dashboard-grid">
        <a class="dashboard-card" href="/admin/site">
          <div class="dashboard-card__head">
            <h3>サイトの紹介と連絡先</h3>
            <span class="dashboard-state">
              {props.siteSaved ? '保存済み' : props.siteStarted ? '一部保存済み' : '既定の文章'}
            </span>
          </div>
          <span class="dashboard-card__status">
            公開する連絡先: {props.hasContact ? '設定あり' : '未設定（掲載しません）'}
          </span>
          <span class="dashboard-card__action">サイト設定を開く →</span>
        </a>

        <a class="dashboard-card" href="/admin/members">
          <div class="dashboard-card__head">
            <h3>プロフィール・チーム</h3>
          </div>
          <CountSummary counts={props.members} />
          {props.members.published > 0 && !props.profilesShown ? (
            <span class="dashboard-card__status">プロフィール・チームは目次から外れています</span>
          ) : null}
          <span class="dashboard-card__action">Members を開く →</span>
        </a>

        <a
          class="dashboard-card"
          href={
            props.apps.total === 0 && props.works.total > 0
              ? '/admin/items?type=work'
              : '/admin/items'
          }
        >
          <div class="dashboard-card__head">
            <h3>作品・業務の実績</h3>
          </div>
          <dl class="dashboard-projects">
            <div>
              <dt>個人開発</dt>
              <dd>
                <CountSummary counts={props.apps} />
              </dd>
            </div>
            <div>
              <dt>業務</dt>
              <dd>
                <CountSummary counts={props.works} />
              </dd>
            </div>
          </dl>
          {props.apps.published + props.works.published > 0 && !props.projectsShown ? (
            <span class="dashboard-card__status">
              Projects は目次から外れています（作品のページは公開中）
            </span>
          ) : null}
          <span class="dashboard-card__action">Projects を開く →</span>
        </a>

        <a class="dashboard-card" href="/admin/blocks">
          <div class="dashboard-card__head">
            <h3>ページの構成</h3>
            <span class="dashboard-state">
              {props.blockCount === 0
                ? '既定の並び'
                : props.blockDrafts === props.blockCount
                  ? 'すべて下書き'
                  : props.pages === 0
                    ? '目次に表示なし'
                    : '設定あり'}
            </span>
          </div>
          <span class="dashboard-card__status">目次に表示: {props.pages} ページ</span>
          {props.blockCount > 0 ? (
            <span class="dashboard-card__status">
              公開 {props.blockCount - props.blockDrafts} 件 · 下書き {props.blockDrafts} 件
            </span>
          ) : null}
          <span class="dashboard-card__action">構成を開く →</span>
        </a>

        <a class="dashboard-card" href="/admin/appearance">
          <div class="dashboard-card__head">
            <h3>色と書体</h3>
          </div>
          <span class="dashboard-card__status">{props.appearance}</span>
          <span class="dashboard-card__action">見た目を開く →</span>
        </a>
      </div>
    </section>
  </AdminLayout>
)
