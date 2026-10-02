// src/world/landscape.js: the 1861 farmland plan for the Henry House Hill to Matthews Hill slice.
//
// Pure data and deterministic generation (no three.js, no DOM) so tools can import it too.
// Real, sourced geometry: roads and streams (USGS, in the terrain asset), farm sites (PLAN.sites, cited in
// assets/scenarios/henry-hill.json). Illustrative, NOT sourced: the exact field parcel boundaries and crop
// colours (generated from a seeded patchwork aligned with the Warrenton Turnpike) and the precise edges of
// the woods (drawn from the period descriptions cited in PLAN.woodsNote). See DECISIONS.md 0004.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function valueNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Distance (m) to the nearest of a set of polylines, rasterised once on a coarse grid (O(1) lookups). */
export class LineField {
  constructor(half, lines, { cell = 4, maxDist = 40 } = {}) {
    this.half = half;
    this.cell = cell;
    this.n = Math.ceil((2 * half) / cell) + 1;
    this.maxDist = maxDist;
    const d = (this.d = new Float32Array(this.n * this.n).fill(maxDist));
    for (const line of lines) {
      const pts = line.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - maxDist + half) / cell));
        const x1 = Math.min(this.n - 1, Math.ceil((Math.max(ax, bx) + maxDist + half) / cell));
        const z0 = Math.max(0, Math.floor((Math.min(az, bz) - maxDist + half) / cell));
        const z1 = Math.min(this.n - 1, Math.ceil((Math.max(az, bz) + maxDist + half) / cell));
        const seg = [pts[i], pts[i + 1]];
        for (let gz = z0; gz <= z1; gz++) {
          for (let gx = x0; gx <= x1; gx++) {
            const v = distToPolyline(gx * cell - half, gz * cell - half, seg);
            const k = gz * this.n + gx;
            if (v < d[k]) d[k] = v;
          }
        }
      }
    }
  }

  dist(x, z) {
    const gx = Math.round((x + this.half) / this.cell);
    const gz = Math.round((z + this.half) / this.cell);
    if (gx < 0 || gz < 0 || gx >= this.n || gz >= this.n) return this.maxDist;
    return this.d[gz * this.n + gx];
  }
}

// ---------------------------------------------------------------------------------------------------
// The plan. Coordinates are local metres (+x east, +z south; origin 38.81825 N, 77.5225 W).
export const PLAN = {
  // Farm sites: position, building footprints (relative, metres), colour. Positions are cited in the
  // scenario file (sites[].source); buildings are generic period forms, not surveyed footprints.
  sites: [],
  woods: [],
  woodsNote: '',
  labels: [],
};

/** Install the sourced plan data from the scenario JSON (sites, woods, labels). */
export function setPlan(scenario) {
  PLAN.sites = scenario.sites || [];
  PLAN.woods = (scenario.woods || []).map((w) => w.polygon);
  PLAN.woodsNote = scenario.woodsNote || '';
  PLAN.labels = scenario.labels || [];
}

// ---------------------------------------------------------------------------------------------------
// Field parcels: a domain-warped patchwork of rows and columns aligned with the Warrenton Turnpike (the
// Sudley Road runs close to perpendicular to it, so one orientation suits both).
export class Parcels {
  constructor({ angle, seed = 1861, extent = 2200 }) {
    this.angle = angle;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    const rnd = mulberry32(seed);
    this.rowEdges = [];
    this.rowCols = [];
    let v = -extent;
    while (v < extent) {
      this.rowEdges.push(v);
      const cols = [];
      let u = -extent - rnd() * 300;
      while (u < extent) {
        cols.push(u);
        u += 110 + rnd() * 260;
      }
      cols.push(u);
      this.rowCols.push(cols);
      v += 90 + rnd() * 210;
    }
    this.rowEdges.push(v);
  }

  /** Parcel id, whether the point is within `edgeWidth` metres of a boundary, and that boundary's axis. */
  lookup(x, z, edgeWidth = 0) {
    const wx = x + (valueNoise(x * 0.0026 + 3.1, z * 0.0026) - 0.5) * 150 + (valueNoise(x * 0.011, z * 0.011 + 7) - 0.5) * 22;
    const wz = z + (valueNoise(x * 0.0026, z * 0.0026 - 5.3) - 0.5) * 150 + (valueNoise(x * 0.011 + 2, z * 0.011) - 0.5) * 22;
    const u = wx * this.cos + wz * this.sin;
    const v = -wx * this.sin + wz * this.cos;
    const rows = this.rowEdges;
    let lo = 0, hi = rows.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rows[mid] <= v) lo = mid; else hi = mid;
    }
    const cols = this.rowCols[lo];
    let a = 0, b = cols.length - 1;
    while (b - a > 1) {
      const mid = (a + b) >> 1;
      if (cols[mid] <= u) a = mid; else b = mid;
    }
    const dRow = Math.min(v - rows[lo], rows[lo + 1] - v);
    const dCol = Math.min(u - cols[a], cols[a + 1] - u);
    // axis 0: the nearest boundary runs along u (the turnpike direction); 1: across it.
    const dist = Math.min(dRow, dCol);
    return { id: lo * 1000 + a, edge: dist < edgeWidth, dist, axis: dRow < dCol ? 0 : 1 };
  }
}

// Field types and their painted colours (sRGB). Late July 1861: wheat already cut (golden stubble and
// shocks), corn tall and dark, oats ripening, most ground in pasture or hay meadow.
export const FIELD_TYPES = [
  { name: 'pasture', weight: 30, color: [86, 98, 42], stroke: 0.55 },
  { name: 'pasture-dark', weight: 22, color: [68, 80, 35], stroke: 0.5 },
  { name: 'meadow', weight: 14, color: [104, 110, 50], stroke: 0.8 },
  { name: 'hay', weight: 8, color: [136, 130, 62], stroke: 1.0 },
  { name: 'wheat-stubble', weight: 6, color: [192, 156, 62], stroke: 1.0 },
  { name: 'oats', weight: 4, color: [148, 136, 64], stroke: 1.0 },
  { name: 'corn', weight: 12, color: [56, 76, 31], stroke: 1.0 },
  { name: 'fallow', weight: 4, color: [114, 94, 58], stroke: 0.9 },
];
export function fieldTypeFor(id) {
  // total recomputed per call so the ?tune panel can change weights
  let r = hash2(id * 0.137 + 0.5, id * 0.071 + 9.2) * FIELD_TYPES.reduce((s, t) => s + t.weight, 0);
  for (const t of FIELD_TYPES) {
    if ((r -= t.weight) < 0) return t;
  }
  return FIELD_TYPES[0];
}

export function inWoods(x, z) {
  for (const poly of PLAN.woods) if (pointInPolygon(x, z, poly)) return true;
  return false;
}

/** Trees: woods fill, stream-bank rows, hedgerows on some field edges, lone field trees, orchards. */
export function placeTrees(terrain, streams, roadField, streamField, parcels, { seed = 21 } = {}) {
  const rnd = mulberry32(seed);
  const trees = []; // [x, z, radius, kind] kind 0 woods/deciduous, 1 pine, 2 orchard
  const half = terrain.half - 8;
  const nearRoad = (x, z, d) => roadField.dist(x, z) < d;
  const nearStream = (x, z, d) => streamField.dist(x, z) < d;
  const nearSite = (x, z, d) => PLAN.sites.some((s) => Math.hypot(s.x - x, s.z - z) < d);

  // Woods: jittered grid.
  const W = 10.5;
  for (let z = -half; z < half; z += W) {
    for (let x = -half; x < half; x += W) {
      const px = x + (rnd() - 0.5) * W * 0.9;
      const pz = z + (rnd() - 0.5) * W * 0.9;
      if (!inWoods(px, pz)) continue;
      if (nearRoad(px, pz, 9) || nearStream(px, pz, 3) || nearSite(px, pz, 45)) continue;
      const pine = valueNoise(px * 0.012, pz * 0.012) > 0.78;
      trees.push([px, pz, 6 + rnd() * 2.6, pine ? 1 : 0]);
    }
  }
  // Stream banks.
  for (const s of streams) {
    const pts = s.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / (len || 1), nz = (bx - ax) / (len || 1);
      for (let t = 0; t < len; t += 7 + rnd() * 9) {
        if (rnd() < 0.3) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const off = side * (7 + rnd() * 10);
        const x = ax + ((bx - ax) * t) / len + nx * off;
        const z = az + ((bz - az) * t) / len + nz * off;
        if (Math.abs(x) > half || Math.abs(z) > half || nearRoad(x, z, 8)) continue;
        trees.push([x, z, 4.2 + rnd() * 2.8, 0]);
      }
    }
  }
  // Hedgerow trees along about a third of the field edges, and lone trees.
  for (let i = 0; i < 16000; i++) {
    const x = (rnd() * 2 - 1) * half;
    const z = (rnd() * 2 - 1) * half;
    if (inWoods(x, z) || nearRoad(x, z, 8) || nearSite(x, z, 30)) continue;
    const p = parcels.lookup(x, z, 6);
    if (p.edge) {
      if (hash2(p.id, 3.3) < 0.5) trees.push([x, z, 3.8 + rnd() * 2.4, 0]);
    } else if (rnd() < 0.05) {
      trees.push([x, z, 4.5 + rnd() * 3, 0]);
    }
  }
  // Farms "embowered in trees" (the Robinson house): a loose ring of shade trees around the yard.
  for (const site of PLAN.sites) {
    if (!site.embowered) continue;
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + rnd() * 0.2;
      const r = 34 + rnd() * 16;
      trees.push([site.x + Math.cos(a) * r, site.z + Math.sin(a) * r, 5 + rnd() * 2.5, 0]);
    }
  }
  // Orchards at farms that have one (generic: a small grid of fruit trees beside the house).
  for (const s of PLAN.sites) {
    if (!s.orchard) continue;
    const [ox, oz, cols, rows, ang] = s.orchard;
    const c = Math.cos(ang), sn = Math.sin(ang);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const lx = (k - (cols - 1) / 2) * 11;
        const lz = (r - (rows - 1) / 2) * 11;
        trees.push([s.x + ox + lx * c - lz * sn, s.z + oz + lx * sn + lz * c, 2.7 + rnd() * 0.6, 2]);
      }
    }
  }
  return trees;
}

/** Rail-fence segments [x, z, angle, len] along both roads and along field edges near farms. */
export function placeFences(terrain, roads, parcels, { seed = 7 } = {}) {
  const rnd = mulberry32(seed);
  const segs = [];
  const half = terrain.half - 10;
  const SEG = 4.2; // one zig of a worm fence
  for (const r of roads) {
    const pts = r.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bz - az, bx - ax);
      const nx = -(bz - az) / (len || 1), nz = (bx - ax) / (len || 1);
      for (const side of [-1, 1]) {
        let k = 0;
        for (let t = 0; t < len; t += SEG * 0.92, k++) {
          if (valueNoise((ax + t) * 0.02, side * 10 + az * 0.02) < 0.28) continue; // gaps and gates
          const x = ax + ((bx - ax) * t) / len + nx * side * 7.5;
          const z = az + ((bz - az) * t) / len + nz * side * 7.5;
          if (Math.abs(x) > half || Math.abs(z) > half || inWoods(x, z)) continue;
          segs.push([x, z, ang + (k % 2 ? 0.32 : -0.32), SEG]);
        }
      }
    }
  }
  // Field-edge fences: random samples that land on a parcel edge near a farm get a segment along the edge.
  for (let i = 0; i < 26000; i++) {
    const x = (rnd() * 2 - 1) * half;
    const z = (rnd() * 2 - 1) * half;
    const near = PLAN.sites.some((s) => Math.hypot(s.x - x, s.z - z) < (s.fenceRadius || 0));
    if (!near || inWoods(x, z)) continue;
    const p = parcels.lookup(x, z, 2.2);
    if (!p.edge) continue;
    const ang = parcels.angle + (p.axis ? Math.PI / 2 : 0);
    segs.push([x, z, ang + (rnd() < 0.5 ? 0.3 : -0.3), SEG]);
  }
  return segs;
}
