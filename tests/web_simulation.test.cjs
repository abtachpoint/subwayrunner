'use strict';
const assert = require('node:assert/strict');
const Simulation = require('../web/simulation.js');
let checks = 0;
function check(value, label) { checks++; assert.ok(value, label); }
function clear(seed=7) { const s = new Simulation(); s.start(seed); s._objects=[]; s._next_segment=1e12; return s; }
function advance(s, seconds, frame=1/60) { for (let t=0; t<seconds-1e-8; t+=frame) s.update(Math.min(frame,seconds-t)); }
function earliest(s, lane) {
  let nearest = 10000;
  for (const o of s._objects) {
    if (o.lane !== lane || !['train','barrier','lowbar'].includes(o.kind)) continue;
    const velocity=s.speed+(o.own_speed||0), half=o.length*0.5+0.4;
    if ((-o.z+half)/velocity<=0) continue;
    nearest=Math.min(nearest,Math.max(0,(-o.z-half)/velocity));
  }
  return nearest;
}
function steer(s) {
  if (Math.abs(s.player_x-s.lane*2.6)>0.1) return;
  let best=s.lane, clearance=earliest(s,s.lane);
  if (clearance>1.45) return;
  for (const candidate of [s.lane-1,s.lane+1]) {
    if (candidate< -1||candidate>1) continue;
    const next=earliest(s,candidate);
    if(next>clearance){clearance=next;best=candidate;}
  }
  if(best!==s.lane)s.move_lane(best-s.lane);
}
{
 const a=new Simulation(),b=new Simulation(),c=new Simulation();a.start(41);b.start(41);c.start(42);
 check(JSON.stringify(a.snapshot().objects)===JSON.stringify(b.snapshot().objects),'seed repeats course');
 check(JSON.stringify(a.snapshot().objects)!==JSON.stringify(c.snapshot().objects),'seeds vary course');
 check(a._objects.some(o=>o.kind==='train'&&o.moving)&&a._objects.some(o=>o.kind==='ramp'),'train and ramp courses');
}
{
 const a=clear(),b=clear();advance(a,20,1/30);advance(b,20,1/120);
 check(Math.abs(a.distance-b.distance)<0.01&&a.score===b.score,'30 and120fps agree');
 const before=a.distance;a.set_paused(true);a.update(0.2);check(a.distance===before,'pause freezes');a.set_paused(false);
 a.move_lane(1);a.move_lane(1);advance(a,0.3);check(a.lane===1&&a.player_x===2.6,'lane clamps smoothly');
 a.jump();a.jump();check(a.jumps===1,'no double jump');const d=a.distance;a.update(20);check(a.distance-d<7,'long resumed frame bounded');
}
{
 const s=clear(),moving=s._new_object('train',-1,-50,14,2.7),still=s._new_object('train',1,-50,14,2.7);
 moving.moving=true;moving.own_speed=12;advance(s,0.2);
 check(Math.abs(moving.z-still.z-2.4)<0.001,'oncoming train rushes faster than scenery');
 const hit=clear(),train=hit._new_object('train',0,-16,14,2.7);train.own_speed=40;hit.update(0.25);
 check(hit.phase==='crashed','swept contact prevents fast train tunneling');
}
for(const [kind, action, survives] of [['barrier',null,false],['barrier','jump',true],['lowbar',null,false],['lowbar','slide',true]]){
 const s=clear();s._new_object(kind,0,-5,1.1,kind==='barrier'?1.05:1.9);if(action)s[action]();advance(s,0.6);
 check((s.phase==='running')===survives,kind+' responds to '+action);
}
{
 const s=clear();s._new_object('train',0,-19,14,2.7);s._new_object('ramp',0,-8.6,7,2.7);advance(s,1.2);
 check(s.phase==='running'&&Math.abs(s.player_y-2.7)<0.02,'ramp joins train roof');s.jump();advance(s,0.25);
 check(s.player_y>4.3,'roof jump starts at roof');advance(s,2.2);check(s.phase==='running'&&s.player_y===0,'roof fall lands safely');
 const land=clear();land._new_object('train',0,0,14,2.7);land.player_y=3.2;land.vertical_velocity=-1;land._grounded=false;advance(land,0.2);
 check(land.phase==='running'&&land.player_y===2.7,'fall lands atop roof');
}
{
 const s=clear();s._new_object('coin',0,-1,0.45,0.95);advance(s,0.3);check(s.coins===1,'coin grants once');
 s.magnet=1;s._new_object('coin',1,-5,0.45,0.95);s.update(0.02);check(s.coins===2,'magnet reaches adjacent coin');
 const p=s._new_object('powerup',0,-0.8,0.6,1.05);p.tag='double_score';advance(s,0.1);check(s.double_score>13.8,'multiplier applies');
 const score=s.score;advance(s,15);check(s.double_score===0&&s.score>=score,'expiry never lowers score');
}
{
 const s=clear();s.use_shield();s._new_object('barrier',0,-0.7,1.1,1.05);advance(s,0.1);check(s.phase==='running'&&s.shield===0,'shield absorbs once');
 s.use_shield();check(s.shield===0&&s.shield_charges===0,'shield spent');advance(s,2);s._new_object('barrier',0,-0.7,1.1,1.05);s.update(0.1);
 check(s.phase==='crashed'&&s.revive(),'one mechanical revive');check(s._objects.length===0,'revive clears contact zone');advance(s,3.1);
 s._new_object('barrier',0,-0.7,1.1,1.05);s.update(0.1);check(s.phase==='crashed'&&!s.revive(),'only one revive per run');
}
{
 const s=new Simulation();s.start(17);check(s._objects.some(o=>o.lane===0&&['train','barrier','lowbar'].includes(o.kind)),'centre has hazards');
 advance(s,12);check(s.phase==='crashed','idle centre eventually crashes');
}
for(const seed of [1,3,13,41,777,2601,90909]){
 const s=new Simulation();s.start(seed);let max=0,frames=0;const target=seed===90909?4000:1800;
 while(s.distance<target&&s.phase==='running'&&frames++<15000){steer(s);s.update(1/30);max=Math.max(max,s._objects.length);}
 check(s.distance>=target&&s.phase==='running','geometry-only ground planner survives seed '+seed);
 check(max<180&&s.dodges>20,'bounded objects and active dodging '+seed);
}
console.log(`WEB SIMULATION: ${checks} checks passed. No browser/device behavior covered.`);
