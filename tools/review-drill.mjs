// Numbered drill comparisons for Aaron. No WebGL. Run after downloading a Bake preview:
// node tools/review-drill.mjs .out/bake5/preview-31 .out/bake5/review-31
// Requires printed-page-checked Baxter images in .out/reference/drill/.
// p45=n46, p46=n47, p48=n49, p51=n52, p52=n53, p53=n54. Originals:
// https://archive.org/download/volunteersmanual01baxt/page/n54_w1100.jpg
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { prune } from './prune.mjs';
const dir=path.resolve(process.argv[2] || '.out/bake5/preview');
const label=process.argv[4] || 'Pass 5 candidate';
const out=path.resolve(process.argv[3] || '.out/bake5/review');
const root=fs.realpathSync('.out');
if (!out.startsWith(root+path.sep)) throw new Error('Review output must be inside .out/');
let parent=path.dirname(out);
while (!fs.existsSync(parent)) parent=path.dirname(parent);
const realParent=fs.realpathSync(parent);
if (realParent!==root && !realParent.startsWith(root+path.sep)) throw new Error('Review output parent escapes .out/');
if (fs.existsSync(out)) throw new Error('Choose a fresh review output directory');
fs.mkdirSync(out,{recursive:true});
if (!fs.realpathSync(out).startsWith(root+path.sep)) throw new Error('Review output resolves outside .out/');
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const data=(file)=>`data:image/${file.endsWith('.jpg')?'jpeg':'png'};base64,${fs.readFileSync(file).toString('base64')}`;
const img=(file,cls='figure')=>`<img class="${cls}" src="${data(file)}">`;
const plate=p=>path.resolve(`.out/reference/drill/baxter-p${p}.jpg`);
const render=(c,i,d)=>path.join(dir,'review',`${c}_${i}_d${String(d).padStart(2,'0')}.png`);
const hands=(c,i)=>path.join(dir,'hands',`${c}_${i}.png`);
const card=(label,body)=>`<section><h2>${esc(label)}</h2>${body}</section>`;
const spec=[
 ['01-stand','1. Shoulder arms — RIGHT shoulder',null,'Hardee 1861, para 121. No matching plate was found. Baxter p24 shows the older LEFT carry and must not be copied. Right hand at the guard/swell below the cock; barrel nearly vertical in the shoulder hollow; right arm nearly extended; left arm at side.',['stand',0]],
 ['02-walk','2. March — same RIGHT-shoulder carry',null,'Same grip and carry as shoulder arms; not right shoulder shift. Check the musket and right hand throughout the eight-frame cycle. No matching plate.',['walk',0]],
 ['03-aim','3. Aim — lower band and trigger',53,'Baxter 1861 p53 Fig93; ready p52 Figs91-92. Left elbow low, right elbow at shoulder height; head inclined on butt. Left hand at lower band; right hand at small of stock with forefinger at trigger.',['fire',0]],
 ['04-fire','4. Fire — keep the head on the stock',53,'Same station and head placement as aim. Small recoil is an art estimate; the game adds muzzle flash and smoke.',['fire',1]],
 ['05-recover','5. Recover / ready',51,'Baxter 1861 p51 Figs88-90; Hardee paras171-173. Left hand at lower band; right hand at small/lock. This is the abbreviated game recovery frame.',['fire',2]],
 ['06-load-start','6. Load — cartridge from box',45,'Baxter p45 Fig76: butt on ground beside left thigh; muzzle opposite body centre; left hand at MIDDLE band; right hand to cartridge box.',['load',0]],
 ['07-charge-cartridge','7. Load — cartridge above muzzle',46,'Cartridge held upright above the muzzle before charging. Baxter p46 Fig78 shows the OPEN hand after charging, not this instant. The five-frame game clip abbreviates tearing, dropping the charge and opening the hand.',['load',1]],
 ['08-draw-rammer','8. Load — draw rammer',46,'Baxter p46 Fig79: thumb and forefinger bent, other fingers closed. The rod is drawn clear; right elbow remains near the body.',['load',2]],
 ['09-ram','9. Load — ram',48,'Baxter p48 ramming text; Hardee para163. Thumb/forefinger hold; other fingers closed; back of hand toward front, elbow down near piece. Fig84 illustrates return-rammer, not the ramming stroke.',['load',3]],
 ['10-prime','10. Load — prime / ready',51,'Abbreviated priming stage at lock; compare the hand stations to Baxter p51 ready sequence. The plate is contextual, not an exact frame match.',['load',4]],
];
spec.push(['11-fallen','11. Fallen — inherited pass-3 pose',null,'No approved drill plate applies to this clip. The fallen pose is inherited from pass 3; it is included so every game clip is visible.',['fallen',0]]);
const b=await chromium.launch({headless:true});
try {
 const page=await b.newPage({viewport:{width:1700,height:1100},deviceScaleFactor:1});
 for(const [name,title,p,note,[c,i]] of spec) {
  let left=c==='fallen'?card('Inherited pose — no drill plate',`<div class="text">${esc(note)}</div>`):p?card(`Approved source — Baxter p${p}`,img(plate(p),'plate')):card('Approved source — Hardee text',`<div class="text">${esc(note)}<p>Source: archive.org/details/riflelightinfant01hard</p><p>History status: Inferred (one source per drill item).</p></div>`);
  let body=left+card('Rebuilt — front',img(render(c,i,0)))+card('Rebuilt — right side',img(render(c,i,4))+(c==='fallen'?'':img(hands(c,i),'hand')));
  if(c==='walk') body+=`<div class="cycle">${Array.from({length:8},(_,k)=>card(`March frame ${k+1}`,img(render(c,k,4),'small'))).join('')}</div>`;
  const html=`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:28px;font:20px -apple-system,BlinkMacSystemFont,sans-serif;color:#1d251b;background:#eee8da}h1{font-size:32px;margin:0 0 12px}p{line-height:1.4}h2{font-size:20px;margin:12px}main{display:grid;grid-template-columns: 540px 512px 512px;gap:14px}section{text-align:center;background:#d9ddc9;border:1px solid #969e83}.figure{width:510px;height:510px;object-fit:contain;background:#6d794a}.plate{width:538px;height:790px;object-fit:contain;background:#ece2c6}.hand{width:290px;height:290px;object-fit:contain;background:#6d794a}.text{text-align:left;padding:25px;line-height:1.6;font-size:26px}.cycle{grid-column:1/-1;display:grid;grid-template-columns:repeat(8,1fr);gap:5px}.small{width:190px;height:190px;object-fit:contain;background:#6d794a}footer{font-size:15px;margin-top:16px}</style><h1>${esc(title)}</h1><p>${esc(note)}</p><main>${body}</main><footer>${esc(label)} · NOT APPROVED / NOT IN GAME · geometry and timing are art estimates · original plates stay in .out/reference/drill/</footer>`;
  await page.setContent(html);
  await page.evaluate(()=>Promise.all([...document.images].map(im=>im.decode())));
  await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});

  console.log(name);
 }
 await page.setContent('<style>body{background:#eee8da;font:24px sans-serif}img{max-width:1650px}</style><h1>12. Full contact sheet</h1><p>'+esc(label)+' — NOT APPROVED / NOT IN GAME</p>'+img(path.join(dir,'contact-sheet.png'),'contact'));
 await page.evaluate(()=>Promise.all([...document.images].map(im=>im.decode())));
 await page.screenshot({path:path.join(out,'12-contact-sheet.png'),fullPage:true});
 await page.close();
} finally {await b.close();}

await prune();
