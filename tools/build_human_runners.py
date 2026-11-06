#!/usr/bin/env python3
"""Builds web/assets/humans.js: polished cartoon human runners for Subway Runner.

The six playable people (Kai, Mira, Zuri, Bolt, Nova, Flux) are generated procedurally on the
game's existing 13-bone rigid rig (same pivots as the original runners), so every animation,
hit box, shadow and shop preview keeps working.  Fenn the fox is left untouched.

    python3 tools/build_human_runners.py            # writes web/assets/humans.js
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import meshkit as mk  # noqa: E402
from meshkit import Mesh, T, S, Rx, Ry, Rz  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'humans.js')

BONES = [  # name, parent, pivot (identical to the original runners)
    ('BodyMotion', -1, (0, 0, 0)), ('Torso', 0, (0, 1.22, 0)), ('Head', 1, (0, 0.72, -0.015)),
    ('Arm0', 1, (-0.34, 0.4, 0)), ('Elbow', 3, (0, -0.3, 0)), ('Leg0', 0, (-0.17, 0.94, 0)),
    ('Knee', 5, (0, -0.4, 0)), ('Sneaker', 6, (0, -0.34, 0)),
    ('Arm1', 1, (0.34, 0.4, 0)), ('Elbow', 8, (0, -0.3, 0)), ('Leg1', 0, (0.17, 0.94, 0)),
    ('Knee', 10, (0, -0.4, 0)), ('Sneaker', 11, (0, -0.34, 0)),
]
MIRROR = S(-1, 1, 1)


def shade_y(m, y0, y1, dark=.78):
    """Soft baked occlusion: darken toward y0, neutral at y1."""
    return m.shade(lambda p: dark + (1 - dark) * np.clip((p[:, 1] - y0) / (y1 - y0), 0, 1))


def darker(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c[:3])


def lighter(c, k):
    return tuple(int(max(0, min(255, v + (255 - v) * k))) for v in c[:3])


# ------------------------------------------------------------------ the head
SKULL = dict(rx=.285, ry=.315, rz=.275, cy=.03)


def skull_z(x, y, pad=0.0):
    """z of the skull surface at (x, y) (front is -z)."""
    u = (x / SKULL['rx']) ** 2 + ((y - SKULL['cy']) / SKULL['ry']) ** 2
    return -SKULL['rz'] * math.sqrt(max(0.0, 1 - u)) - pad


def face(spec):
    skin = spec['skin']
    parts = [mk.ellipsoid(SKULL['rx'], SKULL['ry'], SKULL['rz'], 36, 22, skin, 14).xf(T(0, SKULL['cy'], 0))]
    parts.append(mk.cylinder(.1, .115, .16, 16, darker(skin, .88), 8).xf(T(0, -.35, .01)))  # neck
    eye_y, eye_x = .07, .105
    for sx in (-1, 1):
        ex = sx * eye_x
        parts.append(mk.ellipsoid(.062, .078, .034, 20, 12, (250, 250, 252), 90).xf(T(ex, eye_y, skull_z(ex, eye_y) + .012)))
        parts.append(mk.ellipsoid(.04, .054, .022, 18, 10, spec.get('eye', (44, 30, 28)), 120).xf(T(ex + sx * .004, eye_y - .006, skull_z(ex, eye_y) - .012)))
        parts.append(mk.ellipsoid(.014, .016, .01, 8, 6, (255, 255, 255), 255).xf(T(ex + sx * .004 + .014, eye_y + .018, skull_z(ex, eye_y) - .03)))
        brow_c = spec.get('brow', darker(spec['hair'], .9))
        parts.append(mk.box(.098, .02, .026, brow_c, 10).xf(Rz(-sx * .2) @ T(ex, eye_y + .098, skull_z(ex, eye_y + .098) - .006)))
        parts.append(mk.ellipsoid(.038, .026, .02, 12, 8, lighter(skin, .0) if spec.get('blush') is None else spec['blush'], 0).xf(T(sx * .155, -.04, skull_z(sx * .155, -.04) + .004)))
        parts.append(mk.ellipsoid(.032, .062, .026, 12, 8, darker(skin, .93), 6).xf(T(sx * .281, .02, .02)))  # ear
    parts.append(mk.ellipsoid(.034, .03, .036, 14, 10, darker(skin, .94), 20).xf(T(0, -.018, skull_z(0, -.018) - .01)))  # nose
    smile = [(-.075 + .15 * i / 8, -.112 - .016 * math.sin(math.pi * i / 8) * 1.4 + .01 * abs(i - 4) / 4, skull_z(-.075 + .15 * i / 8, -.12) - .005) for i in range(9)]
    parts.append(mk.tube(smile, .0125, 8, spec.get('mouth', (112, 38, 44)), 40))
    return Mesh.cat(parts)


def hair_dome(color, tilt=.28, grow=1.0, rx=.31, ry=.32, rz=.305, a=26, lift=.0):
    """Hemisphere hair/helmet shell that hugs the skull and dips at the nape."""
    prof = [(math.cos(t), math.sin(t)) for t in np.linspace(0, math.pi / 2, 14)]
    dome = mk.lathe([(r * 1.0, y) for r, y in prof], 36, color, a, sx=rx * grow, sz=rz * grow, close_bottom=True).xf(S(1, ry * grow, 1))
    return dome.xf(T(0, SKULL['cy'] + .035 + lift, .012) @ Rx(tilt))


def cap(color, brim, logo=None, grow=1.07):
    parts = [hair_dome(color, .22, grow, .295, .29, .3, 30, .02)]
    parts.append(mk.superellipsoid(.12, .016, .12, .5, 24, 8, brim, 40).xf(Rx(-.1) @ T(0, .165, -.325)))
    parts.append(mk.ellipsoid(.024, .02, .024, 10, 6, brim, 30).xf(T(0, .345, -.01)))
    parts.append(mk.torus(.292, .012, 36, 6, darker(color, .75), 30).xf(T(0, .16, 0.012) @ Rx(.05)))
    if logo:
        parts.append(mk.ellipsoid(.05, .035, .012, 14, 8, logo, 120).xf(Rx(.25) @ T(0, .24, -.292)))
    return Mesh.cat(parts)


def head(spec):
    parts = [face(spec)]
    style = spec['headgear']
    hair = spec['hair']
    if style == 'cap':
        parts += [hair_dome(hair, .5, .99, .292, .26, .3, 22, -.03), cap(spec['cap'], spec['brim'], spec.get('logo'))]
    elif style == 'ponytail':
        parts += [hair_dome(hair, .42, 1.0, .305, .3, .3, 30),
                  mk.tube([(0, .17, .26), (0, .2, .38), (0, .08, .5), (0, -.14, .5), (0, -.3, .44)], .07, 10, hair, 30, .45),
                  mk.torus(.075, .016, 16, 6, spec['band'], 40).xf(Rx(1.25) @ T(0, .2, .3)),
                  mk.torus(.292, .02, 36, 8, spec['band'], 50).xf(T(0, .205, .01) @ Rx(.11))]
        for sx in (-1, 1):  # side fringe
            parts.append(mk.ellipsoid(.07, .1, .05, 14, 10, hair, 26).xf(T(sx * .22, .1, -.12)))
        parts.append(mk.ellipsoid(.2, .06, .08, 18, 8, hair, 26).xf(Rx(.2) @ T(0, .245, -.2)))
    elif style == 'afro':
        parts += [mk.ellipsoid(.33, .3, .32, 32, 18, hair, 24).xf(T(0, .22, .06)),
                  mk.ellipsoid(.17, .15, .16, 20, 12, hair, 24).xf(T(0, .43, -.02)),
                  mk.torus(.3, .026, 36, 8, spec['band'], 60).xf(T(0, .2, .0) @ Rx(.1))]
    elif style == 'hardhat':
        parts += [hair_dome(hair, .5, .99, .292, .26, .3, 22, -.03),
                  hair_dome(spec['hat'], .22, 1.12, .3, .3, .315, 150, .03),
                  mk.superellipsoid(.1, .02, .16, .5, 20, 8, spec['hat'], 150).xf(Rx(-.1) @ T(0, .13, -.28)),
                  mk.box(.07, .045, .09, (250, 250, 240), 200).xf(T(0, .26, -.31)),
                  mk.torus(.318, .02, 36, 8, darker(spec['hat'], .85), 90).xf(T(0, .14, .01) @ Rx(-.1))]
        for sx in (-1, 1):
            parts.append(mk.box(.03, .17, .06, darker(spec['hat'], .78), 100).xf(T(sx * .06, .43, -.05) @ Rz(sx * .1)))
        # goggles resting on the brim
        parts.append(mk.torus(.062, .016, 20, 8, (60, 70, 86), 120).xf(Rx(math.pi / 2 - .3) @ T(-.075, .2, -.33)))
        parts.append(mk.torus(.062, .016, 20, 8, (60, 70, 86), 120).xf(Rx(math.pi / 2 - .3) @ T(.075, .2, -.33)))
        parts.append(mk.ellipsoid(.055, .012, .055, 16, 6, (140, 220, 255), 230).xf(Rx(-.3) @ T(-.075, .205, -.325)))
        parts.append(mk.ellipsoid(.055, .012, .055, 16, 6, (140, 220, 255), 230).xf(Rx(-.3) @ T(.075, .205, -.325)))
    elif style == 'helmet':
        parts += [hair_dome(hair, .5, .99, .292, .26, .3, 22, -.03)]
        cy, cz, R = SKULL['cy'] + .03, .05, .4
        shell = mk.ellipsoid(R, R, R, 34, 20, spec['suit'], 190).xf(T(0, cy, cz))
        shell = shell.filter(lambda c: ~((c[:, 2] < cz - .1) & (((c[:, 0]) / .285) ** 2 + ((c[:, 1] - .05) / .31) ** 2 < 1.0)))
        parts.append(shell)
        ring = []
        for i in range(37):
            t = 2 * math.pi * i / 36
            x, y = .285 * math.cos(t), .05 + .31 * math.sin(t)
            ring.append((x, y, cz - math.sqrt(max(.01, R * R - x * x - (y - cy) ** 2)) + .005))
        parts.append(mk.tube(ring, .03, 8, spec['accent'], 150))
        parts.append(mk.torus(.15, .045, 24, 8, spec['suit'], 170).xf(T(0, -.3, .01)))
        parts.append(mk.cylinder(.012, .012, .12, 8, (200, 200, 210), 200).xf(T(.3, .3, .06)))
        parts.append(mk.ellipsoid(.024, .024, .024, 8, 6, spec['accent'], 220).xf(T(.3, .43, .06)))
    elif style == 'spikes':
        parts += [hair_dome(hair, .35, 1.0, .3, .3, .3, 190)]
        for i, (x, y, z, tx, tz) in enumerate([(0, .36, -.1, 0, -.35), (.1, .35, .0, .3, -.15), (-.1, .35, .0, -.3, -.15), (0, .34, .1, 0, .35), (.17, .3, -.1, .55, -.2), (-.17, .3, -.1, -.55, -.2), (.13, .28, .13, .45, .35), (-.13, .28, .13, -.45, .35)]):
            parts.append(mk.cylinder(.055, .0, .2, 10, hair, 200).xf(T(x, y - .04, z) @ Rz(-tx) @ Rx(tz)))
        parts.append(mk.superellipsoid(.27, .028, .045, .5, 24, 8, (22, 24, 32), 200).xf(T(0, .205, -.275) @ Rx(-.12)))  # shades pushed up
        parts.append(mk.superellipsoid(.25, .01, .025, .5, 24, 8, spec['accent'], 255).xf(T(0, .205, -.31) @ Rx(-.12)))
    return Mesh.cat(parts)


# ------------------------------------------------------------------ the body
def torso(spec):
    top, trim, skin = spec['top'], spec['trim'], spec['skin']
    prof = [(.0001, -.4), (.235, -.4), (.245, -.34), (.235, -.18), (.245, .0), (.265, .2), (.255, .33), (.2, .44), (.12, .49), (.085, .515)]
    body = shade_y(mk.lathe(prof, 34, top, 18, sx=1.04, sz=.84, close_bottom=True), -.4, .12, .8)
    parts = [body]
    if spec.get('hem'):
        parts.append(mk.torus(.238, .02, 32, 8, spec['hem'], 30).xf(T(0, -.38, 0)).xf(S(1.04, 1, .84)))
    # collar / neckline
    parts.append(mk.torus(.1, .035, 24, 8, spec.get('collar', trim), 40).xf(T(0, .5, -.005) @ Rx(.1)).xf(S(1.02, 1, .9)))
    # front zip / stripe details
    if spec.get('zip'):
        parts.append(mk.box(.018, .8, .02, spec['zip'], 170).xf(T(0, .06, -.215)))
        parts.append(mk.ellipsoid(.022, .03, .014, 8, 6, (230, 230, 235), 200).xf(T(0, .48, -.215)))
    if spec.get('stripe'):
        parts.append(mk.box(.52, .09, .05, spec['stripe'], 60).xf(T(0, .12, -.0) @ S(1, 1, 1)).xf(S(1, 1, 1)))
    if spec.get('pockets'):
        for sx in (-1, 1):
            parts.append(mk.superellipsoid(.075, .06, .02, .4, 12, 8, darker(top, .86), 20).xf(T(sx * .13, -.22, -.21) @ Rx(.1)))
    if spec.get('belt'):
        parts.append(mk.cylinder(.245, .245, .06, 32, spec['belt'], 60, caps=False, sx=1.04, sz=.84).xf(T(0, -.4, 0)))
        parts.append(mk.superellipsoid(.04, .03, .015, .4, 10, 8, (232, 214, 120), 200).xf(T(0, -.37, -.2)))
    for extra in spec.get('torso_extra', []):
        parts.append(extra)
    return Mesh.cat(parts)


def arm_upper(spec, short=False):
    top, trim = spec['sleeve'], spec['trim']
    sleeve_len = .26 if spec.get('short_sleeve') else .33
    parts = [mk.ellipsoid(.105, .105, .1, 18, 12, top, 18),
             mk.capsule(.098, .084, sleeve_len + .1, 16, top, 18).xf(T(0, .0, 0))]
    if spec.get('short_sleeve'):
        parts.append(mk.capsule(.078, .07, .18, 16, spec['skin'], 14).xf(T(0, -.18, 0)))
        parts.append(mk.torus(.086, .014, 20, 6, spec.get('cuff', trim), 30).xf(T(0, -.255, 0)))
    return shade_y(Mesh.cat(parts), -.35, .0, .86)


def arm_lower(spec):
    skin = spec['skin']
    long_sleeve = not spec.get('short_sleeve')
    parts = []
    glove = spec.get('glove')
    forearm_color = spec['sleeve'] if (long_sleeve and not spec.get('bare_forearm')) else skin
    parts.append(mk.capsule(.078, .064, .33, 16, forearm_color, 18).xf(T(0, .0, 0)))
    hand_c = glove if glove else skin
    parts.append(mk.ellipsoid(.085, .09, .08, 18, 12, hand_c, 30 if glove else 14).xf(T(0, -.365, -.01)))
    parts.append(mk.ellipsoid(.032, .05, .035, 10, 8, hand_c, 30 if glove else 14).xf(T(.065, -.35, -.05) @ Rz(-.35)))  # thumb
    wrist = spec.get('wrist')
    if wrist:
        parts.append(mk.cylinder(.068, .068, .05, 16, wrist, 90, caps=False).xf(T(0, -.3, 0)))
    elif long_sleeve:
        parts.append(mk.torus(.066, .016, 18, 6, spec.get('cuff', spec['trim']), 30).xf(T(0, -.3, 0)))
    return shade_y(Mesh.cat(parts), -.45, -.0, .9)


def leg_upper(spec):
    pants = spec['pants']
    parts = [mk.ellipsoid(.14, .12, .14, 16, 10, pants, 14).xf(T(0, 0, 0)),
             mk.capsule(.14, .115, .46, 18, pants, 14).xf(T(0, .02, 0))]
    if spec.get('shorts'):
        parts[1] = mk.capsule(.14, .125, .3, 18, pants, 14).xf(T(0, .02, 0))
        parts.append(mk.capsule(.105, .098, .24, 16, spec['skin'], 12).xf(T(0, -.2, 0)))
        parts.append(mk.torus(.127, .014, 20, 6, spec.get('trim'), 40).xf(T(0, -.275, 0)))
    if spec.get('seam'):
        parts.append(mk.box(.018, .4, .02, spec['seam'], 200).xf(T(.135, -.18, 0)))
    return shade_y(Mesh.cat(parts), -.42, .05, .88)


def leg_lower(spec):
    pants = spec['pants']
    if spec.get('shorts'):
        parts = [mk.capsule(.1, .084, .46, 16, spec['skin'], 12).xf(T(0, .05, 0))]
        parts.append(mk.cylinder(.092, .092, .1, 16, spec.get('sock', (250, 250, 250)), 20, caps=False).xf(T(0, -.34, 0)))
        parts.append(mk.torus(.092, .014, 18, 6, spec.get('trim'), 40).xf(T(0, -.255, 0)))
    else:
        parts = [mk.capsule(.11, .088, .46, 18, pants, 14).xf(T(0, .05, 0))]
        parts.append(mk.cylinder(.092, .104, .08, 16, darker(pants, .8), 12, caps=False).xf(T(0, -.34, 0)))
        if spec.get('seam'):
            parts.append(mk.box(.016, .36, .02, spec['seam'], 200).xf(T(.108, -.15, 0)))
    if spec.get('knee_pad'):
        parts.append(mk.superellipsoid(.1, .07, .05, .5, 14, 8, spec['knee_pad'], 80).xf(T(0, .0, -.1)))
    return shade_y(Mesh.cat(parts), -.4, .05, .88)


def shoe(spec):
    up, sole, toe, lace = spec['shoe'], spec.get('sole', (246, 246, 250)), spec.get('toe', spec['shoe']), spec.get('lace', (250, 250, 250))
    parts = [mk.superellipsoid(.148, .05, .26, .5, 24, 10, sole, 60).xf(T(0, -.112, -.065)),
             mk.superellipsoid(.132, .085, .225, .55, 24, 12, up, 70).xf(T(0, -.04, -.055)),
             mk.superellipsoid(.12, .07, .1, .55, 18, 10, toe, 80).xf(T(0, -.065, -.205)),
             mk.superellipsoid(.125, .075, .08, .5, 16, 8, darker(up, .85), 40).xf(T(0, -.03, .095)),
             mk.box(.07, .018, .17, lace, 90).xf(T(0, .036, -.11) @ Rx(.34)),
             mk.cylinder(.085, .095, .07, 16, spec.get('sock', (248, 248, 250)), 16, caps=False).xf(T(0, .0, 0)),
             mk.torus(.1, .02, 18, 6, spec.get('collar_shoe', up), 60).xf(T(0, .062, 0))]
    for k in range(3):
        parts.append(mk.box(.1, .01, .02, lace, 120).xf(T(0, .05 - .006 * k, -.08 - .045 * k) @ Rx(.34)))
    if spec.get('shoe_stripe'):
        parts.append(mk.box(.006, .045, .18, spec['shoe_stripe'], 160).xf(T(.133, -.045, -.05)))
        parts.append(mk.box(.006, .045, .18, spec['shoe_stripe'], 160).xf(T(-.133, -.045, -.05)))
    return shade_y(Mesh.cat(parts), -.16, .06, .86)


def build_character(spec):
    meshes = {}
    meshes[1] = torso(spec)
    meshes[2] = head(spec)
    arm_u, arm_l, leg_u, leg_l, sh = arm_upper(spec), arm_lower(spec), leg_upper(spec), leg_lower(spec), shoe(spec)
    # Bones 3-7 are the character's -x side, 8-12 the +x side (mirrored geometry).
    for base, mirror in ((3, False), (8, True)):
        m = MIRROR if mirror else np.eye(4)
        meshes[base] = arm_u.xf(m)
        meshes[base + 1] = arm_l.xf(m)
    for base, mirror in ((5, False), (10, True)):
        m = MIRROR if mirror else np.eye(4)
        meshes[base] = leg_u.xf(m)
        meshes[base + 1] = leg_l.xf(m)
        meshes[base + 2] = sh.xf(m)
    return meshes


# ------------------------------------------------------------------ the cast
def backpack(color, pocket, straps):
    parts = [mk.superellipsoid(.17, .235, .105, .42, 22, 12, color, 40).xf(T(0, .03, .34)),
             mk.superellipsoid(.12, .08, .05, .42, 16, 8, pocket, 60).xf(T(0, -.12, .45)),
             mk.superellipsoid(.07, .03, .03, .4, 10, 6, (250, 250, 250), 100).xf(T(0, .2, .455))]
    for sx in (-1, 1):
        parts.append(mk.tube([(sx * .14, .43, .17), (sx * .165, .36, -.05), (sx * .16, .1, -.2), (sx * .15, -.2, -.215)], .028, 8, straps, 40))
    return parts


def crossbody(color, strap):
    return [mk.tube([(-.2, .42, .0), (-.04, .1, -.22), (.17, -.2, -.1), (.23, -.28, .14)], .022, 8, strap, 40),
            mk.superellipsoid(.1, .075, .045, .4, 16, 8, color, 60).xf(T(.24, -.26, .14))]


def vest_extras(vest, reflect):
    parts = []
    for y in (.12, -.14):
        parts.append(mk.cylinder(.262, .262, .055, 32, reflect, 220, caps=False, sx=1.04, sz=.84).xf(T(0, y, 0)))
    for sx in (-1, 1):
        parts.append(mk.box(.06, .78, .015, reflect, 220).xf(T(sx * .13, .06, -.205) @ Rz(0)))
    parts.append(mk.superellipsoid(.07, .045, .016, .4, 12, 8, (240, 240, 245), 120).xf(T(.13, .3, -.21)))
    return parts


CAST = {
    'courier': dict(  # Kai - city courier: red cap, yellow jacket, teal trousers
        skin=(184, 124, 88), hair=(34, 26, 28), headgear='cap', cap=(226, 62, 60), brim=(188, 44, 48), logo=(255, 226, 120),
        top=(255, 198, 62), sleeve=(255, 198, 62), trim=(232, 62, 58), cuff=(232, 62, 58), zip=(250, 244, 220), collar=(232, 62, 58), pockets=True,
        hem=(232, 62, 58), pants=(34, 152, 160), seam=(252, 238, 150), shoe=(236, 236, 242), toe=(228, 62, 60), sole=(250, 250, 252), shoe_stripe=(228, 62, 60),
        torso_extra=backpack((218, 62, 58), (255, 200, 64), (60, 70, 92))),
    'skater': dict(  # Mira - weekend skater: ponytail, purple hoodie, teal sneakers
        skin=(244, 205, 176), hair=(74, 44, 38), band=(70, 214, 190), headgear='ponytail', blush=(246, 160, 150),
        top=(138, 98, 218), sleeve=(138, 98, 218), trim=(70, 214, 190), cuff=(250, 244, 255), collar=(112, 76, 190), hem=(250, 244, 255),
        pants=(40, 48, 100), seam=(70, 214, 190), shoe=(66, 206, 182), toe=(250, 250, 252), sole=(250, 250, 252), shoe_stripe=(138, 98, 218),
        torso_extra=crossbody((70, 214, 190), (250, 244, 255)) + [mk.tube([(-.07, .44, -.2), (-.08, .22, -.235), (-.075, .0, -.23)], .014, 6, (250, 244, 255), 60),
                                                                 mk.tube([(.07, .44, -.2), (.08, .22, -.235), (.075, .0, -.23)], .014, 6, (250, 244, 255), 60)]),
    'sprinter': dict(  # Zuri - track champion: afro puff, headband, coral jersey, shorts
        skin=(118, 74, 52), hair=(34, 24, 24), band=(255, 214, 60), headgear='afro', eye=(36, 24, 22), mouth=(120, 40, 46), blush=(150, 80, 64),
        top=(250, 112, 104), sleeve=(250, 112, 104), short_sleeve=True, trim=(255, 214, 60), cuff=(255, 214, 60), collar=(255, 214, 60), stripe=(255, 244, 232),
        pants=(32, 44, 92), shorts=True, sock=(255, 214, 60), shoe=(255, 214, 60), toe=(250, 250, 252), sole=(250, 250, 252), shoe_stripe=(32, 44, 92), hem=(255, 214, 60),
        wrist=(255, 214, 60), bare_forearm=True, torso_extra=[mk.superellipsoid(.1, .07, .018, .4, 14, 8, (255, 244, 232), 80).xf(T(0, .2, -.215))]),
    'robot': dict(  # Bolt - metro mechanic: hard hat, goggles, hi-vis vest, overalls
        skin=(206, 150, 112), hair=(80, 52, 40), headgear='hardhat', hat=(255, 196, 36), blush=(220, 130, 100),
        top=(255, 140, 40), sleeve=(66, 104, 176), trim=(66, 104, 176), cuff=(255, 138, 40), collar=(66, 104, 176), glove=(138, 146, 160),
        pants=(66, 104, 176), seam=(255, 138, 40), shoe=(74, 80, 96), toe=(255, 138, 40), sole=(46, 50, 62), shoe_stripe=(255, 138, 40), knee_pad=(255, 138, 40),
        belt=(80, 64, 50), pockets=True, torso_extra=vest_extras((255, 138, 40), (232, 236, 240)) + [mk.superellipsoid(.075, .1, .04, .4, 14, 8, (90, 70, 52), 40).xf(T(.24, -.3, -.04))]),
    'astronaut': dict(  # Nova - space explorer: white suit, open helmet shell, orange panels
        skin=(222, 178, 146), hair=(40, 30, 40), headgear='helmet', suit=(238, 240, 250), accent=(250, 122, 60), blush=(240, 160, 140),
        top=(238, 240, 250), sleeve=(238, 240, 250), trim=(250, 122, 60), cuff=(250, 122, 60), collar=(250, 122, 60), glove=(240, 242, 250), wrist=(250, 122, 60),
        pants=(232, 234, 246), seam=(250, 122, 60), shoe=(240, 242, 250), toe=(250, 122, 60), sole=(150, 156, 176), shoe_stripe=(250, 122, 60), knee_pad=(250, 122, 60),
        belt=(250, 122, 60), zip=(250, 122, 60),
        torso_extra=[mk.superellipsoid(.16, .22, .09, .4, 18, 10, (150, 156, 176), 90).xf(T(0, .06, .34)),
                     mk.cylinder(.025, .025, .22, 10, (250, 122, 60), 120).xf(T(-.1, -.02, .44) @ Rz(.2)),
                     mk.superellipsoid(.08, .06, .03, .4, 12, 8, (60, 70, 96), 200).xf(T(0, .22, -.215)),
                     mk.ellipsoid(.018, .018, .01, 8, 6, (120, 255, 200), 255).xf(T(-.03, .22, -.245)),
                     mk.ellipsoid(.018, .018, .01, 8, 6, (255, 120, 120), 255).xf(T(.03, .22, -.245))]),
    'neon': dict(  # Flux - after-dark runner: neon spikes, shades, glowing streetwear
        skin=(176, 124, 98), hair=(110, 255, 214), accent=(190, 140, 255), headgear='spikes', mouth=(120, 40, 60), blush=(190, 120, 120),
        top=(30, 32, 48), sleeve=(30, 32, 48), trim=(190, 140, 255), cuff=(110, 255, 214), collar=(190, 140, 255), zip=(190, 140, 255), pockets=True,
        wrist=(110, 255, 214), hem=(190, 140, 255),
        pants=(38, 42, 62), seam=(110, 255, 214), shoe=(30, 32, 48), toe=(110, 255, 214), sole=(190, 140, 255), shoe_stripe=(110, 255, 214), lace=(110, 255, 214),
        torso_extra=[mk.box(.52, .035, .05, (110, 255, 214), 255).xf(T(0, .22, 0)), mk.box(.52, .035, .05, (190, 140, 255), 255).xf(T(0, .12, 0)),
                     mk.tube([(-.2, .43, .06), (-.24, .1, .12), (-.2, -.3, .12)], .016, 8, (110, 255, 214), 255),
                     mk.tube([(.2, .43, .06), (.24, .1, .12), (.2, -.3, .12)], .016, 8, (190, 140, 255), 255)]),
}


def to_js(characters):
    out = {}
    for style, meshes in characters.items():
        bones = []
        for i, (name, parent, pivot) in enumerate(BONES):
            m = meshes.get(i)
            bones.append({'name': name, 'parent': parent, 'p': list(pivot), 'r': [0, 0, 0], 's': [1, 1, 1],
                          'mesh': m.pack() if m is not None and len(m) else {'count': 0, 'data': ''}})
        out[style] = {'bones': bones}
    return out


def turned_fox():
    """The shipped fox mesh faces +z while every runner animation assumes the front is -z, so Fenn ran
    towards the camera.  Rotate the baked geometry (and bone pivots) 180 degrees about Y, offline."""
    import base64
    src = open(os.path.join(os.path.dirname(OUT), 'fox.js'), encoding='utf8').read()
    start = src.index('characters.fox=') + len('characters.fox=')
    fox = json.loads(src[start:src.rindex('};') + 1])
    for bone in fox['bones']:
        bone['p'] = [-bone['p'][0], bone['p'][1], -bone['p'][2]]
        mesh = bone['mesh']
        if not mesh['count']:
            continue
        a = np.frombuffer(base64.b64decode(mesh['data']), dtype=[('p', '<i2', 3), ('n', '<i2', 3), ('c', 'u1', 4)]).copy()
        for key in ('p', 'n'):
            a[key][:, 0] = -a[key][:, 0]
            a[key][:, 2] = -a[key][:, 2]
        mesh['data'] = base64.b64encode(a.tobytes()).decode('ascii')
    return fox


def main():
    mk.QUALITY = float(os.environ.get('RUNNER_QUALITY', '0.72'))
    chars = {style: build_character(spec) for style, spec in CAST.items()}
    payload = to_js(chars)
    stats = {s: sum(b['mesh']['count'] for b in c['bones']) for s, c in payload.items()}
    payload['fox'] = turned_fox()
    body = ''.join('C.%s=%s;' % (s, json.dumps(c, separators=(',', ':'))) for s, c in payload.items())
    js = ('/* Polished cartoon human runners (generated by tools/build_human_runners.py).\n'
          ' * Same 13-bone rig and pivots as the original runners.  Fenn the fox keeps his original model but is\n'
          ' * turned 180 degrees so he faces the way he runs (fox.js itself is unchanged). */\n'
          '(function(){var R=window.RUNNER_MODELS;if(!R||!R.characters)return;var C=R.characters;%s})();\n') % body
    with open(OUT, 'w', encoding='utf8') as f:
        f.write(js)
    print('wrote', os.path.relpath(OUT), '%.2f MB' % (len(js) / 1e6), stats)


if __name__ == '__main__':
    main()
