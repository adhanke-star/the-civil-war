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
from mathutils import Matrix, Vector
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


def mats():
    m = {}
    for k, (hexc, rough) in COL.items():
        metal = 1.0 if k in ("steel", "brass") else 0.0
        if k in ("coat", "cap", "trousers", "canteen", "blanket", "felt", "webbing"):
            m[k] = C.material("tcw_" + k, hexc, roughness=rough, sheen=0.5, mottle=0.10,
                              mottle_scale=4.0, bump=0.15, bump_scale=900.0)
        elif k == "wood":
            m[k] = C.material("tcw_" + k, hexc, roughness=rough, grain=0.22)
        else:
            m[k] = C.material("tcw_" + k, hexc, roughness=rough, metallic=metal,
                              mottle=0.05 if not metal else 0.0)
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


def make_shell(name, body, rig, rest, nrm, keep, offset_of, mat, iters, solid, min_z=None, subdiv=1):
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
    src = bm.verts.layers.int.new("tcw_src")
    for v in bm.verts:
        v[src] = v.index
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
    taubin(bm, iters)
    if min_z is not None:
        for v in bm.verts:
            if v.co.z < min_z:
                v.co.z = min_z
    pos = [(v.co.copy(), v[src]) for v in bm.verts]
    bm.to_mesh(sh.data)
    bm.free()
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
        elif r == "foot" or (r == "shin" and z < shoe_top):
            shoe_set.add(i)
        elif r in ("hip", "thigh", "shin"):
            trouser_set.add(i)

    def coat_off(i):
        return D["coat_offset_sleeve"] if region[i] == "arm" else D["coat_offset_torso"]

    coat, coat_pos = make_shell("tcw_coat", body, rig, rest, nrm, coat_set, coat_off, m["coat"],
                                D["smooth_iterations"], D["cloth_thickness"])
    trousers, _tp = make_shell("tcw_trousers", body, rig, rest, nrm, trouser_set,
                               lambda i: D["trouser_offset"], m["trousers"], D["smooth_iterations"],
                               D["cloth_thickness"])
    for side, sg in (("L", 1.0), ("R", -1.0)):
        build_brogan(m, rig, rm, lm, side, sg, [i for i in shoe_set], rest_w, info)
    T.mark("garment shells")

    # body cross-sections -> coat skirt (a lofted tube from above the belt to the hem)
    torso_regions = ("torso", "hip")
    body_np = np.array([p[:] for p in rest_w])
    leg_cloud = body_np[[i for i, r in enumerate(region) if r in ("hip", "thigh", "torso")]]
    rings = []
    steps = 6
    for k in range(steps + 1):
        t = k / steps
        z = (waist_z + 0.04) * (1 - t) + hem_z * t
        sel = leg_cloud[np.abs(leg_cloud[:, 2] - z) < 0.012]
        cen = Vector(sel.mean(axis=0).tolist())
        cen.z = z
        pad = D["coat_offset_torso"] + 0.004 + D["coat_hem_flare"] * t * t
        pts, _o, _w = section_loop(leg_cloud, cen, U, F, band=0.012, bins=48, pad=pad, smooth=3)
        rings.append(pts)
    sv, sf = C.loft(rings, cap_start=False, cap_end=False)
    skirt = C.mesh_object("tcw_coat_skirt", sv, sf)
    C.assign(skirt, m["coat"])
    Skinner(rig, rest_w, info, ("torso", "hip", "thigh")).apply(skirt, k=24)
    C.add_modifier(skirt, "SOLIDIFY", "Cloth", thickness=D["cloth_thickness"], offset=-1.0)
    C.add_modifier(skirt, "SUBSURF", "Smooth", levels=0, render_levels=1)
    T.mark("coat skirt")

    # clothed outline cloud (coat torso + skirt) for belts, straps and the blanket roll
    cloth = [MW @ p for (p, s) in coat_pos if region[s] in torso_regions]
    cloth += [p for p in sv]
    cloth_np = np.array([p[:] for p in cloth])
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
    bvh = BVHTree.FromPolygons([MW @ p for (p, s) in coat_pos], [tuple(pp.vertices) for pp in coat.data.polygons])
    top_z = lm["neck"].z - 0.05
    n_b = D["button_count"]
    for j in range(n_b):
        z = top_z + (waist_z + 0.05 - top_z) * j / (n_b - 1)
        o = Vector((lm["mid"].x, lm["mid"].y, z)) + F * 1.0
        hit = bvh.ray_cast(o, -F)
        if hit[0] is None:
            continue
        pc = hit[0] + F * 0.002
        r = D["button_d"] / 2
        btn = C.mesh_object("tcw_button_%d" % j, *C.loft(
            [C.ring(pc + F * dz, Lv, U, r * s, r * s, 10) for dz, s in ((0.0, 1.0), (0.003, 0.8))]))
        C.assign(btn, m["brass"])
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
