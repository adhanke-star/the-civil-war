// Title/camp have no renderer; load the field only when a field route is chosen.
// Music (src/audio/music.js): the title and camp tunes follow the entry's mode (window.__entry.mode, read twice a
// second); nothing loads or plays before the first tap, click or key press (the mixer arms on the first gesture).
import { mixer } from './audio/mixer.js';
import { playMusic, stopMusic } from './audio/music.js';

const q = new URLSearchParams(location.search);
if (['intro', 'practice', 'battle', 'sandbox', 'tune', 'sandbox-battle'].some((key) => q.has(key))) {
  document.getElementById('battle').hidden = false;
  try { await (await import('./main.js')).startField(); }
  catch (error) {
    // Keep the reason (info, not error: the field-admission probes require a console free of errors and warnings).
    console.info('field: load failed', String(error?.stack ?? error));
    const { showFieldFailure } = await import('./ui/entry.js');
    showFieldFailure({ message: `${error?.message ?? 'The field could not be loaded.'} Your saved army is unchanged. Return to camp and try again.` });
  }
} else {
  mixer.arm();
  let mood;
  const follow = () => {
    const mode = window.__entry?.mode, next = mode === 'camp' ? 'camp' : mode === 'title' ? 'title' : null;
    if (next === mood) return;
    if (next) playMusic(next);
    else if (mood) { stopMusic(); clearInterval(timer); } // the entry left (a field took the page): stop following
    mood = next;
  };
  const timer = setInterval(follow, 500);
  const { mountEntry } = await import('./ui/entry.js');
  mountEntry({ camp: q.has('camp') || q.has('saved'), deploy: q.has('saved'),
    onDeploy: async (options) => {
      const field = await import('./main.js');
      if (!options.isCurrent()) throw new Error('Practice: deployment review was cancelled.');
      return field.startField(options);
    } });
  follow();
}
// Entry pages also participate in the installed app's existing cache.
// https (Pages); ?sw also registers it on a local server so CI can test offline play
if ((location.protocol === 'https:' || q.has('sw')) && 'serviceWorker' in navigator && !q.has('nosw')) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((err) => console.warn('service worker not registered:', err.message));
}
