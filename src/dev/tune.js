// src/dev/tune.js: developer look-tuning panel (lil-gui). Loaded only with ?tune; never shown to players.
// "Copy values" logs the current settings as JSON so they can be pasted back into the source.

import GUI from 'lil-gui';
import { FIELD_TYPES } from '../world/landscape.js';

export function openTuner({ post, world }) {
  const gui = new GUI({ title: 'Tune (dev only, ?tune)' });
  const fu = post.finalMat.uniforms;

  const fp = gui.addFolder('Post');
  fp.add(fu.uExposure, 'value', 0.3, 1.6, 0.01).name('exposure');
  fp.add(fu.uSaturation, 'value', 0.5, 1.6, 0.01).name('saturation');
  fp.add(fu.uVignette, 'value', 0, 2, 0.01).name('vignette');
  fp.add(fu.uTilt, 'value', 0, 1, 0.01).name('tilt-shift');
  fp.add(fu.uTiltCenter, 'value', 0.2, 0.8, 0.01).name('tilt centre');
  fp.add(fu.uTiltBand, 'value', 0, 0.4, 0.01).name('tilt band');

  const sunDir = world.sun.direction;
  const sun = { azimuth: (Math.atan2(sunDir.x, sunDir.z) * 180) / Math.PI, elevation: (Math.asin(sunDir.y) * 180) / Math.PI };
  const applySun = () => {
    const az = (sun.azimuth * Math.PI) / 180, el = (sun.elevation * Math.PI) / 180;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    world.light.position.copy(sunDir).multiplyScalar(1000);
  };
  const fs = gui.addFolder('Sun');
  fs.add(sun, 'azimuth', -180, 180, 1).onChange(applySun);
  fs.add(sun, 'elevation', 5, 85, 1).onChange(applySun);
  fs.add(world.light, 'intensity', 0, 8, 0.05).name('props sun');
  fs.add(world.hemi, 'intensity', 0, 6, 0.05).name('props sky');

  const tu = world.terrainMesh.material.uniforms;
  const ft = gui.addFolder('Terrain');
  ft.add(tu.uLit, 'value', 0, 2.5, 0.01).name('sun light');
  ft.add(tu.uAmbient, 'value', 0, 2, 0.01).name('sky light');
  ft.add(tu.uCavity, 'value', 0, 1.5, 0.01).name('cavity shade');

  const fpal = gui.addFolder('Field palette (then Repaint)');
  for (const t of FIELD_TYPES) {
    fpal.addColor(t, 'color', 255).name(t.name);
    fpal.add(t, 'weight', 0, 40, 1).name(`${t.name} weight`);
  }
  fpal.add({ repaint: () => world.repaint() }, 'repaint').name('Repaint ground');
  fpal.close();

  gui.add({
    copy: () => {
      const out = {
        post: { exposure: fu.uExposure.value, saturation: fu.uSaturation.value, vignette: fu.uVignette.value, tilt: fu.uTilt.value, tiltCenter: fu.uTiltCenter.value, tiltBand: fu.uTiltBand.value },
        sun: { ...sun, propsSun: world.light.intensity, propsSky: world.hemi.intensity },
        terrain: { lit: tu.uLit.value, ambient: tu.uAmbient.value, cavity: tu.uCavity.value },
        palette: FIELD_TYPES.map((t) => ({ name: t.name, color: t.color.map(Math.round), weight: t.weight })),
      };
      console.log(JSON.stringify(out, null, 1));
    },
  }, 'copy').name('Copy values (console)');
  return gui;
}
