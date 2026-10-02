// tools/fetch-terrain.mjs: build the small terrain assets for the Henry House Hill to Matthews Hill slice.
//
//   node tools/fetch-terrain.mjs
//
// Sources (all US federal works, public domain):
//   - Elevation: USGS 3DEP bare-earth DEM, ImageServer exportImage (float32 GeoTIFF), read with geotiff.js.
//   - Roads: USGS National Map transportation service (Lee Hwy = the 1861 Warrenton Turnpike alignment,
//     Sudley Rd = the 1861 Manassas-Sudley road alignment).
//   - Streams: USGS National Hydrography Dataset flowlines (Youngs Branch, Chinn Branch, Holkums Branch).
//
// Output (committed, small): assets/terrain/henry-hill.bin (gzip of row-delta Int16 heights in 5 cm steps
// above the area minimum, row 0 = north edge, GRID x GRID) and assets/terrain/henry-hill.json (metadata,
// roads and streams already projected to local metres). The raw GeoTIFF stays in .out/ and is pruned.
//
// Local frame: origin at CENTER, +x east, +z south, 1 unit = 1 metre (equirectangular about the centre
// latitude; under 0.1% scale error across 2.6 km).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.out', 'terrain');
const ASSETS = path.join(ROOT, 'assets', 'terrain');

export const CENTER = { lat: 38.81825, lon: -77.5225 };
const HALF = 1300; // metres from centre to each edge
const GRID = 513; // heightmap samples per side (martini needs 2^n + 1)
const FETCH = 1025; // DEM pixels requested per side, then smoothed down to GRID
const PHI = (CENTER.lat * Math.PI) / 180;
const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * PHI) + 1.175 * Math.cos(4 * PHI);
const M_PER_DEG_LON = 111412.84 * Math.cos(PHI) - 93.5 * Math.cos(3 * PHI);
const BBOX = {
  west: CENTER.lon - HALF / M_PER_DEG_LON,
  east: CENTER.lon + HALF / M_PER_DEG_LON,
  south: CENTER.lat - HALF / M_PER_DEG_LAT,
  north: CENTER.lat + HALF / M_PER_DEG_LAT,
};
const bboxStr = [BBOX.west, BBOX.south, BBOX.east, BBOX.north].map((v) => v.toFixed(6)).join(',');

const DEM_URL =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage' +
  `?bbox=${bboxStr}&bboxSR=4326&imageSR=4326&size=${FETCH},${FETCH}&format=tiff&pixelType=F32` +
  '&interpolation=RSP_BilinearInterpolation&f=image';
const QUERY = `geometry=${bboxStr}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
  '&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson';
const ROADS_URL = (layer) => `https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/${layer}/query?${QUERY}`;
const NHD_URL = `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query?${QUERY}`;

const project = ([lon, lat]) => [
  Math.round((lon - CENTER.lon) * M_PER_DEG_LON * 10) / 10,
  Math.round(-(lat - CENTER.lat) * M_PER_DEG_LAT * 10) / 10,
];

async function get(url, kind) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status} for ${url}`);
  return res;
}

// Douglas-Peucker simplification (tolerance in metres).
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = points[a];
    const [bx, bz] = points[b];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dz - (points[i][1] - az) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Join LineStrings that share endpoints into longer polylines (same name only).
function joinLines(lines) {
  const key = (p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`;
  const pool = lines.map((l) => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pool.length; i++) {
      for (let j = 0; j < pool.length; j++) {
        if (i === j) continue;
        const a = pool[i];
        const b = pool[j];
        if (key(a[a.length - 1]) === key(b[0])) pool[i] = a.concat(b.slice(1));
        else if (key(a[a.length - 1]) === key(b[b.length - 1])) pool[i] = a.concat(b.slice(0, -1).reverse());
        else if (key(a[0]) === key(b[b.length - 1])) pool[i] = b.concat(a.slice(1));
        else if (key(a[0]) === key(b[0])) pool[i] = b.slice().reverse().concat(a.slice(1));
        else continue;
        pool.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return pool;
}

function linesOf(features, nameOf, wanted) {
  const byName = new Map();
  for (const f of features) {
    const name = nameOf(f.properties);
    if (!wanted.some((w) => name.includes(w))) continue;
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (!byName.has(name)) byName.set(name, []);
    for (const p of parts) byName.get(name).push(p.map(project));
  }
  const out = [];
  for (const [name, lines] of byName) {
    for (const l of joinLines(lines)) {
      const s = simplify(l, 1.5);
      if (s.length >= 2) out.push({ name, points: s });
    }
  }
  return out;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(ASSETS, { recursive: true });

  // 1. Elevation.
  console.log(`DEM: ${DEM_URL}`);
  const tiffBuf = await (await get(DEM_URL, 'DEM')).arrayBuffer();
  await fs.writeFile(path.join(OUT, 'dem.tif'), Buffer.from(tiffBuf));
  const tiff = await fromArrayBuffer(tiffBuf);
  const image = await tiff.getImage();
  const [raster] = await image.readRasters();
  const w = image.getWidth();
  const h = image.getHeight();
  if (w !== FETCH || h !== FETCH) throw new Error(`DEM is ${w}x${h}, expected ${FETCH}x${FETCH}`);
  let bad = 0;
  for (let i = 0; i < raster.length; i++) if (!Number.isFinite(raster[i]) || raster[i] < -100) bad++;
  if (bad) throw new Error(`DEM has ${bad} nodata pixels`);

  // Smooth (separable 5-tap binomial on the 1025 grid) then take every 2nd sample -> 513. This softens
  // modern road cuts and parking lots without flattening the hills.
  const tmp = new Float32Array(w * h);
  const sm = new Float32Array(w * h);
  const K = [1, 4, 6, 4, 1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); s += raster[y * w + xx] * K[k + 2]; n += K[k + 2]; }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); s += tmp[yy * w + x] * K[k + 2]; n += K[k + 2]; }
    sm[y * w + x] = s / n;
  }
  const heights = new Float32Array(GRID * GRID);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const v = sm[(y * 2) * w + x * 2];
    heights[y * GRID + x] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Quantise to 5 cm steps and delta-encode along each row (first sample of a row is absolute): smooth
  // ground gives tiny deltas, which gzip packs far better than raw heights.
  const q = new Int16Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    let prev = 0;
    for (let x = 0; x < GRID; x++) {
      const v = Math.round((heights[y * GRID + x] - min) * 20);
      q[y * GRID + x] = v - prev;
      prev = v;
    }
  }
  const gz = zlib.gzipSync(Buffer.from(q.buffer), { level: 9 });
  await fs.writeFile(path.join(ASSETS, 'henry-hill.bin'), gz);

  // 2. Roads (layers 29-31: controlled-access, secondary and local connecting roads; Sudley Rd spans several).
  const roadsGeo = { features: [] };
  for (const layer of [29, 30, 31]) roadsGeo.features.push(...(await (await get(ROADS_URL(layer), 'roads')).json()).features);
  const roads = linesOf(roadsGeo.features, (p) => p.name || '', ['Lee Hwy', 'Sudley Rd']).map((r) => ({
    ...r,
    name: r.name.includes('Lee') ? 'Warrenton Turnpike' : 'Sudley Road',
    modern: r.name,
  }));

  // 3. Streams.
  const nhd = await (await get(NHD_URL, 'NHD')).json();
  const streams = linesOf(nhd.features, (p) => p.gnis_name || '', ['Youngs Branch', 'Chinn Branch', 'Holkums Branch', 'Dogans Branch', 'Bull Run']);

  const meta = {
    name: 'Henry House Hill to Matthews Hill (First Bull Run, 21 July 1861)',
    frame: 'local metres: origin at center, +x east, +z south; equirectangular',
    center: CENTER,
    halfSize: HALF,
    grid: GRID,
    cellSize: (2 * HALF) / (GRID - 1),
    bbox: BBOX,
    heights: { file: 'henry-hill.bin', encoding: 'gzip(Int16LE row-delta of 5 cm steps above minM; prefix-sum each row), row 0 = north', stepM: 0.05, minM: Math.round(min * 100) / 100, maxM: Math.round(max * 100) / 100 },
    roads,
    streams,
    sources: [
      { what: 'elevation', title: 'USGS 3D Elevation Program (3DEP) bare-earth DEM', url: DEM_URL, license: 'public domain (US federal work)', fetched: new Date().toISOString().slice(0, 10) },
      { what: 'roads', title: 'USGS The National Map transportation (Lee Hwy, Sudley Rd: modern alignments of the 1861 roads)', url: ROADS_URL(30).replace('/30/', '/{29,30,31}/'), license: 'public domain (US federal work)' },
      { what: 'streams', title: 'USGS National Hydrography Dataset flowlines', url: NHD_URL, license: 'public domain (US federal work)' },
    ],
  };
  await fs.writeFile(path.join(ASSETS, 'henry-hill.json'), JSON.stringify(meta, null, 1) + '\n');
  const st = await fs.stat(path.join(ASSETS, 'henry-hill.bin'));
  console.log(`heights: ${GRID}x${GRID}, ${min.toFixed(1)}..${max.toFixed(1)} m, ${st.size} B gzip`);
  console.log(`roads: ${roads.map((r) => `${r.name}(${r.points.length})`).join(', ')}`);
  console.log(`streams: ${streams.map((s) => `${s.name}(${s.points.length})`).join(', ')}`);
}

main().catch((err) => {
  console.error(`fetch-terrain FAIL: ${err.message}`);
  process.exit(1);
});
