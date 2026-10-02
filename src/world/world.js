// src/world/world.js: assemble the battlefield (ground, woods, farms, fences, labels, light).

import * as THREE from 'three';
import { buildTerrainMesh, buildApron } from './terrain.js';
import { Parcels, LineField, setPlan, placeTrees, placeFences, PLAN } from './landscape.js';
import { paintGround } from './ground-paint.js';
import { buildTrees, buildBuildings, buildFences } from './props.js';
import { buildLabels } from './labels.js';

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

export function buildWorld(scene, terrain, scenario) {
  setPlan(scenario);
  const sun = makeSun();
  const meta = terrain.meta;
  const pike = meta.roads.find((r) => r.name === 'Warrenton Turnpike');
  const a = pike.points[0], b = pike.points[pike.points.length - 1];
  const parcels = new Parcels({ angle: Math.atan2(b[1] - a[1], b[0] - a[0]) });

  const t0 = performance.now();
  const roadField = new LineField(terrain.half, meta.roads);
  const streamField = new LineField(terrain.half, meta.streams);
  const trees = placeTrees(terrain, meta.streams, roadField, streamField, parcels);
  const fences = placeFences(terrain, meta.roads, parcels);
  const fenceField = new LineField(terrain.half, fences.map(([x, z, a, l]) => {
    const c = (Math.cos(a) * l) / 2, s = (Math.sin(a) * l) / 2;
    return { points: [[x - c, z - s], [x + c, z + s]] };
  }), { cell: 6, maxDist: 20 });
  const { ground, info } = paintGround(terrain, parcels, meta.roads, meta.streams, trees, sun.direction);
  const t1 = performance.now();

  const terrainMesh = buildTerrainMesh(terrain, ground, info, sun);
  scene.add(terrainMesh);
  scene.add(buildApron(terrain, sun));
  const treeGroup = buildTrees(terrain, trees);
  scene.add(treeGroup);
  scene.add(buildBuildings(terrain, PLAN.sites));
  scene.add(buildFences(terrain, fences));
  scene.add(buildLabels(terrain, PLAN.labels));

  scene.fog = new THREE.Fog(sun.fog, 1400, 3600);
  scene.background = sun.fog.clone();
  // Physically based Lambert divides by pi, so these intensities match the terrain shader's own
  // (unscaled) ambient 0.8 x hemi and sun 1.15 x sun colour; lower values left walls and roofs near black.
  const hemi = new THREE.HemisphereLight(sun.sky, sun.earth, 2.4);
  const light = new THREE.DirectionalLight(sun.color, 3.6);
  light.position.copy(sun.direction).multiplyScalar(1000);
  scene.add(hemi, light);

  return {
    sun,
    parcels,
    roadField,
    streamField,
    fenceField,
    stats: {
      trees: treeGroup.userData.count,
      fences: fences.length,
      terrainTriangles: terrainMesh.userData.triangles,
      paintMs: Math.round(t1 - t0),
    },
  };
}
