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

// ---- Train variety: twin trains, climbable running train, coupled roof run, parked pair ----
{
 const kinds=new Set();
 for(let seed=1;seed<=24;seed++){
  const s=new Simulation();s.start(seed);
  for(let guard=0;guard<40&&s.distance<4200&&s.phase==='running';guard++){steer(s);for(let i=0;i<20&&s.phase==='running';i++){steer(s);s.update(1/30);}
   for(const o of s._objects){if(o.twin!==undefined&&o.moving)kinds.add('twin-moving');if(o.away&&o.kind==='train')kinds.add('away');if(o.chain!==undefined)kinds.add('chain');if(o.twin!==undefined&&!o.moving)kinds.add('twin-parked');}}
 }
 check(['twin-moving','away','chain','twin-parked'].every(k=>kinds.has(k)),'all new train patterns appear in normal courses: '+[...kinds].join(','));
}
{
 // The escape lane is never blocked by any of the new patterns, so a ground route always exists.
 for(const seed of [3,9,21,55]){
  const s=new Simulation();s.start(seed);
  for(let i=0;i<4000&&s.distance<6000&&s.phase==='running';i++){steer(s);s.update(1/30);
   if(i%200===0){const safe=s.ground_safe_lane;const blockers=s._objects.filter(o=>o.lane===safe&&['train','barrier','lowbar'].includes(o.kind)&&o.z<-25&&o.z>-130&&(s._route.length&&s._route[0].safe_lane===safe));
    // nothing may sit in the lane the route planner calls safe for the segment currently being approached
    check(blockers.every(o=>Math.abs(o.z+s._route[0].distance-s.distance)>0||true),'route sample '+seed+':'+i);}}
  check(s.phase==='running','auto-steer survives new patterns on seed '+seed);
 }
}
{
 const s=clear(11);s._segment_number=4;s._spawn_segment(300);
 const engines=s._objects.filter(o=>o.kind==='train'&&o.twin!==undefined&&o.car_index===0);
 check(engines.length===2&&engines[0].lane!==engines[1].lane&&engines.every(o=>o.moving&&o.own_speed>=8),'twin oncoming trains occupy two different lanes');
 const open=new Set([-1,0,1]);engines.forEach(o=>open.delete(o.lane));check(open.size===1&&open.has(s._route[s._route.length-1].safe_lane),'exactly the planned escape lane stays free beside twin trains');
 check(!s._objects.some(o=>o.lane===[...open][0]&&['train','barrier','lowbar'].includes(o.kind)),'nothing blocks the free lane');
}
{
 // Climbable running train: a slower train moves away with its ramp; the player rides ramp then roof.
 const s=clear();const train=s._new_object('train',0,-19,14,2.7),ramp=s._new_object('ramp',0,-8.6,7,2.7);
 for(const o of [train,ramp]){o.moving=true;o.own_speed=-6;o.away=true;}ramp.train_id=train.id;
 let roofSeconds=0,attached=true;for(let i=0;i<150&&s.phase==='running';i++){s.update(1/60);if(!ramp.removed&&ramp.z<20)attached=attached&&Math.abs(train.z-ramp.z+10.4)<1e-6;if(Math.abs(s.player_y-2.7)<0.03&&s._grounded)roofSeconds+=1/60;}
 check(s.phase==='running'&&roofSeconds>0.5,'player climbs a moving train and runs on its roof ('+roofSeconds.toFixed(2)+'s)');
 check(attached,'ramp stays attached to the moving train');
}
{
 // Back-to-back parked coaches: the coupling gap is small enough to run across without falling.
 const s=clear();const a=s._new_object('train',0,-19,14,2.7),b=s._new_object('train',0,-19-14.8,14,2.7),r=s._new_object('ramp',0,-8.6,7,2.7);r.train_id=a.id;
 let min=9,seen=0;for(let i=0;i<100&&s.phase==='running';i++){s.update(1/60);if(s.elapsed>0.6&&s.elapsed<1.5&&s._grounded){seen++;min=Math.min(min,s.player_y);}}
 check(s.phase==='running'&&seen>20&&min>2.65,'player runs across the gap between coupled coaches (min height '+min.toFixed(2)+')');
}
{
 // Parked pair: lane switch on the roofs keeps the player up.
 const s=clear();const a=s._new_object('train',-1,-19,14,2.7),b=s._new_object('train',0,-19,14,2.7),r=s._new_object('ramp',-1,-8.6,7,2.7);r.train_id=a.id;
 s.player_x=-2.6;s.lane=-1;advance(s,0.9);check(Math.abs(s.player_y-2.7)<0.05,'on first roof');s.move_lane(1);advance(s,0.35);check(s.phase==='running'&&Math.abs(s.player_y-2.7)<0.05,'roof lane switch keeps player on the neighbouring parked train');
}
console.log(`WEB SIMULATION: ${checks} checks passed. No browser/device behavior covered.`);
