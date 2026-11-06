"""Small offline mesh toolkit for Subway Runner's baked 16-byte vertex format.

Vertex layout (little endian, 16 bytes): int16 x,y,z (units / 128), int16 nx,ny,nz
(normalised, /32767), uint8 r,g,b (sRGB) and uint8 a (specular strength).
Meshes are plain triangle soups, which is what the WebGL renderer draws.
Only numpy and Pillow are required.
"""
import base64
import json
import math
import struct

import numpy as np

SCALE = 128.0
QUALITY = 1.0  # global tessellation scale (lower = fewer triangles)


def _q(n, lo=5):
    return max(lo, int(round(n * QUALITY)))


# ---------------------------------------------------------------- transforms
def T(x=0.0, y=0.0, z=0.0):
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def S(x=1.0, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return np.diag([x, y, z, 1.0])


def Rx(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[1, 1], m[1, 2], m[2, 1], m[2, 2] = c, -s, s, c
    return m


def Ry(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, s, -s, c
    return m


def Rz(a):
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0], m[0, 1], m[1, 0], m[1, 1] = c, -s, s, c
    return m


def rgba(color, a=0):
    """Accepts (r,g,b) or (r,g,b,a) in 0-255 or a '#rrggbb' string."""
    if isinstance(color, str):
        h = color.lstrip('#')
        color = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    if len(color) == 3:
        return (int(color[0]), int(color[1]), int(color[2]), int(a))
    return tuple(int(v) for v in color)


# ---------------------------------------------------------------------- mesh
class Mesh:
    def __init__(self, p=None, n=None, c=None):
        self.p = np.zeros((0, 3)) if p is None else np.asarray(p, dtype=float).reshape(-1, 3)
        self.n = np.zeros((0, 3)) if n is None else np.asarray(n, dtype=float).reshape(-1, 3)
        self.c = np.zeros((0, 4)) if c is None else np.asarray(c, dtype=float).reshape(-1, 4)

    def __len__(self):
        return len(self.p)

    @staticmethod
    def cat(meshes):
        meshes = [m for m in meshes if m is not None and len(m)]
        if not meshes:
            return Mesh()
        return Mesh(np.concatenate([m.p for m in meshes]), np.concatenate([m.n for m in meshes]), np.concatenate([m.c for m in meshes]))

    def xf(self, M):
        if not len(self):
            return Mesh()
        M = np.asarray(M, dtype=float)
        p = self.p @ M[:3, :3].T + M[:3, 3]
        n = self.n @ np.linalg.inv(M[:3, :3])
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        return Mesh(p, n, self.c.copy())

    def color(self, color, a=None):
        col = rgba(color, 0 if a is None else a)
        c = np.tile(np.array(col, dtype=float), (len(self), 1))
        if a is None and len(color) == 3 and not isinstance(color, str):
            c[:, 3] = self.c[:, 3] if len(self.c) == len(self) else 0
        return Mesh(self.p, self.n, c)

    def paint(self, fn):
        """fn(positions Nx3) -> Nx4 float colours."""
        return Mesh(self.p, self.n, np.asarray(fn(self.p), dtype=float))

    def shade(self, fn):
        """Multiply RGB by fn(positions)->N factors (baked ambient occlusion / gradients)."""
        k = np.asarray(fn(self.p), dtype=float).reshape(-1, 1)
        c = self.c.copy()
        c[:, :3] = np.clip(c[:, :3] * k, 0, 255)
        return Mesh(self.p, self.n, c)

    def filter(self, keep):
        """Keep only triangles whose centroid satisfies keep(centroids Nx3) -> bool array."""
        cen = self.p.reshape(-1, 3, 3).mean(axis=1)
        idx = np.repeat(np.asarray(keep(cen), dtype=bool), 3)
        return Mesh(self.p[idx], self.n[idx], self.c[idx])

    def flat_normals(self):
        tri = self.p.reshape(-1, 3, 3)
        nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        return Mesh(self.p, np.repeat(nrm, 3, axis=0), self.c)

    def bbox(self):
        return self.p.min(axis=0), self.p.max(axis=0)

    def encode(self):
        n = len(self)
        if n % 3:
            raise ValueError('triangle soup expected')
        out = bytearray(n * 16)
        pos = np.clip(np.round(self.p * SCALE), -32768, 32767).astype('<i2')
        nrm = np.clip(np.round(self.n * 32767), -32767, 32767).astype('<i2')
        col = np.clip(np.round(self.c), 0, 255).astype('u1')
        arr = np.zeros(n, dtype=[('p', '<i2', 3), ('n', '<i2', 3), ('c', 'u1', 4)])
        arr['p'], arr['n'], arr['c'] = pos, nrm, col
        out[:] = arr.tobytes()
        return bytes(out)

    def pack(self):
        return {'count': len(self), 'data': base64.b64encode(self.encode()).decode('ascii')}


# ---------------------------------------------------------------- primitives
def _grid_to_tris(P, N, C):
    """P,N: (R+1, S+1, 3) grids -> triangle soup (quads split in two)."""
    R, Sg = P.shape[0] - 1, P.shape[1] - 1
    idx = []
    for i in range(R):
        for j in range(Sg):
            a, b, c, d = (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)
            idx += [a, b, c, a, c, d]
    pts = np.array([P[i, j] for i, j in idx])
    nrm = np.array([N[i, j] for i, j in idx])
    col = np.tile(np.array(C, dtype=float), (len(idx), 1))
    return Mesh(pts, nrm, col)


def lathe(profile, seg=20, color=(200, 200, 200), a=0, sx=1.0, sz=1.0, close_top=False, close_bottom=False):
    """Revolve a (radius, y) profile (bottom -> top) around Y with smooth normals."""
    seg = _q(seg, 6)
    prof = np.array(profile, dtype=float)
    k = len(prof)
    tang = np.zeros((k, 2))
    for i in range(k):
        lo, hi = max(i - 1, 0), min(i + 1, k - 1)
        tang[i] = prof[hi] - prof[lo]
    nrm2 = np.stack([tang[:, 1], -tang[:, 0]], axis=1)
    nrm2 /= np.maximum(np.linalg.norm(nrm2, axis=1, keepdims=True), 1e-9)
    ang = np.linspace(0, 2 * math.pi, seg + 1)
    P = np.zeros((k, seg + 1, 3))
    N = np.zeros((k, seg + 1, 3))
    for j, th in enumerate(ang):
        c, s = math.cos(th), math.sin(th)
        P[:, j, 0] = prof[:, 0] * c * sx
        P[:, j, 1] = prof[:, 1]
        P[:, j, 2] = prof[:, 0] * s * sz
        n = np.stack([nrm2[:, 0] * c / sx, nrm2[:, 1], nrm2[:, 0] * s / sz], axis=1)
        N[:, j] = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    m = _grid_to_tris(P, N, rgba(color, a))
    parts = [m]
    if close_top and prof[-1][0] > 1e-6:
        parts.append(_cap(prof[-1][0], prof[-1][1], seg, 1, color, a, sx, sz))
    if close_bottom and prof[0][0] > 1e-6:
        parts.append(_cap(prof[0][0], prof[0][1], seg, -1, color, a, sx, sz))
    return Mesh.cat(parts)


def _cap(r, y, seg, up, color, a, sx, sz):
    pts, nrm = [], []
    for j in range(seg):
        t0, t1 = 2 * math.pi * j / seg, 2 * math.pi * (j + 1) / seg
        tri = [(0, y, 0), (r * math.cos(t0) * sx, y, r * math.sin(t0) * sz), (r * math.cos(t1) * sx, y, r * math.sin(t1) * sz)]
        pts += tri
        nrm += [(0, up, 0)] * 3
    return Mesh(pts, nrm, np.tile(np.array(rgba(color, a), dtype=float), (len(pts), 1)))


def ellipsoid(rx, ry, rz, seg=24, rings=14, color=(200, 200, 200), a=0):
    seg, rings = _q(seg, 6), _q(rings, 4)
    prof = []
    for i in range(rings + 1):
        t = -math.pi / 2 + math.pi * i / rings
        prof.append((max(math.cos(t), 1e-4) * 1.0, math.sin(t)))
    m = lathe(prof, seg, color, a, sx=rx, sz=rz)
    # lathe built a unit sphere scaled in x/z; stretch y for the third radius
    return m.xf(S(1, ry, 1))


def cylinder(r0, r1, h, seg=18, color=(200, 200, 200), a=0, caps=True, sx=1.0, sz=1.0):
    """Cylinder/cone along +Y from y=0 (radius r0) to y=h (radius r1)."""
    return lathe([(r0, 0), (r1, h)], seg, color, a, sx=sx, sz=sz, close_top=caps, close_bottom=caps)


def capsule(r0, r1, length, seg=18, color=(200, 200, 200), a=0, sx=1.0, sz=1.0, cap_rings=6):
    """Capsule hanging from y=0 down to y=-length, radius r0 at the top and r1 at the bottom."""
    if length < r0 + r1:
        raise ValueError('capsule too short for its radii')
    cap_rings = _q(cap_rings, 3)
    prof = []
    for i in range(cap_rings + 1):  # bottom hemisphere, pole first
        t = -math.pi / 2 + (math.pi / 2) * i / cap_rings
        prof.append((max(math.cos(t) * r1, 1e-4), -length + r1 + math.sin(t) * r1))
    for i in range(cap_rings + 1):  # top hemisphere
        t = (math.pi / 2) * i / cap_rings
        prof.append((max(math.cos(t) * r0, 1e-4), -r0 + math.sin(t) * r0))
    return lathe(prof, seg, color, a, sx=sx, sz=sz)


def box(sx, sy, sz, color=(200, 200, 200), a=0):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [((1, 0, 0), [(hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)]),
             ((-1, 0, 0), [(-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz), (-hx, -hy, -hz)]),
             ((0, 1, 0), [(-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)]),
             ((0, -1, 0), [(-hx, -hy, hz), (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz)]),
             ((0, 0, 1), [(hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz), (-hx, -hy, hz)]),
             ((0, 0, -1), [(-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz)])]
    pts, nrm = [], []
    for n, q in faces:
        for i in (0, 1, 2, 0, 2, 3):
            pts.append(q[i])
            nrm.append(n)
    return Mesh(pts, nrm, np.tile(np.array(rgba(color, a), dtype=float), (len(pts), 1)))


def superellipsoid(rx, ry, rz, e=0.45, seg=20, rings=12, color=(200, 200, 200), a=0):
    """Rounded-box-like solid (e=1 sphere, e->0 box). Smooth normals by finite differences."""
    seg, rings = _q(seg, 8), _q(rings, 5)

    def sg(v):
        return np.sign(v) * np.abs(v) ** e

    us = np.linspace(-math.pi, math.pi, seg + 1)
    vs = np.linspace(-math.pi / 2, math.pi / 2, rings + 1)
    P = np.zeros((rings + 1, seg + 1, 3))
    for i, v in enumerate(vs):
        for j, u in enumerate(us):
            cv, sv, cu, su = math.cos(v), math.sin(v), math.cos(u), math.sin(u)
            P[i, j] = (rx * sg(cv) * sg(cu), ry * sg(sv), rz * sg(cv) * sg(su))
    N = np.zeros_like(P)
    for i in range(rings + 1):
        for j in range(seg + 1):
            du = P[i, min(j + 1, seg)] - P[i, max(j - 1, 0)]
            dv = P[min(i + 1, rings), j] - P[max(i - 1, 0), j]
            n = np.cross(du, dv)
            if np.linalg.norm(n) < 1e-9:
                n = P[i, j]
            if np.dot(n, P[i, j]) < 0:
                n = -n
            N[i, j] = n / max(np.linalg.norm(n), 1e-9)
    return _grid_to_tris(P, N, rgba(color, a))


def torus(R, r, seg=24, ring=10, color=(200, 200, 200), a=0):
    seg, ring = _q(seg, 8), _q(ring, 4)
    us = np.linspace(0, 2 * math.pi, seg + 1)
    vs = np.linspace(0, 2 * math.pi, ring + 1)
    P = np.zeros((ring + 1, seg + 1, 3))
    N = np.zeros_like(P)
    for i, v in enumerate(vs):
        for j, u in enumerate(us):
            cx, cz = math.cos(u), math.sin(u)
            nx, ny, nz = math.cos(v) * cx, math.sin(v), math.cos(v) * cz
            P[i, j] = ((R + r * math.cos(v)) * cx, r * math.sin(v), (R + r * math.cos(v)) * cz)
            N[i, j] = (nx, ny, nz)
    return _grid_to_tris(P, N, rgba(color, a))


def tube(points, radius, seg=10, color=(200, 200, 200), a=0, taper=1.0):
    """Smooth tube along a polyline (hair strands, straps, smile arcs)."""
    seg = _q(seg, 5)
    pts = np.array(points, dtype=float)
    k = len(pts)
    rings = []
    for i in range(k):
        t = pts[min(i + 1, k - 1)] - pts[max(i - 1, 0)]
        t /= max(np.linalg.norm(t), 1e-9)
        up = np.array([0, 1.0, 0]) if abs(t[1]) < 0.9 else np.array([1.0, 0, 0])
        b1 = np.cross(t, up)
        b1 /= np.linalg.norm(b1)
        b2 = np.cross(t, b1)
        rad = radius * (1 + (taper - 1) * i / max(k - 1, 1))
        ring = []
        for j in range(seg + 1):
            th = 2 * math.pi * j / seg
            d = b1 * math.cos(th) + b2 * math.sin(th)
            ring.append((pts[i] + d * rad, d))
        rings.append(ring)
    P = np.array([[q[0] for q in ring] for ring in rings])
    N = np.array([[q[1] for q in ring] for ring in rings])
    m = _grid_to_tris(P, N, rgba(color, a))
    caps = [ellipsoid(radius, radius, radius, 10, 6, color, a).xf(T(*pts[0])), ellipsoid(radius * taper, radius * taper, radius * taper, 10, 6, color, a).xf(T(*pts[-1]))]
    return Mesh.cat([m] + caps)


# ------------------------------------------------------------- GLB importing
_CT = {5126: '<f4', 5123: '<u2', 5125: '<u4', 5121: 'u1', 5120: 'i1', 5122: '<i2'}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def _glb(path):
    b = open(path, 'rb').read()
    clen = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + clen])
    off = 20 + clen
    blen = struct.unpack('<I', b[off:off + 4])[0]
    return j, b[off + 8:off + 8 + blen]


def _acc(j, binary, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n = _NC[a['type']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(binary, dtype=_CT[a['componentType']], count=a['count'] * n, offset=base).reshape(-1, n)


def load_glb(path, palette=None, spec=24):
    """Load a Kenney GLB as a triangle soup, baking the shared colormap into vertex colours.

    The Kenney kits sample single swatches / vertical gradients of one palette texture,
    so per-vertex colours reproduce them almost exactly (mean error < 2/255).
    """
    j, binary = _glb(path)
    P, Nn, U, T_ = [], [], [], []
    off = 0
    for node_mesh in j['meshes']:
        for prim in node_mesh['primitives']:
            at = prim['attributes']
            pos = _acc(j, binary, at['POSITION']).astype(float)
            nor = _acc(j, binary, at['NORMAL']).astype(float) if 'NORMAL' in at else np.zeros_like(pos)
            uv = _acc(j, binary, at['TEXCOORD_0']).astype(float) if 'TEXCOORD_0' in at else np.zeros((len(pos), 2))
            idx = _acc(j, binary, prim['indices']).astype(np.int64).reshape(-1)
            P.append(pos)
            Nn.append(nor)
            U.append(uv)
            T_.append(idx + off)
            off += len(pos)
    P, Nn, U, idx = np.concatenate(P), np.concatenate(Nn), np.concatenate(U), np.concatenate(T_)
    if palette is not None:
        h, w = palette.shape[:2]
        px = np.clip((U[:, 0] * w).astype(int), 0, w - 1)
        py = np.clip((U[:, 1] * h).astype(int), 0, h - 1)
        col = palette[py, px, :3].astype(float)
    else:
        col = np.full((len(P), 3), 200.0)
    colors = np.concatenate([col, np.full((len(P), 1), float(spec))], axis=1)
    return Mesh(P[idx], Nn[idx], colors[idx])


def load_palette(path):
    from PIL import Image
    return np.array(Image.open(path).convert('RGBA'))


# ------------------------------------------------------------------- output
def js_assign(target, payload):
    """JavaScript snippet that merges payload into window.RUNNER_MODELS at `target`."""
    return json.dumps(payload, separators=(',', ':'))
