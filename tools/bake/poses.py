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
# FOURTH PASS, hands (simple and robust; the third pass's per-finger grip solver is gone).
#   * Two FIXED, hand-authored hand shapes, applied identically in every clip and mirrored L/R
#     (SHAPES below): GRIP (the four fingers curled together as one unit round a ~40 mm
#     cylinder, thumb closed over them) and RELAXED (a free hand, fingers together, half curled).
#     (A PINCH for the cartridge and rammer was tried in run 21: it read as an open hand, so GRIP
#     holds them too.)
#   * Once, at the rest pose, the real skinned GRIP hand is measured: the channel through the
#     fist (axis, centre, radius, from a ring fitted to each finger's pad skin and the palm),
#     stored in the wrist bone's frame. One four-finger curl factor is fitted once so the channel
#     is 40 mm across, one thumb factor so the thumb just closes on it.
#   * The OBJECT is attached to the hand: the first hand is placed with its channel on the stock
#     axis and the musket is then keyed from that hand's actual channel (it follows any IK miss).
#     The second hand is a rigid fist placed by wrist IK so its channel lies on the stock axis;
#     if it cannot reach, it slides along the stock toward the body instead of opening.
#     The cartridge and the rammer are keyed from the right fist the same way.
#   * The report (poses.json "holds") measures every held hand on the real skin: deviation from
#     its shape, channel-to-object-axis distance, fingertip-to-surface gaps, penetration.
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
    # -- fixed hands (fourth pass) -------------------------------------------------------------
    "grip_channel_r": 0.020,    # GRIP channel radius the curl factor is fitted to (40 mm, about the stock)  placeholder
    "grip_small_r": 0.0065,     # the same fist closed on the rammer (9 mm) and cartridge (15 mm)          placeholder
    "walk_toe_in": 0.90,        # walk: the butt's toe edge sits this many channel radii in from the fist's centre  placeholder
    "wrist_ok_deg": 25.0,       # wrist bend that costs nothing when a fist placement is chosen             placeholder
    "reach_ok_m": 0.010,        # the second hand must reach the stock axis within this                     placeholder
    # run 21: +-40 deg left wrists bent 80 deg; the whole turn is offered, the authored side only preferred
    "rolls_deg": tuple(float(a) for a in range(0, 360, 30)),   # fist turned about the object from the authored palm side placeholder
    "slides_m": (0.0, -0.02, -0.04, -0.06, -0.08, 0.02),  # second hand slid along the stock (- = toward the body) placeholder
}
FR = {"stand": [1], "walk": list(range(11, 19)), "fire": [21, 22, 23], "fallen": [31],
      "load": [41, 42, 43, 44, 45]}

# The fixed hand shapes (fourth pass). Fingers index..little: (MCP, PIP, DIP) flexion in degrees.
# Thumb: (flex toward the palm, opposition swing across the palm, MCP, IP). "together": share of
# the rest-pose finger spread closed, so the fingers lie side by side. The same numbers are used
# for both hands (each hand's own joint axes are measured from its fingernails, which mirrors
# them). GRIP's four-finger curl is multiplied by one factor fitted once to a 40 mm channel;
# its thumb by one factor so it just closes on that channel.
SHAPES = {
    "grip":    {"fingers": ((55, 75, 40), (60, 78, 42), (65, 80, 42), (70, 82, 42)),
                "thumb": (30.0, 35.0, 25.0, 25.0), "together": 1.0},           # placeholder, judged by eye
    "relaxed": {"fingers": ((20, 30, 15), (24, 34, 17), (28, 38, 19), (32, 42, 21)),
                "thumb": (12.0, 15.0, 10.0, 10.0), "together": 0.8},           # placeholder, judged by eye
}

T = C.Timer()
REP = {"constants": G, "frames": {}, "ik_error_m": {}, "checks": {}, "holds": {}}
GUN = {}
OBST = []
HANG = []
UNI = {}
HM = {}          # measured hand rest frame (palm, finger pad sides, vertex owners)
SQ = {"L": {}, "R": {}}   # side -> shape -> bone -> Quaternion (bone-local)
HF = {"L": {}, "R": {}}   # side -> shape -> {"c", "a", "p", ...} hold frame in the wrist bone's frame
HOLDLOG = []     # every held hand (dicts, see log_hold)
FREELOG = []     # every free (RELAXED) hand: (key, frame, side)


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


def hand_verts(ps, body, s):
    """The posed body's real skin (armature on) for one hand: bone -> (n, 3) array, rig space."""
    arm = [m for m in body.modifiers if m.type == "ARMATURE"]
    state = [(m, m.show_viewport) for m in arm]
    for m in arm:
        m.show_viewport = True
    try:
        C.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
    finally:
        for m, v in state:
            m.show_viewport = v
        C.update()
    co = co.reshape(-1, 3)
    Mx = np.array(ps.rig.matrix_world.inverted() @ body.matrix_world)
    co = co @ Mx[:3, :3].T + Mx[:3, 3]
    out = {}
    for b, idx in HM["by_bone"][s].items():
        idx = [i for i in idx if i < n]
        if idx:
            out[b] = co[idx]
    return out


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

    # ---- the hand (fourth pass: fixed shapes, placed as a rigid hand)
    def hand_frame(self, s):
        """(hand direction, palm normal) of the posed hand, from the measured rest frame."""
        h = HM["hand"][s]
        R = self.P(self.S[s]["hand"]).matrix.to_3x3()
        return (R @ Vector(h["H0"])).normalized(), (R @ Vector(h["P0"])).normalized()

    def palm_centre(self, s):
        h = HM["hand"][s]
        return self.P(self.S[s]["hand"]).matrix @ Vector(h["pc_local"])

    def palm(self, s):
        """Palm estimate from the bones (fallback when no fingernails were found)."""
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
        """Take the wrist's twist in the forearm (lowerarm02 rolls about the forearm axis).
        Returns (roll applied, twist needed), degrees."""
        d = self.S[s]
        lo = d["lower"][-1]
        f = (self.ph(d["hand"]) - self.ph(d["lower"][0])).normalized()
        h = HM["hand"][s]
        cur = self.P(d["hand"]).matrix.to_3x3() @ Vector(h["P0"])
        want = R @ Vector(h["P0"])
        a = cur - f * cur.dot(f)
        b = want - f * want.dot(f)
        if a.length < 1e-6 or b.length < 1e-6:
            return 0.0, 0.0
        a.normalize()
        b.normalize()
        need = math.atan2(a.cross(b).dot(f), a.dot(b))
        ang = max(-math.radians(110), min(math.radians(110), need)) * 0.85
        self.rotate_about(lo, self.ph(lo), Quaternion(f, ang))
        return math.degrees(ang), math.degrees(need)

    def wrist_bend(self, s):
        d = self.S[s]
        f = (self.ph(d["hand"]) - self.ph(d["lower"][0])).normalized()
        H, _P = self.hand_frame(s)
        return math.degrees(f.angle(H))

    def set_shape(self, s, name):
        """Key one of the fixed hand shapes on every finger joint of hand s (bone-local)."""
        for bn, q in SQ[s][name].items():
            p = self.P(bn)
            p.matrix_basis = Matrix()
            p.rotation_quaternion = q
        C.update()

    def place_rigid(self, s, shape, Q, A, nv, pole):
        """Hand s in its fixed shape, its hold frame (the fist's channel) at Q, the frame axis
        (little finger -> index side) along A, the palm on the nv side: wrist by IK, forearm roll,
        exact hand rotation. Pa is where the hold frame actually ended up."""
        fr = HF[s][shape]
        a0 = Vector(fr["a"]).normalized()
        p0 = Vector(fr["p"])
        x0 = a0.cross(p0).normalized()
        p0 = x0.cross(a0).normalized()
        A = A.normalized()
        Pv = nv - A * nv.dot(A)
        if Pv.length < 1e-6:
            Pv = A.orthogonal()
        Pv.normalize()
        X = A.cross(Pv)
        R = Matrix((A, Pv, X)).transposed() @ Matrix((a0, p0, x0))
        W = Q - R @ Vector(fr["c"])
        self.reset_arm(s)
        err = self.arm(s, W, pole)
        roll, need = self.roll_forearm(s, R)
        self.set_hand_rot(s, R)
        self.set_shape(s, shape)
        Pa = self.P(self.S[s]["hand"]).matrix @ Vector(fr["c"])
        return {"err": err, "roll": roll, "need": need, "R": R, "Pa": Pa, "Q": Q.copy(), "A": A.copy(),
                "nv": Pv.copy(), "shape": shape}

    def hold(self, s, shape, Q, A, nv, pole, thumbs=(1,), rolls=None, slides=(0.0,), kpref=None, kweight=10.0, fixed=None):
        """Place hand s, rigid in its fixed shape, on an object whose axis runs along A through Q.
        The only choices are the hand's turn about the object (rolls), which way its thumb side
        faces along it (thumbs) and, for a second hand, a slide along it (slides); they are judged
        by reach, wrist bend and forearm twist. No finger is ever moved."""
        rolls = G["rolls_deg"] if rolls is None else rolls
        A = A.normalized()
        nv = nv - A * nv.dot(A)
        nv.normalize()
        cands = [fixed] if fixed is not None else [(sl, td, r) for sl in slides for td in thumbs for r in rolls]
        best = None
        if len(cands) > 1:
            for sl, td, r in cands:
                h = self.place_rigid(s, shape, Q + A * sl, A * td, C.rot(A, r) @ nv, pole)
                bend = self.wrist_bend(s)
                turn = min(abs(r) % 360.0, 360.0 - abs(r) % 360.0)
                sc = (400.0 * max(0.0, h["err"] - 0.002) + max(0.0, bend - G["wrist_ok_deg"])
                      + 0.3 * max(0.0, abs(h["need"]) - 80.0) + 0.03 * turn + 100.0 * abs(sl)
                      + (4.0 if td != thumbs[0] else 0.0))
                if kpref is not None:
                    kw = h["R"] @ Vector(HF[s][shape]["k"])
                    sc += kweight * (1.0 - kw.dot(kpref.normalized()))
                if best is None or sc < best[0]:
                    best = (sc, (sl, td, r))
            sl, td, r = best[1]
        else:
            sl, td, r = cands[0]
        h = self.place_rigid(s, shape, Q + A * sl, A * td, C.rot(A, r) @ nv, pole)
        h.update({"cand": (sl, td, r), "bend": self.wrist_bend(s), "tried": len(cands),
                  "score": round(best[0], 2) if best else None})
        return h

    def hand(self, s, direction, palm_want=None):
        """Point the hand along `direction` with the palm toward palm_want (free hands)."""
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


def ramrod_span(dz=0.0, drawn=False, extra=0.0):
    """(z0, z1) of the rammer in gun-local coordinates for a key_ramrod state (axis on the bore).
    extra: the rammer slid along its axis so it sits in the hand that holds it."""
    L = GUN.get("L", 1.42)
    rb, rt = GUN.get("ramrod_bottom", 0.55), GUN.get("ramrod_top", L - 0.004)
    off = ((L - rb + 0.03) if drawn else dz) + extra
    return rb + off, rt + off


def key_ramrod(rr, frame, dz=0.0, drawn=False, extra=0.0):
    if rr is None:
        return
    L = GUN.get("L", 1.42)
    if drawn:   # pulled clean out and held above the muzzle, in line with the bore
        rr.location = (0.0, 0.023, L - GUN.get("ramrod_bottom", 0.55) + 0.03 + extra)
    elif dz:
        rr.location = (0.0, 0.023, dz + extra)
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

def section_centre(z):
    """Gun-local centre of the musket's cross-section at z (stock, and barrel where it lies on it)."""
    h, w, cy = stock_at(z)
    top, bot = cy + h / 2, cy - h / 2
    if z >= GUN.get("br0", 0.4):
        by, rb = GUN.get("barrel_y", 0.006), GUN.get("barrel_r", 0.0145)
        top, bot = max(top, by + rb), min(bot, by - rb)
    return Vector((0.0, (top + bot) / 2, z))


def gun_hold(ps, s, M, z, shape, thumbs, nv, pole, centre=None, **kw):
    """Hand s holds the musket at gun-local z: its fist's channel on the stock axis there."""
    gz = gun_axes(M)[2]
    loc = centre if centre is not None else section_centre(z)
    h = ps.hold(s, shape, M @ loc, gz, nv, pole, thumbs=thumbs, **kw)
    h["gun_loc"] = loc
    return h


def follow(M, h):
    """The musket is attached to the first hand: it moves with that hand's hold frame."""
    return Matrix.Translation(h["Pa"] - h["Q"]) @ M


def log_hold(key, frame, s, h, surf, axis_pt, axis_dir, obj, extra=()):
    """Record a held hand for the real-skin acceptance check (measure_holds)."""
    HOLDLOG.append({"key": key, "frame": frame, "side": s, "shape": h["shape"], "surf": surf,
                    "extra": tuple(extra), "axis_pt": axis_pt.copy(), "axis_dir": axis_dir.normalized(),
                    "obj": obj})
    sl, td, r = h.get("cand", (0.0, 1, 0.0))
    REP["holds"].setdefault(key, {})[s] = {
        "shape": h["shape"], "object": obj, "ik_err_m": round(h["err"], 4),
        "wrist_bend_deg": round(h.get("bend", 0.0), 1), "forearm_roll_deg": round(h["roll"], 1),
        "twist_needed_deg": round(h["need"], 1), "turn_deg": r, "thumb": "+" if td > 0 else "-",
        "slide_m": sl, "placements_tried": h.get("tried", 1)}


def free_hand(ps, s, key, frame):
    ps.set_shape(s, "relaxed")
    FREELOG.append((key, frame, s))


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
    key = "stand0@%d" % frame
    st = {}
    gy0 = gun_axes(M)[1]

    # run 23: the best-reaching fist showed only the back of the hand (read as a flat hand); the
    # knuckles are asked to face the front, fingers round the swell and guard (Hardee, recalled)
    def solve_r(k):
        pole = -F - L * (0.3 + 6.0 * k)
        st["h"] = gun_hold(ps, "R", M, G["grip_stand_R"], "grip", (1, -1), -L, pole, slides=(0.0, -0.03, 0.03),
                           kpref=-gy0, kweight=25.0, fixed=st.get("cand"))
        st.setdefault("cand", st["h"]["cand"])
        err["armR"] = st["h"]["err"]
    REP["checks"].setdefault("clearance", {})["stand_R"] = ps.clear("R", solve_r)
    M = follow(M, st["h"])
    place_gun(musket, M, frame)
    gz = gun_axes(M)[2]
    log_hold(key, frame, "R", st["h"], GunSurf(M), M @ st["h"]["gun_loc"], gz, "musket")
    shL = ps.ph(ps.S["L"]["upper"][0])
    reachL = ps.len["L"]["upper"] + ps.len["L"]["lower"]

    def solve_l(k):
        err["armL"] = ps.arm("L", shL - U * (0.93 * reachL) + F * (0.05 + 0.4 * k) + L * (0.06 + k),
                             -F + L * 0.3)
        ps.hand("L", -U, palm_want=-L)
        ps.set_shape("L", "relaxed")
    REP["checks"]["clearance"]["stand_L"] = ps.clear("L", solve_l)
    FREELOG.append((key, frame, "L"))
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
    gx, gy, gz = gun_axes(M)
    key = "walk%d@%d" % (k, frame)
    # the butt (110 mm deep) cannot pass through a fist: the fist closes on its toe edge, the
    # knuckles under the toe, the palm on one face, the rest of the butt rising out of the fist
    zw = G["grip_walk_R"]
    hh, _w, cy = stock_at(zw)
    loc = Vector((0.0, cy - hh / 2 + G["walk_toe_in"] * HF["R"]["grip"]["r"], zw))
    st = {}

    def solve_r(kk):
        pole = -U - L * (0.4 + 6.0 * kk)
        st["h"] = gun_hold(ps, "R", M, zw, "grip", (1, -1), -gx, pole, centre=loc,
                           kpref=-gy, fixed=st.get("cand"))
        st.setdefault("cand", st["h"]["cand"])
        err["armR"] = st["h"]["err"]
    REP["checks"].setdefault("clearance", {})["walk%d_R" % k] = ps.clear("R", solve_r)
    M = follow(M, st["h"])
    place_gun(musket, M, frame)
    gx, gy, gz = gun_axes(M)
    log_hold(key, frame, "R", st["h"], GunSurf(M), M @ loc, gz, "musket butt (toe edge)")
    shL = ps.ph(ps.S["L"]["upper"][0])
    reachL = ps.len["L"]["upper"] + ps.len["L"]["lower"]
    swing = G["arm_swing_deg"] * math.cos(2 * math.pi * p)
    down = C.rot(L, swing) @ (-U)

    def solve_l(kk):
        err["armL"] = ps.arm("L", shL + down * (0.93 * reachL) + L * (0.03 + kk) + F * (0.3 * kk), -F + L * 0.2)
        ps.hand("L", down + F * 0.1, palm_want=-L)
        ps.set_shape("L", "relaxed")
    REP["checks"]["clearance"]["walk%d_L" % k] = ps.clear("L", solve_l)
    FREELOG.append((key, frame, "L"))
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
        zR, zL = G["grip_aim_R"], G["grip_aim_L"]
        # right hand: a fist round the wrist of the stock, palm on the lock side, knuckles under,
        # thumb over the comb; left hand: a fist round the forestock from below
        nR, poleR = lambda gx, gy: -gx + gy * 0.2, -L - U * 0.3
        nL, poleL = lambda gx, gy: -gy + gx * 0.25, -U + L * 0.2
    else:
        ps.look(F * 0.9 - U * 0.25)
        hipR = ps.ph(ps.S["R"]["thigh"][0])
        Fy = C.rot(U, yaw * 0.7) @ F
        heel = hipR + Fy * 0.16 + U * 0.04 - L * 0.02
        zdir = (Fy * 0.62 + U * 0.75 + L * 0.22).normalized()
        M = gun_matrix(heel, zdir, U)
        zR, zL = G["grip_recover_R"], G["grip_recover_L"]
        nR, poleR = lambda gx, gy: -gx, -U - L * 0.6
        nL, poleL = lambda gx, gy: -gy + gx * 0.3, -U + L * 0.5
    gx, gy, gz = gun_axes(M)
    hR = gun_hold(ps, "R", M, zR, "grip", (1, -1), nR(gx, gy), poleR)
    M = follow(M, hR)                      # the musket is in the right hand
    place_gun(musket, M, frame)
    gx, gy, gz = gun_axes(M)
    hL = gun_hold(ps, "L", M, zL, "grip", (1, -1), nL(gx, gy), poleL, slides=G["slides_m"])
    err["armR"], err["armL"] = hR["err"], hL["err"]
    log_hold(key, frame, "R", hR, GunSurf(M), M @ hR["gun_loc"], gz, "musket")
    log_hold(key, frame, "L", hL, GunSurf(M), hL["Q"], gz, "musket")
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
    key = "fallen0@%d" % frame
    free_hand(ps, "R", key, frame)
    free_hand(ps, "L", key, frame)
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
    small = "grip_small"                      # cartridge and rammer: the GRIP angles closed on a 13 mm channel
    if step < 4:
        heel = ps.ank_mid + F * 0.20 + L * 0.06
        heel.z = 0.0
        zdir = (U - F * 0.12 + L * 0.03).normalized()
        M = gun_matrix(heel, zdir, -F)
        gx, gy, gz = gun_axes(M)
        # the left hand holds the upright piece by the barrel and forestock; the piece is in it
        hL = gun_hold(ps, "L", M, G["grip_load_L"], "grip", (1, -1), L * 0.8 - F * 0.4, -U + L * 0.6,
                      slides=(0.0, -0.03, 0.03, -0.06))
        M = follow(M, hL)
        place_gun(musket, M, frame)
        gx, gy, gz = gun_axes(M)
        err["armL"] = hL["err"]
        log_hold(key, frame, "L", hL, GunSurf(M), M @ hL["gun_loc"], gz, "musket")
        muzzle = M @ Vector((0.0, by, Lg))
        ps.look(F - U * 0.28 + L * 0.08)
        if step in (0, 1):
            key_ramrod(rr, frame)
            # the cartridge is held in the right fist and keyed from it:
            # above the open box, then over the muzzle, torn end down
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
            h = ps.hold("R", small, centre, X, nv, pole, thumbs=(1, -1))
            Aw = h["R"] @ Vector(HF["R"][small]["a"])
            if Aw.dot(X) < 0:
                Aw = -Aw
            key_cartridge(cart, frame, h["Pa"], Aw, h["nv"])
            surf = CylSurf(h["Pa"] - Aw * (cl / 2), Aw, cr, cl)
            log_hold(key, frame, "R", h, surf, h["Pa"], Aw, "cartridge", extra=(GunSurf(M),))
            err["armR"] = h["err"]
        else:
            drawn = step == 2
            dz = 0.0 if drawn else G["rammer_ram_dz"]
            z0, z1 = ramrod_span(dz=dz, drawn=drawn)
            hold_at = M @ Vector((0.0, by, Lg + G["grip_rammer_drawn" if drawn else "grip_rammer_ram"]))
            h = ps.hold("R", small, hold_at, gz, -F - L * 0.4, -L - U * (0.2 if drawn else 0.3), thumbs=(1, -1))
            ex = (h["Pa"] - hold_at).dot(gz)          # the rammer slides to sit in the hand
            key_ramrod(rr, frame, dz=dz, drawn=drawn, extra=ex)
            a = M @ Vector((0.0, by, z0 + ex))
            surf = CylSurf(a, gz, 0.0045, z1 - z0)
            log_hold(key, frame, "R", h, surf, a, gz, "rammer", extra=(GunSurf(M),))
            REP["holds"][key]["R"]["rammer_slid_m"] = round(ex, 4)
            err["armR"] = h["err"]
            key_cartridge(cart, frame, park=park)
    else:
        key_ramrod(rr, frame)
        key_cartridge(cart, frame, park=park)
        hipR = ps.ph(ps.S["R"]["thigh"][0])
        heel = hipR + F * 0.18 + U * 0.02 + L * 0.02
        zdir = (F * 0.55 + U * 0.80 + L * 0.22).normalized()
        M = gun_matrix(heel, zdir, U)
        gx, gy, gz = gun_axes(M)
        ps.look(F * 0.8 - U * 0.4)
        hR = gun_hold(ps, "R", M, G["grip_prime_R"], "grip", (1, -1), -gx, -U - L * 0.6)
        M = follow(M, hR)
        place_gun(musket, M, frame)
        gx, gy, gz = gun_axes(M)
        hL = gun_hold(ps, "L", M, G["grip_prime_L"], "grip", (1, -1), -gy + gx * 0.3, -U + L * 0.5,
                      slides=G["slides_m"])
        err["armR"], err["armL"] = hR["err"], hL["err"]
        log_hold(key, frame, "R", hR, GunSurf(M), M @ hR["gun_loc"], gz, "musket")
        log_hold(key, frame, "L", hL, GunSurf(M), hL["Q"], gz, "musket")
    ps.key(frame)
    return err


# ------------------------------------------------------------------------------ hand model

def measure_hands(ps, body):
    """From the rest mesh (shape keys on, no armature): each finger segment's pad side (opposite
    its fingernail), the palm normal, the palm centre on the skin, the hand's rest frame (all in
    bone-local coordinates) and which hand vertices belong to which bone."""
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
    by_bone = {"L": {}, "R": {}}
    for v in body.data.vertices:
        best, bw = None, 0.3
        for g in v.groups:
            nm = gi.get(g.group)
            if nm in hand_bones and g.weight > bw:
                best, bw = nm, g.weight
        if best:
            by_bone["L" if best.endswith(".L") else "R"].setdefault(best, []).append(v.index)
    pal_local, report, hands = {}, {}, {}

    def axis_pt(b, p):
        h, t = ps.rh(b), ps.rt(b)
        ab = t - h
        u = max(0.0, min(1.0, (p - h).dot(ab) / max(1e-9, ab.dot(ab))))
        return h + ab * u, ab.normalized()

    for s in ("L", "R"):
        d = ps.S[s]
        bb = by_bone[s]
        dorsal = {}
        for ci, chain in enumerate(d["fingers"]):
            dist_b = chain[-1]
            nv = [i for i in bb.get(dist_b, []) if i in nail_verts]
            if len(nv) >= 3:
                nc = Vector(Pw[nv].mean(axis=0).tolist())
                q, ax = axis_pt(dist_b, nc)
                dv = (nc - q)
                dv = (dv - ax * dv.dot(ax))
                if dv.length > 1e-6:
                    dorsal[ci] = dv.normalized()
        report[s] = {"nails_found": sorted(dorsal.keys())}
        fb_pal, _fb_hd = ps.palm(s)
        H0 = (ps.rh(d["fingers"][2][0]) - ps.rh(d["hand"])).normalized()
        if dorsal:
            ph_ = -sum((dorsal[c] for c in dorsal if c > 0), Vector()) if any(c > 0 for c in dorsal) else -dorsal[0]
        else:
            ph_ = fb_pal
        P0 = (ph_ - H0 * ph_.dot(H0)).normalized()
        for ci, chain in enumerate(d["fingers"]):
            dv = dorsal.get(ci, -P0)
            for b in chain:
                if b not in ps.B:
                    continue
                ax = (ps.rt(b) - ps.rh(b)).normalized()
                pw = -(dv - ax * dv.dot(ax))
                if pw.length < 1e-6:
                    pw = P0.copy()
                pw.normalize()
                pal_local[b] = list(ps.B[b].matrix_local.to_3x3().inverted() @ pw)
        kn = [ps.rh(d["fingers"][c][0]) for c in (1, 2, 3, 4)]
        pc0 = sum(kn, Vector()) / 4 * 0.55 + ps.rh(d["hand"]) * 0.45
        palm_ds = []
        for k in range(1, 5):
            for i in bb.get("metacarpal%d.%s" % (k, s), []):
                dd = (Vector(Pw[i].tolist()) - pc0).dot(P0)
                if dd > 0:
                    palm_ds.append(dd)
        palm_pad = float(np.percentile(palm_ds, 85)) if len(palm_ds) >= 5 else 0.016
        pcr = pc0 + P0 * palm_pad
        Bw = ps.B[d["hand"]].matrix_local
        hands[s] = {"H0": list(Bw.to_3x3().inverted() @ H0), "P0": list(Bw.to_3x3().inverted() @ P0),
                    "pc_local": list(Bw.inverted() @ pcr)}
        report[s].update({"palm_pad_mm": round(palm_pad * 1000, 1),
                          "hand_vertices": sum(len(v) for v in bb.values())})
    HM.update({"palmar_local": pal_local, "hand": hands, "by_bone": by_bone})
    REP["hand_rest"] = report


def shape_quats(ps, s, spec, kf=1.0, kt=1.0, scaled=(1, 2, 3, 4), thumb=None):
    """Bone-local rotations of one fixed shape for hand s. Fingers flex about their own joint axis
    (fingernail side out); MCPs also swing toward the middle finger by spec["together"] of the rest
    spread. The thumb flexes toward the palm and swings across it, then its two joints flex.
    kf scales the flexion of the fingers in `scaled`; kt scales the thumb (one-time fits)."""
    d = ps.S[s]
    h = HM["hand"][s]
    Bw = ps.B[d["hand"]].matrix_local.to_3x3()
    H0 = (Bw @ Vector(h["H0"])).normalized()
    P0 = (Bw @ Vector(h["P0"])).normalized()
    mid = d["fingers"][2][0]
    ref = (ps.rt(mid) - ps.rh(mid)).normalized()
    Y = Vector((0.0, 1.0, 0.0))
    out = {}
    for ci, chain in enumerate(d["fingers"]):
        for k, bn in enumerate(chain):
            if bn not in ps.B:
                continue
            Bm = ps.B[bn].matrix_local.to_3x3()
            Bi = Bm.inverted()
            pal = Vector(HM["palmar_local"].get(bn, list(Bi @ P0))).normalized()
            if ci == 0:
                fl, op, m1, m2 = thumb if thumb is not None else spec["thumb"]
                if k == 0:
                    ax_f = Y.cross((Bi @ P0).normalized())
                    q_f = Quaternion(ax_f.normalized(), math.radians(fl * kt)) if ax_f.length > 1e-6 else Quaternion()
                    d1 = (Bm @ (q_f @ Y)).normalized()
                    tgt = (ps.rh(mid) - ps.rh(bn)).normalized()
                    sg = 1.0 if (C.rot(H0, op) @ d1).dot(tgt) >= (C.rot(H0, -op) @ d1).dot(tgt) else -1.0
                    q = Quaternion((Bi @ H0).normalized(), math.radians(sg * op * kt)) @ q_f
                else:
                    q = Quaternion(Y.cross(pal).normalized(), math.radians((m1, m2)[min(k, 2) - 1] * kt))
            else:
                f_ = kf[ci - 1] if isinstance(kf, (tuple, list)) else kf     # one factor, or one per finger
                ang = spec["fingers"][ci - 1][min(k, 2)] * (f_ if ci in scaled else 1.0)
                q = Quaternion(Y.cross(pal).normalized(), math.radians(ang))
                if k == 0 and spec.get("together"):
                    pa = (Bm @ pal).normalized()
                    dk = (Bm @ Y).normalized()
                    t = ref - pa * ref.dot(pa)
                    if t.length > 1e-6:
                        t.normalize()
                        al = math.atan2(dk.cross(t).dot(pa), dk.dot(t))
                        q = Quaternion(pal, al * spec["together"]) @ q
            out[bn] = q
    return out


def pad_side(pts, h, t, pal, cos_min=0.5):
    """The skin points of one segment (bone h->t) that face the pad direction pal."""
    ab = np.array((t - h)[:])
    q = pts - np.array(h[:])
    u = np.clip((q @ ab) / max(float(ab @ ab), 1e-12), 0.0, 1.0)
    rad = q - u[:, None] * ab
    nr = np.linalg.norm(rad, axis=1) + 1e-12
    return pts[(rad @ np.array(pal[:])) > cos_min * nr]


def circle2d(x, y):
    """Least-squares circle through 2-D points -> (cx, cy, r)."""
    A = np.c_[x, y, np.ones_like(x)]
    sol = np.linalg.lstsq(A, -(x * x + y * y), rcond=None)[0]
    cx, cy = -sol[0] / 2, -sol[1] / 2
    return float(cx), float(cy), float(math.sqrt(max(cx * cx + cy * cy - sol[2], 0.0)))


def fist_channel(ps, s, V, a0):
    """The channel of the closed hand, measured on its real skin: for each finger (index..little)
    the circle that its pad skin and the palm skin under it wrap round (fitted in that finger's
    curl plane); the channel's axis is the line through the four ring centres, its radius their
    mean. -> (centre, axis, radius, per-finger radii)."""
    d = ps.S[s]
    Hw, Pw = ps.hand_frame(s)
    mets = [b for b in V if b.startswith("metacarpal")]
    cs, rs = [], []
    for ci in (1, 2, 3, 4):
        chain = d["fingers"][ci]
        b0 = chain[0]
        y0 = (ps.pt(b0) - ps.ph(b0)).normalized()
        pal0 = (ps.P(b0).matrix.to_3x3() @ Vector(HM["palmar_local"][b0])).normalized()
        n = y0.cross(pal0).normalized()
        o = ps.ph(b0)
        e1 = (Hw - n * Hw.dot(n)).normalized()
        e2 = n.cross(e1)
        pts = []
        for bn in chain:
            if bn in V:
                pal = (ps.P(bn).matrix.to_3x3() @ Vector(HM["palmar_local"][bn])).normalized()
                pts.append(pad_side(V[bn], ps.ph(bn), ps.pt(bn), pal))
        if mets:
            mb = min(mets, key=lambda b: (ps.pt(b) - o).length)
            pts.append(pad_side(V[mb], ps.ph(mb), ps.pt(mb), Pw))
        q = np.concatenate(pts) - np.array(o[:])
        q = q[np.abs(q @ np.array(n[:])) < 0.012]
        if len(q) < 8:
            continue
        cx, cy, r = circle2d(q @ np.array(e1[:]), q @ np.array(e2[:]))
        cs.append(o + e1 * cx + e2 * cy)
        rs.append(r)
    if len(cs) < 2:
        return None
    Cm = np.array([c[:] for c in cs])
    m = Cm.mean(axis=0)
    ax = Vector(np.linalg.svd(Cm - m)[2][0].tolist()).normalized()
    if ax.dot(a0) < 0:
        ax = -ax
    if math.degrees(ax.angle(a0)) > 40.0:       # ring centres too scattered to trust: knuckle line
        ax = a0.copy()
    return Vector(m.tolist()), ax, float(np.mean(rs)), [round(r * 1000, 1) for r in rs]


def cyl_gap(pts, cen, ax, r):
    """Signed distance (m) of points to the cylinder (cen, ax, r); + outside."""
    q = pts - np.array(cen[:])
    t = q @ np.array(ax[:])
    return np.sqrt(np.maximum((q * q).sum(1) - t * t, 0.0)) - r


def fit_grip(ps, body, s, name, target, per_finger=False, thumb_in=0.004):
    """Fit one closed fist, once, at rest, on the real skin: the authored GRIP angles x one curl
    factor for a channel of radius `target`; with per_finger, then x one factor per finger so
    each fingertip just meets that channel (used for grip_small only: run 23 showed it loosened the
    40 mm fist); then the thumb, picked once from a grid. Stores SQ[s][name] and HF[s][name]."""
    d = ps.S[s]
    ps.reset()
    Mw = ps.P(d["hand"]).matrix.copy()
    Mi, R3i = Mw.inverted(), Mw.to_3x3().inverted()
    H0w, P0w = ps.hand_frame(s)
    pc = ps.palm_centre(s)
    kn = [ps.ph(d["fingers"][c][0]) for c in (1, 2, 3, 4)]
    a0 = (kn[0] - kn[3]).normalized()                      # little -> index knuckle
    kmid = sum(kn, Vector()) / 4
    thumb_b = [b for b in d["fingers"][0][1:] if b in ps.B]
    tip_b = [d["fingers"][c][-1] for c in (1, 2, 3, 4)]
    names = ("thumb", "index", "middle", "ring", "little")

    def at(kf, kt):
        SQ[s][name] = shape_quats(ps, s, SHAPES["grip"], kf=kf, kt=kt)
        ps.set_shape(s, name)
        V = hand_verts(ps, body, s)
        return fist_channel(ps, s, V, a0), V

    # 1. one curl factor -> channel radius (thumb open while fitting)
    lo, hi, hist = 0.4, 1.6, []
    for _ in range(10):
        k = (lo + hi) / 2
        res, _V = at(k, 0.0)
        hist.append([round(k, 3), round(res[2] * 1000, 1) if res else None])
        if res is None or res[2] > target:
            lo = k
        else:
            hi = k
    kg = (lo + hi) / 2
    res, V = at(kg, 0.0)
    found = res is not None
    cen, ax, r, rings = res if found else (pc + P0w * target, a0.copy(), target, [])
    # 2. one factor per finger -> its fingertip just meets the channel (+0.5 mm); twice, refitting
    #    the channel in between
    kf = [kg] * 4
    for _round in range(2 if per_finger else 0):
        lo4, hi4 = [0.3 * kg] * 4, [min(1.9, 1.8 * kg)] * 4
        for _ in range(9):
            mid = [(a + b) / 2 for a, b in zip(lo4, hi4)]
            _res, Vt = at(mid, 0.0)
            for i, b in enumerate(tip_b):
                if b not in Vt:
                    continue
                if float(cyl_gap(Vt[b], cen, ax, target).min()) > 0.0005:
                    lo4[i] = mid[i]
                else:
                    hi4[i] = mid[i]
        kf = [(a + b) / 2 for a, b in zip(lo4, hi4)]
        res, V = at(kf, 0.0)
        if res is not None:
            cen, ax, r, rings = res

    # 3. the thumb, chosen once from a small grid (run 22: one factor on the authored thumb left
    #    it straight and sticking out): closed over the fingers (its tip as near the forefinger's
    #    middle segment as it gets) without entering the channel (the held object)
    ib = d["fingers"][1][1] if len(d["fingers"][1]) > 1 else d["fingers"][1][-1]
    tt = d["fingers"][0][-1]
    tgrid = []
    for fl in (0.0, 15.0, 30.0, 45.0, 60.0):
        for op in (0.0, 20.0, 40.0, 60.0):
            for m1, m2 in ((0.0, 0.0), (20.0, 20.0), (40.0, 30.0), (60.0, 45.0)):
                th = (fl, op, m1, m2)
                SQ[s][name] = shape_quats(ps, s, SHAPES["grip"], kf=kf, thumb=th)
                ps.set_shape(s, name)
                Vt = hand_verts(ps, body, s)
                if tt not in Vt or ib not in Vt:
                    continue
                gap = min(float(cyl_gap(Vt[b], cen, ax, target).min()) for b in thumb_b if b in Vt)
                A_, B_ = Vt[tt], Vt[ib]
                reach = float(np.sqrt(((A_[:, None, :] - B_[None, :, :]) ** 2).sum(2)).min())
                sc = reach + 5.0 * max(0.0, -gap - thumb_in) + 0.00002 * (fl + op + m1 + m2)
                tgrid.append((sc, th, reach, gap))
    tgrid.sort(key=lambda x: x[0])
    thumb = tgrid[0][1] if tgrid else SHAPES["grip"]["thumb"]
    SQ[s][name] = shape_quats(ps, s, SHAPES["grip"], kf=kf, thumb=thumb)
    ps.set_shape(s, name)
    V = hand_verts(ps, body, s)
    tpick = tgrid[0] if tgrid else (None, thumb, None, None)
    cen = cen + ax * (kmid - cen).dot(ax)                  # the middle of the fist's width
    pv = pc - cen
    pv = (pv - ax * pv.dot(ax)).normalized()
    prox = sum(((ps.ph(c[0]) + ps.pt(c[0])) / 2 for c in d["fingers"][1:]), Vector()) / 4 - cen
    kv = (prox - ax * prox.dot(ax) - pv * prox.dot(pv)).normalized()
    HF[s][name] = {"c": list(Mi @ cen), "a": list(R3i @ ax), "p": list(R3i @ pv), "k": list(R3i @ kv), "r": target}
    tips = {names[ci]: round(float(cyl_gap(V[c[-1]], cen, ax, target).min()) * 1000, 1)
            for ci, c in enumerate(d["fingers"]) if c[-1] in V}
    ps.reset()
    return {"channel_diameter_mm": round(2 * target * 1000, 1), "fitted_ring_diameter_mm": round(2 * r * 1000, 1),
            "ring_radii_mm": rings, "curl_factor": round(kg, 3), "finger_factors": [round(x, 3) for x in kf],
            "thumb_deg": {"flex": thumb[0], "opposition": thumb[1], "mcp": thumb[2], "ip": thumb[3],
                          "tip_to_forefinger_mm": None if tpick[2] is None else round(tpick[2] * 1000, 1),
                          "into_channel_mm": None if tpick[3] is None else round(max(0.0, -tpick[3]) * 1000, 1)},
            "channel_found": found,
            "joint_angles_deg": {names[ci]: [round(a * kf[ci - 1], 1) for a in SHAPES["grip"]["fingers"][ci - 1]] for ci in (1, 2, 3, 4)},
            "channel_axis_to_knuckle_line_deg": round(math.degrees(ax.angle(a0)), 1),
            "channel_axis_to_hand_axis_deg": round(math.degrees(ax.angle(H0w)), 1),
            "tips_to_channel_mm": tips, "fit": hist}


def calibrate_hands(ps, body):
    """Once, at the rest pose: RELAXED as authored; GRIP fitted to the stock (40 mm channel) and
    the same GRIP angles closed tighter, "grip_small", for the rammer and cartridge (13 mm).
    No pose ever changes a finger."""
    rep = {}
    for s in ("L", "R"):
        ps.reset()
        SQ[s]["relaxed"] = shape_quats(ps, s, SHAPES["relaxed"])
        rep[s] = {"grip": fit_grip(ps, body, s, "grip", G["grip_channel_r"], per_finger=False, thumb_in=0.004),
                  "grip_small": fit_grip(ps, body, s, "grip_small", G["grip_small_r"], per_finger=True, thumb_in=0.002)}
        ps.reset()
    REP["hand_shapes"] = {
        "shapes": SHAPES, "fitted": rep,
        "note": "fixed hand shapes, the same joint angles in every clip and for both hands (mirrored). GRIP: the "
                "authored angles x one curl factor and one factor per finger, fitted once at rest on the real "
                "skin to a 40 mm channel (the stock); grip_small: the same, to a 13 mm channel (rammer, cartridge)"}


def shape_dev(ps, s, shape):
    """Largest angle (deg) between any finger joint's keyed rotation and its fixed shape."""
    worst = 0.0
    for bn, q in SQ[s][shape].items():
        cur = ps.P(bn).rotation_quaternion
        worst = max(worst, math.degrees(cur.rotation_difference(q).angle))
    return round(worst, 2)


def measure_holds(ps, body):
    """The acceptance check, on the real skinned hand at every keyed frame: deviation from the
    fixed shape, hold frame (fist channel) to the held object's axis, each fingertip's
    distance to the held surface (+ outside, - inside) and the deepest penetration."""
    sc = bpy.context.scene
    names = ("thumb", "index", "middle", "ring", "little")
    summary, worst = {}, {"shape_dev_deg": 0.0, "axis_mm": 0.0, "tip_gap_max_mm": 0.0, "penetration_mm": 0.0}
    for e in HOLDLOG:
        sc.frame_set(e["frame"])
        C.update()
        s, shape = e["side"], e["shape"]
        dev = shape_dev(ps, s, shape)
        V = hand_verts(ps, body, s)
        fr = HF[s][shape]
        Mw = ps.P(ps.S[s]["hand"]).matrix
        cen = Mw @ Vector(fr["c"])
        ax = (Mw.to_3x3() @ Vector(fr["a"])).normalized()
        D = e["axis_dir"]
        v = cen - e["axis_pt"]
        dist = (v - D * v.dot(D)).length
        ang = math.degrees(math.acos(min(1.0, abs(ax.dot(D)))))
        tips = {}
        for ci, chain in enumerate(ps.S[s]["fingers"]):
            pts = V.get(chain[-1])
            if pts is not None and len(pts):
                tips[names[ci]] = round(min(e["surf"].gap(Vector(p.tolist())) for p in pts) * 1000, 1)
        used = names
        tip_max = max([max(0.0, tips[n]) for n in used if n in tips] or [0.0])
        pen, pen_by = 0.0, {}
        for bn, pts in V.items():
            for p in pts:
                pv = Vector(p.tolist())
                ga = min([e["surf"].gap(pv)] + [x.gap(pv) for x in e["extra"]])
                pen = max(pen, -ga)
                if ga < -0.001:
                    pen_by[bn] = max(pen_by.get(bn, 0.0), -ga)
        rec = {"shape_dev_deg": dev, "axis_mm": round(dist * 1000, 1), "axis_deg": round(ang, 1),
               "tips_mm": tips, "tip_gap_max_mm": round(tip_max, 1), "penetration_mm": round(pen * 1000, 1),
               "penetration_by_bone_mm": {b: round(v * 1000, 1) for b, v in sorted(pen_by.items(), key=lambda x: -x[1])[:4]}}
        rec["ok"] = bool(dev <= 3.0 and rec["axis_mm"] <= 5.0 and rec["tip_gap_max_mm"] <= 10.0)
        REP["holds"][e["key"]][s].update(rec)
        for k_ in worst:
            worst[k_] = max(worst[k_], rec[k_])
        summary["%s %s" % (e["key"], s)] = "%s on %s: shape dev %.1f deg, channel %.1f mm / %.1f deg off the axis, worst fingertip gap %.1f mm, penetration %.1f mm, wrist %.0f deg%s" % (
            shape.upper(), e["obj"], dev, rec["axis_mm"], rec["axis_deg"], rec["tip_gap_max_mm"], rec["penetration_mm"],
            REP["holds"][e["key"]][s]["wrist_bend_deg"], "" if rec["ok"] else "  ** FAILS **")
    free = {}
    for key, frame, s in FREELOG:
        sc.frame_set(frame)
        C.update()
        free.setdefault(key, {})[s] = {"shape": "relaxed", "shape_dev_deg": shape_dev(ps, s, "relaxed")}
        worst["shape_dev_deg"] = max(worst["shape_dev_deg"], free[key][s]["shape_dev_deg"])
    REP["free_hands"] = free
    REP["hand_summary"] = summary
    REP["hand_acceptance"] = {"worst": worst, "holds": len(HOLDLOG), "free": len(FREELOG),
                              "failing": [k for k, v in summary.items() if v.endswith("**")]}


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
    T.mark("hand rest frame")
    calibrate_hands(ps, body)
    T.mark("fixed hand shapes measured")

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
        measure_holds(ps, body)
    except Exception as e:  # noqa: BLE001
        import traceback
        REP["hand_check_error"] = traceback.format_exc()[-1500:]
        C.log("measure_holds FAILED:", e)
    T.mark("hand acceptance check")
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
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, "posed.blend"), compress=False)
    T.mark("saved posed.blend")
    REP["timing"] = T.marks
    C.write_report("poses", REP)


main()
