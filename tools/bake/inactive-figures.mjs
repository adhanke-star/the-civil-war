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
