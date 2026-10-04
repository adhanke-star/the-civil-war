# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 4 of the bake: render the posed soldier (work/posed.blend) into sprite frames.
#
# Camera: orthographic, fixed, looking "north" (+Y) and down at --elevation degrees (default 35,
# the game's oblique view). The FIGURE turns through --directions yaw steps instead, so the
# lights stay fixed relative to the screen: ONE standard key light (the sun) that reads as
# upper-left on screen, high and slightly toward the viewer so fronts are lit. Two fills ride
# with it and never cast a ground shadow: a cool rim from behind-right and a green ground
# bounce from below (both light-linked to the soldier only). A transparent shadow-catcher
# ground keeps the soft contact shadow in the alpha channel. Cycles CPU + OpenImageDenoise.
#
# Framing (second pass): each clip gets its own orthographic scale and centre, fitted to the
# union over all frames and all N directions of the posed figure AND its cast shadow, plus a
# margin. So every frame of a clip shares one scale and one feet anchor, and the figure fills
# the frame instead of under half of it. render.json records orthoM / pxPerMetre / anchor per
# clip and tier; the game scales each clip by (its px per metre) / (that clip's pxPerMetre).
#
# Direction d: the figure faces d * 360/N degrees counter-clockwise (seen from above) from
# "toward the camera". d=0 faces the viewer, d=N/4 faces screen-right, d=N/2 faces away.
#
# Direction plan (this leg, to stay inside a 30-minute job): close tier renders `stand` in all
# N directions and the other clips in every second direction (every fourth if over budget);
# the field tier renders everything in all N directions. --quick renders a small check set.
#
# Outputs (under --out):
#   frames/<tier>/<clip>_<i>_d<dd>.png    tier = close (256 px) | field (96 px)
#   variants/<name>.png                   slouch hat, fixed bayonet, ... (close tier, stand, d=2)
#   hero.png                              1024 px three-quarter front, perspective, fitted
#   hero-closeup.png                      1024 px head-to-waist crop, same pose and light
#   report/render.json                    camera, lights, per-clip framing, seconds per frame
#
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/render.py -- \
#         --out .out/bake --samples-close 48 --samples-field 24 --samples-hero 128 \
#         --directions 16 --elevation 35 --budget-min 18 [--quick 1]

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
    "samples_closeup": C.arg("samples-closeup", 96),
    # the ONE standard light: warm key sun, upper-left on screen, slightly toward the viewer
    "sun_az": C.arg("sun-az", 200.0),             # deg, ground plane, from screen-right CCW
    "sun_el": C.arg("sun-el", 64.0),              # high sun: shadow ~0.5x figure height
    "sun_strength": C.arg("sun-strength", 4.2),
    "sun_soft_deg": C.arg("sun-soft", 3.0),
    "sun_rgb": (1.0, 0.90, 0.78),                 # warm key
    "sky_strength": C.arg("sky-strength", 0.45),
    "sky_hex": "#a9bdd6",                         # cool sky fill (world)
    # fills: never cast a ground shadow (light-linked to the soldier)
    "rim_az": C.arg("rim-az", 55.0),              # behind-right of the figure, from screen-right CCW
    "rim_el": C.arg("rim-el", 28.0),
    "rim_strength": C.arg("rim-strength", 2.4),
    "rim_rgb": (0.68, 0.80, 1.0),                 # cool rim
    "bounce_w": C.arg("bounce-w", 7.0),           # ground-bounce area light power
    "bounce_rgb": (0.42, 0.55, 0.20),             # green field bounce
    "ground_hex": "#5d6b32",                      # shadow-catcher albedo (indirect bounce only)
    "budget_min": C.arg("budget-min", 18.0),      # render budget for the whole stage
    "hero_dir": C.arg("hero-dir", 2),
    "hero_lens": 70.0,
    "hero_el": 10.0,
    "closeup_lens": 105.0,
    "closeup_el": 6.0,
    "skip_field": C.arg("skip-field", False),
    "quick": C.arg("quick", False),
}
T = C.Timer()
REP = {"params": P, "tiers": {}, "variants": {}, "hero": {}, "framing": {}}

# Variants: which tagged parts are visible. An object tagged tcw_variant=<feature> renders only
# when that feature is in the variant's set. "face2" also swaps the skin material (see F).
VARIANTS = {
    "base":    {"cap", "roll", "face1"},
    "slouch":  {"slouch", "roll", "face1"},
    "bayonet": {"cap", "roll", "face1", "bayonet"},
    "noroll":  {"cap", "face1"},
    "face2":   {"cap", "roll", "face2"},
}


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
    sc.cycles.transparent_max_bounces = 8
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
        vs.view_transform = "AgX"
        for cand in ("AgX - Medium High Contrast", "Medium High Contrast"):
            try:
                vs.look = cand
                break
            except Exception:  # noqa: BLE001
                continue
    except Exception as e:  # noqa: BLE001
        C.log("colour management:", e)
    REP["colour"] = {"view": vs.view_transform, "look": vs.look}
    # world: a soft cool sky fill so shadow sides are not black
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*C.hex_rgb(P["sky_hex"]), 1.0)
    bg.inputs["Strength"].default_value = P["sky_strength"]

    # the soldier collection, for light linking (fills light only the soldier)
    lit = bpy.data.collections.new("tcw_lit")
    sc.collection.children.link(lit)
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name not in lit.objects:
            lit.objects.link(o)
    lit.hide_viewport = False

    # key sun (the one standard light; casts the only ground shadow)
    sun_d = bpy.data.lights.new("tcw_sun", "SUN")
    sun_d.energy = P["sun_strength"]
    sun_d.color = P["sun_rgb"]
    sun_d.angle = math.radians(P["sun_soft_deg"])
    sun = bpy.data.objects.new("tcw_sun", sun_d)
    C.link(sun)
    to_sun = dir_vec(P["sun_az"], P["sun_el"])
    sun.rotation_mode = "QUATERNION"
    sun.rotation_quaternion = (-to_sun).to_track_quat("-Z", "Y")

    linked = {}

    def link_only_soldier(obj, label):
        try:
            obj.light_linking.receiver_collection = lit
            linked[label] = "light-linked to soldier"
        except Exception as e:  # noqa: BLE001
            try:
                obj.data.use_shadow = False
            except Exception:  # noqa: BLE001
                pass
            linked[label] = "no light linking (%s); shadows off" % e

    # cool rim from behind-right
    rim_d = bpy.data.lights.new("tcw_rim", "SUN")
    rim_d.energy = P["rim_strength"]
    rim_d.color = P["rim_rgb"]
    rim_d.angle = math.radians(8.0)
    rim = bpy.data.objects.new("tcw_rim", rim_d)
    C.link(rim)
    to_rim = dir_vec(P["rim_az"], P["rim_el"])
    rim.rotation_mode = "QUATERNION"
    rim.rotation_quaternion = (-to_rim).to_track_quat("-Z", "Y")
    link_only_soldier(rim, "rim")

    # green ground bounce: a large area light lying on the ground, facing up
    b_d = bpy.data.lights.new("tcw_bounce", "AREA")
    b_d.shape = "SQUARE"
    b_d.size = 4.0
    b_d.energy = P["bounce_w"]
    b_d.color = P["bounce_rgb"]
    bounce = bpy.data.objects.new("tcw_bounce", b_d)
    C.link(bounce)
    bounce.location = (0, 0, 0.01)
    bounce.rotation_euler = (math.pi, 0, 0)   # area lights emit along local -Z; flip to face up
    link_only_soldier(bounce, "bounce")
    for lo in (bounce, rim):
        try:
            lo.visible_camera = False
        except Exception:  # noqa: BLE001
            pass

    # screen-space reading of the key: x right, y up on screen
    e, view, up_s = e_vectors()
    REP["sun"] = {"to_sun_world": [round(x, 4) for x in to_sun],
                  "to_sun_screen": [round(to_sun.x, 4), round(to_sun.dot(up_s), 4)],
                  "azimuth_deg": P["sun_az"], "elevation_deg": P["sun_el"],
                  "shadow_length_per_metre_height": round(1.0 / math.tan(math.radians(P["sun_el"])), 3),
                  "colour": P["sun_rgb"],
                  "note": "world: x = screen right, y = away from viewer, z = up. The key sun is the "
                          "only light that casts a ground shadow."}
    REP["lights"] = {
        "key": {"type": "sun", "to_light_world": [round(x, 4) for x in to_sun], "strength": P["sun_strength"],
                "colour": P["sun_rgb"], "soft_deg": P["sun_soft_deg"]},
        "rim": {"type": "sun", "to_light_world": [round(x, 4) for x in to_rim], "strength": P["rim_strength"],
                "colour": P["rim_rgb"], "linking": linked.get("rim")},
        "bounce": {"type": "area 4 m square on the ground, facing up", "watts": P["bounce_w"],
                   "colour": P["bounce_rgb"], "linking": linked.get("bounce")},
        "sky": {"hex": P["sky_hex"], "strength": P["sky_strength"]},
    }
    # transparent ground that only keeps shadows; its albedo tints any indirect bounce green
    bpy.ops.mesh.primitive_plane_add(size=16.0, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "tcw_shadow_catcher"
    g.is_shadow_catcher = True
    gm = C.material("tcw_ground", P["ground_hex"], roughness=1.0)
    C.assign(g, gm)
    if g.name in lit.objects:
        lit.objects.unlink(g)
    return sc, to_sun


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


def frame_ortho(cam, fr):
    _e, view, up_s = e_vectors()
    cam.data.ortho_scale = fr["orthoM"]
    centre = Vector((fr["centre"][0], 0, 0)) + up_s * fr["centre"][1]
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
    # base yaw: the rig's forward axis -> toward the camera (-Y)
    rep = C.read_report("poses")
    F = Vector(rep.get("frame_basis", {}).get("F", (0, -1, 0)))
    base = math.atan2(-1.0, 0.0) - math.atan2(F.y, F.x)
    REP["base_yaw_deg"] = round(math.degrees(base), 2)
    return tt, base


def set_variant(name):
    feats = VARIANTS[name]
    for o in bpy.data.objects:
        v = o.get("tcw_variant")
        if v is not None:
            o.hide_render = v not in feats
    body = bpy.data.objects.get(bpy.context.scene.get("tcw_body", ""))
    if body is not None and body.get("tcw_skin_face2") and body.get("tcw_skin_face1"):
        want = body["tcw_skin_face2"] if "face2" in feats else body["tcw_skin_face1"]
        mat = bpy.data.materials.get(want)
        if mat is not None and body.material_slots and body.material_slots[0].material != mat:
            body.material_slots[0].material = mat


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


def clip_framing(sc, tt, base, frames, to_sun, N):
    """One ortho scale + centre for the clip: union over its frames and all N directions of the
    figure and its ground shadow, projected to the screen."""
    e, _view, _up = e_vectors()
    se, ce = math.sin(e), math.cos(e)
    ts = np.array(to_sun[:])
    tt.rotation_euler = (0, 0, base)
    pts = []
    for f in frames:
        sc.frame_set(f)
        pts.append(figure_points())
    P0 = np.concatenate(pts)
    zpos = np.clip(P0[:, 2], 0.0, None)
    lo = np.array([1e9, 1e9])
    hi = -lo
    for d in range(N):
        a = 2 * math.pi * d / N
        ca, sa = math.cos(a), math.sin(a)
        x = P0[:, 0] * ca - P0[:, 1] * sa
        y = P0[:, 0] * sa + P0[:, 1] * ca
        z = P0[:, 2]
        sx = np.concatenate([x, x - ts[0] * zpos / ts[2]])
        sy = np.concatenate([y * se + z * ce, (y - ts[1] * zpos / ts[2]) * se])
        lo = np.minimum(lo, [sx.min(), sy.min()])
        hi = np.maximum(hi, [sx.max(), sy.max()])
    w, h = float(hi[0] - lo[0]), float(hi[1] - lo[1])
    ortho = max(w, h) * (1.0 + P["margin"]) + P["pad_m"]
    centre = [float(lo[0] + hi[0]) / 2, float(lo[1] + hi[1]) / 2]
    return {"orthoM": round(ortho, 4), "centre": [round(c, 4) for c in centre],
            "box_m": [round(w, 3), round(h, 3)]}


def tier_framing(fr, px):
    o = fr["orthoM"]
    cx, cy = fr["centre"]
    return {"orthoM": o, "pxPerMetre": round(px / o, 4),
            "anchor": [round(px / 2.0 - cx / o * px, 3), round(px / 2.0 + cy / o * px, 3)]}


def render_to(sc, path):
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t


def main():
    t_start = time.time()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(C.WORK, "posed.blend"))
    T.mark("open posed.blend")
    clips = C.read_report("poses")["clips"]
    sc, to_sun = setup_scene()
    cam = ortho_camera()
    rig = C.find_rig()
    tt, base = turntable(rig)
    set_variant("base")
    N = P["directions"]
    hd = P["hero_dir"]

    # ---- per-clip framing (base variant; variants share the stand framing)
    framing = {}
    for clip, c in clips.items():
        framing[clip] = clip_framing(sc, tt, base, c["frames"], to_sun, N)
        C.log("framing", clip, framing[clip])
    REP["framing"] = framing
    T.mark("framing")

    # ---- hero and close-up first: the images a person judges
    lm = C.read_report("uniform").get("landmark_heights", {})
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
    T.mark("hero")
    sc.camera = closeup
    sc.cycles.samples = P["samples_closeup"]
    REP["closeup"].update({"px": P["hero_px"], "samples": P["samples_closeup"], "direction": hd,
                           "seconds": round(render_to(sc, os.path.join(C.OUT, "hero-closeup.png")), 2)})
    T.mark("closeup")

    # ---- variants at the close tier, standing, hero direction, each with its own stand framing
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = P["close_px"]
    sc.cycles.samples = P["samples_close"]
    os.makedirs(os.path.join(C.OUT, "variants"), exist_ok=True)
    REP["variants_framing"] = {}
    for v in [k for k in VARIANTS if k != "base"]:
        set_variant(v)
        vf = clip_framing(sc, tt, base, clips["stand"]["frames"], to_sun, N)
        REP["variants_framing"][v] = tier_framing(vf, P["close_px"])
        frame_ortho(cam, vf)
        tt.rotation_euler = (0, 0, base + 2 * math.pi * hd / N)
        sc.frame_set(clips["stand"]["frames"][0])
        REP["variants"][v] = round(render_to(sc, os.path.join(C.OUT, "variants", v + ".png")), 2)
    set_variant("base")
    T.mark("variants")

    # ---- direction plan per tier and clip
    all_d = list(range(N))
    if P["quick"]:
        plan = {"close": {c: ([0, hd, N // 4, N // 2, 3 * N // 4] if c == "stand" else [hd]) for c in clips},
                "field": {c: [hd] for c in clips if c in ("stand", "walk")}}
    else:
        plan = {"close": {c: (all_d if c == "stand" else list(range(0, N, 2))) for c in clips},
                "field": {c: all_d for c in clips}}
    if P["skip_field"]:
        plan.pop("field")
    budget_s = P["budget_min"] * 60.0
    reduced = None
    tiers = [("close", P["close_px"], P["samples_close"]), ("field", P["field_px"], P["samples_field"])]
    for tier, px, spp in tiers:
        if tier not in plan:
            continue
        sc.render.resolution_x = sc.render.resolution_y = px
        sc.cycles.samples = spp
        out = os.path.join(C.OUT, "frames", tier)
        os.makedirs(out, exist_ok=True)
        times = []
        done = {}
        order = ["stand"] + [c for c in clips if c != "stand"]
        for clip in order:
            dirs = plan[tier].get(clip, [])
            if tier == "close" and clip != "stand" and times and not P["quick"]:
                # budget check after the stand clip: per-frame time is now measured
                per = statistics.median(times)
                n_close_left = sum(len(clips[c]["frames"]) for c in clips if c != "stand") * len(dirs)
                n_field = sum(len(clips[c]["frames"]) for c in clips) * N
                est = (time.time() - t_start) + per * n_close_left + per * 0.2 * n_field
                C.log("budget: %.2fs/frame close; estimated stage total %.0fs (budget %.0fs)" % (per, est, budget_s))
                if est > budget_s and reduced is None:
                    plan["close"] = {c: (v if c == "stand" else list(range(0, N, 4))) for c, v in plan["close"].items()}
                    dirs = plan["close"][clip]
                    reduced = {"reason": "estimated %.0fs > budget %.0fs" % (est, budget_s),
                               "close_directions_non_stand": dirs}
                    C.log("REDUCING close-tier directions for non-stand clips to", dirs)
            if not dirs:
                continue
            frame_ortho(cam, framing[clip])
            for d in dirs:
                tt.rotation_euler = (0, 0, base + 2 * math.pi * d / N)
                for i, f in enumerate(clips[clip]["frames"]):
                    sc.frame_set(f)
                    times.append(render_to(sc, os.path.join(out, "%s_%d_d%02d.png" % (clip, i, d))))
            done[clip] = dirs
        REP["tiers"][tier] = {
            "px": px, "samples": spp, "renders": len(times),
            "directions": sorted(set(d for v in done.values() for d in v)),
            "directions_by_clip": done,
            "seconds_total": round(sum(times), 2),
            "seconds_per_frame_mean": round(statistics.mean(times), 3) if times else None,
            "seconds_per_frame_median": round(statistics.median(times), 3) if times else None,
            "seconds_first_frame": round(times[0], 3) if times else None,
            "clips": {c: tier_framing(framing[c], px) for c in clips},
            # tier-level fields kept for older readers: they are the STAND clip's values
            "px_per_m": tier_framing(framing["stand"], px)["pxPerMetre"],
            "anchor_px": tier_framing(framing["stand"], px)["anchor"],
        }
        T.mark("tier " + tier)
    REP["reduced"] = reduced
    REP["quick"] = bool(P["quick"])
    REP["camera"] = {"type": "orthographic", "elevation_deg": P["elevation"],
                     "ortho_m": framing["stand"]["orthoM"],
                     "ortho_rule": "per clip: tiers.<tier>.clips.<clip> (orthoM, pxPerMetre, anchor); "
                                   "ortho_m here is the stand clip's",
                     "directions": N,
                     "direction_rule": "d faces d*360/N deg CCW (from above) from toward-camera; d=N/4 faces screen-right"}
    REP["clips"] = clips
    REP["timing"] = T.marks
    C.write_report("render", REP)


main()
