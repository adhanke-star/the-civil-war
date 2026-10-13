// Pure storage prerequisite only; production terrain and the reversible monolithic path stay separate.
export function prepareCanonicalTerrain({grid,cell,half,heights,vertices,triangles},limit=65535){
  const invalid=()=>{throw Error('canonical terrain: invalid grid/height/triangle input');};
  if(!Number.isSafeInteger(grid)||grid<3||grid>65535||!Number.isInteger(Math.log2(grid-1))
    ||!Number.isFinite(cell)||cell<=0||!Number.isFinite(half)||half<=0||cell*(grid-1)!==half*2
    ||!(heights instanceof Float32Array)||heights.length!==grid*grid||heights.some(h=>!Number.isFinite(h))
    ||!(vertices instanceof Uint16Array||vertices instanceof Uint32Array)||!vertices.length||vertices.length%2
    ||!(triangles instanceof Uint16Array||triangles instanceof Uint32Array)||!triangles.length||triangles.length%3
    ||!Number.isSafeInteger(limit)||limit<3||limit>65535||vertices.some(g=>g>=grid)
    ||triangles.some(i=>i>=vertices.length/2))invalid();
  const inverse=1/(grid-1),fc=Math.fround(cell),fh=Math.fround(half),fi=Math.fround(inverse);
  if(!Number.isFinite(fc)||!Number.isFinite(fh)||fc<=0||fh<=0||fi<=0)throw Error('canonical terrain: nonexact Float32 shader reconstruction');
  for(let g=0;g<grid;g++)if(!Object.is(Math.fround(g*cell-half),Math.fround(Math.fround(g*fc)-fh))
    ||!Object.is(Math.fround(g/(grid-1)),Math.fround(g*fi)))throw Error('canonical terrain: nonexact Float32 shader reconstruction');
  const point=i=>[Math.fround(vertices[i*2]*cell-half),heights[vertices[i*2+1]*grid+vertices[i*2]],Math.fround(vertices[i*2+1]*cell-half)];
  const bounds=ids=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const id of ids){const p=point(id);for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
    const center=min.map((v,k)=>(v+max[k])/2);let radius2=0;
    for(const id of ids){const p=point(id);radius2=Math.max(radius2,p.reduce((n,v,k)=>n+(v-center[k])**2,0));}
    return {min,max,center,radius:Math.sqrt(radius2)};
  };
  const rootBounds=bounds({*[Symbol.iterator](){for(let i=0;i<vertices.length/2;i++)yield i;}}),chunks=[];
  let ids=[],map=new Map(),indices=[];
  const flush=()=>{if(!indices.length)return;
    const gridPosition=new Uint16Array(ids.length*2),height=new Float32Array(ids.length);
    for(const [local,id]of ids.entries()){const gx=vertices[id*2],gz=vertices[id*2+1];gridPosition.set([gx,gz],local*2);height.set(heights.subarray(gz*grid+gx,gz*grid+gx+1),local);}
    chunks.push({gridPosition,height,index:new Uint16Array(indices),bounds:bounds(ids)});ids=[];map=new Map();indices=[];
  };
  for(let i=0;i<triangles.length;i+=3){const triangle=[triangles[i],triangles[i+1],triangles[i+2]],fresh=new Set(triangle.filter(id=>!map.has(id)));
    if(map.size+fresh.size>limit)flush();
    for(const id of triangle){if(!map.has(id)){map.set(id,ids.length);ids.push(id);}indices.push(map.get(id));}
  }flush();
  return {grid,cell,half,chunks,triangles:triangles.length/3,bounds:rootBounds,
    bytes:chunks.reduce((n,c)=>n+c.gridPosition.byteLength+c.height.byteLength+c.index.byteLength,0),
    inputMeshBytes:vertices.byteLength+triangles.byteLength};
}

// Focused native prerequisite. Its material shares existing uniform records/textures explicitly.
// No production caller uses this adapter until the separate baseline and budget gates pass.
export function createCanonicalTerrainMesh(prepared,THREE,originalMaterial){
  const fail=()=>{throw Error('canonical terrain: invalid prepared geometry/material');};
  if(!prepared||!Number.isSafeInteger(prepared.grid)||prepared.grid<3||prepared.grid>65535||!Number.isInteger(Math.log2(prepared.grid-1))
    ||!Number.isFinite(prepared.cell)||prepared.cell<=0||!Number.isFinite(prepared.half)||prepared.half<=0
    ||prepared.cell*(prepared.grid-1)!==prepared.half*2||!Array.isArray(prepared.chunks)||!prepared.chunks.length
    ||!originalMaterial?.isShaderMaterial||typeof originalMaterial.vertexShader!=='string')fail();
  const fc=Math.fround(prepared.cell),fh=Math.fround(prepared.half),fi=Math.fround(1/(prepared.grid-1));
  if(!Number.isFinite(fc)||!Number.isFinite(fh)||fc<=0||fh<=0||fi<=0)fail();
  for(let g=0;g<prepared.grid;g++)if(!Object.is(Math.fround(g*prepared.cell-prepared.half),Math.fround(Math.fround(g*fc)-fh))
    ||!Object.is(Math.fround(g/(prepared.grid-1)),Math.fround(g*fi)))fail();
  const vertex=originalMaterial.vertexShader,uvSeam='vUv = uv;',positionSeam='vec4 w = modelMatrix * vec4(position, 1.0);';
  if(vertex.split(uvSeam).length!==2||vertex.split(positionSeam).length!==2||/\b(aGrid|aHeight|uCanonicalCell|uCanonicalHalf|uCanonicalInverse)\b/.test(vertex)
    ||['uCanonicalCell','uCanonicalHalf','uCanonicalInverse'].some(k=>Object.hasOwn(originalMaterial.uniforms,k)))throw Error('canonical terrain: source shader seam changed');
  const bound=b=>b&&['min','max','center'].every(k=>Array.isArray(b[k])&&b[k].length===3&&b[k].every(Number.isFinite))
    &&Number.isFinite(b.radius)&&b.radius>=0&&b.min.every((v,i)=>v<=b.max[i]);
  if(!bound(prepared.bounds))fail();let bytes=0,triangles=0;
  for(const c of prepared.chunks){if(!(c.gridPosition instanceof Uint16Array)||!(c.height instanceof Float32Array)||!(c.index instanceof Uint16Array)
      ||!c.height.length||c.height.length>65535||c.gridPosition.length!==c.height.length*2||!c.index.length||c.index.length%3
      ||c.height.some(h=>!Number.isFinite(h))||c.gridPosition.some(g=>g>=prepared.grid)||c.index.some(i=>i>=c.height.length||i===65535)||!bound(c.bounds))fail();
    bytes+=c.gridPosition.byteLength+c.height.byteLength+c.index.byteLength;triangles+=c.index.length/3;}
  if(bytes!==prepared.bytes||triangles!==prepared.triangles)fail();
  const material=originalMaterial.clone(),geometries=[];
  // cloneUniforms clones Texture objects; replace the table before any upload. Shared originals are not owned here.
  material.uniforms={...originalMaterial.uniforms,uCanonicalCell:{value:prepared.cell},uCanonicalHalf:{value:prepared.half},uCanonicalInverse:{value:1/(prepared.grid-1)}};
  material.vertexShader='attribute vec2 aGrid;\nattribute float aHeight;\nuniform float uCanonicalCell;\nuniform float uCanonicalHalf;\nuniform float uCanonicalInverse;\n'+vertex
    .replace(uvSeam,'vUv = aGrid * uCanonicalInverse;')
    .replace(positionSeam,'vec3 decodedPosition = vec3(aGrid.x * uCanonicalCell - uCanonicalHalf, aHeight, aGrid.y * uCanonicalCell - uCanonicalHalf);\nvec4 w = modelMatrix * vec4(decodedPosition, 1.0);');
  const setBounds=(geometry,b)=>{geometry.boundingBox=new THREE.Box3(new THREE.Vector3().fromArray(b.min),new THREE.Vector3().fromArray(b.max));geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3().fromArray(b.center),b.radius);};
  try{const empty=new THREE.BufferGeometry();geometries.push(empty);setBounds(empty,prepared.bounds);
    const root=new THREE.Mesh(empty,material);root.name='terrain';root.userData.triangles=triangles;
    for(const [i,c]of prepared.chunks.entries()){const geometry=new THREE.BufferGeometry();geometries.push(geometry);
      geometry.setAttribute('aGrid',new THREE.BufferAttribute(c.gridPosition,2,false));geometry.setAttribute('aHeight',new THREE.BufferAttribute(c.height,1,false));geometry.setIndex(new THREE.BufferAttribute(c.index,1,false));setBounds(geometry,c.bounds);
      const child=new THREE.Mesh(geometry,material);child.name=`terrain-chunk-${i+1}`;root.add(child);}
    return root;
  }catch(error){const failures=[];for(const geometry of geometries)try{geometry.dispose();}catch(e){failures.push(e);}try{material.dispose();}catch(e){failures.push(e);}
    if(failures.length)throw new AggregateError([error,...failures],'canonical terrain: publication and cleanup failed');throw error;}
}

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
