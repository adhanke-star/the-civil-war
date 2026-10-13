// Runner/CPU source admission. Never derives expected geometry from a submitted report.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {TerrainData,buildTerrainMesh,EXAGGERATION} from '../../src/world/terrain.js';
import {partitionTerrain} from './partition-terrain.mjs';

const names=['henry-hill','shiloh','stones-river','chattanooga','lookout-mountain'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const describe=(key,array)=>({key,arrayType:array.constructor.name,itemSize:key==='position'?3:key==='uv'?2:1,
  count:array.length/(key==='position'?3:key==='uv'?2:1),bytes:array.byteLength,
  sha256:digest(new Uint8Array(array.buffer,array.byteOffset,array.byteLength))});

export function readSceneTerrainContracts(phases){
  if(!Array.isArray(phases)||!phases.length)throw Error('scene terrain: trusted phases required');
  const contracts=new Map();
  for(const phase of phases){
    const terrain=phase?.scenario?.terrain??'henry-hill';
    if(!names.includes(terrain))throw Error('scene terrain: unknown source dataset');
    if(contracts.has(terrain))continue;
    const base=new URL('../../assets/terrain/',import.meta.url),metadata=fs.readFileSync(new URL(terrain+'.json',base)),meta=JSON.parse(metadata);
    if(meta.heights?.file!==terrain+'.bin'||!Number.isSafeInteger(meta.grid)||meta.grid<3||meta.grid>2049
      ||!Number.isFinite(meta.heights.stepM)||meta.heights.stepM<=0)throw Error('scene terrain: source shape');
    const packed=fs.readFileSync(new URL(terrain+'.bin',base));
    const raw=gunzipSync(packed,{maxOutputLength:meta.grid*meta.grid*2});
    if(raw.byteLength!==meta.grid*meta.grid*2)throw Error('scene terrain: complete height source required');
    const heights=new Float32Array(meta.grid*meta.grid),k=meta.heights.stepM*EXAGGERATION;
    for(let z=0;z<meta.grid;z++){let acc=0;for(let x=0;x<meta.grid;x++){acc+=raw.readInt16LE((z*meta.grid+x)*2);heights[z*meta.grid+x]=acc*k;}}
    const sun={direction:new THREE.Vector3(),color:new THREE.Color(),sky:new THREE.Color(),earth:new THREE.Color(),fog:new THREE.Color()};
    const mesh=buildTerrainMesh(new TerrainData(meta,heights),null,null,sun);
    try{
      const source={position:mesh.geometry.attributes.position.array,uv:mesh.geometry.attributes.uv.array,index:mesh.geometry.index.array},partition=partitionTerrain(source);
      if(partition.bytes>partition.sourceBytes)throw Error('scene terrain: partition exceeds restoration storage');
      contracts.set(terrain,{terrain,metadataSha256:digest(metadata),heightSha256:digest(packed),
        sourceBytes:partition.sourceBytes,partitionBytes:partition.bytes,triangles:partition.triangles,
        sourceArrays:Object.entries(source).map(([key,array])=>describe(key,array)),
        chunks:partition.chunks.map(c=>['position','uv','index'].map(key=>describe(key,c[key])))});
    }finally{
      mesh.geometry.dispose();for(const u of Object.values(mesh.material.uniforms))if(u.value?.isTexture)u.value.dispose();mesh.material.dispose();
    }
  }
  return phases.map(phase=>({...phase,terrainContract:structuredClone(contracts.get(phase.scenario?.terrain??'henry-hill'))}));
}
