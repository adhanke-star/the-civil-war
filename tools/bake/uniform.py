# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 2 of the bake: dress the MPFB body (work/body.blend) as a first-pass Union infantry
# private, Western theater, 1862, and save work/soldier.blend.
#
# Garments are shells offset from the body and skinned with the body's own bone weights;
# kit is built from primitives; every number lives in the table below.
#
# HISTORY STATUS: everything in this table is Inferred or a placeholder estimate. Nothing here
# is Verified (the project needs two independent sources first, AGENTS.md section 3). The
# rifle-musket figures are the commonly quoted Model 1861 Springfield numbers, recalled, not
# yet cited. Colours are judged by eye for a painted-miniature look, not matched to swatches.
#
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/uniform.py -- --out .out/bake

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

# =====================================================================================
# THE TABLE. Metres and sRGB hex. basis: "Inferred" = commonly stated, needs 2 sources;
# "placeholder" = an estimate made for this probe with no source at all.
# =====================================================================================
D = {
    # -- garment fit (offsets from the skin) ----------------------------------- basis
    "coat_offset_torso":   0.017,   # sack coat sits loose on the torso       placeholder
    "coat_offset_sleeve":  0.011,   # looser than skin, tighter than torso     placeholder
    "coat_waist_above_hip": 0.125,  # belt line above the hip joints           placeholder
    "coat_hem_below_hip":  0.16,    # four-button sack coat to upper thigh     placeholder
    "coat_hem_flare":      0.028,   # extra radius at the hem                  placeholder
    "trouser_offset":      0.016,   # kersey trousers, loose-ish               placeholder
    "shoe_offset":         0.008,   # brogan leather over the foot             placeholder
    "collar_above_neck":   0.03,    # coat collar line above the neck joint   placeholder
    "shoe_top_above_ankle": 0.055,  # ankle-high bootee                        placeholder
    "cloth_thickness":     0.004,   # solidify thickness of all cloth          placeholder
    "smooth_iterations":   8,       # Taubin passes that iron out anatomy      placeholder
    # -- garment cut (second pass: a loose sack coat and straight-cut trousers) ----------
    "armpit_below_shoulder": 0.10,  # armpit level below the shoulder joint     placeholder
    "chest_below_armpit":  0.04,    # the coat hangs straight down from here   placeholder
    "coat_hang_taper":     0.05,    # hanging radius shrinks 5% chest->belt    placeholder
    "sleeve_r_top":        0.066,   # sleeve radius below the armhole          placeholder
    "sleeve_r_cuff":       0.049,   # sleeve radius at the cuff                placeholder
    "cuff_len":            0.06,    # cuff band (a turned edge, no buttons)    placeholder
    "crotch_below_hip":    0.07,    # trouser crotch below the hip joints      placeholder
    "trouser_r_thigh":     0.090,   # straight-cut leg radius at the crotch    placeholder
    "trouser_r_hem":       0.077,   # leg radius at the hem (~48 cm round)     placeholder
    "trouser_lateral":     0.86,    # legs hang flatter side to side           placeholder
    "hem_below_ankle":     0.004,   # hem height under the ankle joint         placeholder
    "hem_break_front":     0.030,   # extra drop at the front: breaks on the shoe placeholder
    "hem_break_back":      0.012,   #                                          placeholder
    "collar_stand":        0.026,   # turned-down collar: stand height         placeholder
    "collar_fall":         0.028,   # fall height (folds down outward)         placeholder
    "collar_gap_deg":      42.0,    # opening at the throat                    placeholder
    "front_edge_offset":   0.016,   # overlapping front edge, wearer's right of the buttons placeholder
    # -- folds (metres of displacement; placeholder, judged by eye) ---------------------
    "fold_elbow":          0.0075,
    "fold_wrist":          0.0045,
    "fold_upperarm":       0.0025,
    "fold_knee":           0.0070,
    "fold_hem":            0.0060,
    "fold_drape":          0.0040,
    "fold_seat":           0.0040,
    "fold_pleat":          0.0060,  # radiating from the waist belt
    "fold_drag":           0.0040,  # diagonal drag folds on the back
    "fold_lumps":          0.0030,  # low-frequency unevenness everywhere
    "fold_skirt":          0.0060,
    # -- belts and straps ------------------------------------------------------
    "waist_belt_width":    0.048,   # ~1.9 in black leather waist belt         Inferred
    "cartridge_belt_width": 0.057,  # ~2.25 in shoulder belt                   Inferred
    "sling_strap_width":   0.035,   # haversack / canteen straps               placeholder
    "strap_thickness":     0.004,   #                                          placeholder
    "belt_plate":          (0.088, 0.054),  # oval "US" plate w x h            Inferred
    "breast_plate_d":      0.064,   # round eagle plate on the cartridge belt  Inferred
    "button_d":            0.016,   # coat button diameter                     placeholder
    "button_count":        4,       # four-button sack coat                    Inferred
    # -- kit ----------------------------------------------------------------------
    "cartridge_box":       (0.19, 0.14, 0.055),  # w h d                        placeholder
    "cap_pouch":           (0.08, 0.08, 0.035),  #                              placeholder
    "haversack":           (0.30, 0.28, 0.05),   #                              placeholder
    "canteen_d":           0.19,    # smoothside canteen diameter              placeholder
    "canteen_t":           0.065,   # canteen thickness                        placeholder
    "scabbard":            (0.045, 0.52, 0.02),  # bayonet scabbard w l t       placeholder
    "blanket_roll_r":      0.038,   # radius of the horseshoe roll             placeholder
    # -- headgear -------------------------------------------------------------
    "cap_band_h":          0.045,   # forage cap band                          placeholder
    "cap_crown_back":      0.085,   # crown rise above band at the back        placeholder
    "cap_crown_front":     0.045,   # crown rise above band at the front       placeholder
    "cap_crown_forward":   0.055,   # how far the floppy crown slumps forward  placeholder
    "cap_visor":           0.050,   # visor depth                              placeholder
    "slouch_crown_h":      0.105,   # slouch hat crown                         placeholder
    "slouch_brim":         0.075,   # brim width                               placeholder
    # -- rifle-musket (Model 1861 pattern) -------------------------------------------
    "musket_length":       1.422,   # 56 in overall                            Inferred
    "barrel_length":       1.016,   # 40 in barrel                             Inferred
    "bayonet_blade":       0.457,   # 18 in triangular socket bayonet blade    Inferred
    "barrel_bands_z":      (0.62, 0.92, 1.18),  # band stations from the heel   placeholder
    "stock_tip_z":         1.22,    # forestock ends short of the muzzle       placeholder
}

COL = {
    # name          sRGB hex   roughness  note (all placeholder colours judged by eye)
    "coat":        ("#1d2540", 0.92),   # dark (indigo) blue wool flannel sack coat
    "cap":         ("#1b2238", 0.90),   # dark blue forage cap, a shade darker
    "trousers":    ("#7d93ad", 0.92),   # sky-blue kersey
    "leather":     ("#121110", 0.40),   # blackened leather belts and boxes
    "brogans":     ("#16120f", 0.55),   # black rough-out / blacked brogans
    "haversack":   ("#1e1d1a", 0.65),   # tarred black canvas
    "canteen":     ("#6c6355", 0.95),   # grey-brown wool canteen cover
    "webbing":     ("#a99d80", 0.90),   # natural cotton canteen strap
    "blanket":     ("#6e665a", 0.95),   # grey-brown wool blanket
    "felt":        ("#151413", 0.85),   # black felt slouch hat
    "wood":        ("#4a2c18", 0.45),   # oiled black walnut stock
    "steel":       ("#8e9297", 0.32),   # bright (unblued) iron and steel
    "brass":       ("#b08a3e", 0.35),   # belt plates and buttons
}

T = C.Timer()
REP = {"table": {k: v for k, v in D.items()}, "colours": COL, "objects": {}}


# Weathering colours (placeholder, judged by eye): faded indigo goes greyer and lighter; dust is
# a light tan; mud a dark brown.
FADE = {"coat": "#3a4560", "cap": "#363f58", "trousers": "#9aa9bb", "blanket": "#8a8272",
        "canteen": "#857c6c", "felt": "#3a3631", "webbing": "#c2b89c", "haversack": "#3a3832"}


def mats():
    m = {}
    for k, (hexc, rough) in COL.items():
        name = "tcw_" + k
        if k in ("coat", "cap", "trousers", "blanket", "canteen", "felt"):
            m[k] = C.weathered_material(name, hexc, rough, kind="wool", fade_hex=FADE.get(k), fade=0.55,
                                        mottle=0.09, sheen=0.55, weave_scale=330.0, bump=0.35)
        elif k in ("webbing", "haversack"):
            m[k] = C.weathered_material(name, hexc, rough, kind="canvas", fade_hex=FADE.get(k), fade=0.4,
                                        mottle=0.10, weave_scale=420.0, bump=0.3)
        elif k in ("leather", "brogans"):
            m[k] = C.weathered_material(name, hexc, rough, kind="leather", mottle=0.12, bump=0.25,
                                        edge_wear_hex="#4a3a2c")
        elif k == "wood":
            m[k] = C.weathered_material(name, hexc, rough, kind="wood", mottle=0.10, bump=0.15,
                                        edge_wear_hex="#6b4428")
        else:  # steel, brass
            m[k] = C.weathered_material(name, hexc, rough, kind="metal", mottle=0.06, metallic=1.0,
                                        bump=0.05, dust_hex="#7a6e58")
    return m


# ------------------------------------------------------------------------------ body data

def rest_geometry(body, rig):
    """Rest-pose positions and normals of every basemesh vertex (shape keys applied, helpers kept)."""
    rig.data.pose_position = "REST"
    masks = [m for m in body.modifiers if m.type == "MASK"]
    for m in masks:
        m.show_viewport = False
    C.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    if len(me.vertices) != len(body.data.vertices):
        raise RuntimeError("evaluated vertex count %d != base %d (modifiers %s)" % (
            len(me.vertices), len(body.data.vertices), [(x.name, x.type) for x in body.modifiers]))
    co = [v.co.copy() for v in me.vertices]
    nrm = [v.normal.copy() for v in me.vertices]
    ev.to_mesh_clear()
    for m in masks:
        m.show_viewport = True
    rig.data.pose_position = "POSE"
    C.update()
    return co, nrm


def region_of(bone):
    if bone is None:
        return "other"
    b = bone
    if b.startswith(("finger", "metacarpal", "wrist")):
        return "hand"
    if b.startswith(("lowerarm", "upperarm", "shoulder")):
        return "arm"
    if b.startswith(("clavicle", "spine", "breast")):
        return "torso"
    if b.startswith(("root", "pelvis")):
        return "hip"
    if b.startswith("upperleg"):
        return "thigh"
    if b.startswith("lowerleg"):
        return "shin"
    if b.startswith(("foot", "toe")):
        return "foot"
    if b.startswith("neck"):
        return "neck"
    return "head"


def vertex_info(body, rig):
    bones = set(b.name for b in rig.data.bones)
    gi = {g.index: g.name for g in body.vertex_groups}
    bg = body.vertex_groups.get("body")
    if bg is None:
        raise RuntimeError("basemesh has no 'body' vertex group; groups: %s" % list(gi.values())[:40])
    info = []
    for v in body.data.vertices:
        is_body, best, bw, ws = False, None, 0.0, {}
        for g in v.groups:
            if g.group == bg.index:
                is_body = g.weight > 0.5
                continue
            n = gi.get(g.group)
            if n in bones and g.weight > 0.0:
                ws[n] = g.weight
                if g.weight > bw:
                    best, bw = n, g.weight
        info.append((is_body, best, ws))
    return info


def landmarks(rig, rm):
    bones = rig.data.bones
    mw = rig.matrix_world

    def h(n):
        return mw @ bones[n].head_local

    def t(n):
        return mw @ bones[n].tail_local

    L_, R_ = rm["side"]["L"], rm["side"]["R"]
    U = Vector((0, 0, 1))
    Lv = h(L_["upper"][0]) - h(R_["upper"][0])
    Lv.z = 0
    Lv.normalize()
    F = Lv.cross(U).normalized()
    ff = (t(L_["foot"]) - h(L_["foot"])) + (t(R_["foot"]) - h(R_["foot"]))
    ff.z = 0
    if ff.length > 0 and ff.normalized().dot(F) < 0:
        C.log("WARNING: foot direction disagrees with L x U; flipping F")
        F = -F
    lm = {
        "F": F, "L": Lv, "U": U,
        "hipL": h(L_["thigh"][0]), "hipR": h(R_["thigh"][0]),
        "shL": h(L_["upper"][0]), "shR": h(R_["upper"][0]),
        "ankL": h(L_["foot"]), "ankR": h(R_["foot"]),
        "neck": h(rm["neck"][0]), "headb": h(rm["head"]),
        "elbowL": h(L_["lower"][0]), "elbowR": h(R_["lower"][0]),
        "wristL": h(L_["hand"]), "wristR": h(R_["hand"]),
        "kneeL": h(L_["shin"][0]), "kneeR": h(R_["shin"][0]),
    }
    lm["hip_c"] = (lm["hipL"] + lm["hipR"]) / 2
    lm["hip_z"] = lm["hip_c"].z
    lm["ankle_z"] = (lm["ankL"].z + lm["ankR"].z) / 2
    lm["mid"] = Vector((lm["hip_c"].x, lm["hip_c"].y, 0.0))
    for eye in ("eye.L", "eye.R"):
        if eye in bones:
            lm.setdefault("eyes", []).append(h(eye))
    return lm


# ------------------------------------------------------------------------------ shells

def taubin(bm, iters):
    if iters <= 0:
        return
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    P = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    E = np.array([(e.verts[0].index, e.verts[1].index) for e in bm.edges], dtype=np.int64)
    if len(E) == 0:
        return
    deg = np.bincount(E.ravel(), minlength=len(P)).astype(np.float64)
    fixed = np.array([v.is_boundary for v in bm.verts])

    def lap(P):
        S = np.zeros_like(P)
        np.add.at(S, E[:, 0], P[E[:, 1]])
        np.add.at(S, E[:, 1], P[E[:, 0]])
        return S / np.maximum(deg, 1.0)[:, None] - P

    for _ in range(iters):
        for lam in (0.5, -0.53):
            Dl = lap(P)
            Dl[fixed] = 0.0
            P += lam * Dl
    for v, p in zip(bm.verts, P):
        v.co = Vector(p.tolist())


def make_shell(name, body, rig, rest, nrm, keep, offset_of, mat, iters, solid, shaper=None, cuts=1, subdiv=1):
    """A garment shell: the body surface offset along its normals, cut to `keep`, ironed (Taubin),
    subdivided once so folds have vertices to live on, then reshaped by `shaper` (looser cut,
    folds; it returns the weathering attributes). Bone weights come with the copied body mesh
    and are interpolated by the subdivision."""
    sh = body.copy()
    sh.data = body.data.copy()
    sh.name = name
    sh.data.name = name
    C.link(sh)
    sh.shape_key_clear()
    flat = []
    for i, p in enumerate(rest):
        q = p + nrm[i] * offset_of(i)
        flat.extend((q.x, q.y, q.z))
    sh.data.vertices.foreach_set("co", flat)
    sh.data.update()
    bm = bmesh.new()
    bm.from_mesh(sh.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
    taubin(bm, iters)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True, smooth=0.0)
        taubin(bm, 2)
    bm.normal_update()
    bm.verts.ensure_lookup_table()
    MW = sh.matrix_world.copy()
    MWi = MW.inverted()
    Pw = np.array([(MW @ v.co)[:] for v in bm.verts])
    Nw = np.array([(MW.to_3x3() @ v.normal).normalized()[:] for v in bm.verts])
    boundary = np.array([v.is_boundary for v in bm.verts])
    attrs = {}
    if shaper is not None:
        Pw, attrs = shaper(Pw, Nw, boundary)
        for v, p in zip(bm.verts, Pw):
            v.co = MWi @ Vector(p.tolist())
    pos = [Vector(p.tolist()) for p in Pw]
    bm.to_mesh(sh.data)
    bm.free()
    # any vertex the subdivision left without weights copies its nearest weighted neighbour
    dv = [len([g for g in v.groups if g.weight > 1e-4]) for v in sh.data.vertices]
    bad = [i for i, n in enumerate(dv) if n == 0]
    if bad:
        good = [i for i, n in enumerate(dv) if n > 0]
        kd = KDTree(len(good))
        for j, i in enumerate(good):
            kd.insert(sh.data.vertices[i].co, j)
        kd.balance()
        for i in bad:
            _co, j, _d = kd.find(sh.data.vertices[i].co)
            for g in sh.data.vertices[good[j]].groups:
                sh.vertex_groups[g.group].add([i], g.weight, "REPLACE")
    REP.setdefault("weightless_after_subdiv", {})[name] = len(bad)
    C.stamp_attrs(sh, rest=pos, dirt=attrs.get("dirt"), wear=attrs.get("wear"), cavity=attrs.get("cavity"))
    sh.data.polygons.foreach_set("use_smooth", [True] * len(sh.data.polygons))
    for m in list(sh.modifiers):
        if m.type != "ARMATURE":
            sh.modifiers.remove(m)
    if not any(m.type == "ARMATURE" for m in sh.modifiers):
        C.add_modifier(sh, "ARMATURE", "Armature", object=rig)
    C.add_modifier(sh, "SOLIDIFY", "Cloth", thickness=solid, offset=-1.0, use_even_offset=False)
    if subdiv:
        C.add_modifier(sh, "SUBSURF", "Smooth", levels=0, render_levels=subdiv)
    for k in list(sh.keys()):
        del sh[k]
    C.assign(sh, mat)
    REP["objects"][name] = {"verts": len(sh.data.vertices), "faces": len(sh.data.polygons)}
    return sh, pos


# ------------------------------------------------------------------------------ garment shape

class Outline:
    """Convex outer outline of a point cloud in a horizontal slice, as radius(theta) about a
    centre. theta = 0 points along F (front), +pi/2 along L (the wearer's left)."""

    def __init__(self, cloud, z, F, Lv, band=0.012, bins=72, centre=None):
        sel = cloud[np.abs(cloud[:, 2] - z) < band]
        while len(sel) < 12 and band < 0.08:
            band *= 1.6
            sel = cloud[np.abs(cloud[:, 2] - z) < band]
        if len(sel) < 3:
            raise RuntimeError("outline at z=%.3f has %d points" % (z, len(sel)))
        self.F = np.array([F.x, F.y])
        self.L = np.array([Lv.x, Lv.y])
        self.c = np.array(centre[:2]) if centre is not None else sel[:, :2].mean(axis=0)
        rel = sel[:, :2] - self.c
        th = np.arctan2(rel @ self.L, rel @ self.F)
        r = np.hypot(rel[:, 0], rel[:, 1])
        b = ((th + math.pi) / (2 * math.pi) * bins).astype(int) % bins
        rad = np.zeros(bins)
        np.maximum.at(rad, b, r)
        have = rad > 0
        if not have.all():
            idx = np.arange(bins)
            good = idx[have]
            rad = np.interp(idx, np.concatenate([good - bins, good, good + bins]), np.concatenate([rad[have]] * 3))
        for _ in range(3):
            rad = (np.roll(rad, 1) + 2 * rad + np.roll(rad, -1)) / 4
        for _ in range(20):
            rad = np.maximum(rad, 0.985 * (np.roll(rad, 1) + np.roll(rad, -1)) / 2)
        self.rad = rad
        self.bins = bins
        self.z = z

    def theta(self, xy):
        rel = np.asarray(xy)[..., :2] - self.c
        return np.arctan2(rel @ self.L, rel @ self.F)

    def at(self, th):
        u = (np.asarray(th) + math.pi) / (2 * math.pi) * self.bins - 0.5
        i0 = np.floor(u).astype(int)
        f = u - i0
        return self.rad[i0 % self.bins] * (1 - f) + self.rad[(i0 + 1) % self.bins] * f

    def point(self, th, extra=0.0):
        d = self.F * math.cos(th) + self.L * math.sin(th)
        return self.c + d * (float(self.at(th)) + extra)


class Stack:
    """Outlines every `step` metres between z0 and z1, interpolated in z."""

    def __init__(self, cloud, z0, z1, F, Lv, step=0.01, centre_fn=None):
        n = max(2, int(round((z1 - z0) / step)) + 1)
        self.zs = np.linspace(z0, z1, n)
        self.o = [Outline(cloud, z, F, Lv, centre=(centre_fn(z) if centre_fn else None)) for z in self.zs]

    def get(self, z):
        k = int(np.clip(np.searchsorted(self.zs, z) - 1, 0, len(self.zs) - 2))
        t = float(np.clip((z - self.zs[k]) / (self.zs[k + 1] - self.zs[k]), 0, 1))
        return self.o[k], self.o[k + 1], t

    def centre(self, z):
        a, b, t = self.get(z)
        return a.c * (1 - t) + b.c * t

    def radius(self, z, xy):
        a, b, t = self.get(z)
        c = a.c * (1 - t) + b.c * t
        rel = np.asarray(xy)[:2] - c
        th = math.atan2(float(rel @ a.L), float(rel @ a.F))
        return float(a.at(th)) * (1 - t) + float(b.at(th)) * t, th, c


def nz(p, s):
    return noise.noise(Vector((p[0] * s, p[1] * s, p[2] * s)))


def closest_on_polyline(p, pts):
    best = None
    acc = 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        ab = b - a
        L2 = float(ab @ ab)
        t = float(np.clip((p - a) @ ab / L2, 0, 1))
        q = a + ab * t
        d = float(np.linalg.norm(p - q))
        if best is None or d < best[0]:
            best = (d, q, acc + t * math.sqrt(L2), ab / math.sqrt(L2))
        acc += math.sqrt(L2)
    return best[1], best[2], best[3], acc


class Garments:
    """Reshapes the coat and trouser shells into a loose sack coat and straight-cut trousers,
    adds folds, and returns per-vertex dirt / wear / crease attributes. All amplitudes are in
    the table (placeholder estimates judged by eye)."""

    def __init__(self, lm, body_np, region, body_kd):
        self.lm = lm
        self.F, self.L, self.U = lm["F"], lm["L"], lm["U"]
        self.f2 = np.array([self.F.x, self.F.y, 0.0])
        self.l2 = np.array([self.L.x, self.L.y, 0.0])
        self.region = region
        self.kd = body_kd
        self.mid_l = float(np.array(lm["mid"][:]) @ self.l2)
        self.hip_z = lm["hip_z"]
        self.waist_z = self.hip_z + D["coat_waist_above_hip"]
        self.hem_z = self.hip_z - D["coat_hem_below_hip"]
        self.ankle_z = lm["ankle_z"]
        self.crotch_z = self.hip_z - D["crotch_below_hip"]
        self.sh_z = (lm["shL"].z + lm["shR"].z) / 2
        self.armpit_z = self.sh_z - D["armpit_below_shoulder"]
        self.chest_z = self.armpit_z - D["chest_below_armpit"]
        self.knee_z = (lm["kneeL"].z + lm["kneeR"].z) / 2
        torso = body_np[[i for i, r in enumerate(region) if r in ("torso", "hip")]]
        self.torso = Stack(torso, self.waist_z - 0.06, self.armpit_z + 0.01, self.F, self.L)
        self.arms = {s: [np.array(lm["sh" + s][:]), np.array(lm["elbow" + s][:]), np.array(lm["wrist" + s][:])]
                     for s in ("L", "R")}
        self.legs = {s: (np.array(lm["hip" + s][:]), np.array(lm["ank" + s][:])) for s in ("L", "R")}

    def reg(self, p):
        _co, j, _d = self.kd.find(Vector(p.tolist()))
        return self.region[j] or "other"

    def side(self, p):
        return "L" if float(p @ self.l2) - self.mid_l > 0 else "R"

    # ---------------------------------------------------------------- the coat (torso + sleeves)
    def coat(self, P, N, boundary):
        out = P.copy()
        n = len(P)
        dirt, wear, cav = np.zeros(n), np.zeros(n), np.zeros(n)
        oc = self.torso.get(self.chest_z)[0]
        for i in range(n):
            p = P[i]
            r = self.reg(p)
            z = float(p[2])
            d = 0.0
            if r in ("arm", "hand"):
                s_ = self.side(p)
                q, s, tdir, Ltot = closest_on_polyline(p, self.arms[s_])
                rad = p - q
                rc = float(np.linalg.norm(rad))
                if rc < 1e-6:
                    continue
                ru = rad / rc
                R = D["sleeve_r_top"] + (D["sleeve_r_cuff"] - D["sleeve_r_top"]) * min(1.0, s / Ltot)
                w = C.smoothstep(0.04, 0.12, s)
                rn = rc + w * max(0.0, R - rc)
                if Ltot - s < D["cuff_len"]:
                    rn += 0.0025
                ref = self.f2 - tdir * float(self.f2 @ tdir)
                ref /= max(1e-6, np.linalg.norm(ref))
                th = math.atan2(float(ru @ np.cross(tdir, ref)), float(ru @ ref))
                s_el = float(np.linalg.norm(self.arms[s_][1] - self.arms[s_][0]))
                e = s - s_el
                we = max(0.0, 1.0 - (e / 0.10) ** 2)
                inner = 0.55 + 0.45 * math.cos(th)
                d += D["fold_elbow"] * we * inner * C.crease(e / 0.032 + 0.35 * math.sin(th) + 0.4 * nz(p, 9))
                ew = Ltot - s
                ww = max(0.0, 1.0 - ((ew - 0.08) / 0.07) ** 2)
                d += D["fold_wrist"] * ww * C.crease(s / 0.028 + 0.25 * math.sin(2 * th) + 0.4 * nz(p, 11))
                wu = C.smoothstep(0.08, 0.14, s) * C.smoothstep(s_el - 0.02, s_el - 0.10, s)
                d += D["fold_upperarm"] * wu * math.sin(3 * th + 2.0 * nz(p, 4))
                d += D["fold_lumps"] * nz(p, 7)
                out[i] = q + ru * (rn + d)
                dirt[i] = 0.35 * C.smoothstep(D["cuff_len"] + 0.03, 0.0, ew) + 0.15 * we * inner
                wear[i] = 0.35 * max(0.0, float(N[i][2])) * C.smoothstep(0.25, 0.05, s) + 0.25 * we * (1 - inner)
            elif r in ("torso", "hip", "thigh", "neck") and z >= self.waist_z - 0.04:
                if z <= self.armpit_z:
                    rcon, th, c = self.torso.radius(z, p)
                    rel = p[:2] - c
                    rc = float(np.linalg.norm(rel))
                    if rc < 1e-6:
                        continue
                    ru = np.array([rel[0] / rc, rel[1] / rc, 0.0])
                    # hang straight from the chest; cinched at the belt; blouses just above it
                    k = (self.chest_z - z) / max(1e-3, self.chest_z - self.waist_z)
                    hang = float(oc.at(th)) * (1.0 - D["coat_hang_taper"] * min(1.0, max(0.0, k)))
                    belt = C.smoothstep(0.018, 0.05, abs(z - self.waist_z))
                    target = rcon + belt * max(0.0, hang - rcon) + D["coat_offset_torso"]
                    w = C.smoothstep(self.armpit_z, self.armpit_z - 0.05, z)
                    rn = rc + w * max(0.0, target - rc)
                    eb = z - self.waist_z
                    wb = max(0.0, 1.0 - abs(eb) / 0.09) * C.smoothstep(0.012, 0.03, abs(eb))
                    d += D["fold_pleat"] * wb * math.sin(13 * th + 1.2 * nz(p, 6))
                    bk = max(0.0, -math.cos(th))
                    wd = C.smoothstep(self.waist_z + 0.02, self.waist_z + 0.08, z) * C.smoothstep(self.chest_z + 0.04, self.chest_z - 0.04, z)
                    d += D["fold_drag"] * wd * bk * C.crease((z - self.waist_z) / 0.06 + 1.1 * th)
                    sd = abs(math.sin(th))
                    wa = C.smoothstep(self.chest_z - 0.10, self.armpit_z - 0.01, z) * sd
                    d += 0.6 * D["fold_drag"] * wa * C.crease((self.armpit_z - z) / 0.035 + 0.8 * math.cos(th))
                    d += D["fold_lumps"] * nz(p, 7)
                    out[i] = np.array([c[0], c[1], z]) + ru * (rn + d)
                    cav[i] = max(0.0, -d / 0.006)
                else:
                    out[i] = p + N[i] * (D["fold_lumps"] * 0.6 * nz(p, 7))
                wear[i] = max(wear[i], 0.9 * C.smoothstep(self.sh_z - 0.14, self.sh_z + 0.01, z) * max(0.0, float(N[i][2])) ** 0.5)
            else:
                out[i] = p + N[i] * (D["fold_lumps"] * nz(p, 7))
            if cav[i] == 0.0 and d < 0:
                cav[i] = min(1.0, -d / 0.006)
        return out, {"dirt": dirt, "wear": wear, "cavity": np.clip(cav, 0, 1)}

    # ---------------------------------------------------------------- straight-cut trousers
    def trousers(self, P, N, boundary):
        out = P.copy()
        n = len(P)
        dirt, wear, cav = np.zeros(n), np.zeros(n), np.zeros(n)
        lat = D["trouser_lateral"]
        hem0 = self.ankle_z - D["hem_below_ankle"]
        for i in range(n):
            p = P[i]
            z = float(p[2])
            s_ = self.side(p)
            hip, ank = self.legs[s_]
            t = float(np.clip((hip[2] - z) / (hip[2] - ank[2]), 0, 1))
            ax = hip + (ank - hip) * t
            rel = np.array([p[0] - ax[0], p[1] - ax[1], 0.0])
            rc = float(np.linalg.norm(rel))
            if rc < 1e-6:
                continue
            ru = rel / rc
            th = math.atan2(float(ru @ self.l2), float(ru @ self.f2))
            s = float(np.clip((self.crotch_z - z) / (self.crotch_z - self.ankle_z), 0, 1))
            ell = 1.0 / math.sqrt(math.cos(th) ** 2 + (math.sin(th) / lat) ** 2)
            R = (D["trouser_r_thigh"] + (D["trouser_r_hem"] - D["trouser_r_thigh"]) * s) * ell
            w = C.smoothstep(self.crotch_z, self.crotch_z - 0.10, z)
            rn = rc + w * max(0.0, R - rc)
            front = 0.5 + 0.5 * math.cos(th)
            brk = D["hem_break_back"] + (D["hem_break_front"] - D["hem_break_back"]) * front
            zn = z
            if z < self.ankle_z + 0.05:
                k = C.smoothstep(self.ankle_z + 0.05, self.ankle_z, z)
                zn = z - brk * k
                rn *= 1.0 + 0.03 * k
            if boundary[i] and z < self.knee_z:
                zn = hem0 - brk
            d = 0.0
            ek = z - self.knee_z
            wk = max(0.0, 1.0 - (ek / 0.09) ** 2)
            d += D["fold_knee"] * wk * (0.35 + 0.65 * (1 - front)) * C.crease(ek / 0.04 + 0.4 * math.sin(th) + 0.3 * nz(p, 9))
            eh = z - self.ankle_z
            wh = C.smoothstep(0.22, 0.07, eh) * C.smoothstep(-0.01, 0.02, eh)
            d += D["fold_hem"] * wh * (0.4 + 0.6 * front) * C.crease(eh / 0.034 + 0.5 * math.sin(th) + 0.35 * nz(p, 10))
            wv = C.smoothstep(self.knee_z + 0.18, self.knee_z, z) * C.smoothstep(self.ankle_z + 0.02, self.ankle_z + 0.12, z)
            d += D["fold_drape"] * wv * math.sin(4 * th + 1.5 * nz(p, 3))
            es = z - (self.crotch_z - 0.02)
            ws = max(0.0, 1.0 - (es / 0.05) ** 2) * max(0.0, -math.cos(th))
            d += D["fold_seat"] * ws * C.crease(es / 0.025 + 0.6 * math.sin(2 * th))
            d += D["fold_lumps"] * nz(p, 7)
            out[i] = np.array([ax[0], ax[1], 0.0]) + ru * (rn + d) + np.array([0.0, 0.0, zn])
            dirt[i] = C.smoothstep(self.knee_z + 0.06, self.ankle_z - 0.02, z) ** 1.3 + 0.3 * wk * front
            wear[i] = 0.5 * wk * front + 0.4 * ws
            cav[i] = max(0.0, -d / 0.006)
        return out, {"dirt": np.clip(dirt, 0, 1), "wear": np.clip(wear, 0, 1), "cavity": np.clip(cav, 0, 1)}


# ------------------------------------------------------------------------------ skinning

class Skinner:
    """Copies bone weights from the k nearest body vertices (inverse-distance blend)."""

    def __init__(self, rig, rest_world, info, regions):
        self.rig = rig
        self.info = info
        self.idx = [i for i, (b, bone, ws) in enumerate(info) if b and region_of(bone) in regions]
        self.kd = KDTree(len(self.idx))
        for j, i in enumerate(self.idx):
            self.kd.insert(rest_world[i], j)
        self.kd.balance()

    def apply(self, obj, k=8):
        me = obj.data
        groups = {}
        for v in me.vertices:
            acc = {}
            for (_co, j, dist) in self.kd.find_n(obj.matrix_world @ v.co, k):
                w = 1.0 / (dist + 0.01)
                for bone, bw in self.info[self.idx[j]][2].items():
                    acc[bone] = acc.get(bone, 0.0) + w * bw
            tot = sum(acc.values()) or 1.0
            for bone, w in acc.items():
                if w / tot > 0.02:
                    groups.setdefault(bone, []).append((v.index, w / tot))
        for bone, lst in groups.items():
            vg = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            for vi, w in lst:
                vg.add([vi], w, "REPLACE")
        mw = obj.matrix_world.copy()
        obj.parent = self.rig
        obj.matrix_parent_inverse = self.rig.matrix_world.inverted()
        obj.matrix_basis = mw
        # callers add Solidify/Subsurf AFTER this, so the Armature modifier stays first
        C.add_modifier(obj, "ARMATURE", "Armature", object=self.rig)
        return obj


# ------------------------------------------------------------------------------ sections

def section_loop(cloud, center, normal, ref, band=0.015, bins=48, pad=0.0, smooth=3, convex=True):
    """Outer outline of the point cloud where it crosses a plane, as `bins` points + outward dirs."""
    normal = normal.normalized()
    ref = (ref - normal * ref.dot(normal)).normalized()
    w = normal.cross(ref).normalized()
    P = cloud
    c = np.array(center[:])
    n = np.array(normal[:])
    d = P - c
    dist = d @ n
    sel = d[np.abs(dist) < band]
    if len(sel) < 8:
        raise RuntimeError("section has only %d points" % len(sel))
    sel = sel - np.outer(sel @ n, n)
    x = sel @ np.array(ref[:])
    y = sel @ np.array(w[:])
    ang = np.arctan2(y, x)
    r = np.hypot(x, y)
    b = ((ang + math.pi) / (2 * math.pi) * bins).astype(int) % bins
    rad = np.zeros(bins)
    np.maximum.at(rad, b, r)
    have = rad > 0
    if not have.all():
        idx = np.arange(bins)
        good = idx[have]
        rad = np.interp(idx, np.concatenate([good - bins, good, good + bins]),
                        np.concatenate([rad[have]] * 3))
    for _ in range(smooth):
        rad = (np.roll(rad, 1) + 2 * rad + np.roll(rad, -1)) / 4
    if convex:
        for _ in range(20):
            rad = np.maximum(rad, 0.985 * (np.roll(rad, 1) + np.roll(rad, -1)) / 2)
    rad = [float(x) for x in rad]
    pts, outs = [], []
    for i in range(bins):
        a = -math.pi + (i + 0.5) * 2 * math.pi / bins
        o = ref * math.cos(a) + w * math.sin(a)
        pts.append(center + o * (rad[i] + pad))
        outs.append(o)
    return pts, outs, w


def ribbon(name, pts, outs, across, width, mat, skinner, k=8, thick=None):
    n = len(pts)
    verts = []
    for p in pts:
        verts.append(p - across * (width / 2))
        verts.append(p + across * (width / 2))
    faces = [(2 * i, 2 * ((i + 1) % n), 2 * ((i + 1) % n) + 1, 2 * i + 1) for i in range(n)]
    obj = C.mesh_object(name, verts, faces)
    C.assign(obj, mat)
    skinner.apply(obj, k)
    C.add_modifier(obj, "SOLIDIFY", "Thick", thickness=thick or D["strap_thickness"], offset=0.0)
    REP["objects"][name] = {"verts": len(verts)}
    return obj


def tube_along(name, pts, outs, across, radius, mat, skinner, seg=10, k=12):
    n = len(pts)
    rings = []
    for i in range(n):
        c = pts[i] + outs[i] * (radius * 0.8)   # squashed against the body
        rings.append(C.ring(c, outs[i], across, radius * 0.8, radius * 1.1, seg))
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for i in range(n):
        a, b = i * seg, ((i + 1) % n) * seg
        for j in range(seg):
            jj = (j + 1) % seg
            faces.append((a + j, a + jj, b + jj, b + j))
    obj = C.mesh_object(name, verts, faces)
    C.assign(obj, mat)
    skinner.apply(obj, k)
    C.add_modifier(obj, "SUBSURF", "Smooth", levels=0, render_levels=1)
    REP["objects"][name] = {"verts": len(verts)}
    return obj


def rigid(name, verts, faces, mat, rig, bone, smooth=False, bevel=0.0):
    obj = C.mesh_object(name, verts, faces, smooth=smooth)
    if bevel > 0:
        C.add_modifier(obj, "BEVEL", "Bevel", width=bevel, segments=2, limit_method="ANGLE")
    C.assign(obj, mat)
    C.parent_to_bone(obj, rig, bone)
    REP["objects"][name] = {"verts": len(verts), "bone": bone}
    return obj


# ------------------------------------------------------------------------------ the musket

def build_musket(m):
    """Local frame: heel of the butt at the origin, +Z toward the muzzle, +Y = sights up,
    -X = the lock (right) side."""
    Z = Vector((0, 0, 1))
    X = Vector((1, 0, 0))
    Y = Vector((0, 1, 0))
    prof = [  # z, height, width, centre-y   (all placeholder estimates of an M1861 stock)
        (0.000, 0.115, 0.042, -0.050), (0.080, 0.108, 0.042, -0.045), (0.250, 0.062, 0.036, -0.030),
        (0.320, 0.042, 0.032, -0.022), (0.400, 0.050, 0.036, -0.018), (0.500, 0.040, 0.034, -0.014),
        (D["stock_tip_z"], 0.030, 0.028, -0.010)]
    rings = [C.ring(Vector((0, cy, z)), X, Y, w / 2, h / 2, 12) for (z, h, w, cy) in prof]
    sv, sf = C.loft(rings)
    stock = C.mesh_object("tcw_musket", sv, sf)
    C.add_modifier(stock, "SUBSURF", "Smooth", levels=0, render_levels=1)
    C.assign(stock, m["wood"])
    L = D["musket_length"]
    br0 = L - D["barrel_length"] - 0.02
    parts = []
    parts.append(C.loft([C.ring(Vector((0, 0.006, z)), X, Y, r, r, 12) for z, r in
                         ((br0, 0.0145), (br0 + 0.25, 0.013), (L, 0.0105))]))
    for bz in D["barrel_bands_z"]:
        hh = 0.045
        parts.append(C.loft([C.ring(Vector((0, -0.006, bz + dz)), X, Y, 0.019, hh / 2 + 0.004, 12)
                             for dz in (-0.006, 0.006)]))
    parts.append(C.loft([C.ring(Vector((0, -0.050, z)), X, Y, 0.022, 0.060, 12) for z in (-0.004, 0.003)]))
    parts.append(C.box(Vector((-0.020, -0.004, 0.40)), (X, Y, Z), (0.002, 0.012, 0.065)))   # lock plate
    parts.append(C.box(Vector((-0.019, 0.020, 0.37)), (X, Y, Z), (0.004, 0.012, 0.007)))    # hammer
    parts.append(C.box(Vector((0.0, -0.048, 0.34)), (X, Y, Z), (0.003, 0.010, 0.040)))      # trigger guard
    parts.append(C.loft([C.ring(Vector((0, -0.017, z)), X, Y, 0.0045, 0.0045, 6) for z in (0.55, L - 0.005)]))
    parts.append(C.box(Vector((0, 0.019, L - 0.03)), (X, Y, Z), (0.0015, 0.004, 0.006)))     # front sight
    parts.append(C.box(Vector((0, 0.022, br0 + 0.10)), (X, Y, Z), (0.008, 0.006, 0.012)))   # rear sight
    v, f = C.merge(parts)
    steel = C.mesh_object("tcw_musket_steel", v, f, smooth=False)
    C.assign(steel, m["steel"])
    steel.parent = stock
    # sling: sagging leather strap from the middle band to the butt
    sv2, sf2 = [], []
    za, zb = D["barrel_bands_z"][1], 0.22
    for i in range(9):
        t = i / 8
        z = za + (zb - za) * t
        y = -0.06 - 0.06 * math.sin(math.pi * t)
        sv2 += [Vector((-0.012, y, z)), Vector((0.012, y, z))]
    for i in range(8):
        sf2.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
    sling = C.mesh_object("tcw_musket_sling", sv2, sf2)
    C.add_modifier(sling, "SOLIDIFY", "Thick", thickness=0.003)
    C.assign(sling, m["leather"])
    sling.parent = stock
    # socket bayonet (variant): socket, offset neck, triangular blade
    bparts = [C.loft([C.ring(Vector((0, 0.006, z)), X, Y, 0.0165, 0.0165, 12) for z in (L - 0.075, L)])]
    ox, oy = -0.012, -0.024  # blade offset from the bore: placeholder
    bparts.append(C.box(Vector((ox / 2, oy / 2, L - 0.01)), (X, Y, Z), (0.004, 0.016, 0.012)))
    tri = []
    for z, s in ((L + 0.005, 0.011), (L + D["bayonet_blade"], 0.0006)):
        tri.append([Vector((ox + s * math.cos(a), oy + s * math.sin(a), z))
                    for a in (math.pi / 2, math.pi / 2 + 2.094, math.pi / 2 + 4.189)])
    bparts.append(C.loft(tri))
    v, f = C.merge(bparts)
    bay = C.mesh_object("tcw_bayonet", v, f, smooth=False)
    C.assign(bay, m["steel"])
    bay.parent = stock
    bay["tcw_variant"] = "bayonet"
    REP["objects"]["tcw_musket"] = {"length_m": L, "with_bayonet_m": round(L + D["bayonet_blade"], 3)}
    stock.rotation_mode = "QUATERNION"
    return stock


# ------------------------------------------------------------------------------ headgear

def head_ring(cloud_head, lm, z, pad, bins=32):
    U, F = lm["U"], lm["F"]
    c = np.array(cloud_head)
    sel = c[np.abs(c[:, 2] - z) < 0.012]
    centre = Vector(sel.mean(axis=0).tolist()) if len(sel) else lm["headb"]
    centre.z = z
    pts, outs, _w = section_loop(c, centre, U, F, band=0.012, bins=bins, pad=pad, smooth=2)
    return pts, outs, centre


def build_brogan(m, rig, rm, lm, side, sg, shoe_idx, rest_w, info):
    """A convex envelope of the foot, lofted heel to toe: the toes merge into one blunt shoe.
    (A shell offset from the foot kept every toe, even after 40 smoothing passes.)"""
    U = lm["U"]
    mid_x = lm["mid"].dot(lm["L"])
    pts = [rest_w[i] for i in shoe_idx if (rest_w[i].dot(lm["L"]) - mid_x) * sg > 0]
    cloud = np.array([p[:] for p in pts])
    fb = rm["side"][side]["foot"]
    bone = rig.data.bones[fb]
    ax = bone.tail_local - bone.head_local
    ax = Vector((ax.x, ax.y, 0)).normalized()
    proj = cloud @ np.array(ax[:])
    lo, hi = float(proj.min()), float(proj.max())
    origin = Vector(cloud.mean(axis=0).tolist())
    origin -= ax * origin.dot(ax)
    rings = []
    n_st = 12
    for k in range(n_st):
        t = 0.04 + 0.92 * k / (n_st - 1)
        c = origin + ax * (lo + (hi - lo) * t)
        sel = cloud[np.abs(proj - (lo + (hi - lo) * t)) < 0.02]
        if len(sel) < 8:
            continue
        cc = Vector(sel.mean(axis=0).tolist())
        cc = cc - ax * (cc.dot(ax)) + ax * c.dot(ax)
        r, _o, _w = section_loop(cloud, cc, ax, U, band=0.02, bins=24, pad=D["shoe_offset"], smooth=2)
        rings.append([Vector((p.x, p.y, max(p.z, 0.0))) for p in r])
    v, f = C.loft(rings)
    obj = C.mesh_object("tcw_brogan_" + side, v, f)
    C.assign(obj, m["brogans"])
    C.stamp_attrs(obj, dirt=0.75, wear=0.4)
    Skinner(rig, rest_w, info, ("foot", "shin")).apply(obj, k=12)
    C.add_modifier(obj, "SUBSURF", "Smooth", levels=0, render_levels=2)
    REP["objects"][obj.name] = {"verts": len(v), "rings": len(rings)}
    return obj


def build_cap(m, rig, rm, lm, head_cloud, brow_z):
    F, U = lm["F"], lm["U"]
    base, outs, centre = head_ring(head_cloud, lm, brow_z + 0.01, 0.007)
    base = [p - U * 0.01 for p in base]
    front = [max(-1.0, min(1.0, o.dot(F))) for o in outs]
    r0 = [p.copy() for p in base]
    r1 = [p + U * D["cap_band_h"] for p in base]
    r2, r3 = [], []
    for p, o, fr in zip(base, outs, front):
        rise = D["cap_band_h"] + (D["cap_crown_back"] * (1 - fr) + D["cap_crown_front"] * (1 + fr)) / 2
        q = centre + (p - centre) * 1.04
        r2.append(Vector((q.x, q.y, p.z)) + U * (D["cap_band_h"] + 0.55 * (rise - D["cap_band_h"]))
                  + F * (0.45 * D["cap_crown_forward"]))
        q = centre + (p - centre) * 0.86
        r3.append(Vector((q.x, q.y, p.z)) + U * rise + F * D["cap_crown_forward"])
    v, f = C.loft([r0, r1, r2, r3], cap_start=False, cap_end=True)
    cap = C.mesh_object("tcw_cap", v, f)
    C.add_modifier(cap, "SOLIDIFY", "Thick", thickness=0.003, offset=1.0)
    C.add_modifier(cap, "SUBSURF", "Smooth", levels=0, render_levels=1)
    C.assign(cap, m["cap"])
    C.parent_to_bone(cap, rig, rm["head"])
    cap["tcw_variant"] = "cap"
    # visor: the front part of the base ring pushed out and down
    idx = [i for i, fr in enumerate(front) if fr > 0.30]
    idx.sort(key=lambda i: math.atan2(outs[i].dot(lm["L"]), outs[i].dot(F)))
    vv, ff = [], []
    for i in idx:
        p = base[i]
        oh = Vector((outs[i].x, outs[i].y, 0)).normalized()
        depth = D["cap_visor"] * (0.35 + 0.65 * (front[i] - 0.30) / 0.70)
        vv += [p + U * 0.002, p + oh * depth - U * 0.016]
    for j in range(len(idx) - 1):
        ff.append((2 * j, 2 * j + 2, 2 * j + 3, 2 * j + 1))
    visor = C.mesh_object("tcw_cap_visor", vv, ff)
    C.add_modifier(visor, "SOLIDIFY", "Thick", thickness=0.004)
    C.assign(visor, m["leather"])
    C.parent_to_bone(visor, rig, rm["head"])
    visor["tcw_variant"] = "cap"
    return cap


def build_slouch(m, rig, rm, lm, head_cloud, brow_z):
    F, U, Lv = lm["F"], lm["U"], lm["L"]
    base, outs, centre = head_ring(head_cloud, lm, brow_z + 0.012, 0.008)
    base = [p - U * 0.008 for p in base]
    r1 = [Vector((q.x, q.y, base[0].z + D["slouch_crown_h"] * 0.85)) for q in
          [centre + (p - centre) * 0.97 for p in base]]
    r2 = [Vector((q.x, q.y, base[0].z)) + U * D["slouch_crown_h"] for q in
          [centre + (p - centre) * 0.72 for p in base]]
    v, f = C.loft([base, r1, r2], cap_start=False, cap_end=False)
    # dented top: a lowered centre fan
    c = len(v)
    v.append(Vector((centre.x, centre.y, base[0].z)) + U * (D["slouch_crown_h"] - 0.025))
    n = len(base)
    for i in range(n):
        f.append((c, 2 * n + i, 2 * n + (i + 1) % n))
    brim_in = [p.copy() for p in base]
    brim_out = []
    for p, o in zip(base, outs):
        oh = Vector((o.x, o.y, 0)).normalized()
        fr, sd = o.dot(F), o.dot(Lv)
        brim_out.append(p + oh * D["slouch_brim"] - U * (0.016 * fr * fr + 0.004) + U * 0.006 * sd * sd)
    bv, bf = C.loft([brim_in, brim_out], cap_start=False, cap_end=False)
    v2, f2 = C.merge([(v, f), (bv, bf)])
    hat = C.mesh_object("tcw_slouch", v2, f2)
    C.add_modifier(hat, "SOLIDIFY", "Thick", thickness=0.004, offset=1.0)
    C.add_modifier(hat, "SUBSURF", "Smooth", levels=0, render_levels=1)
    C.assign(hat, m["felt"])
    C.parent_to_bone(hat, rig, rm["head"])
    hat["tcw_variant"] = "slouch"
    hat.hide_render = True
    return hat


# ------------------------------------------------------------------------------ main

def main():
    path = os.path.join(C.WORK, "body.blend")
    bpy.ops.wm.open_mainfile(filepath=path)
    T.mark("open body.blend")
    rig, body, rm = C.find_rig(), C.find_body(), C.rigmap()
    m = mats()
    rest, nrm = rest_geometry(body, rig)
    MW = body.matrix_world.copy()
    rest_w = [MW @ p for p in rest]
    info = vertex_info(body, rig)
    lm = landmarks(rig, rm)
    T.mark("rest geometry + weights")
    F, U, Lv = lm["F"], lm["U"], lm["L"]
    hip_z = lm["hip_z"]
    waist_z = hip_z + D["coat_waist_above_hip"]
    hem_z = hip_z - D["coat_hem_below_hip"]
    shoe_top = lm["ankle_z"] + D["shoe_top_above_ankle"]
    region = [region_of(b) if isb else None for (isb, b, _w) in info]
    counts = {}
    for r in region:
        counts[r] = counts.get(r, 0) + 1
    REP["region_counts"] = {str(k): v for k, v in counts.items()}
    REP["landmarks"] = {k: ([round(x, 4) for x in v] if isinstance(v, Vector) else v)
                        for k, v in lm.items() if k != "eyes"}

    coat_set, trouser_set, shoe_set = set(), set(), set()
    collar_z = lm["neck"].z + D["collar_above_neck"]  # a level cut, not the ragged bone-weight edge
    for i, r in enumerate(region):
        if r is None:
            continue
        z = rest_w[i].z
        if (r in ("torso", "neck") and z < collar_z) or r == "arm" or (r in ("hip", "thigh") and z > waist_z - 0.02):
            coat_set.add(i)
        elif r == "foot" or (r == "shin" and z < lm["ankle_z"] + 0.012):
            shoe_set.add(i)   # trousers now reach the ankle and break over the shoe
        elif r in ("hip", "thigh", "shin"):
            trouser_set.add(i)

    def coat_off(i):
        return D["coat_offset_sleeve"] if region[i] == "arm" else D["coat_offset_torso"]

    body_np = np.array([p[:] for p in rest_w])
    body_idx = [i for i, r in enumerate(region) if r is not None]
    body_kd = KDTree(len(body_idx))
    for j, i in enumerate(body_idx):
        body_kd.insert(rest_w[i], j)
    body_kd.balance()
    G = Garments(lm, body_np, [region[i] for i in body_idx], body_kd)
    coat, coat_pos = make_shell("tcw_coat", body, rig, rest, nrm, coat_set, coat_off, m["coat"],
                                D["smooth_iterations"], D["cloth_thickness"], shaper=G.coat)
    trousers, _tp = make_shell("tcw_trousers", body, rig, rest, nrm, trouser_set,
                               lambda i: D["trouser_offset"], m["trousers"], D["smooth_iterations"],
                               D["cloth_thickness"], shaper=G.trousers)
    for side, sg in (("L", 1.0), ("R", -1.0)):
        build_brogan(m, rig, rm, lm, side, sg, [i for i in shoe_set], rest_w, info)
    T.mark("garment shells")

    # coat skirt: hangs from the belt over hips and seat (a running maximum going down: cloth
    # falls straight off the widest point and never comes back in), flares a little, folds
    torso_regions = ("torso", "hip")
    leg_cloud = body_np[[i for i, r in enumerate(region) if r in ("hip", "thigh", "torso")]]
    nb, steps = 96, 12
    hip_o = Outline(leg_cloud, hip_z, F, Lv)
    cen = hip_o.c
    run = None
    rings, ring_attrs = [], []
    angs = [-math.pi + (j + 0.5) * 2 * math.pi / nb for j in range(nb)]
    for k in range(steps + 1):
        t = k / steps
        z = (waist_z + 0.035) * (1 - t) + hem_z * t
        o = Outline(leg_cloud, z, F, Lv, centre=cen)
        r = np.array([float(o.at(a)) for a in angs])
        run = r if run is None else np.maximum(run, r)
        ring = []
        for j, a in enumerate(angs):
            d = D["fold_skirt"] * (t ** 0.7) * math.sin(7 * a + 1.6 * nz((math.cos(a), math.sin(a), z), 2.5))
            d += 0.5 * D["fold_pleat"] * max(0.0, 1 - t / 0.35) * math.sin(13 * a + 1.2 * nz((a, 0, z), 6))
            rr = run[j] + D["coat_offset_torso"] + 0.006 + D["coat_hem_flare"] * t * t + d
            xy = hip_o.c + (hip_o.F * math.cos(a) + hip_o.L * math.sin(a)) * rr
            ring.append(Vector((xy[0], xy[1], z)))
            ring_attrs.append((0.25 * C.smoothstep(0.75, 1.0, t), 0.0, max(0.0, -d / 0.006)))
        rings.append(ring)
    sv, sf = C.loft(rings, cap_start=False, cap_end=False)
    skirt = C.mesh_object("tcw_coat_skirt", sv, sf)
    C.assign(skirt, m["coat"])
    C.stamp_attrs(skirt, dirt=[a[0] for a in ring_attrs], wear=[a[1] for a in ring_attrs],
                  cavity=[min(1.0, a[2]) for a in ring_attrs])
    Skinner(rig, rest_w, info, ("torso", "hip", "thigh")).apply(skirt, k=24)
    C.add_modifier(skirt, "SOLIDIFY", "Cloth", thickness=D["cloth_thickness"], offset=-1.0)
    C.add_modifier(skirt, "SUBSURF", "Smooth", levels=0, render_levels=1)
    T.mark("coat skirt")

    # clothed outline cloud (coat torso + skirt) for belts, straps and the blanket roll
    cloth = [p for p in coat_pos if G.reg(np.array(p[:])) in torso_regions]
    cloth += [p for p in sv]
    cloth_np = np.array([p[:] for p in cloth])

    # turned-down collar, open at the throat
    neck_cloud = body_np[[i for i, r in enumerate(region) if r == "neck"]]
    no = Outline(neck_cloud, collar_z - 0.006, F, Lv, band=0.01)
    gap = math.radians(D["collar_gap_deg"])
    ca = [gap / 2 + (2 * math.pi - gap) * j / 47 for j in range(48)]
    prof = [(-0.012, 0.010), (D["collar_stand"] - 0.008, 0.008), (D["collar_stand"], 0.015),
            (D["collar_stand"] - D["collar_fall"], 0.028)]
    crings = []
    for dz, pad in prof:
        crings.append([Vector((*no.point(a, pad), collar_z + dz)) for a in ca])
    cv, cf = C.loft(crings, closed=False, cap_start=False, cap_end=False)
    collar = C.mesh_object("tcw_collar", cv, cf)
    C.assign(collar, m["coat"])
    C.stamp_attrs(collar, wear=0.4)
    Skinner(rig, rest_w, info, ("torso", "neck")).apply(collar, k=12)
    C.add_modifier(collar, "SOLIDIFY", "Cloth", thickness=0.003, offset=0.0)
    C.add_modifier(collar, "SUBSURF", "Smooth", levels=0, render_levels=1)

    # the overlapping front edge: a raised strip down the centre front, collar to hem
    bvhs = [BVHTree.FromPolygons(coat_pos, [tuple(pp.vertices) for pp in coat.data.polygons]),
            BVHTree.FromPolygons(sv, sf)]
    edge = []
    zz = collar_z - 0.02
    while zz > hem_z + 0.006:
        o = Vector((lm["mid"].x, lm["mid"].y, zz)) - Lv * D["front_edge_offset"] + F * 1.0
        hits = [b.ray_cast(o, -F) for b in bvhs]
        hits = [h for h in hits if h[0] is not None]
        if hits:
            h = min(hits, key=lambda h: h[3])
            edge.append((h[0], h[1]))
        zz -= 0.012
    if len(edge) > 3:
        ev_, ef_ = [], []
        for p, nrm_ in edge:
            q = p + nrm_ * 0.0015
            ev_ += [q - Lv * 0.0035, q + Lv * 0.0035]
        for j in range(len(edge) - 1):
            ef_.append((2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2))
        fe = C.mesh_object("tcw_coat_front_edge", ev_, ef_)
        C.assign(fe, m["coat"])
        C.stamp_attrs(fe, wear=0.5)
        Skinner(rig, rest_w, info, ("torso", "hip", "thigh")).apply(fe, k=8)
        C.add_modifier(fe, "SOLIDIFY", "Thick", thickness=0.0035, offset=1.0)
    T.mark("collar, front edge")
    sk_torso = Skinner(rig, rest_w, info, torso_regions)

    # waist belt + plate
    wb_c = Vector(cloth_np[np.abs(cloth_np[:, 2] - waist_z) < 0.012].mean(axis=0).tolist())
    wb_c.z = waist_z
    wpts, wouts, _w = section_loop(cloth_np, wb_c, U, F, band=0.012, bins=64,
                                   pad=D["strap_thickness"] / 2 + 0.001)
    ribbon("tcw_waist_belt", wpts, wouts, U, D["waist_belt_width"], m["leather"], sk_torso)
    fi = max(range(len(wpts)), key=lambda i: wouts[i].dot(F))
    pc = wpts[fi] + wouts[fi] * 0.004
    bw, bh = D["belt_plate"]
    plate = C.mesh_object("tcw_belt_plate", *C.loft(
        [C.ring(pc + wouts[fi] * dz, Lv, U, bw / 2, bh / 2, 16) for dz in (0.0, 0.004)]))
    C.assign(plate, m["brass"])
    sk_torso.apply(plate, 6)

    def diag_loop(top_side, bottom_side, shift, width, pad, bottom_z=None):
        sh = lm["shL"] if top_side == "L" else lm["shR"]
        hp = lm["hipR"] if bottom_side == "R" else lm["hipL"]
        side_out = (hp - lm["hip_c"]).normalized()
        A = sh + U * 0.06 - (sh - lm["mid"]).dot(Lv) * Lv * 0.25
        A.z = sh.z + 0.06
        B = Vector((hp.x, hp.y, bottom_z if bottom_z is not None else hip_z + 0.03)) + side_out * 0.02
        nrml = (B - A).cross(F).normalized()
        cen = (A + B) / 2 + nrml * shift
        cloud = cloth_np[cloth_np[:, 2] > B.z - 0.015]  # nothing below the hip end of the loop
        pts, outs, across = section_loop(cloud, cen, nrml, A - cen, band=0.014, bins=72, pad=pad)
        return pts, outs, nrml

    cb_pts, cb_outs, cb_n = diag_loop("L", "R", 0.0, D["cartridge_belt_width"], D["strap_thickness"] + 0.002)
    ribbon("tcw_cartridge_belt", cb_pts, cb_outs, cb_n, D["cartridge_belt_width"], m["leather"], sk_torso)
    target = lm["shL"] + F * 0.14 - U * 0.17
    bi = min(range(len(cb_pts)), key=lambda i: (cb_pts[i] - target).length)
    pc = cb_pts[bi] + cb_outs[bi] * 0.004
    bp = C.mesh_object("tcw_breast_plate", *C.loft(
        [C.ring(pc + cb_outs[bi] * dz, cb_n, cb_n.cross(cb_outs[bi]).normalized(),
                D["breast_plate_d"] / 2, D["breast_plate_d"] / 2, 20) for dz in (0.0, 0.004)]))
    C.assign(bp, m["brass"])
    sk_torso.apply(bp, 6)
    roll_pts, roll_outs, roll_n = diag_loop("L", "R", -0.01, 0.0, D["strap_thickness"] + 0.006,
                                            bottom_z=waist_z + 0.02)
    tube_along("tcw_blanket_roll", roll_pts, roll_outs, roll_n, D["blanket_roll_r"], m["blanket"], sk_torso)
    for j, (shift, mat_name) in enumerate(((0.025, "haversack"), (-0.025, "webbing"))):
        p_, o_, n_ = diag_loop("R", "L", shift, D["sling_strap_width"], D["strap_thickness"] + 0.003 + 0.002 * j)
        ribbon("tcw_strap_" + mat_name, p_, o_, n_, D["sling_strap_width"], m[mat_name], sk_torso)
    T.mark("belts, straps, roll")

    # coat buttons down the centre front
    bvh = bvhs[0]
    top_z = lm["neck"].z - 0.05
    n_b = D["button_count"]
    for j in range(n_b):
        z = top_z + (waist_z + 0.05 - top_z) * j / (n_b - 1)
        o = Vector((lm["mid"].x, lm["mid"].y, z)) + F * 1.0
        hit = bvh.ray_cast(o, -F)
        if hit[0] is None:
            continue
        nn = hit[1].normalized()
        pc = hit[0] + nn * 0.0015
        a1 = nn.cross(U).normalized()
        a2 = nn.cross(a1).normalized()
        r = D["button_d"] / 2
        btn = C.mesh_object("tcw_button_%d" % j, *C.loft(
            [C.ring(pc + nn * dz, a1, a2, r * s, r * s, 12) for dz, s in
             ((0.0, 1.0), (0.0015, 0.97), (0.003, 0.75), (0.0038, 0.35))], cap_start=True, cap_end=True))
        C.assign(btn, m["brass"])
        C.stamp_attrs(btn)
        sk_torso.apply(btn, 4)
    T.mark("buttons")

    # hip kit, rigid on the lower spine
    anchor = rm["hip_anchor"]
    hz = hip_z + 0.02
    hip_ring_c = Vector(cloth_np[np.abs(cloth_np[:, 2] - hz) < 0.015].mean(axis=0).tolist())
    hip_ring_c.z = hz
    hpts, houts, _w = section_loop(cloth_np, hip_ring_c, U, F, band=0.015, bins=72, pad=0.0)

    def surface(direction, z_shift=0.0):
        direction = direction.normalized()
        i = max(range(len(hpts)), key=lambda k: houts[k].dot(direction))
        return hpts[i] + U * z_shift, houts[i]

    def side_box(name, size, direction, z_shift, mat, gap=0.006, tilt=0.0):
        p, o = surface(direction, z_shift)
        o = Vector((o.x, o.y, 0)).normalized()
        tang = U.cross(o).normalized()
        w, h, d = size
        up = (U * math.cos(tilt) + tang * math.sin(tilt)).normalized()
        across = up.cross(o).normalized()
        cen = p + o * (gap + d / 2)
        v, f = C.box(cen, (across, up, o), (w / 2, h / 2, d / 2))
        return rigid(name, v, f, mat, rig, anchor, bevel=0.006)

    back = -F
    side_box("tcw_cartridge_box", D["cartridge_box"], (-Lv) * 0.55 + back * 0.85, 0.0, m["leather"],
             gap=D["strap_thickness"] + 0.004)
    side_box("tcw_cap_pouch", D["cap_pouch"], F * 0.8 + (-Lv) * 0.6, waist_z - hz - 0.02, m["leather"],
             gap=0.006)
    hv = side_box("tcw_haversack", D["haversack"], Lv * 0.95 + F * 0.2, -0.10, m["haversack"], gap=0.012)
    # canteen: a lens-shaped disc outside the haversack, a little behind it
    p, o = surface(Lv * 0.9 + back * 0.45, -0.07)
    o = Vector((o.x, o.y, 0)).normalized()
    cen = p + o * (0.012 + D["haversack"][2] + D["canteen_t"] / 2)
    tang = U.cross(o).normalized()
    r = D["canteen_d"] / 2
    rings_c = [C.ring(cen + o * (s * D["canteen_t"] / 2), tang, U, r * k, r * k, 24)
               for s, k in ((-1, 0.82), (-0.6, 0.97), (0, 1.0), (0.6, 0.97), (1, 0.82))]
    cv, cf = C.loft(rings_c)
    rigid("tcw_canteen", cv, cf, m["canteen"], rig, anchor, smooth=True)
    spout = C.loft([C.ring(cen + U * (r + dz), tang, o, 0.012, 0.012, 10) for dz in (-0.01, 0.025)])
    rigid("tcw_canteen_spout", spout[0], spout[1], m["steel"], rig, anchor, smooth=True)
    # bayonet scabbard on the left hip, angled back
    p, o = surface(Lv * 0.6 + back * 0.8, -0.02)
    o = Vector((o.x, o.y, 0)).normalized()
    tang = U.cross(o).normalized()
    w, l, t = D["scabbard"]
    down = (-U * math.cos(math.radians(25)) + back.normalized() * math.sin(math.radians(25))).normalized()
    cen = p + o * (0.01 + t) + down * (l / 2)
    v, f = C.box(cen, (tang, down, o), (w / 2, l / 2, t / 2))
    rigid("tcw_scabbard", v, f, m["leather"], rig, anchor, bevel=0.004)
    T.mark("hip kit")

    # headgear
    head_idx = [i for i, r in enumerate(region) if r == "head"]
    head_cloud = [rest_w[i][:] for i in head_idx]
    eyes = lm.get("eyes")
    eye_z = (sum(e.z for e in eyes) / len(eyes)) if eyes else (max(p[2] for p in head_cloud) - 0.11)
    brow_z = eye_z + 0.028
    build_cap(m, rig, rm, lm, head_cloud, brow_z)
    build_slouch(m, rig, rm, lm, head_cloud, brow_z)
    T.mark("headgear")

    musket = build_musket(m)
    musket.parent = rig
    musket.matrix_parent_inverse = Matrix()
    musket.location = lm["hipR"] + F * 0.1 - Lv * 0.1
    T.mark("musket")

    # hide the body under the clothes (one-ring erosion so seams never open)
    covered = coat_set | trouser_set | shoe_set
    nb = {}
    for e in body.data.edges:
        a, b = e.vertices
        nb.setdefault(a, []).append(b)
        nb.setdefault(b, []).append(a)
    inner = [i for i in covered if all(j in covered for j in nb.get(i, []))]
    vg = body.vertex_groups.get("tcw_covered") or body.vertex_groups.new(name="tcw_covered")
    vg.add(inner, 1.0, "REPLACE")
    mk = body.modifiers.new("Hide covered", "MASK")
    mk.vertex_group = "tcw_covered"
    mk.invert_vertex_group = True
    REP["hidden_body_vertices"] = len(inner)
    for o in bpy.data.objects:
        if o.type == "MESH" and o.parent is None and o.name.startswith("tcw_"):
            C.log("unparented tcw object:", o.name)
        # every scripted part gets the rest-position attribute the procedural materials read
        if o.type == "MESH" and o.name.startswith("tcw_") and "tcw_rest" not in o.data.attributes:
            C.stamp_attrs(o)

    C.update()
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for o in bpy.data.objects:
        if o.type == "MESH" and not o.hide_render:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
            ev.to_mesh_clear()
    REP["render_triangles_viewport_levels"] = tris
    REP["landmark_heights"] = {"hip_z": hip_z, "waist_z": waist_z, "hem_z": hem_z, "brow_z": brow_z}
    out = os.path.join(C.WORK, "soldier.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=False)
    T.mark("saved soldier.blend")
    REP["timing"] = T.marks
    C.write_report("uniform", REP)


main()
