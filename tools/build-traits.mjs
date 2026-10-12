// tools/build-traits.mjs: build assets/traits.json (enemy commanders' sourced temperament traits, DESIGN §4b "AI character")
// from the checked-in research copy tools/data/cs-traits-verified.json (every quote opened and re-checked; dropped traits
// listed there). Contract P3t.
//
//   node tools/build-traits.mjs           write assets/traits.json
//   node tools/build-traits.mjs --check   write nothing; exit 1 when the shipped file differs from a fresh build
//
// It keeps exactly the traits, evidence, sources and provenance the research keeps; it adds the game's words for each trait
// (vocabulary: a plain label that describes conduct, a brief phrase for the unit card, and the game rule it drives, built from
// src/franchise/tuning.js TRAITS so the text cannot drift from the numbers), a short note for three men (how the game words a disputed judgment; Chalmers at Fort
// Pillow), and it moves three research-process sentences out of the claims into `researchNote` (kept, not shown in play).
// Refuses: an unknown trait, a trait the research dropped, a trait without evidence or a source without its URL, page or quote,
// and a Verified man whose trait rests on fewer than two independent organisations. Output is deterministic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TRAITS, DIFFICULTY } from '../src/franchise/tuning.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RESEARCH_FILE = path.join(ROOT, 'tools', 'data', 'cs-traits-verified.json');
export const TRAITS_FILE = path.join(ROOT, 'assets', 'traits.json');
export const PROVENANCE = Object.freeze(['Verified', 'Inferred', 'Disputed']);
const fail = (m) => { throw new Error('build-traits: ' + m); };
const n = (v) => String(Math.round(v * 100) / 100);
const nth = (v) => `${v}${v % 10 === 1 && v % 100 !== 11 ? 'st' : v % 10 === 2 && v % 100 !== 12 ? 'nd' : v % 10 === 3 && v % 100 !== 13 ? 'rd' : 'th'}`;
const T = TRAITS, V = DIFFICULTY.veteran;

/** The game's words for each trait: a plain label describing conduct, and the game rule it drives (numbers from TRAITS). */
export const VOCABULARY = Object.freeze({
  aggressive: { label: 'Quick to attack', brief: 'attacks and commits reserves sooner', effect: `Game rule: his formations begin their attacks and reserve moves ${n(-T.aggressive.start)} s sooner, a reserve commits when an enemy comes within ${n(T.aggressive.reach)} times the usual distance, and a stopped or repulsed attacker goes forward again in half the time.` },
  impetuous: { label: 'Goes in without waiting', brief: 'steps off early and waits less for the formations beside it', effect: `Game rule: his formations step off ${n(-T.impetuous.start)} s before their set time and wait only a quarter as long for the formations beside them.` },
  cautious: { label: 'Holds back', brief: 'starts later, keeps reserves back longer and falls back sooner', effect: `Game rule: his formations begin attacks and reserve moves ${n(T.cautious.start)} s later, a reserve commits only when an enemy is within ${n(T.cautious.reach)} times the usual distance, a stopped march is renewed ${n(T.cautious.reissue)} times more slowly, and a shaken formation falls back when the nearest enemy outnumbers it.` },
  stubborn: { label: 'Holds on', brief: 'gives ground only against heavier odds', effect: `Game rule: a formation holding its ground falls back only when the nearest enemy has ${n(T.stubborn.hold)} times its men (usually: any more men).` },
  methodical: { label: 'Prepares and coordinates', brief: 'waits to move with the formations beside it', effect: `Game rule: once begun, an attacker or reserve waits up to ${n(T.methodical.wait)} s for the other formations sharing its objective, and never renews a stopped march sooner than usual.` },
  'skilled-defender': { label: 'Defends well', brief: 'counter-attacks a breakthrough and takes nearby cover', effect: `Game rule: a holding brigade counter-attacks an enemy that breaks into its position or past a routing friend within ${n(T['skilled-defender'].counter.range)} m, and before the enemy comes within ${n(T['skilled-defender'].cover.clear)} m it moves once to better cover within ${n(T['skilled-defender'].cover.search)} m.` },
  slow: { label: 'Slow to act', brief: 'reacts and renews its orders more slowly', effect: `Game rule: his formations decide only every ${nth(T.slow.pass)} time the AI looks (every ${n(V.interval * T.slow.pass)} s instead of ${n(V.interval)} s at Veteran) and renew a stopped march ${n(T.slow.reissue)} times more slowly.` },
  reckless: { label: 'Led from the front', brief: 'he is more likely to be hit', effect: `Game rule: he rides where the fighting is, so fire within ${n(120 * T.reckless.danger)} m of him (usually 120 m) puts him at risk of being wounded or killed.` },
});

// How the game words three men's records (from the research's provenance notes). kind 'record': part of his record, shown on
// his unit card (Chalmers at Fort Pillow); kind 'wording': why the game words a judgment as it does (the details view only).
const NOTES = Object.freeze({
  'Albert Sidney Johnston': { kind: 'wording', text: 'Shown as "led from the front": the sources agree he was ahead of his main line when he was hit (ABT: he rode ahead of his troops; NPS: he was personally directing his reserves); whether that was reckless is a judgment they frame differently.' },
  'Leonidas Polk': { kind: 'wording', text: 'The delay at Chickamauga on 20 September 1863 is agreed; the blame is disputed (Bragg accused Polk; the NPS series gives miscommunication), so the game states the delay, not disobedience.' },
  'James R. Chalmers': { kind: 'record', text: 'Chalmers commanded the Confederate force on the field at Fort Pillow, Tennessee, on 12 April 1864, an attack that ended with the massacre of surrendered Black Union soldiers.',
    sources: [{ title: 'James Ronald Chalmers', author: 'National Park Service', url: 'https://www.nps.gov/people/james-ronald-chalmers.htm', page: 'web page, no pagination',
      quote: 'commanded the Confederate force on the field in the attack on Fort Pillow, Tennessee, which ended with a massacre of surrender[ed] Federal African American soldiers' }] },
});

// Research-process sentences moved out of the shown claim into `researchNote` (each must be found verbatim).
const PROCESS = Object.freeze({
  'Albert Sidney Johnston/reckless': "The 'tourniquet in pocket' detail is in both ABT and NPS; the 'sent his surgeon away' detail was NOT found in any opened source and is dropped.",
  'Braxton Bragg/stubborn': "CORRECTION: the earlier claim that he held on 3 Jan against his corps commanders' advice is refuted by the NPS series ('most of Bragg's lieutenants ... approved of the retreat'); that clause is removed.",
  'William J. Hardee/methodical': "The earlier claim about an 'orderly corps at Shiloh/Perryville/Stones River' is not supported in these terms; the supported claim is authorship plus training.",
});

/** The organisation behind a source (ABT pages count as one; so do NPS pages). */
export const organisation = (s) => String(s.author || '').split(/[,(]/)[0].trim();
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const httpUrl = (v) => text(v) && /^https?:\/\/[^\s]+$/.test(v);
function source(s, where) {
  if (!s || !text(s.title) || !text(s.author) || !httpUrl(s.url) || !text(s.page) || !text(s.quote)) fail(`${where}: a source needs its title, author, http(s) url, page and quote.`);
  return { title: s.title, author: s.author, url: s.url, page: s.page, quote: s.quote };
}

/** assets/traits.json from the research object (a plain object; nothing is read or written here). */
export function buildTraitsFrom(research) {
  if (!research || !Array.isArray(research.commanders) || !research.commanders.length) fail('the research lists no commanders.');
  const unused = new Set(Object.keys(PROCESS));
  const commanders = {};
  for (const c of research.commanders) {
    const name = c?.name;
    if (!text(name) || Object.prototype.hasOwnProperty.call(commanders, name)) fail(`a commander needs a unique name (${name}).`);
    const traits = Array.isArray(c.traits) ? [...c.traits] : [];
    if (!traits.length || traits.length > 3 || new Set(traits).size !== traits.length) fail(`${name}: 1 to 3 distinct traits.`);
    for (const t of traits) if (!T.keys.includes(t)) fail(`${name}: unknown trait "${t}".`);
    const dropped = (Array.isArray(c.dropped) ? c.dropped : []).map((d) => ({ trait: String(d.trait), why: String(d.why) }));
    for (const d of dropped) if (traits.includes(d.trait)) fail(`${name}: keeps "${d.trait}", which the research dropped.`);
    if (!PROVENANCE.includes(c.provenance)) fail(`${name}: provenance must be Verified, Inferred or Disputed.`);
    if (!Array.isArray(c.evidence) || c.evidence.length !== traits.length || traits.some((t) => c.evidence.filter((e) => e?.trait === t).length !== 1)) {
      fail(`${name}: exactly one evidence entry per kept trait.`);
    }
    const evidence = traits.map((t) => {
      const e = c.evidence.find((x) => x.trait === t), key = `${name}/${t}`;
      if (!text(e.claim) || !Array.isArray(e.sources) || !e.sources.length) fail(`${key}: evidence needs a claim and at least one opened source.`);
      const sources = e.sources.map((s, i) => source(s, `${key} source ${i + 1}`));
      if (c.provenance === 'Verified' && new Set(sources.map(organisation)).size < 2) fail(`${key}: a Verified man's trait needs sources from two independent organisations.`);
      let claim = e.claim, researchNote;
      if (PROCESS[key]) {
        if (!claim.includes(PROCESS[key])) fail(`${key}: the research-process sentence to move is not in the claim.`);
        claim = claim.replace(PROCESS[key], '').replace(/\s+$/, '');
        researchNote = PROCESS[key];
        unused.delete(key);
      }
      return { trait: t, claim, ...(researchNote ? { researchNote } : {}), sources };
    });
    const note = NOTES[name] ? { kind: NOTES[name].kind, text: NOTES[name].text, ...(NOTES[name].sources ? { sources: NOTES[name].sources.map((s, i) => source(s, `${name} note source ${i + 1}`)) } : {}) } : null;
    commanders[name] = { side: 'CS', traits, provenance: c.provenance, provenanceNote: text(c.provenance_note) ? c.provenance_note : '', evidence, ...(note ? { note } : {}), dropped };
  }
  if (unused.size) fail(`process sentences for men not in the research: ${[...unused].join(', ')}.`);
  for (const name of Object.keys(NOTES)) if (!commanders[name]) fail(`a note for ${name}, who is not in the research.`);
  const meta = research.meta || {};
  return {
    version: 1,
    about: 'Enemy commanders\' temperament traits (DESIGN §4b). Generated by tools/build-traits.mjs from tools/data/cs-traits-verified.json; never edit by hand. Traits are history (each claim with its opened sources); their effects are game rules (src/franchise/tuning.js TRAITS).',
    researched: text(meta.date) ? meta.date : '',
    method: text(meta.method) ? meta.method : '',
    independence: text(meta.independence_note) ? meta.independence_note : '',
    notRun: text(meta.not_run) ? meta.not_run : '',
    vocabulary: Object.fromEntries(T.keys.map((k) => [k, { label: VOCABULARY[k].label, brief: VOCABULARY[k].brief, effect: VOCABULARY[k].effect }])),
    commanders,
  };
}

export const readResearch = () => JSON.parse(fs.readFileSync(RESEARCH_FILE, 'utf8'));
export const serializeTraits = (value) => JSON.stringify(value, null, 1) + '\n';
export const buildTraits = () => buildTraitsFrom(readResearch());

const direct = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (direct) {
  const out = buildTraits(), textOut = serializeTraits(out);
  const summary = Object.entries(out.commanders).map(([name, c]) => `${name}: ${c.traits.join(', ')} (${c.provenance})`).join('\n  ');
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(TRAITS_FILE) && fs.readFileSync(TRAITS_FILE, 'utf8') === textOut;
    console.log(same ? `TRAITS UP TO DATE (${Buffer.byteLength(textOut)} bytes)` : 'TRAITS DIFFER from a fresh build (run node tools/build-traits.mjs)');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(TRAITS_FILE, textOut);
  console.log(`TRAITS WRITTEN assets/traits.json (${Buffer.byteLength(textOut)} bytes, ${Object.keys(out.commanders).length} commanders)\n  ${summary}`);
}
