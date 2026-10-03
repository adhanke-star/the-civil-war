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
};

export const LOOK = {};
for (const [name, [key, spec]] of Object.entries(SPECS)) {
  LOOK[name] = define(key, spec);
  on(key, (v) => { LOOK[name] = v; });
}
