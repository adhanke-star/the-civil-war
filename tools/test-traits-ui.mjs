// Browser checks for enemy commanders' temperament traits (contract P3t). To be registered in tools/test.mjs (shard 4,
// `node tools/test.mjs --traits`). `traitsControls({ browser, url, check, shot, result, watchErrors })`. The shipped packs and
// assets/traits.json, no interception:
// 1. The field, Shiloh "Grant's last line" (?battle=shiloh&phase=grants-last-line): the enemy card of Chalmers's brigade shows
//    his traits ("Goes in without waiting", "Quick to attack") and his army commander's (Gen. P. G. T. Beauregard, "Holds
//    back") as plain labels, a "Game rule:" line, the provenance and the Fort Pillow note; the flag's tooltip names them; a
//    Union card shows none. By keyboard, "Records and sources" opens the Records dialog (focus on its title, the battle
//    paused) with each trait's claim and its sources as links; Tab reaches a link; Escape closes it, focus returns to the
//    button and the battle runs again. Axe (card, dialog), 320 px (card and dialog fit), screenshots. With his commander
//    down, the brigade keeps only the army commander's traits.
// 2. The Briefing of Shiloh "The camps at dawn" (mounted on the title page, as tools/test-art-ui.mjs does): "Opposing
//    commanders" lists Gen. Albert Sidney Johnston first ("Quick to attack", "Led from the front", Provenance: Disputed),
//    then Cleburne and Chalmers (with the Fort Pillow note); the disclosure opens by keyboard with each claim's sources as
//    links; axe, 320 px, screenshots.
import { AxeBuilder } from '@axe-core/playwright';

const FIELD = '?battle=shiloh&phase=grants-last-line&quality=low&nosw';
const CHALMERS = 'cs-chalmers-brigade';

export async function traitsControls({ browser, url, check, shot, result, watchErrors }) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), errors = []; watchErrors(page, url, errors);
  const axe = async (include, key) => {
    const a = await new AxeBuilder({ page }).include(include).analyze();
    const bad = a.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    result[key] = a.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    return bad.length ? bad.map((v) => `${v.impact} ${v.id}`).join(', ') : '';
  };
  const fits = (sel) => page.locator(sel).evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
  try {
    // ---- 1. the enemy card, the tooltip and the Records dialog ----
    await page.goto(url + FIELD);
    await page.waitForFunction(() => window.__ready === true && window.__game?.game, null, { timeout: 180000, polling: 250 });
    await page.evaluate(async (id) => {
      const { game } = window.__game, { RULES } = await import('./src/sim/rules.js');
      RULES.autoPause = false; // no arrival or rout alert may pause the field under the dialog's own pause check
      if (!game.paused) game.togglePause(); // a still field while the card is read
      game.select(game.units.find((u) => u.id === id));
    }, CHALMERS);
    await page.waitForFunction(() => { const b = document.getElementById('uc-traits'); return b && !b.hidden && b.querySelector('.uct-row'); }, null, { timeout: 30000 });
    // the flag tooltips refresh four times a second of frames
    await page.waitForFunction((id) => /Commander: /.test(window.__game.hud.markers.get(id)?.el.title ?? ''), CHALMERS, { timeout: 20000 }).catch(() => {});
    const card = await page.evaluate((id) => {
      const box = document.getElementById('uc-traits');
      return { rows: [...box.querySelectorAll('.uct-row')].map((r) => ({ who: r.dataset.who, name: r.querySelector('.uct-who')?.textContent,
        chips: [...r.querySelectorAll('.uct-chip')].map((c) => [c.textContent, c.title]), prov: r.querySelector('.uct-prov')?.textContent })),
        rule: box.querySelector('.uct-rule')?.textContent ?? '', note: box.querySelector('.uct-note')?.textContent ?? '',
        more: !!document.getElementById('uc-traits-more'), tip: window.__game.hud.markers.get(id)?.el.title ?? '' };
    }, CHALMERS);
    result.traitsCard = card;
    const own = card.rows.find((r) => r.who === 'own'), army = card.rows.find((r) => r.who === 'army');
    check('traits-card', own?.name === 'Brig. Gen. James R. Chalmers' && JSON.stringify(own.chips.map((c) => c[0])) === JSON.stringify(['Goes in without waiting', 'Quick to attack'])
      && own.chips.every((c) => c[1].startsWith('Game rule:')) && own.prov === 'Provenance: Verified'
      && army?.name === 'Army: Gen. P. G. T. Beauregard' && army.chips[0]?.[0] === 'Holds back' && army.prov === 'Provenance: Verified'
      && card.rule.startsWith('Game rule: ') && card.more,
    `card: ${card.rows.map((r) => `${r.name}: ${r.chips.map((c) => c[0]).join(', ')} (${r.prov})`).join(' | ')}; "${card.rule.slice(0, 80)}…"`);
    check('traits-card-note', /Fort Pillow/.test(card.note) && /12 April 1864/.test(card.note) && /massacre of surrendered Black/.test(card.note), `record note: "${card.note}"`);
    check('traits-tooltip', /Commander: Goes in without waiting, Quick to attack\./.test(card.tip) && /Army commander P\. G\. T\. Beauregard: Holds back\./.test(card.tip), `flag tooltip: "${card.tip.slice(-140)}"`);
    const cardAxe = await axe('#unitcard', 'traitsCardAxe');
    check('traits-card-axe', !cardAxe, cardAxe || '0 serious/critical on the enemy card with its traits');
    await page.locator('#uc-traits').scrollIntoViewIfNeeded(); await shot(page, 'traits-card');

    // the Records dialog by keyboard
    // auto-pause off here: an arrival or rout pausing the running battle must not read as the dialog failing to resume it
    await page.evaluate(async () => { (await import('./src/settings.js')).set('rules.autoPause', false);
      const { game } = window.__game; if (game.paused) game.togglePause(); });
    await page.locator('#uc-traits-more').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('traits-dialog')?.open, null, { timeout: 10000 });
    const dialog = await page.evaluate(() => {
      const d = document.getElementById('traits-dialog');
      return { focus: document.activeElement?.id, paused: window.__game.game.paused, title: d.querySelector('#traits-title')?.textContent,
        men: [...d.querySelectorAll('.traits-man')].map((m) => ({ name: m.dataset.commander, traits: [...m.querySelectorAll('.traits-trait')].map((li) => ({
          key: li.dataset.trait, label: li.querySelector('.traits-label')?.textContent, rule: li.querySelector('.traits-rule')?.textContent ?? '',
          claim: li.querySelector('.traits-claim')?.textContent ?? '', links: [...li.querySelectorAll('.traits-sources a')].map((a) => [a.href, a.target, a.rel]) })),
          note: m.querySelector('.traits-note.is-record')?.textContent ?? '', noteLinks: [...m.querySelectorAll('.traits-note a')].map((a) => a.href) })) };
    });
    result.traitsDialog = { focus: dialog.focus, paused: dialog.paused, men: dialog.men.map((m) => [m.name, m.traits.map((t) => [t.key, t.links.length])]) };
    const linksOk = dialog.men.every((m) => m.traits.length && m.traits.every((t) => t.claim.startsWith('His record: ') && t.rule.startsWith('Game rule:') && t.links.length >= 1
      && t.links.every(([href, target, rel]) => /^https:\/\//.test(href) && target === '_blank' && /noopener/.test(rel))));
    check('traits-dialog', dialog.focus === 'traits-title' && dialog.paused && JSON.stringify(dialog.men.map((m) => m.name)) === JSON.stringify(['James R. Chalmers', 'P. G. T. Beauregard'])
      && linksOk && dialog.men[0].noteLinks.includes('https://www.nps.gov/people/james-ronald-chalmers.htm'),
    `dialog "${dialog.title}": ${dialog.men.map((m) => `${m.name} (${m.traits.map((t) => `${t.label}: ${t.links.length} sources`).join('; ')})`).join(' | ')}; focus ${dialog.focus}; paused ${dialog.paused}`);
    await page.keyboard.press('Tab');
    const tabbed = await page.evaluate(() => ({ tag: document.activeElement?.tagName, inside: !!document.activeElement?.closest('#traits-dialog'), href: document.activeElement?.href ?? '' }));
    check('traits-dialog-keyboard', tabbed.tag === 'A' && tabbed.inside && /^https:\/\//.test(tabbed.href), `Tab from the title reaches ${tabbed.tag} ${tabbed.href}`);
    const dialogAxe = await axe('#traits-dialog', 'traitsDialogAxe');
    check('traits-dialog-axe', !dialogAxe, dialogAxe || '0 serious/critical in the Records dialog');
    await shot(page, 'traits-dialog');
    // record every change of game.paused from here on, with where it came from (CI diagnosis)
    await page.evaluate(() => {
      const g = window.__game.game; let v = g.paused; window.__pauseLog = [];
      Object.defineProperty(g, 'paused', { configurable: true, get: () => v,
        set: (x) => { if (x !== v) window.__pauseLog.push(`${x} ${(new Error().stack || '').split('\n').slice(2, 5).map((l) => l.trim()).join(' < ')}`); v = x; } });
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('traits-dialog')?.open, null, { timeout: 10000 });
    const closed = await page.evaluate(() => ({ focus: document.activeElement?.id, paused: window.__game.game.paused, log: window.__pauseLog }));
    check('traits-dialog-close', closed.focus === 'uc-traits-more' && closed.paused === false, `after Escape: focus ${closed.focus}, paused ${closed.paused}; changes ${JSON.stringify(closed.log)}`);

    // 320 px: the card and the dialog fit
    await page.evaluate(() => { const { game } = window.__game; if (!game.paused) game.togglePause(); });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(300);
    const cardFits = await fits('#uc-traits');
    await page.locator('#uc-traits').scrollIntoViewIfNeeded(); await shot(page, 'traits-card-320');
    await page.locator('#uc-traits-more').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('traits-dialog')?.open, null, { timeout: 10000 });
    const narrow = await page.evaluate(() => { const d = document.getElementById('traits-dialog'), r = d.getBoundingClientRect();
      return { fits: d.scrollWidth <= d.clientWidth + 1 && r.left >= 0 && r.right <= window.innerWidth + 1, close: document.getElementById('traits-close')?.getBoundingClientRect().height ?? 0 }; });
    check('traits-320', cardFits && narrow.fits && narrow.close >= 44, `320px: card fits ${cardFits}; dialog fits ${narrow.fits}; Close ${narrow.close} px tall`);
    await shot(page, 'traits-dialog-320');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('traits-dialog')?.open, null, { timeout: 10000 });
    await page.setViewportSize({ width: 1024, height: 768 });

    // a Union card shows no traits; with Chalmers down his own traits leave the card
    const after = await page.evaluate(async (id) => {
      const { game } = window.__game, wait = () => new Promise((r) => setTimeout(r, 400));
      game.select(game.units.find((u) => u.side === 'US' && u.alive)); await wait();
      const union = document.getElementById('uc-traits').hidden;
      const u = game.units.find((x) => x.id === id);
      game.commanderDown(u, 'killed'); game.select(u); await wait();
      return { union, rows: [...document.querySelectorAll('#uc-traits .uct-row')].map((r) => r.dataset.who) };
    }, CHALMERS);
    check('traits-friend-and-down', after.union === true && JSON.stringify(after.rows) === JSON.stringify(['army']),
      `Union card traits hidden: ${after.union}; with Chalmers down the card keeps: ${after.rows.join(', ')}`);

    // ---- 2. the Briefing's opposing commanders (Shiloh phase one, mounted on the title page) ----
    await page.goto(url + '?nosw');
    await page.waitForFunction(() => window.__entry && !window.__entry.importing, null, { timeout: 60000 });
    await page.evaluate(async () => {
      const { mountBriefing } = await import('./src/ui/briefing.js');
      const pack = await (await fetch('./assets/packs/shiloh.json')).json();
      const battle = document.getElementById('battle'); if (battle) battle.id = 'battle-hold';
      window.__traitsBriefing = mountBriefing({ scenario: pack.phases[0].scenario, phase: { loan: true }, game: { paused: false, playerSide: 'US' },
        hud: { setPaused() {}, playerSide: 'US' }, effects: null, onBegin() {} });
      if (battle) battle.id = 'battle';
    });
    await page.waitForFunction(() => { const s = document.querySelector('#briefing .briefing-opponents'); return s && !s.hidden; }, null, { timeout: 30000 });
    const brief = await page.evaluate(() => ({ heading: document.getElementById('briefing-opponents-heading')?.textContent,
      men: [...document.querySelectorAll('#briefing .briefing-opponent')].map((li) => ({ name: li.dataset.commander, head: li.querySelector('.briefing-opponent-name')?.textContent,
        chips: [...li.querySelectorAll('.briefing-trait')].map((c) => c.textContent), prov: li.querySelector('.briefing-trait-prov')?.textContent,
        rule: li.querySelector('.briefing-opponent-rule')?.textContent ?? '', note: li.querySelector('.briefing-opponent-note')?.textContent ?? '' })),
      focus: document.activeElement?.id }));
    result.traitsBriefing = brief.men.map((m) => [m.name, m.chips, m.prov]);
    const [asj, ...rest] = brief.men, chal = brief.men.find((m) => m.name === 'James R. Chalmers');
    check('traits-briefing', brief.heading === 'Opposing commanders' && asj?.name === 'Albert Sidney Johnston' && asj.head.startsWith('Gen. Albert Sidney Johnston')
      && JSON.stringify(asj.chips) === JSON.stringify(['Quick to attack', 'Led from the front']) && asj.prov === 'Provenance: Disputed' && asj.rule.startsWith('Game rule: ')
      && rest.some((m) => m.name === 'Patrick R. Cleburne') && /Fort Pillow/.test(chal?.note ?? '') && brief.focus === 'briefing-begin',
    `${brief.men.map((m) => `${m.name}: ${m.chips.join(', ')} (${m.prov})`).join(' | ')}; focus ${brief.focus}`);
    const summary = page.locator('#briefing .briefing-opponent[data-commander="Albert Sidney Johnston"] summary');
    await summary.focus(); await page.keyboard.press('Enter');
    const opened = await page.evaluate(() => { const d = document.querySelector('#briefing .briefing-opponent[data-commander="Albert Sidney Johnston"] details');
      return { open: d?.open, claims: [...(d?.querySelectorAll('.traits-claim') || [])].length, links: [...(d?.querySelectorAll('.traits-sources a') || [])].map((a) => a.href) }; });
    check('traits-briefing-sources', opened.open === true && opened.claims === 2 && opened.links.length >= 4 && opened.links.every((h) => /^https:\/\//.test(h)),
      `Johnston's record by keyboard: open ${opened.open}, ${opened.claims} claims, ${opened.links.length} source links`);
    const briefAxe = await axe('#briefing', 'traitsBriefingAxe');
    check('traits-briefing-axe', !briefAxe, briefAxe || '0 serious/critical in the Briefing with its opposing commanders');
    await page.locator('#briefing .briefing-opponents').scrollIntoViewIfNeeded(); await shot(page, 'traits-briefing');
    await page.setViewportSize({ width: 320, height: 568 });
    check('traits-briefing-320', await fits('#briefing'), '320px: the opposing commanders and their open record wrap inside the Briefing');
    await page.locator('#briefing .briefing-opponents').scrollIntoViewIfNeeded(); await shot(page, 'traits-briefing-320');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('#briefing-begin').click();
    const real = errors.filter((e) => !/ERR_ABORTED|NS_BINDING_ABORTED/.test(e));
    check('traits-console', real.length === 0, real.length ? real.slice(0, 4).join(' | ') : `no page errors or failed requests (${errors.length - real.length} navigation aborts)`);
  } finally { await ctx.close().catch(() => {}); }
}
