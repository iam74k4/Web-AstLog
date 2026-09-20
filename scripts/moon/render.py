"""
Noctifex の入口に敷く三日月を、粒子の雲としてレンダリングする。

形はロゴの三日月そのもの（src/ui/icons.tsx の多角形）を立体にしたもの。

最初は「球を左から照らして三日月を作る」を試したが、あれでは絶対に似ない。
ロゴは天文学的な三日月ではなく、尖りが右へ長く伸び、内側が鋭い V 字に
切れ込んだ記号だからで、球の照らされ方からはその形は出てこない
（球から球を引く月牙も駄目。正面から見ると内側の縁が必ず直線になる——
  切断面が視線と平行な平面の円で、投影すると線分に潰れる）。

だから多角形を厚みのある板にして、その体積に粒子を散らす。奥行きがあるので
被写界深度で手前と奥がボケ、平面の図形では出ない立体感になる。

  blender -b -P scripts/moon/render.py -- <out.png> <samples> <count> <res>
"""

import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = argv[0] if len(argv) > 0 else "/tmp/moon.png"
SAMPLES = int(argv[1]) if len(argv) > 1 else 96
COUNT = int(argv[2]) if len(argv) > 2 else 559000  # particle_size と対で決まる。下の説明を見ること
RES = int(argv[3]) if len(argv) > 3 else 1600
ENGINE = argv[4] if len(argv) > 4 else "eevee"  # eevee | cycles

ACCENT = (0.561, 0.561, 0.961)  # --accent (iris #8f8ff5) をリニアに寄せた値

# ロゴの多角形（24×24 の枠、y は下向き）。src/ui/icons.tsx が正
MARK = [
    (14.96, 2.50),
    (7.71, 6.10),
    (5.68, 13.93),
    (10.27, 20.60),
    (18.32, 21.50),
    (12.09, 16.78),
    (10.73, 9.07),
]
DEPTH = 0.40  # 板の厚み。厚いほど粒が奥行き方向に散り、被写界深度が効く

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- 形
#
# 同じ三日月を、内側へ少しずつ縮めた3枚の殻として作る。
#
# 1枚だけに粒を撒くと密度が端まで一定で、輪郭が定規で引いた線になる。
# 3枚に分けて内側ほど多く撒くと、重なりのぶん密度が中心へ向かって上がり、
# 縁では粒が散って消える——参考にしている絵の、形が縁で溶ける感じはこれ。


def inset(points, d):
    """多角形を d だけ内側へ寄せる。各頂点を角の二等分線に沿って動かす。
    凹んだ頂点では自然に外へ動くので、この形（内側が V 字）でも破綻しない。"""
    n = len(points)
    out = []
    for i in range(n):
        px, py = points[(i - 1) % n]
        cx, cy = points[i]
        nx, ny = points[(i + 1) % n]

        def unit(ax, ay, bx, by):
            vx, vy = bx - ax, by - ay
            length = math.hypot(vx, vy) or 1.0
            return vx / length, vy / length

        # 前後の辺の法線。
        #
        # 右手側（+ey, -ex）が内側。MARK は符号付き面積 -84.8 の「時計回り」で、
        # しかも y が下向きの枠で書いてある。左手側（-ey, +ex）を内側と決めて
        # いたときは、この関数が多角形を内側ではなく外側へ広げていた——
        # 面積が 84.8 → 145.0 → 232.3 と増え、いちばん大きい殻に粒の53%を
        # 配っていたので、密度が中心ではなく外へ向かって上がり、出来上がった
        # 絵はロゴの2.74倍に膨らんだ別の形だった。
        e1x, e1y = unit(px, py, cx, cy)
        e2x, e2y = unit(cx, cy, nx, ny)
        n1x, n1y = e1y, -e1x
        n2x, n2y = e2y, -e2x
        bx_, by_ = n1x + n2x, n1y + n2y
        blen = math.hypot(bx_, by_) or 1.0
        bx_, by_ = bx_ / blen, by_ / blen
        # 角が鋭いほど深く入れる必要がある
        cosang = max(0.25, (bx_ * n1x + by_ * n1y))
        out.append((cx + bx_ * d / cosang, cy + by_ * d / cosang))
    return out


SHELLS = [
    # (内側へ寄せる量, 粒の割り当て)
    #
    # 面積は 84.8 / 56.5 / 36.9（元の 100% / 67% / 43%）。
    #
    # 外に多く配る。殻が重なっているので、それでも密度は中心へ向かって上がる
    # ——外の縁には0枚目の粒しか来ないが、中心には3枚ぶんが重なるため、
    # 単位面積あたりで約 3.2 倍になる。内側に多く配ると質量が中心に寄りすぎ、
    # 輪郭が痩せてロゴの太い面が細い弧になる（実際そうなった）。
    (0.00, 0.45),
    (0.55, 0.32),
    (1.00, 0.23),
]


def make_shell(points, name):
    verts = [((x - 12.0) / 12.0, 0.0, -(y - 12.0) / 12.0) for x, y in points]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [list(range(len(verts)))])
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob

    sol = ob.modifiers.new("thick", type="SOLIDIFY")
    sol.thickness = DEPTH
    sol.offset = 0.0
    bpy.ops.object.modifier_apply(modifier="thick")

    # ボクセルで組み直す。これが無いと、多角形を三角に割った継ぎ目に沿って
    # 粒の密度が偏り、絵の中に明るい直線が何本か走る
    rem = ob.modifiers.new("even", type="REMESH")
    rem.mode = "VOXEL"
    rem.voxel_size = 0.022
    bpy.ops.object.modifier_apply(modifier="even")
    return ob


shells = [(make_shell(inset(MARK, d), f"shell{i}"), share) for i, (d, share) in enumerate(SHELLS)]

# ---------------------------------------------------------------- 粒
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, -50))
dot = bpy.context.active_object
dot.name = "dot"

mat = bpy.data.materials.new("glow")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()

geo = nt.nodes.new("ShaderNodeNewGeometry")
info = nt.nodes.new("ShaderNodeObjectInfo")

# (1) 左ほど明るい。ロゴの膨らみが左にあるので、そちらを光らせると立体に見える
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
lit = nt.nodes.new("ShaderNodeMapRange")
lit.inputs["From Min"].default_value = 0.62
lit.inputs["From Max"].default_value = -0.62
lit.inputs["To Min"].default_value = 0.05
lit.inputs["To Max"].default_value = 0.62
lit.clamp = True

# (2) ノイズで濃淡をうねらせる。
#     一様に光らせると、粒は多くても「塗り」に見える。参考にしている絵の
#     内部構造は、密度がゆっくり波打っていることで出ている
noise = nt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 3.6
noise.inputs["Detail"].default_value = 6.0
noise.inputs["Roughness"].default_value = 0.55
swirl = nt.nodes.new("ShaderNodeMapRange")
swirl.inputs["From Min"].default_value = 0.36
swirl.inputs["From Max"].default_value = 0.64
swirl.inputs["To Min"].default_value = 0.10
swirl.inputs["To Max"].default_value = 1.75
swirl.clamp = True

# (3) 粒ごとのばらつき。全部が同じ明るさだと、光っている粒ではなく網点に見える
spark = nt.nodes.new("ShaderNodeMapRange")
spark.inputs["From Min"].default_value = 0.0
spark.inputs["From Max"].default_value = 1.0
"""
粒1つごとの明るさの幅。0.35〜2.3（6.6:1）だった。

配る絵では粒が**サブピクセル**（直径 0.82px、いちばん大きいもので 1.43px）
なので、1画素は「そこに見えている2〜3枚の粒の面の平均」でしかない。
枚数が少ないと、粒ごとのばらつきが平均されずにそのまま画素の乱れとして残る
——実測で高周波の σ が 17.1/255、本体の中央値の 13.9%。粒ではなく紙やすりに
見えるのはこれ。0.75〜1.65（2.2:1）まで詰めると σ が 28% 落ちる。
平均は 1.325 → 1.20 とほぼ変わらないので、露出も pack.py の坂もずれない。
"""
spark.inputs["To Min"].default_value = 0.75
spark.inputs["To Max"].default_value = 1.65
spark.clamp = True

m1 = nt.nodes.new("ShaderNodeMath")
m1.operation = "MULTIPLY"
m2 = nt.nodes.new("ShaderNodeMath")
m2.operation = "MULTIPLY"

"""
粒1つの明るさの倍率。

7.0 だった。粒は体積の中に散らしてあるので、視線方向に何十個も重なる。
1粒が明るいと、重なった所は 1.0 を軽く突き抜ける——そして下の view_transform
が "Standard"、つまり 1.0 で**切り落とす**設定だったので、三日月の内側は
全部まとめて白に張り付いていた。実測で本体の 64.2% が 250/255 以上、
中央値は 255。内部に情報が1つも残っていない状態だった。

それを CSS 側が opacity 0.42 で敷くので、画面には**一様な灰色の板**が出る。
粒が見えるのは飽和を免れた外周の細い帯だけで、そこも粒が疎すぎて
ディザに見え、隙間が黒い点として残っていた。

1.2 にすると、重なっても AgX の肩の中に収まる。実測でクリップ 0.0%、
素材の最大値 178/255。最大値が下がったぶんは CSS の --moon-ink を上げて
取り返せる（飽和していないので、上げても板にならない）。
"""
BOOST = 1.2 if ENGINE == "cycles" else 1.0
gain = nt.nodes.new("ShaderNodeMath")
gain.operation = "MULTIPLY"
gain.inputs[1].default_value = BOOST

emit = nt.nodes.new("ShaderNodeEmission")
emit.inputs["Color"].default_value = (*ACCENT, 1.0)
out = nt.nodes.new("ShaderNodeOutputMaterial")

nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
nt.links.new(sep.outputs["X"], lit.inputs["Value"])
nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
nt.links.new(noise.outputs["Fac"], swirl.inputs["Value"])
nt.links.new(info.outputs["Random"], spark.inputs["Value"])
nt.links.new(lit.outputs["Result"], m1.inputs[0])
nt.links.new(swirl.outputs["Result"], m1.inputs[1])
nt.links.new(m1.outputs["Value"], m2.inputs[0])
nt.links.new(spark.outputs["Result"], m2.inputs[1])
nt.links.new(m2.outputs["Value"], gain.inputs[0])
nt.links.new(gain.outputs["Value"], emit.inputs["Strength"])
nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
dot.data.materials.append(mat)

# ---------------------------------------------------------------- 散らす
for idx, (shell, share) in enumerate(shells):
    bpy.context.view_layer.objects.active = shell
    shell.modifiers.new("scatter", type="PARTICLE_SYSTEM")
    ps = shell.particle_systems[0]
    s = ps.settings
    s.type = "EMITTER"
    s.count = max(1, int(COUNT * share))
    s.emit_from = "VOLUME"
    s.distribution = "RAND"
    s.use_emit_random = True
    s.physics_type = "NO"
    s.frame_start = 1.0
    s.frame_end = 1.0
    s.lifetime = 500
    s.render_type = "OBJECT"
    s.instance_object = dot
    """
    粒の大きさ。0.0024 だった。

    小さくするのは、1画素に見えている面の枚数を増やして、粒ごとのばらつきを
    画素の中で平均させるため（上の spark の説明と同じ話）。0.0014 にすると
    枚数が 2.5 → 7 になり、σ が 32% 落ちる。spark を詰めるのと合わせると 47%。

    **COUNT と一緒に動かすこと。** 見た目の被覆は COUNT x particle_size^2 で
    決まる。大きさだけ変えると、明るさも外接枠も動いて pack.py の坂と
    ロゴとの IoU がずれる。(0.0024/0.0014)^2 = 2.94 なので、COUNT は 2.94倍。

    なお **COUNT だけ増やしても、ざらつきは減らない**（実測で 4倍にして -5%）。
    粒は不透明な発光面なので、増やしたぶんは後ろに隠れるだけで、1画素に
    見えている枚数が増えない。そのうえ淡い周縁が pack.py の坂を越えて
    本体が +44% に膨らみ、ロゴとの IoU が落ちる。数で殴らないこと。
    """
    s.particle_size = 0.0014
    s.size_random = 0.85  # 大小の差が大きいほど、粒が「光の点」に見える
    s.use_rotation_instance = False
    s.use_scale_instance = True
    ps.seed = 7 + idx * 13
    # 母体そのものは映さない。映すのは粒だけ
    shell.show_instancer_for_render = False

scene.frame_set(2)

# ---------------------------------------------------------------- カメラ
bpy.ops.object.camera_add(location=(0.02, -5.25, 0.06), rotation=(math.pi / 2, 0, 0))
cam = bpy.context.active_object
scene.camera = cam
cam.data.lens = 50
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = 5.12
cam.data.dof.aperture_fstop = 1.7  # 浅いほど手前と奥が溶ける

# ---------------------------------------------------------------- 霧（Cycles のみ）
#
# 粒そのものが光源なので、まわりに薄い霧を置くと、その光が霧の中で散る。
# 粒と粒のあいだが物理的に繋がり、貼り付けた点の集まりではなく「発光する雲」
# になる——EEVEE には無い表現で、代わりに描画は桁で遅くなる。
if ENGINE == "cycles":
    # 箱は小さく。大きいと霧が画面いっぱいに広がる。霧は pack.py の
    # 明るさの坂（LO/HI）で切り落とされるので絵には残らないが、広いほど
    # 粒のまわりの淡い所まで霧に埋もれ、三日月の外接枠が取れなくなる
    # （実測で、閾値 0.10 では縦横比が 0.650 ではなく 0.846 になった）
    bpy.ops.mesh.primitive_cube_add(size=2.9, location=(0, 0, 0))
    fog = bpy.context.active_object
    fog.name = "fog"
    fmat = bpy.data.materials.new("fog")
    fmat.use_nodes = True
    fnt = fmat.node_tree
    fnt.nodes.clear()
    vol = fnt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.20
    vol.inputs["Anisotropy"].default_value = 0.35  # 前方散乱ぎみ。光の筋が伸びる
    vol.inputs["Color"].default_value = (*ACCENT, 1.0)
    vol.inputs["Emission Strength"].default_value = 0.0
    fout = fnt.nodes.new("ShaderNodeOutputMaterial")
    fnt.links.new(vol.outputs["Volume"], fout.inputs["Volume"])
    fog.data.materials.append(fmat)
    # visible_camera は落とさないこと。
    #
    # 箱の面を消すつもりで False にしたら、カメラ光線が霧に入らなくなり、
    # 散乱が一切描かれなかった（濃さを 0.05 から 0.45 まで振っても絵が同じ）。
    # このマテリアルは Volume 出力しか持たないので、面はもともと映らない。
    fog.visible_shadow = False

# ---------------------------------------------------------------- レンダー設定
engines = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
if ENGINE == "cycles":
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.volume_bounces = 2
    scene.cycles.volume_step_rate = 1.0
else:
    for want in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        if want in engines:
            scene.render.engine = want
            break
    if hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = SAMPLES
print("engine:", scene.render.engine)

scene.render.resolution_x = RES
scene.render.resolution_y = RES
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = OUT
"""
"Standard" にしてはいけない。1.0 で**ハードクリップ**する設定で、粒が
重なった所を全部 1.0 に潰してしまう（上の BOOST の説明のとおり）。

AgX はハイライトを切らずに圧縮する。粒が何十個重なっても順位が保たれるので、
内側ほど明るい・外へ向かって散る、という濃淡がそのまま絵に残る。
配る絵は pack.py が無彩色に倒すので、AgX が色を寝かせることは問題にならない。
"""
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "None"

# 滲み（グロー）はここでは作らない。ここだけでなく、どこでも作らない。
#
# 配るのは**無彩色の三日月だけ**で、光暈は public/app.css の --moon-glow が
# --accent から描く。絵に焼くと色がそこで固定され、アクセント色5つのうち3つと
# 喧嘩する。scripts/moon/pack.py の先頭にその理由が書いてある。
#
# （なお Blender 5 の合成はシーン直下の node_tree ではなくノードグループになり、
# Glare の設定も RNA プロパティからソケット入力へ移っている。つないでみたが、
# グループ入力にレンダー結果が渡らず、出てくる絵は真っ黒になった。
# いまは焼かないと決めたので、この道は追わなくてよい。）

bpy.ops.render.render(write_still=True)
print("wrote:", OUT)
