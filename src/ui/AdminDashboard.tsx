import { timeInJapan } from '../lib/format'
import { type MediaUsage, megabytes } from '../lib/media-usage'
import { AdminLayout } from './AdminLayout'
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
}

// 人は「人」、作品は「件」で数える
const CountSummary = ({ counts, unit }: { counts: DashboardCounts; unit: '人' | '件' }) => (
  <span class="dashboard-counts">
    {counts.total === 0 ? (
      <span class="dashboard-state">未登録</span>
    ) : (
      <>
        <span>
          公開 {counts.published} {unit}
        </span>
        <span>
          下書き {counts.drafts} {unit}
        </span>
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
    iconUrl: string | null
    published: number
    updatedAt: string
  }[]
  // やることが無いときは null（案内の面を出さない）
  next: DashboardAction | null
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
  storage: MediaUsage & { quota: number }
}) => (
  <AdminLayout title="概要" active="dashboard" account={props.account}>
    <div class="admin-head">
      <div class="admin-head__title">
        <span class="crumbs">サイト全体</span>
        <h1>概要</h1>
      </div>
    </div>

    {/*
      公開の状況と、いちばん使う2つの手。前は「あなたのサイト／つくったものを、届けよう。」の
      呼びかけの面を頭に置いていた——持ち主1人の管理画面に、呼びかける相手は居ない。数を先に出す
    */}
    <section class="dashboard-preview" aria-labelledby="dashboard-preview-title">
      <h2 id="dashboard-preview-title">公開の状況</h2>
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
      <div class="dashboard-preview__actions">
        <a class="btn btn--primary" href="/admin/items/new?type=app">
          ＋ 作品を追加
        </a>
        <a class="btn btn--ghost" href="/admin/preview" target="_blank" rel="noreferrer">
          全体をプレビュー ↗
        </a>
      </div>
    </section>

    {props.next ? (
      <section class="dashboard-next" aria-labelledby="dashboard-next-title">
        <div>
          <span class="dashboard-next__label">次にできること</span>
          <h2 id="dashboard-next-title">{props.next.title}</h2>
          <p>{props.next.note}</p>
        </div>
        <a class="btn btn--ghost" href={props.next.href}>
          {props.next.label}
        </a>
      </section>
    ) : null}

    {props.recent?.length ? (
      <section class="dashboard-settings" aria-labelledby="dashboard-recent-title">
        <div class="dashboard-settings__head">
          <h2 id="dashboard-recent-title">最近編集した作品</h2>
          <a href="/admin/items">作品一覧 →</a>
        </div>
        <div class="dashboard-recent__grid">
          {props.recent.map((item) => (
            <a class="dashboard-recent__item" href={`/admin/items/${item.id}/edit`} key={item.id}>
              {/* 見本は作品の一覧（/admin/items）と同じ決め方: アイコンを先に、無ければメインの画像 */}
              {item.iconUrl ? (
                <img
                  class="row__thumb row__thumb--icon"
                  src={item.iconUrl}
                  alt=""
                  width={112}
                  height={70}
                  loading="lazy"
                />
              ) : item.imageUrl ? (
                <img
                  class="row__thumb"
                  src={item.imageUrl}
                  alt=""
                  width={112}
                  height={70}
                  loading="lazy"
                />
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
        <p>下書きは公開サイトに出ません。</p>
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
          <CountSummary counts={props.members} unit="人" />
          {props.members.published > 0 && !props.profilesShown ? (
            <span class="dashboard-card__status">プロフィール・チームは目次から外れています</span>
          ) : null}
          <span class="dashboard-card__action">プロフィールを開く →</span>
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
                <CountSummary counts={props.apps} unit="件" />
              </dd>
            </div>
            <div>
              <dt>業務</dt>
              <dd>
                <CountSummary counts={props.works} unit="件" />
              </dd>
            </div>
          </dl>
          {props.apps.published + props.works.published > 0 && !props.projectsShown ? (
            <span class="dashboard-card__status">
              Projects は目次から外れています（作品のページは公開中）
            </span>
          ) : null}
          <span class="dashboard-card__action">作品を開く →</span>
        </a>

        <a class="dashboard-card" href="/admin/blocks">
          <div class="dashboard-card__head">
            <h3>ページ構成</h3>
            {/* 札は目を留めてほしい状態のときだけ。ふだんの「設定あり」は何も言っていなかった */}
            {props.blockCount === 0 ? (
              <span class="dashboard-state">既定の並び</span>
            ) : props.blockDrafts === props.blockCount ? (
              <span class="dashboard-state">すべて下書き</span>
            ) : props.pages === 0 ? (
              <span class="dashboard-state">目次に表示なし</span>
            ) : null}
          </div>
          <span class="dashboard-card__status">目次に表示: {props.pages} ページ</span>
          {props.blockDrafts > 0 ? (
            <span class="dashboard-card__status">
              下書き {props.blockDrafts} 件（公開サイトに出ません）
            </span>
          ) : null}
          <span class="dashboard-card__action">ページ構成を開く →</span>
        </a>
      </div>
    </section>

    {/*
      画像と動画の容量。上限に達すると新しい画像と動画を保存できない（src/lib/media-usage.ts）。
      外した画像の控えは数えないので、別に言う（90日で消える）
    */}
    <section class="dashboard-settings" aria-labelledby="dashboard-storage-title">
      <div class="dashboard-settings__head">
        <h2 id="dashboard-storage-title">画像と動画の容量</h2>
        <p>上限に達すると、新しい画像と動画を保存できません。</p>
      </div>
      <p class="dashboard-storage__usage">
        <strong>{megabytes(props.storage.used)}</strong> / {megabytes(props.storage.quota)}（
        {Math.min(100, Math.round((props.storage.used / props.storage.quota) * 100))}%）
        {props.storage.used >= props.storage.quota * 0.9 ? (
          <span class="dashboard-state">残りわずか</span>
        ) : null}
      </p>
      {/*
        外した画像の控え。数える容量とは別（90日で消える）。取り出す口は「外した画像」の画面
        （src/routes/admin/media.tsx）——控えがあるときだけ入口を出す
      */}
      {props.storage.archived ? (
        <p class="dashboard-storage__note">
          ほかに、外した画像の控えが {megabytes(props.storage.archived)}{' '}
          あります。容量には数えず、90日で消えます。 <a href="/admin/media">外した画像を見る →</a>
        </p>
      ) : null}
    </section>
  </AdminLayout>
)
