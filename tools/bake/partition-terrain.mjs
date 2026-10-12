// Diagnostic-only lossless indexed geometry partition. Index65535 stays reserved for primitive restart.
export function partitionTerrain({position,uv,index},limit=65535) {
  const vertices=position.length/3;
  if(!(position instanceof Float32Array)||!(uv instanceof Float32Array)||!(index instanceof Uint32Array||index instanceof Uint16Array)
    ||!Number.isSafeInteger(vertices)||uv.length!==vertices*2||index.length%3||!Number.isSafeInteger(limit)||limit<3||limit>65535
    ||index.some(i=>i>=vertices))throw new Error('terrain partition: invalid indexed attributes/limit');
  const chunks=[];let ids=[],map=new Map(),indices=[];
  const flush=()=>{if(!indices.length)return;const p=new Float32Array(ids.length*3),u=new Float32Array(ids.length*2);
    ids.forEach((source,local)=>{p.set(position.subarray(source*3,source*3+3),local*3);u.set(uv.subarray(source*2,source*2+2),local*2);});
    chunks.push({position:p,uv:u,index:new Uint16Array(indices),sourceVertices:new Uint32Array(ids)});ids=[];map=new Map();indices=[];
  };
  for(let i=0;i<index.length;i+=3){const triangle=[index[i],index[i+1],index[i+2]],fresh=new Set(triangle.filter(v=>!map.has(v)));
    if(map.size+fresh.size>limit)flush();
    for(const source of triangle){if(!map.has(source)){map.set(source,ids.length);ids.push(source);}indices.push(map.get(source));}
  }flush();
  const bytes=chunks.reduce((n,c)=>n+c.position.byteLength+c.uv.byteLength+c.index.byteLength,0);
  return {chunks,triangles:index.length/3,sourceBytes:position.byteLength+uv.byteLength+index.byteLength,bytes};
}
export function installTerrainPartition(world,THREE,partition) {
  const root=world.terrainMesh,source=root.geometry;
  if(root.children.length||Object.keys(source.attributes).sort().join(',')!=='position,uv'||!source.index)throw new Error('terrain partition: unexpected root geometry');
  const result=partition({position:source.attributes.position.array,uv:source.attributes.uv.array,index:source.index.array});
  const empty=new THREE.BufferGeometry();empty.boundingBox=source.boundingBox.clone();empty.boundingSphere=source.boundingSphere.clone();
  for(const [i,chunk]of result.chunks.entries()){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(chunk.position,3));geo.setAttribute('uv',new THREE.BufferAttribute(chunk.uv,2));geo.setIndex(new THREE.BufferAttribute(chunk.index,1));geo.computeBoundingBox();geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,root.material);mesh.name=`terrain-chunk-${i+1}`;root.add(mesh);
  }
  root.geometry=empty;source.dispose();
  return {triangles:result.triangles,chunks:result.chunks.length,sourceBytes:result.sourceBytes,bytes:result.bytes,savedBytes:result.sourceBytes-result.bytes,
    materialShared:root.children.every(c=>c.material===root.material),rootName:root.name,statTriangles:root.userData.triangles};
}
