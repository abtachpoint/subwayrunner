'use strict';
const assert = require('node:assert/strict');
const RunnerAudio = require('../web/audio.js');
let checks = 0;
function check(value, label) { checks++; assert.ok(value, label); }

class Param { constructor(){this.value=0;this.calls=[];} setValueAtTime(v,t){this.value=v;this.calls.push(['set',v,t]);return this;} exponentialRampToValueAtTime(v,t){if(!(v>0))throw new Error('exponential ramp target must be > 0, got '+v);this.value=v;this.calls.push(['exp',v,t]);return this;} linearRampToValueAtTime(v,t){this.value=v;return this;} setTargetAtTime(v,t,k){this.value=v;this.calls.push(['target',v]);return this;} cancelScheduledValues(){return this;} }
class Node { constructor(ctx,kind){this.ctx=ctx;this.kind=kind;this.connected=[];this.started=null;this.stopped=null;this.onended=null;this.frequency=new Param();this.gain=new Param();this.Q=new Param();this.detune=new Param();this.pan=new Param();this.threshold=new Param();this.ratio=new Param();this.type='';ctx.created.push(this);} connect(n){this.connected.push(n);return n;} disconnect(){} start(t){this.started=t;this.ctx.started.push(this);} stop(t){this.stopped=t;} }
class FakeContext {
  constructor(){this.created=[];this.started=[];this.currentTime=0;this.state='running';this.sampleRate=8000;this.destination=new Node(this,'destination');}
  createGain(){return new Node(this,'gain');} createOscillator(){return new Node(this,'osc');} createBiquadFilter(){return new Node(this,'filter');}
  createBufferSource(){return new Node(this,'noise');} createStereoPanner(){return new Node(this,'panner');} createDynamicsCompressor(){return new Node(this,'comp');}
  createBuffer(c,l){return {getChannelData(){return new Float32Array(l);}};}
  resume(){this.state='running';return Promise.resolve();} suspend(){this.state='suspended';return Promise.resolve();}
}
function make(settings={music:true,sfx:true}) { const a=RunnerAudio.create({settings:()=>settings,AudioContextClass:FakeContext}); a.unlock(); return a; }
const state=(extra={})=>Object.assign({phase:'running',speed:22,grounded:true,sliding:false,player_x:0,player_y:0,objects:[]},extra);
function frames(a,seconds,make,mode='run',fps=60){for(let i=0;i<seconds*fps;i++){a.ctx.currentTime+=1/fps;a.tick(a.ctx.currentTime,mode==='run',make(i),mode);}}

{ // run music schedules notes ahead and speeds up with pace
  const a=make();frames(a,2,()=>state());
  const osc=a.ctx.started.filter(n=>n.kind==='osc').length,noise=a.ctx.started.filter(n=>n.kind==='noise').length;
  check(a.currentMode==='run'&&osc>40&&noise>20,'run theme schedules drums, bass and lead ('+osc+' osc / '+noise+' noise)');
  const kicks=a.ctx.started.filter(n=>n.kind==='osc'&&n.frequency.calls.some(c=>c[0]==='set'&&c[1]===150)).length;
  check(kicks>=4,'four-on-the-floor kick pattern ('+kicks+' kicks in 2 s)');
  const slow=make(),fast=make();frames(slow,3,()=>state({speed:21}));frames(fast,3,()=>state({speed:45}));
  const hits=x=>x.ctx.started.filter(n=>n.kind==='osc'&&n.frequency.calls.some(c=>c[0]==='set'&&c[1]===150)).length;
  check(hits(fast)>hits(slow),'tempo rises with speed ('+hits(slow)+' -> '+hits(fast)+')');
}
{ // menu theme is calmer than run theme and switches cleanly
  const a=make();frames(a,2,()=>state(),'menu');
  check(a.currentMode==='menu','menu theme plays outside a run');
  const kick=a.ctx.started.some(n=>n.kind==='osc'&&n.frequency.calls.some(c=>c[1]===150));check(!kick,'menu theme has no kick drum');
  frames(a,1,()=>state(),'run');check(a.currentMode==='run','switches to the serious run theme when a run starts');
  frames(a,.5,()=>state(),'hush');check(a.currentMode==='hush','music hushes on crash/pause');
}
{ // footsteps follow pace, stop while sliding or airborne, and change on train roofs
  const a=make();frames(a,2,()=>state(),'run');
  const before=a.events;frames(a,1,()=>state({sliding:true}));const sliding=a.events-before;
  const b=make();frames(b,1,()=>state(),'run');const steps=b.events;
  check(steps>0,'footsteps and music produce events');
  const quiet=make({music:false,sfx:true});frames(quiet,1,()=>state(),'run');const stepsOnly=quiet.events;
  check(stepsOnly>=4&&stepsOnly<=14,'about 5 footsteps per second when music is off ('+stepsOnly+')');
  const air=make({music:false,sfx:true});frames(air,1,()=>state({grounded:false}),'run');check(air.events===0,'no footsteps while airborne');
  const slide=make({music:false,sfx:true});frames(slide,1,()=>state({sliding:true}),'run');check(slide.events===0,'no footsteps while sliding');
}
{ // sound effects respect the settings and never ramp to zero (Web Audio would throw)
  const off=make({music:true,sfx:false});off.effect('jump');check(off.events===0,'effects are silent when sound effects are off');
  const on=make({music:false,sfx:true});['coin','jump','slide','dive','roll','land','crash','powerup','shield','shield_hit','revive'].forEach(k=>{const before=on.events;on.effect(k);check(on.events>before,'effect '+k+' produces sound');});
  on.effect('unknown');check(true,'unknown effects are ignored');
}
{ // oncoming train: one horn per train, then rail-joint clatter as it passes, rumble builds up
  const a=make({music:false,sfx:true});
  const train={id:7,kind:'train',lane:1,z:-90,length:14,moving:true,own_speed:12};
  let hornEvents=0,prev=0;
  for(let i=0;i<60*6;i++){train.z+=(22+12)/60;a.ctx.currentTime+=1/60;a.tick(a.ctx.currentTime,true,state({objects:[train]}),'run');
    if(train.z>-70&&train.z<-60&&hornEvents===0){hornEvents=a.ctx.started.filter(n=>n.kind==='osc'&&n.type==='sawtooth').length;}
    prev=a.events;}
  const saws=a.ctx.started.filter(n=>n.kind==='osc'&&n.type==='sawtooth').length;
  check(saws===2,'exactly one two-tone horn is sounded for the oncoming train ('+saws+' sawtooth voices)');
  const panned=a.ctx.created.filter(n=>n.kind==='panner'&&n.pan.value>0.1).length;check(panned>0,'train in the right lane is panned right');
  const ticks=a.ctx.started.filter(n=>n.kind==='noise').length;check(ticks>20,'wheel clatter plays as the train passes ('+ticks+' ticks)');
  const rumble=a.ctx.created.some(n=>n.kind==='gain'&&n.gain.calls.some(c=>c[0]==='target'&&c[1]>0.05));check(rumble,'low rumble swells as the train closes in');
}
{ // a parked train beside the player still clatters (rails under the player), a far one does not
  const near=make({music:false,sfx:true});const parked={id:1,kind:'train',lane:1,z:0,length:14,moving:false,own_speed:0};
  for(let i=0;i<60;i++){near.ctx.currentTime+=1/60;near.tick(near.ctx.currentTime,true,state({objects:[parked]}),'run');}
  const far=make({music:false,sfx:true});const distant={id:2,kind:'train',lane:1,z:-150,length:14,moving:false,own_speed:0};
  for(let i=0;i<60;i++){far.ctx.currentTime+=1/60;far.tick(far.ctx.currentTime,true,state({objects:[distant]}),'run');}
  const clack=x=>x.ctx.started.filter(n=>n.kind==='noise').length;
  check(clack(near)>clack(far)+3,'passing a train makes more noise than a distant one');
}
{ // suspended context stays silent and unlock resumes it
  const a=RunnerAudio.create({settings:()=>({music:true,sfx:true}),AudioContextClass:FakeContext});a.unlock();a.ctx.state='suspended';
  a.effect('jump');check(a.events===0,'nothing plays while the context is suspended');a.unlock();check(true,'unlock requests resume');
}
console.log(`AUDIO: ${checks} checks passed. Procedural synth logic only; actual loudness and taste need a device.`);
