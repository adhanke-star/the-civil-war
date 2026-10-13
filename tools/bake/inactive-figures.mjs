import {MEN_PER_FIGURE_OPTIONS,MEN_PER_CREW_FIGURE} from '../../src/units/unit.js';
import {phaseMenPerFigure,prepareReinforcementTimeline} from '../../src/sim/phase.js';

/** Diagnostic prototype only. Retains all pool/mesh/attribute/CPU records; Three reuploads on reactivation. */
export function installRenderGate(post) {
  const native=post.render,descriptor=Object.getOwnPropertyDescriptor(post,'render');let held=true,count=0,restored=false;
  const wrapped=function(...args){if(!held){count++;return native.apply(this,args);}};
  Object.defineProperty(post,'render',{value:wrapped,writable:descriptor?.writable??true,enumerable:descriptor?.enumerable??true,configurable:descriptor?.configurable??true});
  return {renderOnce(...args){count++;return native.apply(post,args);},get count(){return count;},restore(){
    if(restored)return;
    if(Object.getOwnPropertyDescriptor(post,'render')?.value!==wrapped)throw new Error('render gate: wrapper ownership changed');
    if(descriptor)Object.defineProperty(post,'render',descriptor);else delete post.render;
    held=false;restored=true;
  }};
}
/** Synchronous default-framebuffer readback; excludes the DOM HUD. Never await between draw and export. */
export function renderCanvasPng(post,scene,camera,gate=null){
  const r=post.renderer,gl=r.getContext(),canvas=r.domElement,before=gate?.count;
  if(gate)gate.renderOnce(scene,camera);else post.render(scene,camera);
  gl.finish();const dataUrl=canvas.toDataURL('image/png');
  return {dataUrl,width:canvas.width,height:canvas.height,drawingWidth:gl.drawingBufferWidth,drawingHeight:gl.drawingBufferHeight,
    glError:gl.getError(),nativeRenders:gate?gate.count-before:1};
}
export function installInactiveFigures(game) {
  const released=new WeakSet(),stats={released:0,reactivated:0};
  const visibility=new Map(),wrappers=[];let restored=false;
  const wrap=(pool,key,factory)=>{
    const descriptor=Object.getOwnPropertyDescriptor(pool,key),native=pool[key],wrapped=factory(native);
    Object.defineProperty(pool,key,{value:wrapped,writable:descriptor?.writable??true,enumerable:descriptor?.enumerable??true,configurable:descriptor?.configurable??true});
    wrappers.push({pool,key,descriptor,wrapped});
  };
  stats.restore=()=>{
    if(restored)return;
    let failure;
    for(const {pool,key,descriptor,wrapped}of [...wrappers].reverse()){
      if(Object.getOwnPropertyDescriptor(pool,key)?.value!==wrapped){failure ||= new Error('inactive figures: wrapper ownership changed');continue;}
      if(descriptor)Object.defineProperty(pool,key,descriptor);else delete pool[key];
    }
    for(const [body,original]of visibility){body.visible=original.body;if(original.mesh)original.mesh.visible=original.outline;}
    if(failure)throw failure;restored=true;
  };
  const bucket=(body,outline,active)=>{
    if(!visibility.has(body))visibility.set(body,{body:body.visible,outline:outline?.visible,mesh:outline});
    const original=visibility.get(body);
    body.visible=active&&original.body;if(outline)outline.visible=active&&original.outline;
    if(active){if(released.has(body)){released.delete(body);stats.reactivated++;}return;}
    if(released.has(body))return;
    body.geometry.dispose();body.dispose();outline?.dispose();released.add(body);stats.released++;
  };
  try {for(const pool of Object.values(game.pools||{})){
    wrap(pool,'flush',native=>function(...args){const value=native.apply(this,args);for(const b of this.buckets)bucket(b.mesh,b.outline,b.n>0);return value;});
    wrap(pool,'setOutline',native=>function(...args){const value=native.apply(this,args);for(const b of this.buckets)if(b.outline){const original=visibility.get(b.mesh);if(original)original.outline=!!args[0];if(!b.mesh.visible)b.outline.visible=false;}return value;});
  }
  for(const pool of Object.values(game.fallen||{})){
    wrap(pool,'flush',native=>function(...args){const value=native.apply(this,args);let active=false;for(let i=0;i<this.used;i++)if(this.clip.array[i]!==2){active=true;break;}bucket(this.mesh,null,active);return value;});
  }
  }catch(error){stats.restore();throw error;}
  return stats;
}

/** Derive capacities from authored initial/scheduled definitions, independent of live pool claims. */
export function deriveSceneStressContract(scenario,pages){
  if(!scenario||!Array.isArray(scenario.units)||!pages||!['US','CS'].every(side=>['field','close'].every(t=>Number.isSafeInteger(pages[side]?.[t])&&pages[side][t]>0)))throw Error('scene stress contract: scenario/page inputs');
  const timeline=['reinforcements','surrender','batteryOverrun'].some(k=>k in scenario)?prepareReinforcementTimeline({version:1,id:'game',title:'Battle runtime',phases:[{id:'battle',scenario}]},'battle',scenario):null;
  const defs=[...scenario.units,...(timeline?.events||[]).map(e=>e.unit)],minimum=Math.min(...MEN_PER_FIGURE_OPTIONS),ratio=Math.max(minimum,phaseMenPerFigure(scenario)),reserve=Math.ceil(2100*minimum/ratio);
  const figures=d=>Math.round(d.men/(d.type==='artillery'?MEN_PER_CREW_FIGURE:ratio))+6,
    cap=side=>defs.filter(d=>d.side===side).reduce((n,d)=>n+figures(d),reserve),guns=side=>Math.max(1,defs.filter(d=>d.side===side).reduce((n,d)=>n+(d.guns||0),0)),
    cavalry=defs.filter(d=>d.type==='cavalry').reduce((n,d)=>n+figures(d),0),commanders=scenario.commanders?.length||0;
  const result={US:cap('US'),CS:cap('CS'),horses:defs.length+2+(commanders?commanders+4:0),mounts:cavalry+2*reserve,
    guns:{US:guns('US'),CS:guns('CS'),limbers:Math.max(1,defs.reduce((n,d)=>n+(d.guns||0),0))},
    flags:Math.max(1,defs.reduce((n,d)=>n+((d.type||'infantry')==='infantry'&&Array.isArray(d.regiments)&&d.regiments.length>=1&&d.regiments.length<=8?2*d.regiments.length:0),0)),
    commanders,pages:structuredClone(pages),ratio,reserve,definitions:defs.length,scheduled:timeline?.events.length||0};
  if(![result.US,result.CS,result.horses,result.mounts,result.flags,...Object.values(result.guns)].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('scene stress contract: invalid capacity');
  return result;
}

/** Keep supported lazy resources and any legal cavalry spawn in an explicitly warmed baseline. */
export function warmSceneStressBaseline(scope,expected,rallyRadius){
  const {game,effects}=scope;
  if(!game?.paused||!effects?.ok||effects.reducedMotion||!effects.smokeEnabled||!Number.isFinite(rallyRadius)||rallyRadius<=0)throw Error('scene stress warm: paused normal-motion native baseline required');
  let cavalry=game.units.find(u=>u.type==='cavalry'&&u.mounts),spawned=null;
  if(!cavalry){
    const anchor=game.units.find(u=>u.side==='US'&&u.alive);if(!anchor)throw Error('scene stress warm: legal spawn anchor unavailable');
    cavalry=game.spawnUnit({side:'US',type:'cavalry',men:25,x:anchor.x,z:anchor.z,facing:anchor.facing,xp:1});
    if(!cavalry?.mounts)throw Error('scene stress warm: legal cavalry spawn refused');
    spawned={id:cavalry.id,side:cavalry.side,type:cavalry.type,men:cavalry.men,x:cavalry.x,z:cavalry.z,retained:true};
  }
  for(const pool of [game.horses,cavalry.mounts]){
    if(!pool?.mesh||pool.capacity<1)throw Error('scene stress warm: horse owner unavailable');
    if(!pool.mesh.instanceColor){pool.mesh.setColorAt(0,pool.color);pool.mesh.instanceColor.needsUpdate=true;}
  }
  const command=game.commandState();command.rings.show(command.commanders.map(c=>({x:c.x,z:c.z,r:rallyRadius,side:c.side})));
  for(let i=0;i<40;i++)effects.puff(cavalry.x,cavalry.z,true,0);
  for(let i=0;i<160;i++)effects.puff(cavalry.x,cavalry.z,false,0);
  effects.update(.01);
  const discovery=discoverSceneStressOwners(game,effects,expected);
  // Three's native sorting creates lazy spheres even with frustum culling disabled.
  // Make those supported owners part of the labelled warm baseline before snapshotting identities.
  for(const mesh of discovery.meshes){
    if(mesh.geometry.boundingSphere===null)mesh.geometry.computeBoundingSphere();
    if(mesh.isInstancedMesh&&mesh.boundingSphere===null)mesh.computeBoundingSphere();
  }
  return {discovery,spawned,baseline:'explicitly warmed supported lazy resources, retained stress roster and native smoke; pristine state not claimed'};
}

/** Explicit warmed native owners. No allocations, animation, upload or inferred GPU bytes occur here. */
export function discoverSceneStressOwners(game,effects,expected){
  const owners=[],meshes=new Set(),attributes=new Set(),arrays=new Set(),records=[];
  const require=(ok,label)=>{if(!ok)throw Error(`scene stress owners: ${label}`);};
  const capacity=(n,label)=>{require(Number.isSafeInteger(n)&&n>0,label+' capacity');return n;};
  const record=(object,keys)=>{require(object&&keys.every(k=>k in object),'counter bindings');records.push({object,keys});};
  const add=(label,drawables,entries,count,bytesPerInstance)=>{
    capacity(count,label);const local=new Set();
    for(const mesh of drawables){require(mesh?.isObject3D&&mesh.geometry?.isBufferGeometry,label+' mesh');meshes.add(mesh);
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        const uniforms=material?.uniforms||material?.userData?.uniforms;
        for(const key of ['uSplit','uSoftFar'])if(uniforms?.[key])record(uniforms[key],['value']);
      }
    }
    for(const [attribute,itemSize]of entries){
      require(attribute&&attribute.itemSize===itemSize,label+' attribute shape');
      const owner=attribute.isInterleavedBufferAttribute?attribute.data:attribute,array=owner?.array;
      require(array instanceof Float32Array&&owner.count===count,label+' array capacity');
      require(array.length===count*(attribute.isInterleavedBufferAttribute?owner.stride:itemSize)&&!attribute.normalized
        &&(!owner.isInstancedBufferAttribute&&!owner.isInstancedInterleavedBuffer||owner.meshPerAttribute===1),label+' array shape/divisor');
      require(drawables.some(m=>m.instanceMatrix===attribute||m.instanceColor===attribute||Object.values(m.geometry.attributes).includes(attribute)),label+' native binding');
      if(!local.has(array))require(!arrays.has(array),label+' foreign shared array');
      attributes.add(attribute);arrays.add(array);local.add(array);
    }
    const bytes=[...local].reduce((n,a)=>n+a.byteLength,0);require(bytes===count*bytesPerInstance,label+' unique bytes');
    owners.push({label,meshes:drawables,attributes:entries.map(e=>e[0]),arrays:[...local],capacity:count,bytes});
  };
  require(game&&effects&&expected,'explicit warmed contract');
  for(const side of ['US','CS']){
    const n=capacity(expected[side],side),pool=game.pools?.[side],fallen=game.fallen?.[side],baked=game.impostors?.[side];
    require(pool?.capacity===n&&pool.buckets?.length===3&&new Set(pool.buckets.map(b=>b.lod)).size===3&&pool.buckets.every(b=>[0,1,2].includes(b.lod)),side+' three LOD buckets');
    for(const b of pool.buckets){
      require(b.mesh.geometry.attributes.aAnim===b.anim&&b.mesh.geometry.attributes.aTint===b.tint&&b.mesh.geometry.attributes.aClip===b.clip,side+' named procedural attributes');
      require(!b.outline||(b.outline.geometry===b.mesh.geometry&&b.outline.instanceMatrix===b.mesh.instanceMatrix),side+' shared outline');
      add(`procedural.${side}.lod${b.lod}`,[b.mesh,...(b.outline?[b.outline]:[])],[[b.mesh.instanceMatrix,16],[b.anim,4],[b.tint,4],[b.clip,1]],n,100);record(b,['n']);
    }
    require(fallen?.capacity===n,side+' fallen capacity');
    require(fallen.mesh.geometry.attributes.aAnim===fallen.anim&&fallen.mesh.geometry.attributes.aTint===fallen.tint&&fallen.mesh.geometry.attributes.aClip===fallen.clip,side+' named fallen attributes');
    add(`fallen.${side}`,[fallen.mesh],[[fallen.mesh.instanceMatrix,16],[fallen.anim,4],[fallen.tint,4],[fallen.clip,1]],n,100);
    record(fallen,['used','hiddenTo','sunk','dirty','bakedClip']);
    require(baked?.capacity===n&&baked.layout&&baked.atlas?.loaded('field')&&baked.atlas.loaded('close'),side+' loaded baked tiers');
    for(const tier of ['field','close']){
      const batches=baked.batches[tier],pages=baked.layout.tiers[tier].pages;
      require(Array.isArray(batches)&&pages.length===expected.pages?.[side]?.[tier]&&baked.atlas.textures[tier]?.length===pages.length
        &&batches.length===pages.length&&new Set(batches.map(b=>b.page)).size===pages.length,side+' baked page coverage');
      for(const b of batches){
        require(b.tier===tier&&Number.isInteger(b.page)&&b.page>=0&&b.page<pages.length&&b.body.geometry===b.geo&&b.soft.geometry===b.geo&&b.data===b.buf.array,side+' baked shared page');
        require(b.buf.stride===12&&b.buf.meshPerAttribute===1&&[b.geo.attributes.iPos,b.geo.attributes.iRect,b.geo.attributes.iOff].every((a,i)=>a?.data===b.buf&&a.offset===i*4)
          &&b.body.material.uniforms.uMap.value===baked.atlas.textures[tier][b.page]&&b.soft.material.uniforms.uMap.value===baked.atlas.textures[tier][b.page],side+' baked interleaved/page texture binding');
        add(`baked.${side}.${tier}.${b.page}`,[b.body,b.soft],[[b.geo.attributes.iPos,4],[b.geo.attributes.iRect,4],[b.geo.attributes.iOff,4]],n,48);
        require(b.geo.attributes.iPos.data===b.buf&&b.geo.attributes.iRect.data===b.buf&&b.geo.attributes.iOff.data===b.buf,side+' interleaved owner');record(b,['n']);
      }
    }
    record(baked,['nFallen','goneTo','standing','drawn']);
  }
  const halo=game.halos;require(halo?.capacity===expected.US+expected.CS,'halo combined capacity');
  require(halo.mesh.geometry.attributes.aHalo===halo.color&&halo.mesh.geometry.attributes.aClip===halo.clip,'named halo attributes');
  add('halos',[halo.mesh],[[halo.mesh.instanceMatrix,16],[halo.color,4],[halo.clip,1]],halo.capacity,84);record(halo,['n']);
  const horse=(label,pool,n)=>{require(pool?.capacity===n,label+' declared capacity');add(label,[pool.mesh],[[pool.mesh.instanceMatrix,16],[pool.mesh.instanceColor,3]],n,76);record(pool,['used']);};
  horse('horses',game.horses,expected.horses);
  const mounts=[...new Set((game.units||[]).filter(u=>u.type==='cavalry').map(u=>u.mounts))];require(mounts.length===1&&mounts[0],'retained legal cavalry mount owner');
  horse('mounts',mounts[0],expected.mounts);
  record(mounts[0],['n']);
  for(const [key,mesh]of [['US',game.gunPool?.guns?.US],['CS',game.gunPool?.guns?.CS],['limbers',game.gunPool?.limbers]]){
    add(`guns.${key}`,[mesh],[[mesh?.instanceMatrix,16]],expected.guns?.[key],64);
  }
  record(game.gunPool.used,['US','CS','limbers']);
  const command=game.commandState(),flags=command?.flags;
  require(flags?.mesh?.geometry.attributes.aTile===flags?.tile,'named flag attribute');
  require(flags?.capacity===expected.flags,'flags capacity');add('flags',[flags.mesh],[[flags.mesh.instanceMatrix,16],[flags.tile,1]],flags.capacity,68);record(flags,['used']);
  require(command?.commanders?.length===expected.commanders&&Array.isArray(command.rings?.rings)&&command.rings.rings.length===expected.commanders,'actual commander rings');
  command.rings.rings.forEach((ring,i)=>add(`rings.${i}`,[ring],[[ring.geometry.attributes.position,3]],96,12));
  require(effects.ok&&!effects.reducedMotion&&effects.smokeEnabled&&effects.systems?.length===200,'normal-motion smoke systems');
  require(effects.systems.filter(s=>s.big).length===40&&effects.systems.every(s=>s.system?.particleNum===(s.big?8:3)),'actual 800 smoke particles');
  const batches=effects.batch?.batches;require(Array.isArray(batches)&&batches.length===1,'native smoke batch');const batch=batches[0];
  require(batch.maxParticles===1000&&batch.geometry?.instanceCount===800,'native smoke capacity/draw count');
  require(batch.systems instanceof Set&&batch.systems.size===200&&effects.systems.every(s=>batch.systems.has(s.system)),'native smoke system bindings');
  require(['offset','color','rotation','size','uvTile'].every((key,i)=>batch.geometry.attributes[key]===[batch.offsetBuffer,batch.colorBuffer,batch.rotationBuffer,batch.sizeBuffer,batch.uvTileBuffer][i]),'named smoke attributes');
  add('smoke',[batch],[[batch.offsetBuffer,3],[batch.colorBuffer,4],[batch.rotationBuffer,1],[batch.sizeBuffer,3],[batch.uvTileBuffer,1]],1000,48);
  return {owners,meshes:[...meshes],attributes:[...attributes],arrays:[...arrays],records,uniqueDynamicBytes:[...arrays].reduce((n,a)=>n+a.byteLength,0),smoke:{systems:200,particles:800,capacity:1000}};
}

/** Synthetic maximum draw of existing arrays; the independently warmed roster/smoke stays labelled. */
export function runSceneStressTransaction({discovery,draw,sample,verifyBaseline,reservations}){
  if(!discovery?.owners?.length||typeof reservations!=='function')throw Error('scene stress: explicit discovered native owners required');
  for(const fn of [draw,sample,verifyBaseline,reservations])if(typeof fn!=='function'||/Async|Generator/.test(Object.prototype.toString.call(fn)))throw Error('scene stress: synchronous callbacks required');
  const exposed=uploadOnly=>{
    for(const owner of discovery.owners)for(const mesh of owner.meshes){
      for(let p=mesh;p;p=p.parent)p.visible=true;
      mesh.frustumCulled=false;
      if(mesh.isInstancedMesh)mesh.count=uploadOnly?0:owner.capacity;
      if(mesh.geometry.isInstancedBufferGeometry)mesh.geometry.instanceCount=uploadOnly?0:owner.capacity;
    }
  };
  const native=[];
  const transaction=runSceneAllocationTransaction({meshes:discovery.meshes,attributes:discovery.attributes,records:discovery.records,
    verifyBaseline,
    mutate(){
      for(const a of discovery.arrays)a.fill(0);
      for(const owner of discovery.owners)for(const mesh of owner.meshes){
        if(mesh.instanceMatrix){const a=mesh.instanceMatrix.array;for(let i=0;i<a.length;i+=16){a[i]=a[i+5]=a[i+10]=.01;a[i+15]=1;}}
        if(mesh.instanceColor)mesh.instanceColor.array.fill(.7);
      }
      for(const owner of discovery.owners){
        if(owner.label.startsWith('baked.')){const a=owner.arrays[0];for(let i=0;i<a.length;i+=12){a[i+3]=.01;a[i+6]=a[i+7]=4;a[i+8]=a[i+9]=.1;}}
        if(owner.label==='smoke')for(const attribute of owner.attributes.slice(1))attribute.array.fill(.01);
      }
      for(const attribute of discovery.attributes){const a=attribute.isInterleavedBufferAttribute?attribute.data:attribute;a.clearUpdateRanges();a.needsUpdate=true;}
      exposed(false);
    },
    render(label){if(label==='restore-upload')exposed(true);return draw(label);},
    sample(label){
      const observation=sample(label),rows=discovery.owners.map(owner=>({label:owner.label,capacity:owner.capacity,bytes:owner.bytes,
        instances:owner.meshes.map(mesh=>mesh.isInstancedMesh?mesh.count:mesh.geometry.isInstancedBufferGeometry?mesh.geometry.instanceCount:null),
        arrays:owner.arrays.map(array=>({bytes:array.byteLength,reservations:reservations(array)}))}));
      const ids=new Set();const ok=rows.every(row=>(label!=='stress'||row.instances.every(n=>n===null||n===row.capacity))&&row.arrays.every(a=>Array.isArray(a.reservations)&&a.reservations.every(r=>{
        if(!Number.isSafeInteger(r?.id)||r.id<1||!Number.isSafeInteger(r.bytes)||r.bytes<0||typeof r.pendingDelete!=='boolean'||ids.has(r.id))return false;
        ids.add(r.id);return true;
      })&&a.reservations.filter(r=>!r.pendingDelete).length===1&&a.reservations.find(r=>!r.pendingDelete).bytes===a.bytes));
      native.push({label,ok,owners:rows});if(!ok)throw Error('scene stress: missing full-array live native reservation');return observation;
    },
  });
  return {transaction,native,ok:transaction.ok&&native.length===3&&native.every(r=>r.ok),
    kind:'synthetic capacity draw of warmed supported owners; simultaneous legal living/casualty gameplay not inferred',
    uniqueDynamicBytes:discovery.uniqueDynamicBytes,smoke:discovery.smoke};
}

/** CPU transaction primitive; callers bind actual pool coverage and native uploads separately.
 * Everything runs synchronously in one evaluation, including independent cleanup after failures.
 * render('restore-upload') must submit captured arrays before render('restored-scene'). */
export function runSceneAllocationTransaction({meshes,attributes,records=[],mutate,render,sample,verifyBaseline}={}){
  const errors=[],samples=[],calls=[],owners=[],arrays=[],objects=[],bindings=[],explicit=[],lists=[];
  let started=false,restored=false;
  const fail=(label,error)=>errors.push(`${label}: ${error?.message||error}`);
  const sync=(label,fn,...args)=>{
    const value=fn(...args);if(value&&typeof value.then==='function')throw Error(`${label} returned an asynchronous result`);return value;
  };
  const attempt=(label,fn)=>{try{return fn();}catch(error){fail(label,error);}};
  const sameList=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((x,i)=>x===b[i]);
  const descriptor=(object,key)=>({object,key,descriptor:Object.getOwnPropertyDescriptor(object,key),value:object[key]});
  const restoreBinding=b=>{if(b.descriptor)Object.defineProperty(b.object,b.key,b.descriptor);else{delete b.object[b.key];if(!Object.is(b.object[b.key],b.value))throw Error(`inherited ${b.key} changed`);}};
  const observe=label=>{const observation=sync(`${label} sample`,sample,label);if(!observation||typeof observation!=='object'||Array.isArray(observation))throw Error('sample container required');return {label,observation};};
  try{
    if(!Array.isArray(meshes)||!meshes.length||!Array.isArray(attributes)||!attributes.length||!Array.isArray(records))throw Error('explicit mesh/attribute/record containers required');
    for(const [label,fn]of Object.entries({mutate,render,sample,verifyBaseline})){
      if(typeof fn!=='function'||/Async|Generator/.test(Object.prototype.toString.call(fn)))throw Error(`${label} must be synchronous`);
    }
    const allObjects=new Set(),geometries=new Set(),allOwners=new Set(),allArrays=new Set();
    const bind=(object,key)=>bindings.push({object,key,value:object[key]});
    for(const mesh of new Set(meshes)){
      if(!mesh?.isObject3D||!mesh.geometry?.isBufferGeometry)throw Error('existing drawable mesh required');
      bind(mesh,'geometry');bind(mesh,'material');
      for(const key of ['instanceMatrix','instanceColor','boundingBox','boundingSphere'])if(key in mesh)bind(mesh,key);
      for(const bounds of [mesh.boundingBox,mesh.boundingSphere])if(bounds){
        for(const key of ['min','max','center'])if(bounds[key]){bind(bounds,key);for(const axis of ['x','y','z'])explicit.push(descriptor(bounds[key],axis));}
        if('radius'in bounds)explicit.push(descriptor(bounds,'radius'));
      }
      if(Array.isArray(mesh.material)){lists.push({array:mesh.material,entries:[...mesh.material]});mesh.material.forEach((_,i)=>bind(mesh.material,i));}
      let p=mesh;const ancestors=new Set();while(p){if(ancestors.has(p))throw Error('cyclic scene ancestry');ancestors.add(p);allObjects.add(p);p=p.parent;}
      geometries.add(mesh.geometry);
    }
    for(const object of allObjects){
      if(!Array.isArray(object.children))throw Error('scene children required');
      objects.push({object,parent:object.parent,children:[...object.children]});
      for(const key of ['visible','frustumCulled','count'])if(key in object)explicit.push(descriptor(object,key));
    }
    for(const geometry of geometries){
      bind(geometry,'attributes');bind(geometry,'index');bind(geometry,'boundingBox');bind(geometry,'boundingSphere');bind(geometry,'drawRange');
      const keys=Object.keys(geometry.attributes);objects.push({object:geometry.attributes,attributeKeys:keys});
      for(const key of keys)bind(geometry.attributes,key);
      for(const key of ['start','count'])explicit.push(descriptor(geometry.drawRange,key));
      if('instanceCount'in geometry)explicit.push(descriptor(geometry,'instanceCount'));
      for(const bounds of [geometry.boundingBox,geometry.boundingSphere])if(bounds){
        for(const key of ['min','max','center'])if(bounds[key]){bind(bounds,key);for(const axis of ['x','y','z'])explicit.push(descriptor(bounds[key],axis));}
        if('radius'in bounds)explicit.push(descriptor(bounds,'radius'));
      }
    }
    // Attribute aliases retain their data owner; overlapping views are captured before any mutation.
    for(const attribute of new Set(attributes)){
      if(!attribute||!(attribute.isBufferAttribute||attribute.isInterleavedBufferAttribute||attribute.isInterleavedBuffer))throw Error('native attribute owner required');
      if(attribute.isInterleavedBufferAttribute)bind(attribute,'data');
      const owner=attribute.isInterleavedBufferAttribute?attribute.data:attribute;
      for(const target of new Set([attribute,owner]))for(const key of ['itemSize','count','normalized','usage','gpuType','stride','offset','meshPerAttribute'])if(key in target){
        bind(target,key);const d=Object.getOwnPropertyDescriptor(target,key);if(d&&'value'in d)explicit.push(descriptor(target,key));
      }
      if(allOwners.has(owner))continue;allOwners.add(owner);
      if(!ArrayBuffer.isView(owner.array)||!Number.isSafeInteger(owner.array.length)||!Array.isArray(owner.updateRanges))throw Error('typed attribute storage and update ranges required');
      const array=owner.array,ranges=owner.updateRanges;
      owners.push({owner,array,ranges,rangeEntries:ranges.map(r=>({ref:r,start:r.start,count:r.count}))});
      if(!allArrays.has(array)){allArrays.add(array);arrays.push({array,bytes:new Uint8Array(array.buffer,array.byteOffset,array.byteLength).slice()});}
    }
    for(const record of records){
      if(!record?.object||!Array.isArray(record.keys)||!record.keys.every(k=>typeof k==='string'))throw Error('explicit record keys required');
      for(const key of new Set(record.keys))explicit.push(descriptor(record.object,key));
    }
    // Geometry attribute dictionaries have keys rather than Object3D parent/children.
    const identity=()=>{
      for(const b of bindings)if(!Object.is(b.object[b.key],b.value))throw Error(`${b.key} ownership changed`);
      for(const l of lists)if(!sameList(l.array,l.entries))throw Error('material members changed');
      for(const o of objects){if(o.attributeKeys){if(!sameList(Object.keys(o.object),o.attributeKeys))throw Error('geometry attributes changed');}
        else if(o.object.parent!==o.parent||!sameList(o.object.children,o.children))throw Error('scene membership changed');}
      for(const a of owners)if(a.owner.array!==a.array||a.owner.updateRanges!==a.ranges)throw Error('attribute storage ownership changed');
    };
    if(sync('baseline',verifyBaseline)!==true)throw Error('baseline verification failed');
    started=true;
    try{
      sync('mutate',mutate);calls.push('mutate');identity();
      sync('stress',render,'stress');calls.push('stress');identity();
      samples.push(observe('stress'));
    }catch(error){fail('stress',error);}
    finally{
      attempt('ownership',identity);
      for(const a of arrays)attempt('array restoration',()=>new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength).set(a.bytes));
      for(const b of explicit)attempt(`restore ${String(b.key)}`,()=>restoreBinding(b));
      for(const a of owners)attempt('attribute restoration',()=>{
        if(a.owner.array!==a.array||a.owner.updateRanges!==a.ranges)throw Error('attribute ownership changed');
        // A restored upload must cover the full array, including bytes outside earlier partial ranges.
        a.ranges.length=0;a.owner.needsUpdate=true;
      });
      attempt('restored upload',()=>{identity();sync('restore-upload',render,'restore-upload');calls.push('restore-upload');
        samples.push(observe('restore-upload'));});
      // Upload callbacks may temporarily alter draw/visibility state; restore those explicit bindings again.
      for(const b of explicit)attempt(`restore ${String(b.key)}`,()=>restoreBinding(b));
      attempt('restored scene',()=>{identity();sync('restored-scene',render,'restored-scene');calls.push('restored-scene');
        samples.push(observe('restored-scene'));});
      // Three legitimately consumes update ranges; recover the original CPU entries after native draws.
      for(const a of owners)attempt('update range restoration',()=>{
        if(a.owner.array!==a.array||a.owner.updateRanges!==a.ranges)throw Error('attribute ownership changed');
        a.ranges.length=0;for(const r of a.rangeEntries){r.ref.start=r.start;r.ref.count=r.count;a.ranges.push(r.ref);}
      });
      // Final native hooks may change scalar values/descriptors; recover exact captured bindings.
      for(const b of explicit)attempt(`final restore ${String(b.key)}`,()=>restoreBinding(b));
      attempt('final verification',()=>{
        identity();for(const a of arrays){const now=new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength);if(!now.every((v,i)=>v===a.bytes[i]))throw Error('restored bytes changed');}
        for(const b of explicit){
          const d=Object.getOwnPropertyDescriptor(b.object,b.key),old=b.descriptor;
          if(!Object.is(b.object[b.key],b.value)||!!d!==!!old||d&&Reflect.ownKeys(d).some(k=>!Object.is(d[k],old[k])))throw Error(`${String(b.key)} baseline descriptor changed`);
        }
        for(const a of owners)if(a.ranges.length!==a.rangeEntries.length||a.ranges.some((r,i)=>r!==a.rangeEntries[i].ref||r.start!==a.rangeEntries[i].start||r.count!==a.rangeEntries[i].count))throw Error('update ranges changed');
        if(sync('baseline',verifyBaseline)!==true)throw Error('baseline verification failed');restored=true;
      });
    }
  }catch(error){fail('preflight',error);}
  return {ok:started&&restored&&errors.length===0,errors,samples,calls,restoration:{started,restored,arrays:arrays.length,attributes:owners.length}};
}

/** Continue restoring independent owners even when one owner rejects restoration. */
export function restoreSceneDiagnostics(scope=globalThis.window,{sampleRestored=null}={}){
  const calls=[],errors=[],samples=[];
  for(const [name,owner]of [['inactive',scope.__game?.game?.__inactiveStats],['terrain',scope.__sceneTerrainPartition],['capture',sampleRestored&&{restore(){
    const rows=sampleRestored();if(!Array.isArray(rows)||rows.length!==2)throw new Error('synchronous restoration samples required');samples.push(...rows);
  }}],['render',scope.__sceneRenderGate],['allocation',scope.__allocation]]){
    if(!owner)continue;
    if(typeof owner.restore!=='function'){errors.push(`${name}: missing restore API`);continue;}
    try{owner.restore();calls.push(name);}catch(error){errors.push(`${name}: ${error.message}`);}
  }
  return {ok:errors.length===0&&calls.includes('allocation'),calls,errors,samples};
}
