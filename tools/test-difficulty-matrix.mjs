import assert from 'node:assert/strict';import fs from 'node:fs';
import {fixedPlayerOrders,pairwiseOrderTraces,installDifficultyTrace,installDifficultyStartGate,authoredDuration,reserveActivationCause} from './balance-difficulty.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url))),phases=[read('assets/packs/shiloh.json').phases.find(p=>p.id==='buell-attacks'),read('assets/packs/stones-river.json').phases.find(p=>p.id==='dawn-on-the-right')];
function nativeControl(install){
  const nativeError=new Error('native failure'),u={id:'reserve',side:'CS',def:{ai:{role:'reserve'}},order:{type:'hold'},orderMove(points){this.args=points;this.order={type:'move',dest:points.at(-1)};return true;},orderCharge(target){this.orderMove([[0,0],[2,3]]);this.order.type='charge';this.order.target=target;return true;},orderAttack(){throw nativeError;}};
  const g={playerSide:'US',simTime:0,holder:null,units:[u],ai:{side:'CS',t:0,memo:new WeakMap(),step(dt){this.t-=dt;if(this.t>0)return 'wait';this.t=1;u.orderCharge({id:'foe'});this.memo.set(u,{active:true,toObjective:false});return 'pass';}},tick(){this.simTime+=.05;return 'tick';}};
  const trace=install(g),points=[[1,2],[3,4]];g.ai.step(.05);assert.equal(u.orderMove(points),true);const result=g.ai.step(.05);g.tick();
  let error;try{u.orderAttack();}catch(e){error=e;}return {trace,result,error,nativeError,u,points};
}
const api={orders:fixedPlayerOrders,pairs:pairwiseOrderTraces,install:installDifficultyTrace,duration:authoredDuration,gate:installDifficultyStartGate,cause:reserveActivationCause};
const checks=[
 ['time-zero-gate',a=>{
   let id=0;const pending=new Map(),nativeError=new Error('native RAF argument'),scope={requestAnimationFrame(cb){assert.equal(this,scope);if(typeof cb!=='function')throw nativeError;pending.set(++id,cb);return id;},cancelAnimationFrame(handle){pending.delete(handle);}};
   const run=(handle,time)=>{const cb=pending.get(handle);pending.delete(handle);return cb.call(scope,time);};
   const gate=a.gate(scope);let calls=0,receiver,timestamp;
   const pre=scope.requestAnimationFrame(function(t){calls++;receiver=this;timestamp=t;return 'native callback';});
   assert.equal(run(pre,123),'native callback','time-zero-gate: preboot callback return survives');
   assert.equal(receiver,scope,'time-zero-gate: callback receiver survives');assert.equal(timestamp,123,'time-zero-gate: timestamp survives');
   const cancelled=scope.requestAnimationFrame(()=>calls++);scope.cancelAnimationFrame(cancelled);assert.equal(pending.has(cancelled),false,'time-zero-gate: native cancellation survives');
   scope.__game={game:{paused:false,simTime:0}};const held=scope.requestAnimationFrame(()=>assert.equal(scope.__game.game.paused,true,'time-zero-gate: pause before callback'));run(held,124);
   assert.equal(held,3,'time-zero-gate: native handle preserved');assert.equal(calls,1,'time-zero-gate: no duplicate callbacks');
   gate.release();assert.equal(scope.__game.game.paused,true,'time-zero-gate: release never unpauses');scope.__game.game.paused=false;
   run(scope.requestAnimationFrame(()=>assert.equal(scope.__game.game.paused,false,'time-zero-gate: released native frame advances')),125);
   let error;try{scope.requestAnimationFrame(null);}catch(e){error=e;}assert.equal(error,nativeError,'time-zero-gate: native argument exception survives');
   const callbackError=new Error('callback');try{run(scope.requestAnimationFrame(()=>{throw callbackError;}),126);}catch(e){error=e;}assert.equal(error,callbackError,'time-zero-gate: callback exception survives');
 }],
 ['authored-duration',a=>assert.deepEqual(phases.map(p=>a.duration(p.scenario)),[34200/28,1050],'authored-duration: complete authored historical seconds converted once')],
 ['authored-fixed-orders',a=>{for(const phase of phases){const raw=JSON.stringify(phase),orders=a.orders(phase.scenario);assert.ok(orders.length>0,'authored-fixed-orders: player formations present');for(const o of orders){const u=phase.scenario.units.find(u=>u.id===o.unitId);assert.deepEqual(o.points,[[u.x,u.z],[phase.scenario.objective.x,phase.scenario.objective.z]],'authored-fixed-orders: authored spawn and objective bound');}assert.deepEqual(a.orders({...phase.scenario,difficulty:'general'}),orders,'authored-fixed-orders: difficulty cannot change player tuple');assert.equal(JSON.stringify(phase),raw,'authored-fixed-orders: source remains unchanged');}}],
 ['semantic-comparison',a=>{const rows=['recruit','veteran','general'].map((difficulty,i)=>({difficulty,trace:{orders:[{id:'a',at:i===2?2:1}],passes:10+i}})),pairs=a.pairs(rows);assert.deepEqual(pairs.map(p=>p.different),[false,true,true],'semantic-comparison: cadence alone not order divergence');}],
 ['native-order-trace',a=>{const o=nativeControl(a.install);assert.equal(o.trace.orders.length,1,'native-order-trace: nested native movement counted once');assert.equal(o.trace.orders[0].type,'charge','native-order-trace: final semantic order');assert.equal(o.u.args,o.points,'native-order-trace: native arguments retain identity');assert.equal(o.trace.passes,1,'native-order-trace: actual pass counted once');assert.equal(o.result,'wait','native-order-trace: native return preserved');assert.equal(o.error,o.nativeError,'native-order-trace: native exception preserved');assert.equal(o.trace.reserves[0].active,true,'native-order-trace: reserve commitment recorded at pass');}],
 ['reserve-native-inputs',a=>{
   let calls=0,received;const nativeError=new Error('native activation');
   const g={units:[],playerSide:'US',simTime:20,clockStart:30600,clockEnd:54000,clockRatio:22,holder:'CS',tick(){},ai:{side:'CS',level:{reserve:'threat',reserveShare:0,reserveReach:350,threat:false},step(){},activates(...args){assert.equal(this,g.ai);calls++;received=args;if(args[2]===-1)throw nativeError;return args[2]<350;}}};
   const u={id:'moore',def:{ai:{role:'reserve',at:'13:00'}}},state={},T={start:0,reach:1},trace=a.install(g);
   assert.equal(g.ai.activates(u,'reserve',400,state,T),false,'reserve-native-inputs: native false survives');
   assert.equal(g.ai.activates(u,'reserve',300,state,T),true,'reserve-native-inputs: native true survives');
   assert.equal(calls,2,'reserve-native-inputs: calls not duplicated');assert.equal(received[0],u,'reserve-native-inputs: unit identity');assert.equal(received[3],state,'reserve-native-inputs: memo identity');assert.equal(received[4],T,'reserve-native-inputs: temperament identity');
   assert.equal(trace.activations.length,1,'reserve-native-inputs: actual decision recorded');assert.equal(trace.activations[0].previousWait.nearest,400,'reserve-native-inputs: preceding refusal retained');assert.equal(trace.activations[0].clock,31040,'reserve-native-inputs: clock converted once');
   let error;try{g.ai.activates(u,'reserve',-1,state,T);}catch(e){error=e;}assert.equal(error,nativeError,'reserve-native-inputs: native exception survives');assert.equal(trace.activations.length,1,'reserve-native-inputs: exception not recorded as activation');
 }],
 ['reserve-cause',a=>{
   const r={accepted:true,clock:45000,start:30600,end:54000,at:46800,temperament:{start:0,reach:1},level:{reserve:'set',reserveShare:.5,reserveReach:350,threat:false},nearest:100,holder:'US',playerSide:'US'};
   assert.equal(a.cause(r),null,'reserve-cause: Recruit cannot commit early on threat');assert.equal(a.cause({...r,clock:46800}),'set-time','reserve-cause: authored at');
   assert.equal(a.cause({...r,at:null}),'half-time','reserve-cause: absent at uses middle of authored window');
   const v={...r,nearest:300,level:{...r.level,reserve:'threat'}};assert.equal(a.cause(v),'enemy-near','reserve-cause: actual nearest distance');
   assert.equal(a.cause({...v,nearest:400}),'objective-lost','reserve-cause: actual holder');
   assert.equal(a.cause({...v,nearest:400,holder:'contested',level:{...v.level,threat:true}}),'objective-contested','reserve-cause: General contested trigger');
   assert.equal(a.cause({...v,accepted:false}),null,'reserve-cause: native refusal cannot prove activation');
 }],
];
const mutants={'time-zero-gate':{gate:s=>{const gate=installDifficultyStartGate(s);gate.release();return gate;}},'authored-duration':{duration:s=>authoredDuration(s)/60},'authored-fixed-orders':{orders:s=>fixedPlayerOrders(s).map(o=>({...o,points:[[0,0],[0,0]]}))},'semantic-comparison':{pairs:r=>r.map(()=>({different:true}))},'native-order-trace':{install:g=>{const t=installDifficultyTrace(g);t.orders.push({});return t;}}};
mutants['reserve-native-inputs']={install:g=>{const t=installDifficultyTrace(g);t.activations.push({});return t;}};
mutants['reserve-cause']={cause:()=> 'set-time'};
for(const [,check]of checks)check(api);console.log(`DIFFICULTY-MATRIX OK (${checks.length}/${checks.length})`);
if(process.argv.includes('--prove-fail')){for(const [name,check]of checks){let error;try{check({...api,...mutants[name]});}catch(e){error=e;}assert.ok(error?.code==='ERR_ASSERTION'&&error.message.startsWith(name),`${name}: mutant must fail its own assertion`);console.log(`CAUGHT ${name}`);}console.log(`DIFFICULTY-MATRIX CONTROLS OK (${checks.length}/${checks.length})`);}
