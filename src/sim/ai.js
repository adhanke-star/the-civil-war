// src/sim/ai.js: the Confederate defence of Henry House Hill (simple v1; Yuka goals come in M2).
//
// Each AI unit, twice a second: routing or in melee -> nothing; a wavering or routing foe within 170 m and
// this unit steady -> charge it (Jackson's counterattack); wavering with a stronger foe close -> fall back;
// otherwise hold its ground and face the nearest threat. AI never touches the player's units.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Ai {
  constructor(game, opts) {
    this.game = game;
    this.side = game.playerSide === 'US' ? 'CS' : 'US';
    this.t = 0;
    this.chargeReach = opts.chargeReach || 170;
  }

  step(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const units = this.game.units;
    for (const u of units) {
      if (u.side !== this.side || !u.alive || u.state === 'routing' || u.melee) continue;
      const foes = units.filter((e) => e.side !== u.side && e.alive);
      let near = null, nd = Infinity;
      for (const e of foes) {
        if (e.state === 'routing') continue;
        const d = Math.hypot(e.x - u.x, e.z - u.z);
        if (d < nd) { nd = d; near = e; }
      }
      if (!near) continue;
      const ahead = Math.abs(wrap(Math.atan2(near.x - u.x, near.z - u.z) - u.facing)) < 1.1;
      if (u.type === 'infantry' && u.state === 'steady' && u.order.type !== 'charge' && nd < this.chargeReach && ahead &&
          (near.state === 'wavering' || near.state === 'shaken' && near.men < u.men * 0.7)) {
        u.orderCharge(near);
        continue;
      }
      if (u.order.type === 'charge') continue;
      if (u.state === 'wavering' && nd < 200 && near.men > u.men && !u.follow.active && (u.lastFallback || -99) < this.game.simTime - 25) {
        u.lastFallback = this.game.simTime;
        u.orderFallback(110);
        continue;
      }
      if (!u.follow.active && u.order.type === 'hold' && !u.order.firm && u.state !== 'wavering') {
        u.order = { type: 'hold', firm: true }; // back in position after a charge or fallback
      }
      if (!u.follow.active && nd < 900 && !u.target) {
        const want = Math.atan2(near.x - u.x, near.z - u.z);
        if (Math.abs(wrap(want - u.facing)) > 0.35) u.goalFacing = want;
      }
    }
  }
}
