// src/ui/look.js: the field readability choices Aaron can switch in the sandbox (tab Look), kept live in LOOK.
//
// Same pattern as src/sim/rules.js: each value is defined once in src/settings.js and mirrored into LOOK for
// cheap reads in per-frame code. Modules that must react at once (rebuild a mesh, hide a list) also call on().

import { define, on } from '../settings.js';

const SPECS = {
  orderLine: ['look.orderLine', {
    tab: 'Look', type: 'choice', default: 'pencil', compare: true, label: 'Order line',
    options: [{ value: 'pencil', label: 'Pencil: thin dashed line' }, { value: 'arrow', label: 'Arrow: wide translucent arrow' }],
    note: 'How a marching brigade\'s route is drawn: a staff-map pencil line with a small arrowhead, or the big UG-style arrow.',
  }],
  statusWords: ['look.statusWords', {
    tab: 'Look', type: 'toggle', default: true, label: 'Status words on flags',
    note: 'Shows what each brigade is doing (Advancing, Firing, Halted to fire...) under its flag.',
  }],
  engagementLines: ['look.engagementLines', {
    tab: 'Look', type: 'toggle', default: true, label: 'Engagement lines',
    note: 'A faint line from each firing unit to its target, thicker where the fire is heavier; one small mesh, no measurable cost.',
  }],
  casualtyTicks: ['look.casualtyTicks', {
    tab: 'Look', type: 'toggle', default: true, label: 'Casualty numbers',
    note: 'Small numbers rise from a brigade as it loses men, gathered once a second per brigade.',
  }],
  eventFeed: ['look.eventFeed', {
    tab: 'Look', type: 'toggle', default: true, label: 'Event feed',
    note: 'A short list of the last six events with their time; click one to fly the camera there.',
  }],
  figureStyle: ['look.figureStyle', {
    tab: 'Look', type: 'choice', default: 'rigged', compare: true, label: 'Soldier figures',
    options: [{ value: 'rigged', label: 'Rigged: today\'s 3D figures' }, { value: 'baked', label: 'Baked: sprites rendered in Blender' }],
    note: 'Baked sprites carry the bake\'s lighting and short soft shadow (the shadow does not turn with the camera) and load about 2.7 MB '
      + '(two looks, mixed through the ranks), plus 3.5 MB when you zoom in close. Only a Union infantryman is baked: Confederates are the same man tinted grey (a placeholder); '
      + 'officers, gun crews and horses stay 3D.',
  }],
  menPerFigure: ['look.menPerFigure', {
    tab: 'Look', type: 'choice', default: 10, label: 'Men per figure',
    options: [{ value: 10, label: '1 figure per 10 men' }, { value: 5, label: '1 figure per 5 men' }],
    note: 'Re-forms every infantry brigade at once. 1 per 5 draws twice the soldiers: denser lines, about twice the figure cost.',
  }],
  figureScale: ['look.figureScale', {
    tab: 'Look', type: 'range', default: 1, min: 0.6, max: 1.6, step: 0.05, label: 'Figure size',
    note: 'Draws every soldier larger or smaller, in both figure styles (guns, limber teams and slot spacing keep their size). Larger costs a little fill rate.',
  }],
  saturation: ['look.saturation', {
    tab: 'Look', type: 'range', default: 0.86, min: 0, max: 1.5, step: 0.01, label: 'Colour saturation',
    note: 'Changes battlefield colour intensity; 0 is muted, 0.86 keeps the current grade. Leaves HUD colours and lighting unchanged.',
  }],
  tiltShift: ['look.tiltShift', {
    tab: 'Look', type: 'range', default: 0.9, min: 0, max: 1, step: 0.05, label: 'Tilt-shift blur',
    note: 'Softens the far and near edges of the view; 0 removes this blur, 0.9 keeps the current look. Camera tilt and zoom stay unchanged.',
  }],
  smoke: ['look.smoke', {
    tab: 'Look', type: 'toggle', default: true, label: 'Battle smoke',
    note: 'Shows musket and cannon smoke; off clears existing clouds and cancels queued puffs. Reduced motion also suppresses smoke; sound and combat stay unchanged.',
  }],
  markerScale: ['look.markerScale', {
    tab: 'Look', type: 'range', default: 1, min: 0.75, max: 1.75, step: 0.05, label: 'Marker size',
    note: 'Sizes brigade flags and morale bars; 1 keeps the current size. Text and tap targets keep their minimum size; soldiers and formations stay unchanged.',
  }],
  formationSpacing: ['look.formationSpacing', {
    tab: 'Look', type: 'range', default: 1, min: 0.75, max: 1.5, step: 0.05, label: 'Formation spacing',
    note: 'Spreads infantry files, ranks and skirmishers; 1 keeps the current layout. Picking, combat contact and order ghosts use the changed footprint. Men, figure count and brigade centres stay unchanged; batteries keep their spacing. Applies in practice too.',
  }],
  cameraElevation: ['look.cameraElevation', {
    tab: 'Look', type: 'range', default: 0, min: -15, max: 30, step: 1, label: 'Camera elevation',
    note: 'Adds degrees to the zoom-dependent viewing angle; 0 keeps the current view. Positive looks farther down. Keeps view centre, distance and units; pointer projection follows the new angle.',
  }],
  xFactorStyle: ['look.xFactorStyle', {
    tab: 'Moments', type: 'choice', default: 'full', label: 'X-Factor effects',
    options: [{ value: 'full', label: 'Full' }, { value: 'subtle', label: 'Subtle' }, { value: 'off', label: 'Off' }],
    note: 'Full shows a short banner, warm line glow and sound sting. Subtle keeps a static banner; Off clears all cues. Reduced motion uses Subtle. Previews earn no badge or combat bonus.',
  }],
};

export const LOOK = {};
for (const [name, [key, spec]] of Object.entries(SPECS)) {
  LOOK[name] = define(key, spec);
  on(key, (v) => { LOOK[name] = v; });
}
