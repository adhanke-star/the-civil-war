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
#   load    frames 41-45   (second pass) butt on the ground: hand to the cartridge box, charge at
#                          the muzzle, draw the rammer, ram, prime at the right side
#
# Limbs are placed with an analytic two-bone IK toward world targets. Second pass: the fingers
# on the musket close until they touch the stock (a contact solve against the stock's real
# cross-section), and arms are pushed clear of the blanket roll, haversack, canteen and
# cartridge box (spheres written by uniform.py). report/poses.json "checks" holds the measured
# foot slip, musket-to-shoulder distance, head pitch and arm clearance.
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
    "stance_half_m": 0.36,      # ankle travel each side of the hip in stance placeholder
    "march_half_width": 0.085,  # ankle offset from the centre line, marching placeholder
    "fire_half_width": 0.13,    # ankle offset from the centre line, firing   placeholder
    "foot_lift": 0.09,          # swing clearance of the ankle                placeholder
    "march_lean_deg": 4.0,      #                                             placeholder
    "pelvis_yaw_deg": 4.0,      #                                             placeholder
    "arm_swing_deg": 16.0,      # free (left) arm swing                       placeholder
    "aim_body_yaw_deg": -40.0,  # body turned right of the line of fire       placeholder
    "recoil_deg": 16.0,         # muzzle rise at the shot (second pass: was 7) placeholder
    "recoil_back_m": 0.07,      # shoulders driven back at the shot           placeholder
    "finger_r": (0.0095, 0.0085, 0.0075),  # finger radius by segment, for the grip contact placeholder
}
FR = {"stand": [1], "walk": list(range(11, 19)), "fire": [21, 22, 23], "fallen": [31],
      "load": [41, 42, 43, 44, 45]}

T = C.Timer()
REP = {"constants": G, "frames": {}, "ik_error_m": {}, "checks": {}}
GUN = {}
OBST = []


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
        # MPFB's rest pose stands with the feet apart; poses place ankles from the centre line
        self.ank_mid = (self.rest_ank["L"] + self.rest_ank["R"]) / 2
        for p in rig.pose.bones:
            p.rotation_mode = "QUATERNION"

    # ---- rest and posed positions (armature space)
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

    # ---- primitive operations
    def reset(self):
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

    def palm(self, s):
        d = self.S[s]
        f = d["fingers"]
        wr = self.ph(d["hand"])
        hand_dir = (self.ph(f[2][0]) - wr).normalized()
        thumb = (self.ph(f[0][0]) - self.ph(f[4][0])).normalized()
        n = hand_dir.cross(thumb)
        return (n if s == "L" else -n).normalized(), hand_dir

    def hand(self, s, direction, palm_want=None):
        hb = self.S[s]["hand"]
        self.aim(hb, hb, self.ph(hb) + direction.normalized() * self.B[hb].length)
        if palm_want is not None:
            cur, hd = self.palm(s)
            pw = palm_want - hd * palm_want.dot(hd)
            cp = cur - hd * cur.dot(hd)
            if pw.length > 1e-6 and cp.length > 1e-6:
                q = cp.normalized().rotation_difference(pw.normalized())
                if q.angle > math.radians(90):  # a wrist cannot twist further without a forearm roll
                    q = Quaternion().slerp(q, math.radians(90) / q.angle)
                self.rotate_about(hb, self.ph(hb), q)

    def curl(self, s, degs=(35, 50, 40), thumb=20):
        for ci, chain in enumerate(self.S[s]["fingers"]):
            for k, bn in enumerate(chain):
                if bn not in self.B:
                    continue
                palm, _ = self.palm(s)
                dvec = (self.pt(bn) - self.ph(bn)).normalized()
                axis = dvec.cross(palm)
                if axis.length < 1e-6:
                    continue
                ang = thumb * (1.0 if k == 0 else 0.6) if ci == 0 else degs[min(k, 2)]
                self.rotate_about(bn, self.ph(bn), C.rot(axis, ang))

    # ---- second pass: fingers close on the stock until they touch it
    def grip_curl(self, s, M, amax=(80.0, 95.0, 75.0), thumb_max=(55.0, 45.0, 40.0)):
        Minv = M.inverted()
        touched, total = 0, 0
        for ci, chain in enumerate(self.S[s]["fingers"]):
            for k, bn in enumerate(chain):
                if bn not in self.B:
                    continue
                total += 1
                pb = self.P(bn)
                base = pb.matrix_basis.copy()
                palm, _ = self.palm(s)
                head = self.ph(bn)
                dvec = (self.pt(bn) - head).normalized()
                axis = dvec.cross(palm)
                if axis.length < 1e-6:
                    continue
                axis.normalize()
                lim = (thumb_max if ci == 0 else amax)[min(k, 2)]
                rad = G["finger_r"][min(k, 2)]

                def test(a, bn=bn, pb=pb, base=base, axis=axis, rad=rad):
                    pb.matrix_basis = base
                    C.update()
                    if a:
                        self.rotate_about(bn, self.ph(bn), C.rot(axis, a))
                    return gun_gap(Minv, self.pt(bn)) - rad

                if test(0.0) <= 0.0:
                    touched += 1
                    continue
                if test(lim) > 0.0:
                    continue
                lo, hi = 0.0, lim
                for _ in range(8):
                    mid = (lo + hi) / 2
                    if test(mid) > 0.0:
                        lo = mid
                    else:
                        hi = mid
                test(hi)
                touched += 1
        return {"segments_touching": touched, "segments": total}

    def place_on_gun(self, s, M, zg, want_dir, pole, tilt_deg=0.0):
        """Wrist placed so the palm sits against the stock (or barrel) at gun-local z = zg, on the
        side given by want_dir (world), fingers wrapping round; then the contact curl. Run 5
        showed some hands never touching the stock, so four hand orientations (which way the
        fingers point round the stock, which way the palm faces) are tried and the one with the
        most finger segments in contact is kept."""
        gx, gy, gz = gun_axes(M)
        h, w, cy = stock_at(zg)
        A = M @ Vector((0.0, cy, zg))
        nv = want_dir - gz * want_dir.dot(gz)
        nv.normalize()
        r = (h + w) / 4
        pc = A + nv * (r + 0.022)
        t0 = gz.cross(nv).normalized()
        sh = self.ph(self.S[s]["upper"][0])
        if t0.dot(pc - sh) < 0:
            t0 = -t0

        def attempt(tsign, psign):
            self.reset_arm(s)
            t = t0 * tsign
            if tilt_deg:
                t = (t * math.cos(math.radians(tilt_deg)) + gz * math.sin(math.radians(tilt_deg))).normalized()
            err = self.arm(s, pc - t * 0.055, pole)
            self.hand(s, t, palm_want=-nv * psign)
            return err, self.grip_curl(s, M)

        best = None
        for tsign, psign in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            err, g = attempt(tsign, psign)
            score = g["segments_touching"] - 20.0 * max(0.0, err - 0.01)
            if best is None or score > best[0]:
                best = (score, tsign, psign)
            if g["segments_touching"] >= 10 and err < 0.01:
                break
        err, g = attempt(best[1], best[2])
        g["orientation"] = [best[1], best[2]]
        return err, g

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
    h, w, cy = stock_at(q.z)
    e = math.hypot(q.x / (w / 2), (q.y - cy) / (h / 2))
    gap = (e - 1.0) * min(w, h) / 2
    if q.z >= GUN.get("br0", 0.4) - 0.01 and q.z <= GUN.get("L", 1.42):
        gb = math.hypot(q.x, q.y - GUN.get("barrel_y", 0.006)) - GUN.get("barrel_r", 0.0145)
        gap = min(gap, gb)
    return gap


def place_gun(musket, M, frame):
    musket.matrix_basis = M
    musket.keyframe_insert("location", frame=frame)
    musket.keyframe_insert("rotation_quaternion", frame=frame)


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


# ------------------------------------------------------------------------------ poses

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
    ps.look(F + U * 0.06)   # second pass: head up, eyes to the front
    shR = ps.ph(ps.S["R"]["upper"][0])
    reach = ps.len["R"]["upper"] + ps.len["R"]["lower"]
    zg = (U - F * 0.05).normalized()
    S0 = shR + F * 0.075 + L * 0.03
    palm_z = shR.z - 0.93 * reach - 0.07
    heel_z = palm_z - 0.34
    heel = S0 + zg * ((heel_z - S0.z) / zg.z)
    M = gun_matrix(heel, zg, -F)            # trigger guard to the front
    place_gun(musket, M, frame)
    guard = heel + zg * 0.34
    grips = {}

    def solve_r(k):
        err["armR"] = ps.arm("R", guard - L * 0.035 - F * 0.01 + U * 0.065, -F - L * (0.3 + 6.0 * k))
        ps.hand("R", -U + F * 0.15, palm_want=L)
        grips["R"] = ps.grip_curl("R", M)
    REP["checks"].setdefault("clearance", {})["stand_R"] = ps.clear("R", solve_r)
    shL = ps.ph(ps.S["L"]["upper"][0])
    reachL = ps.len["L"]["upper"] + ps.len["L"]["lower"]

    def solve_l(k):
        # arm hangs in front of the haversack, little finger toward the trouser seam
        err["armL"] = ps.arm("L", shL - U * (0.93 * reachL) + F * (0.05 + 0.4 * k) + L * (0.06 + k),
                             -F + L * 0.3)
        ps.hand("L", -U, palm_want=-L)
        ps.curl("L", degs=(14, 22, 14), thumb=8)
    REP["checks"]["clearance"]["stand_L"] = ps.clear("L", solve_l)
    REP.setdefault("grips", {})["stand@%d" % frame] = grips
    ps.key(frame)
    return err


def pose_walk(ps, musket, frame, k):
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    p = k / 8.0
    A = G["stance_half_m"]            # stance excursion half-length; ground speed follows from it
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
    bob = 0.012 * math.cos(4 * math.pi * p)
    sway = 0.015 * math.cos(2 * math.pi * p)
    ps.translate(ps.rm["root"], -U * (drop + 0.01 + bob) + L * sway)
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
    # right shoulder shift
    shR = ps.ph(ps.S["R"]["upper"][0])
    B = shR + F * 0.17 - U * 0.27 + L * 0.07
    Cp = shR + U * 0.075 + F * 0.02
    zg = (Cp - B).normalized()
    M = gun_matrix(B, zg, -F)
    place_gun(musket, M, frame)
    gx, gy, gz = gun_axes(M)
    grip = M @ Vector((0, -0.07, 0.035))
    grips = {}

    def solve_r(kk):
        err["armR"] = ps.arm("R", grip - gy * 0.035 - gz * 0.05, -U - L * (0.4 + 6.0 * kk))
        ps.hand("R", gz, palm_want=gy)
        grips["R"] = ps.grip_curl("R", M)
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
    # check: the musket's axis passes over the shoulder
    a = M.translation
    sh_top = shR + U * 0.06
    d_axis = ((sh_top - a) - gz * (sh_top - a).dot(gz)).length
    REP["checks"].setdefault("musket_axis_to_shoulder_top_m", {})["walk%d" % k] = round(d_axis, 4)
    REP.setdefault("grips", {})["walk@%d" % frame] = grips
    ps.key(frame)
    return err


def pose_fire(ps, musket, frame, stage):
    """stage 0 aim, 1 fire (recoil), 2 recover (piece brought down to the priming position)."""
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    yaw = G["aim_body_yaw_deg"] + (4.0 if stage == 1 else 0.0)
    back = {0: 0.0, 1: G["recoil_back_m"], 2: 0.0}[stage]
    rise = {0: -1.0, 1: G["recoil_deg"], 2: 0.0}[stage]
    ps.translate(ps.rm["root"], -U * 0.025 - F * back)
    ps.root_rotate(C.rot(U, yaw))
    ps.spine(U, -yaw * 0.30)
    ps.spine(L, {0: 6.0, 1: -7.0, 2: 3.0}[stage])     # leans into the aim; rocked back at the shot
    err = {}
    ankL = ps.ank_mid + L * G["fire_half_width"] + F * 0.20
    ankR = ps.ank_mid - L * G["fire_half_width"] - F * 0.16
    err["legL"] = ps.leg("L", ankL, F + L * 0.2)
    err["legR"] = ps.leg("R", ankR, F - L * 0.6)
    ps.foot("L", ps.foot_rest_dir("L", yaw_deg=-12.0))
    ps.foot("R", ps.foot_rest_dir("R", yaw_deg=-72.0))
    grips = {}
    if stage < 2:
        ps.look(F - U * (0.12 if stage == 0 else 0.02), roll_deg=-14.0 if stage == 0 else -8.0)
        shR = ps.ph(ps.S["R"]["upper"][0])
        P0 = shR + F * 0.03 + L * 0.07 + U * 0.03
        zdir = C.rot(L, -rise) @ F
        M0 = gun_matrix(P0, zdir, U)
        gx, gy, gz = gun_axes(M0)
        M = gun_matrix(P0 + gy * 0.05, zdir, U)
        place_gun(musket, M, frame)
        gx, gy, gz = gun_axes(M)
        # left hand cradles the forestock from below; right hand round the wrist of the stock
        err["armL"], grips["L"] = ps.place_on_gun("L", M, 0.62, -gy + gx * 0.25, -U + L * 0.2)
        err["armR"], grips["R"] = ps.place_on_gun("R", M, 0.31, -gx - gy * 0.3, -L - U * 0.3)
    else:
        # recover: the piece comes down off the shoulder, butt at the right hip, muzzle up and
        # forward, ready to load again
        ps.look(F * 0.9 - U * 0.25)
        hipR = ps.ph(ps.S["R"]["thigh"][0])
        Fy = C.rot(U, yaw * 0.7) @ F
        heel = hipR + Fy * 0.16 + U * 0.04 - L * 0.02
        zdir = (Fy * 0.62 + U * 0.75 + L * 0.22).normalized()
        M = gun_matrix(heel, zdir, U)
        place_gun(musket, M, frame)
        err["armL"], grips["L"] = ps.place_on_gun("L", M, 0.62, -U + L * 0.3, -U + L * 0.5)
        err["armR"], grips["R"] = ps.place_on_gun("R", M, 0.33, -L - U * 0.2, -U - L * 0.6)
    REP.setdefault("grips", {})["fire%d@%d" % (stage, frame)] = grips
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


def pose_load(ps, musket, frame, step, rr):
    """0 hand to the cartridge box, 1 charge at the muzzle, 2 draw the rammer, 3 ram, 4 prime."""
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
    grips = {}
    if step < 4:
        heel = ps.ank_mid + F * 0.20 + L * 0.06
        heel.z = 0.0
        zdir = (U - F * 0.12 + L * 0.03).normalized()
        M = gun_matrix(heel, zdir, -F)
        place_gun(musket, M, frame)
        muzzle = M @ Vector((0.0, GUN.get("barrel_y", 0.006), Lg))
        ps.look((muzzle - ps.ph(ps.rm["head"])).normalized() * 0.7 + F * 0.3)
        err["armL"], grips["L"] = ps.place_on_gun("L", M, 0.98, L * 0.8 - F * 0.4, -U + L * 0.6)
        if step == 0:
            box = next((c for n, c, r in ps.obstacles() if n == "cartridge box"), None)
            tgt = (box + U * 0.10) if box is not None else ps.ph(ps.S["R"]["thigh"][0]) - F * 0.12
            err["armR"] = ps.arm("R", tgt, -L - F * 0.3)
            ps.hand("R", -U - F * 0.3, palm_want=-F)
            ps.curl("R", degs=(30, 40, 30), thumb=25)
            key_ramrod(rr, frame)
        elif step == 1:
            err["armR"] = ps.arm("R", muzzle + U * 0.07 - F * 0.04 - L * 0.03, -U - L * 0.5)
            ps.hand("R", -U + F * 0.4, palm_want=L)
            ps.curl("R", degs=(35, 45, 35), thumb=30)
            key_ramrod(rr, frame)
        elif step == 2:
            key_ramrod(rr, frame, drawn=True)
            hold = M @ Vector((0.0, GUN.get("barrel_y", 0.006), Lg + 0.38))   # run 5: +0.62 was out of reach
            err["armR"] = ps.arm("R", hold - F * 0.05 - L * 0.04, -L - U * 0.2)
            ps.hand("R", U * 0.2 + L, palm_want=-L)
            ps.curl("R", degs=(60, 70, 50), thumb=40)
        else:
            key_ramrod(rr, frame, dz=0.20)
            head = M @ Vector((0.0, GUN.get("barrel_y", 0.006), Lg + 0.20))
            err["armR"] = ps.arm("R", head + U * 0.07 - F * 0.02, -L - U * 0.3)
            ps.hand("R", -U + L * 0.2, palm_want=-U)
            ps.curl("R", degs=(30, 40, 30), thumb=20)
    else:
        key_ramrod(rr, frame)
        hipR = ps.ph(ps.S["R"]["thigh"][0])
        heel = hipR + F * 0.18 + U * 0.02 + L * 0.02
        zdir = (F * 0.55 + U * 0.80 + L * 0.22).normalized()
        M = gun_matrix(heel, zdir, U)
        place_gun(musket, M, frame)
        ps.look(F * 0.8 - U * 0.4)
        err["armL"], grips["L"] = ps.place_on_gun("L", M, 0.60, -U + L * 0.3, -U + L * 0.5)
        err["armR"], grips["R"] = ps.place_on_gun("R", M, 0.36, -L, -U - L * 0.6)
    REP.setdefault("grips", {})["load%d@%d" % (step, frame)] = grips
    ps.key(frame)
    return err


# ------------------------------------------------------------------------------ checks

def sole_points(side):
    o = bpy.data.objects.get("tcw_brogan_sole_" + side)
    if o is None:
        return None
    mw = o.matrix_world
    return np.array([(mw @ v.co)[:] for v in o.data.vertices])


def foot_slip(soles, F, shift):
    """Ground-relative slip of sole vertices that touch the ground in two consecutive walk
    frames. The treadmill ground moves `shift` metres backward (-F) per frame."""
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
    REP["obstacles"] = len(OBST)
    rig, rm = C.find_rig(), C.rigmap()
    musket = bpy.data.objects["tcw_musket"]
    musket.rotation_mode = "QUATERNION"
    rr = bpy.data.objects.get("tcw_ramrod")
    # pose fast: switch off every mesh modifier while bones are solved (render state restored below)
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

    def run(name, frame, fn):
        t = C.time.time()
        sc.frame_set(frame)
        err = fn()
        REP["ik_error_m"]["%s@%d" % (name, frame)] = {k: round(v, 4) for k, v in err.items()}
        REP["frames"]["%s@%d" % (name, frame)] = round(C.time.time() - t, 2)

    run("stand", 1, lambda: pose_stand(ps, musket, 1))
    key_ramrod(rr, 1)
    hd = ps.face_dir()
    REP["checks"]["stand_head"] = {"pitch_deg": round(math.degrees(math.asin(max(-1, min(1, hd.dot(ps.U))))), 1),
                                   "yaw_deg": round(math.degrees(math.atan2(hd.dot(ps.L), hd.dot(ps.F))), 1)}
    soles = {"L": [], "R": []}
    for k, f in enumerate(FR["walk"]):
        run("walk", f, lambda k=k, f=f: pose_walk(ps, musket, f, k))
        key_ramrod(rr, f)
        C.update()
        for s in ("L", "R"):
            soles[s].append(sole_points(s))
    for st, f in enumerate(FR["fire"]):
        run("fire", f, lambda st=st, f=f: pose_fire(ps, musket, f, st))
        key_ramrod(rr, f)
    run("fallen", 31, lambda: pose_fallen(ps, musket, 31))
    key_ramrod(rr, 31)
    for st, f in enumerate(FR["load"]):
        run("load", f, lambda st=st, f=f: pose_load(ps, musket, f, st, rr))
    T.mark("posed all frames")

    ad_objs = [rig, musket] + ([rr] if rr else [])
    for ob in ad_objs:
        ad = ob.animation_data
        if ad and ad.action:
            for fc in ad.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"
    for md in saved:
        md.show_viewport = True
    sc.frame_start, sc.frame_end = 1, 45
    worst = max((v for d in REP["ik_error_m"].values() for v in d.values()), default=0.0)
    REP["ik_error_worst_m"] = worst
    cycle_s = 2.0 * 60.0 / G["steps_per_min"]
    metres_cycle = 2 * G["stance_half_m"] / G["stance_frac"]  # what the planted feet actually cover
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
                 "note": "0 hand to cartridge box, 1 charge at the muzzle, 2 draw rammer, 3 ram, 4 prime"},
    }
    REP["clips"] = clips
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, "posed.blend"), compress=False)
    T.mark("saved posed.blend")
    REP["timing"] = T.marks
    C.write_report("poses", REP)


main()
