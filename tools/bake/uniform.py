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
    # (run 3 showed the first values, 2.5-7.5 mm, barely read even in the close-up: doubled)
    "fold_elbow":          0.0160,
    "fold_wrist":          0.0100,
    "fold_upperarm":       0.0060,
    "fold_knee":           0.0150,
    "fold_hem":            0.0130,
    "fold_drape":          0.0090,
    "fold_seat":           0.0080,
    "fold_pleat":          0.0120,  # radiating from the waist belt
    "fold_drag":           0.0090,  # diagonal drag folds on the back
    "fold_lumps":          0.0050,  # low-frequency unevenness everywhere
    "fold_skirt":          0.0120,
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
    "box_plate":           (0.080, 0.050),       # oval brass plate on the box flap; plain, no lettering  placeholder
    "haversack":           (0.30, 0.28, 0.05),   #                              placeholder
    "canteen_d":           0.19,    # smoothside canteen diameter              placeholder
    "canteen_t":           0.065,   # canteen thickness                        placeholder
    "scabbard":            (0.045, 0.52, 0.02),  # bayonet scabbard w l t       placeholder
    "blanket_roll_r":      0.038,   # radius of the horseshoe roll             placeholder
    # -- headgear -------------------------------------------------------------
    "cap_band_h":          0.042,   # forage cap band                          placeholder
    "cap_crown_back":      0.095,   # crown rise above band at the back        placeholder
    "cap_crown_front":     0.045,   # crown rise above band at the front       placeholder
    "cap_crown_forward":   0.062,   # how far the floppy crown slumps forward  placeholder
    "cap_visor":           0.050,   # visor depth                              placeholder
    # third pass: the cap is tipped back a little and seated higher so light reaches the eyes
    # (pass 2: tilt 7, seat -0.006, visor dip 28 put the eyes in black shadow)
    "cap_tilt_deg":        1.5,     # band plane tipped forward (lower at the brow) placeholder
    "cap_seat":            0.004,   # band bottom relative to the brow line    placeholder
    "cap_top_sag":         0.007,   # the crown top sags in the middle         placeholder
    "cap_visor_dip_deg":   18.0,    # visor angled down from the band plane    placeholder
    "cap_pad":             0.010,   # band clearance over the head (all head presets fit) placeholder
    # -- face (third pass) ------------------------------------------------------------------
    "iris_deg":            27.0,    # iris angular radius seen from the eyeball centre (~11.5 mm iris) placeholder
    "pupil_deg":           8.5,     # pupil angular radius (~3.5 mm, daylight)  placeholder
    "sclera_hex":          "#d6cabb",  # eye white: warm, never pure white      placeholder
    "sideburn_fwd":        (-0.078, -0.050),  # sideburn band in front of the ear, metres from the eyes placeholder
    "sideburn_dz":         (-0.060, 0.030),   # from below the ear top to under the cap band            placeholder
    # -- cartridge (paper, ball and powder) ---------------------------------------------------
    "cartridge_len":       0.068,   # paper cartridge length                   placeholder estimate
    "cartridge_r":         0.0075,  # paper cartridge radius                   placeholder estimate
    # -- blanket roll (third pass) -------------------------------------------------------------
    "roll_turns":          3.5,     # spiral turns visible at the roll ends    placeholder
    "roll_tie_squeeze":    0.20,    # radius lost under a tie                  placeholder
    "roll_tie_width":      0.014,   # half-width of the squeeze at a tie (m)   placeholder
    "roll_flatten":        0.22,    # flattening where it lies on the shoulder/hip placeholder
    "roll_sag":            0.010,   # mid-span sag away from the body (m)      placeholder
    "roll_stripe":         (0.055, 0.085),  # dark band near each roll end (fraction of length) placeholder estimate
    "roll_stripe_hex":     "#2f2a24",       # the band colour                  placeholder estimate
    # -- kit weight (third pass): haversack and canteen hang toward plumb from their straps ------
    "hang_plumb":          0.75,    # share of the body's tilt the bag swings back toward vertical placeholder
    "hang_swing_deg":      5.0,     # march swing amplitude                    placeholder
    "hang_lag":            0.15,    # swing lags the stride by this cycle fraction placeholder
    # -- brogans (ankle-high laced shoes) ------------------------------------------------
    "shoe_heel_ext":       0.008,   # shoe beyond the heel of the foot         placeholder
    "shoe_toe_ext":        0.014,   # shoe beyond the toes (round toe)         placeholder
    "shoe_heel_h":         0.024,   # stacked leather heel, ~1 in              placeholder
    "shoe_sole_t":         0.011,   # forefoot sole                            placeholder
    "shoe_toe_spring":     0.008,   # toe lifts off the ground                 placeholder
    "shoe_welt":           0.0045,  # sole edge beyond the upper               placeholder
    "shoe_lace_pairs":     4,       # lace holes up the instep                 placeholder
    "slouch_crown_h":      0.105,   # slouch hat crown                         placeholder
    "slouch_brim":         0.075,   # brim width                               placeholder
    "slouch_brim_field":   0.105,   # FIELD TIER ONLY: wider brim so the hat reads at 96 px (readability choice) placeholder
    # -- rifle-musket (Model 1861 pattern) -------------------------------------------
    "musket_length":       1.422,   # 56 in overall                            Inferred
    "barrel_length":       1.016,   # 40 in barrel                             Inferred
    "bayonet_blade":       0.457,   # 18 in triangular socket bayonet blade    Inferred
    "barrel_bands_z":      (0.62, 0.92, 1.18),  # band stations from the heel   placeholder
    "stock_tip_z":         1.22,    # forestock ends short of the muzzle       placeholder
}

COL = {
    # name          sRGB hex   roughness  note (all placeholder colours judged by eye)
    "coat":        ("#1a2550", 0.92),   # dark (indigo) blue wool flannel sack coat (more saturated, pass 2)
    "cap":         ("#18213f", 0.90),   # dark blue forage cap, a shade darker
    "trousers":    ("#7393c4", 0.92),   # sky-blue kersey (more saturated, pass 2)
    "leather":     ("#121110", 0.40),   # blackened leather belts and boxes
    "brogans":     ("#16120f", 0.55),   # black rough-out / blacked brogans
    "haversack":   ("#1e1d1a", 0.65),   # tarred black canvas
    "canteen":     ("#6c6355", 0.95),   # grey-brown wool canteen cover
    "webbing":     ("#7a705c", 0.90),   # natural cotton strap, darkened so it never out-shines the coat
    "blanket":     ("#5a5246", 0.95),   # mid grey-brown wool blanket (in game the first pass read white)
    "felt":        ("#151413", 0.85),   # black felt slouch hat
    "felt_field":  ("#5a5045", 0.90),   # FIELD TIER ONLY: lighter felt so the brim reads at 96 px (readability choice)
    "wood":        ("#4a2c18", 0.45),   # oiled black walnut stock
    "steel":       ("#8e9297", 0.32),   # bright (unblued) iron and steel
    "brass":       ("#b08a3e", 0.35),   # belt plates and buttons
    "sole":        ("#1e1712", 0.80),   # brogan soles and heels
    "lace":        ("#3a2a1c", 0.75),   # leather thong laces
    "pewter":      ("#8f8e88", 0.45),   # canteen spout
    "cork":        ("#8b6a45", 0.90),   # canteen stopper
    "bone":        ("#cfc5ab", 0.50),   # haversack button (material unsourced)
    "paper":       ("#d2c5a6", 0.85),   # cartridge paper (placeholder estimate)
}

# =====================================================================================
# HEAD PRESETS (third pass). probe_mpfb.py reads this literal (ast) to build the heads; uniform.py
# shades them; render.py picks one per variant. Every asset is CC0: skins, hair, eyebrows,
# eyelashes and eyes from the MakeHuman system assets pack; beards and the moustache from the
# MakeHuman "bodyparts05" pack (each asset listed CC0 on its page). Face shapes are MPFB2 bundled
# CC0 targets (weight 0..1); EXPR are MPFB2 bundled CC0 expression-unit targets
# (targets/expression/units/<race>/). Shapes, colours and expressions are placeholder estimates
# judged by eye; no real person is depicted. "use": "any" = any Union infantry regiment;
# "usct" = only for United States Colored Troops regiments (segregated units; never mix this head
# into a white regiment, and never use it for a unit before that regiment was raised).
# Facial-hair styles (full beard, chin beard, moustache, clean-shaven) are recalled as common in
# period photographs: Inferred, not cited.
# =====================================================================================
EXPR = {   # neutral, tired, alert: lids a little narrowed, brows a touch down, lips pressed
    "eye-left-slit": 0.20, "eye-right-slit": 0.26,
    "eyebrows-left-down": 0.14, "eyebrows-right-down": 0.10,
    "eyebrows-left-inner-up": 0.12, "eyebrows-right-inner-up": 0.14,
    "mouth-compression": 0.16, "mouth-depression": 0.08,
}
HEADS = {
    "h1": {"label": "young, clean-shaven, a few days' stubble", "race": "caucasian",
           "skin": "young_caucasian_male.mhmat", "hair": "short02.mhclo", "brows": "eyebrow001.mhclo",
           "lashes": "eyelashes01.mhclo", "beard": None,
           "targets": {"head-oval": 0.30, "chin-prominent-incr": 0.20, "nose-hump-incr": 0.20,
                       "l-cheek-bones-incr": 0.15, "r-cheek-bones-incr": 0.15},
           "expr_scale": 1.0, "hair_hex": "#3a2616", "beard_hex": "#3a2616", "stubble": 0.50,
           "sideburn": 0.55, "iris_hex": "#55707e", "use": "any"},
    "h2": {"label": "full beard, dark brown", "race": "caucasian",
           "skin": "middleage_caucasian_male.mhmat", "hair": "short04.mhclo", "brows": "eyebrow003.mhclo",
           "lashes": "eyelashes02.mhclo", "beard": "grinsegold_beard_sigmund_wip.mhclo",
           "targets": {"head-square": 0.35, "head-fat-incr": 0.12, "nose-width1-incr": 0.25,
                       "nose-point-down": 0.20, "chin-width-incr": 0.20},
           "expr_scale": 1.1, "hair_hex": "#2a1b11", "beard_hex": "#2e1d12", "stubble": 0.60,
           "sideburn": 0.80, "iris_hex": "#4a3322", "use": "any"},
    "h3": {"label": "chin beard (shaved upper lip), sandy", "race": "caucasian",
           "skin": "young_caucasian_male2.mhmat", "hair": "short01.mhclo", "brows": "eyebrow005.mhclo",
           "lashes": "eyelashes01.mhclo", "beard": "culturalibre_faun_beard.mhclo",
           "targets": {"head-rectangular": 0.40, "chin-height-incr": 0.20, "nose-scale-vert-incr": 0.25,
                       "l-cheek-volume-decr": 0.20, "r-cheek-volume-decr": 0.20},
           "expr_scale": 0.9, "hair_hex": "#6a4e2e", "beard_hex": "#5e4228", "stubble": 0.25,
           "sideburn": 0.40, "iris_hex": "#6a7a52", "use": "any"},
    "h4": {"label": "moustache, near-black hair", "race": "caucasian",
           "skin": "middleage_caucasian_male.mhmat", "hair": "short03.mhclo", "brows": "eyebrow007.mhclo",
           "lashes": "eyelashes02.mhclo", "beard": "rehmanpolanski_moustache_viking.mhclo",
           "targets": {"head-round": 0.30, "nose-hump-incr": 0.35, "mouth-scale-horiz-decr": 0.15,
                       "eyebrows-trans-down": 0.20},
           "expr_scale": 1.0, "hair_hex": "#1c1410", "beard_hex": "#1e1611", "stubble": 0.55,
           "sideburn": 0.65, "iris_hex": "#3d2a1a", "use": "any"},
    "h5": {"label": "older, grizzled short beard", "race": "caucasian",
           "skin": "old_caucasian_male.mhmat", "hair": "short04.mhclo", "brows": "eyebrow009.mhclo",
           "lashes": "eyelashes03.mhclo", "beard": "wdg_scruffy_beard.mhclo",
           "targets": {"head-age-incr": 0.50, "head-diamond": 0.25, "l-eye-bag-incr": 0.40,
                       "r-eye-bag-incr": 0.40, "nose-volume-incr": 0.20},
           "expr_scale": 1.2, "hair_hex": "#6c665d", "beard_hex": "#77716a", "stubble": 0.70,
           "sideburn": 0.70, "iris_hex": "#5d6a72", "use": "any"},
    "h6": {"label": "young, auburn, heavy stubble", "race": "caucasian",
           "skin": "young_caucasian_male.mhmat", "hair": "short01.mhclo", "brows": "eyebrow011.mhclo",
           "lashes": "eyelashes01.mhclo", "beard": None,
           "targets": {"head-invertedtriangular": 0.35, "chin-bones-incr": 0.25, "nose-greek-incr": 0.20,
                       "l-ear-flap-incr": 0.20, "r-ear-flap-incr": 0.20},
           "expr_scale": 0.8, "hair_hex": "#6b3520", "beard_hex": "#6b3520", "stubble": 0.85,
           "sideburn": 0.60, "iris_hex": "#4f6340", "use": "any"},
    "h7": {"label": "moustache (USCT regiments only)", "race": "african",
           "skin": "middleage_african_male.mhmat", "hair": "short02.mhclo", "brows": "eyebrow002.mhclo",
           "lashes": "eyelashes02.mhclo", "beard": "rehmanpolanski_moustache_viking.mhclo",
           "targets": {"head-oval": 0.25, "chin-prominent-incr": 0.15},
           "expr_scale": 1.0, "hair_hex": "#120e0b", "beard_hex": "#120e0b", "stubble": 0.45,
           "sideburn": 0.55, "iris_hex": "#2e2016", "use": "usct"},
}
HEAD_DEFAULT = "h1"

T = C.Timer()
REP = {"table": {k: v for k, v in D.items()}, "colours": COL, "objects": {}}


# Weathering colours (placeholder, judged by eye): faded indigo goes greyer and lighter; dust is
# a light tan; mud a dark brown.
FADE = {"coat": "#2e3a66", "cap": "#2c3658", "trousers": "#8ea6cc", "blanket": "#8a8272",
        "canteen": "#857c6c", "felt": "#3a3631", "webbing": "#958a72", "haversack": "#3a3832"}


def add_attr_tint(mat, attr, hex_colour, amount):
    """Mix the material's base colour toward hex_colour by a per-vertex float attribute."""
    nt = mat.node_tree
    bsdf = next((nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    sock = bsdf.inputs["Base Color"]
    base = sock.links[0].from_socket if sock.is_linked else tuple(sock.default_value)
    f = C.node_math(nt, "MULTIPLY", C.node_attr(nt, attr), amount, clamp=True)
    nt.links.new(C.node_mix(nt, "MIX", f, base, (*C.hex_rgb(hex_colour), 1.0)), sock)


def mats():
    m = {}
    for k, (hexc, rough) in COL.items():
        name = "tcw_" + k
        if k == "felt_field":
            m[k] = C.weathered_material(name, hexc, rough, kind="wool", fade_hex="#7a6e5e", fade=0.3,
                                        mottle=0.08, sheen=0.12, weave_scale=330.0, bump=0.35)
        elif k == "blanket":
            # third pass: heavier felted wool (fuzz sheen, deeper nap) and a dark band near each
            # end of the roll (the blanket's end stripes, placeholder estimate)
            m[k] = C.weathered_material(name, hexc, rough, kind="wool", fade_hex=FADE.get(k), fade=0.3,
                                        mottle=0.12, sheen=0.28, weave_scale=180.0, bump=0.6)
            add_attr_tint(m[k], "tcw_stripe", D["roll_stripe_hex"], 0.85)
        elif k in ("coat", "cap", "trousers", "canteen", "felt"):
            # sheen kept low: at 0.55 (run 4) it greyed the dark-blue coat to #353945 on screen
            m[k] = C.weathered_material(name, hexc, rough, kind="wool", fade_hex=FADE.get(k), fade=0.3,
                                        mottle=0.08, sheen=0.12, weave_scale=330.0, bump=0.35)
        elif k in ("webbing", "haversack"):
            m[k] = C.weathered_material(name, hexc, rough, kind="canvas", fade_hex=FADE.get(k), fade=0.4,
                                        mottle=0.10, weave_scale=420.0, bump=0.3)
        elif k in ("leather", "brogans", "sole", "lace"):
            m[k] = C.weathered_material(name, hexc, rough, kind="leather", mottle=0.12, bump=0.25,
                                        edge_wear_hex="#33291f")
        elif k == "wood":
            m[k] = C.weathered_material(name, hexc, rough, kind="wood", mottle=0.10, bump=0.15,
                                        edge_wear_hex="#6b4428")
        elif k in ("cork", "bone", "paper"):
            m[k] = C.weathered_material(name, hexc, rough, kind="plain", mottle=0.12, bump=0.2)
        else:  # steel, brass, pewter
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
                # a clean cuff: the shell's end follows the ragged bone-weight boundary, so every
                # vertex past the cuff line is pulled back onto one ring (run 8 still looked torn)
                cut = Ltot - 0.012
                if s > cut:
                    q = q - tdir * (s - cut)
                    s = cut
                    ru = ru - tdir * float(ru @ tdir)
                    ru = ru / max(1e-6, float(np.linalg.norm(ru)))
                R = D["sleeve_r_top"] + (D["sleeve_r_cuff"] - D["sleeve_r_top"]) * min(1.0, s / Ltot)
                w = C.smoothstep(0.04, 0.12, s)
                rn = rc + w * max(0.0, R - rc)
                # cuff: a smooth step out (run 7: a hard step plus folds at the edge left a ragged cuff)
                rn += 0.0025 * C.smoothstep(D["cuff_len"], D["cuff_len"] - 0.012, Ltot - s)
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
                d *= C.smoothstep(0.004, 0.025, ew)        # folds die out before the cuff edge
                if boundary[i]:
                    d = 0.0
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
                    cav[i] = max(0.0, -d / 0.012)
                else:
                    out[i] = p + N[i] * (D["fold_lumps"] * 0.6 * nz(p, 7))
                wear[i] = max(wear[i], 0.9 * C.smoothstep(self.sh_z - 0.14, self.sh_z + 0.01, z) * max(0.0, float(N[i][2])) ** 0.5)
            else:
                out[i] = p + N[i] * (D["fold_lumps"] * nz(p, 7))
            if cav[i] == 0.0 and d < 0:
                cav[i] = min(1.0, -d / 0.012)
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
            cav[i] = max(0.0, -d / 0.012)
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
    # lock plate: a flat plate with rounded ends on the right (-X) side of the stock
    lp = []
    for dx in (0.0, 0.0025):
        ring = []
        for k in range(16):
            a = 2 * math.pi * k / 16
            zz = 0.405 + 0.068 * math.copysign(abs(math.cos(a)) ** 0.5, math.cos(a))
            yy = -0.004 + 0.0125 * math.copysign(abs(math.sin(a)) ** 0.7, math.sin(a))
            ring.append(Vector((-0.0175 - dx, yy, zz)))
        lp.append(ring)
    parts.append(C.loft(lp))
    # hammer: body on the plate, a neck rising and curving forward, a nose over the nipple, a spur
    hp = [((-0.022, 0.004, 0.372), (0.0035, 0.008, 0.009)),   # tumbler body
          ((-0.022, 0.016, 0.368), (0.0030, 0.007, 0.006)),   # neck
          ((-0.022, 0.026, 0.374), (0.0030, 0.005, 0.007)),   # upper neck
          ((-0.020, 0.030, 0.386), (0.0035, 0.006, 0.008)),   # nose (cup over the nipple)
          ((-0.022, 0.033, 0.360), (0.0025, 0.004, 0.010))]   # spur, back and up
    for c, hh in hp:
        parts.append(C.box(Vector(c), (X, Y, Z), hh))
    # nipple bolster on the breech and the nipple cone
    parts.append(C.box(Vector((-0.016, 0.014, br0 + 0.012)), (X, Y, Z), (0.006, 0.007, 0.012)))
    parts.append(C.loft([C.ring(Vector((-0.016, 0.021 + dy, br0 + 0.014)), X, Z, rr, rr, 8)
                         for dy, rr in ((0.0, 0.003), (0.006, 0.0022), (0.008, 0.0015))]))
    # trigger guard: a bow under the wrist of the stock, with its tang strip; the trigger inside
    bow = []
    for k in range(13):
        a = math.pi * k / 12
        bow.append(Vector((0.0, -0.043 - 0.022 * math.sin(a), 0.315 + 0.034 * math.cos(a))))
    gv, gf = [], []
    for k in range(len(bow) - 1):
        tv_, tf_ = C.loft([C.ring(bow[k], X, (bow[k + 1] - bow[k]).normalized().cross(X), 0.003, 0.0018, 6),
                           C.ring(bow[k + 1], X, (bow[k + 1] - bow[k]).normalized().cross(X), 0.003, 0.0018, 6)],
                          cap_start=False, cap_end=False)
        gv.append((tv_, tf_))
    parts.append(C.merge(gv))
    parts.append(C.box(Vector((0.0, -0.044, 0.31)), (X, Y, Z), (0.0045, 0.0015, 0.085)))     # guard plate
    parts.append(C.box(Vector((0.0, -0.053, 0.327)), (X, Y, Z), (0.002, 0.010, 0.0025)))     # trigger
    # sling swivels: on the middle band and in front of the trigger guard
    for zc, yc in ((D["barrel_bands_z"][1], -0.032), (0.37, -0.058)):
        tv_, tf_ = torus(Vector((0.0, yc, zc)), X, 0.008, 0.0016, n=10, m=5)
        parts.append((tv_, tf_))
    # ramrod with a tulip head at the muzzle end: its own object so the load clip can draw it
    rv, rf = C.merge([C.loft([C.ring(Vector((0, -0.017, z)), X, Y, 0.0045, 0.0045, 6) for z in (0.55, L - 0.02)]),
                      C.loft([C.ring(Vector((0, -0.017, z)), X, Y, rr, rr, 8) for z, rr in
                              ((L - 0.03, 0.0045), (L - 0.018, 0.0062), (L - 0.006, 0.0058), (L - 0.004, 0.004))])])
    ramrod = C.mesh_object("tcw_ramrod", rv, rf)
    C.assign(ramrod, m["steel"])
    bpy.context.scene["tcw_musket"] = C.json.dumps({
        "prof": prof, "br0": br0, "L": L, "barrel_r": 0.0145, "barrel_y": 0.006,
        "ramrod_y": -0.017, "ramrod_bottom": 0.55, "ramrod_top": L - 0.004})
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
    ramrod.parent = stock
    ramrod.rotation_mode = "QUATERNION"
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
    """Laced ankle brogan, built parametrically in the foot's frame from the foot's own extents:
    a round-toed upper that rises to an ankle-high collar, a vamp seam, a leather sole with a
    welt edge and a low stacked heel, toe spring, and leather laces across the instep.
    Rigid on the foot bone (the toes are never posed)."""
    U = lm["U"]
    mid_x = lm["mid"].dot(lm["L"])
    pts = [rest_w[i] for i in shoe_idx if (rest_w[i].dot(lm["L"]) - mid_x) * sg > 0]
    cloud = np.array([p[:] for p in pts])
    fb = rm["side"][side]["foot"]
    bone = rig.data.bones[fb]
    ax = bone.tail_local - bone.head_local
    ax = Vector((ax.x, ax.y, 0)).normalized()
    lat = U.cross(ax).normalized()
    A, LA = np.array(ax[:]), np.array(lat[:])
    proj = cloud @ A
    latp = cloud @ LA
    lo, hi = float(proj.min()), float(proj.max())
    ank = lm["ank" + side]
    s_ank = (ank.dot(ax) - lo) / (hi - lo)
    S = 18
    xs, lmin, lmax, ztop = [], [], [], []
    for k in range(S):
        s = k / (S - 1)
        x = lo - D["shoe_heel_ext"] + (hi - lo + D["shoe_heel_ext"] + D["shoe_toe_ext"]) * s
        sel = np.abs(proj - min(max(x, lo + 0.01), hi - 0.01)) < 0.016
        if sel.sum() >= 3:
            lmin.append(float(latp[sel].min()))
            lmax.append(float(latp[sel].max()))
            ztop.append(float(cloud[sel, 2].max()))
        else:
            lmin.append(lmin[-1] if lmin else float(latp.mean()) - 0.03)
            lmax.append(lmax[-1] if lmax else float(latp.mean()) + 0.03)
            ztop.append(ztop[-1] if ztop else 0.05)
        xs.append(x)
    for arr in (lmin, lmax, ztop):
        for _ in range(2):
            arr[:] = [arr[0]] + [(arr[i - 1] + 2 * arr[i] + arr[i + 1]) / 4 for i in range(1, S - 1)] + [arr[-1]]

    def plan(s):   # plan-view rounding at toe and heel
        if s > 0.78:
            return math.sqrt(max(0.06, 1 - ((s - 0.78) / 0.22) ** 2))
        if s < 0.12:
            return math.sqrt(max(0.25, 1 - ((0.12 - s) / 0.12) ** 2))
        return 1.0

    def sole_top(s):
        return D["shoe_heel_h"] + (D["shoe_sole_t"] - D["shoe_heel_h"]) * C.smoothstep(0.26, 0.31, s)

    def spring(s):
        return D["shoe_toe_spring"] * C.smoothstep(0.80, 1.0, s) ** 1.5

    def top(s, k):
        collar = ank.z + D["shoe_top_above_ankle"]
        inst = ztop[k] + D["shoe_offset"]
        w = C.smoothstep(s_ank + 0.08, s_ank + 0.22, s)
        h = collar * (1 - w) + inst * w
        if s > 0.86:
            h = sole_top(s) + spring(s) + (h - sole_top(s) - spring(s)) * math.sqrt(max(0.15, 1 - ((s - 0.86) / 0.14) ** 2))
        return h

    up_rings, sole_rings, tops, cls = [], [], [], []
    seg = 22
    for k, s in enumerate([k / (S - 1) for k in range(S)]):
        cl = (lmin[k] + lmax[k]) / 2
        hw = ((lmax[k] - lmin[k]) / 2 + D["shoe_offset"]) * plan(s)
        seam = 1.0 + 0.012 * max(0.0, 1 - abs(s - 0.62) / 0.03)
        zs = sole_top(s) + spring(s)
        zt = top(s, k) * seam
        zc, hz = (zs + zt) / 2, (zt - zs) / 2
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            ca, sa = math.cos(a), math.sin(a)
            y = cl + hw * seam * math.copysign(abs(ca) ** 0.7, ca)
            z = zc + hz * math.copysign(abs(sa) ** (0.45 if sa < 0 else 0.8), sa)
            ring.append(ax * xs[k] + lat * y + U * z)
        up_rings.append(ring)
        sw = hw + D["shoe_welt"]
        zb = spring(s)
        sring = []
        for y, z in ((cl - sw, zb), (cl + sw, zb), (cl + sw, zs + 0.002), (cl - sw, zs + 0.002)):
            sring.append(ax * xs[k] + lat * y + U * z)
        sole_rings.append(sring)
        tops.append(zt)
        cls.append(cl)
    v, f = C.loft(up_rings)
    obj = C.mesh_object("tcw_brogan_" + side, v, f)
    C.assign(obj, m["brogans"])
    C.stamp_attrs(obj, dirt=0.18, wear=0.12)   # run 4: 0.4 dust turned the black brogans grey
    C.add_modifier(obj, "SUBSURF", "Smooth", levels=0, render_levels=2)
    C.parent_to_bone(obj, rig, fb)
    sv, sf = C.loft(sole_rings)
    sole = C.mesh_object("tcw_brogan_sole_" + side, sv, sf, smooth=False)
    C.add_modifier(sole, "BEVEL", "Bevel", width=0.002, segments=2, limit_method="ANGLE")
    C.assign(sole, m["sole"])
    C.stamp_attrs(sole, dirt=0.6, wear=0.5)
    C.parent_to_bone(sole, rig, fb)
    # laces: bars across the opening over the instep, and the two edges of the quarters
    parts = []
    n_l = D["shoe_lace_pairs"]
    for i in range(n_l):
        s = s_ank - 0.02 + (0.20 * i / max(1, n_l - 1))
        k = min(S - 1, max(0, int(round(s * (S - 1)))))
        p = ax * (lo + (hi - lo) * s) + lat * cls[k] + U * (tops[k] + 0.0022)
        parts.append(C.box(p, (lat, ax, U), (0.012, 0.0016, 0.0016)))
        for e in (-1, 1):
            parts.append(C.box(p + lat * (e * 0.0125) - U * 0.0008, (lat, ax, U), (0.0022, 0.0022, 0.0022)))
    v, f = C.merge(parts)
    laces = C.mesh_object("tcw_brogan_laces_" + side, v, f, smooth=False)
    C.assign(laces, m["lace"])
    C.parent_to_bone(laces, rig, fb)
    REP["objects"][obj.name] = {"verts": len(up_rings) * seg, "s_ankle": round(s_ank, 3)}
    return obj


def build_cap(m, rig, rm, lm, head_cloud, brow_z):
    """Forage cap seated on the head: the band sits on a plane tipped forward (lower at the
    brow), the soft crown rises higher at the back and slumps forward over the visor with a
    sagging top, a crease where crown meets band, a leather visor angled down, and a leather
    chin strap above the visor held by two small side buttons."""
    F, U, Lv = lm["F"], lm["U"], lm["L"]
    tilt = math.radians(D["cap_tilt_deg"])
    n = (U * math.cos(tilt) + F * math.sin(tilt)).normalized()
    hc = np.array(head_cloud)
    sel = hc[np.abs(hc[:, 2] - brow_z) < 0.015]
    c0 = Vector(sel.mean(axis=0).tolist()) if len(sel) else lm["headb"].copy()
    c0.z = brow_z + D["cap_seat"]
    base, outs, _w = section_loop(hc, c0, n, F, band=0.012, bins=40, pad=D["cap_pad"], smooth=2)
    front = [max(-1.0, min(1.0, o.dot(F))) for o in outs]
    bh = D["cap_band_h"]
    r0 = [p.copy() for p in base]
    r1 = [p + n * bh for p in base]
    r1b = [c0 + (p - c0) * 0.975 + n * (bh + 0.004) for p in base]   # crease between band and crown
    r2, r3 = [], []
    for p, fr in zip(base, front):
        rise = bh + (D["cap_crown_back"] * (1 - fr) + D["cap_crown_front"] * (1 + fr)) / 2
        r2.append(c0 + (p - c0) * 1.07 + n * (bh + 0.5 * (rise - bh)) + F * (0.45 * D["cap_crown_forward"]))
        r3.append(c0 + (p - c0) * 0.92 + n * rise + F * D["cap_crown_forward"])
    v, f = C.loft([r0, r1, r1b, r2, r3], cap_start=False, cap_end=False)
    tc = sum(r3, Vector()) / len(r3) - n * D["cap_top_sag"]
    ci = len(v)
    v.append(tc)
    N3 = len(r3)
    b3 = 4 * N3
    for i in range(N3):
        f.append((ci, b3 + i, b3 + (i + 1) % N3))
    cap = C.mesh_object("tcw_cap", v, f)
    C.add_modifier(cap, "SOLIDIFY", "Thick", thickness=0.003, offset=1.0)
    C.add_modifier(cap, "SUBSURF", "Smooth", levels=0, render_levels=2)
    C.assign(cap, m["cap"])
    C.stamp_attrs(cap, wear=[0.0] * (3 * N3) + [0.6] * (2 * N3) + [0.7])
    C.parent_to_bone(cap, rig, rm["head"])
    cap["tcw_variant"] = "cap"
    # visor: the front of the base ring pushed out and down, slightly curved
    idx = [i for i, fr in enumerate(front) if fr > 0.28]
    idx.sort(key=lambda i: math.atan2(outs[i].dot(Lv), outs[i].dot(F)))
    vv, ff = [], []
    dip = math.radians(D["cap_visor_dip_deg"])
    for i in idx:
        p = base[i]
        oh = (outs[i] - n * outs[i].dot(n)).normalized()
        depth = D["cap_visor"] * (0.30 + 0.70 * (front[i] - 0.28) / 0.72)
        tip = p + (oh * math.cos(dip) - n * math.sin(dip)) * depth
        mid = p + (oh * math.cos(dip * 0.6) - n * math.sin(dip * 0.6)) * (depth * 0.5)
        vv += [p + n * 0.002, mid, tip]
    for j in range(len(idx) - 1):
        a, b = 3 * j, 3 * (j + 1)
        ff += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2)]
    visor = C.mesh_object("tcw_cap_visor", vv, ff)
    C.add_modifier(visor, "SOLIDIFY", "Thick", thickness=0.004)
    C.add_modifier(visor, "SUBSURF", "Smooth", levels=0, render_levels=1)
    C.assign(visor, m["leather"])
    C.parent_to_bone(visor, rig, rm["head"])
    visor["tcw_variant"] = "cap"
    # chin strap: a narrow leather band on the band, above the visor, ending at two buttons
    sidx = [i for i, fr in enumerate(front) if fr > 0.05]
    sidx.sort(key=lambda i: math.atan2(outs[i].dot(Lv), outs[i].dot(F)))
    sv_, sf_ = [], []
    for i in sidx:
        p = base[i] + outs[i] * 0.0025 + n * 0.008
        sv_ += [p - n * 0.005, p + n * 0.005]
    for j in range(len(sidx) - 1):
        sf_.append((2 * j, 2 * j + 2, 2 * j + 3, 2 * j + 1))
    strap = C.mesh_object("tcw_cap_chinstrap", sv_, sf_)
    C.add_modifier(strap, "SOLIDIFY", "Thick", thickness=0.0018)
    C.assign(strap, m["leather"])
    C.parent_to_bone(strap, rig, rm["head"])
    strap["tcw_variant"] = "cap"
    for k, i in enumerate((sidx[0], sidx[-1])):
        o = outs[i]
        bp = base[i] + o * 0.004 + n * 0.008
        a1 = o.cross(n).normalized()
        bv, bf = plate_profile(bp, a1, n, o, 0.011, 0.011, DOME_PROFILE, n=12)
        btn = C.mesh_object("tcw_cap_button_%d" % k, bv, bf)
        C.assign(btn, m["brass"])
        C.parent_to_bone(btn, rig, rm["head"])
        btn["tcw_variant"] = "cap"
    REP["cap"] = {"tilt_deg": D["cap_tilt_deg"], "seat_z": round(c0.z, 4)}
    return cap, c0, n, base


def build_slouch(m, rig, rm, lm, head_cloud, brow_z, field=False):
    """Black felt slouch hat. field=True (third pass, readability choice): a field-tier-only twin
    with a wider brim in a lighter felt, so the hat still reads at 96 px."""
    F, U, Lv = lm["F"], lm["U"], lm["L"]
    brim = D["slouch_brim_field"] if field else D["slouch_brim"]
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
        brim_out.append(p + oh * brim - U * (0.016 * fr * fr + 0.004) + U * 0.006 * sd * sd)
    bv, bf = C.loft([brim_in, brim_out], cap_start=False, cap_end=False)
    v2, f2 = C.merge([(v, f), (bv, bf)])
    hat = C.mesh_object("tcw_slouch_field" if field else "tcw_slouch", v2, f2)
    C.add_modifier(hat, "SOLIDIFY", "Thick", thickness=0.004, offset=1.0)
    C.add_modifier(hat, "SUBSURF", "Smooth", levels=0, render_levels=1)
    C.assign(hat, m["felt_field"] if field else m["felt"])
    C.parent_to_bone(hat, rig, rm["head"])
    hat["tcw_variant"] = "slouch_field" if field else "slouch"
    hat.hide_render = True
    return hat


# ------------------------------------------------------------------------------ face and hair

OBST = []   # arm-clearance obstacles for poses.py: {"name", "bone", "p" (rest world), "r"}
HANG = []   # third pass: kit that swings toward plumb in poses.py: {"prefix", "bone", "p" (pivot, rest world), "up"}


def face_attributes(body, rest_w, nrm_w, region, lm):
    """Per-vertex masks on the body for the skin shader: stubble (lower face and jaw, not the
    lips), sideburns (in front of the ears, under the cap band), sun (nose, cheeks, upper lip,
    back of the neck, backs of the hands), grime. Masks are per vertex index, so they follow
    every head preset's shape key."""
    eyes = lm.get("eyes") or []
    F, U, Lv = lm["F"], lm["U"], lm["L"]
    E = (sum(eyes, Vector()) / len(eyes)) if eyes else lm["headb"] + U * 0.07
    n = len(rest_w)
    beard, sun, dirt, side = [0.0] * n, [0.0] * n, [0.0] * n, [0.0] * n
    f0, f1 = D["sideburn_fwd"]
    z0, z1 = D["sideburn_dz"]
    for i, p in enumerate(rest_w):
        r = region[i]
        if r is None:
            continue
        q = p - E
        dz, fwd, lat = q.z, q.dot(F), q.dot(Lv)
        nn = nrm_w[i]
        if r in ("head", "neck"):
            w = (C.smoothstep(-0.035, -0.055, dz) * C.smoothstep(-0.165, -0.125, dz) *
                 C.smoothstep(-0.085, -0.035, fwd) * C.smoothstep(0.088, 0.066, abs(lat)))
            lip = (max(0.0, 1 - abs(dz + 0.072) / 0.011) * C.smoothstep(0.03, 0.017, abs(lat)) *
                   C.smoothstep(0.03, 0.06, fwd))
            beard[i] = w * (1 - 0.85 * lip)
            # sideburn: a band in front of the ear, on the side of the head facing outward
            sb = (C.smoothstep(f0 - 0.008, f0 + 0.004, fwd) * C.smoothstep(f1 + 0.006, f1 - 0.004, fwd) *
                  C.smoothstep(z0 - 0.006, z0 + 0.010, dz) * C.smoothstep(z1 + 0.010, z1 - 0.004, dz) *
                  C.smoothstep(0.045, 0.060, abs(lat)) * C.smoothstep(0.2, 0.5, abs(nn.dot(Lv))))
            side[i] = sb
            s = max(0.0, 0.55 * nn.dot(U) + 0.6 * nn.dot(F)) * C.smoothstep(-0.12, -0.03, dz)
            if r == "neck":
                s = max(s, 0.8 * max(0.0, -nn.dot(F)))
            sun[i] = min(1.0, s)
            dirt[i] = 0.3
        elif r == "hand":
            sun[i] = min(1.0, 0.5 * max(0.0, nn.dot(U)) + 0.2)
            dirt[i] = 0.7
    C.stamp_attrs(body, rest=rest_w, dirt=dirt)
    me = body.data
    for key, vals in (("tcw_beard", beard), ("tcw_sun", sun), ("tcw_sideburn", side)):
        a = me.attributes.get(key) or me.attributes.new(key, "FLOAT", "POINT")
        a.data.foreach_set("value", vals)
    REP["face_masks"] = {"beard_vertices": sum(1 for b in beard if b > 0.3), "sun_vertices": sum(1 for s in sun if s > 0.3),
                         "sideburn_vertices": sum(1 for s in side if s > 0.3)}


def _bsdf(mat):
    if mat is None or not mat.use_nodes:
        return None, None
    nt = mat.node_tree
    return nt, next((nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED"), None)


def _chain_bump(nt, bsdf, height, strength, distance):
    """Add a Bump node on top of whatever already drives the BSDF normal (MakeSkin normal map)."""
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = strength
    bp.inputs["Distance"].default_value = distance
    nt.links.new(height, bp.inputs["Height"])
    nin = bsdf.inputs["Normal"]
    if nin.is_linked:
        nt.links.new(nin.links[0].from_socket, bp.inputs["Normal"])
    nt.links.new(bp.outputs["Normal"], nin)


def tweak_skin(mat, cfg, hands=True):
    """Weathered skin over the CC0 texture (no new image files): sunburn, stubble in the head's own
    colour, sideburns, grime that collects in creases (concave pointiness), reddened knuckles and
    cheekbones (convex pointiness), pores, and a little subsurface scattering."""
    nt, bsdf = _bsdf(mat)
    if bsdf is None:
        return "no Principled BSDF in " + (mat.name if mat else "None")
    sock = bsdf.inputs["Base Color"]
    base = sock.links[0].from_socket if sock.is_linked else tuple(sock.default_value)
    rest = C.node_attr(nt, "tcw_rest", "Vector")
    beard = C.node_attr(nt, "tcw_beard")
    sun = C.node_attr(nt, "tcw_sun")
    dirt = C.node_attr(nt, "tcw_dirt")
    sideb = C.node_attr(nt, "tcw_sideburn")
    hair = (*C.hex_rgb(cfg["hair_hex"]), 1.0)
    bc = C.hex_rgb(cfg.get("beard_hex", cfg["hair_hex"]))
    stub_rgb = (*(c * 0.75 for c in bc), 1.0)
    strength = cfg["stubble"]
    col = C.node_mix(nt, "MULTIPLY", C.node_math(nt, "MULTIPLY", sun, 0.40, clamp=True), base, (1.0, 0.68, 0.56, 1.0))
    dots = C.node_ramp(nt, C.node_noise(nt, rest, 1500.0, 1.0), 0.42, 0.58).outputs["Color"]
    stub = C.node_math(nt, "MULTIPLY", beard, dots)
    col = C.node_mix(nt, "MIX", C.node_math(nt, "MULTIPLY", stub, strength, clamp=True), col, stub_rgb)
    # the shadow of a shaved beard: a cool, darker cast over the whole jaw
    col = C.node_mix(nt, "MULTIPLY", C.node_math(nt, "MULTIPLY", beard, 0.40 * strength, clamp=True), col,
                     (0.72, 0.68, 0.70, 1.0))
    # sideburns: fine vertical strands in the hair colour
    sm = nt.nodes.new("ShaderNodeVectorMath")
    sm.operation = "MULTIPLY"
    nt.links.new(rest, sm.inputs[0])
    sm.inputs[1].default_value = (1.0, 1.0, 0.25)
    strands = C.node_ramp(nt, C.node_noise(nt, sm.outputs[0], 900.0, 2.0), 0.35, 0.65).outputs["Color"]
    sbm = C.node_math(nt, "MULTIPLY", sideb, cfg.get("sideburn", 0.5))
    sbm = C.node_math(nt, "MULTIPLY", sbm, C.node_math(nt, "ADD", 0.45, C.node_math(nt, "MULTIPLY", strands, 0.55)), clamp=True)
    col = C.node_mix(nt, "MIX", sbm, col, hair)
    # grime: patchy, and gathered in the creases (concave = low pointiness)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    concave = C.node_ramp(nt, geo.outputs["Pointiness"], 0.40, 0.495, (1, 1, 1, 1), (0, 0, 0, 1)).outputs["Color"]
    convex = C.node_ramp(nt, geo.outputs["Pointiness"], 0.52, 0.62).outputs["Color"]
    grime = C.node_ramp(nt, C.node_noise(nt, rest, 30.0, 3.0), 0.45, 0.72).outputs["Color"]
    g = C.node_math(nt, "MULTIPLY", dirt, C.node_math(nt, "ADD", grime, C.node_math(nt, "MULTIPLY", concave, 0.8)))
    col = C.node_mix(nt, "MIX", C.node_math(nt, "MULTIPLY", g, 0.38, clamp=True), col, (0.26, 0.20, 0.14, 1.0))
    # knuckles, cheekbones, nose tip: a little redder where the skin is stretched over bone
    col = C.node_mix(nt, "MULTIPLY", C.node_math(nt, "MULTIPLY", convex, 0.30, clamp=True), col, (1.0, 0.80, 0.74, 1.0))
    nt.links.new(col, sock)
    # pores and fine wrinkles
    pores = C.node_math(nt, "ADD", C.node_noise(nt, rest, 2200.0, 2.0),
                        C.node_math(nt, "MULTIPLY", C.node_noise(nt, rest, 420.0, 3.0), 0.5))
    _chain_bump(nt, bsdf, pores, 0.06, 0.0005)
    C._set_input(bsdf, ["Subsurface Weight", "Subsurface"], 0.12)
    C._set_input(bsdf, ["Subsurface Scale"], 0.004)
    if "Subsurface Radius" in bsdf.inputs:
        bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.18)
    if not bsdf.inputs["Roughness"].is_linked:
        bsdf.inputs["Roughness"].default_value = 0.52
    return "ok"


def tint_hair(mat, hex_colour):
    """Recolour a CC0 hair/brow/beard/lash texture: its luminance drives a ramp in the head's
    hair colour (dark roots to lighter tips); the texture's alpha is untouched."""
    nt, bsdf = _bsdf(mat)
    if bsdf is None:
        return "no Principled BSDF"
    sock = bsdf.inputs["Base Color"]
    if not sock.is_linked:
        sock.default_value = (*C.hex_rgb(hex_colour), 1.0)
        return "flat"
    src = sock.links[0].from_socket
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(src, bw.inputs[0])
    rgb = C.hex_rgb(hex_colour)
    r = nt.nodes.new("ShaderNodeValToRGB")
    els = r.color_ramp.elements
    els[0].position, els[0].color = 0.0, (*(c * 0.25 for c in rgb), 1.0)
    els[1].position, els[1].color = 0.55, (*(min(1.0, c * 1.7) for c in rgb), 1.0)
    e = els.new(0.15)
    e.color = (*rgb, 1.0)
    nt.links.new(bw.outputs[0], r.inputs["Fac"])
    nt.links.new(r.outputs["Color"], sock)
    if not bsdf.inputs["Roughness"].is_linked:
        bsdf.inputs["Roughness"].default_value = 0.55
    return "ok"


def eye_material(name, iris_hex, F):
    """Procedural eye (no image): warm sclera darkening toward the corners, a striated iris with a
    dark limbal ring, a black pupil, and a glossy clear coat for the catch-light. The iris is
    found per pixel from the angle between (rest position - this eye's centre) and the gaze F."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    rest = C.node_attr(nt, "tcw_rest", "Vector")
    cen = C.node_attr(nt, "tcw_eyec", "Vector")
    sub = nt.nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    nt.links.new(rest, sub.inputs[0])
    nt.links.new(cen, sub.inputs[1])
    nrm = nt.nodes.new("ShaderNodeVectorMath")
    nrm.operation = "NORMALIZE"
    nt.links.new(sub.outputs[0], nrm.inputs[0])
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(nrm.outputs[0], dot.inputs[0])
    dot.inputs[1].default_value = tuple(F)
    c = dot.outputs["Value"]
    ci, cp = math.cos(math.radians(D["iris_deg"])), math.cos(math.radians(D["pupil_deg"]))
    lo = 0.70
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = lo
    mr.inputs["From Max"].default_value = 1.0
    nt.links.new(c, mr.inputs["Value"])
    t = lambda x: (x - lo) / (1.0 - lo)  # noqa: E731
    scl = C.hex_rgb(D["sclera_hex"])
    iris = C.hex_rgb(iris_hex)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (*(x * 0.62 for x in scl), 1.0)   # corners in shadow
    els[1].position, els[1].color = 1.0, (0.01, 0.01, 0.012, 1.0)
    for pos, col in ((t(ci) - 0.18, scl), (t(ci) - 0.012, scl),
                     (t(ci) - 0.002, tuple(x * 0.35 for x in iris)),     # limbal ring
                     (t(ci) + 0.03, iris), (t(cp) - 0.05, tuple(min(1.0, x * 1.25) for x in iris)),
                     (t(cp) - 0.004, tuple(x * 0.6 for x in iris)), (t(cp) + 0.002, (0.01, 0.01, 0.012))):
        e = els.new(max(0.001, min(0.999, pos)))
        e.color = (*col, 1.0)
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    # iris striation and sclera veins: noise on the rest position
    stri = C.node_ramp(nt, C.node_noise(nt, rest, 2600.0, 3.0), 0.3, 0.7, (0.72, 0.72, 0.72, 1), (1.12, 1.12, 1.12, 1)).outputs["Color"]
    col = C.node_mix(nt, "MULTIPLY", 1.0, ramp.outputs["Color"], stri)
    nt.links.new(col, bsdf.inputs["Base Color"])
    C._set_input(bsdf, ["Roughness"], 0.30)
    C._set_input(bsdf, ["Coat Weight", "Clearcoat"], 1.0)
    C._set_input(bsdf, ["Coat Roughness", "Clearcoat Roughness"], 0.02)
    C._set_input(bsdf, ["Specular IOR Level", "Specular"], 0.6)
    return mat


def stamp_eye(obj, mid_l, Lv):
    """tcw_rest and tcw_eyec (the centre of this vertex's own eyeball) on an eyes proxy."""
    mw = obj.matrix_world
    pts = [mw @ v.co for v in obj.data.vertices]
    sides = [1 if (p.dot(Lv) - mid_l) > 0 else -1 for p in pts]
    cen = {}
    for s in (1, -1):
        ps = [p for p, k in zip(pts, sides) if k == s]
        if ps:
            lo = Vector((min(p.x for p in ps), min(p.y for p in ps), min(p.z for p in ps)))
            hi = Vector((max(p.x for p in ps), max(p.y for p in ps), max(p.z for p in ps)))
            cen[s] = (lo + hi) / 2
    me = obj.data
    C.stamp_attrs(obj, rest=pts)
    a = me.attributes.get("tcw_eyec") or me.attributes.new("tcw_eyec", "FLOAT_VECTOR", "POINT")
    flat = []
    for k in sides:
        c = cen.get(k, Vector())
        flat.extend((c.x, c.y, c.z))
    a.data.foreach_set("vector", flat)
    return {str(k): [round(x, 4) for x in v] for k, v in cen.items()}


def setup_heads(body, lm, roles):
    """Shade every head preset built by probe_mpfb.py: skin per slot, hair/brow/beard/lash
    colour, procedural eyes. Returns the report."""
    info = C.json.loads(body.get("tcw_heads", "{}"))
    out = {}
    mid_l = lm["mid"].dot(lm["L"])
    for h, rec in info.items():
        cfg = HEADS.get(h)
        if cfg is None:
            continue
        r = {"skin": {}, "objects": {}}
        for i, mname in enumerate(rec.get("skins", [])):
            mat = bpy.data.materials.get(mname or "")
            role = roles[i] if i < len(roles) else "?"
            if mat is None:
                continue
            if role in ("skin", "lips", "ears"):
                r["skin"][mname] = tweak_skin(mat, cfg)
            elif role == "fingernails":
                nt, bsdf = _bsdf(mat)
                if bsdf is not None:
                    sock = bsdf.inputs["Base Color"]
                    b0 = sock.links[0].from_socket if sock.is_linked else tuple(sock.default_value)
                    nt.links.new(C.node_mix(nt, "MULTIPLY", 1.0, b0, (0.72, 0.64, 0.55, 1.0)), sock)
                    r["skin"][mname] = "grimed nails"
        emat = eye_material("tcw_eye_" + h, cfg["iris_hex"], lm["F"])
        for oname in rec.get("objects", []):
            o = bpy.data.objects.get(oname)
            if o is None:
                r["objects"][oname] = "missing"
                continue
            role = o.get("tcw_role", "")
            if role == "eyes":
                r["objects"][oname] = {"eye_centres": stamp_eye(o, mid_l, lm["L"])}
                o.data.materials.clear()
                o.data.materials.append(emat)
            elif role in ("hair", "brows", "beard", "lashes"):
                hexc = cfg["beard_hex"] if role == "beard" else cfg["hair_hex"]
                if role == "lashes":
                    hexc = "#1a1410"
                res = [tint_hair(s.material, hexc) for s in o.material_slots if s.material]
                r["objects"][oname] = res
        out[h] = r
    return out


def head_clouds(body, rest_w, head_idx):
    """Rest positions of the head vertices for EVERY head preset (the default's rest positions
    plus each preset's shape-key difference), so the cap and slouch hat fit them all."""
    keys = body.data.shape_keys
    info = C.json.loads(body.get("tcw_heads", "{}"))
    if keys is None or not info:
        return [rest_w[i][:] for i in head_idx]
    kb = keys.key_blocks
    cur = [k for k in kb if k.name.startswith("tcw_head_") and k.value > 0.5]
    cur = cur[0] if cur else None
    MW = body.matrix_world.to_3x3()
    out = []
    for h, rec in info.items():
        k = kb.get(rec.get("key", ""))
        for i in head_idx:
            d = Vector()
            if k is not None:
                d = k.data[i].co - k.relative_key.data[i].co
            if cur is not None:
                d = d - (cur.data[i].co - cur.relative_key.data[i].co)
            out.append((rest_w[i] + MW @ d)[:])
    return out


def mask_hair_under(c0, n, base_pts):
    """Hide hair-proxy vertices that would poke through the cap (inside the band, above it)."""
    R = sum(((p - c0) - n * (p - c0).dot(n)).length for p in base_pts) / len(base_pts) + 0.004
    done = {}
    for o in bpy.data.objects:
        if o.type != "MESH" or o.get("tcw_role") != "hair":
            continue
        mw = o.matrix_world
        idx = []
        for v in o.data.vertices:
            q = mw @ v.co - c0
            h = q.dot(n)
            rad = (q - n * h).length
            if (h > 0.004 and rad < R) or (h > 0.001 and rad >= R):
                idx.append(v.index)   # under the cap, or poking out past the band (run 14 spikes); the
                # cut sits at the band bottom so the band hides it (run 16: a cut 1 cm lower showed jagged)
        if not idx:
            continue
        vg = o.vertex_groups.get("tcw_under_cap") or o.vertex_groups.new(name="tcw_under_cap")
        vg.add(idx, 1.0, "REPLACE")
        mod = o.modifiers.new("Under cap", "MASK")
        mod.vertex_group = "tcw_under_cap"
        mod.invert_vertex_group = True
        try:
            o.modifiers.move(len(o.modifiers) - 1, 0)
        except Exception:  # noqa: BLE001
            pass
        done[o.name] = len(idx)
    REP["hair_masked"] = done


# ------------------------------------------------------------------------------ kit (second pass)

def torus(centre, axis, R, r, n=16, m=6, arc=2 * math.pi):
    """A ring of tube around `axis` (a tie, a strap loop, a seam)."""
    axis = axis.normalized()
    u = axis.orthogonal().normalized()
    v = axis.cross(u).normalized()
    closed = arc >= 2 * math.pi - 1e-6
    nn = n if closed else n + 1
    verts, faces = [], []
    for i in range(nn):
        a = arc * i / n
        d = u * math.cos(a) + v * math.sin(a)
        c = centre + d * R
        for j in range(m):
            b = 2 * math.pi * j / m
            verts.append(c + (d * math.cos(b) + axis * math.sin(b)) * r)
    segs = n if closed else n
    for i in range(segs):
        i2 = (i + 1) % nn
        for j in range(m):
            j2 = (j + 1) % m
            faces.append((i * m + j, i * m + j2, i2 * m + j2, i2 * m + j))
    return verts, faces


def plate_profile(centre, ax, ay, nrm, w, h, profile, n=28):
    """A lofted badge: rings of (lift along nrm, scale of the w x h oval), capped at the top."""
    rings = [C.ring(centre + nrm * dz, ax, ay, w / 2 * s, h / 2 * s, n) for dz, s in profile]
    return C.loft(rings, cap_start=False, cap_end=True)


OVAL_PROFILE = ((0.0, 1.0), (0.0025, 1.0), (0.0033, 0.95), (0.0026, 0.9), (0.0030, 0.6), (0.0034, 0.0))
DOME_PROFILE = ((0.0, 1.0), (0.0015, 0.97), (0.003, 0.75), (0.0038, 0.35))


def buckle(name, m, p, along, across, out, w, h, skin):
    """A rectangular frame buckle with a centre bar (iron or brass), skinned to the torso."""
    b = 0.0035
    parts = []
    for sx, sy, hx, hy in ((0, h / 2, w / 2, b / 2), (0, -h / 2, w / 2, b / 2),
                           (w / 2, 0, b / 2, h / 2), (-w / 2, 0, b / 2, h / 2), (0, 0, b / 2, h / 2)):
        parts.append(C.box(p + across * sx + along * sy + out * 0.002, (across, along, out), (hx, hy, 0.0016)))
    v, f = C.merge(parts)
    o = C.mesh_object(name, v, f, smooth=False)
    C.assign(o, m)
    skin.apply(o, 4)
    return o


def ribbon_point(pts, outs, target):
    i = min(range(len(pts)), key=lambda k: (pts[k] - target).length)
    j = (i + 1) % len(pts)
    along = (pts[j] - pts[i]).normalized()
    return pts[i], outs[i], along


def build_blanket_roll(m, pts, outs, across, rig, skin, obst_bone=None):
    """Horseshoe blanket roll (third pass). Along the roll: squeezed where each tie binds it and
    slightly fuller between ties; flattened where it lies on the shoulder and at the hip ends; a
    small sag away from the body between them; a dark band near each end (tcw_stripe). Each end is
    a disc with a stepped spiral (the edges of the rolled layers). Bin 0 of `pts` is at the bottom
    (hip) end of the loop, so dropping the first/last bins opens it there."""
    R = D["blanket_roll_r"]
    U = Vector((0, 0, 1))
    n = len(pts)
    gap = max(3, n // 10)
    idx = list(range(gap, n - gap))
    seg = 20
    K = len(idx)
    # centres along the roll, before shaping, and arc length
    c0 = [pts[i] + outs[i] * (R * 0.82) for i in idx]
    arc = [0.0]
    for k in range(1, K):
        arc.append(arc[-1] + (c0[k] - c0[k - 1]).length)
    Ltot = arc[-1] or 1.0
    s_of = [a / Ltot for a in arc]
    tie_fr = (0.05, 0.32, 0.68, 0.95)
    tie_m = [f * Ltot for f in tie_fr]
    k_top = max(range(K), key=lambda k: c0[k].z)
    w_tie = D["roll_tie_width"]

    def squeeze(a):
        return 1.0 - D["roll_tie_squeeze"] * sum(math.exp(-((a - t) / w_tie) ** 2) for t in tie_m)

    def fuller(a):
        # +3% between ties, nothing at the ties
        nearest = min(abs(a - t) for t in tie_m)
        return 1.0 + 0.03 * C.smoothstep(0.0, 0.08, nearest)

    rings, cents, axes, stripe = [], [], [], []
    a0, a1 = D["roll_stripe"]
    for k, i in enumerate(idx):
        u = outs[i]
        v = across
        s = s_of[k]
        e = min(k, K - 1 - k) / max(1, K - 1)
        taper = 0.80 + 0.20 * C.smoothstep(0.0, 0.08, e)
        on_top = C.smoothstep(0.35, 0.85, max(0.0, u.dot(U)))          # lying on the shoulder
        at_end = C.smoothstep(0.16, 0.02, min(s, 1.0 - s))               # lying on the hip / flank
        flat = 1.0 - D["roll_flatten"] * max(on_top, 0.7 * at_end)
        span = (k / max(1, k_top)) if k <= k_top else ((K - 1 - k) / max(1, K - 1 - k_top))
        sag = D["roll_sag"] * math.sin(math.pi * min(1.0, max(0.0, span)))
        sq = squeeze(arc[k]) * fuller(arc[k])
        wob = (1.0 + 0.035 * noise.noise(Vector((k * 0.35, 0.0, 0.0)))) * taper * sq
        ru, rv = R * 0.82 * wob * flat, R * 1.08 * wob * (1.0 + 0.45 * (1.0 - flat))
        c = pts[i] + u * (ru + 0.0005) - U * sag + u * (0.4 * sag)
        axes.append((u, v, ru, rv))
        tw = 2 * math.pi * 3.0 * k / K       # the outer layer edge winds three times round
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            frac = ((a + tw) % (2 * math.pi)) / (2 * math.pi)
            lip = 0.94 + 0.06 * frac
            ring.append(c + u * (math.cos(a) * ru * lip) + v * (math.sin(a) * rv * lip))
        rings.append(ring)
        cents.append(c)
        st = (C.smoothstep(a0 - 0.006, a0 + 0.004, s) * C.smoothstep(a1 + 0.006, a1 - 0.004, s) +
              C.smoothstep(a0 - 0.006, a0 + 0.004, 1 - s) * C.smoothstep(a1 + 0.006, a1 - 0.004, 1 - s))
        stripe.extend([min(1.0, st)] * seg)
    if obst_bone:
        for c in cents[::3]:
            OBST.append({"name": "roll", "bone": obst_bone, "p": list(c), "r": R * 1.05})
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    for k in range(len(rings) - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((k * seg + j, k * seg + j2, (k + 1) * seg + j2, (k + 1) * seg + j))
    nt_ = len(verts)
    cav = [0.0] * nt_
    # spiral end discs: polar grid, recessed in a sawtooth that steps once per layer
    turns = D["roll_turns"]
    na, nr = 72, 18
    for end, sgn in ((0, -1), (len(rings) - 1, 1)):
        c = cents[end]
        t = (cents[min(len(cents) - 1, end + 1)] - cents[max(0, end - 1)]).normalized() * sgn
        u, v, ru, rv = axes[end]
        base = len(verts)
        verts.append(c - t * 0.001)
        cav.append(0.0)
        stripe.append(0.0)
        for ri in range(1, nr + 1):
            rho = ri / nr
            for ai in range(na):
                th = 2 * math.pi * ai / na
                ph = rho * turns - th / (2 * math.pi)
                fr_ = ph - math.floor(ph)
                rec = 0.0035 * fr_ * C.smoothstep(0.0, 0.12, rho) + 0.0015 * (1 - rho)
                p = c + (u * (math.cos(th) * ru) + v * (math.sin(th) * rv)) * rho * 0.985 - t * (rec - 0.0015)
                verts.append(p)
                cav.append(C.smoothstep(0.18, 0.0, fr_) * 0.9)
                stripe.append(0.0)
        for ai in range(na):
            a2 = (ai + 1) % na
            f = (base, base + 1 + ai, base + 1 + a2)
            faces.append(f if sgn > 0 else f[::-1])
        for ri in range(1, nr):
            r0 = base + 1 + (ri - 1) * na
            r1 = base + 1 + ri * na
            for ai in range(na):
                a2 = (ai + 1) % na
                f = (r0 + ai, r1 + ai, r1 + a2, r0 + a2)
                faces.append(f if sgn > 0 else f[::-1])
    obj = C.mesh_object("tcw_blanket_roll", verts, faces)
    C.assign(obj, m["blanket"])
    C.stamp_attrs(obj, wear=0.35, dirt=0.12, cavity=cav)
    a = obj.data.attributes.get("tcw_stripe") or obj.data.attributes.new("tcw_stripe", "FLOAT", "POINT")
    a.data.foreach_set("value", stripe[:len(verts)])
    skin.apply(obj, 12)
    C.add_modifier(obj, "SUBSURF", "Smooth", levels=0, render_levels=1)
    obj["tcw_variant"] = "roll"
    REP["objects"][obj.name] = {"verts": len(verts), "rings": len(rings), "length_m": round(Ltot, 3),
                                "top_ring": k_top}
    # ties: tight cords round the squeezed section, at the tie stations
    tparts = []
    for fr in tie_fr:
        k = min(range(K), key=lambda kk: abs(arc[kk] - fr * Ltot))
        k2 = min(len(cents) - 1, k + 1)
        ax = (cents[k2] - cents[max(0, k - 1)]).normalized()
        u, v, ru, rv = axes[k]
        tv_, tf_ = [], []
        nn_, mm_ = 24, 6
        for a_i in range(nn_):
            a = 2 * math.pi * a_i / nn_
            cc = cents[k] + u * (math.cos(a) * ru * 0.97) + v * (math.sin(a) * rv * 0.97)
            dd = (u * (math.cos(a) / max(1e-6, ru)) + v * (math.sin(a) / max(1e-6, rv))).normalized()
            for b_i in range(mm_):
                b = 2 * math.pi * b_i / mm_
                tv_.append(cc + (dd * math.cos(b) + ax * math.sin(b)) * 0.0035)
        for a_i in range(nn_):
            a2 = (a_i + 1) % nn_
            for b_i in range(mm_):
                b2 = (b_i + 1) % mm_
                tf_.append((a_i * mm_ + b_i, a_i * mm_ + b2, a2 * mm_ + b2, a2 * mm_ + b_i))
        tparts.append((tv_, tf_))
    v, f = C.merge(tparts)
    ties = C.mesh_object("tcw_blanket_ties", v, f)
    C.assign(ties, m["webbing"])
    C.stamp_attrs(ties, dirt=0.3, wear=0.3)
    skin.apply(ties, 12)
    ties["tcw_variant"] = "roll"
    return obj


def build_cartridge(m, rig):
    """A paper cartridge (ball and powder), local axis X, centred; the tail end twisted shut.
    poses.py keys it into the right hand in the load clip and scales it to nothing elsewhere."""
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    cl, cr = D["cartridge_len"], D["cartridge_r"]
    prof = [(-cl / 2, 0.45), (-cl / 2 + 0.002, 0.85), (-cl / 2 + 0.007, 1.0), (cl / 2 - 0.018, 1.0),
            (cl / 2 - 0.012, 0.86), (cl / 2 - 0.007, 0.50), (cl / 2 - 0.003, 0.34), (cl / 2, 0.30)]
    rings = []
    for x, s in prof:
        tw = 0.0 if x < cl / 2 - 0.013 else (x - (cl / 2 - 0.013)) * 120.0   # the twist
        ring = []
        for j in range(14):
            a = 2 * math.pi * j / 14 + tw
            pinch = 1.0 + (0.12 * math.sin(5 * a) if x > cl / 2 - 0.012 else 0.0)
            ring.append(Vector((x, 0, 0)) + Y * (math.cos(a) * cr * s * pinch) + Z * (math.sin(a) * cr * s * pinch))
        rings.append(ring)
    v, f = C.loft(rings)
    obj = C.mesh_object("tcw_cartridge", v, f)
    C.assign(obj, m["paper"])
    C.stamp_attrs(obj, dirt=0.25, wear=0.2)
    C.add_modifier(obj, "SUBSURF", "Smooth", levels=0, render_levels=1)
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix()
    obj.rotation_mode = "QUATERNION"
    obj.scale = (0.0, 0.0, 0.0)
    REP["objects"][obj.name] = {"length_m": cl, "radius_m": cr}
    return obj


def build_box_kit(name, m, rig, bone, cen, across, up, out, size, plate=None, flap_frac=0.85):
    """Leather box (cartridge box, cap pouch): bevelled body, a flap over the top and front with
    a rounded edge, an optional oval brass plate and a closing stud."""
    w, h, d = size
    v, f = C.box(cen, (across, up, out), (w / 2, h / 2, d / 2))
    rigid(name, v, f, m["leather"], rig, bone, bevel=min(0.006, d / 5))
    t = 0.0028
    path = [(h / 2 + t, -d / 2 + 0.004 + k * (d - 0.012) / 3) for k in range(4)]
    for k in range(1, 4):
        a = (math.pi / 2) * k / 3
        path.append((h / 2 - 0.008 + (0.008 + t) * math.cos(a), d / 2 - 0.008 + (0.008 + t) * math.sin(a)))
    yb = h / 2 - flap_frac * h
    for k in range(1, 6):
        path.append((h / 2 - 0.008 - (h / 2 - 0.008 - yb) * k / 5, d / 2 + t))
    nx = 10
    verts, faces = [], []
    for ri, (y, z) in enumerate(path):
        last = ri >= len(path) - 2
        for j in range(nx + 1):
            x = -(w / 2 + t) + (w + 2 * t) * j / nx
            if last:   # round the lower corners
                e = abs(x) / (w / 2 + t)
                y = y + 0.012 * max(0.0, e - 0.6) / 0.4 * (1 if ri == len(path) - 1 else 0.5)
            verts.append(cen + across * x + up * y + out * z)
    for ri in range(len(path) - 1):
        for j in range(nx):
            a = ri * (nx + 1) + j
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    flap = rigid(name + "_flap", verts, faces, m["leather"], rig, bone, smooth=True)
    C.add_modifier(flap, "SOLIDIFY", "Thick", thickness=0.003, offset=1.0)
    if plate:
        pc = cen + up * (yb + 0.48 * (h / 2 - yb)) + out * (d / 2 + t + 0.003)
        pv, pf = plate_profile(pc, across, up, out, plate[0], plate[1], OVAL_PROFILE)
        rigid(name + "_plate", pv, pf, m["brass"], rig, bone, smooth=True)
    sc = cen + up * (yb + 0.012) + out * (d / 2 + t + 0.003)
    sv, sf = C.loft([C.ring(sc + out * dz, across, up, 0.006 * s, 0.006 * s, 10) for dz, s in
                     ((0.0, 1.0), (0.004, 0.9), (0.006, 0.5))], cap_start=True, cap_end=True)
    rigid(name + "_stud", sv, sf, m["brass"], rig, bone, smooth=True)


def build_haversack(m, rig, bone, top_c, across, up, out, size):
    """Tarred-canvas haversack: a soft bag that is thin at the top, bulges and sags at the bottom,
    with a flap over the front, a button and a tab."""
    w, h, d = size
    nr, nseg = 10, 36
    rings = []

    def rrect_pts(hw, hd, rad):
        pts = []
        for k in range(nseg):
            a = 2 * math.pi * k / nseg
            cx, cy = math.cos(a), math.sin(a)
            # superellipse: squarish but soft
            x = hw * math.copysign(abs(cx) ** 0.45, cx)
            yy = hd * math.copysign(abs(cy) ** 0.6, cy)
            pts.append((x, yy))
        return pts

    front_z = []
    for k in range(nr + 1):
        t = k / nr
        dz = d * (0.32 + 0.68 * t ** 0.6) * (1 - 0.45 * C.smoothstep(0.82, 1.0, t))
        hw = w / 2 * (1 - 0.05 * t)
        y = -h * t
        ring = []
        for x, zz in rrect_pts(hw, dz / 2, 0.02):
            u = x / max(1e-6, hw)
            sag = 0.028 * (1 - u * u) * C.smoothstep(0.55, 1.0, t)
            ring.append(top_c + across * x + up * (y - sag) + out * (dz / 2 + zz))
        rings.append(ring)
        front_z.append(dz)
    v, f = C.loft(rings, cap_start=True, cap_end=True)
    bag = rigid("tcw_haversack", v, f, m["haversack"], rig, bone, smooth=True)
    HANG.append({"prefix": "tcw_haversack", "bone": bone, "p": list(top_c), "up": list(up)})
    for xx in (-w * 0.28, 0.0, w * 0.28):
        OBST.append({"name": "haversack", "bone": bone, "r": 0.065,
                     "p": list(top_c + across * xx - up * (h * 0.6) + out * (d * 0.5))})
    C.add_modifier(bag, "SUBSURF", "Smooth", levels=0, render_levels=1)
    C.stamp_attrs(bag, dirt=0.25, wear=0.3)
    # flap: follows the front face down 72% of the bag, rounded bottom edge
    verts, faces = [], []
    nx = 12
    rows = 8
    for ri in range(rows + 1):
        t = 0.72 * ri / rows
        k = t * nr
        k0 = min(nr - 1, int(k))
        fz = front_z[k0] + (front_z[k0 + 1] - front_z[k0]) * (k - k0)
        hw = w / 2 * (1 - 0.05 * t) + 0.004
        for j in range(nx + 1):
            x = -hw + 2 * hw * j / nx
            yy = -h * t
            if ri == rows:
                e = abs(x) / hw
                yy += 0.03 * e ** 3
            verts.append(top_c + across * x + up * (yy + 0.004) + out * (fz + 0.004))
    for ri in range(rows):
        for j in range(nx):
            a = ri * (nx + 1) + j
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    fl = rigid("tcw_haversack_flap", verts, faces, m["haversack"], rig, bone, smooth=True)
    C.add_modifier(fl, "SOLIDIFY", "Thick", thickness=0.003, offset=1.0)
    C.stamp_attrs(fl, dirt=0.2, wear=0.4)
    t = 0.66
    k0 = int(t * nr)
    bc = top_c + up * (-h * t + 0.01) + out * (front_z[k0] + 0.009)
    bv, bf = plate_profile(bc, across, up, out, 0.016, 0.016, DOME_PROFILE, n=12)
    rigid("tcw_haversack_button", bv, bf, m["bone"], rig, bone, smooth=True)


def build_canteen(m, rig, bone, cen, tang, up, o):
    """Smoothside canteen: lens body in a wool cover, a tin seam round the edge, pewter spout,
    cork stopper on a string, and three strap loops."""
    r = D["canteen_d"] / 2
    tk = D["canteen_t"]
    rings_c = [C.ring(cen + o * (s * tk / 2), tang, up, r * k, r * k, 32)
               for s, k in ((-1, 0.80), (-0.75, 0.93), (-0.4, 0.985), (0, 1.0), (0.4, 0.985), (0.75, 0.93), (1, 0.80))]
    cv, cf = C.loft(rings_c)
    body = rigid("tcw_canteen", cv, cf, m["canteen"], rig, bone, smooth=True)
    HANG.append({"prefix": "tcw_canteen", "bone": bone, "p": list(cen + up * (r * 1.03)), "up": list(up)})
    OBST.append({"name": "canteen", "bone": bone, "p": list(cen), "r": r * 1.02})
    C.stamp_attrs(body, dirt=0.2, wear=0.45)
    sv, sf = torus(cen, o, r * 1.0, 0.0045, n=40, m=6)
    rigid("tcw_canteen_seam", sv, sf, m["steel"], rig, bone, smooth=True)
    top = cen + up * r
    sp = C.loft([C.ring(top + up * dz, tang, o, rr, rr, 12) for dz, rr in
                 ((-0.012, 0.013), (0.006, 0.012), (0.012, 0.010), (0.016, 0.012), (0.019, 0.012))], cap_end=False)
    rigid("tcw_canteen_spout", sp[0], sp[1], m["pewter"], rig, bone, smooth=True)
    ck = C.loft([C.ring(top + up * dz, tang, o, rr, rr, 12) for dz, rr in
                 ((0.012, 0.0085), (0.030, 0.0100), (0.034, 0.0095))])
    rigid("tcw_canteen_cork", ck[0], ck[1], m["cork"], rig, bone, smooth=True)
    # three strap loops on the rim, and a string from the cork to the first one
    loop_pts = []
    lp = []
    for ang in (math.radians(50), math.radians(-50), math.radians(180)):
        p = cen + tang * (math.sin(ang) * r * 1.03) + up * (math.cos(ang) * r * 1.03)
        axis = (tang * math.cos(ang) - up * math.sin(ang)).normalized()
        tv, tf = torus(p, axis, 0.009, 0.0022, n=12, m=5)
        lp.append((tv, tf))
        loop_pts.append(p)
    v, f = C.merge(lp)
    rigid("tcw_canteen_loops", v, f, m["steel"], rig, bone, smooth=True)
    st = []
    p0 = top + up * 0.032 + o * 0.009
    p1 = loop_pts[0]
    for i in range(9):
        s = i / 8
        q = p0 * (1 - s) + p1 * s - up * (0.02 * math.sin(math.pi * s)) + o * 0.01 * math.sin(math.pi * s)
        st.append(C.ring(q, tang, o, 0.0012, 0.0012, 5))
    v, f = C.loft(st)
    rigid("tcw_canteen_string", v, f, m["webbing"], rig, bone, smooth=True)


def build_scabbard(m, rig, bone, p, o, tang, down):
    """Leather bayonet scabbard: a frog loop at the belt, a tapering sheath, a brass ball tip."""
    w, l, t = D["scabbard"]
    rings = []
    for k in range(9):
        s = k / 8
        rx = w / 2 * (1 - 0.68 * s)
        ry = t / 2 * (1 - 0.35 * s) + 0.002
        rings.append(C.ring(p + o * (0.012 + t) + down * (l * s), tang, o, rx, ry, 12))
    v, f = C.loft(rings)
    sh = rigid("tcw_scabbard", v, f, m["leather"], rig, bone, smooth=True)
    C.stamp_attrs(sh, wear=0.4, dirt=0.25)
    tip = p + o * (0.012 + t) + down * (l + 0.006)
    tv, tf = C.loft([C.ring(tip + down * dz, tang, o, rr, rr, 10) for dz, rr in
                     ((-0.022, 0.0075), (-0.004, 0.0085), (0.0, 0.010), (0.006, 0.007), (0.009, 0.0))])
    rigid("tcw_scabbard_tip", tv, tf, m["brass"], rig, bone, smooth=True)
    fv, ff = C.box(p + o * (0.010 + t / 2) + down * 0.03, (tang, down, o), (w / 2 + 0.006, 0.045, t / 2 + 0.006))
    rigid("tcw_scabbard_frog", fv, ff, m["leather"], rig, bone, bevel=0.003)


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
            ring_attrs.append((0.25 * C.smoothstep(0.75, 1.0, t), 0.0, max(0.0, -d / 0.012)))
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
    plate = C.mesh_object("tcw_belt_plate", *plate_profile(pc, Lv, U, wouts[fi], bw, bh, OVAL_PROFILE, n=32))
    C.assign(plate, m["brass"])
    sk_torso.apply(plate, 6)
    # belt keeper: a brass loop beside the plate (wearer's left)
    kp = pc + Lv * (bw / 2 + 0.02)
    kv, kf = C.box(kp + wouts[fi] * 0.002, (Lv, U, wouts[fi]), (0.004, D["waist_belt_width"] / 2 + 0.002, 0.002))
    keeper = C.mesh_object("tcw_belt_keeper", kv, kf, smooth=False)
    C.assign(keeper, m["brass"])
    sk_torso.apply(keeper, 6)

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
    pc = cb_pts[bi] + cb_outs[bi] * 0.003
    bp = C.mesh_object("tcw_breast_plate", *plate_profile(
        pc, cb_n, cb_n.cross(cb_outs[bi]).normalized(), cb_outs[bi], D["breast_plate_d"], D["breast_plate_d"],
        OVAL_PROFILE, n=32))
    C.assign(bp, m["brass"])
    sk_torso.apply(bp, 6)
    # an iron buckle on the cartridge belt, low on the front (placeholder position)
    p_, o_, al_ = ribbon_point(cb_pts, cb_outs, lm["hip_c"] + F * 0.2 - Lv * 0.08 + U * 0.22)
    buckle("tcw_cartridge_belt_buckle", m["steel"], p_ + o_ * 0.003, al_, cb_n, o_, 0.066, 0.04, sk_torso)
    roll_pts, roll_outs, roll_n = diag_loop("L", "R", -0.01, 0.0, D["strap_thickness"] + 0.006,
                                            bottom_z=waist_z + 0.02)
    build_blanket_roll(m, roll_pts, roll_outs, roll_n, rig, sk_torso, obst_bone=rm["chest"])
    for j, (shift, mat_name) in enumerate(((0.025, "haversack"), (-0.025, "webbing"))):
        p_, o_, n_ = diag_loop("R", "L", shift, D["sling_strap_width"], D["strap_thickness"] + 0.003 + 0.002 * j)
        ribbon("tcw_strap_" + mat_name, p_, o_, n_, D["sling_strap_width"], m[mat_name], sk_torso)
        bp_, bo_, bal_ = ribbon_point(p_, o_, lm["shR"] + F * 0.12 - U * (0.14 + 0.05 * j) + Lv * 0.06)
        buckle("tcw_strap_buckle_" + mat_name, m["steel"], bp_ + bo_ * 0.003, bal_, n_, bo_, 0.04, 0.03, sk_torso)
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

    def side_frame(direction, z_shift, gap, d):
        p, o = surface(direction, z_shift)
        o = Vector((o.x, o.y, 0)).normalized()
        return p + o * (gap + d / 2), o.cross(U).normalized(), U.copy(), o

    back = -F
    cb = D["cartridge_box"]
    cen, acr, up_, o_ = side_frame((-Lv) * 0.55 + back * 0.85, 0.0, D["strap_thickness"] + 0.004, cb[2])
    build_box_kit("tcw_cartridge_box", m, rig, anchor, cen, acr, up_, o_, cb, plate=D["box_plate"])
    OBST.append({"name": "cartridge box", "bone": anchor, "p": list(cen), "r": 0.085})
    cp = D["cap_pouch"]
    cen, acr, up_, o_ = side_frame(F * 0.8 + (-Lv) * 0.6, waist_z - hz - 0.02, 0.006, cp[2])
    build_box_kit("tcw_cap_pouch", m, rig, anchor, cen, acr, up_, o_, cp, plate=None, flap_frac=0.7)
    # left hip, second pass: haversack and canteen hang BEHIND the hip so the left arm hangs in
    # front of them; the scabbard sits on the side (placement placeholder, judged by eye)
    hs = D["haversack"]
    kit_dir = Lv * 0.72 + back * 0.70
    cen, acr, up_, o_ = side_frame(kit_dir, -0.10, 0.010, 0.0)
    build_haversack(m, rig, anchor, cen + U * (hs[1] / 2), acr, up_, o_, hs)
    p, o = surface(kit_dir, -0.07)
    o = Vector((o.x, o.y, 0)).normalized()
    cen = p + o * (0.012 + hs[2] + 0.01 + D["canteen_t"] / 2)
    build_canteen(m, rig, anchor, cen, o.cross(U).normalized(), U.copy(), o)
    p, o = surface(Lv * 0.95 + back * 0.25, -0.02)
    o = Vector((o.x, o.y, 0)).normalized()
    down = (-U * math.cos(math.radians(25)) + back.normalized() * math.sin(math.radians(25))).normalized()
    build_scabbard(m, rig, anchor, p, o, U.cross(o).normalized(), down)
    T.mark("hip kit")

    # headgear
    head_idx = [i for i, r in enumerate(region) if r == "head"]
    # third pass: the cap and slouch hat are fitted over the union of every head preset
    head_cloud = head_clouds(body, rest_w, head_idx)
    REP["head_cloud_points"] = len(head_cloud)
    eyes = lm.get("eyes")
    eye_z = (sum(e.z for e in eyes) / len(eyes)) if eyes else (max(p[2] for p in head_cloud) - 0.11)
    brow_z = eye_z + 0.028
    _cap, cap_c0, cap_n, cap_base = build_cap(m, rig, rm, lm, head_cloud, brow_z)
    build_slouch(m, rig, rm, lm, head_cloud, brow_z)
    build_slouch(m, rig, rm, lm, head_cloud, brow_z, field=True)
    mask_hair_under(cap_c0, cap_n, cap_base)
    T.mark("headgear")

    # face: stubble, sideburn, sun and grime masks; skin, hair and eyes for every head preset
    nrm_w = [(MW.to_3x3() @ q).normalized() for q in nrm]
    face_attributes(body, rest_w, nrm_w, region, lm)
    roles = C.json.loads(body.get("tcw_slot_roles", "[]"))
    REP["slot_roles"] = roles
    try:
        REP["heads"] = setup_heads(body, lm, roles)
    except Exception as e:  # noqa: BLE001 - recorded; the default skin is still shaded below
        import traceback
        REP["heads_error"] = traceback.format_exc()[-1500:]
        C.log("setup_heads FAILED:", e)
    if not body.get("tcw_heads") and body.material_slots and body.material_slots[0].material:
        REP["skin_tweak_fallback"] = tweak_skin(body.material_slots[0].material, HEADS[HEAD_DEFAULT])
    T.mark("face")

    musket = build_musket(m)
    musket.parent = rig
    musket.matrix_parent_inverse = Matrix()
    musket.location = lm["hipR"] + F * 0.1 - Lv * 0.1
    build_cartridge(m, rig)
    T.mark("musket, cartridge")

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
    # third pass: smoother face and fingers in the renders (render level only; posing and
    # framing use the base mesh)
    C.add_modifier(body, "SUBSURF", "Smooth", levels=0, render_levels=1)
    REP["body_modifiers"] = [(md.name, md.type) for md in body.modifiers]
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
    bpy.context.scene["tcw_obstacles"] = C.json.dumps(OBST)
    bpy.context.scene["tcw_hang"] = C.json.dumps(HANG)
    bpy.context.scene["tcw_uniform_consts"] = C.json.dumps({k: D[k] for k in (
        "cartridge_len", "cartridge_r", "hang_plumb", "hang_swing_deg", "hang_lag")})
    REP["hang"] = HANG
    REP["obstacles"] = {k: sum(1 for o in OBST if o["name"] == k) for k in set(o["name"] for o in OBST)}
    out = os.path.join(C.WORK, "soldier.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=False)
    T.mark("saved soldier.blend")
    REP["timing"] = T.marks
    C.write_report("uniform", REP)


main()
