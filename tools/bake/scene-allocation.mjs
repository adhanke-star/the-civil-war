// Diagnostic-only accounting of WebGL reservations. These are API bytes, not native driver measurements.
export function mipSizes(w,h,bpp,levels=Math.floor(Math.log2(Math.max(w,h)))+1) {
  if(![w,h,bpp,levels].every(Number.isSafeInteger)||w<1||h<1||bpp<1||levels<1||levels>32)throw new Error('allocation: invalid mip dimensions');
  const out=[];for(let i=0;i<levels;i++){out.push({w,h,bytes:w*h*bpp});w=Math.max(1,w>>1);h=Math.max(1,h>>1);}return out;
}
export class AllocationLedger {
  constructor(){this.objects=new Map();this.retired=new Set();this.bytes=0;this.peak=0;this.calls=0;}
  reserve(id,kind,slot,bytes,overlap=true){
    if(!id||!['texture','renderbuffer','buffer'].includes(kind)||!Number.isSafeInteger(bytes)||bytes<0)throw new Error('allocation: invalid reservation');
    let r=this.objects.get(id);if(r&&r.kind!==kind)throw new Error('allocation: resource kind changed');
    if(!r){r={kind,slots:new Map()};this.objects.set(id,r);}
    const prior=r.slots.get(slot)||0;
    this.peak=Math.max(this.peak,this.bytes+bytes-(overlap?0:prior));
    this.bytes+=bytes-prior;r.slots.set(slot,bytes);this.calls++;
  }
  retire(id){if(this.objects.has(id))this.retired.add(id);}
  sync(){for(const id of this.retired){const r=this.objects.get(id);if(r){this.bytes-=[...r.slots.values()].reduce((a,b)=>a+b,0);this.objects.delete(id);}}this.retired.clear();}
  snapshot(){
    const byKind={texture:0,renderbuffer:0,buffer:0};let pendingDeleteBytes=0;
    for(const [id,r]of this.objects){const n=[...r.slots.values()].reduce((a,b)=>a+b,0);byKind[r.kind]+=n;if(this.retired.has(id))pendingDeleteBytes+=n;}
    return {bytes:this.bytes,peak:this.peak,byKind,pendingDeleteBytes,objects:this.objects.size,calls:this.calls};
  }
}

/** Installed only in an owned diagnostic context before game boot. No product code or GL arguments changed. */
export function installAllocationObserver(source) {
  const Ledger=(0,eval)('('+source.ledger+')'),mips=(0,eval)('('+source.mips+')');
  const contexts=new WeakMap();
  const state=gl=>{let s=contexts.get(gl);if(!s){s={ledger:new Ledger(),textures:new Map(),textureIds:new Map(),signatures:[],unknown:[],calls:{},defaultPeak:0,defaultBytes:0,defaultDimensions:''};contexts.set(gl,s);}return s;};
  const unknown=(s,value)=>{if(!s.unknown.includes(value))s.unknown.push(value);};
  const signature=(gl,s,id,call,raw,canonical)=>{
    if(!s.textureIds.has(id))s.textureIds.set(id,s.textureIds.size+1);
    if(s.signatures.length>=256){unknown(s,'texture signature limit');return;}
    s.signatures.push({texture:s.textureIds.get(id),call,activeUnit:gl.ACTIVE_TEXTURE===undefined?null:gl.getParameter(gl.ACTIVE_TEXTURE),raw,canonical});
  };
  const bpp=(gl,s,format,type)=>{
    const entries=[['R8',1],['RG8',2],['RGB8',4],['RGBA8',4],['SRGB8',4],['SRGB8_ALPHA8',4],['R16F',2],['RG16F',4],['RGB16F',8],['RGBA16F',8],
      ['R32F',4],['RG32F',8],['RGB32F',16],['RGBA32F',16],['DEPTH_COMPONENT16',4],['DEPTH_COMPONENT24',4],['DEPTH_COMPONENT32F',4],['DEPTH24_STENCIL8',4],['DEPTH32F_STENCIL8',8],['STENCIL_INDEX8',1]];
    for(const [key,n]of entries)if(gl[key]!==undefined&&format===gl[key])return n;
    if(format===gl.RGBA||format===gl.RGB)return type===gl.FLOAT?16:type===gl.HALF_FLOAT?8:4;
    if(format===gl.DEPTH_COMPONENT||format===gl.DEPTH_STENCIL)return 4;
    unknown(s,`format:${format},type:${type}`);return 64;
  };
  const texture=(gl,target)=>{
    if(target>=gl.TEXTURE_CUBE_MAP_POSITIVE_X&&target<=gl.TEXTURE_CUBE_MAP_NEGATIVE_Z)target=gl.TEXTURE_CUBE_MAP;
    const binding=target===gl.TEXTURE_2D?gl.TEXTURE_BINDING_2D:target===gl.TEXTURE_CUBE_MAP?gl.TEXTURE_BINDING_CUBE_MAP:
      target===gl.TEXTURE_3D?gl.TEXTURE_BINDING_3D:target===gl.TEXTURE_2D_ARRAY?gl.TEXTURE_BINDING_2D_ARRAY:null;
    return binding===null?null:gl.getParameter(binding);
  };
  const recordImage=(gl,args,compressed=false,volume=false)=>{
    const s=state(gl),target=args[0],level=args[1],id=texture(gl,target);
    if(!id){unknown(s,'image without bound texture');return;}
    let w,h,d=1,type,format=args[2],bytes;
    if(volume){w=args[3];h=args[4];d=args[5];type=compressed?null:args[8];}
    else if(args.length===6&&!compressed){const image=args[5];w=image.videoWidth||image.width;h=image.videoHeight||image.height;type=args[4];}
    else {w=args[3];h=args[4];type=compressed?null:args[7];}
    if(compressed){
      // Formats used by the current atlas experiment; reject unknown formats rather than claiming a scene verdict.
      if(format===0x93B0||format===0x8E8C)bytes=Math.ceil(w/4)*Math.ceil(h/4)*16*d;
      else {unknown(s,`compressed format:${format}`);bytes=w*h*d*64;}
    } else bytes=w*h*d*bpp(gl,s,format,type);
    if(![w,h,d,bytes].every(Number.isSafeInteger)){unknown(s,'invalid image dimensions');return;}
    s.ledger.reserve(id,'texture',`${target}:${level}`,bytes);
    signature(gl,s,id,compressed?'compressed image':'image',{target,level,format,w,h,d,type},{target,level,w,h,d,bytes});
    if(level===0)s.textures.set(id,{target,w,h,d,bpp:compressed?null:bpp(gl,s,format,type),immutable:false});
  };
  const wrap=(proto,name,after)=>{
    const native=proto[name];if(typeof native!=='function')return;
    proto[name]=function(...args){const value=native.apply(this,args),s=state(this);s.calls[name]=(s.calls[name]||0)+1;
      try{after(this,args,value);}catch(error){unknown(s,`observer:${name}:${error.message}`);}return value;};
  };
  for(const proto of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype].filter(Boolean)) {
    for(const [name,compressed,volume]of [['texImage2D',false,false],['compressedTexImage2D',true,false],['texImage3D',false,true],['compressedTexImage3D',true,true]])
      wrap(proto,name,(gl,args)=>recordImage(gl,args,compressed,volume));
    for(const volume of [false,true])wrap(proto,volume?'texStorage3D':'texStorage2D',(gl,a)=>{
      // WebIDL GLsizei conversion truncates Three's fractional log2(NPOT)+1 level argument.
      const s=state(gl),[target,rawLevels,format]=a,levels=Math.trunc(rawLevels),w=Math.trunc(a[3]),h=Math.trunc(a[4]),
        d=volume?Math.trunc(a[5]):1,id=texture(gl,target),n=bpp(gl,s,format);
      if(!id){unknown(s,'storage without bound texture');return;}
      signature(gl,s,id,'immutable storage',{target,levels:rawLevels,w:a[3],h:a[4],d:volume?a[5]:1,format},{target,levels,w,h,d,bpp:n});
      for(const [i,m]of mips(w,h,n,levels).entries())s.ledger.reserve(id,'texture',`${target}:${i}`,m.bytes*(target===gl.TEXTURE_3D?Math.max(1,d>>i):d)*(target===gl.TEXTURE_CUBE_MAP?6:1));
      s.textures.set(id,{target,w,h,d,bpp:n,immutable:true});
    });
    wrap(proto,'generateMipmap',(gl,a)=>{
      const s=state(gl),id=texture(gl,a[0]),m=s.textures.get(id);
      signature(gl,s,id,'generate mipmaps',{target:a[0]},{base:m||null});
      if(!m?.bpp){unknown(s,'mipmap without known base');return;}
      if(m.immutable)return; // texStorage already reserved every level; generation changes pixels only.
      const targets=a[0]===gl.TEXTURE_CUBE_MAP?[0,1,2,3,4,5].map(i=>gl.TEXTURE_CUBE_MAP_POSITIVE_X+i):[m.target];
      for(const target of targets)for(const [i,l]of mips(m.w,m.h,m.bpp).entries())if(i)s.ledger.reserve(id,'texture',`${target}:${i}`,l.bytes*(m.target===gl.TEXTURE_3D?Math.max(1,m.d>>i):m.d),false);
    });
    wrap(proto,'bufferData',(gl,a)=>{
      const s=state(gl),target=a[0],bindings=[[gl.ARRAY_BUFFER,gl.ARRAY_BUFFER_BINDING],[gl.ELEMENT_ARRAY_BUFFER,gl.ELEMENT_ARRAY_BUFFER_BINDING],
        [gl.COPY_READ_BUFFER,gl.COPY_READ_BUFFER_BINDING],[gl.COPY_WRITE_BUFFER,gl.COPY_WRITE_BUFFER_BINDING],[gl.PIXEL_PACK_BUFFER,gl.PIXEL_PACK_BUFFER_BINDING],
        [gl.PIXEL_UNPACK_BUFFER,gl.PIXEL_UNPACK_BUFFER_BINDING],[gl.UNIFORM_BUFFER,gl.UNIFORM_BUFFER_BINDING],[gl.TRANSFORM_FEEDBACK_BUFFER,gl.TRANSFORM_FEEDBACK_BUFFER_BINDING]];
      const binding=bindings.find(([t])=>t!==undefined&&t===target)?.[1],id=binding===undefined?null:gl.getParameter(binding);
      if(!id){unknown(s,`unknown buffer target:${target}`);return;}
      const data=a[1],element=data?.BYTES_PER_ELEMENT||1,bytes=typeof data==='number'?data:a[4]?a[4]*element:(data?.byteLength||0)-(a[3]||0)*element;
      s.ledger.reserve(id,'buffer',0,bytes);
    });
    for(const multisample of [false,true])wrap(proto,multisample?'renderbufferStorageMultisample':'renderbufferStorage',(gl,a)=>{
      const s=state(gl),offset=multisample?1:0,samples=multisample?Math.max(1,a[1]):1,id=gl.getParameter(gl.RENDERBUFFER_BINDING);
      if(!id){unknown(s,'storage without bound renderbuffer');return;}
      s.ledger.reserve(id,'renderbuffer',0,a[2+offset]*a[3+offset]*bpp(gl,s,a[1+offset])*samples);
    });
    for(const [name,kind]of [['deleteTexture','texture'],['deleteBuffer','buffer'],['deleteRenderbuffer','renderbuffer']])
      wrap(proto,name,(gl,a)=>{const s=state(gl);s.ledger.retire(a[0]);if(kind==='texture')s.textures.delete(a[0]);});
    wrap(proto,'finish',gl=>state(gl).ledger.sync());
  }
  window.__allocation={snapshot(gl){const s=state(gl),attrs=gl.getContextAttributes(),pixels=gl.drawingBufferWidth*gl.drawingBufferHeight;
    // Conservative two RGBA8 colour surfaces plus a 32-bit depth surface; browser/driver storage is unmeasured.
    const defaultFramebuffer=pixels*(8+(attrs.depth?4:0)+(attrs.stencil?4:0));
    const dimensions=`${gl.drawingBufferWidth}:${gl.drawingBufferHeight}`;
    s.defaultPeak=Math.max(s.defaultPeak,defaultFramebuffer+(dimensions!==s.defaultDimensions?s.defaultBytes:0));
    s.defaultBytes=defaultFramebuffer;s.defaultDimensions=dimensions;
    return {...s.ledger.snapshot(),defaultFramebuffer,defaultPeak:s.defaultPeak,framebufferAssumption:'two RGBA8 colour surfaces, 32-bit depth/stencil when enabled; no native measurement',
      dimensions:[gl.drawingBufferWidth,gl.drawingBufferHeight],attributes:attrs,unknown:s.unknown,calls:s.calls,signatures:s.signatures,
      textureSlots:[...s.ledger.objects].filter(([,r])=>r.kind==='texture').map(([id,r])=>({texture:s.textureIds.get(id),slots:Object.fromEntries(r.slots)}))};
  }};
}
