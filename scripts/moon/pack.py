"""
Blender が焼いた月（PNG・透過）から、三日月**だけ**を取り出して配信用に詰める。

  python3 scripts/moon/pack.py <in.png> <outdir> [height]

光暈（グロー）はここでは焼かない。CSS 側の radial-gradient が --accent から
描く（public/app.css の --moon-glow）。分けてある理由は3つ。

  1. 焼き込むと、色が固定される。このサイトはアクセント色を5つ持ち、見た目
     プリセットで切り替わる。焼いた紫の光暈は ember（橙）や rose（桃）の
     ときに寒色のまま残り、リンクの色と画面の中で喧嘩していた。
  2. 焼き込むと、三日月と光の位置を別々に決められない。入口の画面では
     リード文（--ink-mid・15px ＝ 通常文字なので 4.5:1 が要る）が月の明るい縁に
     載って、実測で最小 1.00:1 ——完全に消えていた。光だけを広く・淡く、
     三日月だけを文字の外へ、と動かせるのは分けたときだけ。
  3. 焼き込むと、画布のほとんどが光になる。以前の 760x760 は、三日月の実体が
     211x324（面積で 4.3%）しか無く、残りは光暈と余白だった。

無彩色にするのもここ。月の粒子は元から ほぼ無彩色（実測 234,235,251）だが、
完全に灰へ倒しておく。「色は光暈だけが持つ」と決めておけば、アクセントを
足した日にこの絵を焼き直さなくてよい。
"""

import os
import sys

import numpy as np
from PIL import Image

"""
三日月と霧を分ける明るさの坂。

Cycles の体積散乱は画面ぜんぶに薄い靄を残すので、単純な「透明でない所」では
切り分けられない。明るさで見ると境目がはっきり出る——閾値を上げていくと
外接枠の縦横比が

    0.03 → 0.817   まだ霧を掴んでいる
    0.05 → 0.684
    0.06 → 0.653   三日月そのもの（ロゴの多角形は 0.665）
    0.34 → 0.646   ここから先は変わらない

と、0.06 のあたりで落ち着いて動かなくなる。**霧はここで終わる**——実測で
霧の側の最大が 0.060、三日月の側の最小が 0.060 と、ぴたりと分かれる。

坂の上端は三日月の**いちばん明るい所**に合わせる（実測 0.681）。ここを
低く取ると本体の内側でアルファが 1.0 に飽和し、濃淡が消えて平らな板になる
——アルファが絵の情報を全部運ぶ持ち方（上の out の説明）にした以上、
飽和は「板に戻す」ことと同義になった。

**この数はトーンマッピングに紐づいている。** render.py が view_transform を
"Standard" から "AgX" に変えたとき、同じ絵でも明るさの目盛りが丸ごと下へ
ずれた（以前の坂は 0.14〜0.30 だった）。render.py の露出を触ったら、
必ずこの表を取り直すこと——ずれたままだと、霧を三日月として拾うか、
三日月の外側を削り落とすかのどちらかになる。
"""
LO, HI = 0.06, 0.68

"""
画質と丈。

丈 480 は、いちばん大きく出る組（768x1024 の magazine でパネル 716x763、
--moon-h 45% ＝ 343 CSS px）の 1.4倍。以前の絵は三日月の実体が 324px しか
無く、同じ所で 1.23倍だった——光暈に画布の 96% を使っていたぶん、肝心の
三日月がいちばん粗かった。

AVIF は q45。粒子の絵は高周波なので画質を上げるとすぐ太る一方、圧縮の粗は
元の粒に紛れる。素材そのものとの差を測ると、q45 で平均 0.94/255・
最大 30/255。しかも CSS 側は --moon-ink: 0.42 で敷くので、目に入る差は
さらにその 0.42 倍になる。
"""
AVIF_Q, WEBP_Q = 45, 72

src = sys.argv[1]
outdir = sys.argv[2]
height = int(sys.argv[3]) if len(sys.argv) > 3 else 480

im = Image.open(src).convert("RGBA")
a = np.asarray(im).astype(np.float64) / 255.0
rgb, alpha = a[..., :3], a[..., 3]

# 目が見る明るさ。粒子は白く、霧は暗い
lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
lit = lum * alpha

t = np.clip((lit - LO) / (HI - LO), 0.0, 1.0)
t = t * t * (3 - 2 * t)  # なめらかに立ち上げる（線形だと縁に輪ができる）

"""
中間を持ち上げる。

画面での明るさの上限を決めているのは、見出しの後ろに来る**いちばん明るい
画素**ひとつ（WCAG 1.4.3 の 3:1）。だから --moon-ink はピークに縛られていて、
本体の大半はその上限よりずっと暗い所に居る。濃淡をアルファへ移した直後は
本体の中央値が 0.62 まで落ち、画面では 85/255 から 73.5/255 まで暗くなった
——「月が消えた」と言われた状態がこれ。

γ<1 は 0 と 1 を動かさずに中間だけ持ち上げるので、**ピークを1も動かさずに
月を明るくできる**。上限を作っているのはピークなので、コントラストの余裕は
減らない。濃淡そのものは残る（平らにはならない）。
"""
GAMMA = 0.6
t = t**GAMMA

"""
配るのは「どこがどれだけ光っているか」の1面だけ。

色は CSS が塗る（public/app.css の .moon picture が --accent から作った色を
敷き、この絵を mask として抜く）。だから絵の RGB に情報を持たせる意味が無い。
白で埋めて、**明暗はぜんぶアルファに入れる**。

前は RGB に lum、アルファに坂を入れていた。それだと本体の内側でアルファが
1.0 に飽和し、濃淡は RGB 側にしか無い——mask として使うと、その濃淡が
まるごと落ちて平らな板に戻る。色を CSS に持たせるなら、この持ち替えが要る。

lit（= lum x alpha）に坂を掛けたものがそのままアルファになるので、
合成の結果は「アクセント色 x そこの光の量」。まっすぐで、破れが無い。
"""
white = np.ones(lum.shape + (3,))
out = (np.clip(np.dstack([white, t]), 0, 1) * 255).astype(np.uint8)

img = Image.fromarray(out)
# 透明な余白を落とす。CSS は height と縦横比で置くので、正方に整える必要は無い
box = Image.fromarray((t > 0.004).astype(np.uint8) * 255).getbbox()
if box is None:
    raise SystemExit(f"{src} に三日月が見つからない（坂 {LO}〜{HI} が高すぎる？）")
img = img.crop(box)

width = max(1, round(img.width * height / img.height))
img = img.resize((width, height), Image.LANCZOS)

os.makedirs(outdir, exist_ok=True)
img.save(os.path.join(outdir, "moon.avif"), "AVIF", quality=AVIF_Q)
img.save(os.path.join(outdir, "moon.webp"), "WEBP", quality=WEBP_Q, method=6)

for name in ("moon.avif", "moon.webp"):
    path = os.path.join(outdir, name)
    print(f"{name}: {os.path.getsize(path) // 1024} KB")

# public/app.css の --moon-ratio と src/ui/components.tsx の width/height は
# この2つの数に合わせること（test/theme.test.ts が食い違いを見張っている）
print(f"size: {width}x{height}  (--moon-ratio: {width} / {height})")
