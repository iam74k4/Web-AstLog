"""
Blender が焼いた月（PNG・透過）から、三日月**だけ**を取り出して配信用に詰める。

  python3 scripts/moon/pack.py <in.png> <outdir> [height] [lo] [hi] [gamma]

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

**色は1ビットも運ばない。** RGB は白で埋め、明暗はぜんぶアルファに入れる
（下の out の説明）。CSS 側は --accent から作った色を敷いてこの絵で抜くので、
アクセントを足した日にこの絵を焼き直さなくてよい。
"""

import os
import sys

import numpy as np
from PIL import Image

"""
明るさの坂。lit（= 明るさ × アルファ）をアルファに写す。

**本番（点の絵・render.py）は飽和させるのが正しい。** 点の絵には霧が無く、
情報は「どの点が在るか」と「点がどう詰まるか」に入っている。点そのものを
半透明にすると、配信サイズまで縮めたときに列ごと洗い流されて薄い網になる
（実測で、等倍での被覆が 20.6% から 15.6% まで落ちた）。だから LO=0.0 /
HI=0.10 で、点の本体は不透明、縁のアンチエイリアスだけが階調になる。

**粒子版（particles.py）は真逆で、飽和させてはいけない。** あちらは1枚の
連続した面なので、飽和させると濃淡が消えて一様な灰色の板になる。あちらを
焼くときは引数で LO=0.06 / HI=0.68 / GAMMA=0.6 を渡すこと
（詳しくは particles.py の冒頭）。

坂を smoothstep にしているのは、線形だと縁に輪ができるため。
"""
LO, HI = 0.0, 0.10

"""
画質と丈。

丈 480 は、いちばん大きく出る組（768x1024 の magazine でパネル 716x763、
--moon-h 45% ＝ 343 CSS px）の 1.4倍。以前の絵は三日月の実体が 324px しか
無く、同じ所で 1.23倍だった——光暈に画布の 96% を使っていたぶん、肝心の
三日月がいちばん粗かった。

AVIF は q45。粒子の絵は高周波なので画質を上げるとすぐ太る一方、圧縮の粗は
元の粒に紛れる。素材そのものとの差を測ると、q45 で平均 0.94/255・
最大 30/255。しかも CSS 側は --moon-ink（いま 0.52）で敷くので、目に入る差は
さらにその半分ほどになる。
"""
AVIF_Q, WEBP_Q = 45, 72

src = sys.argv[1]
outdir = sys.argv[2]
height = int(sys.argv[3]) if len(sys.argv) > 3 else 574
# 坂と γ は焼いた絵によって真逆になるので、引数で渡せるようにしてある
if len(sys.argv) > 5:
    LO, HI = float(sys.argv[4]), float(sys.argv[5])
if len(sys.argv) > 6:
    GAMMA = float(sys.argv[6])

im = Image.open(src).convert("RGBA")
a = np.asarray(im).astype(np.float64) / 255.0
rgb, alpha = a[..., :3], a[..., 3]

# 目が見る明るさ。粒子は白く、霧は暗い
lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
lit = lum * alpha

t = np.clip((lit - LO) / (HI - LO), 0.0, 1.0)
t = t * t * (3 - 2 * t)  # なめらかに立ち上げる（線形だと縁に輪ができる）

"""
中間を持ち上げる γ。**本番では 1.0（何もしない）。**

点の絵は上の坂で本体が飽和しているので、持ち上げる中間が無い。
これが効くのは粒子版のように階調が連続している絵で、そちらでは
「画面での明るさの上限を決めているのは、見出しの後ろに来るいちばん明るい
画素ひとつ」なので、γ<1 で 0 と 1 を動かさずに中間だけ持ち上げれば、
**ピークを1も動かさずに月を明るくできる**（コントラストの余裕が減らない）。
実際それで、画面での中央値が 73.5 から 83.9 まで戻った。
"""
GAMMA = 1.0
t = t**GAMMA if GAMMA != 1.0 else t

"""
配るのは「どこがどれだけ光っているか」の1面だけ。

色は CSS が塗る（public/app.css の .moon__mark::after が --accent から作った色を
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
# BOX（面積平均）。LANCZOS は点の周りにリンギングの暈を作り、
# 縮めたとき点の間が濁る
img = img.resize((width, height), Image.BOX)

os.makedirs(outdir, exist_ok=True)
img.save(os.path.join(outdir, "moon.avif"), "AVIF", quality=AVIF_Q)
img.save(os.path.join(outdir, "moon.webp"), "WEBP", quality=WEBP_Q, method=6)

for name in ("moon.avif", "moon.webp"):
    path = os.path.join(outdir, name)
    print(f"{name}: {os.path.getsize(path) // 1024} KB")

# public/app.css の --moon-ratio と src/ui/components.tsx の width/height は
# この2つの数に合わせること（test/theme.test.ts が食い違いを見張っている）
print(f"size: {width}x{height}  (--moon-ratio: {width} / {height})")
