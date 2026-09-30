#!/usr/bin/env python3
"""
GitHub の Organization の顔（ブラックホールの絵）を焼く。

    python3 scripts/blackhole/render.py avatar             # public/assets/astlog-avatar.png
    python3 scripts/blackhole/render.py avatar --preview   # 小さく試し焼き（PNG を BH_OUT へ）

numpy と Pillow が要る。10 コアで約2分。

サイトの中のブラックホール（上の帯のロゴの O、入口と締めの軌道図の真ん中、favicon・
iPhone のホーム画面）はここでは焼かない。どれもロゴの O と同じ絵で、形は src/ui/logo.ts が
正（ページは直に SVG を描き、素材のファイルは scripts/logo/export.mjs が書く）。ここで
焼くのは、ページの外で使う顔の1枚だけ——持ち主が選んだ、光の曲がりを計算した姿。

## 何を計算しているか

シュワルツシルトのブラックホール（質量 M = 1、事象の地平面 r = 2）のまわりを、
カメラから逆向きに光を1本ずつ追う。光の道はニュートン形の式
x'' = -1.5 h² x / r⁵（h は |x × v|。光の道の形がシュワルツシルト時空の測地線と
一致する）を RK4 で解く。遠くから見るので、光は画面の格子から平行に出す（1画素の
幅が M の単位で決まる）。

光が円盤の面（y = 0）を横切るたびに、そこでの円盤の明るさを足し、円盤の
不透明度ぶん奥を暗くする。円盤の奥の側は光が上へ曲がって影の上に弧として見え、
下を回った光が影の下に細い弧を作る。地平面に落ちた光は黒（影）。

カメラは円盤の面から elevation 度だけ上（PRESETS。顔は 7°）で、絵の幅に入る範囲は
field_w（M の単位）。

## 絵の作り

明るさは円盤の半径の冪で落とし、内縁と外縁をやわらかく切る。色は白だけ（warmth 0。
ロゴの白にそろえる）。筋（細い同心の輪と、ゆるい渦と塊）は決まった乱数の種から
作るので、焼き直すと同じ絵になる。最後に光のにじみ（ぼかしを重ねたもの）を足して、
ACES の曲線で 0〜1 に収める。
"""

import argparse
import math
import os
import tempfile
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'public' / 'assets'


# 円盤の明るさの色（半径 / 内縁 → 線形の RGB）。内縁の白から、外へ琥珀と赤茶へ
WARM = (
    (1.0, (1.00, 0.97, 0.93)),
    (1.5, (1.00, 0.88, 0.70)),
    (2.4, (1.00, 0.70, 0.40)),
    (4.0, (0.92, 0.50, 0.22)),
    (7.0, (0.70, 0.30, 0.12)),
)

BASE = {
    # 1画素を何本の光で見るか（縦横それぞれ）
    'supersample': 3,
    # カメラの距離（M）。光はここの平面から平行に出る
    'distance': 60.0,
    # 円盤の内縁と外縁（M）。内縁のやわらかさと外縁のやわらかさ
    'r_in': 2.2,
    'r_out': 11.0,
    'inner_soft': 0.15,
    'outer_soft': 6.0,
    # 明るさの半径の冪と、全体の明るさ・不透明度
    'power': 2.6,
    'gain': 1.5,
    'halo': 0.05,
    'halo_power': 1.0,
    'opacity': 0.9,
    # 筋（細い輪）と塊（ゆるい渦）の強さ。ごく弱く——強いと円盤に同心の縞が出て、光が
    # ざらついて見えた（持ち主の「かたちはそのままでもう少し綺麗に」）
    'streaks': 0.05,
    'clumps': 0.06,
    'seed': 11,
    # 色の暖かさ（0 で白だけ、1 で WARM のとおり）。白だけにする——持ち主が「白よりに」、
    # さらに外縁の淡い琥珀色も「白っぽくない」と外し、ロゴの白にそろえた（1.0 の金色は
    # 映画に近いが、白黒の画面から浮く）
    'warmth': 0.0,
    # 光のにじみ（σ は絵の幅 1280px あたりの px、w は重み）と露出。いちばん広いにじみは
    # 弱く——強いと地に灰色の靄がかかり、光の縁がぼやける
    'bloom': ((1.5, 0.12), (6.0, 0.08), (30.0, 0.03)),
    'exposure': 1.25,
    # 光を追う歩幅（r に比例）と上限・下限、歩数の上限
    'step': 0.035,
    'step_min': 0.008,
    'step_max': 1.5,
    'max_steps': 5000,
    # 円盤の面を2度横切ったと数える、あいだの道のりの下限（M）
    'gap': 0.6,
}

PRESETS = {
    # GitHub の Organization の顔（持ち主が選んだ姿）。低い 7° から見て、手前の
    # 円盤が影の前を細く明るい帯で横切り、影の下半分は黒いまま残る姿を、正方形に（見えて
    # いる黒い影が幅の約 4 分の 1）。黒い地に重ねて焼く（透明にしない——光が白いので、
    # GitHub のライトテーマでは光が白い画面に溶ける）
    'avatar': {
        'width': 1024,
        'height': 1024,
        'field_w': 24.0,
        'elevation': 7.0,
        'name': 'astlog-avatar',
    },
}


def camera(elevation, distance):
    e = math.radians(elevation)
    pos = np.array([0.0, distance * math.sin(e), distance * math.cos(e)])
    fwd = -pos / np.linalg.norm(pos)
    right = np.cross(fwd, np.array([0.0, 1.0, 0.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return pos, fwd, right, up


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def waves(p):
    rng = np.random.default_rng(int(p['seed']))
    fine = 28
    coarse = 9
    return {
        # 細い輪: 半径の向きに細かく、1周で 0〜2 回だけねじれる（整数なので切れ目が出ない）
        'f1': rng.uniform(3.0, 14.0, fine),
        'm1': rng.integers(-2, 3, fine),
        'p1': rng.uniform(0, 2 * math.pi, fine),
        'a1': rng.uniform(0.4, 1.0, fine),
        # 塊: 半径の向きにゆるく、1周で 1〜4 回
        'f2': rng.uniform(0.15, 0.9, coarse),
        'm2': rng.integers(1, 5, coarse),
        'p2': rng.uniform(0, 2 * math.pi, coarse),
        'a2': rng.uniform(0.5, 1.0, coarse),
    }


def texture(r, phi, p, w):
    def band(f, m, ph, a):
        s = np.sin(2 * math.pi * f[None, :] * r[:, None] + m[None, :] * phi[:, None] + ph[None, :])
        return (a[None, :] * s).sum(axis=1) / a.sum()

    fine = band(w['f1'], w['m1'], w['p1'], w['a1'])
    coarse = band(w['f2'], w['m2'], w['p2'], w['a2'])
    return np.clip((1 + p['streaks'] * 1.8 * fine) * (1 + p['clumps'] * 1.8 * coarse), 0.1, 3.0)


def tint(r, p):
    x = np.log(r / p['r_in'])
    stops = np.log(np.array([s for s, _ in WARM]))
    colors = np.array([c for _, c in WARM])
    rgb = np.stack([np.interp(x, stops, colors[:, k]) for k in range(3)], axis=1)
    return 1.0 + p['warmth'] * (rgb - 1.0)


def emission(r, phi, p, w):
    tex = texture(r, phi, p, w)
    inner = smoothstep(p['r_in'], p['r_in'] + p['inner_soft'], r)
    outer = 1.0 - smoothstep(p['r_out'] - p['outer_soft'], p['r_out'], r)
    shape = inner * outer
    # 明るい内側（急に落ちる）と、遠くまで薄く伸びる外側の2つを足す
    fall = p['r_in'] / r
    light = p['gain'] * (fall ** p['power'] + p['halo'] * fall ** p['halo_power']) * shape * tex
    # 外側ほど薄く透ける（奥の弧が透けて見える）
    alpha = np.clip(
        p['opacity'] * shape * np.minimum(1.0, 2.2 * fall) * np.clip(0.55 + 0.45 * tex, 0, 1),
        0,
        0.97,
    )
    return light[:, None] * tint(r, p), alpha


def trace(args):
    a, b, p = args
    w = waves(p)
    pos, fwd, right, up = camera(p['elevation'], p['distance'])
    n = a.size
    x = pos[None, :] + a[:, None] * right[None, :] + b[:, None] * up[None, :]
    v = np.repeat(fwd[None, :], n, axis=0)
    h2 = np.sum(np.cross(x, v) ** 2, axis=1)
    light = np.zeros((n, 3))
    trans = np.ones(n)
    # 前に円盤の面を横切ってから進んだ道のり。面をかすめる光が、数値の揺れで同じ所を
    # 何度も横切ったことにならないように、gap より短い間の2度目は数えない
    since = np.full(n, np.inf)
    idx = np.arange(n)
    far = max(p['r_out'] * 2.0, 30.0)

    for _ in range(int(p['max_steps'])):
        if idx.size == 0:
            break
        xs = x[idx]
        vs = v[idx]
        hs = h2[idx][:, None]
        r = np.linalg.norm(xs, axis=1)
        dt = np.clip(p['step'] * r, p['step_min'], p['step_max'])[:, None]

        def acc(q):
            rq = np.linalg.norm(q, axis=1)[:, None]
            return -1.5 * hs * q / rq**5

        k1x, k1v = vs, acc(xs)
        k2x, k2v = vs + 0.5 * dt * k1v, acc(xs + 0.5 * dt * k1x)
        k3x, k3v = vs + 0.5 * dt * k2v, acc(xs + 0.5 * dt * k2x)
        k4x, k4v = vs + dt * k3v, acc(xs + dt * k3x)
        nx = xs + dt / 6 * (k1x + 2 * k2x + 2 * k3x + k4x)
        nv = vs + dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v)

        since[idx] += dt[:, 0] * np.linalg.norm(vs, axis=1)
        y0 = xs[:, 1]
        y1 = nx[:, 1]
        hit = (y0 * y1 < 0) & (since[idx] > p['gap'])
        if hit.any():
            t = (y0[hit] / (y0[hit] - y1[hit]))[:, None]
            q = xs[hit] + t * (nx[hit] - xs[hit])
            rc = np.hypot(q[:, 0], q[:, 2])
            inside = (rc > p['r_in']) & (rc < p['r_out'])
            if inside.any():
                ids = idx[hit][inside]
                e, al = emission(rc[inside], np.arctan2(q[inside, 2], q[inside, 0]), p, w)
                light[ids] += trans[ids][:, None] * e
                trans[ids] *= 1 - al
            since[idx[hit]] = 0.0

        x[idx] = nx
        v[idx] = nv
        rn = np.linalg.norm(nx, axis=1)
        captured = rn < 2.0005
        escaped = (rn > far) & (np.sum(nx * nv, axis=1) > 0)
        done = captured | escaped | (trans[idx] < 1e-3)
        idx = idx[~done]
    return light


def blur(image, sigma):
    pad = int(3 * sigma) + 1
    padded = np.pad(image, pad)
    h, w = padded.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    kernel = np.exp(-2 * (math.pi * sigma) ** 2 * (fx**2 + fy**2))
    out = np.fft.irfft2(np.fft.rfft2(padded) * kernel, s=padded.shape)
    return out[pad:-pad, pad:-pad]


def render(p, workers):
    ss = int(p['supersample'])
    W, H = p['width'] * ss, p['height'] * ss
    field_h = p['field_w'] * p['height'] / p['width']
    xs = (np.arange(W) + 0.5) / W * p['field_w'] - p['field_w'] / 2
    ys = field_h / 2 - (np.arange(H) + 0.5) / H * field_h
    a, b = np.meshgrid(xs, ys)
    a = a.ravel()
    b = b.ravel()
    chunks = np.array_split(np.arange(a.size), workers * 8)
    with Pool(workers) as pool:
        parts = pool.map(trace, [(a[c], b[c], p) for c in chunks])
    light = np.concatenate(parts).reshape(H, W, 3)
    # 縦横 ss 画素ずつ平均して配信の大きさへ
    light = light.reshape(p['height'], ss, p['width'], ss, 3).mean(axis=(1, 3))
    scale = p['width'] / 1280
    glow = np.zeros_like(light)
    for sigma, weight in p['bloom']:
        for k in range(3):
            glow[..., k] += weight * blur(light[..., k], sigma * scale)
    # ACES の近似（Narkowicz）。明るい所を白へなめらかに寝かせ、暗い所は暗いまま
    x = p['exposure'] * (light + glow)
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0)


def save(rgb, name, p, preview):
    to8 = lambda v: np.clip(np.round(v * 255), 0, 255).astype(np.uint8)  # noqa: E731
    bg = np.array([12, 12, 14]) / 255
    # 地に重ねずに、色と不透明度に分ける（黒い地に重ねたときに同じ見た目になる形）
    alpha = rgb.max(axis=2)
    color = np.where(alpha[..., None] > 1e-6, rgb / np.maximum(alpha[..., None], 1e-6), 0.0)
    rgba = np.dstack([to8(color), to8(alpha)])
    # 見て確かめる用: 地（app.css の --bg）に重ねた絵
    shown = bg[None, None, :] * (1 - alpha[..., None]) + color * alpha[..., None]
    # 確かめる用の絵はリポジトリの外へ（BH_OUT で置き場所を変えられる）
    preview_dir = Path(os.environ.get('BH_OUT', Path(tempfile.gettempdir()) / 'astlog-blackhole'))
    preview_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(to8(shown), 'RGB').save(preview_dir / f'{name}-preview.png')
    Image.fromarray(rgba, 'RGBA').save(preview_dir / f'{name}-preview-rgba.png')
    if preview:
        return
    # 地（--bg）に重ねた姿をそのまま。透明を持たない
    Image.fromarray(to8(shown), 'RGB').save(ASSETS / f'{name}.png', optimize=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('preset', choices=sorted(PRESETS))
    parser.add_argument('--preview', action='store_true')
    parser.add_argument('--name')
    parser.add_argument('--set', action='append', default=[], help='key=value で値を差し替える')
    args = parser.parse_args()
    p = {**BASE, **PRESETS[args.preset]}
    for pair in args.set:
        key, value = pair.split('=', 1)
        # 打ち間違えた鍵を黙って足さない（効かないまま焼き上がる）。数の値だけを差し替える
        if not isinstance(p.get(key), (int, float)):
            raise SystemExit(f'--set {key}: 数で差し替えられる鍵ではない（{", ".join(sorted(k for k, v in p.items() if isinstance(v, (int, float))))}）')
        p[key] = float(value)
    for key in ('width', 'height', 'supersample'):
        p[key] = int(p[key])
    if args.preview:
        p['width'] //= 2
        p['height'] //= 2
        p['supersample'] = 1
    rgb = render(p, os.cpu_count() or 4)
    save(rgb, args.name or p['name'], p, args.preview)


if __name__ == '__main__':
    main()
