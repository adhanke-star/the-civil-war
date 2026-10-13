// Diagnostic ownership stays registered while failed cleanup retains CPU backing arrays.
export function registerTerrainPartition(scope,owner){
  if(Object.hasOwn(scope,'__sceneTerrainPartition')||typeof owner?.restore!=='function')throw Error('terrain partition: diagnostic scope already owned or unrestorable');
  const registration={get retainedArrays(){return owner.retainedArrays;},restore(){
    if(scope.__sceneTerrainPartition!==registration)throw Error('terrain partition: diagnostic registration changed');
    let error,failed=false;try{owner.restore();}catch(e){error=e;failed=true;}
    if(scope.__sceneTerrainPartition!==registration)throw Error('terrain partition: diagnostic registration changed');
    if(failed)throw error;delete scope.__sceneTerrainPartition;
  }};scope.__sceneTerrainPartition=registration;return registration;
}
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
export function installTerrainPartition(world,THREE,partition,{reversible=false}={}) {
  const root=world.terrainMesh,source=root.geometry;
  if(root.children.length||Object.keys(source.attributes).sort().join(',')!=='position,uv'||!source.index)throw new Error('terrain partition: unexpected root geometry');
  const result=partition({position:source.attributes.position.array,uv:source.attributes.uv.array,index:source.index.array});
  const empty=new THREE.BufferGeometry();empty.boundingBox=source.boundingBox.clone();empty.boundingSphere=source.boundingSphere.clone();
  const children=[],geometries=[],chunkArrays=[],material=root.material,attributes={...source.attributes},index=source.index,
    box=source.boundingBox,sphere=source.boundingSphere;
  for(const [i,chunk]of result.chunks.entries()){
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(chunk.position,3));geo.setAttribute('uv',new THREE.BufferAttribute(chunk.uv,2));geo.setIndex(new THREE.BufferAttribute(chunk.index,1));geo.computeBoundingBox();geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,root.material);mesh.name=`terrain-chunk-${i+1}`;root.add(mesh);children.push(mesh);geometries.push(geo);
    for(const [key,a]of [...Object.entries(geo.attributes),['index',geo.index]])chunkArrays.push({array:a.array,owner:`terrain-retained-chunk-${i+1}/${key}`});
  }
  // The publication owns geometry arrays; reconstruction maps are no longer needed.
  result.chunks.length=0;
  root.geometry=empty;source.dispose();
  const receipt={triangles:result.triangles,chunks:children.length,sourceBytes:result.sourceBytes,bytes:result.bytes,savedBytes:result.sourceBytes-result.bytes,
    materialShared:root.children.every(c=>c.material===root.material),rootName:root.name,statTriangles:root.userData.triangles};
  if(reversible){
    let restored=false,failure;
    const sourceArrays=[...Object.entries(attributes).map(([key,a])=>({array:a.array,owner:`terrain-retained-source/${key}`})),{array:index.array,owner:'terrain-retained-source/index'}];
    Object.defineProperty(receipt,'retainedArrays',{get:()=>[
      ...sourceArrays.map(r=>({...r})),
      ...chunkArrays.map(r=>({...r})),
    ]});
    Object.defineProperty(receipt,'restore',{value:()=>{
      if(restored){if(failure)throw failure;return;}
      if(world.terrainMesh!==root||root.geometry!==empty||root.material!==material
        ||root.children.length!==children.length||children.some((child,i)=>root.children[i]!==child||child.parent!==root||child.material!==material||child.geometry!==geometries[i]))
        throw new Error('terrain partition: restoration ownership changed');
      root.geometry=source;
      const errors=[];
      for(const [i,child]of children.entries()){
        try{root.remove(child);}catch(error){errors.push(`remove: ${error.message}`);}
        try{geometries[i].dispose();}catch(error){errors.push(`dispose: ${error.message}`);}
      }
      try{empty.dispose();}catch(error){errors.push(`empty: ${error.message}`);}
      for(const attribute of Object.values(attributes))attribute.needsUpdate=true;
      index.needsUpdate=true;restored=true;
      if(world.terrainMesh!==root||root.geometry!==source||root.material!==material||root.children.length
        ||children.some((child,i)=>child.parent!==null||child.geometry!==geometries[i]||child.material!==material)
        ||source.index!==index||source.boundingBox!==box||source.boundingSphere!==sphere
        ||Object.keys(source.attributes).length!==Object.keys(attributes).length
        ||Object.entries(attributes).some(([key,value])=>source.attributes[key]!==value))errors.push('restoration callback changed ownership');
      if(errors.length){failure=new Error(`terrain partition: restoration failed: ${errors.join(', ')}`);throw failure;}
      // Successful restoration no longer needs detached meshes or their CPU backing arrays.
      // Failed cleanup keeps its owned objects and sticky error for diagnosis.
      children.length=0;geometries.length=0;chunkArrays.length=0;
    }});
  }
  return receipt;
}
