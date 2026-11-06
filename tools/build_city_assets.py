#!/usr/bin/env python3
"""Builds web/assets/city_extra.js: new neighbourhood geometry and the foot-over bridge.

* 'suburb'   - GREEN LINE district: houses, fences, trees and lawns (Kenney City Kit Suburban, CC0)
* 'downtown' - GOLDEN TERMINAL / NEON NIGHT: towers and shop fronts (Kenney City Kit Commercial, CC0)
* 'bridge'   - procedural foot-over bridge that spans the tracks

Each set is four 24 m street slices; the renderer mirrors them to get eight different-looking slices.
The Kenney palette textures are baked into vertex colours (see tools/meshkit.py), so the existing
texture-less renderer draws them unchanged.  Source models live in tools/third_party/kenney (CC0).

    python3 tools/build_city_assets.py
"""
import json
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import meshkit as mk  # noqa: E402
from meshkit import Mesh, T, S, Ry  # noqa: E402

HERE = os.path.dirname(__file__)
KEN = os.path.join(HERE, 'third_party', 'kenney')
OUT = os.path.join(HERE, '..', 'web', 'assets', 'city_extra.js')
Z0, Z1 = -23.55, -0.12           # usable depth of one street slice (the engine slice is 23.65 m)
STREET = 4.72                    # x where the pavement starts (track bed + curb end)
FRONT = float(os.environ.get('RUNNER_FRONT_ROT', '90'))  # degrees; Kenney models face +Z


class Lib:
    def __init__(self, pack):
        self.dir = os.path.join(KEN, pack)
        self.palettes = {os.path.splitext(f)[0]: mk.load_palette(os.path.join(self.dir, f)) for f in sorted(os.listdir(self.dir)) if f.endswith('.png')}
        self.cache = {}

    def get(self, name, pal='colormap', spec=24):
        key = (name, pal)
        if key not in self.cache:
            m = mk.load_glb(os.path.join(self.dir, name + '.glb'), self.palettes[pal], spec)
            lo, hi = m.bbox()
            m = m.xf(T(-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2))
            self.cache[key] = m
        return self.cache[key]

    def size(self, name):
        lo, hi = self.get(name).bbox()
        return hi - lo

    def pick(self, rng, bias=None):
        names = sorted(self.palettes)
        return rng.choice(names)


def base_track():
    """Track bed (ties, rail details) copied from the original city slices so every district shares it."""
    s = open(os.path.join(HERE, '..', 'web', 'assets', 'models.js'), encoding='utf8').read()
    j = json.loads(s[s.index('=') + 1:].rstrip().rstrip(';'))
    import base64
    raw = base64.b64decode(j['chunks'][3]['data'])
    a = np.frombuffer(raw, dtype=[('p', '<i2', 3), ('n', '<i2', 3), ('c', 'u1', 4)])
    m = Mesh(a['p'] / 128.0, a['n'] / 32767.0, a['c'].astype(float))
    return m.filter(lambda c: (np.abs(c[:, 0]) < 4.74) & (c[:, 1] < 0.35))


TRACK = None


def facing(side):
    """Rotation that turns a model's +Z front toward the track."""
    return Ry(math.radians(FRONT) * (1 if side < 0 else -1))


def put_front(m, side, z, scale, front_x):
    """Place a normalised model with its front plane on x = side*front_x, centred on z."""
    lo, hi = m.bbox()
    depth = (hi[2] - lo[2]) * scale
    return m.xf(T(side * (front_x + depth / 2), 0, z) @ facing(side) @ S(scale))


def ground(side, x0, x1, color, y=0.03):
    xa, xb = sorted((side * x0, side * x1))
    return mk.box(xb - xa, .02, Z1 - Z0 if Z1 > Z0 else Z0 - Z1, color, 8).xf(T((xa + xb) / 2, y - .01, (Z0 + Z1) / 2))


def lamp(side, z):
    """Cheap street lamp: a handful of boxes (about 50 triangles)."""
    dark, light = (60, 68, 82), (255, 244, 196)
    return [mk.box(.14, 5.6, .14, dark, 50).xf(T(side * 4.6, 2.8, z)),
            mk.box(1.3, .08, .08, dark, 50).xf(T(side * 4.0, 5.65, z)),
            mk.box(.62, .08, .26, light, 230).xf(T(side * 3.4, 5.58, z)),
            mk.box(.3, .3, .3, (46, 52, 64), 40).xf(T(side * 4.6, .15, z))]


# --------------------------------------------------------------- downtown
def downtown_chunk(lib, trees, seed):
    rng = random.Random(seed)
    parts = []
    medium = ['building-a', 'building-b', 'building-c', 'building-d']
    tall = ['building-skyscraper-a', 'building-skyscraper-e']
    towers = [n[:-4] for n in os.listdir(lib.dir) if n.startswith('low-detail-building-') and n.endswith('.glb') and 'wide' not in n]
    towers = [n for n in towers if n not in ('low-detail-building-b', 'low-detail-building-g', 'low-detail-building-a', 'low-detail-building-j', 'low-detail-building-m')]
    for side in (-1, 1):
        parts += [ground(side, STREET, 6.1, (214, 214, 222)), ground(side, 6.1, 30, (172, 178, 190))]
        order = rng.sample(medium, 2)
        if rng.random() < .6:
            order[rng.randrange(2)] = rng.choice(tall)
        n = len(order)
        for i, name in enumerate(order):
            zc = Z1 + (Z0 - Z1) * (i + .5) / n
            width = abs(Z0 - Z1) / n - .5
            size = lib.size(name)
            scale = min(width / size[0], 26.0 / size[1])
            parts.append(put_front(lib.get(name, lib.pick(rng)), side, zc, scale, 4.85 + rng.random() * .2))
        # low-poly backdrop towers behind the front row
        for k in range(3):
            name = rng.choice(towers)
            zc = Z1 + (Z0 - Z1) * (k + .5) / 3.0 + rng.uniform(-1.2, 1.2)
            sc = rng.uniform(8, 11)
            parts.append(lib.get(name, lib.pick(rng)).xf(T(side * rng.uniform(17, 22), 0, zc) @ S(sc, rng.uniform(1.0, 1.8), sc)))
        for zc in (-3.0, -14.8):
            parts += lamp(side, zc)
        for zc in (-9.0, -20.8):
            parts.append(trees.get('tree-small').xf(T(side * 5.4, 0, zc) @ S(5.0)))
    parts.append(TRACK)
    return Mesh.cat(parts)


# ----------------------------------------------------------------- suburb
def suburb_chunk(lib, seed):
    rng = random.Random(seed)
    parts = []
    houses = ['building-type-h', 'building-type-i', 'building-type-k', 'building-type-r', 'building-type-g', 'building-type-q', 'building-type-a', 'building-type-c']
    for side in (-1, 1):
        parts += [ground(side, STREET, 6.2, (210, 208, 200)), ground(side, 6.2, 30, (126, 198, 106))]
        pick = rng.sample(houses, 2)
        for i, name in enumerate(pick):
            zc = Z1 + (Z0 - Z1) * (i + .5) / 2.0
            width = abs(Z0 - Z1) / 2.0 - 1.4
            size = lib.size(name)
            scale = min(width / size[0], 7.6)
            parts.append(put_front(lib.get(name, lib.pick(rng)), side, zc, scale, 8.4 + rng.random() * .4))
            stones = lib.get('path-stones-long')
            for j in range(3):
                parts.append(stones.xf(T(side * (6.35 + j * 0.62), 0.045, zc) @ Ry(math.radians(90)) @ S(5.2)))
            for tx, tz in ((rng.uniform(6.6, 7.4), zc + rng.uniform(2.6, 3.8)), (rng.uniform(10.5, 14), zc - rng.uniform(3.0, 5.0))):
                parts.append(lib.get('tree-large').xf(T(side * tx, 0, tz) @ S(rng.uniform(5.2, 7.0))))
        fence = lib.get('fence')
        n = 6
        for j in range(n):
            zc = Z1 + (Z0 - Z1) * (j + .5) / n
            parts.append(fence.xf(T(side * 6.3, 0.03, zc) @ Ry(math.radians(90)) @ S(7.9, 5.0, 5.0)))
        for zc in (-3.0, -14.8):
            parts += lamp(side, zc)
        parts.append(lib.get('tree-small').xf(T(side * 5.45, 0, -9.0) @ S(5.2)))
        parts.append(lib.get('tree-small').xf(T(side * 5.45, 0, -20.8) @ S(5.2)))
    parts.append(TRACK)
    return Mesh.cat(parts)


# ----------------------------------------------------------------- bridge
def footbridge():
    concrete, dark, steel, yellow, black = (182, 188, 200), (70, 76, 92), (58, 100, 156), (255, 204, 64), (36, 40, 52)
    parts = []
    deck_y, half = 7.3, 6.9
    parts.append(mk.box(half * 2, .5, 3.4, concrete, 20).xf(T(0, deck_y, 0)))
    parts.append(mk.box(half * 2, .14, 3.1, dark, 10).xf(T(0, deck_y - .3, 0)))
    for i in range(-8, 9):  # hazard stripes on the front edge
        parts.append(mk.box(.82, .26, .06, yellow if i % 2 == 0 else black, 40).xf(T(i * .86, deck_y - .02, 1.72)))
        parts.append(mk.box(.82, .26, .06, yellow if i % 2 == 0 else black, 40).xf(T(i * .86, deck_y - .02, -1.72)))
    for sz in (-1, 1):  # railings
        parts.append(mk.box(half * 2, .12, .12, steel, 90).xf(T(0, deck_y + 1.28, sz * 1.55)))
        parts.append(mk.box(half * 2, .08, .08, steel, 90).xf(T(0, deck_y + .72, sz * 1.55)))
        for i in range(-8, 9):
            parts.append(mk.box(.08, 1.28, .08, steel, 90).xf(T(i * .85, deck_y + .64, sz * 1.55)))
    for sx in (-1, 1):  # towers
        parts.append(mk.box(1.5, deck_y, 2.6, concrete, 20).xf(T(sx * 5.9, deck_y / 2 - .02, 0)))
        for y in (1.2, 2.4, 3.6, 4.8, 6.0):
            parts.append(mk.box(1.58, .16, 2.68, dark, 20).xf(T(sx * 5.9, y, 0)))
        parts.append(mk.box(1.62, .5, 2.72, yellow, 30).xf(T(sx * 5.9, .25, 0)))
    for sx in (-1, 1):  # roof supports + roof
        for sz in (-1, 1):
            parts.append(mk.box(.22, 2.6, .22, steel, 100).xf(T(sx * 6.55, deck_y + 1.6, sz * 1.5)))
    parts.append(mk.box(half * 2 + .8, .18, 3.9, steel, 110).xf(T(0, deck_y + 2.95, 0)))
    parts.append(mk.box(half * 2 + .9, .1, 4.0, yellow, 60).xf(T(0, deck_y + 3.1, 0)))
    # sign board on the front rail, facing the runner (kept above the deck so jumpers never clip it)
    parts.append(mk.box(4.2, .9, .12, (30, 60, 110), 40).xf(T(0, deck_y + .85, 1.72)))
    parts.append(mk.box(3.9, .16, .14, (255, 244, 196), 220).xf(T(0, deck_y + 1.1, 1.8)))
    return Mesh.cat(parts)


def main():
    global TRACK
    TRACK = base_track()
    commercial, suburban = Lib('commercial'), Lib('suburban')
    mk.QUALITY = 1.0
    sets = {
        'downtown': [downtown_chunk(commercial, suburban, 100 + i) for i in range(4)],
        'suburb': [suburb_chunk(suburban, 200 + i) for i in range(4)],
    }
    payload = {'districtChunks': {k: [m.pack() for m in v] for k, v in sets.items()}, 'bridge': footbridge().pack()}
    stats = {k: [len(m) for m in v] for k, v in sets.items()}
    stats['bridge'] = len(footbridge())
    body = 'R.districtChunks=%s;R.bridge=%s;' % (json.dumps(payload['districtChunks'], separators=(',', ':')), json.dumps(payload['bridge'], separators=(',', ':')))
    js = ('/* New neighbourhood geometry + foot-over bridge (generated by tools/build_city_assets.py).\n'
          ' * Kenney City Kit Commercial/Suburban are CC0; see tools/third_party/kenney. */\n'
          '(function(){var R=window.RUNNER_MODELS;if(!R)return;%s})();\n') % body
    with open(OUT, 'w', encoding='utf8') as f:
        f.write(js)
    print('wrote', os.path.relpath(OUT), '%.2f MB' % (len(js) / 1e6), stats)


if __name__ == '__main__':
    main()
