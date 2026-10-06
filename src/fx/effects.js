// src/fx/effects.js: musket and cannon smoke (three.quarks) and battle sound (ZzFX).
//
// Smoke: a ring of short-burst particle systems sharing one material, so three.quarks batches them into a
// single draw call. Each puff takes the next system, moves its emitter to the muzzle and restarts it.
// Sound: ZzFX loads on the first user gesture (browser autoplay rules); volume falls off with distance
// from the camera target and simultaneous sounds are capped.

import * as THREE from 'three';
import { LOOK } from '../ui/look.js';
import { on } from '../settings.js';

const POOL = 200;

function smokeTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // a lumpy puff: several soft blobs
  for (let i = 0; i < 6; i++) {
    const x = size / 2 + Math.cos(i * 1.7) * 9, y = size / 2 + Math.sin(i * 2.3) * 8;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 22);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Effects {
  constructor(scene, terrain, rts) {
    this.scene = scene;
    this.terrain = terrain;
    this.rts = rts;
    this.ok = false;
    this.systems = [];
    this.next = 0;
    this._reducedMotion = false;
    this.smokeEnabled = LOOK.smoke;
    this.smokeEpoch = 0;
    on('look.smoke', (v) => this.setSmoke(v));
    this.sound = { unlocked: false, enabled: true, zzfx: null, ctx: null, active: 0 };
    this.puffs = 0;
    this.moments = new Map();
    this.momentNow = 0;
    this.activeMoment = null;
    this.onMoment = null;
    this.momentAudioEpoch = 0;
    this.momentVoice = null;
    on('look.xFactorStyle', () => this.syncMoments());
  }

  async init() {
    try {
      const Q = await import('three.quarks');
      const material = new THREE.MeshBasicMaterial({ map: smokeTexture(), transparent: true, depthWrite: false, color: 0xffffff });
      const batch = new Q.BatchedRenderer();
      batch.name = 'smoke';
      this.scene.add(batch);
      for (let i = 0; i < POOL; i++) {
        const big = i % 5 === 0; // every fifth system is a cannon-sized cloud
        const system = new Q.ParticleSystem({
          looping: false,
          duration: 0.3,
          worldSpace: true,
          shape: new Q.SphereEmitter({ radius: big ? 4 : 1.5, thickness: 1, arc: Math.PI * 2 }),
          startLife: new Q.IntervalValue(big ? 7 : 4.5, big ? 11 : 7.5),
          startSpeed: new Q.IntervalValue(0.6, big ? 4 : 2.2),
          startSize: new Q.IntervalValue(big ? 10 : 5, big ? 16 : 8.5),
          startRotation: new Q.IntervalValue(0, Math.PI * 2),
          startColor: new Q.ConstantColor(new Q.Vector4(0.96, 0.95, 0.91, big ? 0.55 : 0.45)),
          emissionOverTime: new Q.ConstantValue(0),
          emissionBursts: [{ time: 0, count: new Q.ConstantValue(big ? 8 : 3), cycle: 1, interval: 0.01, probability: 1 }],
          behaviors: [
            new Q.SizeOverLife(new Q.PiecewiseBezier([[new Q.Bezier(1, 1.8, 2.6, 3.2), 0]])),
            new Q.ColorOverLife(new Q.Gradient(
              [[new Q.Vector3(1, 1, 1), 0], [new Q.Vector3(0.85, 0.84, 0.8), 1]],
              [[0.75, 0], [0.5, 0.35], [0, 1]],
            )),
            new Q.SpeedOverLife(new Q.PiecewiseBezier([[new Q.Bezier(1, 0.3, 0.1, 0.05), 0]])),
            new Q.ApplyForce(new Q.Vector3(0.45, 0.35, -0.2), new Q.ConstantValue(0.6)),
            new Q.RotationOverLife(new Q.IntervalValue(-0.3, 0.3)),
          ],
          material,
          renderMode: Q.RenderMode.BillBoard,
        });
        system.pause();
        batch.addSystem(system);
        this.scene.add(system.emitter);
        this.systems.push({ system, big });
      }
      this.batch = batch;
      this.ok = true;
      this.syncSmoke();
    } catch (err) {
      console.warn('three.quarks smoke unavailable; continuing without smoke:', err && err.message ? err.message : err);
    }
  }

  get reducedMotion() { return this._reducedMotion; }
  set reducedMotion(v) {
    if (this._reducedMotion === Boolean(v)) return;
    this._reducedMotion = Boolean(v); this.smokeEpoch++; this.syncSmoke(); this.syncMoments();
  }

  setSmoke(v) {
    if (this.smokeEnabled === Boolean(v)) return;
    this.smokeEnabled = Boolean(v); this.smokeEpoch++; this.syncSmoke();
  }

  syncSmoke() {
    const visible = this.smokeEnabled && !this.reducedMotion;
    if (this.batch) this.batch.visible = visible;
    if (!visible) {
      // ParticleSystem.stop() clears particles and pauses; the pool and GPU buffers stay allocated.
      for (const { system } of this.systems) system.stop();
      if (this.ok) this.batch.update(0);
    }
  }

  puff(x, z, big = false, delay = 0) {
    if (!this.ok || !this.smokeEnabled || this.reducedMotion) return;
    const epoch = this.smokeEpoch;
    const go = () => {
      if (!this.ok || !this.smokeEnabled || this.reducedMotion || epoch !== this.smokeEpoch) return;
      let k = 0, s;
      do {
        s = this.systems[this.next];
        this.next = (this.next + 1) % this.systems.length;
        k++;
      } while (s.big !== big && k < this.systems.length);
      const e = s.system.emitter;
      e.position.set(x, this.terrain.heightAt(x, z) + (big ? 3 : 3.5), z);
      e.updateMatrixWorld(true);
      s.system.restart();
      this.puffs++;
    };
    if (delay > 0) setTimeout(go, delay * 1000); else go();
  }

  volley(unit, muzzles) {
    for (const [x, z, delay] of muzzles) this.puff(x, z, false, delay);
    this.playVolley(unit);
  }

  boom(unit, target, canister) {
    const s = Math.sin(unit.facing), c = Math.cos(unit.facing);
    for (const g of unit.gunPositions ? unit.gunPositions() : [[unit.x, unit.z]]) this.puff(g[0] + s * 4, g[1] + c * 4, true, Math.random() * 0.6);
    if (!canister && target) {
      // shell bursts over the target line
      for (let i = 0; i < 2; i++) this.puff(target.x + (Math.random() - 0.5) * target.halfFront, target.z + (Math.random() - 0.5) * 20, false, 0.8 + Math.random() * 0.6);
    }
    this.playBoom(unit);
  }

  /** A shell bursting at (x, z): a ring of cannon-sized clouds, a few small ones and a bang (sandbox moment). */
  shellBurst(x, z) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.puff(x + Math.cos(a) * 5, z + Math.sin(a) * 5, true, i * 0.04);
    }
    for (let i = 0; i < 4; i++) this.puff(x + (Math.random() - 0.5) * 18, z + (Math.random() - 0.5) * 18, false, 0.1 + Math.random() * 0.3);
    this.playBoom({ x, z });
  }

  update(dt) {
    if (this.ok) this.batch.update(dt);
  }

  /** Shared presentation seam for future earned moments. Sandbox callers explicitly label previews. */
  xFactor(unit, { preview = false, label = preview ? 'X-Factor preview' : 'X-Factor' } = {}) {
    if (!unit?.alive || LOOK.xFactorStyle === 'off') return false;
    this.stopMomentSound();
    // Bounded cues even when a caller cycles through many units. No scene allocation or combat change.
    if (!this.moments.has(unit) && this.moments.size >= 8) {
      const oldest = this.moments.keys().next().value; oldest.momentGlow = false; this.moments.delete(oldest);
    }
    const record = { unit, preview: Boolean(preview), label: String(label).slice(0, 100), until: this.momentNow + 4 };
    this.moments.set(unit, record); this.activeMoment = record; this.presentMoment();
    const epoch = this.momentAudioEpoch;
    const play = () => {
      if (epoch === this.momentAudioEpoch && this.activeMoment === record && this.moments.get(unit) === record) this.playXFactor(unit);
    };
    if (this.sound.zzfx) play(); else Promise.resolve(this.unlock()).then(play);
    return true;
  }

  momentStyle() { return this.reducedMotion ? 'subtle' : LOOK.xFactorStyle; }
  presentMoment() {
    const style = this.momentStyle();
    for (const record of this.moments.values()) record.unit.momentGlow = style === 'full';
    this.onMoment?.(this.activeMoment ? { ...this.activeMoment, style } : null);
  }
  syncMoments() {
    this.stopMomentSound();
    if (LOOK.xFactorStyle === 'off') this.clearMoments(); else this.presentMoment();
  }
  clearMoments() {
    this.stopMomentSound();
    for (const unit of this.moments.keys()) unit.momentGlow = false;
    this.moments.clear(); this.activeMoment = null; this.onMoment?.(null);
  }
  /** Real presentation seconds, independent of simulation pause/speed. */
  updateMoments(dt) {
    if (Number.isFinite(dt) && dt > 0) this.momentNow += dt;
    let changed = false;
    for (const [unit, record] of this.moments) if (!unit.alive || record.until <= this.momentNow) {
      unit.momentGlow = false; this.moments.delete(unit); changed = true;
      if (record === this.activeMoment) { this.activeMoment = null; this.stopMomentSound(); }
    }
    if (changed) {
      if (!this.activeMoment) this.activeMoment = [...this.moments.values()].at(-1) || null;
      this.presentMoment();
    }
  }
  stopMomentSound() {
    this.momentAudioEpoch++;
    if (this.momentVoice) {
      try { this.momentVoice.stop(); this.momentVoice.disconnect?.(); } catch { /* an already-ended source is harmless */ }
      this.momentVoice = null;
    }
  }
  setSound(v) { this.sound.enabled = Boolean(v); if (!v) this.stopMomentSound(); }
  playXFactor(unit) {
    if (!unit?.alive || this.activeMoment?.unit !== unit || LOOK.xFactorStyle === 'off'
      || this.momentStyle() !== 'full' || !this.sound.enabled || !this.sound.zzfx) return;
    this.momentVoice = this.sound.zzfx(0.4, 0, 420, 0.02, 0.1, 0.5, 1, 1, 160);
  }

  // -------------------------------------------------------------------------------------------------
  // Sound
  unlock() {
    if (this.sound.unlocked) return this.sound.ready;
    this.sound.unlocked = true;
    this.sound.ready = import('zzfx')
      .then((m) => {
        this.sound.zzfx = m.zzfx;
        this.sound.ctx = m.ZZFX.audioContext;
        if (this.sound.ctx && this.sound.ctx.state === 'suspended') this.sound.ctx.resume();
      })
      .catch((err) => console.warn('ZzFX unavailable; continuing without sound:', err && err.message ? err.message : err));
    return this.sound.ready;
  }

  _gain(unit) {
    const t = this.rts.target;
    const d = Math.hypot(unit.x - t.x, unit.z - t.z) + this.rts.dist * 0.4;
    return Math.max(0, Math.min(1, 700 / (d + 200)));
  }

  _play(gain, fn) {
    const s = this.sound;
    if (!s.enabled || !s.zzfx || gain < 0.05 || s.active > 6) return;
    s.active++;
    setTimeout(() => { s.active--; }, 400);
    fn(gain);
  }

  playVolley(unit) {
    this._play(this._gain(unit), (g) => {
      const crack = () => this.sound.zzfx(0.9 * g, 0.3, 90, 0.003, 0.03, 0.6, 4, 1.4, -1.5, 0, 0, 0, 0, 1.8, 0, 0.35, 0.05, 0.5, 0.1);
      crack();
      for (let i = 1; i < 5; i++) setTimeout(crack, i * 90 + Math.random() * 140);
    });
  }

  playBoom(unit) {
    this._play(this._gain(unit), (g) => {
      this.sound.zzfx(1.6 * g, 0.1, 42, 0.005, 0.12, 1.4, 4, 0.4, -0.3, 0, 0, 0, 0, 0.9, 0, 0.6, 0.02, 0.4, 0.3);
    });
  }
}
