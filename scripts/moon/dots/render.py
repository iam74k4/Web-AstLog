"""
============================================================================
 採っていない案。**入口に出ている月はこれではない**（それは ../render.py）。
============================================================================

参照（ElevenLabs のトップの造形）にある「折れた面に並ぶ規則的な点」を
Blender で出せるか調べたときの、いちばん見込みのあった作り。設計の経緯と
測定値は docs/moon-dots.md。

残してあるのは、**測って分かったことが多いから**。粒を体積にランダムに
散らす（いまの ../render.py）のと違い、こちらは

  - 面を奥行き方向にだけ折るので、カメラから見た輪郭が多角形のまま保てる
  - 点を「面上の弧長」で刻むと、面が寝た所で投影間隔が詰まって等高線になる
    （画面座標で等間隔に置くと、いくら折っても絵に1画素も現れない）

という2つを実測で確かめている。同じ壁に二度ぶつからないために置いておく。

## 採らなかった理由

実際に出る寸法で読めない。入口の月は 1440x900 の rail で 196x287 CSS px
しかなく、DPR1 ではこの格子が疎すぎて三日月の塊が消え、「網」に見える。
DPR2（392x574）では参照に近い見え方になる。**大きく出すことが前提の表現**で、
そこを変えるなら話は「月をどれだけ大きく出すか」に戻り、それは文字との
重なり（CLAUDE.md の「月の上に乗る文字には、色ごとの上限がある」）を
動かすことになる。

## この写しについて

作業場所（/tmp）が消えたあと、エージェントの記録から拾い直したもの。
**拾えたのは中間稿で、設計書が最終的に採った1枚構成そのものではない。**
ここにある PRESETS のうち

  d  1層。設計書の最終構成にいちばん近い（amp/k1/k2/rot が一致）
  g  2層＋「傾きで明暗」。この docstring の測定値はこれ
  a  既定。2層

最終構成は d に g の傾き補正を足したもの、と読める。docs/moon-dots.md に
その定数が全部載っている。

## 動かし方（引数の順番が ../render.py と違う）

  blender -b -P scripts/moon/dots/render.py -- <out.png> <res> <samples> [preset] [fstop]
  例: ... -- /tmp/m.png 1400 48 d

## 配信側

そのままでは ../pack.py に通らない。docs/moon-dots.md の「pack.py」の節に
変える4か所（坂・grey の作り方・丈・リサイズ）が書いてある。
"""

"""
三日月を「奥へ折った薄い面」として作る（4稿・これが最終）。

  blender -b -P fold4.py -- <out.png> <res> <samples> <preset> <fstop>
  例: blender -b -P fold4.py -- /tmp/g.png 1400 64 g 2.0

## 作り

  1. 面は**厚みゼロ**。うねらせるのは Y（＝カメラの視線方向）だけで、
     X/Z には1ミリも動かさない。だからカメラから見た輪郭は多角形のまま。
     さらに縁から TAPER=0.045BU で折りを 0 に落とすので、境界の点は
     必ず y=0 の面に乗る（透視投影で輪郭が揺れるのを止めるため）。
  2. 点は**面上の弧長**で刻む。ここが要点。画面の (x,z) で等間隔に置くと、
     いくら折っても投影は等間隔のままで何も起きない。弧長で刻むと、
     面が寝ている所では投影された間隔が詰まって明るい等高線になり、
     カメラに正対している所は疎で地が透ける。
  3. 詰まりには下限 DU_MIN=0.38 を置く。置かないと傾きの急な所で
     点の間隔が1画素を割り、破線ではなく白い筋に溶けた（実際そうなった）。
  4. 層を複数枚、別の折り方・別の格子の向きで重ねる。干渉縞が出る。
  5. 1点＝カメラ向きの四角。色属性 "Col" に明るさを b/4 で入れ、
     マテリアルで 4 倍して発光強度にする。頂点インスタンスだと1層まるごと
     同じ明るさになり、縁で消える・傾きで光る が付けられなかった。

## 測った結果（preset g / 1400px / EEVEE / 24〜64 サンプル）

  IoU 0.9295（膨張半径 5〜10px で 0.9257〜0.9300、安定）
  対照：折りを抜いた flat は 0.9298 ——**折りは輪郭を1ミリも壊していない**。
  1.0 に届かない 0.07 は、点の絵を膨張・収縮で閉じて多角形と比べる
  測り方そのものと、縁の減光のぶん。
  外接枠の縦横比 0.667（ロゴは 0.665）。
  クリップ(>=250/255) 0.00%、最大 0.869。
  392x574 に縮めて、列方向の自己相関が 9px で 0.787、18px で 0.603。
  196x287（DPR1）でも 4px/9px/14px に 1.00/0.895/0.700 の峰が残る。

## 分かった限界

  被写界深度は**この寸法では効かない**。振幅 0.40BU・距離 5.25BU・50mm では
  f/1.2 でも許容錯乱円が約1画素で、f/8 との差は変調の深さ 0.951 対 0.940。
  参照の「手前の葉はやわらかく、芯は鋭い」は、輪郭を守る限り再現できない。
"""

import json
import math
import os
import random
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[0] if len(argv) > 0 else "/tmp/fold2.png"
RES = int(argv[1]) if len(argv) > 1 else 1400
SAMPLES = int(argv[2]) if len(argv) > 2 else 24
PRESET = argv[3] if len(argv) > 3 else "a"
FSTOP = float(argv[4]) if len(argv) > 4 else 2.0

ACCENT = (0.561, 0.561, 0.961)

MARK = [
    (14.96, 2.50),
    (7.71, 6.10),
    (5.68, 13.93),
    (10.27, 20.60),
    (18.32, 21.50),
    (12.09, 16.78),
    (10.73, 9.07),
]

L = 12.0
PX_PER_BU = 362.0  # 配信 392x574 での実画素 / Blender 単位


def to_bu(p):
    return ((p[0] - 12.0) / L, -(p[1] - 12.0) / L)


POLY = [to_bu(p) for p in MARK]


def inside(x, z):
    hit = False
    n = len(POLY)
    for i in range(n):
        x1, z1 = POLY[i]
        x2, z2 = POLY[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            if x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
                hit = not hit
    return hit


def edge_dist(x, z):
    best = 1e9
    n = len(POLY)
    for i in range(n):
        x1, z1 = POLY[i]
        x2, z2 = POLY[(i + 1) % n]
        dx, dz = x2 - x1, z2 - z1
        ll = dx * dx + dz * dz
        t = 0.0 if ll == 0 else max(0.0, min(1.0, ((x - x1) * dx + (z - z1) * dz) / ll))
        best = min(best, math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)))
    return best


def smoothstep(e0, e1, v):
    t = max(0.0, min(1.0, (v - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------- 設計
#
# px は「配信される実画素での点の間隔」。ここがこの試みの要。
# 参照（ElevenLabs）は 520x470 を占めるので細かい格子が成立するが、
# こちらは 392x574 しか無い。同じ密度を真似ると点が1画素を割って砂に戻る。
TAPER = 0.045  # 縁からこの幅（BU）で折りを 0 に落とす。輪郭を守るため
FADE = 0.075  # 縁からこの幅で明るさを 0 に落とす。外周が消えていくように

"""
弧長で刻むと、面が寝ている所では du がいくらでも小さくなる。
そのまま許すと、投影された点の間隔が1画素を割って**線に溶ける**——
実際、傾きの急な所（preset b/c/d の上辺と右下）が破線ではなく
白い筋になっていた。等高線として明るくなるのは狙いどおりだが、
点の列が読めなくなったらこの試み全体の意味が無い。

だから詰まりに下限を置く。0.38 は「設計間隔の 38%」＝ 配信画素で
8.0px * 0.38 = 3.0px。1点 2.3px なので、隙間が 0.7px 残る。
"""
DU_MIN = 0.38

PRESETS = {
    "a": [
        dict(px=8.5, amp=0.26, k1=8.5, k2=3.4, rot=0.30, ph=0.0, gain=1.00, dot=2.2, seed=1),
        dict(px=9.5, amp=0.20, k1=6.0, k2=4.6, rot=1.42, ph=1.9, gain=0.62, dot=2.0, seed=2),
    ],
    "b": [
        dict(px=8.0, amp=0.30, k1=9.5, k2=3.0, rot=0.22, ph=0.0, gain=1.00, dot=2.3, seed=1),
        dict(px=9.0, amp=0.23, k1=7.0, k2=5.0, rot=1.25, ph=2.1, gain=0.66, dot=2.1, seed=2),
        dict(px=11.0, amp=0.15, k1=4.5, k2=6.5, rot=2.50, ph=0.7, gain=0.42, dot=1.9, seed=3),
    ],
    # 折りを大きく・少なく。畳まれた帯として読ませる
    "c": [
        dict(px=8.0, amp=0.42, k1=5.2, k2=2.2, rot=0.26, ph=0.4, gain=1.00, dot=2.3, seed=1),
        dict(px=9.5, amp=0.30, k1=3.8, k2=4.0, rot=1.35, ph=2.3, gain=0.60, dot=2.0, seed=2),
    ],
    # 1層だけ。折りと弧長の効きを単独で見る
    "d": [
        dict(px=7.5, amp=0.38, k1=6.0, k2=2.6, rot=0.28, ph=0.0, gain=1.05, dot=2.4, seed=1),
    ],
    # 本命。大きな折り1枚＋奥にもう1枚。詰まりに下限があるので線に溶けない
    "e": [
        dict(px=8.0, amp=0.40, k1=5.6, k2=2.4, rot=0.26, ph=0.3, gain=1.05, dot=2.4, seed=1),
        dict(px=10.5, amp=0.26, k1=3.6, k2=4.2, rot=1.38, ph=2.3, gain=0.48, dot=2.0, seed=2, back=0.16),
    ],
    # 本命の仕上げ。e に「傾きで明暗」と「左が濃い」を足した
    "g": [
        dict(px=8.0, amp=0.40, k1=5.6, k2=2.4, rot=0.26, ph=0.3, gain=1.05, dot=2.4, seed=1,
             tilt_ref=1.5, tilt_lo=0.45, tilt_hi=1.95, lx_lo=1.15, lx_hi=0.70),
        dict(px=10.5, amp=0.26, k1=3.6, k2=4.2, rot=1.38, ph=2.3, gain=0.50, dot=2.0, seed=2, back=0.16,
             tilt_ref=1.2, tilt_lo=0.40, tilt_hi=1.70, lx_lo=1.15, lx_hi=0.70),
    ],
    # 対照。g から折りだけを抜いた（amp=0）。IoU の目減りが折りのせいか、
    # 縁の減光と膨張処理のせいかを切り分けるため
    "flat": [
        dict(px=8.0, amp=0.0005, k1=5.6, k2=2.4, rot=0.26, ph=0.3, gain=1.05, dot=2.4, seed=1,
             tilt_ref=1.5, tilt_lo=0.45, tilt_hi=1.95, lx_lo=1.15, lx_hi=0.70),
        dict(px=10.5, amp=0.0005, k1=3.6, k2=4.2, rot=1.38, ph=2.3, gain=0.50, dot=2.0, seed=2, back=0.16,
             tilt_ref=1.2, tilt_lo=0.40, tilt_hi=1.70, lx_lo=1.15, lx_hi=0.70),
    ],
    # e より粗い。点がもっと大きく、間隔も開く
    "f": [
        dict(px=9.5, amp=0.44, k1=5.0, k2=2.2, rot=0.26, ph=0.3, gain=1.05, dot=2.7, seed=1),
        dict(px=12.0, amp=0.28, k1=3.4, k2=4.0, rot=1.38, ph=2.3, gain=0.46, dot=2.2, seed=2, back=0.18),
    ],
}
LAYERS = PRESETS[PRESET]


def make_height(cfg):
    amp, k1, k2, ph = cfg["amp"], cfg["k1"], cfg["k2"], cfg["ph"]
    c, s = math.cos(cfg["rot"]), math.sin(cfg["rot"])

    def h(u, v):
        x = u * c - v * s
        z = u * s + v * c
        raw = amp * (math.sin(k1 * u + ph) + 0.35 * math.sin(k2 * v + ph * 0.7))
        return raw * smoothstep(0.0, TAPER, edge_dist(x, z)), x, z

    return h


def lattice(cfg):
    """面上を弧長で刻んだ格子。戻すのは (x, y, z, 明るさ, 半径)。"""
    h = make_height(cfg)
    step = cfg["px"] / PX_PER_BU
    rnd = random.Random(cfg["seed"])
    half = (cfg["dot"] / 2.0) / PX_PER_BU

    us, vs = [], []
    c, s = math.cos(cfg["rot"]), math.sin(cfg["rot"])
    for x, z in POLY:
        us.append(x * c + z * s)
        vs.append(-x * s + z * c)
    u0, u1 = min(us) - step, max(us) + step
    v0, v1 = min(vs) - step, max(vs) + step

    pts = []
    v, row = v0, 0
    while v <= v1:
        u = u0 + (step * 0.5 if row % 2 else 0.0)
        guard = 0
        while u <= u1 and guard < 20000:
            guard += 1
            y, x, z = h(u, v)
            du = step * 1e-2
            y2, _, _ = h(u + du, v)
            slope = (y2 - y) / du
            if inside(x, z):
                d = edge_dist(x, z)
                # 手前ほど明るい。折りの山と谷で明暗が分かれ、起伏が読める
                depth = 1.55 - 1.17 * smoothstep(-cfg["amp"], cfg["amp"], y)
                # 面の傾き。寝ている所（|slope| 大）は点が詰まる上に明るく、
                # カメラに正対している所（|slope| 小）は疎で暗い。
                # 参照の「明るい等高線 / 地が透ける所」はこの2つの積で出る。
                # 密度だけでは足りなかった——詰まりに下限を置いたぶん、
                # 明暗で差をつけ直す必要がある。
                t = min(1.0, abs(slope) / cfg.get("tilt_ref", 1.6))
                tilt = cfg.get("tilt_lo", 0.62) + (cfg.get("tilt_hi", 1.85) - cfg.get("tilt_lo", 0.62)) * t
                fade = smoothstep(0.0, FADE, d)
                jit = 0.78 + 0.44 * rnd.random()
                # 三日月の質量は左（膨らんだ側）にある。左を濃く、右の尖りへ向けて
                # 落とすと、記号ではなく照らされた立体に見える
                lit_x = cfg.get("lx_lo", 1.0) + (cfg.get("lx_hi", 1.0) - cfg.get("lx_lo", 1.0)) * smoothstep(
                    -0.55, 0.55, x
                )
                b = cfg["gain"] * depth * tilt * fade * jit * lit_x
                if b > 0.012:
                    pts.append((x, y + cfg.get('back', 0.0), z, b, half * (0.75 + 0.45 * fade)))
            u += max(step * DU_MIN, step / math.sqrt(1.0 + slope * slope))
        v += step
        row += 1
    return pts


# ---------------------------------------------------------------- 組み立て
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

mat = bpy.data.materials.new("dots")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
attr = nt.nodes.new("ShaderNodeAttribute")
attr.attribute_name = "Col"
mul = nt.nodes.new("ShaderNodeMath")
mul.operation = "MULTIPLY"
mul.inputs[1].default_value = 4.0  # 色属性に b/4 で入れてある（1.0 超えを避けるため）
emit = nt.nodes.new("ShaderNodeEmission")
emit.inputs["Color"].default_value = (*ACCENT, 1.0)
out = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(attr.outputs["Fac"], mul.inputs[0])
nt.links.new(mul.outputs["Value"], emit.inputs["Strength"])
nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

stats = {"preset": PRESET, "layers": []}
for i, cfg in enumerate(LAYERS):
    pts = lattice(cfg)
    stats["layers"].append({"i": i, "count": len(pts), "px": cfg["px"], "amp": cfg["amp"]})

    verts, faces, cols = [], [], []
    for x, y, z, b, s in pts:
        j = len(verts)
        verts += [(x - s, y, z - s), (x + s, y, z - s), (x + s, y, z + s), (x - s, y, z + s)]
        faces.append((j, j + 1, j + 2, j + 3))
        cols += [(b / 4.0, b / 4.0, b / 4.0, 1.0)] * 4

    mesh = bpy.data.meshes.new(f"L{i}")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ca = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    flat = []
    for c4 in cols:
        flat += list(c4)
    ca.data.foreach_set("color", flat)
    ob = bpy.data.objects.new(f"L{i}", mesh)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)

# ---------------------------------------------------------------- カメラ
bpy.ops.object.camera_add(location=(0.0, -5.25, 0.0), rotation=(math.pi / 2, 0, 0))
cam = bpy.context.active_object
scene.camera = cam
cam.data.lens = 50
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = 5.25
# 浅くしすぎると点が滲んで格子が消える。振幅 0.3BU・f/2.0 で錯乱円は約1px
cam.data.dof.aperture_fstop = FSTOP

# ---------------------------------------------------------------- 出力
engines = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
for want in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    if want in engines:
        scene.render.engine = want
        break
if hasattr(scene.eevee, "taa_render_samples"):
    scene.eevee.taa_render_samples = SAMPLES

scene.render.resolution_x = RES
scene.render.resolution_y = RES
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = OUT
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "None"

print("ENGINE", scene.render.engine)
print("STATS", json.dumps(stats))
bpy.ops.render.render(write_still=True)
print("WROTE", OUT, os.path.exists(OUT))