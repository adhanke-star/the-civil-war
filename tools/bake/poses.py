# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 3 of the bake: key the poses on the rig by script (no motion data) and save
# work/posed.blend plus report/poses.json (clip -> frame numbers, fps, ground speed).
#
#   stand   frame 1        shoulder arms, position of the soldier
#   walk    frames 11-18   8-frame march, musket at right shoulder shift
#   fire    frames 21-23   aim, fire (recoil), recover
#   fallen  frame 31       lying on the back, musket dropped
#
# Limbs are placed with an analytic two-bone IK toward world targets; hands are solved onto
# grip points of the musket, so the musket and hands stay together in every frame.
#
# HISTORY STATUS: drill positions follow the commonly described Hardee/Casey manual of arms
# (Inferred, recalled, not yet cited twice). Cadence 110 steps/min and 28 in step for quick
# time are Inferred. Everything else is a placeholder estimate.
#
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/poses.py -- --out .out/bake

import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

G = {
    "steps_per_min": 110.0,     # quick time                                  Inferred
    "step_m": 0.711,            # 28 in step                                  Inferred
    "stance_frac": 0.60,        # walking stance share of the cycle           placeholder
    "foot_lift": 0.09,          # swing clearance of the ankle                placeholder
    "march_lean_deg": 4.0,      #                                             placeholder
    "pelvis_yaw_deg": 4.0,      #                                             placeholder
    "arm_swing_deg": 16.0,      # free (left) arm swing                       placeholder
    "aim_body_yaw_deg": -40.0,  # body turned right of the line of fire       placeholder
    "recoil_deg": 7.0,          # muzzle rise at the shot                     placeholder
}
FR = {"stand": [1], "walk": list(range(11, 19)), "fire": [21, 22, 23], "fallen": [31]}

T = C.Timer()
REP = {"constants": G, "frames": {}, "ik_error_m": {}}


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


def place_gun(musket, M, frame):
    musket.matrix_basis = M
    musket.keyframe_insert("location", frame=frame)
    musket.keyframe_insert("rotation_quaternion", frame=frame)


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
    ps.look(F)
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
    err["armR"] = ps.arm("R", guard - L * 0.035 - F * 0.01 + U * 0.065, -F - L * 0.3)
    ps.hand("R", -U + F * 0.15, palm_want=L)
    ps.curl("R")
    shL = ps.ph(ps.S["L"]["upper"][0])
    reachL = ps.len["L"]["upper"] + ps.len["L"]["lower"]
    err["armL"] = ps.arm("L", shL - U * (0.95 * reachL) + F * 0.02 + L * 0.03, -F + L * 0.3)
    ps.hand("L", -U, palm_want=-L)
    ps.curl("L", degs=(12, 18, 12), thumb=8)
    ps.key(frame)
    return err


def pose_walk(ps, musket, frame, k):
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    p = k / 8.0
    S = G["step_m"]
    A = G["stance_frac"] * S          # stance excursion half-length (1.2 S per stance / 2)
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
    # how far down must the pelvis drop for both ankles to be reachable?
    drop = 0.0
    for s in ("L", "R"):
        x, lift, pitch = feet[s]
        hip = ps.rest_hip[s]
        ank = ps.rest_ank[s] + F * x
        ank.z += lift + (0.06 * math.sin(math.radians(-pitch)) if pitch < 0 else 0.0)
        reach = 0.985 * (ps.len[s]["thigh"] + ps.len[s]["shin"])
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
        ank = ps.rest_ank[s] + F * x
        ank.z += lift + (0.06 * math.sin(math.radians(-pitch)) if pitch < 0 else 0.0)
        err["leg" + s] = ps.leg(s, ank, F)
        ps.foot(s, ps.foot_rest_dir(s, pitch_deg=pitch, yaw_deg=(6.0 if s == "L" else -6.0)))
    ps.look(F - U * 0.05)
    # right shoulder shift
    shR = ps.ph(ps.S["R"]["upper"][0])
    B = shR + F * 0.17 - U * 0.27 + L * 0.07
    Cp = shR + U * 0.075 + F * 0.02
    zg = (Cp - B).normalized()
    M = gun_matrix(B, zg, -F)
    place_gun(musket, M, frame)
    gx, gy, gz = gun_axes(M)
    grip = M @ Vector((0, -0.07, 0.035))
    err["armR"] = ps.arm("R", grip - gy * 0.035 - gz * 0.05, -U - L * 0.4)
    ps.hand("R", gz, palm_want=gy)
    ps.curl("R")
    shL = ps.ph(ps.S["L"]["upper"][0])
    reachL = ps.len["L"]["upper"] + ps.len["L"]["lower"]
    swing = G["arm_swing_deg"] * math.cos(2 * math.pi * p)
    down = C.rot(L, swing) @ (-U)
    err["armL"] = ps.arm("L", shL + down * (0.93 * reachL) + L * 0.03, -F + L * 0.2)
    ps.hand("L", down + F * 0.1, palm_want=-L)
    ps.curl("L", degs=(15, 25, 15), thumb=8)
    ps.key(frame)
    return err


def pose_fire(ps, musket, frame, stage):
    F, L, U = ps.F, ps.L, ps.U
    ps.reset()
    yaw = G["aim_body_yaw_deg"]
    back = {0: 0.0, 1: 0.022, 2: 0.010}[stage]
    rise = {0: -1.0, 1: G["recoil_deg"], 2: 3.0}[stage]
    ps.translate(ps.rm["root"], -U * 0.025 - F * back)
    ps.root_rotate(C.rot(U, yaw))
    ps.spine(U, -yaw * 0.30)
    ps.spine(L, 6.0 - 3.0 * (stage == 1))
    err = {}
    ankL = ps.rest_ank["L"] + F * 0.20 + L * 0.02
    ankR = ps.rest_ank["R"] - F * 0.16 - L * 0.04
    err["legL"] = ps.leg("L", ankL, F + L * 0.2)
    err["legR"] = ps.leg("R", ankR, F - L * 0.6)
    ps.foot("L", ps.foot_rest_dir("L", yaw_deg=-12.0))
    ps.foot("R", ps.foot_rest_dir("R", yaw_deg=-72.0))
    ps.look(F - U * 0.12, roll_deg=-14.0)
    shR = ps.ph(ps.S["R"]["upper"][0])
    P = shR + F * 0.03 + L * 0.07 + U * 0.03
    zdir = C.rot(L, -rise) @ F
    M0 = gun_matrix(P, zdir, U)
    gx, gy, gz = gun_axes(M0)
    M = gun_matrix(P + gy * 0.05, zdir, U)
    place_gun(musket, M, frame)
    gx, gy, gz = gun_axes(M)
    gripL = M @ Vector((0, -0.02, 0.62))
    err["armL"] = ps.arm("L", gripL - gy * 0.04 + gx * 0.035 - gz * 0.03, -U + L * 0.2)
    ps.hand("L", (-gx + gy * 0.3), palm_want=gy)
    ps.curl("L", degs=(40, 50, 40), thumb=25)
    gripR = M @ Vector((0, -0.02, 0.30))
    err["armR"] = ps.arm("R", gripR - gx * 0.04 - gy * 0.03 - gz * 0.06, -L - U * 0.3)
    ps.hand("R", (gx * 0.5 - gy * 0.5 + gz * 0.6), palm_want=gx)
    ps.curl("R")
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


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(C.WORK, "soldier.blend"))
    T.mark("open soldier.blend")
    rig, rm = C.find_rig(), C.rigmap()
    musket = bpy.data.objects["tcw_musket"]
    musket.rotation_mode = "QUATERNION"
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
    scene = bpy.context.scene

    def run(name, frame, fn):
        t = C.time.time()
        scene.frame_set(frame)
        err = fn()
        REP["ik_error_m"]["%s@%d" % (name, frame)] = {k: round(v, 4) for k, v in err.items()}
        REP["frames"]["%s@%d" % (name, frame)] = round(C.time.time() - t, 2)

    run("stand", 1, lambda: pose_stand(ps, musket, 1))
    for k, f in enumerate(FR["walk"]):
        run("walk", f, lambda k=k, f=f: pose_walk(ps, musket, f, k))
    for st, f in enumerate(FR["fire"]):
        run("fire", f, lambda st=st, f=f: pose_fire(ps, musket, f, st))
    run("fallen", 31, lambda: pose_fallen(ps, musket, 31))
    T.mark("posed all frames")

    for ob in (rig, musket):
        ad = ob.animation_data
        if ad and ad.action:
            for fc in ad.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"
    for md in saved:
        md.show_viewport = True
    scene.frame_start, scene.frame_end = 1, 31
    worst = max((v for d in REP["ik_error_m"].values() for v in d.values()), default=0.0)
    REP["ik_error_worst_m"] = worst
    cycle_s = 2.0 * 60.0 / G["steps_per_min"]
    clips = {
        "stand": {"frames": FR["stand"], "fps": 1, "loop": False},
        "walk": {"frames": FR["walk"], "fps": round(8 / cycle_s, 3), "loop": True,
                 "metres_per_cycle": round(2 * G["step_m"], 3),
                 "speed_mps": round(2 * G["step_m"] / cycle_s, 3)},
        "fire": {"frames": FR["fire"], "fps": 8, "loop": False},
        "fallen": {"frames": FR["fallen"], "fps": 1, "loop": False},
    }
    REP["clips"] = clips
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.WORK, "posed.blend"), compress=False)
    T.mark("saved posed.blend")
    REP["timing"] = T.marks
    C.write_report("poses", REP)


main()
