# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 3 of the bake: key the poses on the rig by script (no motion data) and save
# work/posed.blend plus report/poses.json (clip -> frame numbers, fps, ground speed, checks).
#
#   stand   frame 1        shoulder arms, position of the soldier
#   walk    frames 11-18   8-frame march, musket at right shoulder shift
#   fire    frames 21-23   aim, fire (recoil: shoulders back, muzzle kicks up), recover (piece down)
#   fallen  frame 31       lying on the back, musket dropped
#   load    frames 41-45   butt on the ground: 0 cartridge from the box, 1 charge at the muzzle,
#                          2 draw the rammer, 3 ram, 4 prime at the right side
#
# Limbs are placed with an analytic two-bone IK toward world targets.
#
# THIRD PASS, hands. Every gripping hand is placed by a grip solve:
#   1. the hand model is MEASURED from the rest mesh: each finger segment's pad thickness, the
#      palm's thickness, and which side of each finger is the pad (opposite its fingernail);
#   2. the palm is put against the object (stock, barrel, rammer, cartridge): a palm-contact
#      point at the surface along a chosen side, the hand turned so the palm faces the surface
#      and the fingers point round it; the wrist position follows from the measured hand, the
#      arm reaches it by IK, the forearm rolls to take the twist, the hand is set exactly;
#   3. each finger joint (and the opposed thumb) curls until its segment's pad touches the
#      surface (bisection on the joint angle; a segment already inside is backed out);
#   4. 54 placements (side of the object, wrap direction, hand tilt, slide along it) are scored
#      on segments in contact, thumb contact, wrist bend, reach and penetration; the best is kept.
# The report then measures the REAL skinned hand mesh against the same surfaces: segments in
# contact (a vertex of that segment within 3 mm) and the deepest penetration, per clip frame.
# In the load clip the right hand pinches a paper cartridge (frames 0-1), then grips the rammer.
# Haversack and canteen swing toward plumb from their strap point (and swing on the march).
#
# HISTORY STATUS: drill positions follow the commonly described Hardee/Casey manual of arms
# (Inferred, recalled, not yet cited twice). Cadence 110 steps/min and 28 in step for quick
# time are Inferred. The loading sequence is a reduced, recalled version of the loading drill
# (Inferred). Everything else is a placeholder estimate.
#
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/poses.py -- --out .out/bake

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

G = {
    "steps_per_min": 110.0,     # quick time                                  Inferred
    "step_m": 0.711,            # 28 in step                                  Inferred
    "stance_frac": 0.60,        # walking stance share of the cycle           placeholder
    "stance_half_m": 0.30,      # ankle travel each side of the hip in stance (pass 2: 0.36 made the pelvis dip 6-8%) placeholder
    "walk_drop_max_m": 0.042,   # pelvis drop below standing, capped (~2.4% of height; 0.030 left the feet 1.9 cm short) placeholder
    "walk_bob_m": 0.005,        # vertical bob amplitude on the march                    placeholder
    "march_half_width": 0.085,  # ankle offset from the centre line, marching placeholder
    "fire_half_width": 0.13,    # ankle offset from the centre line, firing   placeholder
    "foot_lift": 0.09,          # swing clearance of the ankle                placeholder
    "march_lean_deg": 4.0,      #                                             placeholder
    "pelvis_yaw_deg": 4.0,      #                                             placeholder
    "arm_swing_deg": 16.0,      # free (left) arm swing                       placeholder
    "aim_body_yaw_deg": -40.0,  # body turned right of the line of fire       placeholder
    "recoil_deg": 26.0,         # muzzle rise at the shot (pass 3: 16 read like aim at 150 m) placeholder
    "recoil_back_m": 0.11,      # shoulders driven back at the shot           placeholder
    # -- grip solve (third pass) -------------------------------------------------------------
    # where each hand holds the piece, gun-local z (m from the heel of the butt)
    "grip_stand_R": 0.300,      # swell of the stock under the lock, thumb and forefinger at the guard  Inferred (Hardee "shoulder arms", recalled)
    "grip_walk_R": 0.060,       # the butt, right shoulder shift                                         placeholder
    "grip_aim_L": 0.620,        # forestock at the lower band                                           placeholder
    "grip_aim_R": 0.300,        # wrist (small) of the stock, forefinger to the trigger                 placeholder
    "grip_recover_L": 0.620,    #                                                                        placeholder
    "grip_recover_R": 0.330,    #                                                                        placeholder
    "grip_load_L": 1.000,       # barrel and forestock below the upper band, piece upright               placeholder
    "grip_prime_L": 0.600,      #                                                                        placeholder
    "grip_prime_R": 0.360,      #                                                                        placeholder
    "grip_rammer_drawn": 0.38,  # m above the muzzle where the drawn rammer is held                      placeholder
    "grip_rammer_ram": 0.36,    # m above the muzzle on the rammer, arm raised clear of the body (readability) placeholder
    "rammer_ram_dz": 0.40,      # rammer withdrawn this far for the ramming stroke                       placeholder
    "thumb_oppose_deg": 32.0,   # thumb carpometacarpal opposition, fixed (run 14: solved, it swung out) placeholder
    "back_out_min_deg": -10.0,  # a joint never opens further than this to clear a surface (run 14: -36 hyperextended) placeholder
    "cand_rot_deg": (0.0, -35.0, 35.0),   # palm side turned round the object                          placeholder
    # run 14: +-20 deg left the wrists bent 60-75 deg; a stock held across the palm sits diagonally
    "cand_tilt_deg": (0.0, -25.0, 25.0, -45.0, 45.0),  # hand axis tilted along the object             placeholder
    "cand_slide_m": (0.0, -0.03, 0.03),   # palm slid along the object                                  placeholder
    "finger_lim_deg": (90.0, 100.0, 80.0),  # max flexion per joint, fingers                           placeholder
    "thumb_lim_deg": (60.0, 60.0, 70.0),    # thumb: opposition, then flexion                          placeholder
    "relax_deg": (28.0, 38.0, 24.0),        # a finger that finds nothing to hold curls this far       placeholder
    "wrist_bend_ok_deg": 30.0,  # wrist bend that costs nothing in the score                           placeholder
    "wrist_bend_cost": 0.30,    # score lost per degree beyond that (run 16: 0.15 kept 80 deg walk wrists) placeholder
    "pad_percentile": 50.0,     # finger pad thickness: percentile of pad-side skin distance (run 14: 80 left 3-8 mm gaps) placeholder
    "contact_mm": 3.0,          # a mesh vertex this close to the surface is in contact                placeholder
    "refine_iters": 8,          # mesh refine passes per hand                                          placeholder
    "refine_band_mm": (-0.8, 1.2),  # a segment whose nearest skin is inside this band is done         placeholder
}
FR = {"stand": [1], "walk": list(range(11, 19)), "fire": [21, 22, 23], "fallen": [31],
      "load": [41, 42, 43, 44, 45]}

T = C.Timer()
REP = {"constants": G, "frames": {}, "ik_error_m": {}, "checks": {}, "grips": {}}
GUN = {}
OBST = []
HANG = []
UNI = {}
HM = {}          # measured hand model
GRIPLOG = []     # (key, frame, side, target surface, all surfaces)
SAMPLE_T = (0.3, 0.55, 0.8, 1.0)


# ------------------------------------------------------------------------------ surfaces

class GunSurf:
    """The musket's stock ellipse and barrel circle (gun_gap) for a gun matrix M."""
    def __init__(self, M):
        self.M = M
        self.Minv = M.inverted()

    def gap(self, p):
        return gun_gap(self.Minv, p)


class CylSurf:
    """A capped cylinder from a along unit d for length L (rammer, cartridge)."""
    def __init__(self, a, d, r, L):
        self.a, self.d, self.r, self.L = a.copy(), d.normalized(), r, L

    def gap(self, p):
        v = p - self.a
        t = v.dot(self.d)
        radial = (v - self.d * t).length - self.r
        if t < 0.0:
            return math.hypot(max(radial, 0.0), -t) if radial > 0 else -t
        if t > self.L:
            return math.hypot(max(radial, 0.0), t - self.L) if radial > 0 else t - self.L
        return radial


class Union:
    def __init__(self, *s):
        self.s = [x for x in s if x is not None]

    def gap(self, p):
        return min(x.gap(p) for x in self.s)


class MeshProbe:
    """The posed body's real skin (armature on) for one hand: vertex positions per segment."""
    def __init__(self, ps, body):
        self.ps, self.body = ps, body
        self.arm = [m for m in body.modifiers if m.type == "ARMATURE"]
        self.verts = {"L": {}, "R": {}}
        for i, b in HM.get("owner", {}).items():
            self.verts["L" if b.endswith(".L") else "R"].setdefault(b, []).append(i)
        self.evals = 0

    def coords(self, s):
        for m in self.arm:
            m.show_viewport = True
        try:
            C.update()
            dg = bpy.context.evaluated_depsgraph_get()
            ev = self.body.evaluated_get(dg)
            me = ev.to_mesh()
            n = len(me.vertices)
            co = np.empty(n * 3, dtype=np.float64)
            me.vertices.foreach_get("co", co)
            ev.to_mesh_clear()
        finally:
            for m in self.arm:
                m.show_viewport = False
            C.update()
        self.evals += 1
        co = co.reshape(-1, 3)
        Mx = self.ps.rig.matrix_world.inverted() @ self.body.matrix_world
        out = {}
        for b, idx in self.verts[s].items():
            out[b] = [Mx @ Vector(co[i].tolist()) for i in idx if i < n]
        return out

    def palm_min_gap(self, s, surf, P=None):
        P = P or self.coords(s)
        g = [surf.gap(p) for b, ps_ in P.items() for p in ps_
             if b.startswith("metacarpal") or b == self.ps.S[s]["hand"]
             or (b.startswith("finger") and b.split(".")[0].endswith("-1") and not b.startswith("finger1"))]
        return min(g) if g else 1.0


PROBE = {}


# ------------------------------------------------------------------------------ the poser

class Poser:
    def __init__(self, rig, rm):
        self.rig = rig
        self.rm = rm
        self.B = rig.data.bones
        self.S = rm["side"]
        U = Vector((0, 0, 1))
        Lv = self.rh(self.S["L"]["upper"][0]) - self.rh(self.S["R"]["upper"][0])
        Lv.z = 0
        Lv.normalize()
        F = Lv.cross(U).normalized()
        fv = self.rt(self.S["L"]["foot"]) - self.rh(self.S["L"]["foot"])
        if Vector((fv.x, fv.y, 0)).dot(F) < 0:
            F = -F
        self.F, self.L, self.U = F, Lv, U
        self.len = {}
        for s in ("L", "R"):
            d = self.S[s]
            self.len[s] = {
                "upper": (self.rt(d["upper"][-1]) - self.rh(d["upper"][0])).length,
                "lower": (self.rt(d["lower"][-1]) - self.rh(d["lower"][0])).length,
                "thigh": (self.rt(d["thigh"][-1]) - self.rh(d["thigh"][0])).length,
                "shin": (self.rt(d["shin"][-1]) - self.rh(d["shin"][0])).length,
            }
        self.rest_ank = {s: self.rh(self.S[s]["foot"]) for s in ("L", "R")}
        self.rest_hip = {s: self.rh(self.S[s]["thigh"][0]) for s in ("L", "R")}
        self.ank_mid = (self.rest_ank["L"] + self.rest_ank["R"]) / 2
        self.flex = {}   # flexion applied per finger joint since its arm was reset (deg)
        for p in rig.pose.bones:
            p.rotation_mode = "QUATERNION"

    def rh(self, n):
        return self.B[n].head_local.copy()

    def rt(self, n):
        return self.B[n].tail_local.copy()

    def P(self, n):
        return self.rig.pose.bones[n]

    def ph(self, n):
        return self.P(n).head.copy()

    def pt(self, n):
        return self.P(n).tail.copy()

    def reset(self):
        self.flex = {}
        for p in self.rig.pose.bones:
            p.matrix_basis = Matrix()
        C.update()

    def arm_bones(self, s):
        d = self.S[s]
        names = list(d["upper"]) + list(d["lower"]) + [d["hand"]]
        for chain in d["fingers"]:
            names += chain
        return [n for n in names if n in self.B]

    def reset_arm(self, s):
        for n in self.arm_bones(s):
            self.P(n).matrix_basis = Matrix()
            self.flex.pop(n, None)
        C.update()

    def rotate_about(self, n, pivot, q):
        p = self.P(n)
        p.matrix = Matrix.Translation(pivot) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pivot) @ p.matrix
        C.update()

    def translate(self, n, v):
        p = self.P(n)
        p.matrix = Matrix.Translation(v) @ p.matrix
        C.update()

    def aim(self, first, last, target):
        head = self.ph(first)
        cur = self.pt(last) - head
        want = target - head
        if cur.length < 1e-6 or want.length < 1e-6:
            return
        self.rotate_about(first, head, cur.rotation_difference(want))

    def two_bone(self, seg1, seg2, a, b, target, pole):
        S = self.ph(seg1[0])
        d = target - S
        dist = min(max(d.length, abs(a - b) + 1e-3), (a + b) * 0.999)
        n = d.normalized()
        x = (a * a - b * b + dist * dist) / (2 * dist)
        h = math.sqrt(max(a * a - x * x, 0.0))
        pp = pole - n * pole.dot(n)
        if pp.length < 1e-6:
            pp = n.orthogonal()
        E = S + n * x + pp.normalized() * h
        self.aim(seg1[0], seg1[-1], E)
        self.aim(seg2[0], seg2[-1], S + n * dist)
        return (self.pt(seg2[-1]) - target).length

    def arm(self, s, wrist, pole):
        d = self.S[s]
        return self.two_bone(d["upper"], d["lower"], self.len[s]["upper"], self.len[s]["lower"], wrist, pole)

    def leg(self, s, ankle, pole):
        d = self.S[s]
        return self.two_bone(d["thigh"], d["shin"], self.len[s]["thigh"], self.len[s]["shin"], ankle, pole)

    def spine(self, axis, deg):
        bones = self.rm["spine"]
        for n in bones:
            self.rotate_about(n, self.ph(n), C.rot(axis, deg / len(bones)))

    def root_rotate(self, q, pivot=None):
        if pivot is None:
            pivot = (self.ph(self.S["L"]["thigh"][0]) + self.ph(self.S["R"]["thigh"][0])) / 2
        self.rotate_about(self.rm["root"], pivot, q)

    def pelvis(self):
        return (self.ph(self.S["L"]["thigh"][0]) + self.ph(self.S["R"]["thigh"][0])) / 2

    def face_dir(self):
        hb = self.rm["head"]
        R = self.P(hb).matrix.to_3x3() @ self.B[hb].matrix_local.to_3x3().inverted()
        return R @ self.F

    def look(self, want, roll_deg=0.0):
        want = want.normalized()
        neck = self.rm["neck"][len(self.rm["neck"]) // 2]
        q = self.face_dir().rotation_difference(want)
        self.rotate_about(neck, self.ph(neck), Quaternion().slerp(q, 0.5))
        hb = self.rm["head"]
        q = self.face_dir().rotation_difference(want)
        self.rotate_about(hb, self.ph(hb), q)
        if roll_deg:
            self.rotate_about(hb, self.ph(hb), C.rot(want, roll_deg))

    def foot(self, s, direction):
        fb = self.S[s]["foot"]
        L = self.B[fb].length
        self.aim(fb, fb, self.ph(fb) + direction.normalized() * L)

    def foot_rest_dir(self, s, yaw_deg=0.0, pitch_deg=0.0):
        fb = self.S[s]["foot"]
        v = self.rt(fb) - self.rh(fb)
        fh = Vector((v.x, v.y, 0)).normalized()
        lat = self.U.cross(fh).normalized()
        return C.rot(self.U, yaw_deg) @ (C.rot(lat, -pitch_deg) @ v)

    # ---- the measured hand (third pass)
    def palmar(self, bn):
        """World (armature-space) pad-side direction of a finger segment, from the hand model."""
        loc = HM.get("palmar_local", {}).get(bn)
        if loc is None:
            return self.palm_world(self.side_of(bn))
        return (self.P(bn).matrix.to_3x3() @ Vector(loc)).normalized()

    def side_of(self, bn):
        return "L" if bn.endswith(".L") else "R"

    def hand_frame(self, s):
        """(hand direction, palm normal) of the posed hand, from the measured model."""
        h = HM["hand"][s]
        R = self.P(self.S[s]["hand"]).matrix.to_3x3()
        return (R @ Vector(h["H0"])).normalized(), (R @ Vector(h["P0"])).normalized()

    def palm_world(self, s):
        if s not in HM.get("hand", {}):
            return self.palm(s)[0]
        return self.hand_frame(s)[1]

    def palm_centre(self, s):
        h = HM["hand"][s]
        return self.P(self.S[s]["hand"]).matrix @ Vector(h["pc_local"])

    def palm(self, s):
        """Second-pass palm estimate (fallback only)."""
        d = self.S[s]
        f = d["fingers"]
        wr = self.ph(d["hand"])
        hand_dir = (self.ph(f[2][0]) - wr).normalized()
        thumb = (self.ph(f[0][0]) - self.ph(f[4][0])).normalized()
        n = hand_dir.cross(thumb)
        return (n if s == "L" else -n).normalized(), hand_dir

    def hand_rot(self, s, H, Pn):
        """Bone rotation (armature space) that turns the rest hand to direction H, palm Pn."""
        h = HM["hand"][s]
        H0, P0 = Vector(h["H0"]), Vector(h["P0"])
        X0 = H0.cross(P0).normalized()
        H = H.normalized()
        Pn = (Pn - H * Pn.dot(H)).normalized()
        X = H.cross(Pn).normalized()
        F1 = Matrix((H, Pn, X)).transposed()
        F0 = Matrix((H0, P0, X0)).transposed()
        return F1 @ F0.transposed()

    def set_hand_rot(self, s, R):
        hb = self.S[s]["hand"]
        p = self.P(hb)
        p.matrix = Matrix.Translation(self.ph(hb)) @ R.to_4x4()
        C.update()

    def roll_forearm(self, s, R):
        """Take the wrist's twist in the forearm (lowerarm02 rolls about the forearm axis)."""
        d = self.S[s]
        lo = d["lower"][-1]
        f = (self.ph(d["hand"]) - self.ph(d["lower"][0])).normalized()
        h = HM["hand"][s]
        cur = self.P(d["hand"]).matrix.to_3x3() @ Vector(h["P0"])
        want = R @ Vector(h["P0"])
        a = cur - f * cur.dot(f)
        b = want - f * want.dot(f)
        if a.length < 1e-6 or b.length < 1e-6:
            return 0.0
        a.normalize()
        b.normalize()
        ang = math.atan2(a.cross(b).dot(f), a.dot(b))
        ang = max(-math.radians(110), min(math.radians(110), ang)) * 0.85
        self.rotate_about(lo, self.ph(lo), Quaternion(f, ang))
        return math.degrees(ang)

    def wrist_bend(self, s):
        d = self.S[s]
        f = (self.ph(d["hand"]) - self.ph(d["lower"][0])).normalized()
        H, _P = self.hand_frame(s)
        return math.degrees(f.angle(H))

    def close_fingers(self, s, surf, relax=None, skip=()):
        """Curl every finger joint (and the opposed thumb) until its segment's pad touches surf."""
        lim_f, lim_t = G["finger_lim_deg"], G["thumb_lim_deg"]
        relax = relax or G["relax_deg"]
        out = {"segments": 0, "touching": 0, "thumb": 0, "worst_model_pen_mm": 0.0, "fingers": []}
        for ci, chain in enumerate(self.S[s]["fingers"]):
            fr = []
            for k, bn in enumerate(chain):
                if bn not in self.B:
                    continue
                out["segments"] += 1
                if ci in skip:
                    fr.append("skip")
                    continue
                head, tail = self.ph(bn), self.pt(bn)
                dvec = tail - head
                if dvec.length < 1e-6:
                    continue
                if ci == 0 and k == 0:
                    # the thumb is opposed by a fixed turn toward the palm; only its two outer
                    # joints close on the object (run 14: a solved CMC swung the thumb out)
                    axis = dvec.normalized().cross(self.palm_world(s))
                    if axis.length > 1e-6:
                        self.rotate_about(bn, head, C.rot(axis.normalized(), G["thumb_oppose_deg"]))
                    fr.append("opposed")
                    continue
                axis = dvec.normalized().cross(self.palmar(bn))
                if axis.length < 1e-6:
                    continue
                axis.normalize()
                rad = HM.get("pad", {}).get(bn, 0.0085)
                lim = (lim_t if ci == 0 else lim_f)[min(k, 2)]

                def g(a, head=head, dvec=dvec, axis=axis, rad=rad):
                    dd = C.rot(axis, a) @ dvec if a else dvec
                    return min(surf.gap(head + dd * t) for t in SAMPLE_T) - rad
                g0 = g(0.0)
                contact = False
                if g0 <= 0.0:
                    a = G["back_out_min_deg"]
                    prev = 0.0
                    for st in range(1, 6):
                        a2 = max(G["back_out_min_deg"], -2.0 * st)
                        if g(a2) > 0.0:
                            lo, hi = a2, prev
                            for _ in range(6):
                                mid = (lo + hi) / 2
                                if g(mid) > 0.0:
                                    lo = mid
                                else:
                                    hi = mid
                            a = lo
                            break
                        prev = a2
                    contact = True
                else:
                    prev, hit = 0.0, None
                    a2 = 0.0
                    while a2 < lim:
                        a2 = min(lim, a2 + 6.0)
                        if g(a2) <= 0.0:
                            hit = (prev, a2)
                            break
                        prev = a2
                    if hit:
                        lo, hi = hit
                        for _ in range(7):
                            mid = (lo + hi) / 2
                            if g(mid) > 0.0:
                                lo = mid
                            else:
                                hi = mid
                        a = (lo + hi) / 2
                        contact = True
                    else:
                        a = relax[min(k, 2)] if ci else relax[min(k, 2)] * 0.6
                pen = max(0.0, -g(a))
                out["worst_model_pen_mm"] = max(out["worst_model_pen_mm"], round(pen * 1000, 2))
                if a:
                    self.rotate_about(bn, head, C.rot(axis, a))
                self.flex[bn] = self.flex.get(bn, 0.0) + a
                if contact:
                    out["touching"] += 1
                    if ci == 0:
                        out["thumb"] += 1
                fr.append(round(a, 1) if contact else "free")
            out["fingers"].append(fr)
        return out

    def flex_axis(self, s, ci, k, bn):
        dvec = (self.pt(bn) - self.ph(bn)).normalized()
        ax = dvec.cross(self.palm_world(s) if (ci == 0 and k == 0) else self.palmar(bn))
        return ax.normalized() if ax.length > 1e-6 else None

    def refine(self, s, surf, chains=None):
        """Mesh refine (third pass, run 14 showed the bone model stops 3-8 mm short): evaluate
        the REAL skinned hand, and per finger curl (or open) the most proximal segment whose
        nearest skin is outside the contact band, by the angle that closes that gap; repeat."""
        probe = PROBE.get("p")
        if probe is None:
            return {"iters": 0}
        lo, hi = G["refine_band_mm"][0] / 1000.0, G["refine_band_mm"][1] / 1000.0
        it, moves = 0, 0
        for it in range(1, G["refine_iters"] + 1):
            P = probe.coords(s)
            changed = False
            for ci, chain in enumerate(self.S[s]["fingers"]):
                if chains is not None and ci not in chains:
                    continue
                for k, bn in enumerate(chain):
                    pts = P.get(bn)
                    if not pts:
                        continue
                    gaps = [surf.gap(p) for p in pts]
                    j = min(range(len(gaps)), key=gaps.__getitem__)
                    g = gaps[j]
                    if lo <= g <= hi or (ci == 0 and k == 0):
                        continue
                    if g > 0.03:
                        break            # this finger is not over the object: leave it
                    ax = self.flex_axis(s, ci, k, bn)
                    if ax is None:
                        break
                    lever = max(0.012, (pts[j] - self.ph(bn)).length)
                    d = max(-12.0, min(15.0, math.degrees((g - 0.0002) / lever)))
                    # never open past straight + back_out_min (run 16: a cap counted from the curled
                    # angle left fingertips 10-17 mm inside the wood)
                    d = max(d, G["back_out_min_deg"] - self.flex.get(bn, 0.0))
                    if abs(d) < 0.3:
                        continue
                    self.flex[bn] = self.flex.get(bn, 0.0) + d
                    self.rotate_about(bn, self.ph(bn), C.rot(ax, d))
                    changed = True
                    moves += 1
                    break
            if not changed:
                break
        return {"iters": it, "moves": moves}

    def place_hand(self, s, Pc, H, Pn, pole):
        """Palm-contact point Pc, hand direction H, palm normal Pn: wrist by IK, roll, exact hand."""
        self.reset_arm(s)
        R = self.hand_rot(s, H, Pn)
        W = Pc - R @ Vector(HM["hand"][s]["pc_local"])
        err = self.arm(s, W, pole)
        roll = self.roll_forearm(s, R)
        self.set_hand_rot(s, R)
        return err, roll

    def grip(self, s, surf, axis_pt, A, nv, pole, key, frame, cands=None, extra=(), palm_off=0.0, skip=()):
        """Grip solve on an object with axis A through axis_pt; nv = side the palm should be on.
        Tries the candidate placements, keeps the best, logs it for the mesh measurement."""
        A = A.normalized()
        nv = (nv - A * nv.dot(A)).normalized()
        if cands is None:
            cands = [(r, sg, tl, dz) for dz in G["cand_slide_m"] for r in G["cand_rot_deg"]
                     for tl in G["cand_tilt_deg"] for sg in (1, -1)]
        best = None
        for cand in cands:
            r, sg, tl, dz = cand
            n2 = (C.rot(A, r) @ nv).normalized()
            Q = axis_pt + A * dz
            rr = 0.0
            for _ in range(24):          # surface radius along n2
                if surf.gap(Q + n2 * rr) > 0.0:
                    break
                rr += 0.004
            lo_, hi_ = max(0.0, rr - 0.004), rr
            for _ in range(6):
                mid = (lo_ + hi_) / 2
                if surf.gap(Q + n2 * mid) > 0.0:
                    hi_ = mid
                else:
                    lo_ = mid
            Pc = Q + n2 * (hi_ + 0.001 + palm_off)      # the palm-centre point is on the palm skin
            Tw = A.cross(n2) * sg
            H = (Tw * math.cos(math.radians(tl)) + A * math.sin(math.radians(tl))).normalized()
            err, roll = self.place_hand(s, Pc, H, -n2, pole)
            g = self.close_fingers(s, surf, skip=skip)
            bend = self.wrist_bend(s)
            score = (g["touching"] + 1.5 * min(g["thumb"], 2) - 60.0 * max(0.0, err - 0.008)
                     - G["wrist_bend_cost"] * max(0.0, bend - G["wrist_bend_ok_deg"]) - 0.02 * max(0.0, abs(roll) - 60.0)
                     - 1.0 * g["worst_model_pen_mm"])     # run 15: 0.25/mm let 20 mm through
            if best is None or score > best[0]:
                best = (score, cand, err, roll, bend, g, Pc)
            if g["touching"] >= 13 and g["thumb"] >= 2 and err < 0.008 and bend < G["wrist_bend_ok_deg"]:
                break
        score, cand, *_ = best
        r, sg, tl, dz = cand
        n2 = (C.rot(A, r) @ nv).normalized()
        Pc = best[6]
        Tw = A.cross(n2) * sg
        H = (Tw * math.cos(math.radians(tl)) + A * math.sin(math.radians(tl))).normalized()
        err, roll = self.place_hand(s, Pc, H, -n2, pole)
        g = self.close_fingers(s, surf, skip=skip)
        ref = {}
        probe = PROBE.get("p")
        if probe is not None:
            push = 0.0
            for _ in range(3):   # palm and knuckles (real skin) inside the wood: back the hand out
                pg = probe.palm_min_gap(s, surf)
                if pg >= -0.0012:
                    break
                Pc = Pc + n2 * (-pg + 0.0005)
                push += -pg
                err, roll = self.place_hand(s, Pc, H, -n2, pole)
                g = self.close_fingers(s, surf, skip=skip)
            if push:
                ref["palm_push_mm"] = round(push * 1000, 1)
            ref.update(self.refine(s, surf, chains=[c for c in range(5) if c not in skip]))
        res = {"candidate": {"rot_deg": r, "wrap": sg, "tilt_deg": tl, "slide_m": dz}, "score": round(score, 2),
               "refine": ref,
               "ik_err_m": round(err, 4), "forearm_roll_deg": round(roll, 1),
               "wrist_bend_deg": round(self.wrist_bend(s), 1),
               "palm_gap_mm": round(surf.gap(self.palm_centre(s)) * 1000, 1),
               "model": g, "tried": len(cands)}
        REP["grips"].setdefault(key, {})[s] = res
        GRIPLOG.append((key, frame, s, surf, extra))
        return err, res, cand

    def curl(self, s, degs=(35, 50, 40), thumb=20):
        """A relaxed hand (nothing held): every joint flexes toward its pad side."""
        for ci, chain in enumerate(self.S[s]["fingers"]):
            for k, bn in enumerate(chain):
                if bn not in self.B:
                    continue
                dvec = (self.pt(bn) - self.ph(bn)).normalized()
                pal = self.palm_world(s) if (ci == 0 and k == 0) else self.palmar(bn)
                axis = dvec.cross(pal)
                if axis.length < 1e-6:
                    continue
                ang = thumb * (1.0 if k == 0 else 0.6) if ci == 0 else degs[min(k, 2)]
                self.rotate_about(bn, self.ph(bn), C.rot(axis.normalized(), ang))

    def hand(self, s, direction, palm_want=None):
        """Point the hand along `direction` with the palm toward palm_want (relaxed hands)."""
        if s in HM.get("hand", {}) and palm_want is not None:
            R = self.hand_rot(s, direction, palm_want)
            self.roll_forearm(s, R)
            self.set_hand_rot(s, R)
            return
        hb = self.S[s]["hand"]
        self.aim(hb, hb, self.ph(hb) + direction.normalized() * self.B[hb].length)

    # ---- clearance against the kit
    def obstacles(self):
        out = []
        for o in OBST:
            b = o["bone"]
            if b not in self.B:
                continue
            delta = self.P(b).matrix @ self.B[b].matrix_local.inverted()
            out.append((o["name"], delta @ Vector(o["p"]), o["r"]))
        return out

    def arm_pen(self, s):
        d = self.S[s]
        sh, el, wr = self.ph(d["upper"][0]), self.ph(d["lower"][0]), self.ph(d["hand"])
        worst, what = -1.0, None
        for name, c, r in self.obstacles():
            for a, b, rs in ((sh, el, 0.052), (el, wr, 0.043)):
                ab = b - a
                t = max(0.0, min(1.0, (c - a).dot(ab) / max(1e-9, ab.dot(ab))))
                pen = r + rs - (a + ab * t - c).length
                if pen > worst:
                    worst, what = pen, name
        return worst, what

    def clear(self, s, solve, kicks=(0.0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.13, 0.16, 0.20, 0.24)):
        best = None
        for k in kicks:
            self.reset_arm(s)
            solve(k)
            pen, what = self.arm_pen(s)
            if best is None or pen < best[0]:
                best = (pen, k, what)
            if pen < 0.004:
                break
        if best[1] != k:
            self.reset_arm(s)
            solve(best[1])
        return {"penetration_m": round(best[0], 4), "kick_m": best[1], "nearest": best[2]}

    def key(self, frame):
        for p in self.rig.pose.bones:
            p.keyframe_insert("rotation_quaternion", frame=frame)
            p.keyframe_insert("location", frame=frame)


def gun_matrix(heel, zdir, yhint):
    z = zdir.normalized()
    x = yhint.cross(z).normalized()
    y = z.cross(x).normalized()
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = heel
    return M


def gun_axes(M):
    return (M.col[0].xyz.normalized(), M.col[1].xyz.normalized(), M.col[2].xyz.normalized())


def stock_at(z):
    """(height, width, centre-y) of the musket cross-section at gun-local z."""
    prof = GUN.get("prof") or [[0.0, 0.11, 0.042, -0.05], [1.22, 0.03, 0.028, -0.01]]
    if z >= prof[-1][0]:
        r = GUN.get("barrel_r", 0.0145)
        return 2 * r, 2 * r, GUN.get("barrel_y", 0.006)
    if z <= prof[0][0]:
        return prof[0][1], prof[0][2], prof[0][3]
    for a, b in zip(prof[:-1], prof[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / max(1e-6, b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in (1, 2, 3))
    return prof[-1][1], prof[-1][2], prof[-1][3]


def gun_gap(Minv, p):
    """Distance from a world point to the musket's surface (stock ellipse, barrel circle)."""
    q = Minv @ p
    L = GUN.get("L", 1.42)
    if q.z < -0.01 or q.z > L + 0.01:
        zc = min(max(q.z, 0.0), L)
        h, w, cy = stock_at(zc)
        e = math.hypot(q.x / (w / 2), (q.y - cy) / (h / 2))
        radial = max(0.0, (e - 1.0) * min(w, h) / 2)
        return math.hypot(radial, abs(q.z - zc))
    h, w, cy = stock_at(q.z)
    e = math.hypot(q.x / (w / 2), (q.y - cy) / (h / 2))
    gap = (e - 1.0) * min(w, h) / 2
    if q.z >= GUN.get("br0", 0.4) - 0.01:
        gb = math.hypot(q.x, q.y - GUN.get("barrel_y", 0.006)) - GUN.get("barrel_r", 0.0145)
        gap = min(gap, gb)
    return gap


def place_gun(musket, M, frame):
    musket.matrix_basis = M
    musket.keyframe_insert("location", frame=frame)
    musket.keyframe_insert("rotation_quaternion", frame=frame)


def ramrod_span(dz=0.0, drawn=False):
    """(z0, z1) of the rammer in gun-local coordinates for a key_ramrod state (axis on the bore)."""
    L = GUN.get("L", 1.42)
    rb, rt = GUN.get("ramrod_bottom", 0.55), GUN.get("ramrod_top", L - 0.004)
    off = (L - rb + 0.03) if drawn else dz
    return rb + off, rt + off


def key_ramrod(rr, frame, dz=0.0, drawn=False):
    if rr is None:
        return
    L = GUN.get("L", 1.42)
    if drawn:   # pulled clean out and held above the muzzle, in line with the bore
        rr.location = (0.0, 0.023, L - GUN.get("ramrod_bottom", 0.55) + 0.03)
    elif dz:
        rr.location = (0.0, 0.023, dz)
    else:
        rr.location = (0.0, 0.0, 0.0)
    rr.keyframe_insert("location", frame=frame)


def key_cartridge(obj, frame, centre=None, axis=None, up=None, park=None):
    """The paper cartridge: shown at `centre` along `axis` in the hand, else scaled to nothing."""
    if obj is None:
        return
    obj.rotation_mode = "QUATERNION"
    if centre is None:
        obj.location = park if park is not None else Vector((0, 0, 0.9))
        obj.rotation_quaternion = Quaternion()
        obj.scale = (0.0, 0.0, 0.0)
    else:
        x = axis.normalized()
        y = (up - x * up.dot(x)).normalized()
        z = x.cross(y)
        obj.location = centre
        obj.rotation_quaternion = Matrix((x, y, z)).transposed().to_quaternion()
        obj.scale = (1.0, 1.0, 1.0)
    for prop in ("location", "rotation_quaternion", "scale"):
        obj.keyframe_insert(prop, frame=frame)


def hang_kit(ps, frame, swing_deg=0.0, plumb=True):
    """Haversack and canteen hang toward plumb from their strap point, and swing on the march."""
    rig = ps.rig
    out = {}
    for h in HANG:
        bone = h["bone"]
        if bone not in ps.B:
            continue
        pb, B = ps.P(bone), ps.B[bone]
        tail_post = rig.matrix_world @ pb.matrix @ Matrix.Translation((0.0, B.length, 0.0))
        objs = [o for o in bpy.data.objects if o.name.startswith(h["prefix"]) and o.parent == rig
                and o.parent_type == "BONE" and o.parent_bone == bone]
        if not objs:
            continue
        q = Quaternion()
        X0 = tail_post @ objs[0].matrix_parent_inverse
        pivot = X0 @ Vector(h["p"])
        if plumb:
            u = (X0.to_3x3() @ Vector(h.get("up", (0, 0, 1)))).normalized()
            q = Quaternion().slerp(u.rotation_difference(ps.U), UNI.get("hang_plumb", 0.75))
        if swing_deg:
            q = C.rot(ps.L, swing_deg) @ q
        Qw = Matrix.Translation(pivot) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pivot)
        for o in objs:
            X = tail_post @ o.matrix_parent_inverse
            o.rotation_mode = "QUATERNION"
            o.matrix_basis = X.inverted() @ Qw @ X
            for prop in ("location", "rotation_quaternion", "scale"):
                o.keyframe_insert(prop, frame=frame)
        out[h["prefix"]] = round(math.degrees(q.angle), 1)
    REP.setdefault("checks", {}).setdefault("kit_hang_deg", {})[str(frame)] = out


# ------------------------------------------------------------------------------ poses

def gun_grip(ps, s, M, z, side_dir, pole, key, frame, extra=()):
    """Grip the musket at gun-local z with the palm on the side_dir side."""
    gx, gy, gz = gun_axes(M)
    h, w, cy = stock_at(z)
    axis_pt = M @ Vector((0.0, cy if z < GUN.get("stock_tip", 1.22) else GUN.get("barrel_y", 0.006), z))
    surf = GunSurf(M)
    err, res, cand = ps.grip(s, surf, axis_pt, gz, side_dir, pole, key, frame, extra=extra)
    return err, res


def pose_stand(ps, musket, frame):
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    mid = (ps.rest_ank["L"] + ps.rest_ank["R"]) / 2
    err = {}
    for s, sg in (("L", 1), ("R", -1)):
        ank = mid + L * (sg * 0.06)
        ank.z = ps.rest_ank[s].z
        err["leg" + s] = ps.leg(s, ank, F)
        ps.foot(s, ps.foot_rest_dir(s, yaw_deg=sg * 28.0))
    ps.look(F + U * 0.06)
    shR = ps.ph(ps.S["R"]["upper"][0])
    reach = ps.len["R"]["upper"] + ps.len["R"]["lower"]
    zg = (U - F * 0.05).normalized()
    S0 = shR + F * 0.075 + L * 0.03
    palm_z = shR.z - 0.93 * reach - 0.07
    heel_z = palm_z - 0.34
    heel = S0 + zg * ((heel_z - S0.z) / zg.z)
    M = gun_matrix(heel, zg, -F)            # trigger guard to the front
    place_gun(musket, M, frame)
    key = "stand0@%d" % frame
    best = {}

    def solve_r(k):
        pole = -F - L * (0.3 + 6.0 * k)
        if "cand" not in best:
            e_, res = gun_grip(ps, "R", M, G["grip_stand_R"], -L, pole, key, frame)
            best["cand"] = (res["candidate"]["rot_deg"], res["candidate"]["wrap"],
                            res["candidate"]["tilt_deg"], res["candidate"]["slide_m"])
            err["armR"] = e_
        else:
            GRIPLOG[:] = [g for g in GRIPLOG if g[0] != key]
            gx, gy, gz = gun_axes(M)
            h, w, cy = stock_at(G["grip_stand_R"])
            e_, _res, _c = ps.grip("R", GunSurf(M), M @ Vector((0.0, cy, G["grip_stand_R"])), gz, -L, pole,
                                   key, frame, cands=[best["cand"]])
            err["armR"] = e_
    REP["checks"].setdefault("clearance", {})["stand_R"] = ps.clear("R", solve_r)
    shL = ps.ph(ps.S["L"]["upper"][0])
    reachL = ps.len["L"]["upper"] + ps.len["L"]["lower"]

    def solve_l(k):
        err["armL"] = ps.arm("L", shL - U * (0.93 * reachL) + F * (0.05 + 0.4 * k) + L * (0.06 + k),
                             -F + L * 0.3)
        ps.hand("L", -U, palm_want=-L)
        ps.curl("L", degs=(14, 22, 14), thumb=8)
    REP["checks"]["clearance"]["stand_L"] = ps.clear("L", solve_l)
    ps.key(frame)
    return err


def pose_walk(ps, musket, frame, k):
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    p = k / 8.0
    A = G["stance_half_m"]
    feet = {}
    for s, phase in (("L", p), ("R", (p + 0.5) % 1.0)):
        st = G["stance_frac"]
        if phase < st:
            x = A - 2 * A * (phase / st)
            lift = 0.0
            pitch = 12.0 * max(0.0, 1 - phase / 0.12) - 28.0 * max(0.0, (phase - 0.45) / 0.15)
        else:
            u = (phase - st) / (1 - st)
            sm = u * u * (3 - 2 * u)
            x = -A + 2 * A * sm
            lift = G["foot_lift"] * math.sin(math.pi * u)
            pitch = -30.0 * (1 - u) + 12.0 * u
        feet[s] = (x, lift, pitch)
    drop = 0.0
    for s in ("L", "R"):
        x, lift, pitch = feet[s]
        hip = ps.rest_hip[s]
        ank = ps.ank_mid + L * ((1 if s == "L" else -1) * G["march_half_width"]) + F * x
        ank.z += lift + (0.06 * math.sin(math.radians(-pitch)) if pitch < 0 else 0.0)
        reach = 0.995 * (ps.len[s]["thigh"] + ps.len[s]["shin"])
        dxy = (Vector((ank.x - hip.x, ank.y - hip.y, 0))).length
        hz_max = ank.z + math.sqrt(max(reach * reach - dxy * dxy, 0.0))
        drop = max(drop, hip.z - hz_max)
    drop = min(drop, G["walk_drop_max_m"])
    bob = G["walk_bob_m"] * math.cos(4 * math.pi * p)
    sway = 0.015 * math.cos(2 * math.pi * p)
    ps.translate(ps.rm["root"], -U * (drop + bob) + L * sway)
    ps.root_rotate(C.rot(U, -G["pelvis_yaw_deg"] * math.cos(2 * math.pi * p)))
    ps.spine(L, G["march_lean_deg"])
    ps.spine(U, 1.6 * G["pelvis_yaw_deg"] * math.cos(2 * math.pi * p))
    err = {}
    for s in ("L", "R"):
        x, lift, pitch = feet[s]
        ank = ps.ank_mid + L * ((1 if s == "L" else -1) * G["march_half_width"]) + F * x
        ank.z += lift + (0.06 * math.sin(math.radians(-pitch)) if pitch < 0 else 0.0)
        err["leg" + s] = ps.leg(s, ank, F)
        ps.foot(s, ps.foot_rest_dir(s, pitch_deg=pitch, yaw_deg=(6.0 if s == "L" else -6.0)))
    ps.look(F + U * 0.02)
    shR = ps.ph(ps.S["R"]["upper"][0])
    B = shR + F * 0.17 - U * 0.27 + L * 0.07
    Cp = shR + U * 0.075 + F * 0.02
    zg = (Cp - B).normalized()
    M = gun_matrix(B, zg, -F)
    place_gun(musket, M, frame)
    gx, gy, gz = gun_axes(M)
    key = "walk%d@%d" % (k, frame)
    best = {}

    def solve_r(kk):
        pole = -U - L * (0.4 + 6.0 * kk)
        cands = [best["cand"]] if "cand" in best else None
        GRIPLOG[:] = [g for g in GRIPLOG if g[0] != key]
        e_, res, cand = ps.grip("R", GunSurf(M), M @ Vector((0.0, stock_at(G["grip_walk_R"])[2], G["grip_walk_R"])),
                                gz, -gy - L * 0.3, pole, key, frame, cands=cands)
        best["cand"] = cand
        err["armR"] = e_
    REP["checks"].setdefault("clearance", {})["walk%d_R" % k] = ps.clear("R", solve_r)
    shL = ps.ph(ps.S["L"]["upper"][0])
    reachL = ps.len["L"]["upper"] + ps.len["L"]["lower"]
    swing = G["arm_swing_deg"] * math.cos(2 * math.pi * p)
    down = C.rot(L, swing) @ (-U)

    def solve_l(kk):
        err["armL"] = ps.arm("L", shL + down * (0.93 * reachL) + L * (0.03 + kk) + F * (0.3 * kk), -F + L * 0.2)
        ps.hand("L", down + F * 0.1, palm_want=-L)
        ps.curl("L", degs=(15, 25, 15), thumb=8)
    REP["checks"]["clearance"]["walk%d_L" % k] = ps.clear("L", solve_l)
    a = M.translation
    sh_top = shR + U * 0.06
    d_axis = ((sh_top - a) - gz * (sh_top - a).dot(gz)).length
    REP["checks"].setdefault("musket_axis_to_shoulder_top_m", {})["walk%d" % k] = round(d_axis, 4)
    ps.key(frame)
    return err


def pose_fire(ps, musket, frame, stage):
    """stage 0 aim, 1 fire (recoil), 2 recover (piece brought down to the priming position)."""
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    yaw = G["aim_body_yaw_deg"] + (4.0 if stage == 1 else 0.0)
    back = {0: 0.0, 1: G["recoil_back_m"], 2: 0.0}[stage]
    rise = {0: 0.0, 1: G["recoil_deg"], 2: 0.0}[stage]       # aim: level barrel
    ps.translate(ps.rm["root"], -U * 0.025 - F * back)
    ps.root_rotate(C.rot(U, yaw))
    ps.spine(U, -yaw * 0.30)
    ps.spine(L, {0: 9.0, 1: -12.0, 2: 3.0}[stage])    # aim leans in; the shot rocks him back
    err = {}
    ankL = ps.ank_mid + L * G["fire_half_width"] + F * 0.20
    ankR = ps.ank_mid - L * G["fire_half_width"] - F * 0.16
    err["legL"] = ps.leg("L", ankL, F + L * 0.2)
    err["legR"] = ps.leg("R", ankR, F - L * 0.6)
    ps.foot("L", ps.foot_rest_dir("L", yaw_deg=-12.0))
    ps.foot("R", ps.foot_rest_dir("R", yaw_deg=-72.0))
    key = "fire%d@%d" % (stage, frame)
    if stage < 2:
        # aim: head down on the stock; fire: head thrown up with the recoil
        ps.look(F - U * (0.30 if stage == 0 else -0.10), roll_deg=-20.0 if stage == 0 else -6.0)
        shR = ps.ph(ps.S["R"]["upper"][0])
        P0 = shR + F * 0.03 + L * 0.07 + U * 0.03
        zdir = C.rot(L, -rise) @ F
        M0 = gun_matrix(P0, zdir, U)
        gx, gy, gz = gun_axes(M0)
        M = gun_matrix(P0 + gy * 0.05, zdir, U)
        place_gun(musket, M, frame)
        gx, gy, gz = gun_axes(M)
        # left hand cradles the forestock from below; right hand round the wrist of the stock,
        # palm on the lock (right, -x) side
        err["armL"], _ = gun_grip(ps, "L", M, G["grip_aim_L"], -gy + gx * 0.25, -U + L * 0.2, key, frame)
        err["armR"], _ = gun_grip(ps, "R", M, G["grip_aim_R"], -gx + gy * 0.2, -L - U * 0.3, key, frame)
    else:
        ps.look(F * 0.9 - U * 0.25)
        hipR = ps.ph(ps.S["R"]["thigh"][0])
        Fy = C.rot(U, yaw * 0.7) @ F
        heel = hipR + Fy * 0.16 + U * 0.04 - L * 0.02
        zdir = (Fy * 0.62 + U * 0.75 + L * 0.22).normalized()
        M = gun_matrix(heel, zdir, U)
        place_gun(musket, M, frame)
        gx, gy, gz = gun_axes(M)
        err["armL"], _ = gun_grip(ps, "L", M, G["grip_recover_L"], -gy + gx * 0.3, -U + L * 0.5, key, frame)
        err["armR"], _ = gun_grip(ps, "R", M, G["grip_recover_R"], -gx, -U - L * 0.6, key, frame)
    ps.key(frame)
    return err


def pose_fallen(ps, musket, frame):
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    ps.root_rotate(C.rot(L, -86.0))
    ps.root_rotate(C.rot(U, 20.0))
    Fb = C.rot(U, 20.0) @ F
    Lb = C.rot(U, 20.0) @ L
    pel = ps.pelvis()
    target = Vector((0, 0, 0)) + Fb * 0.05
    target.z = 0.11
    ps.translate(ps.rm["root"], target - pel)
    ps.spine(Lb, -4.0)
    err = {}
    hipL = ps.ph(ps.S["L"]["thigh"][0])
    hipR = ps.ph(ps.S["R"]["thigh"][0])
    aL = hipL + Fb * 0.84 + Lb * 0.08
    aL.z = 0.09
    aR = hipR + Fb * 0.52 - Lb * 0.10
    aR.z = 0.10
    err["legL"] = ps.leg("L", aL, U + Lb * 0.3)
    err["legR"] = ps.leg("R", aR, U - Lb * 0.3)
    ps.foot("L", U * 0.5 + Fb * 0.6 + Lb * 0.6)
    ps.foot("R", U * 0.6 + Fb * 0.5 - Lb * 0.5)
    ps.look(U * 0.6 - Lb * 0.8)
    shR = ps.ph(ps.S["R"]["upper"][0])
    shL = ps.ph(ps.S["L"]["upper"][0])
    wR = shR - Lb * 0.42 - Fb * 0.30
    wR.z = 0.06
    wL = shL + Fb * 0.36 - Lb * 0.12
    wL.z = 0.22
    err["armR"] = ps.arm("R", wR, U)
    err["armL"] = ps.arm("L", wL, Lb + U * 0.5)
    ps.hand("R", -Lb - Fb * 0.3, palm_want=U)
    ps.hand("L", -Lb, palm_want=-U)
    ps.curl("R", degs=(25, 30, 20), thumb=10)
    ps.curl("L", degs=(20, 25, 15), thumb=10)
    heel = ps.pelvis() - Lb * 0.55 + Fb * 0.35
    heel.z = 0.022
    M = gun_matrix(heel, C.rot(U, -25.0) @ (-Fb), -Lb)
    place_gun(musket, M, frame)
    ps.key(frame)
    return err


def pose_load(ps, musket, frame, step, rr, cart):
    """0 cartridge from the box, 1 charge at the muzzle, 2 draw the rammer, 3 ram, 4 prime."""
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    err = {}
    ankL = ps.ank_mid + L * 0.08 + F * 0.04
    ankL.z = ps.rest_ank["L"].z
    ankR = ps.ank_mid - L * 0.10 - F * 0.12
    ankR.z = ps.rest_ank["R"].z
    ps.translate(ps.rm["root"], -U * 0.012)
    err["legL"] = ps.leg("L", ankL, F)
    err["legR"] = ps.leg("R", ankR, F - L * 0.3)
    ps.foot("L", ps.foot_rest_dir("L", yaw_deg=10.0))
    ps.foot("R", ps.foot_rest_dir("R", yaw_deg=-35.0))
    ps.spine(L, 5.0 if step < 4 else 2.0)
    Lg = GUN.get("L", 1.42)
    by = GUN.get("barrel_y", 0.006)
    key = "load%d@%d" % (step, frame)
    park = ps.ph(ps.S["R"]["hand"])
    if step < 4:
        heel = ps.ank_mid + F * 0.20 + L * 0.06
        heel.z = 0.0
        zdir = (U - F * 0.12 + L * 0.03).normalized()
        M = gun_matrix(heel, zdir, -F)
        place_gun(musket, M, frame)
        gx, gy, gz = gun_axes(M)
        muzzle = M @ Vector((0.0, by, Lg))
        ps.look(F - U * 0.28 + L * 0.08)
        if step in (0, 1):
            key_ramrod(rr, frame)
            # the cartridge is placed in the world first (above the open box; then over the muzzle,
            # torn end down) and the right hand grips it like any object, but with the palm held
            # off so only the thumb and first two fingers close on it (ring and little curl
            # relaxed): a fingertip pinch that leaves most of the cartridge in view
            cl, cr = UNI.get("cartridge_len", 0.068), UNI.get("cartridge_r", 0.0075)
            if step == 0:
                box = next((c for n, c, r in ps.obstacles() if n == "cartridge box"), None)
                centre = (box + U * 0.10) if box is not None else ps.ph(ps.S["R"]["thigh"][0]) - F * 0.12
                X = (L * 0.8 + F * 0.3).normalized()
                nv, pole = (U - F * 0.3).normalized(), -L - F * 0.3
            else:
                centre = muzzle + U * (cl / 2 + 0.015)
                X = gz.copy()                              # upright, torn end toward the muzzle
                nv, pole = (-F * 0.6 - L * 0.5 + U * 0.2).normalized(), -U - L * 0.5
            a = centre - X * (cl / 2)
            surf = CylSurf(a, X, cr, cl)
            err["armR"], res, _c = ps.grip("R", surf, centre, X, nv, pole, key, frame, extra=(GunSurf(M),),
                                           palm_off=0.024, skip=(3, 4))
            for ci in (3, 4):
                for k, bn in enumerate(ps.S["R"]["fingers"][ci]):
                    ax = ps.flex_axis("R", ci, k, bn)
                    if ax is not None:
                        ps.rotate_about(bn, ps.ph(bn), C.rot(ax, (55.0, 60.0, 40.0)[k]))
            res["object"] = "cartridge"
            key_cartridge(cart, frame, centre, X, nv)
        elif step == 2:
            key_ramrod(rr, frame, drawn=True)
            z0, z1 = ramrod_span(drawn=True)
            a = M @ Vector((0.0, by, z0))
            surf = CylSurf(a, gz, 0.0045, z1 - z0)
            hold = M @ Vector((0.0, by, Lg + G["grip_rammer_drawn"]))
            e_, res, _c = ps.grip("R", surf, hold, gz, -F - L * 0.4, -L - U * 0.2, key, frame,
                                  extra=(GunSurf(M),))
            err["armR"] = e_
            key_cartridge(cart, frame, park=park)
        else:
            key_ramrod(rr, frame, dz=G["rammer_ram_dz"])
            z0, z1 = ramrod_span(dz=G["rammer_ram_dz"])
            a = M @ Vector((0.0, by, z0))
            surf = CylSurf(a, gz, 0.0045, z1 - z0)
            hold = M @ Vector((0.0, by, Lg + G["grip_rammer_ram"]))
            e_, res, _c = ps.grip("R", surf, hold, gz, -F - L * 0.4, -L - U * 0.3, key, frame,
                                  extra=(GunSurf(M),))
            err["armR"] = e_
            key_cartridge(cart, frame, park=park)
        err["armL"], _ = gun_grip(ps, "L", M, G["grip_load_L"], L * 0.8 - F * 0.4, -U + L * 0.6, key, frame)
    else:
        key_ramrod(rr, frame)
        key_cartridge(cart, frame, park=park)
        hipR = ps.ph(ps.S["R"]["thigh"][0])
        heel = hipR + F * 0.18 + U * 0.02 + L * 0.02
        zdir = (F * 0.55 + U * 0.80 + L * 0.22).normalized()
        M = gun_matrix(heel, zdir, U)
        place_gun(musket, M, frame)
        gx, gy, gz = gun_axes(M)
        ps.look(F * 0.8 - U * 0.4)
        err["armL"], _ = gun_grip(ps, "L", M, G["grip_prime_L"], -gy + gx * 0.3, -U + L * 0.5, key, frame)
        err["armR"], _ = gun_grip(ps, "R", M, G["grip_prime_R"], -gx, -U - L * 0.6, key, frame)
    ps.key(frame)
    return err


# ------------------------------------------------------------------------------ hand model

def measure_hands(ps, body):
    """From the rest mesh (shape keys on, no armature): per finger segment the pad thickness and
    the pad-side direction (opposite the fingernail), the palm thickness, the palm centre and
    the hand's rest frame, all stored in bone-local coordinates."""
    rig = ps.rig
    C.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    M = np.array(rig.matrix_world.inverted() @ body.matrix_world)
    Pw = co @ M[:3, :3].T + M[:3, 3]
    roles = json.loads(body.get("tcw_slot_roles", "[]"))
    nail_idx = roles.index("fingernails") if "fingernails" in roles else -1
    nail_verts = set()
    if nail_idx >= 0:
        for poly in me.polygons:
            if poly.material_index == nail_idx:
                nail_verts.update(poly.vertices)
    ev.to_mesh_clear()
    if n != len(body.data.vertices):
        raise RuntimeError("evaluated body has %d verts, data %d" % (n, len(body.data.vertices)))
    gi = {g.index: g.name for g in body.vertex_groups}
    hand_bones = set()
    for s in ("L", "R"):
        d = ps.S[s]
        hand_bones.add(d["hand"])
        for chain in d["fingers"]:
            hand_bones.update(chain)
        for k in range(1, 5):
            hand_bones.add("metacarpal%d.%s" % (k, s))
    owner = {}
    for v in body.data.vertices:
        best, bw = None, 0.3
        for g in v.groups:
            nm = gi.get(g.group)
            if nm in hand_bones and g.weight > bw:
                best, bw = nm, g.weight
        if best:
            owner[v.index] = best
    by_bone = {}
    for i, b in owner.items():
        by_bone.setdefault(b, []).append(i)
    pal_local, pad, rad, report = {}, {}, {}, {}

    def axis_pt(b, p):
        h, t = ps.rh(b), ps.rt(b)
        ab = t - h
        u = max(0.0, min(1.0, (p - h).dot(ab) / max(1e-9, ab.dot(ab))))
        return h + ab * u, ab.normalized()

    hands = {}
    for s in ("L", "R"):
        d = ps.S[s]
        dorsal = {}
        for ci, chain in enumerate(d["fingers"]):
            dist_b = chain[-1]
            nv = [i for i in by_bone.get(dist_b, []) if i in nail_verts]
            if len(nv) >= 3:
                nc = Vector(Pw[nv].mean(axis=0).tolist())
                q, ax = axis_pt(dist_b, nc)
                dv = (nc - q)
                dv = (dv - ax * dv.dot(ax))
                if dv.length > 1e-6:
                    dorsal[ci] = dv.normalized()
        report[s] = {"nails_found": sorted(dorsal.keys())}
        fb_pal, fb_hd = ps.palm(s)
        H0 = (ps.rh(d["fingers"][2][0]) - ps.rh(d["hand"])).normalized()
        if dorsal:
            ph_ = -sum((dorsal[c] for c in dorsal if c > 0), Vector()) if any(c > 0 for c in dorsal) else -dorsal[0]
        else:
            ph_ = fb_pal
        P0 = (ph_ - H0 * ph_.dot(H0)).normalized()
        report[s]["palmar_vs_second_pass_deg"] = round(math.degrees(P0.angle(fb_pal)), 1)
        for ci, chain in enumerate(d["fingers"]):
            dv = dorsal.get(ci, -P0)
            for b in chain:
                if b not in ps.B:
                    continue
                h, t = ps.rh(b), ps.rt(b)
                ax = (t - h).normalized()
                pw = -(dv - ax * dv.dot(ax))
                if pw.length < 1e-6:
                    pw = P0.copy()
                pw.normalize()
                Bm = ps.B[b].matrix_local.to_3x3()
                pal_local[b] = list(Bm.inverted() @ pw)
                ds, dp = [], []
                for i in by_bone.get(b, []):
                    p = Vector(Pw[i].tolist())
                    q, _ax = axis_pt(b, p)
                    r = p - q
                    ds.append(r.length)
                    if r.dot(pw) > 0.3 * r.length:
                        dp.append(r.length)
                if ds:
                    rad[b] = float(np.percentile(ds, 60))
                    pad[b] = float(np.percentile(dp, G["pad_percentile"])) if len(dp) >= 3 else rad[b]
                else:
                    rad[b] = pad[b] = 0.0085
        kn = [ps.rh(d["fingers"][c][0]) for c in (1, 2, 3, 4)]
        pc0 = sum(kn, Vector()) / 4 * 0.55 + ps.rh(d["hand"]) * 0.45
        palm_ds = []
        for k in range(1, 5):
            for i in by_bone.get("metacarpal%d.%s" % (k, s), []):
                dd = (Vector(Pw[i].tolist()) - pc0).dot(P0)
                if dd > 0:
                    palm_ds.append(dd)
        palm_pad = float(np.percentile(palm_ds, 85)) if len(palm_ds) >= 5 else 0.016
        pcr = pc0 + P0 * palm_pad
        Bw = ps.B[d["hand"]].matrix_local
        hands[s] = {"H0": list(Bw.to_3x3().inverted() @ H0), "P0": list(Bw.to_3x3().inverted() @ P0),
                    "pc_local": list(Bw.inverted() @ pcr), "palm_pad": palm_pad}
        report[s].update({"palm_pad_mm": round(palm_pad * 1000, 1),
                          "pad_mm": {b: round(pad[b] * 1000, 1) for c in d["fingers"] for b in c if b in pad},
                          "hand_vertices": sum(len(by_bone.get(b, [])) for b in hand_bones if b.endswith("." + s))})
    HM.update({"palmar_local": pal_local, "pad": pad, "radius": rad, "hand": hands, "owner": owner})
    REP["hand_model"] = report


def measure_contacts(ps, body):
    """The real skinned hand mesh against each logged grip surface: segments in contact (a vertex
    of that segment within contact_mm of the surface) and the deepest penetration (into the
    target or any other surface logged for that frame, e.g. the musket while holding the rammer)."""
    sc = bpy.context.scene
    arm = [m for m in body.modifiers if m.type == "ARMATURE"]
    other = [m for m in body.modifiers if m.type != "ARMATURE"]
    state = [(m, m.show_viewport) for m in body.modifiers]
    for m in arm:
        m.show_viewport = True
    for m in other:
        m.show_viewport = False
    owner = HM.get("owner", {})
    seg_of = {}
    for s in ("L", "R"):
        for ci, chain in enumerate(ps.S[s]["fingers"]):
            for b in chain:
                seg_of[b] = (s, ci)
    out = {}
    try:
        for key, frame, s, surf, extra in GRIPLOG:
            sc.frame_set(frame)
            C.update()
            dg = bpy.context.evaluated_depsgraph_get()
            ev = body.evaluated_get(dg)
            me = ev.to_mesh()
            n = len(me.vertices)
            co = np.empty(n * 3, dtype=np.float64)
            me.vertices.foreach_get("co", co)
            ev.to_mesh_clear()
            co = co.reshape(-1, 3)
            Mx = ps.rig.matrix_world.inverted() @ body.matrix_world
            seg_min = {}
            worst, n_pen, n_v = 0.0, 0, 0
            pen_by = {}
            for i, b in owner.items():
                if not b.endswith("." + s) or i >= n:
                    continue
                p = Mx @ Vector(co[i].tolist())
                gt = surf.gap(p)
                ga = min([gt] + [x.gap(p) for x in extra])
                n_v += 1
                if ga < -0.001:
                    n_pen += 1
                    pen_by[b] = max(pen_by.get(b, 0.0), -ga)
                worst = max(worst, -ga)
                if b in seg_of:
                    seg_min[b] = min(seg_min.get(b, 1.0), gt)
            cmm = G["contact_mm"] / 1000.0
            touching = sorted(b for b, gmin in seg_min.items() if gmin <= cmm)
            thumb = sum(1 for b in touching if seg_of[b][1] == 0)
            out.setdefault(key, {})[s] = {"segments_touching": len(touching), "segments": 15, "thumb_segments": thumb,
                                          "max_penetration_mm": round(max(0.0, worst) * 1000, 1),
                                          "vertices_over_1mm_inside": n_pen, "hand_vertices": n_v,
                                          "penetration_by_bone_mm": {b: round(v * 1000, 1) for b, v in sorted(pen_by.items(), key=lambda x: -x[1])[:5]}}
    finally:
        for m, v in state:
            m.show_viewport = v
    REP["grip_mesh"] = out
    return out


def sole_points(side):
    o = bpy.data.objects.get("tcw_brogan_sole_" + side)
    if o is None:
        return None
    mw = o.matrix_world
    return np.array([(mw @ v.co)[:] for v in o.data.vertices])


def foot_slip(soles, F, shift):
    f2 = np.array([F.x, F.y, 0.0])
    out = {}
    for s, frames in soles.items():
        worst, n = 0.0, 0
        for k in range(len(frames)):
            a, b = frames[k], frames[(k + 1) % len(frames)]
            if a is None or b is None:
                continue
            m = (a[:, 2] < 0.006) & (b[:, 2] < 0.006)
            if not m.any():
                continue
            disp = (b - a)[m]
            disp[:, 2] = 0.0
            err = disp + f2 * shift
            worst = max(worst, float(np.linalg.norm(err, axis=1).max()))
            n += int(m.sum())
        out[s] = {"max_slip_m": round(worst, 4), "contact_samples": n}
    return out


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(C.WORK, "soldier.blend"))
    T.mark("open soldier.blend")
    sc = bpy.context.scene
    GUN.update(json.loads(sc.get("tcw_musket", "{}")))
    OBST.extend(json.loads(sc.get("tcw_obstacles", "[]")))
    HANG.extend(json.loads(sc.get("tcw_hang", "[]")))
    UNI.update(json.loads(sc.get("tcw_uniform_consts", "{}")))
    REP["obstacles"] = len(OBST)
    rig, rm = C.find_rig(), C.rigmap()
    body = C.find_body()
    musket = bpy.data.objects["tcw_musket"]
    musket.rotation_mode = "QUATERNION"
    rr = bpy.data.objects.get("tcw_ramrod")
    cart = bpy.data.objects.get("tcw_cartridge")
    saved = []
    for o in bpy.data.objects:
        if o.type == "MESH":
            for md in o.modifiers:
                if md.show_viewport:
                    saved.append(md)
                    md.show_viewport = False
    ps = Poser(rig, rm)
    REP["frame_basis"] = {"F": list(ps.F), "L": list(ps.L)}
    REP["limb_lengths_m"] = ps.len
    measure_hands(ps, body)
    PROBE["p"] = MeshProbe(ps, body)
    T.mark("hand model")

    def run(name, frame, fn, swing=0.0, plumb=True):
        t = C.time.time()
        sc.frame_set(frame)
        err = fn()
        try:
            hang_kit(ps, frame, swing, plumb)
        except Exception as e:  # noqa: BLE001
            REP.setdefault("hang_errors", []).append("%d: %s" % (frame, e))
        REP["ik_error_m"]["%s@%d" % (name, frame)] = {k: round(v, 4) for k, v in err.items()}
        REP["frames"]["%s@%d" % (name, frame)] = round(C.time.time() - t, 2)

    run("stand", 1, lambda: pose_stand(ps, musket, 1))
    key_ramrod(rr, 1)
    key_cartridge(cart, 1, park=ps.ph(ps.S["R"]["hand"]))
    hd = ps.face_dir()
    REP["checks"]["stand_head"] = {"pitch_deg": round(math.degrees(math.asin(max(-1, min(1, hd.dot(ps.U))))), 1),
                                   "yaw_deg": round(math.degrees(math.atan2(hd.dot(ps.L), hd.dot(ps.F))), 1)}
    soles = {"L": [], "R": []}
    for k, f in enumerate(FR["walk"]):
        sw = UNI.get("hang_swing_deg", 5.0) * math.sin(2 * math.pi * (k / 8.0 - UNI.get("hang_lag", 0.15)) * 2)
        run("walk", f, lambda k=k, f=f: pose_walk(ps, musket, f, k), swing=sw)
        key_ramrod(rr, f)
        key_cartridge(cart, f, park=ps.ph(ps.S["R"]["hand"]))
        C.update()
        for s in ("L", "R"):
            soles[s].append(sole_points(s))
    for st, f in enumerate(FR["fire"]):
        run("fire", f, lambda st=st, f=f: pose_fire(ps, musket, f, st))
        key_ramrod(rr, f)
        key_cartridge(cart, f, park=ps.ph(ps.S["R"]["hand"]))
    run("fallen", 31, lambda: pose_fallen(ps, musket, 31), plumb=False)
    key_ramrod(rr, 31)
    key_cartridge(cart, 31, park=ps.ph(ps.S["R"]["hand"]))
    for st, f in enumerate(FR["load"]):
        run("load", f, lambda st=st, f=f: pose_load(ps, musket, f, st, rr, cart))
    T.mark("posed all frames")

    ad_objs = [rig, musket] + ([rr] if rr else []) + ([cart] if cart else [])
    ad_objs += [o for o in bpy.data.objects if any(o.name.startswith(h["prefix"]) for h in HANG)]
    for ob in ad_objs:
        ad = ob.animation_data
        if ad and ad.action:
            for fc in ad.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"
    try:
        measure_contacts(ps, body)
    except Exception as e:  # noqa: BLE001
        import traceback
        REP["grip_mesh_error"] = traceback.format_exc()[-1500:]
        C.log("measure_contacts FAILED:", e)
    T.mark("mesh contact measurement")
    for md in saved:
        md.show_viewport = True
    sc.frame_start, sc.frame_end = 1, 45
    worst = max((v for d in REP["ik_error_m"].values() for v in d.values()), default=0.0)
    REP["ik_error_worst_m"] = worst
    cycle_s = 2.0 * 60.0 / G["steps_per_min"]
    metres_cycle = 2 * G["stance_half_m"] / G["stance_frac"]
    REP["checks"]["walk_foot_slip"] = foot_slip(soles, ps.F, metres_cycle / len(FR["walk"]))
    clips = {
        "stand": {"frames": FR["stand"], "fps": 1, "loop": False},
        "walk": {"frames": FR["walk"], "fps": round(8 / cycle_s, 3), "loop": True,
                 "metres_per_cycle": round(metres_cycle, 3),
                 "speed_mps": round(metres_cycle / cycle_s, 3),
                 "drill_metres_per_cycle": round(2 * G["step_m"], 3)},
        "fire": {"frames": FR["fire"], "fps": 8, "loop": False,
                 "note": "0 aim, 1 fire (recoil; the game adds the flash), 2 recover"},
        "fallen": {"frames": FR["fallen"], "fps": 1, "loop": False},
        "load": {"frames": FR["load"], "fps": 2, "loop": False,
                 "note": "0 cartridge from the box (held in the fingers), 1 charge at the muzzle (cartridge), "
                         "2 draw rammer, 3 ram, 4 prime"},
    }
    REP["clips"] = clips
    # a compact per-clip summary of the mesh-measured grips
    summ = {}
    for key, sides in REP.get("grip_mesh", {}).items():
        for s, v in sides.items():
            summ["%s %s" % (key, s)] = "%d/15 segments (thumb %d), max penetration %.1f mm" % (
                v["segments_touching"], v["thumb_segments"], v["max_penetration_mm"])
    REP["grip_summary"] = summ
    REP["mesh_probe_evaluations"] = PROBE["p"].evals
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, "posed.blend"), compress=False)
    T.mark("saved posed.blend")
    REP["timing"] = T.marks
    C.write_report("poses", REP)


main()
