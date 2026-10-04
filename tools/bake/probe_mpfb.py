# STACK-LAW EXCEPTION (AGENTS.md section 2): Python ONLY because this runs inside Blender's
# bundled interpreter on GitHub Actions (bake leg). Never shipped; never run on the Mac.
#
# Stage 1 of the bake: answer "does MPFB2 create a human headless?".
# Creates one adult male with MPFB's default rig and a CC0 skin from the MakeHuman system
# assets pack, reports mesh/vertex counts and timings, and saves work/body.blend.
#
# Every attempt to load MPFB is recorded (with its error) in report/probe.json.
# Run:  blender -b --factory-startup -noaudio --python-exit-code 1 -P tools/bake/probe_mpfb.py -- \
#         --out .out/bake --assets-zip <makehuman_system_assets_cc0.zip> --mpfb-zip <mpfb.zip>

import importlib
import os
import sys
import traceback
import zipfile

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

T = C.Timer()
REPORT = {"route": None, "attempts": [], "blender": bpy.app.version_string}

MODULE_CANDIDATES = ["bl_ext.user_default.mpfb", "bl_ext.tcw_local.mpfb"]

# The default MakeHuman rig, mapped to the abstract joints poses.py uses.
# Two-bone segments list [first, last]: the segment runs from first.head to last.tail.
MH_DEFAULT_RIGMAP = {
    "root": "root",
    "spine": ["spine05", "spine04", "spine03", "spine02", "spine01"],
    "neck": ["neck01", "neck02", "neck03"],
    "head": "head",
    "hip_anchor": "spine05",
    "chest": "spine03",
    "side": {
        "L": {"clavicle": "clavicle.L", "upper": ["upperarm01.L", "upperarm02.L"],
              "lower": ["lowerarm01.L", "lowerarm02.L"], "hand": "wrist.L",
              "thigh": ["upperleg01.L", "upperleg02.L"], "shin": ["lowerleg01.L", "lowerleg02.L"],
              "foot": "foot.L",
              "fingers": [["finger1-1.L", "finger1-2.L", "finger1-3.L"],
                          ["finger2-1.L", "finger2-2.L", "finger2-3.L"],
                          ["finger3-1.L", "finger3-2.L", "finger3-3.L"],
                          ["finger4-1.L", "finger4-2.L", "finger4-3.L"],
                          ["finger5-1.L", "finger5-2.L", "finger5-3.L"]]},
        "R": {"clavicle": "clavicle.R", "upper": ["upperarm01.R", "upperarm02.R"],
              "lower": ["lowerarm01.R", "lowerarm02.R"], "hand": "wrist.R",
              "thigh": ["upperleg01.R", "upperleg02.R"], "shin": ["lowerleg01.R", "lowerleg02.R"],
              "foot": "foot.R",
              "fingers": [["finger1-1.R", "finger1-2.R", "finger1-3.R"],
                          ["finger2-1.R", "finger2-2.R", "finger2-3.R"],
                          ["finger3-1.R", "finger3-2.R", "finger3-3.R"],
                          ["finger4-1.R", "finger4-2.R", "finger4-3.R"],
                          ["finger5-1.R", "finger5-2.R", "finger5-3.R"]]},
    },
}

# Placeholder body build for a Union infantry private (Inferred / placeholder estimate, no
# source cited here): adult male, lean. MPFB macro values are 0..1 sliders.
MACROS = {"gender": 1.0, "age": 0.5, "muscle": 0.55, "weight": 0.42, "height": 0.5}

SKIN_CANDIDATES = ["young_caucasian_male.mhmat", "middleage_caucasian_male.mhmat",
                   "default.mhmat"]


def attempt(name, fn):
    t = C.time.time()
    try:
        result = fn()
        REPORT["attempts"].append({"name": name, "ok": True, "seconds": round(C.time.time() - t, 2),
                                   "result": str(result)[:300]})
        C.log("attempt OK:", name, result)
        return True, result
    except Exception as e:  # noqa: BLE001 - every failure is the evidence we want
        REPORT["attempts"].append({"name": name, "ok": False, "seconds": round(C.time.time() - t, 2),
                                   "error": "%s: %s" % (type(e).__name__, e),
                                   "trace": traceback.format_exc()[-1500:]})
        C.log("attempt FAILED:", name, e)
        return False, None


def mpfb_loaded():
    for m in sys.modules:
        if m.endswith("mpfb.services.humanservice"):
            return m
    return None


def dyn(absolute, key):
    for amod in list(sys.modules):
        if amod.endswith(absolute):
            return getattr(importlib.import_module(amod), key)
    raise ValueError("no module ending in " + absolute)


def enable_module(mod):
    import addon_utils
    addon_utils.enable(mod, default_set=True, persistent=True, handle_error=None)
    if mod not in bpy.context.preferences.addons:
        raise RuntimeError("addon_utils.enable returned but %s is not in preferences.addons" % mod)
    if not mpfb_loaded():
        raise RuntimeError("enabled but mpfb.services.humanservice not imported")
    return mod


def list_repos():
    out = []
    try:
        for r in bpy.context.preferences.extensions.repos:
            out.append({"name": r.name, "module": r.module, "dir": r.directory,
                        "enabled": r.enabled, "source": getattr(r, "source", "?")})
    except Exception as e:  # noqa: BLE001
        out.append({"error": str(e)})
    return out


def load_mpfb():
    REPORT["repos_before"] = list_repos()
    # A1: the workflow installed it with `blender -c extension install-file -r user_default`.
    ok, _ = attempt("A1 enable bl_ext.user_default.mpfb (installed by CLI)",
                    lambda: enable_module("bl_ext.user_default.mpfb"))
    if ok:
        return "bl_ext.user_default.mpfb"
    # A2: install from the zip through the extensions operator, into user_default.
    zip_path = C.arg("mpfb-zip", "")
    if zip_path and os.path.exists(zip_path):
        def a2():
            r = bpy.ops.extensions.package_install_files(filepath=zip_path, repo="user_default",
                                                         enable_on_install=True)
            return enable_module("bl_ext.user_default.mpfb") + " " + str(r)
        ok, _ = attempt("A2 bpy.ops.extensions.package_install_files", a2)
        if ok:
            return "bl_ext.user_default.mpfb"
    # A3: register a local repo that points at an unpacked copy and enable from there.
    src = C.arg("mpfb-src", "")
    if src and os.path.isdir(src):
        def a3():
            parent = os.path.join(C.WORK, "ext_repo")
            os.makedirs(parent, exist_ok=True)
            link = os.path.join(parent, "mpfb")
            if not os.path.exists(link):
                os.symlink(os.path.abspath(src), link)
            repos = bpy.context.preferences.extensions.repos
            if "tcw_local" not in [r.module for r in repos]:
                r = repos.new(name="tcw_local", module="tcw_local", custom_directory=parent, source="USER")
                r.enabled = True
            try:
                bpy.ops.extensions.repo_refresh_all()
            except Exception as e:  # noqa: BLE001
                C.log("repo_refresh_all:", e)
            return enable_module("bl_ext.tcw_local.mpfb")
        ok, _ = attempt("A3 local extension repo + addon_utils.enable", a3)
        if ok:
            return "bl_ext.tcw_local.mpfb"
    return None


def install_assets(LocationService, AssetService):
    zip_path = C.arg("assets-zip", "")
    data_dir = LocationService.get_user_data()
    REPORT["mpfb_user_data"] = data_dir
    found = AssetService.find_asset_absolute_path(SKIN_CANDIDATES[0], asset_subdir="skins")
    if found:
        return "already present"
    if not (zip_path and os.path.exists(zip_path)):
        raise RuntimeError("asset zip missing: %r" % zip_path)
    # Same as MPFB's own "Load pack from zip file" operator (ui/.../loadpack.py).
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(data_dir)
    AssetService.update_all_asset_lists()
    return "extracted %s into %s" % (os.path.basename(zip_path), data_dir)


EYES_CANDIDATES = ["high-poly.mhclo", "low-poly.mhclo"]


def heads_table():
    """HEADS / EXPR / HEAD_DEFAULT from the table at the top of uniform.py (read as literals with
    ast, so the table lives in one place and uniform.py is not executed here)."""
    import ast
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "uniform.py")).read()
    out = {}
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            name = getattr(node.targets[0], "id", None)
            if name in ("HEADS", "EXPR", "HEAD_DEFAULT"):
                out[name] = ast.literal_eval(node.value)
    return out


def find_asset(AssetService, fname, subdir, roots=()):
    p = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
    if p:
        return p
    for root in roots:
        for dp, _dn, fns in os.walk(root):
            if fname in fns:
                return os.path.join(dp, fname)
    return None


def build_heads(HumanService, TargetService, AssetService, LocationService, body):
    """Third pass: the head presets of uniform.py HEADS. Each preset is
      - one shape key on the body, tcw_head_<name>: the weighted sum of its CC0 face-shape
        targets and the CC0 expression-unit targets (EXPR x expr_scale), relative to the basis;
      - its own CC0 eyes, eyebrows, eyelashes, hair and (bodyparts05, CC0) beard proxies, fitted
        by MPFB while that shape key is on, tagged tcw_head=<name> and tcw_role=<part>;
      - copies of every body material slot after MPFB applies its CC0 skin (tcw_skin_<name>_<i>).
    render.py turns one preset on per variant. Failures are recorded per part, never fatal."""
    import numpy as np
    tab = heads_table()
    HEADS, EXPR = tab["HEADS"], tab["EXPR"]
    default = tab.get("HEAD_DEFAULT") or list(HEADS)[0]
    rep = REPORT.setdefault("heads", {})
    REPORT["heads_default"] = default
    data_root = LocationService.get_user_data()
    tdir = LocationService.get_mpfb_data("targets")
    # beard pack (CC0): unzip into the same user data dir, refresh the lists
    zp = C.arg("beard-zip", "")
    if zp and os.path.exists(zp):
        def unpack():
            with zipfile.ZipFile(zp) as z:
                names = z.namelist()
                z.extractall(data_root)
            AssetService.update_all_asset_lists()
            return [n for n in names if n.endswith(".mhclo")][:20]
        ok, res = attempt("unpack beard pack " + os.path.basename(zp), unpack)
        REPORT["beard_pack_mhclo"] = res
    listing = {}
    for sub in ("hair", "skins", "eyebrows", "eyelashes", "eyes"):
        try:
            fn = AssetService.list_mhmat_assets if sub == "skins" else AssetService.list_mhclo_assets
            listing[sub] = sorted(os.path.basename(str(p)) for p in fn(sub))[:80]
        except Exception as e:  # noqa: BLE001
            listing[sub] = "list failed: %s" % e
    REPORT["asset_listing"] = listing
    # material slot roles, from MPFB's own slot names (Human.lips, Human.fingernails, ...)
    roles = []
    for i, s in enumerate(body.material_slots):
        nm = s.material.name if s.material else ""
        roles.append("skin" if i == 0 else nm.split(".")[-1].lower())
    body["tcw_slot_roles"] = C.json.dumps(roles)
    REPORT["slot_roles"] = roles
    # ---- shape keys: one per preset
    keys = body.data.shape_keys
    basis = keys.reference_key
    n = len(body.data.vertices)
    base = np.empty(n * 3, dtype=np.float64)
    basis.data.foreach_get("co", base)
    cache = {}

    def delta(tname, race):
        unit = tname in EXPR
        ck = (tname, race if unit else "")
        if ck in cache:
            return cache[ck]
        if unit:
            path = os.path.join(tdir, "expression", "units", race, tname + ".target.gz")
        else:
            path = TargetService.target_full_path(tname)
        if not path or not os.path.exists(path):
            cache[ck] = None
            return None
        sk = TargetService.load_target(body, path, weight=0.0, name="tcw_tmp_target")
        arr = np.empty(n * 3, dtype=np.float64)
        sk.data.foreach_get("co", arr)
        body.shape_key_remove(sk)
        cache[ck] = arr - base
        return cache[ck]

    for h, cfg in HEADS.items():
        r = rep.setdefault(h, {"label": cfg.get("label"), "use": cfg.get("use"), "missing": []})
        tot = np.zeros(n * 3, dtype=np.float64)
        applied = {}
        weights = dict(cfg.get("targets", {}))
        for k, w in EXPR.items():
            weights[k] = w * cfg.get("expr_scale", 1.0)
        for tname, w in weights.items():
            try:
                d = delta(tname, cfg.get("race", "caucasian"))
            except Exception as e:  # noqa: BLE001
                r["missing"].append("%s: %s" % (tname, e))
                continue
            if d is None:
                r["missing"].append(tname + ": not found")
                continue
            tot += w * d
            applied[tname] = round(w, 3)
        sk = body.shape_key_add(name="tcw_head_" + h, from_mix=False)
        sk.data.foreach_set("co", base + tot)
        sk.relative_key = basis
        sk.value = 0.0
        r["targets_applied"] = applied
        r["max_offset_m"] = round(float(np.abs(tot).max()), 4)
    # ---- per preset: skin copies and fitted proxies
    out = {}
    roots = [data_root, os.path.join(data_root, "clothes")]
    for h, cfg in HEADS.items():
        r = rep[h]
        for k in body.data.shape_keys.key_blocks:
            if k.name.startswith("tcw_head_"):
                k.value = 1.0 if k.name == "tcw_head_" + h else 0.0
        C.update()
        rec = {"key": "tcw_head_" + h, "skins": [], "objects": []}
        sp = find_asset(AssetService, cfg["skin"], "skins")
        if sp:
            ok, _ = attempt("skin %s %s" % (h, cfg["skin"]),
                            lambda sp=sp: HumanService.set_character_skin(sp, body, skin_type="MAKESKIN"))
            for i, s in enumerate(body.material_slots):
                if s.material is None:
                    rec["skins"].append(None)
                    continue
                cp = s.material.copy()
                cp.name = "tcw_skin_%s_%d" % (h, i)
                cp.use_fake_user = True
                rec["skins"].append(cp.name)
            r["skin"] = os.path.basename(sp) if ok else "FAILED " + cfg["skin"]
        else:
            r["missing"].append("skin " + cfg["skin"])
        parts = [("eyes", "eyes", EYES_CANDIDATES, "Eyes"), ("brows", "eyebrows", [cfg.get("brows")], "Eyebrows"),
                 ("lashes", "eyelashes", [cfg.get("lashes")], "Eyelashes"), ("hair", "hair", [cfg.get("hair")], "Hair"),
                 ("beard", "clothes", [cfg.get("beard")], "Clothes")]
        for role, sub, cands, atype in parts:
            p = None
            for fname in cands:
                if fname:
                    p = find_asset(AssetService, fname, sub, roots if role == "beard" else ())
                    if p:
                        break
            if not p:
                if any(cands):
                    r["missing"].append("%s %s" % (role, cands))
                continue
            ok, obj = attempt("head %s %s %s" % (h, role, os.path.basename(p)),
                              lambda p=p, atype=atype: HumanService.add_mhclo_asset(
                                  p, body, asset_type=atype, subdiv_levels=0, material_type="MAKESKIN"))
            if ok and obj is not None:
                obj.name = "hd_%s_%s" % (h, role)
                obj["tcw_head"] = h
                obj["tcw_role"] = role
                obj.hide_render = h != default
                rec["objects"].append(obj.name)
                r[role] = os.path.basename(p)
        out[h] = rec
    # ---- leave the default preset on
    for k in body.data.shape_keys.key_blocks:
        if k.name.startswith("tcw_head_"):
            k.value = 1.0 if k.name == "tcw_head_" + default else 0.0
    for i, mname in enumerate(out.get(default, {}).get("skins", [])):
        if mname and i < len(body.material_slots):
            body.material_slots[i].material = bpy.data.materials[mname]
    body["tcw_heads"] = C.json.dumps(out)
    body["tcw_head_default"] = default
    REPORT["body_modifiers_after_heads"] = [(m.name, m.type) for m in body.modifiers]
    return out


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    T.mark("start")
    mod = load_mpfb()
    T.mark("mpfb load")
    if not mod:
        REPORT["route"] = "FAILED"
        C.write_report("probe", REPORT)
        raise SystemExit("MPFB2 could not be loaded headless; see report/probe.json attempts")
    REPORT["mpfb_module"] = mod

    HumanService = dyn("mpfb.services.humanservice", "HumanService")
    TargetService = dyn("mpfb.services.targetservice", "TargetService")
    LocationService = dyn("mpfb.services.locationservice", "LocationService")
    AssetService = dyn("mpfb.services.assetservice", "AssetService")

    ok, res = attempt("install CC0 system asset pack", lambda: install_assets(LocationService, AssetService))
    T.mark("asset pack")

    macros = TargetService.get_default_macro_info_dict()
    REPORT["default_macros"] = {k: v for k, v in macros.items()}
    for k, v in MACROS.items():
        if k in macros:
            macros[k] = v
    t = C.time.time()
    body = HumanService.create_human(macro_detail_dict=macros)
    REPORT["create_human_seconds"] = round(C.time.time() - t, 2)
    T.mark("create_human")

    t = C.time.time()
    rig = HumanService.add_builtin_rig(body, "default")
    REPORT["add_rig_seconds"] = round(C.time.time() - t, 2)
    T.mark("add_builtin_rig")

    skin = None
    for name in SKIN_CANDIDATES:
        p = AssetService.find_asset_absolute_path(name, asset_subdir="skins")
        if p:
            skin = p
            break
    if skin:
        ok, _ = attempt("set_character_skin " + os.path.basename(skin),
                        lambda: HumanService.set_character_skin(skin, body, skin_type="MAKESKIN"))
        REPORT["skin"] = skin if ok else None
    else:
        REPORT["skin"] = None
        REPORT["skins_seen"] = "none of %s" % SKIN_CANDIDATES
    T.mark("skin")

    # third pass: every head preset (eyes, brows, lashes, hair, beard, skin, face shape) is built
    # by build_heads; the second pass's single proxy set and "face2" are gone
    ok, heads = attempt("build head presets", lambda: build_heads(HumanService, TargetService, AssetService,
                                                                  LocationService, body))
    proxies = [o for rec in (heads or {}).values() for o in rec.get("objects", [])]
    T.mark("head presets")

    # ---- facts about the result
    C.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    zs = [ (ev.matrix_world @ v.co).z for v in me.vertices]
    REPORT["body"] = {
        "object": body.name,
        "vertices_total_with_helpers": len(body.data.vertices),
        "faces_total_with_helpers": len(body.data.polygons),
        "vertices_visible_evaluated": len(me.vertices),
        "faces_visible_evaluated": len(me.polygons),
        "height_m": round(max(zs) - min(zs), 4),
        "min_z": round(min(zs), 4),
        "modifiers": [(m.name, m.type) for m in body.modifiers],
        "vertex_groups": len(body.vertex_groups),
        "shape_keys": len(body.data.shape_keys.key_blocks) if body.data.shape_keys else 0,
        "materials": [m.name for m in body.data.materials if m],
    }
    ev.to_mesh_clear()
    REPORT["rig"] = {"object": rig.name, "bones": len(rig.data.bones),
                     "matrix_world_is_identity": rig.matrix_world == C.Matrix(),
                     "rotation_mode_sample": rig.pose.bones[0].rotation_mode}
    REPORT["proxies"] = proxies
    missing = []
    rm = MH_DEFAULT_RIGMAP
    names = [rm["root"], rm["head"]] + rm["spine"] + rm["neck"]
    for s in ("L", "R"):
        d = rm["side"][s]
        names += [d["clavicle"], d["hand"], d["foot"]] + d["upper"] + d["lower"] + d["thigh"] + d["shin"]
        for chain in d["fingers"]:
            names += chain
    for n in names:
        if n not in rig.data.bones:
            missing.append(n)
    REPORT["rigmap_missing_bones"] = missing
    for b in ("root", "spine05", "head", "upperarm01.L", "lowerarm01.L", "wrist.L",
              "upperleg01.L", "lowerleg01.L", "foot.L"):
        if b in rig.data.bones:
            bb = rig.data.bones[b]
            REPORT.setdefault("bone_samples", {})[b] = {
                "head": [round(x, 4) for x in bb.head_local], "tail": [round(x, 4) for x in bb.tail_local]}

    scene = bpy.context.scene
    scene["tcw_rig"] = rig.name
    scene["tcw_body"] = body.name
    scene["tcw_rigmap"] = C.json.dumps(rm)
    scene["tcw_route"] = "mpfb2"
    REPORT["route"] = "mpfb2-headless"
    try:
        bpy.ops.file.pack_all()
    except Exception as e:  # noqa: BLE001
        REPORT["pack_all_error"] = str(e)
    path = os.path.join(C.WORK, "body.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=False)
    REPORT["blend_bytes"] = os.path.getsize(path)
    T.mark("saved body.blend")
    REPORT["timing"] = T.marks
    C.write_report("probe", REPORT)


main()
