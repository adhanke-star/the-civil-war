// Actions-only actual camp/storage/import flows. The 570 fixture is constructed from legal APIs, not played history.
import {AxeBuilder} from '@axe-core/playwright';
import {legacy570,fillDepot} from './test-level-rewards.mjs';
import {probeProgress,seedProgress} from './test-progress-browser.mjs';
export async function levelRewardsControls({browser,url,check,shot,result,watchErrors}){
 const ctx=await browser.newContext({viewport:{width:1024,height:768},reducedMotion:'reduce'});
 await probeProgress(ctx,{prefix:'__levelRewards',readFlag:'__levelRewardsReadBlocked',quotaFlag:'__levelRewardsQuota'});
 const page=await ctx.newPage(),errors=[];watchErrors(page,url,errors);
 const ready=()=>page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
 const camp=async()=>{await page.goto(url+'?camp=1&nosw');await ready();};
 const raw=()=>page.evaluate(()=>window.__progressFixture.raw());
 const shown=()=>page.evaluate(()=>{const s=window.__entry.saved,track=document.getElementById('camp-rep-track');return {level:s?.level,rep:s?.reputation,rp:s?.rp,depot:s?.depot.length,ledger:s?.ledger.filter(r=>r.kind==='level').map(r=>r.level),text:document.getElementById('camp-reputation').textContent+' '+document.getElementById('camp-level-pending').textContent,writes:window.__levelRewardsWrites,aria:{label:track.getAttribute('aria-label'),min:track.getAttribute('aria-valuemin'),max:track.getAttribute('aria-valuemax'),now:track.getAttribute('aria-valuenow'),text:track.getAttribute('aria-valuetext')}};});
 try{
  await page.goto(url+'?nosw');await ready();const before=legacy570();await seedProgress(page,JSON.stringify(before));await camp();
  const migrated=await shown();check('level-rewards-load',migrated.level===8&&migrated.rep===570&&migrated.rp===before.rp&&migrated.depot===before.depot.length+3&&JSON.stringify(migrated.ledger)==='[2,3,4,5,6,7,8]'&&migrated.writes===1,JSON.stringify(migrated));
  const migratedRaw=await raw();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#entry-export').click()]);const stream=await download.createReadStream(),pieces=[];for await(const piece of stream)pieces.push(piece);const exported=Buffer.concat(pieces).toString('utf8');check('level-rewards-export',exported===migratedRaw,'native export contains exactly the committed migrated army');await page.reload();await ready();check('level-rewards-reload',await raw()===migratedRaw&&(await shown()).writes===0,'reload preserves bytes and writes no duplicate rewards');
  // The native file-input/confirmation flow imports the old format and delivers the same deterministic cards.
  await page.locator('#entry-file').setInputFiles({name:'constructed-legacy-570.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(before))});
  await page.waitForFunction(()=>document.getElementById('entry-replace').open);await page.locator('#entry-confirm').click();await ready();
  check('level-rewards-import',await raw()===migratedRaw,'native reviewed import yields identical validated migration');
  await shot(page,'level-rewards-migrated');
  const full=fillDepot(before,2000);await seedProgress(page,JSON.stringify(full));await camp();const pending=await shown();
  check('level-rewards-pending',pending.level===5&&pending.rep===570&&pending.depot===2000&&pending.writes===0&&pending.text.includes('3 level rewards pending')&&pending.aria.now===pending.aria.max&&pending.text.includes('rewards earned through level 8')&&!pending.text.includes('next level at')&&pending.aria.label==='Level 6 reward delivery pending'&&pending.aria.text==='570 reputation; rewards earned through level 8; 3 rewards pending',JSON.stringify(pending));
  await page.setViewportSize({width:320,height:568});await page.locator('#camp-shop').scrollIntoViewIfNeeded();
  check('level-rewards-320',await page.locator('#front').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'pending reward wording has no horizontal overflow at320');await shot(page,'level-rewards-pending-320');
  const axe=await new AxeBuilder({page}).include('#front').analyze(),bad=axe.violations.filter(v=>['serious','critical'].includes(v.impact));result.levelRewardsAxe=axe.violations.map(v=>({id:v.id,impact:v.impact}));check('level-rewards-axe',bad.length===0,JSON.stringify(bad.map(v=>v.id)));
  await page.setViewportSize({width:1024,height:768});
  const sold=full.depot[0],turn=page.locator(`#camp-depot [data-item-uid="${sold.uid}"] .camp-turnin-button`),unchanged=await raw();await turn.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('camp-confirm').open);
  await page.keyboard.press('Escape');check('level-rewards-sale-cancel',await raw()===unchanged,'Escape keeps full depot and pending rewards unchanged');
  await turn.click();await page.waitForFunction(()=>document.getElementById('camp-confirm').open);await page.locator('#camp-confirm-ok').click();await ready();
  const recovered=await shown(),written=JSON.parse(await raw());check('level-rewards-one-sale',recovered.level===6&&recovered.depot===2000&&recovered.rep===580&&recovered.text.includes('2 level rewards pending')&&!written.depot.some(c=>c.uid===sold.uid)&&written.depot.some(c=>c.uid.endsWith('.level.6')),JSON.stringify(recovered));
  const finalRaw=await raw();await page.reload();await ready();check('level-rewards-sale-reload',await raw()===finalRaw&&(await shown()).writes===0,'full-depot reload does not redeliver a card');
  // A real failed IndexedDB write must preserve the legacy bytes and permit an explicit reload retry.
  await seedProgress(page,JSON.stringify(before));await page.evaluate(()=>{window.__levelRewardsQuota=true;});
  // Reload via the real store explicitly; no hidden simulation or result fixture mutation.
  const failure=await page.evaluate(async()=>{const {createProgressStore}=await import('./src/franchise/save.js');try{await createProgressStore().load();return null;}catch(e){return e.message;}});
  check('level-rewards-write-failure',failure?.includes('could not save')&&await raw()===JSON.stringify(before),'actual failed browser write retains prior legacy save');
  await page.evaluate(()=>window.__levelRewardsQuota=false);await camp();check('level-rewards-write-retry',(await shown()).level===8,'retry delivers missing cards once');
  const other=await ctx.newPage();watchErrors(other,url,errors);try{
   await other.goto(url+'?nosw');await other.waitForFunction(()=>window.__entry&&!window.__entry.importing);await seedProgress(page,JSON.stringify(before));
   const migrate=async p=>p.evaluate(async()=>{const {createProgressStore}=await import('./src/franchise/save.js');const s=await createProgressStore().load();return {level:s.level,receipts:s.ledger.filter(r=>r.kind==='level').map(r=>r.level)};});
   const [left,right]=await Promise.all([migrate(page),migrate(other)]);const committed=await raw();check('level-rewards-concurrent-load',left.level===8&&JSON.stringify(left)===JSON.stringify(right),'two real browser transactions deliver one canonical set of rewards');
   const stale=await other.evaluate(async before=>{const S=await import('./src/franchise/save.js'),E=await import('./src/franchise/economy.js');try{await S.createProgressStore().exchange(E.markShopSeen,{}, {previous:before});return null;}catch(e){return e.message;}},before);
   check('level-rewards-concurrent-stale',stale?.includes('progress changed')&&await raw()===committed,'a reviewed pre-migration baseline cannot overwrite another tab');
  }finally{await other.close();}
  check('level-rewards-errors',errors.length===0,errors.join('; '));
 }finally{await ctx.close();}
}
