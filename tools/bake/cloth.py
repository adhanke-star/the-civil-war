# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 3b of the bake (third pass): settle the cloth per pose. For every clip frame (not the
# fallen one) and each garment (trousers, coat with its sleeves, coat skirt):
#   1. the garment as the armature poses it is copied out as a static mesh (start state), with
#      a shape key "rest" holding its REST-pose shape: Blender cloth takes its spring lengths from
#      that key, so cloth that the pose squeezes (inside the elbow, behind the knee, at the
#      waist) buckles into folds and cloth that the pose stretches pulls smooth;
#   2. pinned where it is held (shoulders and torso under the belts, the waist band, the top of
#      the skirt), weighted at the cuffs and hems so they stay on the wrist and shoe;
#   3. it settles for CL["frames"] frames under gravity, colliding with the posed body (and,
#      for the skirt, the posed trousers) in a scene of its own;
#   4. the settled shape is checked (finite, no vertex moved more than CL["max_move_m"], and it
#      actually moved) and kept as a static copy "<garment>@<frame>" that renders only at that
#      frame; the armature-posed original is hidden at that frame.
# A garment/frame that fails the check keeps the armature-posed garment with its procedural
# folds (uniform.py). Everything is reported in report/cloth.json. Work is budgeted
# (--budget-min); frames are done in priority order (stand, walk, fire, load).
#
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/cloth.py -- --out .out/bake

import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

# All placeholder estimates, judged by eye; wool flannel and kersey are not measured here.
CL = {
    "frames": C.arg("frames", 36),          # settle frames per pose                     placeholder
    "quality": 6,                           # solver steps per frame                     placeholder
    "mass_kg": 0.35,                        # vertex mass                                placeholder
    "tension": 18.0, "compression": 4.0, "shear": 6.0, "bending": 0.6,   # wool, fairly stiff placeholder
    "air_damping": 1.5,
    "collision_distance_m": 0.0035,         # cloth keeps this far off the body          placeholder
    "collider_thickness_m": 0.003,
    "max_move_m": 0.07,                     # a settled vertex further than this = a failed sim
    "min_move_m": 0.0008,                   # mean move below this = nothing happened
    "budget_min": C.arg("budget-min", 14.0),
}
ORDER = [1, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 41, 42, 43, 44, 45]
GARMENTS = ["tcw_trousers", "tcw_coat", "tcw_coat_skirt"]
REP = {"settings": CL, "results": {}, "skipped": []}
T = C.Timer()


def eval_coords(obj, keep=("ARMATURE",)):
    """World coordinates of obj evaluated with only the listed modifier types on."""
    state = [(m, m.show_viewport) for m in obj.modifiers]
    for m in obj.modifiers:
        m.show_viewport = m.type in keep
    try:
        C.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        faces = [tuple(p.vertices) for p in me.polygons]
        ev.to_mesh_clear()
        M = np.array(ev.matrix_world)
    finally:
        for m, v in state:
            m.show_viewport = v
    co = co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
    return co, faces


def body_collider_coords(body):
    """The posed body for collision: armature on, the helper mask on (no eyeballs or teeth
    proxies), the 'covered' mask OFF (the skin under the clothes must collide)."""
    state = [(m, m.show_viewport) for m in body.modifiers]
    for m in body.modifiers:
        m.show_viewport = m.type == "ARMATURE" or (m.type == "MASK" and m.name != "Hide covered")
    try:
        C.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        faces = [tuple(p.vertices) for p in me.polygons]
        ev.to_mesh_clear()
        M = np.array(ev.matrix_world)
    finally:
        for m, v in state:
            m.show_viewport = v
    return co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3], faces


def pin_weights(obj, kind, rest, lmh):
    """Goal (pin) weight per vertex: 1 = held where the armature puts it, 0 = free."""
    n = len(rest)
    gi = {g.index: g.name for g in obj.vertex_groups}
    armw = np.zeros(n)
    for v in obj.data.vertices:
        for g in v.groups:
            nm = gi.get(g.group, "")
            if nm.startswith(("upperarm", "lowerarm", "wrist", "finger", "metacarpal")):
                armw[v.index] += g.weight
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    boundary = np.array([v.is_boundary for v in bm.verts])
    bm.free()
    z = rest[:, 2]
    hip, waist = lmh.get("hip_z", 0.95), lmh.get("waist_z", 1.07)
    if kind == "tcw_coat":
        w = 1.0 - np.clip((armw - 0.15) / 0.45, 0.0, 1.0)              # torso held by belts and straps
        w = np.where(boundary & (armw > 0.5), 0.75, w)                 # cuffs stay on the wrists
    elif kind == "tcw_trousers":
        w = np.clip((z - (hip - 0.12)) / 0.08, 0.0, 1.0)               # waistband and seat
        w = np.where(boundary & (z < hip - 0.3), 0.45, w)              # hems stay on the shoes
    else:
        w = np.clip((z - (waist - 0.07)) / 0.05, 0.0, 1.0)             # skirt hangs from the belt
    return np.clip(w, 0.0, 1.0)


def simulate(name, start, rest, faces, pins, colliders):
    sc = bpy.data.scenes.new("tcw_sim_" + name)
    sc.frame_start, sc.frame_end = 1, CL["frames"]
    made = []
    try:
        me = bpy.data.meshes.new(name + "_sim")
        me.from_pydata([tuple(p) for p in start], [], faces)
        me.update()
        ob = bpy.data.objects.new(name + "_sim", me)
        sc.collection.objects.link(ob)
        made.append(ob)
        ob.shape_key_add(name="Basis", from_mix=False)
        kr = ob.shape_key_add(name="rest", from_mix=False)
        kr.data.foreach_set("co", rest.reshape(-1).astype(np.float32))
        kr.value = 0.0
        vg = ob.vertex_groups.new(name="pin")
        for i, w in enumerate(pins):
            if w > 1e-4:
                vg.add([i], float(w), "REPLACE")
        md = ob.modifiers.new("Cloth", "CLOTH")
        s = md.settings
        s.quality = CL["quality"]
        s.mass = CL["mass_kg"]
        s.tension_stiffness = CL["tension"]
        s.compression_stiffness = CL["compression"]
        s.shear_stiffness = CL["shear"]
        s.bending_stiffness = CL["bending"]
        s.air_damping = CL["air_damping"]
        s.vertex_group_mass = "pin"
        s.pin_stiffness = 1.0
        try:
            s.rest_shape_key = kr
        except Exception as e:  # noqa: BLE001
            REP.setdefault("warnings", []).append("rest_shape_key: %s" % e)
        cs = md.collision_settings
        cs.use_collision = True
        cs.distance_min = CL["collision_distance_m"]
        cs.use_self_collision = False
        cs.collision_quality = 3
        md.point_cache.frame_start = 1
        md.point_cache.frame_end = CL["frames"]
        for cname, (cco, cf) in colliders.items():
            cm = bpy.data.meshes.new(cname)
            cm.from_pydata([tuple(p) for p in cco], [], cf)
            cm.update()
            co_ = bpy.data.objects.new(cname, cm)
            sc.collection.objects.link(co_)
            made.append(co_)
            co_.modifiers.new("Collision", "COLLISION")
            co_.collision.thickness_outer = CL["collider_thickness_m"]
            co_.collision.cloth_friction = 5.0
        for f in range(1, CL["frames"] + 1):
            sc.frame_set(f)
        dg = sc.view_layers[0].depsgraph
        ev = ob.evaluated_get(dg)
        m2 = ev.to_mesh()
        n = len(m2.vertices)
        out = np.empty(n * 3, dtype=np.float64)
        m2.vertices.foreach_get("co", out)
        ev.to_mesh_clear()
        return out.reshape(-1, 3)
    finally:
        for o in made:
            d = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if d is not None and d.users == 0:
                bpy.data.meshes.remove(d)
        bpy.data.scenes.remove(sc)


def keep_copy(garment, frame, coords, rig):
    """A static copy of the garment in the settled shape, shown only at `frame`."""
    cp = garment.copy()
    cp.data = garment.data.copy()
    cp.name = "%s@%d" % (garment.name, frame)
    cp.animation_data_clear()
    for m in list(cp.modifiers):
        if m.type == "ARMATURE":
            cp.modifiers.remove(m)
    cp.vertex_groups.clear()
    cp.parent = rig
    cp.matrix_parent_inverse = rig.matrix_world.inverted()
    cp.matrix_basis = Matrix()
    Minv = np.array(cp.matrix_world.inverted())
    local = coords @ Minv[:3, :3].T + Minv[:3, 3]
    cp.data.vertices.foreach_set("co", local.reshape(-1).astype(np.float32))
    cp.data.update()
    for coll in garment.users_collection:
        coll.objects.link(cp)
    cp["tcw_cloth_of"] = garment.name
    cp["tcw_cloth_frame"] = frame
    return cp


def key_visibility(rig, kept):
    """Every clip frame gets a hide_render key: a cloth copy shows only at its own frame, and the
    armature-posed garment hides wherever a copy replaces it."""
    frames = ORDER + [31]
    by_g = {}
    for (g, f), cp in kept.items():
        by_g.setdefault(g, {})[f] = cp
    for g, fmap in by_g.items():
        orig = bpy.data.objects[g]
        for f in frames:
            orig.hide_render = f in fmap
            orig.keyframe_insert("hide_render", frame=f)
            for f2, cp in fmap.items():
                cp.hide_render = f2 != f
                cp.keyframe_insert("hide_render", frame=f)
    for ob in [bpy.data.objects[g] for g in by_g] + list(kept.values()):
        ad = ob.animation_data
        if ad and ad.action:
            for fc in ad.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"


def main():
    t0 = time.time()
    path = os.path.join(C.WORK, "posed.blend")
    bpy.ops.wm.open_mainfile(filepath=path)
    T.mark("open posed.blend")
    sc = bpy.context.scene
    rig, body = C.find_rig(), C.find_body()
    lmh = C.read_report("uniform").get("landmark_heights", {})
    gar = {g: bpy.data.objects.get(g) for g in GARMENTS}
    rest = {}
    pins = {}
    for g, ob in gar.items():
        if ob is None:
            REP["skipped"].append(g + ": missing")
            continue
        r = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
        ob.data.vertices.foreach_get("co", r)
        Mw = np.array(ob.matrix_world)
        rest[g] = r.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]
        pins[g] = pin_weights(ob, g, rest[g], lmh)
        REP.setdefault("pinned_share", {})[g] = round(float((pins[g] > 0.5).mean()), 3)
    kept = {}
    budget = CL["budget_min"] * 60.0
    for f in ORDER:
        sc.frame_set(f)
        bco, bf = body_collider_coords(body)
        posed_trousers = None
        for g in GARMENTS:
            ob = gar.get(g)
            if ob is None or g not in rest:
                continue
            if time.time() - t0 > budget:
                REP["skipped"].append("%s@%d: budget" % (g, f))
                continue
            t = time.time()
            key = "%s@%d" % (g, f)
            try:
                start, faces = eval_coords(ob)
                if len(start) != len(rest[g]):
                    raise RuntimeError("vertex count %d vs rest %d" % (len(start), len(rest[g])))
                cols = {"body": (bco, bf)}
                if g == "tcw_coat_skirt":
                    cols["trousers"] = posed_trousers if posed_trousers is not None else eval_coords(gar["tcw_trousers"])
                out = simulate(g.replace("tcw_", ""), start, rest[g], faces, pins[g], cols)
                mv = np.linalg.norm(out - start, axis=1)
                ok = bool(np.isfinite(out).all()) and float(mv.max()) < CL["max_move_m"] and float(mv.mean()) > CL["min_move_m"]
                REP["results"][key] = {"ok": ok, "seconds": round(time.time() - t, 2),
                                       "max_move_mm": round(float(mv.max()) * 1000, 1),
                                       "mean_move_mm": round(float(mv.mean()) * 1000, 2),
                                       "verts": len(start)}
                if ok:
                    kept[(g, f)] = keep_copy(ob, f, out, rig)
                if g == "tcw_trousers":
                    posed_trousers = ((out if ok else start), faces)
            except Exception as e:  # noqa: BLE001
                import traceback
                REP["results"][key] = {"ok": False, "error": "%s: %s" % (type(e).__name__, e),
                                       "trace": traceback.format_exc()[-800:], "seconds": round(time.time() - t, 2)}
                C.log("cloth FAILED", key, e)
        T.mark("frame %d" % f)
    key_visibility(rig, kept)
    REP["kept"] = sorted("%s@%d" % k for k in kept)
    REP["kept_count"] = len(kept)
    REP["tried"] = len(REP["results"])
    sc.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=False)
    T.mark("saved posed.blend")
    REP["timing"] = T.marks
    REP["seconds"] = round(time.time() - t0, 1)
    C.write_report("cloth", REP)


main()
