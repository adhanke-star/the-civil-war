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
