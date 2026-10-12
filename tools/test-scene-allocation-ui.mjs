// Actions-only native lifecycle proof; this small fixture is not a whole-battle budget measurement.
import {AllocationLedger,mipSizes,ReservationPeak,installAllocationObserver} from './bake/scene-allocation.mjs';

export async function sceneAllocationControls({browser,url,check,result,watchErrors}) {
  const ctx=await browser.newContext({viewport:{width:320,height:240}});
  await ctx.addInitScript(installAllocationObserver,{ledger:AllocationLedger.toString(),mips:mipSizes.toString(),reservationPeak:ReservationPeak.toString()});
  const page=await ctx.newPage(),errors=[];watchErrors(page,url,errors);
  try {
    await page.goto(url+'?nosw');
    await page.waitForFunction(()=>window.__entry&&!window.__entry.importing,null,{timeout:60000});
    const report=await page.evaluate(async()=>{
      const THREE=await import('three'),{partitionTerrain,installTerrainPartition}=await import('./tools/bake/partition-terrain.mjs'),
        {sampleSceneAllocations}=await import('./tools/bake/scene-allocation.mjs'),
        {installRenderGate,restoreSceneDiagnostics}=await import('./tools/bake/inactive-figures.mjs');
      const renderer=new THREE.WebGLRenderer({antialias:false}),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
      renderer.setSize(32,32);camera.position.z=2;
      const geometry=new THREE.PlaneGeometry(1,1);geometry.deleteAttribute('normal');geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const material=new THREE.MeshBasicMaterial({color:0x86734c,side:THREE.DoubleSide}),root=new THREE.Mesh(geometry,material);root.name='native-terrain';root.userData.triangles=2;scene.add(root);
      const saved={geometry,material,position:geometry.attributes.position,uv:geometry.attributes.uv,index:geometry.index,box:geometry.boundingBox,sphere:geometry.boundingSphere};
      const bytes=a=>Array.from(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
      const originalBytes=[saved.position,saved.uv,saved.index].map(a=>bytes(a.array));
      const post={renderer,render(s,c){renderer.render(s,c);}},scope={__game:{scene,post,game:{baked:{atlases:{}}}},__allocation:window.__allocation,innerWidth:32,innerHeight:32,devicePixelRatio:1};
      const gate=installRenderGate(post);scope.__sceneRenderGate=gate;
      const gl=renderer.getContext(),rows=[];
      const draw=()=>gate.renderOnce(scene,camera),sample=label=>({label,...sampleSceneAllocations(scope)});
      let restoration;
      try {
        draw();const original=sample('original');gl.finish();
        const fullArrays=g=>[...Object.values(g.attributes),g.index].every(a=>scope.__allocation.bufferReservations(gl,a.array).some(r=>!r.pendingDelete&&r.bytes===a.array.byteLength));
        const sourceBytesMatch=fullArrays(geometry);
        scope.__sceneTerrainPartition=installTerrainPartition({terrainMesh:root},THREE,a=>partitionTerrain(a,3),{reversible:true});
        draw();const partitioned=sample('partition-pending');gl.finish();const settled=sample('partition-settled');
        const chunkBytesMatch=root.children.every(c=>fullArrays(c.geometry));
        const sourceIds=original.bufferOwnership.map(r=>r.id),chunkIds=settled.bufferOwnership.map(r=>r.id);
        const clean=s=>s.glError===0&&!s.allocation.unknown.length&&s.unmappedBufferBytes===0;
        rows.push({name:'detached-pending',ok:sourceBytesMatch&&chunkBytesMatch&&sourceIds.length===3&&partitioned.allocation.pendingDeleteBytes>0
          &&sourceIds.every(id=>partitioned.bufferOwnership.some(r=>r.id===id&&r.pendingDelete&&r.owners.length))
          &&sourceIds.every(id=>!settled.bufferOwnership.some(r=>r.id===id))&&clean(original)&&clean(partitioned)&&clean(settled)});
        let restoredBytesMatch=false;
        restoration=restoreSceneDiagnostics(scope,{sampleRestored(){
          draw();const pending=sample('restored-native-pending');gl.finish();restoredBytesMatch=fullArrays(geometry);return [pending,sample('restored-native-settled')];
        }});
        const [pending,final]=restoration.samples,restoredIds=final?.bufferOwnership.map(r=>r.id)||[];
        rows.push({name:'native-restored',ok:restoredBytesMatch&&restoration.ok&&root.geometry===saved.geometry&&root.material===saved.material&&!root.children.length
          &&geometry.attributes.position===saved.position&&geometry.attributes.uv===saved.uv&&geometry.index===saved.index
          &&geometry.boundingBox===saved.box&&geometry.boundingSphere===saved.sphere
          &&JSON.stringify([saved.position,saved.uv,saved.index].map(a=>bytes(a.array)))===JSON.stringify(originalBytes)
          &&restoredIds.length===3&&restoredIds.every(id=>!sourceIds.includes(id)&&!chunkIds.includes(id))
          &&chunkIds.every(id=>pending?.bufferOwnership.some(r=>r.id===id&&r.pendingDelete&&r.owners.length))
          &&chunkIds.every(id=>!restoredIds.includes(id))&&clean(pending)&&clean(final)});
        rows.push({name:'restoration-order',ok:JSON.stringify(restoration.calls)===JSON.stringify(['terrain','capture','render','allocation'])&&gate.count===3});
        return {rows,original,partitioned,settled,restoration,kind:'small native terrain lifecycle fixture; whole-battle matrix UNRUN'};
      } finally {
        if(!restoration)restoreSceneDiagnostics(scope);
        geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();
      }
    });
    result.sceneAllocation=report;
    for(const row of report.rows)check(`scene-allocation-${row.name}`,row.ok,JSON.stringify(report.restoration));
    check('scene-allocation-errors',errors.length===0,errors.join('; '));
  } finally {await ctx.close();}
}
