# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 4 of the bake: render the posed soldier (work/posed.blend) into sprite frames.
#
# Camera: orthographic, fixed, looking "north" (+Y) and down at --elevation degrees (default 35,
# the game's oblique view). The FIGURE turns through --directions yaw steps instead, so the
# lights stay fixed relative to the screen: ONE standard key light (the sun) that reads as
# upper-left on screen, high and slightly toward the viewer so fronts are lit. Fills ride with
# it and never cast a ground shadow: a cool rim from behind-right, a soft frontal fill, a green
# ground bounce and (third pass) a low warm face bounce from below the eye line that lifts the
# eyes out of the cap's shadow, as light reflected off sunlit ground would (all light-linked to
# the soldier only). A transparent shadow-catcher ground keeps the soft contact shadow in the
# alpha channel. Cycles CPU + OpenImageDenoise.
#
# Framing (second pass): each clip gets its own orthographic scale and centre, fitted to the
# union over all frames and all N directions of the posed figure AND its cast shadow, plus a
# margin. render.json records orthoM / pxPerMetre / anchor per clip and tier.
#
# Direction d: the figure faces d * 360/N degrees counter-clockwise (seen from above) from
# "toward the camera". d=0 faces the viewer, d=N/4 faces screen-right, d=N/2 faces away.
#
# Shards (third pass): --shard picks one slice of the work so a job matrix renders in parallel.
#   all          everything in one process (quick runs; --quick 1 renders the small check set)
#   hero         hero, close-up, portrait, hands close-up, close-tier variants, head rows, hand rows
#   c<k>of<n>    close tier, every clip, directions d with d % n == k
#   f<k>of<n>    field tier, the base figure AND every field variant, directions d % n == k
# Every frame of every clip is rendered in all N directions; there is no time-budget reduction.
# Each shard writes report/render-<shard>.json; pack.mjs merges them into render.json.
#
# Outputs (under --out):
#   frames/<tier>/<clip>_<i>_d<dd>.png    tier = close (256 px) | field (96 px)
#   frames/field_<variant>/...            field-tier variants (head x hat x blanket roll)
#   variants/<name>.png                   close tier, stand, hero direction (legacy variants, heads)
#   heads/<head>.png                      256 px head-and-shoulders of every head preset
#   hands/<clip>_<i>.png                  256 px hand close-up of every grip frame
#   hero.png, hero-closeup.png, portrait.png, hands.png (1024 px)
#   report/render[-<shard>].json
#
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/render.py -- \
#         --out .out/bake --samples-close 32 --samples-field 16 --samples-hero 96 \
#         --directions 16 --elevation 35 [--shard hero|c0of3|f2of4|all] [--quick 1]

import json
import math
import os
import statistics
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

P = {
    "elevation": C.arg("elevation", 35.0),        # camera degrees above horizontal
    "directions": C.arg("directions", 16),
    "margin": C.arg("margin", 0.04),              # fraction added around the fitted box
    "pad_m": C.arg("pad-m", 0.05),                # metres added around the fitted box (soft shadow edge)
    "close_px": C.arg("close-px", 256),
    "field_px": C.arg("field-px", 96),
    "hero_px": C.arg("hero-px", 1024),
    "samples_close": C.arg("samples-close", 48),
    "samples_field": C.arg("samples-field", 24),
    "samples_hero": C.arg("samples-hero", 128),
    "samples_closeup": C.arg("samples-closeup", 72),
    "samples_shot": C.arg("samples-shot", 64),    # 256 px head and hand shots
    # the ONE standard light: warm key sun, upper-left on screen, slightly toward the viewer
    "sun_az": C.arg("sun-az", 200.0),             # deg, ground plane, from screen-right CCW
    "sun_el": C.arg("sun-el", 52.0),              # key elevation: models folds from upper-left
    "shadow_el": C.arg("shadow-el", 74.0),        # ground-shadow sun: same azimuth, ~0.29 m per metre
    "sun_strength": C.arg("sun-strength", 3.4),
    "sun_soft_deg": C.arg("sun-soft", 3.0),
    "shadow_soft_deg": C.arg("shadow-soft", 9.0),  # soft, short ground shadow (fixed on screen in game)
    "view_transform": C.arg("view-transform", "Standard"),
    "exposure": C.arg("exposure", 0.0),
    # frontal fill from the camera side, soldier only
    "fill_el": C.arg("fill-el", 12.0),
    "fill_strength": C.arg("fill-strength", 0.9),
    "fill_rgb": (1.0, 1.0, 1.0),
    # third pass: warm bounce from the sunlit ground in front, from below the eye line, soldier
    # only. It reaches under the visor (pass 2 left the eyes black) without a second shadow.
    "face_bounce_az": C.arg("face-bounce-az", 262.0),
    "face_bounce_el": C.arg("face-bounce-el", -16.0),
    "face_bounce_strength": C.arg("face-bounce-strength", 1.0),
    "face_bounce_rgb": (1.0, 0.86, 0.68),
    # field tier only: thicken the musket's cross-section so it survives at 96 px (readability choice)
    "field_musket_scale": C.arg("field-musket-scale", 1.7),
    # field-tier variants: <head>_<cap|slouch>_<roll|noroll> (see variant_comp)
    "field_variants": C.arg("field-variants", "h2_cap_roll,h3_slouch_roll,h4_cap_noroll,h5_slouch_noroll,"
                                              "h6_cap_roll,h1_slouch_noroll,h4_slouch_roll,h5_cap_roll,h7_cap_roll"),
    "sun_rgb": (1.0, 0.94, 0.86),                 # warm key
    "sky_strength": C.arg("sky-strength", 0.45),
    "sky_hex": "#a9bdd6",                         # cool sky fill (world)
    "rim_az": C.arg("rim-az", 55.0),              # behind-right of the figure, from screen-right CCW
    "rim_el": C.arg("rim-el", 22.0),
    "rim_strength": C.arg("rim-strength", 3.6),
    "rim_rgb": (0.68, 0.80, 1.0),                 # cool rim
    "bounce_w": C.arg("bounce-w", 7.0),           # ground-bounce area light power
    "bounce_rgb": (0.42, 0.55, 0.20),             # green field bounce
    "ground_hex": "#5d6b32",                      # shadow-catcher albedo (indirect bounce only)
    "hero_dir": C.arg("hero-dir", 2),
    "hero_lens": 70.0,
    "hero_el": 10.0,
    "closeup_lens": 105.0,
    "closeup_el": 6.0,
    "portrait_dir": C.arg("portrait-dir", 1),
    "portrait_lens": 135.0,
    "portrait_el": 3.0,
    "hands_lens": 90.0,
    "hands_el": 16.0,
    "head_dir": C.arg("head-dir", 1),
    "skip_field": C.arg("skip-field", False),
    "quick": C.arg("quick", False),
    "shard": C.arg("shard", "all"),
}
T = C.Timer()
REP = {"params": P, "tiers": {}, "variants": {}, "hero": {}, "framing": {}, "shard": P["shard"]}


def variant_comp(name):
    """Composition of a named variant: head preset, hat, blanket roll, bayonet."""
    legacy = {
        "base": dict(head="h1", hat="cap", roll=True, bayonet=False),
        "slouch": dict(head="h1", hat="slouch", roll=True, bayonet=False),
        "bayonet": dict(head="h1", hat="cap", roll=True, bayonet=True),
        "noroll": dict(head="h1", hat="cap", roll=False, bayonet=False),
        "face2": dict(head="h2", hat="cap", roll=True, bayonet=False),
        "mixed": dict(head="h3", hat="slouch", roll=False, bayonet=False),
    }
    if name in legacy:
        return dict(legacy[name])
    parts = name.split("_")
    if len(parts) == 3 and parts[1] in ("cap", "slouch") and parts[2] in ("roll", "noroll"):
        return dict(head=parts[0], hat=parts[1], roll=parts[2] == "roll", bayonet=False)
    raise ValueError("unknown variant " + name)


CLOSE_VARIANTS = ["slouch", "bayonet", "noroll", "face2", "mixed"]
# hand shots: (clip, frame index, hands)
HAND_SHOTS = [("stand", 0, "R"), ("walk", 0, "R"), ("fire", 0, "LR"), ("fire", 1, "R"), ("fire", 2, "LR"),
              ("load", 0, "R"), ("load", 1, "R"), ("load", 2, "R"), ("load", 3, "R"), ("load", 4, "LR")]


def e_vectors():
    e = math.radians(P["elevation"])
    view = Vector((0, math.cos(e), -math.sin(e)))
    up_s = Vector((0, math.sin(e), math.cos(e)))
    return e, view, up_s


def dir_vec(az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception as e:  # noqa: BLE001
        C.log("denoiser:", e)
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 2
    sc.cycles.transmission_bounces = 2
    sc.cycles.transparent_max_bounces = 12   # hair and beard cards are alpha-blended layers
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.render.film_transparent = True
    sc.render.use_persistent_data = True
    sc.render.filter_size = 1.2
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.render.image_settings.compression = 15
    sc.render.resolution_percentage = 100
    vs = sc.view_settings
    try:
        vs.view_transform = P["view_transform"]
        vs.look = "None"
        vs.exposure = P["exposure"]
        vs.gamma = 1.0
    except Exception as e:  # noqa: BLE001
        C.log("colour management:", e)
    REP["colour"] = {"view": vs.view_transform, "look": vs.look}
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*C.hex_rgb(P["sky_hex"]), 1.0)
    bg.inputs["Strength"].default_value = P["sky_strength"]

    lit = bpy.data.collections.new("tcw_lit")
    sc.collection.children.link(lit)
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name not in lit.objects:
            lit.objects.link(o)
    lit.hide_viewport = False

    linked = {}

    def link_to(obj, coll, label):
        try:
            obj.light_linking.receiver_collection = coll
            linked[label] = "light-linked to " + coll.name
            return True
        except Exception as e:  # noqa: BLE001
            linked[label] = "no light linking (%s)" % e
            return False

    def sun_light(name, to_light, strength, rgb, soft_deg):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = strength
        d.color = rgb
        d.angle = math.radians(soft_deg)
        o = bpy.data.objects.new(name, d)
        C.link(o)
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = (-to_light).to_track_quat("-Z", "Y")
        return o

    bpy.ops.mesh.primitive_plane_add(size=16.0, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "tcw_shadow_catcher"
    g.is_shadow_catcher = True
    C.assign(g, C.material("tcw_ground", P["ground_hex"], roughness=1.0))
    if g.name in lit.objects:
        lit.objects.unlink(g)
    ground = bpy.data.collections.new("tcw_ground")
    sc.collection.children.link(ground)
    ground.objects.link(g)

    to_sun = dir_vec(P["sun_az"], P["sun_el"])
    sun = sun_light("tcw_sun", to_sun, P["sun_strength"], P["sun_rgb"], P["sun_soft_deg"])
    to_shadow = dir_vec(P["sun_az"], P["shadow_el"])
    if link_to(sun, lit, "key"):
        shs = sun_light("tcw_shadow_sun", to_shadow, P["sun_strength"], (1.0, 1.0, 1.0), P["shadow_soft_deg"])
        link_to(shs, ground, "shadow")
    else:
        to_shadow = to_sun

    to_rim = dir_vec(P["rim_az"], P["rim_el"])
    rim = sun_light("tcw_rim", to_rim, P["rim_strength"], P["rim_rgb"], 8.0)
    if not link_to(rim, lit, "rim"):
        rim.data.use_shadow = False
    to_fill = dir_vec(270.0, P["fill_el"])
    fill = sun_light("tcw_fill", to_fill, P["fill_strength"], P["fill_rgb"], 25.0)
    if not link_to(fill, lit, "fill"):
        fill.data.use_shadow = False
    to_fb = dir_vec(P["face_bounce_az"], P["face_bounce_el"])
    fb = sun_light("tcw_face_bounce", to_fb, P["face_bounce_strength"], P["face_bounce_rgb"], 35.0)
    if not link_to(fb, lit, "face_bounce"):
        fb.data.use_shadow = False

    b_d = bpy.data.lights.new("tcw_bounce", "AREA")
    b_d.shape = "SQUARE"
    b_d.size = 4.0
    b_d.energy = P["bounce_w"]
    b_d.color = P["bounce_rgb"]
    bounce = bpy.data.objects.new("tcw_bounce", b_d)
    C.link(bounce)
    bounce.location = (0, 0, 0.01)
    bounce.rotation_euler = (math.pi, 0, 0)
    if not link_to(bounce, lit, "bounce"):
        b_d.use_shadow = False
    for lo in (bounce, rim):
        try:
            lo.visible_camera = False
        except Exception:  # noqa: BLE001
            pass

    e, view, up_s = e_vectors()
    REP["sun"] = {"to_sun_world": [round(x, 4) for x in to_sun],
                  "to_sun_screen": [round(to_sun.x, 4), round(to_sun.dot(up_s), 4)],
                  "azimuth_deg": P["sun_az"], "elevation_deg": P["sun_el"],
                  "colour": P["sun_rgb"],
                  "ground_shadow": {"to_light_world": [round(x, 4) for x in to_shadow],
                                    "length_per_metre_height": round(math.hypot(to_shadow.x, to_shadow.y) / to_shadow.z, 3),
                                    "note": "compact contact shadow: same azimuth as the key, steeper"},
                  "note": "world: x = screen right, y = away from viewer, z = up. to_sun_* is the key light "
                          "that shades the figure; the ground shadow follows ground_shadow (same azimuth)."}
    REP["lights"] = {
        "key": {"type": "sun", "to_light_world": [round(x, 4) for x in to_sun], "strength": P["sun_strength"],
                "colour": P["sun_rgb"], "soft_deg": P["sun_soft_deg"], "linking": linked.get("key")},
        "shadow": {"type": "sun", "to_light_world": [round(x, 4) for x in to_shadow], "linking": linked.get("shadow")},
        "rim": {"type": "sun", "to_light_world": [round(x, 4) for x in to_rim], "strength": P["rim_strength"],
                "colour": P["rim_rgb"], "linking": linked.get("rim")},
        "fill": {"type": "sun (soft, from the camera side)", "to_light_world": [round(x, 4) for x in to_fill],
                 "strength": P["fill_strength"], "linking": linked.get("fill")},
        "face_bounce": {"type": "sun (soft, warm, from below the eye line in front; figure only, no ground shadow)",
                        "to_light_world": [round(x, 4) for x in to_fb], "strength": P["face_bounce_strength"],
                        "colour": P["face_bounce_rgb"], "linking": linked.get("face_bounce")},
        "bounce": {"type": "area 4 m square on the ground, facing up", "watts": P["bounce_w"],
                   "colour": P["bounce_rgb"], "linking": linked.get("bounce")},
        "sky": {"hex": P["sky_hex"], "strength": P["sky_strength"]},
    }
    return sc, to_shadow


def ortho_camera():
    cd = bpy.data.cameras.new("tcw_ortho")
    cd.type = "ORTHO"
    cd.ortho_scale = 3.0
    cd.clip_start, cd.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new("tcw_ortho", cd)
    C.link(cam)
    _e, view, _u = e_vectors()
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = view.to_track_quat("-Z", "Y")
    return cam


def frame_ortho(cam, fr, d):
    _e, view, up_s = e_vectors()
    cam.data.ortho_scale = fr["orthoM"]
    cx, cy = fr["centres"][d]
    centre = Vector((cx, 0, 0)) + up_s * cy
    cam.location = centre - view * 30.0


def persp_camera(name, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_fit = "AUTO"
    cd.sensor_width = 36.0
    cd.clip_start, cd.clip_end = 0.05, 100.0
    cam = bpy.data.objects.new(name, cd)
    C.link(cam)
    return cam


def fit_persp(cam, pts, el_deg, margin=0.06):
    """Aim a square perspective camera from the front-below-ortho direction at the points' box
    centre and pull back until every point is inside the frame (with a margin)."""
    pts = np.asarray(pts, dtype=np.float64)
    e = math.radians(el_deg)
    view = np.array([0.0, math.cos(e), -math.sin(e)])
    right = np.array([1.0, 0.0, 0.0])
    up = np.cross(right, view)
    up /= np.linalg.norm(up)
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    target = (lo + hi) / 2
    t = (18.0 / cam.data.lens) * (1.0 - margin)
    rel = pts - target
    dz = rel @ view
    need = max(float(np.max(np.abs(rel @ right) / t - dz)), float(np.max(np.abs(rel @ up) / t - dz)))
    dist = need + 0.05
    cam.location = Vector((target - view * dist).tolist())
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = Vector(view.tolist()).to_track_quat("-Z", "Y")
    return {"target": [round(float(x), 3) for x in target], "distance_m": round(dist, 3),
            "lens_mm": cam.data.lens, "elevation_deg": el_deg}


def turntable(rig):
    tt = bpy.data.objects.new("tcw_turntable", None)
    C.link(tt)
    mw = rig.matrix_world.copy()
    rig.parent = tt
    rig.matrix_parent_inverse = tt.matrix_world.inverted()
    rig.matrix_world = mw
    rep = C.read_report("poses")
    F = Vector(rep.get("frame_basis", {}).get("F", (0, -1, 0)))
    base = math.atan2(-1.0, 0.0) - math.atan2(F.y, F.x)
    REP["base_yaw_deg"] = round(math.degrees(base), 2)
    return tt, base


HEADS_INFO = {}


def set_variant(v):
    """Show one composition: head preset (shape key, skin per slot, its eyes/brows/lashes/hair/
    beard), hat, blanket roll, bayonet."""
    c = v if isinstance(v, dict) else variant_comp(v)
    feats = {c["hat"]}
    if c.get("roll"):
        feats.add("roll")
    if c.get("bayonet"):
        feats.add("bayonet")
    for o in bpy.data.objects:
        tv = o.get("tcw_variant")
        if tv is not None:
            o.hide_render = tv not in feats
        th = o.get("tcw_head")
        if th is not None:
            o.hide_render = th != c["head"]
    body = bpy.data.objects.get(bpy.context.scene.get("tcw_body", ""))
    if body is None:
        return c
    if not HEADS_INFO:
        HEADS_INFO.update(json.loads(body.get("tcw_heads", "{}")))
    keys = body.data.shape_keys
    if keys is not None:
        for k in keys.key_blocks:
            if k.name.startswith("tcw_head_"):
                k.value = 1.0 if k.name == "tcw_head_" + c["head"] else 0.0
    rec = HEADS_INFO.get(c["head"])
    if rec:
        for i, mname in enumerate(rec.get("skins", [])):
            mat = bpy.data.materials.get(mname or "")
            if mat is not None and i < len(body.material_slots) and body.material_slots[i].material != mat:
                body.material_slots[i].material = mat
    return c


def soldier_meshes():
    return [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render
            and o.name != "tcw_shadow_catcher"]


def figure_points(stride=3):
    """World positions of every visible soldier vertex at the current frame and turntable yaw."""
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in soldier_meshes():
        ev = o.evaluated_get(dg)
        try:
            me = ev.to_mesh()
        except Exception:  # noqa: BLE001
            continue
        n = len(me.vertices)
        if n:
            co = np.empty(n * 3, dtype=np.float64)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)[::stride]
            M = np.array(ev.matrix_world)
            out.append(co @ M[:3, :3].T + M[:3, 3])
        ev.to_mesh_clear()
    return np.concatenate(out) if out else np.zeros((1, 3))


def clip_framing(sc, tt, base, frames, to_shadow, N):
    """One ortho scale per clip, one centre per direction (see the header)."""
    e, _view, _up = e_vectors()
    se, ce = math.sin(e), math.cos(e)
    ts = np.array(to_shadow[:])
    tt.rotation_euler = (0, 0, base)
    pts = []
    for f in frames:
        sc.frame_set(f)
        pts.append(figure_points())
    P0 = np.concatenate(pts)
    zpos = np.clip(P0[:, 2], 0.0, None)
    side, centres, boxes = 0.0, [], []
    for d in range(N):
        a = 2 * math.pi * d / N
        ca, sa = math.cos(a), math.sin(a)
        x = P0[:, 0] * ca - P0[:, 1] * sa
        y = P0[:, 0] * sa + P0[:, 1] * ca
        z = P0[:, 2]
        sx = np.concatenate([x, x - ts[0] * zpos / ts[2]])
        sy = np.concatenate([y * se + z * ce, (y - ts[1] * zpos / ts[2]) * se])
        w, h = float(sx.max() - sx.min()), float(sy.max() - sy.min())
        side = max(side, w, h)
        centres.append([round(float(sx.max() + sx.min()) / 2, 4), round(float(sy.max() + sy.min()) / 2, 4)])
        boxes.append([round(w, 3), round(h, 3)])
    ortho = side * (1.0 + P["margin"]) + P["pad_m"]
    return {"orthoM": round(ortho, 4), "centres": centres, "boxes_m": boxes}


def tier_framing(fr, px):
    o = fr["orthoM"]
    anchors = [[round(px / 2.0 - cx / o * px, 2), round(px / 2.0 + cy / o * px, 2)] for cx, cy in fr["centres"]]
    return {"orthoM": o, "pxPerMetre": round(px / o, 4), "anchors": anchors, "anchor": anchors[0]}


def colour_probes(sc, cam, px, lm):
    """Pixel positions in the hero image where named parts are directly visible."""
    from bpy_extras.object_utils import world_to_camera_view
    dg = bpy.context.evaluated_depsgraph_get()
    body = sc.get("tcw_body", "")
    eye_z = lm.get("brow_z", 1.6) - 0.028
    targets = {"coat": "tcw_coat", "trousers": "tcw_trousers", "cartridge belt": "tcw_cartridge_belt",
               "waist belt": "tcw_waist_belt", "blanket roll": "tcw_blanket_roll", "skin (face)": body,
               "haversack": "tcw_haversack", "canteen": "tcw_canteen"}
    cam_loc = cam.matrix_world.translation.copy()
    out = {}
    for label, name in targets.items():
        o = bpy.data.objects.get(name)
        if o is None or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        M = ev.matrix_world.copy()
        pts = [M @ v.co for v in me.vertices]
        ev.to_mesh_clear()
        if label.startswith("skin"):
            pts = [p for p in pts if eye_z - 0.10 < p.z < eye_z + 0.03]
        stride = max(1, len(pts) // 600)
        hits = []
        for p in pts[::stride]:
            d = p - cam_loc
            dist = d.length
            d.normalize()
            ok, loc, _n, _i, hobj, _m = sc.ray_cast(dg, cam_loc, d, distance=dist + 0.02)
            if ok and getattr(hobj, "original", hobj).name == name and (loc - p).length < 0.012:
                uv = world_to_camera_view(sc, cam, p)
                if 0.01 < uv.x < 0.99 and 0.01 < uv.y < 0.99:
                    hits.append([round(uv.x * px, 1), round((1.0 - uv.y) * px, 1)])
            if len(hits) >= 60:
                break
        out[label] = hits
    return out


def render_to(sc, path):
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t


# ------------------------------------------------------------------------------ shots

def bone_world(rig, name, tail=False):
    pb = rig.pose.bones[name]
    return rig.matrix_world @ (pb.tail if tail else pb.head)


def hand_points(rig, rm, sides):
    pts = []
    for s in sides:
        d = rm["side"][s]
        if d["hand"] in rig.pose.bones:
            pts.append(bone_world(rig, d["hand"]))
        for chain in d["fingers"]:
            for bn in chain:
                if bn in rig.pose.bones:
                    pts.append(bone_world(rig, bn, tail=True))
    return pts


def visible_fraction(sc, cam, pts):
    C.update()
    dg = bpy.context.evaluated_depsgraph_get()
    o = cam.matrix_world.translation.copy()
    hit = 0
    for p in pts:
        d = p - o
        dist = d.length
        ok, loc, _n, _i, _obj, _m = sc.ray_cast(dg, o, d.normalized(), distance=dist + 0.05)
        if ok and (loc - p).length < 0.025:
            hit += 1
    return hit / max(1, len(pts))


def hand_shot(sc, tt, base, N, cam, rig, rm, frame, sides, margin, el, cands):
    """Point the camera at the hands from whichever of the candidate yaws sees most of them."""
    best = None
    for d in cands:
        tt.rotation_euler = (0, 0, base + 2 * math.pi * d / N)
        sc.frame_set(frame)
        pts = hand_points(rig, rm, sides)
        fit = fit_persp(cam, [p[:] for p in pts], el, margin=margin)
        vf = visible_fraction(sc, cam, pts)
        if best is None or vf > best[0] + 1e-6:
            best = (vf, d, fit)
    tt.rotation_euler = (0, 0, base + 2 * math.pi * best[1] / N)
    sc.frame_set(frame)
    fit_persp(cam, [p[:] for p in hand_points(rig, rm, sides)], el, margin=margin)
    return {"direction": best[1], "visible": round(best[0], 3), **best[2]}


def head_band_points(sc, rig, rm, stride=2):
    """Head-and-shoulders points: from below the shoulders to the hat top, near the head."""
    pts = figure_points(stride=stride)
    hb = bone_world(rig, rm["head"])
    shz = max(bone_world(rig, rm["side"][s]["upper"][0]).z for s in ("L", "R"))
    sel = pts[(pts[:, 2] > shz - 0.20) & (pts[:, 2] < hb.z + 0.40) &
              (np.hypot(pts[:, 0] - hb.x, pts[:, 1] - hb.y) < 0.34)]
    return sel if len(sel) > 20 else pts


# ------------------------------------------------------------------------------ main

def parse_shard(s):
    if s in ("all", "hero"):
        return s, 0, 1
    kind = s[0]
    k, n = s[1:].split("of")
    return kind, int(k), int(n)


def main():
    t_start = time.time()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(C.WORK, "posed.blend"))
    T.mark("open posed.blend")
    clips = C.read_report("poses")["clips"]
    sc, to_sun = setup_scene()
    cam = ortho_camera()
    rig = C.find_rig()
    rm = C.rigmap()
    tt, base = turntable(rig)
    set_variant("base")
    N = P["directions"]
    hd = P["hero_dir"]
    kind, sk, sn = parse_shard(P["shard"])
    quick = bool(P["quick"])
    do_hero = kind in ("all", "hero")
    REP["quick"] = quick

    # ---- per-clip framing (base variant; every shard computes the same numbers)
    framing = {}
    for clip, c in clips.items():
        framing[clip] = clip_framing(sc, tt, base, c["frames"], to_sun, N)
    REP["framing"] = framing
    T.mark("framing")

    lm = C.read_report("uniform").get("landmark_heights", {})
    if do_hero:
        # ---- hero and close-up: the images a person judges
        tt.rotation_euler = (0, 0, base + 2 * math.pi * hd / N)
        sc.frame_set(clips["stand"]["frames"][0])
        pts = figure_points(stride=2)
        hero = persp_camera("tcw_hero", P["hero_lens"])
        REP["hero"] = fit_persp(hero, pts, P["hero_el"])
        waist = lm.get("waist_z", 1.0)
        cap_top = float(pts[:, 2].max())
        cap = bpy.data.objects.get("tcw_cap")
        if cap is not None:
            dg = bpy.context.evaluated_depsgraph_get()
            ev = cap.evaluated_get(dg)
            me = ev.to_mesh()
            cap_top = max((ev.matrix_world @ v.co).z for v in me.vertices)
            ev.to_mesh_clear()
        band = pts[(pts[:, 2] > waist - 0.12) & (pts[:, 2] < cap_top + 0.02)]
        REP["closeup_band_z"] = [round(waist - 0.12, 3), round(cap_top + 0.02, 3)]
        closeup = persp_camera("tcw_closeup", P["closeup_lens"])
        REP["closeup"] = fit_persp(closeup, band if len(band) > 10 else pts, P["closeup_el"], margin=0.04)
        sc.render.resolution_x = sc.render.resolution_y = P["hero_px"]
        sc.camera = hero
        sc.cycles.samples = P["samples_hero"]
        REP["hero"].update({"px": P["hero_px"], "samples": P["samples_hero"], "direction": hd,
                            "seconds": round(render_to(sc, os.path.join(C.OUT, "hero.png")), 2)})
        try:
            REP["colour_probes"] = colour_probes(sc, hero, P["hero_px"], lm)
        except Exception as e:  # noqa: BLE001
            REP["colour_probes_error"] = str(e)
        T.mark("hero")
        sc.camera = closeup
        sc.cycles.samples = P["samples_closeup"]
        REP["closeup"].update({"px": P["hero_px"], "samples": P["samples_closeup"], "direction": hd,
                               "seconds": round(render_to(sc, os.path.join(C.OUT, "hero-closeup.png")), 2)})
        T.mark("closeup")
        # ---- head-and-shoulders portrait, lit as in game (same lights), near eye level
        pd = P["portrait_dir"]
        tt.rotation_euler = (0, 0, base + 2 * math.pi * pd / N)
        sc.frame_set(clips["stand"]["frames"][0])
        portrait = persp_camera("tcw_portrait", P["portrait_lens"])
        REP["portrait"] = fit_persp(portrait, head_band_points(sc, rig, rm), P["portrait_el"], margin=0.05)
        sc.camera = portrait
        sc.cycles.samples = P["samples_hero"]
        REP["portrait"].update({"px": P["hero_px"], "samples": P["samples_hero"], "direction": pd,
                                "seconds": round(render_to(sc, os.path.join(C.OUT, "portrait.png")), 2)})
        T.mark("portrait")
        # ---- every head preset: 256 px head-and-shoulders with the same camera
        heads = list(HEADS_INFO.keys()) or ["h1"]
        sc.render.resolution_x = sc.render.resolution_y = P["close_px"]
        sc.cycles.samples = P["samples_shot"]
        REP["heads"] = {}
        for h in heads:
            set_variant(dict(head=h, hat="cap", roll=True, bayonet=False))
            REP["heads"][h] = round(render_to(sc, os.path.join(C.OUT, "heads", h + ".png")), 2)
        set_variant("base")
        T.mark("head portraits")
        # ---- hands close-up 1024 px on the musket (the aim frame), and one 256 px shot per grip frame
        hcam = persp_camera("tcw_hands", P["hands_lens"])
        sc.camera = hcam
        cands = [hd, 1, 3, 14, 13, 4]
        f_aim = clips["fire"]["frames"][0]
        REP["hands"] = hand_shot(sc, tt, base, N, hcam, rig, rm, f_aim, "LR", 0.30, P["hands_el"], cands)
        sc.render.resolution_x = sc.render.resolution_y = P["hero_px"]
        sc.cycles.samples = P["samples_hero"]
        REP["hands"].update({"px": P["hero_px"], "frame": f_aim,
                             "seconds": round(render_to(sc, os.path.join(C.OUT, "hands.png")), 2)})
        T.mark("hands close-up")
        sc.render.resolution_x = sc.render.resolution_y = P["close_px"]
        sc.cycles.samples = P["samples_shot"]
        REP["hand_shots"] = {}
        for clip, i, sides in HAND_SHOTS:
            if clip not in clips or i >= len(clips[clip]["frames"]):
                continue
            f = clips[clip]["frames"][i]
            info = hand_shot(sc, tt, base, N, hcam, rig, rm, f, sides, 0.34, P["hands_el"], cands)
            info["seconds"] = round(render_to(sc, os.path.join(C.OUT, "hands", "%s_%d.png" % (clip, i))), 2)
            REP["hand_shots"]["%s_%d" % (clip, i)] = info
        T.mark("hand shots")

        # ---- close-tier variants and heads, standing (each variant with its own stand framing)
        sc.camera = cam
        sc.render.resolution_x = sc.render.resolution_y = P["close_px"]
        sc.cycles.samples = P["samples_close"]
        REP["variants_framing"] = {}
        for v in CLOSE_VARIANTS:
            set_variant(v)
            vf = clip_framing(sc, tt, base, clips["stand"]["frames"], to_sun, N)
            REP["variants_framing"][v] = tier_framing(vf, P["close_px"])
            frame_ortho(cam, vf, hd)
            tt.rotation_euler = (0, 0, base + 2 * math.pi * hd / N)
            sc.frame_set(clips["stand"]["frames"][0])
            REP["variants"][v] = round(render_to(sc, os.path.join(C.OUT, "variants", v + ".png")), 2)
        hdir = P["head_dir"]
        for h in heads:
            set_variant(dict(head=h, hat="cap", roll=True, bayonet=False))
            frame_ortho(cam, framing["stand"], hdir)
            tt.rotation_euler = (0, 0, base + 2 * math.pi * hdir / N)
            sc.frame_set(clips["stand"]["frames"][0])
            REP["variants"]["head_" + h] = round(render_to(sc, os.path.join(C.OUT, "variants", "head_%s.png" % h)), 2)
        set_variant("base")
        T.mark("variants")

    # ---- the sprite frames
    all_d = list(range(N))
    fvars = [v for v in str(P["field_variants"]).split(",") if v]
    for v in fvars:
        variant_comp(v)   # fail early on a bad name
    plan = {}
    if quick:
        if kind in ("all", "hero"):
            plan = {"close": {c: ([0, hd, N // 4, N // 2, 3 * N // 4] if c == "stand" else [hd]) for c in clips},
                    "field": {c: [hd] for c in clips if c in ("stand", "walk")}}
            fvars = fvars[:2]
    elif kind == "all":
        plan = {"close": {c: list(all_d) for c in clips}, "field": {c: list(all_d) for c in clips}}
    elif kind == "c":
        plan = {"close": {c: [d for d in all_d if d % sn == sk] for c in clips}}
    elif kind == "f":
        plan = {"field": {c: [d for d in all_d if d % sn == sk] for c in clips}}
    if P["skip_field"]:
        plan.pop("field", None)
    REP["plan"] = {t: {c: v for c, v in p.items()} for t, p in plan.items()}
    musket = bpy.data.objects.get("tcw_musket")

    def render_set(out, px, spp, plan_t, times, done):
        sc.camera = cam
        sc.render.resolution_x = sc.render.resolution_y = px
        sc.cycles.samples = spp
        os.makedirs(out, exist_ok=True)
        order = ["stand"] + [c for c in clips if c != "stand"]
        for clip in order:
            dirs = plan_t.get(clip, [])
            for d in dirs:
                frame_ortho(cam, framing[clip], d)
                tt.rotation_euler = (0, 0, base + 2 * math.pi * d / N)
                for i, f in enumerate(clips[clip]["frames"]):
                    sc.frame_set(f)
                    times.append(render_to(sc, os.path.join(out, "%s_%d_d%02d.png" % (clip, i, d))))
            if dirs:
                done[clip] = dirs

    tiers = [("close", P["close_px"], P["samples_close"]), ("field", P["field_px"], P["samples_field"])]
    REP["field_variants"] = {"planned": list(fvars) if "field" in plan else []}
    for tier, px, spp in tiers:
        if tier not in plan:
            continue
        if tier == "field" and musket is not None:
            s = P["field_musket_scale"]
            musket.scale = (s, s, 1.0)
        times, done = [], {}
        set_variant("base")
        render_set(os.path.join(C.OUT, "frames", tier), px, spp, plan[tier], times, done)
        REP["tiers"][tier] = {
            "px": px, "samples": spp, "renders": len(times),
            "directions": sorted(set(d for v in done.values() for d in v)),
            "directions_by_clip": done,
            "seconds_total": round(sum(times), 2),
            "seconds_per_frame_mean": round(statistics.mean(times), 3) if times else None,
            "seconds_per_frame_median": round(statistics.median(times), 3) if times else None,
            "seconds_first_frame": round(times[0], 3) if times else None,
            "clips": {c: tier_framing(framing[c], px) for c in clips},
            "px_per_m": tier_framing(framing["stand"], px)["pxPerMetre"],
            "anchor_px": tier_framing(framing["stand"], px)["anchor"],
        }
        T.mark("tier " + tier)
        if tier == "field":
            # extra figure variants in the FIELD tier (same framing and anchors as the base)
            for v in fvars:
                comp = set_variant(v)
                times, done = [], {}
                render_set(os.path.join(C.OUT, "frames", "field_" + v), P["field_px"], P["samples_field"],
                           plan["field"], times, done)
                REP["field_variants"][v] = {"renders": len(times), "seconds_total": round(sum(times), 2),
                                            "composition": comp}
                T.mark("field variant " + v)
            set_variant("base")
    if musket is not None:
        musket.scale = (1.0, 1.0, 1.0)
    REP["reduced"] = None
    REP["camera"] = {"type": "orthographic", "elevation_deg": P["elevation"],
                     "ortho_m": framing["stand"]["orthoM"],
                     "ortho_rule": "one scale per clip, one centre per direction: tiers.<tier>.clips.<clip> "
                                   "(orthoM, pxPerMetre, anchors[d]); every frame record also carries its "
                                   "own ax, ay, ppm. ortho_m here is the stand clip's",
                     "directions": N,
                     "direction_rule": "d faces d*360/N deg CCW (from above) from toward-camera; d=N/4 faces screen-right"}
    REP["clips"] = clips
    REP["heads_info"] = HEADS_INFO
    REP["wall_seconds"] = round(time.time() - t_start, 1)
    REP["timing"] = T.marks
    C.write_report("render" if kind == "all" else "render-" + P["shard"], REP)


main()
