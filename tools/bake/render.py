# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 4 of the bake: render the posed soldier (work/posed.blend) into sprite frames.
#
# Camera: orthographic, fixed, looking "north" (+Y) and down at --elevation degrees (default 35,
# the game's oblique view). The FIGURE turns through --directions yaw steps instead, so the sun
# stays fixed relative to the screen: one "standard light" that reads as upper-left on screen,
# high and slightly toward the viewer so fronts are lit. A transparent shadow-catcher ground
# keeps the soft contact shadow in the alpha channel. Cycles CPU + OpenImageDenoise.
#
# Direction d: the figure faces d * 360/N degrees counter-clockwise (seen from above) from
# "toward the camera". d=0 faces the viewer, d=N/4 faces screen-right, d=N/2 faces away.
#
# Outputs (under --out):
#   frames/<tier>/<clip>_<i>_d<dd>.png    tier = close (256 px) | field (96 px)
#   variants/<name>.png                   slouch hat, fixed bayonet (close tier, stand, d=2)
#   hero.png                              1024 px three-quarter front, perspective
#   report/render.json                    camera, sun, px/m, anchor, seconds per frame
#
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/render.py -- \
#         --out .out/bake --samples-close 48 --samples-field 24 --samples-hero 128 \
#         --directions 16 --elevation 35 --budget-min 16

import json
import math
import os
import statistics
import sys
import time

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

P = {
    "elevation": C.arg("elevation", 35.0),        # camera degrees above horizontal
    "directions": C.arg("directions", 16),
    "ortho_m": C.arg("ortho-m", 3.0),             # frame width in metres (square frames)
    "anchor_v": C.arg("anchor-v", 0.78),          # feet anchor, fraction from the TOP of the frame
    "close_px": C.arg("close-px", 256),
    "field_px": C.arg("field-px", 96),
    "hero_px": C.arg("hero-px", 1024),
    "samples_close": C.arg("samples-close", 48),
    "samples_field": C.arg("samples-field", 24),
    "samples_hero": C.arg("samples-hero", 128),
    "sun_az": C.arg("sun-az", 195.0),             # deg, ground plane, from screen-right CCW
    "sun_el": C.arg("sun-el", 55.0),
    "sun_strength": C.arg("sun-strength", 4.0),
    "sun_soft_deg": C.arg("sun-soft", 4.0),
    "sky_strength": C.arg("sky-strength", 0.55),
    "budget_min": C.arg("budget-min", 16.0),      # matrix render budget; directions halve if over
    "hero_dir": C.arg("hero-dir", 2),
    "skip_field": C.arg("skip-field", False),
}
T = C.Timer()
REP = {"params": P, "tiers": {}, "variants": {}, "hero": {}}


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
    # world: a soft sky fill so shadow sides are not black
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*C.hex_rgb("#9db4cf"), 1.0)
    bg.inputs["Strength"].default_value = P["sky_strength"]
    # sun
    sun_d = bpy.data.lights.new("tcw_sun", "SUN")
    sun_d.energy = P["sun_strength"]
    sun_d.angle = math.radians(P["sun_soft_deg"])
    sun = bpy.data.objects.new("tcw_sun", sun_d)
    C.link(sun)
    az, el = math.radians(P["sun_az"]), math.radians(P["sun_el"])
    to_sun = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    sun.rotation_mode = "QUATERNION"
    sun.rotation_quaternion = (-to_sun).to_track_quat("-Z", "Y")
    # screen-space reading of the sun: x right, y up on screen
    e = math.radians(P["elevation"])
    up_s = Vector((0, math.sin(e), math.cos(e)))
    REP["sun"] = {"to_sun_world": [round(x, 4) for x in to_sun],
                  "to_sun_screen": [round(to_sun.x, 4), round(to_sun.dot(up_s), 4)],
                  "note": "world: x = screen right, y = away from viewer, z = up"}
    # transparent ground that only keeps shadows
    bpy.ops.mesh.primitive_plane_add(size=16.0, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "tcw_shadow_catcher"
    g.is_shadow_catcher = True
    return sc, to_sun


def ortho_camera(sc):
    cd = bpy.data.cameras.new("tcw_ortho")
    cd.type = "ORTHO"
    cd.ortho_scale = P["ortho_m"]
    cd.clip_start, cd.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new("tcw_ortho", cd)
    C.link(cam)
    e = math.radians(P["elevation"])
    view = Vector((0, math.cos(e), -math.sin(e)))
    up_s = Vector((0, math.sin(e), math.cos(e)))
    centre = up_s * ((P["anchor_v"] - 0.5) * P["ortho_m"])
    cam.location = centre - view * 30.0
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = view.to_track_quat("-Z", "Y")
    return cam


def hero_camera(sc):
    cd = bpy.data.cameras.new("tcw_hero")
    cd.lens = 70.0
    cd.clip_start, cd.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new("tcw_hero", cd)
    C.link(cam)
    e = math.radians(12.0)
    view = Vector((0, math.cos(e), -math.sin(e)))
    target = Vector((0, 0, 1.0))
    cam.location = target - view * 5.6
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = view.to_track_quat("-Z", "Y")
    return cam


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
    for o in bpy.data.objects:
        v = o.get("tcw_variant")
        if v is None:
            continue
        if v == "cap":
            o.hide_render = name in ("slouch",)
        elif v == "slouch":
            o.hide_render = name != "slouch"
        elif v == "bayonet":
            o.hide_render = name != "bayonet"


def render_to(sc, path):
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(C.WORK, "posed.blend"))
    T.mark("open posed.blend")
    clips = C.read_report("poses")["clips"]
    sc, to_sun = setup_scene()
    cam = ortho_camera(sc)
    hero = hero_camera(sc)
    rig = C.find_rig()
    tt, base = turntable(rig)
    set_variant("base")
    sc.camera = cam
    N = P["directions"]
    dirs = list(range(N))
    frames = [(clip, i, f) for clip, c in clips.items() for i, f in enumerate(c["frames"])]
    budget_s = P["budget_min"] * 60.0
    tiers = [("close", P["close_px"], P["samples_close"])]
    if not P["skip_field"]:
        tiers.append(("field", P["field_px"], P["samples_field"]))
    reduced = None
    for tier, px, spp in tiers:
        sc.render.resolution_x = sc.render.resolution_y = px
        sc.cycles.samples = spp
        out = os.path.join(C.OUT, "frames", tier)
        os.makedirs(out, exist_ok=True)
        times = []
        done_dirs = []
        k = 0
        while k < len(dirs):
            d = dirs[k]
            tt.rotation_euler = (0, 0, base + 2 * math.pi * d / N)
            for clip, i, f in frames:
                sc.frame_set(f)
                times.append(render_to(sc, os.path.join(out, "%s_%d_d%02d.png" % (clip, i, d))))
            done_dirs.append(d)
            if tier == "close" and k == 0:
                per = statistics.mean(times[1:]) if len(times) > 1 else times[0]
                est_close = per * len(frames) * N
                est_field = 0.0 if P["skip_field"] else est_close * 0.45  # rough: per-frame overhead dominates
                C.log("first direction: %.2fs/frame; estimated close %.0fs + field %.0fs (budget %.0fs)" % (
                    per, est_close, est_field, budget_s))
                if est_close + est_field > budget_s and reduced is None:
                    keep = max(4, N // 2 if (est_close + est_field) / 2 < budget_s else N // 4)
                    dirs = list(range(0, N, max(1, N // keep)))
                    reduced = {"reason": "estimated %.0fs > budget %.0fs" % (est_close + est_field, budget_s),
                               "directions_rendered": dirs, "estimated_full_seconds": round(est_close + est_field)}
                    C.log("REDUCING directions to", dirs)
            k += 1
        REP["tiers"][tier] = {
            "px": px, "samples": spp, "renders": len(times), "directions": done_dirs,
            "seconds_total": round(sum(times), 2),
            "seconds_per_frame_mean": round(statistics.mean(times), 3),
            "seconds_per_frame_median": round(statistics.median(times), 3),
            "seconds_first_frame": round(times[0], 3),
            "px_per_m": round(px / P["ortho_m"], 4),
            "anchor_px": [px / 2.0, round(P["anchor_v"] * px, 3)],
        }
        T.mark("tier " + tier)
    REP["reduced"] = reduced

    # variants at the close tier, standing, three-quarter direction
    sc.render.resolution_x = sc.render.resolution_y = P["close_px"]
    sc.cycles.samples = P["samples_close"]
    vdir = P["hero_dir"]
    tt.rotation_euler = (0, 0, base + 2 * math.pi * vdir / N)
    sc.frame_set(clips["stand"]["frames"][0])
    os.makedirs(os.path.join(C.OUT, "variants"), exist_ok=True)
    for v in ("slouch", "bayonet"):
        set_variant(v)
        REP["variants"][v] = round(render_to(sc, os.path.join(C.OUT, "variants", v + ".png")), 2)
    set_variant("base")
    T.mark("variants")

    # hero: perspective, lower and closer, same sun
    sc.camera = hero
    sc.render.resolution_x = sc.render.resolution_y = P["hero_px"]
    sc.cycles.samples = P["samples_hero"]
    REP["hero"] = {"px": P["hero_px"], "samples": P["samples_hero"], "direction": vdir,
                   "seconds": round(render_to(sc, os.path.join(C.OUT, "hero.png")), 2)}
    T.mark("hero")

    REP["camera"] = {"type": "orthographic", "elevation_deg": P["elevation"], "ortho_m": P["ortho_m"],
                     "anchor_from_top": P["anchor_v"], "directions": N,
                     "direction_rule": "d faces d*360/N deg CCW (from above) from toward-camera; d=N/4 faces screen-right"}
    REP["clips"] = clips
    REP["timing"] = T.marks
    C.write_report("render", REP)


main()
