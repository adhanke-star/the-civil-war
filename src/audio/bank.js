// src/audio/bank.js: the sound bank manifest (DESIGN §4 Sound and Music). Pure data, no DOM: Node tests read it.
//
// Every file under assets/audio/ is listed here once, with its bank (what loads it), bus (which volume slider governs
// it), role, licence and a short credit; ATTRIBUTION.md carries the full source rows (page URL, author, what was cut).
// Banks load lazily and only after the first user gesture (src/audio/mixer.js):
//   battle   one-shots and loops for a field route (decoded once; about 2 MB of files)
//   ambient  one wind/birds loop per season, loaded for the season of the field's scenario
//   music    streamed through an <audio> element (never decoded up front), title/camp/results/lament only
// Recordings were cut and normalised once with ffmpeg (effects mono 96 kbps MP3, music stereo 112 kbps MP3).

export const AUDIO_DIR = 'assets/audio/';
/** Budgets the CPU test holds the files to (bytes). */
export const AUDIO_BUDGET = Object.freeze({ effects: 4 * 1024 * 1024, music: 8 * 1024 * 1024, file: 2.5 * 1024 * 1024 });
export const ALLOWED_LICENCES = Object.freeze(['CC0 1.0', 'Public domain', 'CC BY']);

const CC0 = 'CC0 1.0', PD = 'Public domain';
const s = (file, bank, bus, role, licence, credit, extra = {}) => Object.freeze({ file, bank, bus, role, licence, credit, ...extra });

export const SOUNDS = Object.freeze({
  'volley-1': s('sfx/volley-1.mp3', 'battle', 'effects', 'volley', CC0, 'Mixed from single musket shots by mlsulli, bruno.auzet and fennelliott (Freesound)'),
  'volley-2': s('sfx/volley-2.mp3', 'battle', 'effects', 'volley', CC0, 'Mixed from single musket shots by mlsulli, bruno.auzet and fennelliott (Freesound)'),
  'volley-3': s('sfx/volley-3.mp3', 'battle', 'effects', 'volley', CC0, 'Mixed from single musket shots by mlsulli, bruno.auzet and fennelliott (Freesound)'),
  'shot-1': s('sfx/shot-1.mp3', 'battle', 'effects', 'shot', CC0, 'Musket shot, mlsulli (Freesound)'),
  'shot-2': s('sfx/shot-2.mp3', 'battle', 'effects', 'shot', CC0, 'Old musket, outdoors, bruno.auzet (Freesound)'),
  cannon: s('sfx/cannon.mp3', 'battle', 'effects', 'cannon', CC0, 'Cannon at a Civil War reenactment, adeluc4 (Freesound)'),
  'shell-burst': s('sfx/shell-burst.mp3', 'battle', 'effects', 'burst', CC0, 'Grenade burst pitched down, vabadus (Freesound)'),
  'fire-bed': s('sfx/fire-bed.mp3', 'battle', 'effects', 'bed', CC0, 'Civil War reenactment from a distance, electra (Freesound)', { loop: true }),
  cheer: s('sfx/cheer.mp3', 'battle', 'voices', 'cheer', CC0, 'Massed war cry at a reenactment, joelcarrsound (Freesound)'),
  'call-charge': s('sfx/call-charge.mp3', 'battle', 'effects', 'call', PD, 'Charge, US Air Force Heritage of America Band'),
  'call-attention': s('sfx/call-attention.mp3', 'battle', 'effects', 'call', PD, 'Attention, US Army Ceremonial Band'),
  'call-recall': s('sfx/call-recall.mp3', 'battle', 'effects', 'call', PD, 'Recall, US Army Bands'),
  'call-retreat': s('sfx/call-retreat.mp3', 'battle', 'effects', 'call', PD, 'Retreat (the modern evening call), US Army Bands'),
  'drum-march': s('sfx/drum-march.mp3', 'battle', 'effects', 'call', CC0, 'Field drums, The US Army Old Guard Fife and Drum Corps'),
  'drum-quick': s('sfx/drum-quick.mp3', 'battle', 'effects', 'call', CC0, 'Field drums, The US Army Old Guard Fife and Drum Corps'),
  'horse-gallop': s('sfx/horse-gallop.mp3', 'battle', 'effects', 'horses', CC0, 'Horse galloping, Max_Headroom (Freesound)', { loop: true }),
  'horse-whinny': s('sfx/horse-whinny.mp3', 'battle', 'effects', 'horses', CC0, 'Distant whinny, L.Finck (Freesound)'),
  'amb-spring': s('sfx/amb-spring.mp3', 'ambient', 'ambient', 'ambient', CC0, 'Spring meadow, birdsong and soft wind, rubindaniel (Freesound)', { loop: true }),
  'amb-autumn': s('sfx/amb-autumn.mp3', 'ambient', 'ambient', 'ambient', CC0, 'Open field wind, Globofonia (Freesound)', { loop: true }),
  'amb-winter': s('sfx/amb-winter.mp3', 'ambient', 'ambient', 'ambient', CC0, 'Cold winter wind with sparse birds, szegvari (Freesound)', { loop: true }),
  'music-title': s('music/title.mp3', 'music', 'music', 'title', CC0, 'Brandywine Quickstep, The US Army Old Guard Fife and Drum Corps', { stream: true }),
  'music-camp': s('music/camp.mp3', 'music', 'music', 'camp', PD, 'Tenting Tonight on the Old Camp Ground (Kittredge, 1863), US Army Field Band and Chorus', { stream: true }),
  'music-results': s('music/results.mp3', 'music', 'music', 'results', PD, 'When Johnny Comes Marching Home (Gilmore, 1863), US Navy Band Brass Quartet', { stream: true }),
  'music-lament': s('music/lament.mp3', 'music', 'music', 'lament', PD, 'Nearer, My God, to Thee (Mason, 1856), US Air Force Band Ceremonial Brass', { stream: true }),
});

/** One short call per order kind: the sound id and the label that says which call it is (never captioned as history). */
export const ORDER_CALLS = Object.freeze({
  move: { id: 'drum-march', label: 'Field drum, march beat (The Old Guard Fife and Drum Corps)' },
  run: { id: 'drum-quick', label: 'Field drum, quick beat (The Old Guard Fife and Drum Corps)' },
  attack: { id: 'call-attention', label: 'Bugle: Attention (modern US Army call)' },
  charge: { id: 'call-charge', label: 'Bugle: Charge (the US service call)' },
  hold: { id: 'call-recall', label: 'Bugle: Recall (modern US Army call; nearest recording to a halt)' },
  halt: { id: 'call-recall', label: 'Bugle: Recall (modern US Army call; nearest recording to a halt)' },
  holdfire: { id: 'call-recall', label: 'Bugle: Recall (modern US Army call; nearest recording to cease firing)' },
  fallback: { id: 'call-retreat', label: 'Bugle: modern US Army "Retreat" (the evening flag call), used as a fall-back cue; not the 1862 tactical signal' },
});

/** The ambient loop for a scenario season (summer fields use the spring meadow; Bull Run has no season set). */
export const AMBIENT_BY_SEASON = Object.freeze({ spring: 'amb-spring', summer: 'amb-spring', autumn: 'amb-autumn', winter: 'amb-winter' });
export const ambientFor = (season) => AMBIENT_BY_SEASON[season] || AMBIENT_BY_SEASON.summer;

/** Music moods (DESIGN §4: title, camp and results only; a lament after heavy losses; nothing over battle). */
export const MOODS = Object.freeze({ title: 'music-title', camp: 'music-camp', results: 'music-results', lament: 'music-lament' });

/** Ids in one bank (the ambient bank: only the season's loop). */
export function bankIds(bank, { season } = {}) {
  if (bank === 'ambient') return [ambientFor(season)];
  return Object.keys(SOUNDS).filter((id) => SOUNDS[id].bank === bank);
}

/**
 * Called only by an explicit departure gesture. Fetch complete recorded battle/season files without
 * decoding or playing them; the existing worker owns hash verification and durable admission.
 * The client deadline closes this attempt. An already dispatched worker acquisition may still finish.
 */
export async function prepareBattleRecordings(resolveScenario, {
  isCurrent = () => true, signal = null, fetcher = globalThis.fetch, deadlineMs = 6000,
} = {}) {
  const controller = new AbortController();
  let closed = false, cancelled = false, deadlineHit = false, available = 0, requested = 0, next = 0, timer, finishEarly;
  const stale = () => { try { return cancelled || signal?.aborted === true || !isCurrent(); } catch { return true; } };
  const current = () => !closed && !stale();
  const early = new Promise(resolve => { finishEarly = resolve; });
  const stop = () => { cancelled = true; if (!closed) { closed = true; controller.abort(); finishEarly('cancelled'); } };
  const run = async () => {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10000
      || typeof resolveScenario !== 'function' || !current()) return 'cancelled';
    const scenario = await resolveScenario(controller.signal);
    if (!current()) return 'cancelled';
    if (!scenario || typeof scenario !== 'object') return 'unavailable';
    const ids = [...bankIds('battle'), ...bankIds('ambient', { season: scenario.season })];
    requested = ids.length;
    if (ids.length !== 18 || new Set(ids).size !== 18) return 'unavailable';
    const worker = async () => {
      while (current() && next < ids.length) {
        const id = ids[next++];
        let reader, response, drained = false;
        try {
          if (!SOUNDS[id] || SOUNDS[id].stream) throw new Error('Unavailable recording');
          const url = new URL('../../' + AUDIO_DIR + SOUNDS[id].file, import.meta.url).href;
          response = await fetcher(url, { signal: controller.signal });
          if (!current()) return;
          const rawLength = response.headers.get('content-length'), length = Number(rawLength);
          if (response.status !== 200 || response.type !== 'basic' || response.headers.get('content-range') !== null
            || !rawLength || !/^\d+$/.test(rawLength) || !Number.isSafeInteger(length)
            || length < 1 || length > AUDIO_BUDGET.file) throw new Error('Incomplete recording response');
          reader = response.body.getReader();
          let bytes = 0;
          while (current()) {
            const chunk = await reader.read();
            if (!current()) return;
            if (chunk.done) { drained = true; break; }
            bytes += chunk.value.byteLength;
            if (bytes > length || bytes > AUDIO_BUDGET.file) throw new Error('Recording body exceeds its bound');
          }
          if (current() && bytes === length) available++;
        } catch { /* Missing recordings do not prevent the original departure. */ }
        finally {
          // A foreign or stuck body must not hold departure after cancellation/deadline.
          if (!drained) try { Promise.resolve(reader ? reader.cancel() : response?.body?.cancel()).catch(() => {}); } catch {}
          try { reader?.releaseLock(); } catch {}
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return available === requested ? 'complete' : 'unavailable';
  };
  let outcome;
  if (stale()) return Object.freeze({ complete: false, available: 0, requested: 0, cancelled: true, reason: 'cancelled' });
  signal?.addEventListener('abort', stop, { once: true });
  globalThis.addEventListener?.('pagehide', stop, { once: true });
  timer = setTimeout(() => {
    if (closed) return;
    deadlineHit = true; closed = true; controller.abort(); finishEarly('deadline');
  }, deadlineMs);
  try { outcome = await Promise.race([run().catch(() => 'unavailable'), early]); }
  finally {
    closed = true; clearTimeout(timer);
    if (stale() || deadlineHit) controller.abort();
    signal?.removeEventListener('abort', stop);
    globalThis.removeEventListener?.('pagehide', stop);
  }
  const reason = stale() ? 'cancelled' : deadlineHit ? 'deadline' : outcome;
  return Object.freeze({ complete: reason === 'complete' && requested === 18 && available === requested,
    available, requested, cancelled: reason === 'cancelled', reason });
}
