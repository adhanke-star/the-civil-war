// Tiny legal containers and manifests for loader controls; no shipped art or result mutation.
import * as THREE from 'three';
import { createDefaultContainer, write } from '../vendor/three/examples/jsm/libs/ktx-parse.module.js';
import { BakedAtlas, ImpostorPool } from '../src/units/impostor.js';
import { pageMipBytes } from '../src/units/atlas-compression.js';

export function loaderFixture(options = {}, mutate = () => {}) {
  const frame = { page: 0, x: 0, y: 0, w: 4, h: 4, ox: 0, oy: 0, ax: 2, ay: 4, ppm: 4 };
  const tier = name => ({ frameSize: 8, pxPerMetre: 4, anchor: [2, 4],
    pages: Array.from({ length: name === 'close' ? 5 : 1 }, (_, i) => ({ file: `${name}-${i}.png`, w: 8, h: 8 })),
    frames: { stand_0_d00: frame }, directionsRendered: [0] });
  const manifest = { camera: { directions: 1, elevation_deg: 35 }, clips: { stand: { frames: [0] } },
    tiers: { field: tier('field'), close: tier('close') } };
  manifest.tiers.field.variants = Object.fromEntries(['a', 'b', 'c'].map(k => [k, tier('field')]));
  const hybrid = structuredClone(manifest);
  hybrid.tiers.close.variants = { extra: structuredClone(hybrid.tiers.close) };
  const sourceManifest = structuredClone(hybrid);
  for (const [name, T] of [['base', hybrid.tiers.close], ['extra', hybrid.tiers.close.variants.extra]])
    T.pages.forEach((p, i) => Object.assign(p, { file: `${name}-${i}.${i === 4 ? 'png' : 'ktx2'}`,
      encoding: i === 4 ? 'png' : 'astc4x4', alpha: i === 4 ? 'straight-gamma-bytes' : 'premultiplied-gamma-bytes' }));
  const c = createDefaultContainer();
  Object.assign(c, { vkFormat: 157, pixelWidth: 8, pixelHeight: 8, levelCount: 4 });
  Object.assign(c.dataFormatDescriptor[0], { colorModel: 162, colorPrimaries: 0, transferFunction: 1, flags: 1,
    texelBlockDimension: [3, 3, 0, 0], bytesPlane: [16, 0, 0, 0, 0, 0, 0, 0],
    samples: [{ bitOffset: 0, bitLength: 127, channelType: 0, samplePosition: [0, 0, 0, 0], sampleLower: 0, sampleUpper: 0xffffffff }] });
  c.levels = pageMipBytes(8, 8, true).levels.map(l => ({ levelData: new Uint8Array(l.bytes), uncompressedByteLength: l.bytes }));
  const bytes = write(c), events = [], textures = [], pools = [], disposed = new Set();
  let error = 0, releaseLate;
  const late = new Promise(resolve => { releaseLate = resolve; });
  const gl = { NO_ERROR: 0, COMPRESSED_TEXTURE_FORMATS: 1, MAX_TEXTURE_SIZE: 2,
    getExtension: () => options.unsupported ? null : { getSupportedProfiles: () => ['ldr'] },
    getParameter: k => k === 1 ? [0x93b0] : 2048, isContextLost: () => false,
    getError: () => { const e = error; error = 0; return e; } };
  const track = t => { textures.push(t); t.addEventListener('dispose', () => { disposed.add(t); events.push('dispose'); }); return t; };
  const renderer = { getContext: () => gl, initTexture(t) {
    if (!textures.includes(t)) track(t);
    events.push(t.isCompressedTexture ? 'upload-astc' : 'upload-png');
    if (options.uploadFailure && t.isCompressedTexture) error = 0x0502;
  } };
  const io = {
    async fetch(url) { events.push(`fetch:${url}`); if (options.httpFailure && url.endsWith('base-0.ktx2')) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => options.malformed && url.endsWith('base-0.ktx2') ? new ArrayBuffer(8) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }; },
    async loadPNG(url) { events.push(`png:${url}`);
      if (options.delay && url === 'candidate/extra-4.png') { events.push('late-wait'); await late; events.push('late-done'); }
      return track(new THREE.DataTexture(new Uint8Array(8 * 8 * 4), 8, 8)); }
  };
  const atlas = new BakedAtlas(manifest, 'baseline/', { diagnosticClose: { manifest: hybrid, sourceManifest, base: 'candidate/' }, renderer, io });
  atlas.textures.field = atlas.layout.tiers.field.pages.map(() => new THREE.DataTexture(new Uint8Array(256), 8, 8));
  for (let i = 0; i < 2; i++) { const pool = new ImpostorPool(2, { side: 'CS' }); pool.attach(atlas); pools.push(pool); }
  const before = { layout: atlas.layout, field: atlas.layout.tiers.field, close: atlas.layout.tiers.close,
    fieldTextures: atlas.textures.field, batches: pools.map(p => p.batches.field), records: pools.map(p => p.fallen) };
  const fixture = { atlas, pools, renderer, io, hybrid, before, events, textures, disposed, releaseLate,
    addPool() { const pool = new ImpostorPool(2, { side: 'CS' }); pool.attach(atlas); pools.push(pool); return pool; },
    cleanup() { for (const pool of pools) for (const tier of ['field', 'close']) pool.disposeTier(pool.batches[tier]);
      for (const ts of Object.values(atlas.textures)) for (const t of ts) t.dispose(); } };
  mutate(fixture);
  return fixture;
}
