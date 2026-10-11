// src/sim/rules.js: the battle rules Aaron can switch in the sandbox (tab Rules), kept live in RULES.
//
// Every value is registered once with src/settings.js and mirrored into the plain object RULES, which the
// simulation reads in its hot loops (a property read, no Map lookup). The multipliers scale what exists in
// the sim (march speed, fire effect, morale loss, battle speed) and never edit the base constants.

import { define, on } from '../settings.js';

const SPECS = {
  moveOrder: ['rules.moveOrder', {
    tab: 'Rules', type: 'choice', default: 'fight', label: 'Move order',
    options: [{ value: 'fight', label: 'Halt and fight on the way' }, { value: 'march', label: 'Keep marching, fire on the move' }],
    note: 'What a brigade does when an enemy comes within effective range while it marches to your mark: stop and fire, or march on firing at half effect.',
  }],
  initiative: ['rules.initiative', {
    tab: 'Rules', type: 'toggle', default: true, label: 'Brigade initiative',
    note: 'Brigades without orders turn to face an enemy firing into their flank; they never advance or charge on their own.',
  }],
  friendlyMask: ['rules.friendlyMask', {
    tab: 'Rules', type: 'toggle', default: true, label: 'No fire through friends',
    note: 'A brigade or battery does not fire while one of its own brigades stands across its line of fire; its marker reads Masked. It still fires at any other enemy in range with a clear line. Off: fire passes through friends as if they were not there.',
  }],
  autoPause: ['rules.autoPause', {
    tab: 'Rules', type: 'toggle', default: true, label: 'Auto-pause',
    note: 'Pauses the battle with a one-line banner when one of your brigades routs or the objective you hold is threatened.',
  }],
  panInertia: ['rules.panInertia', {
    tab: 'Rules', type: 'toggle', default: true, label: 'Pan glide',
    note: 'The map keeps gliding for a moment after you let go of a pan, like a phone map.',
  }],
  marchSpeed: ['rules.marchSpeed', {
    tab: 'Rules', type: 'range', default: 1, min: 0.5, max: 2, step: 0.05, label: 'March speed',
    note: 'Multiplies how fast every brigade and battery moves (1 = drill-book pace).',
  }],
  fireEffect: ['rules.fireEffect', {
    tab: 'Rules', type: 'range', default: 1, min: 0.5, max: 2, step: 0.05, label: 'Fire effect',
    note: 'Multiplies the casualties every volley and cannon shot causes.',
  }],
  moraleLoss: ['rules.moraleLoss', {
    tab: 'Rules', type: 'range', default: 1, min: 0.5, max: 2, step: 0.05, label: 'Morale loss',
    note: 'Multiplies how much morale brigades lose to casualties, fire, flanking and panic; higher breaks lines sooner.',
  }],
  chargeEffect: ['rules.chargeEffect', {
    tab: 'Rules', type: 'range', default: 1, min: 0.5, max: 2, step: 0.05, label: 'Charge effect',
    note: 'Multiplies melee casualties on both sides, including defenders; existing casualty caps still apply. Saved for later practice battles too.',
  }],
  fatigueGain: ['rules.fatigueGain', {
    tab: 'Rules', type: 'range', default: 1, min: 0.5, max: 2, step: 0.05, label: 'Fatigue gain',
    note: 'Multiplies fatigue gained while marching, running, routing, charging or in melee on both sides; resting and recovery stay the same. Saved for later practice battles too.',
  }],
  battleSpeed: ['rules.battleSpeed', {
    tab: 'Rules', type: 'range', default: 1, min: 0.5, max: 2, step: 0.05, label: 'Battle speed',
    note: 'Multiplies how fast battle time runs at every game speed (1x/2x/4x).',
  }],
  // A game value, not sourced: about 15% per hour of close action (src/game.js commandStep).
  commanderRisk: ['rules.commanderRisk', {
    tab: 'Rules', type: 'range', default: 15, min: 0, max: 60, step: 1, label: 'Commander risk',
    note: 'Chance in percent per hour of close action that a general or brigade commander within 120 m of fire is hit: half wounded, half killed. 0: commanders are never hit.',
  }],
};

export const RULES = {};
for (const [name, [key, spec]] of Object.entries(SPECS)) {
  RULES[name] = define(key, spec);
  on(key, (v) => { RULES[name] = v; });
}
