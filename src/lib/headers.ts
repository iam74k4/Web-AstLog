/*
  どの応答にも付けるヘッダの値。Worker の応答は src/index.tsx のミドルウェア1本が、
  Worker を通らない静的なファイルは public/_headers が付ける（test/headers.test.ts が
  2つを突き合わせる）
*/

/*
  https を1年覚えさせる（Strict-Transport-Security）。.dev は主なブラウザが最初から https を
  強制する（HSTS preload の一覧に入った TLD）ので、これは一覧を持たない読み手へのもの。
  サブドメイン（www）も https だけ。http の開発（localhost）には付けない（付けても読み手が捨てる）
*/
export const HSTS = 'max-age=31536000; includeSubDomains'

/*
  ほかのサイトが window.open で開いたこのサイトの窓に、開いた側から手を出させない
  （Cross-Origin-Opener-Policy）。手が届くと、窓の中の枠の数（window.length）で管理画面に
  ログインしているかが分かり（ログイン後の画面にはプレビューの iframe がある）、開いた窓を
  あとで偽のページへ移すこともできる。同じオリジンの窓どうし（プレビューを別タブで開く）と
  iframe は今までどおりつながり、OAuth は窓をまたがない画面ごとの遷移なので止まらない
*/
export const OPENER_POLICY = 'same-origin'

/*
  使わない端末の機能を、ページにも埋め込みにも許さない（Permissions-Policy）。注入口が1つ
  見つかっても、カメラ・マイク・位置などには届かない。全画面（動画の操作の手）は使うので
  止めない。ブラウザが知らない機能名を並べると警告が出るので、知られた名前だけ
*/
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
].join(', ')
