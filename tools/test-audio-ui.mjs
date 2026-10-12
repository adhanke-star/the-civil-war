// Browser checks for recorded sound, music, the Settings panel, the gore toggle and HUD feedback readability (P6a).
// `audioControls({ browser, url, check, shot, result, watchErrors })`, registered in tools/test.mjs shard 1 as `--audio`.
// 1. Title: no request under assets/audio (and no AudioContext) before a gesture; after one click the title tune
//    streams (src/audio/music.js currentMood() is 'title').
// 2. Battle (?sandbox&quality=low): after a click the battle bank loads; a volley through the real effects seam plays a
//    recorded volley (spied on window.__game.audio.mixer.log, no audio output needed); a Hold order (H) plays its call.
// 3. Settings panel: O opens it with focus inside, the keyboard moves a volume and it persists, Escape closes it and
//    focus returns to the field; the strip's button opens it and Close returns focus to the button; axe clean; 320 px
//    fits with 44 px controls.
// 4. Gore off: a casualty laid in the real fallen pool is hidden after the fade (battle clock), gore on restores him.
// 5. Feed and toasts: no box (transparent feed, translucent row backing, text shadow), at most 3 rows in view, clear of
//    the objective line and the dock, at 1280x720 and 320x568 (screenshots).
import { AxeBuilder } from '@axe-core/playwright';

const settle = (page) => page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));

export async function audioControls({ browser, url, check, shot, result, watchErrors }) {
  // ---- 1. title: nothing before a gesture ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
    try {
      await ctx.addInitScript(() => {
        window.__audioContexts = 0;
        const AC = window.AudioContext;
        if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__audioContexts++; } };
      });
      const page = await ctx.newPage(), errors = [], requests = [];
      watchErrors(page, url, errors);
      page.on('request', (r) => requests.push(new URL(r.url()).pathname));
      await page.goto(url + '?nosw');
      await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const before = await page.evaluate(() => window.__audioContexts);
      check('audio-title-no-request', !requests.some((p) => /assets\/audio\//.test(p)) && before === 0,
        `${requests.filter((p) => /assets\/audio\//.test(p)).join(', ') || 'no audio request'}; ${before} AudioContext before a gesture`);
      result.audioTitleRequests = requests.filter((p) => /audio/.test(p));
      const heading = page.locator('#entry-title-heading');
      if (await heading.count()) await heading.click(); else await page.mouse.click(4, 4);
      await page.waitForFunction(async () => (await import('./src/audio/music.js')).currentMood() === 'title', null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      const mood = await page.evaluate(async () => (await import('./src/audio/music.js')).currentMood());
      check('audio-title-after-gesture', mood === 'title' && requests.some((p) => p.endsWith('/assets/audio/music/title.mp3')),
        `mood ${mood}; title tune requested: ${requests.some((p) => p.endsWith('/assets/audio/music/title.mp3'))}`);
      check('audio-title-no-errors', errors.length === 0, errors.join('\n') || '0 errors');
    } finally { await ctx.close(); }
  }

  // ---- 2-5. the battlefield ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage(), errors = [];
    watchErrors(page, url, errors);
    await page.goto(`${url}?sandbox&quality=low&nosw`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready && window.__game, null, { timeout: 180000 });
    if ((await page.locator('#sb-toggle').getAttribute('aria-expanded').catch(() => null)) === 'true') await page.locator('#sb-toggle').click();
    await page.locator('#battlefield').click({ position: { x: 640, y: 300 } }); // the first gesture
    await page.waitForFunction(() => { const s = window.__game.audio.mixer.stats(); return s.state === 'running' && ['volley-1', 'cannon', 'fire-bed', 'call-recall'].every((id) => s.loaded.includes(id)); }, null, { timeout: 60000 })
      .catch(() => {});
    const stats = await page.evaluate(() => window.__game.audio.mixer.stats());
    check('audio-battle-bank', stats.state === 'running' && ['volley-1', 'cannon', 'fire-bed', 'call-recall'].every((id) => stats.loaded.includes(id)) && !stats.loaded.some((id) => id.startsWith('music-')),
      `${stats.state}; loaded ${stats.loaded.join(', ')}`);
    if (await page.evaluate(() => window.__game.game.paused)) await page.locator('#pause').click();
    const volley = await page.evaluate(async () => {
      const { game, effects, audio } = window.__game, n = audio.mixer.log.length;
      const u = game.units.find((x) => x.alive && x.type === 'infantry');
      await new Promise((r) => setTimeout(r, 200));
      effects.volley(u, [[u.x, u.z, 0]]);
      return audio.mixer.log.slice(n);
    });
    check('audio-volley-plays', volley.some((e) => /^(volley|shot)-\d$/.test(e.id) && e.ok && e.bus === 'effects'), JSON.stringify(volley));
    const call = await page.evaluate(async () => {
      const { game, audio } = window.__game, n = audio.mixer.log.length;
      const u = game.units.find((x) => x.alive && x.side === game.playerSide && game.controls(x) && x.canTakeOrders());
      game.select(u); document.getElementById('battlefield').focus();
      return { n, id: u?.id };
    });
    await page.keyboard.press('h'); await settle(page);
    const calls = await page.evaluate((n) => window.__game.audio.mixer.log.slice(n), call.n);
    check('audio-order-call', calls.some((e) => e.id === 'call-recall' && e.ok), `${call.id}: ${JSON.stringify(calls)}`);

    // ---- 3. the Settings panel ----
    await page.locator('#battlefield').focus(); await page.keyboard.press('o');
    await page.waitForSelector('#settings-panel[open]');
    const opened = await page.evaluate(() => ({ inside: document.getElementById('settings-panel').contains(document.activeElement), modal: document.querySelector('#settings-panel').matches(':modal') }));
    const master0 = await page.evaluate(async () => (await import('./src/settings.js')).get('audio.master'));
    await page.locator('#cws-audio-master').focus(); await page.keyboard.press('ArrowRight');
    const master1 = await page.evaluate(async () => (await import('./src/settings.js')).get('audio.master'));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cw.settings') || '{}')['audio.master']);
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const trapped = await page.evaluate(() => document.getElementById('settings-panel').contains(document.activeElement));
    await shot(page, 'audio-settings-1280');
    const axe = await new AxeBuilder({ page }).include('#settings-panel').analyze(); result.audioSettingsAxe = axe.violations;
    await page.keyboard.press('Escape'); await settle(page);
    const closed = await page.evaluate(() => ({ gone: !document.getElementById('settings-panel'), focus: document.activeElement?.id }));
    check('audio-settings-key', opened.inside && opened.modal && trapped && Math.abs(master1 - master0 - 0.05) < 1e-9 && saved === master1 && closed.gone && closed.focus === 'battlefield',
      JSON.stringify({ opened, master0, master1, saved, trapped, closed }));
    check('audio-settings-axe', axe.violations.length === 0, JSON.stringify(axe.violations.map((v) => v.id)));
    await page.locator('#settings-btn').click();
    await page.waitForSelector('#settings-panel[open]');
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await settle(page);
    check('audio-settings-button', await page.evaluate(() => !document.getElementById('settings-panel') && document.activeElement?.id === 'settings-btn'), 'the strip button opens it; Close returns focus to the button');
    check('audio-settings-help', await page.locator('#menu ul.keys').textContent().then((t) => /Settings.*\bO\b/.test(t)), 'the help sheet lists O for Settings');

    // ---- 4. gore off: the fallen fade ----
    const gore = await page.evaluate(async () => {
      const S = await import('./src/settings.js'), { game } = window.__game, p = game.fallen.US;
      S.set('look.gore', false);
      const i = p.alloc(); p.set(i, 0, 5, 0, 0, 4.4, false, 0, 0, false);
      const lying = p.clip.array[i];
      game.fastForward(9); // the fade runs on the battle clock
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const hidden = p.clip.array[i];
      S.set('look.gore', true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { lying, hidden, restored: p.clip.array[i], y: p.mesh.instanceMatrix.array[i * 16 + 13] };
    });
    check('audio-gore-fade', gore.lying === 0 && gore.hidden === 2 && gore.restored === 0 && Math.abs(gore.y - 5) < 1e-6, JSON.stringify(gore));

    // ---- 5. feed and toasts read on the field without a box ----
    const readable = async (label) => {
      await page.evaluate(() => {
        const { game, hud } = window.__game, u = game.units.find((x) => x.alive);
        for (let i = 0; i < 5; i++) game.event(`Fictional feed line ${i + 1} for the readability check (test only).`, u, 'info');
        hud.toast('Fictional toast for the readability check (test only).');
      });
      await settle(page);
      const r = await page.evaluate(() => {
        const rect = (e) => e.getBoundingClientRect(), feed = document.getElementById('feed'), fr = rect(feed);
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const css = getComputedStyle(feed), rows = [...feed.querySelectorAll('li')];
        const inView = rows.filter((li) => { const b = rect(li); return b.bottom > fr.top + 2 && b.top < fr.bottom - 2; });
        const span = feed.querySelector('li:last-child span'), back = getComputedStyle(span).backgroundColor;
        const alpha = Number((/rgba?\(([^)]+)\)/.exec(back)?.[1].split(',')[3] ?? '1').trim());
        const blocks = ['objective', 'unitcard', 'orders', 'minimap-box'].map((id) => document.getElementById(id)).filter((e) => e && !e.hidden && e.getClientRects().length);
        const toast = document.querySelector('#toasts p'), tr = toast ? rect(toast) : null, obj = document.getElementById('objective');
        return { feedBg: css.backgroundColor, feedShadow: css.boxShadow, rows: rows.length, inView: inView.length, alpha, shadow: getComputedStyle(feed.querySelector('button')).textShadow,
          clear: blocks.filter((b) => overlap(fr, rect(b))).map((b) => b.id), toastBg: toast ? getComputedStyle(toast).backgroundColor : null,
          toastClear: !tr || !obj.getClientRects().length || tr.top >= rect(obj).bottom - 1, toasts: document.querySelectorAll('#toasts p').length };
      });
      await shot(page, `audio-feed-${label}`);
      return r;
    };
    const wide = await readable('1280');
    const ok = (r) => r.feedBg === 'rgba(0, 0, 0, 0)' && r.feedShadow === 'none' && r.inView >= 1 && r.inView <= 3 && r.alpha > 0 && r.alpha < 1
      && r.shadow !== 'none' && r.clear.length === 0 && r.toastClear && r.toasts <= 3 && /rgba\(.*0\.\d+\)/.test(r.toastBg || '');
    check('audio-feed-1280', ok(wide), JSON.stringify(wide));
    await page.setViewportSize({ width: 320, height: 568 }); await settle(page); await page.waitForTimeout(300);
    const narrow = await readable('320');
    check('audio-feed-320', ok(narrow), JSON.stringify(narrow));
    await page.locator('#settings-btn').click(); await page.waitForSelector('#settings-panel[open]');
    const fit = await page.evaluate(() => {
      const d = document.getElementById('settings-panel'), r = d.getBoundingClientRect();
      const small = [...d.querySelectorAll('.cws-close, .cws-choice, .cws-check, input[type=range], summary')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).map((e) => e.className || e.tagName);
      const tiny = [...d.querySelectorAll('label, p, legend, summary, li, button')].filter((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => e.className || e.tagName);
      return { left: r.left, right: r.right, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, overflow: d.scrollWidth > d.clientWidth, small, tiny };
    });
    await shot(page, 'audio-settings-320');
    const axe320 = await new AxeBuilder({ page }).include('#settings-panel').analyze();
    await page.keyboard.press('Escape');
    check('audio-settings-320', fit.inView && !fit.overflow && fit.small.length === 0 && fit.tiny.length === 0 && axe320.violations.length === 0,
      JSON.stringify({ ...fit, axe: axe320.violations.map((v) => v.id) }));
    check('audio-no-console-errors', errors.length === 0, errors.join('\n') || '0 errors');
  } finally { await ctx.close(); }
}
