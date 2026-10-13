// src/world/world.js: assemble the battlefield (ground, woods, farms, fences, labels, light).

import * as THREE from 'three';
import { buildTerrainMesh, buildApron } from './terrain.js';
import { Parcels, VoronoiParcels, LineField, setPlan, placeTreesWithin, placeFences, PLAN } from './landscape.js';
import { paintGround } from './ground-paint.js';
import { buildTrees, buildBuildings, buildFences } from './props.js';
import { buildLabels } from './labels.js';

export const DEFAULT_PARCELS = 'voronoi';
// Scene fog distances (m); tree chunks wholly deeper than FOG_FAR are hidden (props.js buildTrees).
export const FOG_NEAR = 1400, FOG_FAR = 3600;

export function makeSun() {
  // Mid-afternoon sun from the west-south-west (direction points toward the sun).
  return {
    direction: new THREE.Vector3(-0.8, 0.5, 0.34).normalize(),
    color: new THREE.Color(1.0, 0.9, 0.74).multiplyScalar(1.05),
    sky: new THREE.Color(0.55, 0.58, 0.62),
    earth: new THREE.Color(0.3, 0.27, 0.22),
    fog: new THREE.Color('#a39a86'),
  };
}

/**
 * The placed ground (no three.js, no DOM): installs the scenario plan, then parcels, trees under the budget,
 * fences and the fence field. Pure and deterministic, so tools/test-ground.mjs checks the same wiring.
 */
export function planGround(terrain, scenario, { parcels: kind = DEFAULT_PARCELS } = {}) {
  setPlan(scenario);
  const meta = terrain.meta;
  // Parcels line up with the main road: a pike, else the Warrenton Turnpike, else the first road, else east-west.
  const roads = meta.roads || [];
  const pike = roads.find((r) => r.kind === 'pike') || roads.find((r) => r.name === 'Warrenton Turnpike') || roads[0];
  const a = pike?.points?.[0], b = pike?.points?.[pike.points.length - 1];
  const angle = a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0;
  const roadField = new LineField(terrain.half, meta.roads);
  const streamField = new LineField(terrain.half, meta.streams);
  const parcels = kind === 'grid' ? new Parcels({ angle }) : new VoronoiParcels({ angle, half: terrain.half, roadField, streamField });
  const { trees, spacing, requested, forest } = placeTreesWithin(terrain, meta.streams, roadField, streamField, parcels);
  const fences = placeFences(terrain, meta.roads, parcels);
  const fenceField = new LineField(terrain.half, fences.map(([x, z, a, l]) => {
    const c = (Math.cos(a) * l) / 2, s = (Math.sin(a) * l) / 2;
    return { points: [[x - c, z - s], [x + c, z + s]] };
  }), { cell: 6, maxDist: 20 });
  return { parcels, roadField, streamField, trees, forest, treeSpacing: spacing, treeSpacingRequested: requested, fences, fenceField };
}

export function buildWorld(scene, terrain, scenario, { terrainMeshFactory = null } = {}) {
  if (terrainMeshFactory !== null && (typeof terrainMeshFactory !== 'function'
    || Object.prototype.toString.call(terrainMeshFactory) === '[object AsyncFunction]')) throw new Error('World: synchronous diagnostic terrain factory required');
  const sun = makeSun();
  const meta = terrain.meta;
  const t0 = performance.now();
  // ?parcels=grid|voronoi picks the field generator (comparison switch; default per DECISIONS 0008)
  const kind = new URLSearchParams(globalThis.location ? location.search : '').get('parcels') || DEFAULT_PARCELS;
  const { parcels, roadField, streamField, trees, treeSpacing, treeSpacingRequested, fences, fenceField } = planGround(terrain, scenario, { parcels: kind });
  const { ground, info } = paintGround(terrain, parcels, meta.roads, meta.streams, trees, sun.direction);
  const t1 = performance.now();

  let terrainMesh;
  try { terrainMesh = buildTerrainMesh(terrain, ground, info, sun, { meshFactory: terrainMeshFactory }); }
  catch (error) {
    const failures = [];
    for (const texture of [ground, info]) { try { texture.dispose(); } catch (failure) { failures.push(failure); } }
    if (failures.length) {
      const aggregate = new AggregateError([error, ...failures], 'World: terrain construction and painted texture cleanup failed');
      if (error?.cleanupPromise) aggregate.cleanupPromise = error.cleanupPromise;
      throw aggregate;
    }
    throw error;
  }
  scene.add(terrainMesh);
  scene.add(buildApron(terrain, sun));
  const treeGroup = buildTrees(terrain, trees, { far: FOG_FAR });
  scene.add(treeGroup);
  scene.add(buildBuildings(terrain, PLAN.sites));
  scene.add(buildFences(terrain, fences));
  scene.add(buildLabels(terrain, PLAN.labels));

  scene.fog = new THREE.Fog(sun.fog, FOG_NEAR, FOG_FAR);
  scene.background = sun.fog.clone();
  // Physically based Lambert divides by pi, so these intensities match the terrain shader's own
  // (unscaled) ambient 0.8 x hemi and sun 1.15 x sun colour; lower values left walls and roofs near black.
  const hemi = new THREE.HemisphereLight(sun.sky, sun.earth, 2.4);
  const light = new THREE.DirectionalLight(sun.color, 3.6);
  light.position.copy(sun.direction).multiplyScalar(1000);
  scene.add(hemi, light);

  /** Repaint the ground texture (after a palette change in the ?tune panel). */
  const repaint = () => {
    const u = terrainMesh.material.uniforms;
    const next = paintGround(terrain, parcels, meta.roads, meta.streams, trees, sun.direction);
    u.uGround.value.dispose();
    u.uInfo.value.dispose();
    u.uGround.value = next.ground;
    u.uInfo.value = next.info;
  };

  return {
    sun,
    terrainMesh,
    light,
    hemi,
    repaint,
    trees: treeGroup,
    parcels,
    roadField,
    streamField,
    fenceField,
    stats: {
      trees: treeGroup.userData.count,
      treeSpacing,
      treeSpacingRequested,
      fences: fences.length,
      terrainTriangles: terrainMesh.userData.triangles,
      paintMs: Math.round(t1 - t0),
    },
  };
}
