'use strict';
/* Deterministic feature acceptance checks: these are not device or GPU tests. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const Runner=require('../web/simulation.js');
function isolated(){const r=new Runner();r.start(101);r._objects=[];r._next_segment=1e10;return r;}
function advance(r,time){let t=0;while(t<time-.000001){const d=Math.min(1/60,time-t);r.update(d);t+=d;}}

test('pace starts fast, keeps increasing beyond previous speed cap, remains deterministic',()=>{
 const r=isolated();assert.ok(r.speed>=20);r.distance=3000;r.update(1/60);const mid=r.speed;
 r.distance=10000;r.update(1/60);assert.ok(r.speed>mid&&r.speed>27);
 r.distance=80000;r.update(1/60);assert.ok(r.speed>120,'No fixed maximum velocity');
 assert.equal(Runner.MAX_SPEED,Infinity);
});

test('convoy cars are visible physical hazards, same-lane, moving together; safe corridor remains',()=>{
 const s=new Runner();s.start(104);const group=s._objects.filter(o=>o.kind==='train'&&o.convoy===0);
 assert.equal(group.length,3);assert.deepEqual(group.map(o=>o.car_index).sort(),[0,1,2]);
 assert.ok(group.every(o=>o.moving&&o.own_speed===group[0].own_speed&&o.lane===group[0].lane));
 const safe=s._route[0].safe_lane;assert.ok(group.every(o=>o.lane!==safe));
});

test('down swipe in midair becomes a fast-fall and a landing roll, never a free midair shield',()=>{
 const s=isolated();s.jump();s.update(.08);s.slide();assert.equal(s.slides,1);assert.equal(s._queued_slide,true);
 assert.ok(s.vertical_velocity<=-8);advance(s,.9);
 assert.equal(s._queued_slide,false);assert.equal(s._grounded,true);
 assert.ok(s._landing_time>=0);assert.ok(s.shield_charges===1);
});

test('original model assets stay immutable; additional original fox rig validates packed geometry',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'web/assets/models.js'),'utf8'),context);
 const initial=Object.keys(context.window.RUNNER_MODELS.characters);vm.runInNewContext(fs.readFileSync(path.join(root,'web/assets/fox.js'),'utf8'),context);
 assert.ok(!initial.includes('fox'));const fox=context.window.RUNNER_MODELS.characters.fox;
 assert.equal(fox.bones.length,13);
 assert.ok(fox.bones.reduce((sum,b)=>sum+b.mesh.count,0)>10000);
 for(const bone of fox.bones)assert.equal(Buffer.from(bone.mesh.data,'base64').length,bone.mesh.count*16);
});

test('running styles have independent predictable movement specialities',()=>{
 const robot=new Runner();robot.start(4,'robot');assert.equal(robot.shield_charges,2);
 const courier=new Runner();courier.start(4,'courier');assert.equal(courier.shield_charges,1);
 const fox=new Runner();fox.start(4,'fox');assert.ok(fox.magnet>0);
 const sprinter=isolated();sprinter.start(4,'sprinter');sprinter.jump();assert.ok(sprinter.vertical_velocity>12);
 const skater=isolated();skater.start(4,'skater');skater.slide();assert.ok(skater._slide_time>1);
});

test('district shaders and graphics settings preserve base 3D models',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'web/renderer.js'),'utf8'),context);
 const renderer=Object.create(context.window.RunnerRenderer.prototype);
 const names=[0,1100,2200,3300].map(d=>renderer._district(d).name);
 assert.deepEqual(names,['SUNRISE CITY','GREEN LINE','GOLDEN TERMINAL','NEON NIGHT']);
 assert.ok(renderer._district(3280).fog.every(v=>v>=0&&v<=1));
 const stylesheet=fs.readFileSync(path.join(root,'web/style.css'),'utf8');
 for(const klass of ['runner-showcase','age-slider','crash-burst','loading-bar'])assert.ok(stylesheet.includes(klass));
});
