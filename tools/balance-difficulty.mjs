// Diagnostic plans/traces only. No combat numbers, outcomes or difficulty settings are changed.
export function authoredDuration(scenario) {
  const sec=s=>{if(!/^\d{2}:\d{2}$/.test(s))throw new Error('difficulty diagnostic: authored clock required');const [h,m]=s.split(':').map(Number);return h*3600+m*60;};
  const ratio=scenario.clockRatio??4,duration=(sec(scenario.end)-sec(scenario.start))/ratio;
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(ratio)||ratio<=0)throw new Error('difficulty diagnostic: invalid authored duration');return duration;
}
export function fixedPlayerOrders(scenario) {
  const target=[scenario.objective?.x,scenario.objective?.z];
  if(!target.every(Number.isFinite))throw new Error('difficulty diagnostic: objective required');
  const orders=scenario.units.filter(u=>u.side==='US'&&(u.type||'infantry')==='infantry').map(u=>({unitId:u.id,type:'move',points:[[u.x,u.z],[...target]]}));
  if(!orders.length||new Set(orders.map(o=>o.unitId)).size!==orders.length||orders.some(o=>!o.points.flat().every(Number.isFinite)))throw new Error('difficulty diagnostic: invalid fixed orders');
  return orders;
}
export function pairwiseOrderTraces(rows) {
  if(rows.length!==3||new Set(rows.map(r=>r.difficulty)).size!==3)throw new Error('difficulty diagnostic: three distinct observations required');
  const comparisons=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)comparisons.push({pair:[rows[i].difficulty,rows[j].difficulty],different:JSON.stringify(rows[i].trace.orders)!==JSON.stringify(rows[j].trace.orders)});
  return comparisons;
}
/** Owned Actions context only. Native calls/arguments/results/errors survive; nested methods count once. */
export function installDifficultyStartGate(scope=globalThis) {
  const native=scope.requestAnimationFrame;let held=true;
  scope.requestAnimationFrame=function(callback){
    if(typeof callback!=='function')return native.call(this,callback);
    return native.call(this,function(timestamp){
      if(held&&scope.__game?.game)scope.__game.game.paused=true;
      return callback.call(this,timestamp);
    });
  };
  const gate={release(){held=false;},get held(){return held;}};
  scope.__difficultyStartGate=gate;return gate;
}
export function installDifficultyTrace(game) {
  const trace={orders:[],passes:0,reserves:[],holder:[{at:game.simTime,value:game.holder}],overflow:false},bound=new WeakSet(),reserve=new Map();
  const time=()=>Math.round(game.simTime*1000)/1000;
  const point=p=>Array.isArray(p)?p.map(v=>Math.round(v*1000)/1000):null;
  let inPass=false,depth=0;
  const append=(list,row)=>{if(list.length>=20000){trace.overflow=true;return;}list.push(row);};
  const bind=u=>{
    if(bound.has(u)||u.side===game.playerSide)return;bound.add(u);
    for(const name of ['orderMove','orderAttack','orderFallback','orderCharge','orderHold','orderHalt','toggleMount']){
      const native=u[name];if(typeof native!=='function')continue;
      u[name]=function(...args){const outer=inPass&&depth===0;depth++;let value;
        try{value=native.apply(this,args);}finally{depth--;}
        if(outer&&value!==false){const o=this.order;append(trace.orders,{at:time(),id:this.id,method:name,type:o.type,destination:point(o.dest),target:o.target?.id||null,facing:Number.isFinite(o.endFacing)?Math.round(o.endFacing*1000)/1000:null});}return value;
      };
    }
  };
  const nativeStep=game.ai.step;
  game.ai.step=function(...args){
    game.units.forEach(bind);const pass=this.t-args[0]<=0,previous=inPass;inPass=pass;
    let value;try{value=nativeStep.apply(this,args);}finally{inPass=previous;}
    if(pass){trace.passes++;for(const u of game.units){if(u.side!==this.side||u.def.ai?.role!=='reserve')continue;
      const m=this.memo.get(u),state={active:!!m?.active,toObjective:!!m?.toObjective},prior=reserve.get(u.id)||{active:false,toObjective:false};
      if(state.active!==prior.active||state.toObjective!==prior.toObjective)append(trace.reserves,{at:time(),id:u.id,...state,destination:point(u.order.dest)});reserve.set(u.id,state);
    }}return value;
  };
  const nativeTick=game.tick;
  game.tick=function(...args){const value=nativeTick.apply(this,args);if(trace.holder.at(-1).value!==this.holder)append(trace.holder,{at:time(),value:this.holder});return value;};
  return trace;
}
