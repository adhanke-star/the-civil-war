// Actual Three geometries; native ordering uses an explicit CPU context double.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareTerrainPartition,partitionTerrain} from '../src/world/terrain.js';
import {partitionTerrain as toolPartition} from './bake/partition-terrain.mjs';

function fixture(prepare=prepareTerrainPartition){
  const geometry=new THREE.PlaneGeometry(2,2,2,2);geometry.deleteAttribute('normal');geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=new THREE.ShaderMaterial({uniforms:{uGround:{value:new THREE.Texture()}}}),root=new THREE.Mesh(geometry,material);
  const events=[],gl={NO_ERROR:0,lost:false,error:0,isContextLost(){return this.lost;},getError(){const e=this.error;this.error=0;return e;},finish(){events.push(['finish',root.geometry,root.children.length]);this.afterFinish?.();}},renderer={getContext:()=>gl};
  const before=root.onBeforeRender,visible=root.visible,attributes=[geometry.attributes.position,geometry.attributes.uv,geometry.index],arrays=attributes.map(a=>a.array),bits=arrays.map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('hex'));
  geometry.addEventListener('dispose',()=>events.push(['source-dispose',root.geometry,root.children.length]));
  const owner=prepare(root,renderer,{limit:3});
  return {root,geometry,material,events,gl,renderer,before,visible,attributes,arrays,bits,owner};
}
const checkOriginal=f=>{
  assert.equal(f.root.geometry,f.geometry);assert.equal(f.root.material,f.material);assert.equal(f.root.onBeforeRender,f.before);assert.equal(f.root.visible,f.visible);assert.equal(f.root.children.length,0);
  assert.deepEqual([f.geometry.attributes.position,f.geometry.attributes.uv,f.geometry.index],f.attributes);
  assert.deepEqual(f.attributes.map(a=>a.array),f.arrays);assert.deepEqual(f.arrays.map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('hex')),f.bits);
};
const tests=[
 ['one-algorithm',()=>assert.equal(toolPartition,partitionTerrain)],
 ['prepare-before-publication',p=>{const f=fixture(p);checkOriginal(f);assert.equal(f.owner.state,'prepared');assert.equal(f.events.length,0);assert.ok(f.owner.retainedArrays.length>6);assert.ok(Object.isFrozen(f.owner));}],
 ['install-order',p=>{const f=fixture(p);assert.equal(f.owner.install(),true);assert.equal(f.events[0][0],'source-dispose');assert.equal(f.events[1][0],'finish');assert.equal(f.events[1][1],f.geometry);assert.equal(f.events[1][2],0);assert.equal(f.root.children.length,8);assert.equal(f.owner.state,'partitioned');assert.ok(f.root.children.every(c=>c.material===f.material));f.owner.restore();checkOriginal(f);}],
 ['restore-order',p=>{const f=fixture(p);f.owner.install();const empty=f.root.geometry,children=[...f.root.children];for(const c of children)c.geometry.addEventListener('dispose',()=>{assert.equal(f.root.geometry,empty);assert.equal(f.root.visible,false);f.events.push(['chunk-dispose']);});empty.addEventListener('dispose',()=>f.events.push(['empty-dispose']));f.events.length=0;assert.equal(f.owner.restore(),true);assert.deepEqual(f.events.map(e=>e[0]),[...children.map(()=>'chunk-dispose'),'empty-dispose','finish']);assert.equal(f.events.at(-1)[1],empty);assert.equal(f.events.at(-1)[2],children.length);checkOriginal(f);assert.equal(f.owner.retainedArrays.length,0);assert.equal(f.owner.receipt.chunks,0);assert.equal(f.owner.restore(),true);assert.equal(f.events.length,children.length+2);}],
 ['repaint-values',p=>{const f=fixture(p);f.owner.install();const texture=new THREE.Texture();f.material.uniforms.uGround.value=texture;f.owner.restore();checkOriginal(f);assert.equal(f.material.uniforms.uGround.value,texture);}],
 ['shared-material',p=>{const f=fixture(p);let disposals=0;f.material.addEventListener('dispose',()=>disposals++);f.material.uniforms.uGround.value.addEventListener('dispose',()=>disposals++);f.owner.install();f.owner.restore();assert.equal(disposals,0);}],
 ['loss-before-install',p=>{const f=fixture(p);f.gl.lost=true;assert.equal(f.owner.install(),false);assert.equal(f.root.visible,false);assert.equal(f.root.geometry,f.geometry);assert.equal(f.owner.pending,'install');assert.equal(f.events.length,0);f.gl.lost=false;assert.equal(f.owner.resume(),true);assert.equal(f.owner.state,'partitioned');f.owner.restore();checkOriginal(f);}],
 ['loss-after-finish',p=>{const f=fixture(p);f.gl.afterFinish=()=>f.gl.lost=true;assert.equal(f.owner.install(),false);assert.equal(f.root.geometry,f.geometry);assert.equal(f.root.children.length,0);assert.equal(f.owner.failed,false);f.gl.afterFinish=null;f.gl.lost=false;assert.equal(f.owner.resume(),true);assert.equal(f.events.filter(e=>e[0]==='source-dispose').length,1);f.owner.restore();checkOriginal(f);}],
 ['loss-before-restore',p=>{const f=fixture(p);f.owner.install();const empty=f.root.geometry;f.gl.lost=true;assert.equal(f.owner.restore(),false);assert.equal(f.root.geometry,empty);assert.equal(f.owner.pending,'restore');const next={...f.gl,lost:false};f.renderer.getContext=()=>next;assert.equal(f.owner.resume(),true);checkOriginal(f);}],
 ['native-error',p=>{const f=fixture(p);f.gl.error=1282;assert.throws(()=>f.owner.install(),/native completion refused/);assert.equal(f.owner.failed,true);assert.equal(f.root.geometry,f.geometry);assert.equal(f.root.visible,false);assert.equal(f.events.filter(e=>e[0]==='finish').length,1);assert.equal(f.owner.receipt.cleanupCompletion,true);assert.throws(()=>f.owner.resume(),/native completion refused/);}],
 ['native-error-after-finish',p=>{const f=fixture(p);f.gl.afterFinish=()=>f.gl.error=1282;assert.throws(()=>f.owner.install(),/native completion failed/);assert.equal(f.root.geometry,f.geometry);assert.equal(f.root.children.length,0);}],
 ['falsy-first-error',p=>{const f=fixture(p);f.owner.install();const children=[...f.root.children],empty=f.root.geometry;let disposed=0,reentry;children[0].geometry.addEventListener('dispose',()=>{disposed++;throw undefined;});children[1].geometry.addEventListener('dispose',()=>{disposed++;try{f.owner.restore();}catch(e){reentry=e;}throw Error('later');});for(const c of children.slice(2))c.geometry.addEventListener('dispose',()=>disposed++);empty.addEventListener('dispose',()=>disposed++);let threw=false,error;try{f.owner.restore();}catch(e){threw=true;error=e;}assert.equal(threw,true);assert.equal(error,undefined);assert.equal(reentry,undefined);assert.equal(f.owner.failed,true);assert.equal(disposed,children.length+1);assert.equal(f.root.geometry,empty);assert.ok(f.owner.retainedArrays.length);threw=false;try{f.owner.resume();}catch(e){threw=true;assert.equal(e,undefined);}assert.equal(threw,true);}],
 ['reentrant-transition',p=>{const f=fixture(p);let caught;f.geometry.addEventListener('dispose',()=>{try{f.owner.restore();}catch(e){caught=e;}});assert.throws(()=>f.owner.install(),/reentrant transition/);assert.match(caught.message,/reentrant transition/);assert.equal(f.root.geometry,f.geometry);assert.equal(f.root.visible,false);}],
 ['foreign-geometry',p=>{const f=fixture(p);f.owner.install();const foreign=new THREE.BufferGeometry();f.root.geometry=foreign;assert.throws(()=>f.owner.restore(),/published owner changed/);assert.equal(f.root.geometry,foreign);}],
 ['foreign-uniform-record',p=>{const f=fixture(p);f.owner.install();f.material.uniforms.uGround={value:new THREE.Texture()};assert.throws(()=>f.owner.restore(),/original owner changed/);}],
 ['source-byte-drift',p=>{const f=fixture(p);f.owner.install();f.arrays[0][0]+=1;assert.throws(()=>f.owner.restore(),/original owner changed/);}],
 ['source-draw-range',p=>{const f=fixture(p);f.geometry.setDrawRange(0,3);assert.throws(()=>f.owner.install(),/original owner changed/);assert.equal(f.root.children.length,0);}],
 ['source-groups',p=>{const f=fixture(p);f.geometry.addGroup(0,3);assert.throws(()=>f.owner.install(),/original owner changed/);assert.equal(f.root.children.length,0);}],
 ['chunk-byte-drift',p=>{const f=fixture(p);f.owner.install();f.root.children[0].geometry.attributes.uv.array[0]+=.25;assert.throws(()=>f.owner.restore(),/partition bytes changed/);}],
 ['chunk-index-drift',p=>{const f=fixture(p);f.owner.install();const a=f.root.children[0].geometry.index.array;[a[0],a[1]]=[a[1],a[0]];assert.throws(()=>f.owner.restore(),/partition triangle changed/);}],
 ['chunk-layout-drift',p=>{const f=fixture(p);f.owner.install();const child=f.root.children[0];child.geometry.index.count=0;assert.throws(()=>child.onBeforeRender(),/partition layout changed/);assert.equal(f.owner.failed,true);}],
 ['chunk-transform-drift',p=>{const f=fixture(p);f.owner.install();const child=f.root.children[0];child.position.x=999;child.updateMatrix();assert.throws(()=>child.onBeforeRender.call(child),/partition layout changed/);assert.equal(f.owner.failed,true);}],
 ['publication-failure-finish',p=>{const f=fixture(p);const add=f.root.add;f.root.add=function(child){add.call(this,child);throw 0;};let failed=false;try{f.owner.install();}catch(e){failed=true;assert.equal(e,0);}assert.equal(failed,true);assert.equal(f.owner.failed,true);assert.equal(f.owner.receipt.cleanupCompletion,true);assert.equal(f.events.filter(e=>e[0]==='finish').length,2);assert.equal(f.root.visible,false);}],
 ['pending-draw',p=>{const f=fixture(p);f.gl.lost=true;f.owner.install();assert.throws(()=>f.root.onBeforeRender(),/draw before completion/);assert.equal(f.owner.failed,true);}],
 ['draw-during-retirement',p=>{const f=fixture(p);f.geometry.addEventListener('dispose',()=>f.root.onBeforeRender());assert.throws(()=>f.owner.install(),/reentrant transition/);assert.equal(f.root.children.length,0);}],
];
for(const [name,check]of tests){try{check(prepareTerrainPartition);}catch(e){console.error('TERRAIN-OWNER FAILED',name);throw e;}}
console.log(`TERRAIN-OWNER OK (${tests.length}/${tests.length})`);
if(process.argv.includes('--prove-fail')){
  const mutant=(root,renderer)=>({state:'prepared',retainedArrays:[],receipt:{},install(){return true;},restore(){root.geometry.dispose();return true;},resume(){return true;}});
  const repaintMutant=(root,renderer,options)=>{const original=root.material.uniforms.uGround.value,owner=prepareTerrainPartition(root,renderer,options);return {...owner,restore(){const result=owner.restore();root.material.uniforms.uGround.value=original;return result;}};};
  const materialMutant=(root,renderer,options)=>{const owner=prepareTerrainPartition(root,renderer,options);return {...owner,restore(){const result=owner.restore();root.material.dispose();return result;}};};
  let rejected=0;for(const [name,check]of tests.filter(([n])=>n!=='one-algorithm')){let failed=false;try{check(name==='repaint-values'?repaintMutant:name==='shared-material'?materialMutant:mutant);}catch{failed=true;}assert.ok(failed,'ineffective terrain owner control '+name);rejected++;}
  console.log(`TERRAIN-OWNER CONTROLS OK (${rejected}/${rejected})`);
}
