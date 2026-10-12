/** Diagnostic prototype only. Retains all pool/mesh/attribute/CPU records; Three reuploads on reactivation. */
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
