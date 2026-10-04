# STACK-LAW EXCEPTION (AGENTS.md section 2): this file is Python ONLY because it runs inside
# Blender's bundled interpreter on GitHub Actions (bake leg). Nothing here ships in the game,
# and no orchestration outside Blender is written in Python (that is Node .mjs).
#
# Shared helpers for the bake scripts: argument parsing, output paths, JSON reports,
# mesh/rig math. Imported by probe_mpfb.py, uniform.py, poses.py and render.py.

import bpy
import json
import math
import os
import sys
import time

from mathutils import Matrix, Quaternion, Vector

# ---------------------------------------------------------------- arguments and paths


def args():
    """Parse `--key value` / `--flag` pairs that follow Blender's own `--` separator."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            key = a[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 2
            else:
                out[key] = "1"
                i += 1
        else:
            i += 1
    return out


ARGS = args()
OUT = os.path.abspath(ARGS.get("out") or os.environ.get("BAKE_OUT") or ".out/bake")
WORK = os.path.join(OUT, "work")
REPORT = os.path.join(OUT, "report")
for _d in (OUT, WORK, REPORT):
    os.makedirs(_d, exist_ok=True)


def arg(key, default):
    v = ARGS.get(key)
    if v is None:
        return default
    if isinstance(default, bool):
        return v not in ("0", "false", "no")
    if isinstance(default, int):
        return int(float(v))
    if isinstance(default, float):
        return float(v)
    return v


def log(*parts):
    print("[bake]", *parts, flush=True)


def write_report(stage, data):
    path = os.path.join(REPORT, stage + ".json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    log("wrote", path)
    return path


def read_report(stage):
    path = os.path.join(REPORT, stage + ".json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


class Timer:
    def __init__(self):
        self.t0 = time.time()
        self.marks = {}

    def mark(self, name):
        self.marks[name] = round(time.time() - self.t0, 3)
        log("t+%.1fs" % self.marks[name], name)
        return self.marks[name]


# ---------------------------------------------------------------- scene helpers


def update():
    bpy.context.view_layer.update()


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name, verts, faces, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    obj = bpy.data.objects.new(name, me)
    link(obj)
    return obj


def find_rig():
    name = bpy.context.scene.get("tcw_rig")
    if name and name in bpy.data.objects:
        return bpy.data.objects[name]
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            return o
    raise RuntimeError("no armature in scene")


def find_body():
    name = bpy.context.scene.get("tcw_body")
    if name and name in bpy.data.objects:
        return bpy.data.objects[name]
    raise RuntimeError("no tcw_body recorded on the scene")


def rigmap():
    return json.loads(bpy.context.scene["tcw_rigmap"])


# ---------------------------------------------------------------- colour and materials


def srgb_to_linear(c):
    c = c / 255.0 if c > 1.0 else c
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def _set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def material(name, hex_colour, roughness=0.8, metallic=0.0, sheen=0.0, mottle=0.0,
             mottle_scale=6.0, bump=0.0, bump_scale=300.0, grain=0.0):
    """Principled material with optional large-scale colour mottling (wear, fading),
    a fine fabric bump, and a wood-grain band texture along local Z (grain>0)."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    base = hex_rgb(hex_colour)
    _set_input(bsdf, ["Base Color"], (*base, 1.0))
    _set_input(bsdf, ["Roughness"], roughness)
    _set_input(bsdf, ["Metallic"], metallic)
    if sheen > 0:
        _set_input(bsdf, ["Sheen Weight", "Sheen"], sheen)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    if mottle > 0 or grain > 0:
        # colour variation: base * (1 +/- mottle) driven by a noise or wave texture
        if grain > 0:
            tex = nt.nodes.new("ShaderNodeTexWave")
            tex.wave_type = "BANDS"
            tex.bands_direction = "Z"
            tex.inputs["Scale"].default_value = 18.0
            tex.inputs["Distortion"].default_value = 6.0
            tex.inputs["Detail"].default_value = 3.0
            amount = grain
        else:
            tex = nt.nodes.new("ShaderNodeTexNoise")
            tex.inputs["Scale"].default_value = mottle_scale
            tex.inputs["Detail"].default_value = 4.0
            amount = mottle
        nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        lo = tuple(max(0.0, c * (1.0 - amount)) for c in base)
        hi = tuple(min(1.0, c * (1.0 + amount)) for c in base)
        ramp.color_ramp.elements[0].color = (*lo, 1.0)
        ramp.color_ramp.elements[1].color = (*hi, 1.0)
        nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    if bump > 0:
        n2 = nt.nodes.new("ShaderNodeTexNoise")
        n2.inputs["Scale"].default_value = bump_scale
        n2.inputs["Detail"].default_value = 2.0
        nt.links.new(coord.outputs["Object"], n2.inputs["Vector"])
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = bump
        bp.inputs["Distance"].default_value = 0.002
        nt.links.new(n2.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ---------------------------------------------------------------- procedural cloth/leather/wood
#
# All textures are procedural (no image files, no external assets). They read the garment's
# REST position from the point attribute "tcw_rest" (metres), so the pattern sticks to the cloth
# while the armature deforms it (Object coordinates would swim from frame to frame).
# Per-vertex float attributes written by uniform.py drive the weathering:
#   tcw_dirt   0..1 dust and mud (lower trousers, shoes, cuffs)
#   tcw_wear   0..1 sun fading / rubbing (shoulders, knees, edges)
#   tcw_cavity 0..1 fold creases (darkened a little; dirt collects there)


def _sock(nt, socket, value):
    if hasattr(value, "is_output"):
        nt.links.new(value, socket)
    else:
        socket.default_value = value


def node_math(nt, op, a, b=0.0, clamp=False):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    m.use_clamp = clamp
    _sock(nt, m.inputs[0], a)
    _sock(nt, m.inputs[1], b)
    return m.outputs[0]


def node_mix(nt, blend, fac, a, b):
    """Colour mix (ShaderNodeMix in RGBA mode; legacy MixRGB if that is unavailable)."""
    try:
        m = nt.nodes.new("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = blend
        m.clamp_result = True
        f_in = m.inputs["Factor"]
        a_in = [s for s in m.inputs if s.name == "A" and s.type == "RGBA"][0]
        b_in = [s for s in m.inputs if s.name == "B" and s.type == "RGBA"][0]
        out = [s for s in m.outputs if s.type == "RGBA"][0]
    except Exception:  # noqa: BLE001
        m = nt.nodes.new("ShaderNodeMixRGB")
        m.blend_type = blend
        f_in, a_in, b_in, out = m.inputs["Fac"], m.inputs["Color1"], m.inputs["Color2"], m.outputs["Color"]
    _sock(nt, f_in, fac)
    _sock(nt, a_in, a if not isinstance(a, tuple) or len(a) == 4 else (*a, 1.0))
    _sock(nt, b_in, b if not isinstance(b, tuple) or len(b) == 4 else (*b, 1.0))
    return out


def node_noise(nt, vec, scale, detail=2.0, rough=0.5):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    if "Roughness" in n.inputs:
        n.inputs["Roughness"].default_value = rough
    nt.links.new(vec, n.inputs["Vector"])
    return n.outputs["Fac"]


def node_ramp(nt, fac, lo_pos, hi_pos, lo=(0, 0, 0, 1), hi=(1, 1, 1, 1)):
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.color_ramp.elements[0].position = lo_pos
    r.color_ramp.elements[1].position = hi_pos
    r.color_ramp.elements[0].color = lo
    r.color_ramp.elements[1].color = hi
    nt.links.new(fac, r.inputs["Fac"])
    return r


def node_attr(nt, name, out="Fac"):
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_type = "GEOMETRY"
    a.attribute_name = name
    return a.outputs[out]


def weathered_material(name, hex_colour, roughness=0.9, kind="wool", fade_hex=None, fade=0.0,
                       dust_hex="#8c7b5c", mud_hex="#4b3b27", mottle=0.08, sheen=0.0,
                       weave_scale=300.0, bump=0.3, metallic=0.0, edge_wear_hex=None):
    """Principled material with procedural colour variation, fading, dust/mud and fine relief.
    kind: "wool" (felted nap + diagonal twill), "leather" (pebbled grain, edge wear from
    pointiness), "canvas" (plain weave), "wood" (grain bands along local Z), "metal"."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    base = hex_rgb(hex_colour)
    rest = node_attr(nt, "tcw_rest", "Vector")
    dirt = node_attr(nt, "tcw_dirt")
    wear = node_attr(nt, "tcw_wear")
    cav = node_attr(nt, "tcw_cavity")
    # large-scale mottling: dyed wool and leather are never one flat colour
    lo = tuple(max(0.0, c * (1.0 - mottle)) for c in base)
    hi = tuple(min(1.0, c * (1.0 + mottle)) for c in base)
    col = node_ramp(nt, node_noise(nt, rest, 2.5, 3.0), 0.3, 0.7, (*lo, 1), (*hi, 1)).outputs["Color"]
    # fine fleck (fibre / grain)
    fl = node_ramp(nt, node_noise(nt, rest, 420.0 if kind != "wood" else 60.0, 1.0), 0.25, 0.75,
                   (0.93, 0.93, 0.93, 1), (1.07, 1.07, 1.07, 1)).outputs["Color"]
    col = node_mix(nt, "MULTIPLY", 1.0, col, fl)
    if kind == "wood":
        wv = nt.nodes.new("ShaderNodeTexWave")
        wv.wave_type = "BANDS"
        wv.bands_direction = "Z"
        wv.inputs["Scale"].default_value = 9.0
        wv.inputs["Distortion"].default_value = 7.0
        wv.inputs["Detail"].default_value = 3.0
        coord = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(coord.outputs["Object"], wv.inputs["Vector"])
        g = node_ramp(nt, wv.outputs["Fac"], 0.2, 0.9, (0.70, 0.66, 0.62, 1), (1.12, 1.1, 1.08, 1)).outputs["Color"]
        col = node_mix(nt, "MULTIPLY", 1.0, col, g)
    # fading (sun and rubbing): toward a lighter, greyer shade, patchy
    if fade_hex and fade > 0:
        patch = node_noise(nt, rest, 9.0, 2.0)
        wf = node_math(nt, "MULTIPLY", wear, patch)
        wf = node_math(nt, "MULTIPLY", wf, 2.0 * fade, clamp=True)
        col = node_mix(nt, "MIX", wf, col, (*hex_rgb(fade_hex), 1.0))
    # edge wear on leather (pointiness: convex edges get scuffed lighter)
    if edge_wear_hex:
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        pr = node_ramp(nt, geo.outputs["Pointiness"], 0.53, 0.62, (0, 0, 0, 1), (1, 1, 1, 1)).outputs["Color"]
        ew = node_math(nt, "MULTIPLY", pr, 0.55)
        col = node_mix(nt, "MIX", ew, col, (*hex_rgb(edge_wear_hex), 1.0))
        col = node_mix(nt, "MIX", node_math(nt, "MULTIPLY", wear, 0.5), col, (*hex_rgb(edge_wear_hex), 1.0))
    # dust: patchy, follows the dirt attribute
    dn = node_ramp(nt, node_noise(nt, rest, 14.0, 3.0), 0.35, 0.65).outputs["Color"]
    dfac = node_math(nt, "MULTIPLY", dirt, dn)
    col = node_mix(nt, "MIX", node_math(nt, "MULTIPLY", dfac, 0.75, clamp=True), col, (*hex_rgb(dust_hex), 1.0))
    # mud: only where dirt is high, in splashes
    mn = node_ramp(nt, node_noise(nt, rest, 26.0, 2.0), 0.48, 0.62).outputs["Color"]
    mfac = node_math(nt, "MULTIPLY", node_math(nt, "SUBTRACT", node_math(nt, "MULTIPLY", dirt, 2.5), 1.4,
                                               clamp=True), mn)
    col = node_mix(nt, "MIX", node_math(nt, "MULTIPLY", mfac, 0.85, clamp=True), col, (*hex_rgb(mud_hex), 1.0))
    # creases a little darker
    col = node_mix(nt, "MULTIPLY", node_math(nt, "MULTIPLY", cav, 0.5, clamp=True), col, (0.55, 0.55, 0.6, 1.0))
    nt.links.new(col, bsdf.inputs["Base Color"])
    rough = node_math(nt, "ADD", roughness, node_math(nt, "MULTIPLY", dirt, 0.12), clamp=True)
    nt.links.new(rough, bsdf.inputs["Roughness"])
    _set_input(bsdf, ["Metallic"], metallic)
    if sheen > 0:
        _set_input(bsdf, ["Sheen Weight", "Sheen"], sheen)
        _set_input(bsdf, ["Sheen Roughness"], 0.45)
    # relief
    if bump > 0:
        if kind == "wool":
            tw = nt.nodes.new("ShaderNodeTexWave")
            tw.wave_type = "BANDS"
            tw.bands_direction = "DIAGONAL"
            tw.inputs["Scale"].default_value = weave_scale
            nt.links.new(rest, tw.inputs["Vector"])
            h = node_math(nt, "ADD", node_math(nt, "MULTIPLY", tw.outputs["Fac"], 0.35),
                          node_noise(nt, rest, 160.0, 3.0))
        elif kind == "canvas":
            tw = nt.nodes.new("ShaderNodeTexChecker")
            tw.inputs["Scale"].default_value = weave_scale
            nt.links.new(rest, tw.inputs["Vector"])
            h = node_math(nt, "ADD", node_math(nt, "MULTIPLY", tw.outputs["Fac"], 0.3),
                          node_noise(nt, rest, 90.0, 3.0))
        elif kind == "leather":
            vor = nt.nodes.new("ShaderNodeTexVoronoi")
            vor.inputs["Scale"].default_value = 260.0
            nt.links.new(rest, vor.inputs["Vector"])
            h = node_math(nt, "ADD", vor.outputs["Distance"], node_noise(nt, rest, 40.0, 3.0))
        else:
            h = node_noise(nt, rest, 120.0, 2.0)
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = bump
        bp.inputs["Distance"].default_value = 0.0008
        nt.links.new(h, bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def stamp_attrs(obj, rest=None, dirt=None, wear=None, cavity=None):
    """Write the per-vertex attributes the weathered materials read. rest defaults to the mesh's
    own vertex positions in world space (correct for objects built in world rest space)."""
    me = obj.data
    n = len(me.vertices)
    if rest is None:
        mw = obj.matrix_world
        rest = [mw @ v.co for v in me.vertices]
    flat = []
    for p in rest:
        flat.extend((p[0], p[1], p[2]))
    a = me.attributes.get("tcw_rest") or me.attributes.new("tcw_rest", "FLOAT_VECTOR", "POINT")
    a.data.foreach_set("vector", flat)
    for key, vals in (("tcw_dirt", dirt), ("tcw_wear", wear), ("tcw_cavity", cavity)):
        if vals is None:
            continue
        if not hasattr(vals, "__len__"):
            vals = [float(vals)] * n
        a = me.attributes.get(key) or me.attributes.new(key, "FLOAT", "POINT")
        a.data.foreach_set("value", [float(x) for x in vals])


def smoothstep(a, b, x):
    if a == b:
        return 1.0 if x >= b else 0.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def crease(x):
    """Cloth fold profile: rounded bulges, sharp creases, zero mean."""
    return abs(math.sin(math.pi * x)) - 0.6366


# ---------------------------------------------------------------- geometry helpers


def ring(center, u, v, ru, rv, n, phase=0.0):
    return [center + u * (ru * math.cos(phase + 2 * math.pi * i / n)) +
            v * (rv * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]


def loft(rings, closed=True, cap_start=True, cap_end=True):
    """Join rings (equal vertex counts) into a tube; caps are fans to a centre vertex."""
    verts, faces = [], []
    n = len(rings[0])
    for r in rings:
        verts.extend(r)
    seg = n if closed else n - 1
    for k in range(len(rings) - 1):
        a, b = k * n, (k + 1) * n
        for i in range(seg):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    if cap_start:
        c = len(verts)
        verts.append(sum(rings[0], Vector()) / n)
        for i in range(seg):
            faces.append((c, (i + 1) % n, i))
    if cap_end:
        c = len(verts)
        verts.append(sum(rings[-1], Vector()) / n)
        base = (len(rings) - 1) * n
        for i in range(seg):
            faces.append((c, base + i, base + (i + 1) % n))
    return verts, faces


def box(center, axes, half):
    """Oriented box: axes = (ax, ay, az) unit vectors, half = (hx, hy, hz)."""
    ax, ay, az = axes
    hx, hy, hz = half
    verts = []
    for sz in (-1, 1):
        for sy in (-1, 1):
            for sx in (-1, 1):
                verts.append(center + ax * (sx * hx) + ay * (sy * hy) + az * (sz * hz))
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return verts, faces


def merge(parts):
    verts, faces = [], []
    for v, f in parts:
        o = len(verts)
        verts.extend(v)
        faces.extend(tuple(i + o for i in face) for face in f)
    return verts, faces


def add_modifier(obj, kind, name=None, **props):
    m = obj.modifiers.new(name or kind.title(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def parent_to_bone(obj, rig, bone_name):
    """Parent an object whose vertices are in world (rest) space to a bone, keeping it in place."""
    bone = rig.data.bones[bone_name]
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    tail_space = rig.matrix_world @ bone.matrix_local @ Matrix.Translation((0.0, bone.length, 0.0))
    obj.matrix_parent_inverse = tail_space.inverted()
    obj.matrix_basis = Matrix()


def rot(axis, deg):
    return Quaternion(Vector(axis).normalized(), math.radians(deg))
