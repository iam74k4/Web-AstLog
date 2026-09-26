import type { User } from './db/schema'

export type Env = {
  DB: D1Database
  /*
    アバターと作品の画像（avatars/ と items/）。R2 が未有効なので当面ここ。
    ほかに1行だけ、公開ページの写しの内容の版（site:version。src/lib/page-cache.ts）。
    /images/* は IMAGE_KEY で2つの置き場しか開かないので、この行は外から読めない
  */
  MEDIA: KVNamespace
  /*
    最初に owner へ紐づけてよいアカウント（wrangler.toml の [vars]。公開してよい値）。
    GitHub は数値のユーザー id、Google は確かめ済みのメールアドレス。
    使うのは最初の1回だけで、紐づいたあとは user_identities の ID で照合する
  */
  OWNER_GITHUB_ID?: string
  OWNER_GOOGLE_EMAIL?: string
  /*
    OAuth のクライアント。secret なので `wrangler secret put` と .dev.vars で渡す。
    片方の提供元だけ設定してもよい（ログイン画面には、そろっているものだけが出る）
  */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /*
    wrangler dev だけで使う（.dev.vars に http://localhost:8787）。提供元へ渡す
    コールバックの origin。wrangler dev は Worker に見せる URL を routes の
    noctifex.dev に書き換えるので、リクエストからは組めない（src/lib/oauth.ts の callbackUrl）
  */
  OAUTH_REDIRECT_ORIGIN?: string
  /*
    いま動いている Worker の版（wrangler.toml の [version_metadata]）。公開ページの
    写しの鍵に入れて、デプロイした日に前のコードの写しを出さない
    （src/lib/page-cache.ts）。無ければ 'local' として扱う
  */
  CF_VERSION_METADATA?: WorkerVersionMetadata
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: User
    // 管理画面の足元に出す「いま誰として入っているか」（最後にログインしたアカウントの label）
    account: string
  }
}
