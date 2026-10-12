// Actions-only five-page diagnostic for the CURRENT armies. No runtime adoption or full-pack encode.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { ROOT } from '../serve.mjs';
import { mipBytes, markPremultiplied, candidateKtx, markCandidate, bc7DdsPayload } from './compress.mjs';

export const EXTRA_LOOK = 'h2_slouch_roll_butternut';
export function selectPages(us, cs) {
  const pages = [];
  for (const [side, m] of [['US', us], ['CS', cs]]) for (const tier of ['close', 'field']) {
    const T = m.tiers?.[tier];
    if (!T || !T.pages?.length || !T.frames) throw new Error('current compression: missing current tier');
    for (const [look, G] of [['base', T], ...(side === 'CS' && tier === 'close' ? [[EXTRA_LOOK, T.variants?.[EXTRA_LOOK]]] : [])]) {
      const p = G?.pages?.[0];
      if (!p || !/^soldier_(close|field)(_[a-z0-9_]+)?_\d+\.png$/.test(p.file) || !p.file.startsWith(`soldier_${tier}_`)
        || ![p.w,p.h].every(n => Number.isInteger(n) && n >= 4 && n <= 2048 && n % 4 === 0)) throw new Error('current compression: missing/unsafe representative page');
      const frames = Object.entries(G.frames || {}).filter(([, f]) => f.page === 0);
      if (!frames.length || frames.some(([,f]) => ![f.x,f.y,f.w,f.h].every(Number.isFinite) || f.x < 0 || f.y < 0 || f.w <= 0 || f.h <= 0 || f.x+f.w > p.w || f.y+f.h > p.h)) throw new Error('current compression: invalid source frames');
      pages.push({ id: `${side.toLowerCase()}-${tier}-${look}`, side, tier, look, ...p, frames: frames.slice(0,3) });
    }
  }
  return pages;
}
export function readSmall(root, file) {
  if (!/^[a-z0-9_-]+\.(json|png|ktx2|dds|raw)$/.test(file)) throw new Error('current compression: unsafe filename');
  root = fs.realpathSync(root);
  const full = path.join(root, file), st = fs.lstatSync(full);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 100*1024*1024 || !fs.realpathSync(full).startsWith(root + path.sep)) throw new Error('current compression: unsafe input');
  return fs.readFileSync(full);
}
function freshOut() {
  const base = path.join(ROOT, '.out'), out = path.join(base, 'current-compression');
  if (!fs.existsSync(base)) fs.mkdirSync(base);
  if (fs.lstatSync(base).isSymbolicLink() || fs.realpathSync(base) !== base || fs.existsSync(out)) throw new Error('current compression: needs fresh real .out/current-compression');
  fs.mkdirSync(out); return out;
}
function command(exe, args) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 1024*1024 });
  if (r.status !== 0) throw new Error(`current compression: ${exe}: ${r.error?.message || r.stderr || r.stdout}`);
}
async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('current compression: Actions only');
  const usRoot = path.join(ROOT, 'assets/figures/union-infantry'), csRoot = fs.realpathSync(process.argv[2]);
  const us = JSON.parse(readSmall(usRoot,'soldier.json')), cs = JSON.parse(readSmall(csRoot,'soldier.json'));
  const kept = JSON.parse(readSmall(path.join(ROOT,'assets/figures/confederate-infantry'),'soldier.json'));
  // Source manifests and frame layout are inputs, not legacy Union identities masquerading as Confederate ones.
  for (const tier of ['close','field']) {
    if (JSON.stringify(cs.tiers?.[tier]?.frames) !== JSON.stringify(kept.tiers[tier].frames)
      || JSON.stringify(cs.tiers[tier].pages) !== JSON.stringify(kept.tiers[tier].pages)) throw new Error('current compression: source base differs from current Confederate manifest');
  }
  const selected = selectPages(us,cs), out = freshOut();
  const report = { diagnosticOnly: true, fieldable: false, toolSha: process.env.GITHUB_SHA,
    sources: { US: 'current shipped Union manifest/pages', CS: kept.source }, pages: [] };
  try {
    for (const p of selected) {
      const input = readSmall(p.side === 'US' ? usRoot : csRoot, p.file), png = PNG.sync.read(input);
      if (png.width !== p.w || png.height !== p.h) throw new Error('current compression: PNG dimensions differ');
      fs.writeFileSync(path.join(out,p.id+'-original.png'),input,{flag:'wx'});
      const work = path.join(out,p.id); fs.mkdirSync(work);
      for (let i=0;i<png.data.length;i+=4) for(let c=0;c<3;c++) png.data[i+c]=Math.round(png.data[i+c]*png.data[i+3]/255);
      const premul = path.join(work,'premul.png'); fs.writeFileSync(premul,PNG.sync.write(png));
      const files = {};
      for(const format of ['raw','uastc']) {
        files[format]=p.id+'-'+format+'.ktx2'; const dest=path.join(out,files[format]);
        command('toktx',['--t2', ...(format==='uastc'?['--encode','uastc','--uastc_quality','4','--zcmp','18']:[]),
          '--genmipmap','--filter','box','--assign_oetf','linear','--assign_primaries','none',dest,premul]);
        const b=readSmall(out,files[format]); markPremultiplied(b,p.w,p.h,format==='raw'); fs.writeFileSync(dest,b);
      }
      const raw=candidateKtx(readSmall(out,files.raw),p.w,p.h,'raw'), blocks=[];
      for(const [lod,l] of raw.levels.entries()) {
        const n=new PNG({width:l.width,height:l.height}); n.data=l.data;
        const source=path.join(work,`mip${lod}.png`),dds=`mip${lod}.dds`,block=path.join(work,`mip${lod}.raw`);
        fs.writeFileSync(source,PNG.sync.write(n));
        command(process.env.BC7_ENCODER,['-C','-u4','-p64','-g',source,path.join(work,dds)]);
        fs.writeFileSync(block,bc7DdsPayload(readSmall(work,dds),l.width,l.height)); blocks.push(block);
      }
      for(const format of ['bc7','astc']) {
        files[format]=p.id+'-'+format+'.ktx2'; const dest=path.join(out,files[format]);
        command('ktx',format==='bc7'
          ? ['create','--raw','--format','BC7_UNORM_BLOCK','--width',String(p.w),'--height',String(p.h),'--levels',String(raw.levels.length),'--assign-tf','linear','--assign-primaries','none',...blocks,dest]
          : ['encode','--format','ASTC_4x4_UNORM_BLOCK','--astc-quality','exhaustive',path.join(out,files.raw),dest]);
        const b=readSmall(out,files[format]); markCandidate(b,p.w,p.h,format); fs.writeFileSync(dest,b);
      }
      const astcSoftware=[];
      for(const lod of [0,1,2]) {
        const file=p.id+`-astc-mip${lod}.png`;
        command('ktx',['extract','--level',String(lod),path.join(out,files.astc),path.join(out,file)]); astcSoftware.push(file);
      }
      report.pages.push({...p,original:p.id+'-original.png',files,astcSoftware,allocation:mipBytes(p.w,p.h)});
      fs.writeFileSync(path.join(out,'compression.json'),JSON.stringify(report,null,2));
      console.log(`ENCODED ${p.id}`);
    }
  } finally { fs.writeFileSync(path.join(out,'compression.json'),JSON.stringify(report,null,2)); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href) await main();
