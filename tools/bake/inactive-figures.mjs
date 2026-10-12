/** Diagnostic prototype only. Retains all pool/mesh/attribute/CPU records; Three reuploads on reactivation. */
export function installRenderGate(post) {
  const native=post.render;let held=true,count=0;
  post.render=function(...args){if(!held){count++;return native.apply(this,args);}};
  return {renderOnce(...args){count++;return native.apply(post,args);},get count(){return count;},restore(){held=false;post.render=native;}};
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
  const visibility=new WeakMap();
  const bucket=(body,outline,active)=>{
    if(!visibility.has(body))visibility.set(body,{body:body.visible,outline:outline?.visible});
    const original=visibility.get(body);
    body.visible=active&&original.body;if(outline)outline.visible=active&&original.outline;
    if(active){if(released.has(body)){released.delete(body);stats.reactivated++;}return;}
    if(released.has(body))return;
    body.geometry.dispose();body.dispose();outline?.dispose();released.add(body);stats.released++;
  };
  for(const pool of Object.values(game.pools||{})){
    const native=pool.flush;pool.flush=function(...args){const value=native.apply(this,args);for(const b of this.buckets)bucket(b.mesh,b.outline,b.n>0);return value;};
    const nativeOutline=pool.setOutline;pool.setOutline=function(...args){const value=nativeOutline.apply(this,args);for(const b of this.buckets)if(b.outline){const original=visibility.get(b.mesh);if(original)original.outline=!!args[0];if(!b.mesh.visible)b.outline.visible=false;}return value;};
  }
  for(const pool of Object.values(game.fallen||{})){
    const native=pool.flush;pool.flush=function(...args){const value=native.apply(this,args);let active=false;for(let i=0;i<this.used;i++)if(this.clip.array[i]!==2){active=true;break;}bucket(this.mesh,null,active);return value;};
  }
  return stats;
}
