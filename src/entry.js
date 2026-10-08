// Title/camp have no renderer; load the field only when a field route is chosen.
const q = new URLSearchParams(location.search);
if (['intro', 'practice', 'battle', 'sandbox', 'tune'].some((key) => q.has(key))) {
  document.getElementById('battle').hidden = false;
  try { await (await import('./main.js')).startField(); }
  catch { const { showFieldFailure } = await import('./ui/entry.js'); showFieldFailure(); }
} else {
  const { mountEntry } = await import('./ui/entry.js');
  mountEntry({ camp: q.has('camp') || q.has('saved'), deploy: q.has('saved'),
    onDeploy: async (options) => {
      const field = await import('./main.js');
      if (!options.isCurrent()) throw new Error('Practice: deployment review was cancelled.');
      return field.startField(options);
    } });
}
// Entry pages also participate in the installed app's existing cache.
if (location.protocol === 'https:' && 'serviceWorker' in navigator && !q.has('nosw')) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('service worker not registered:', err.message));
}
