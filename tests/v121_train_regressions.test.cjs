'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Runner = require('../web/simulation.js');
function tick(r,seconds){for(let t=0;t<seconds-1e-8;t+=1/60)r.update(Math.min(1/60,seconds-t));}
function isolated(seed=1){const r=new Runner();r.start(seed);r._objects=[];r._next_segment=1e9;return r;}

test('new course generates frequent moving and stopped trains plus distinct jump/slide obstacles',()=>{
  const r=new Runner();r.start(21);
  const kinds=new Set(r.snapshot().objects.map(o=>o.kind));
  for(const k of ['train','ramp','barrier','lowbar'])assert.ok(kinds.has(k),`${k} is missing`);
  const trains=r._objects.filter(o=>o.kind==='train');
  assert.ok(trains.length>=8,`expected denser 200m train scene, got ${trains.length}`);
  assert.ok(trains.some(o=>o.moving)&&trains.some(o=>!o.moving),'stopped and moving trains');
  assert.ok(r._objects.some(o=>o.kind==='train'&&o.roof_height===Runner.ROOF_HEIGHT));
});

test('no unprompted crash while traveling in reserved ground corridor across first sector',()=>{
  for(const seed of [1,2,3,4,7,21,53,104,777]){
    const r=new Runner();r.start(seed);
    const safe=r._route[0].safe_lane;
    if(safe!==0)r.move_lane(safe);
    tick(r,8);
    assert.equal(r.phase,'running',`reserved lane spontaneous crash with seed ${seed}`);
    assert.equal(r.shield,0,`shield hid a crash with seed ${seed}`);
  }
});

test('moving train can be landed on by a jump and normal ground runner cannot teleport up',()=>{
  const r=isolated(16);
  const moving=r._new_object('train',0,-19,14,2.7);moving.moving=true;moving.own_speed=6;
  r.jump();tick(r,.74);
  assert.equal(r.phase,'running');
  assert.ok(r.player_y>=2.35,`character failed to reach moving roof: ${r.player_y}`);
  tick(r,.08);
  assert.equal(r.phase,'running');
  const ground=isolated(17);ground._new_object('train',0,-12,14,2.7);tick(ground,.4);
  assert.equal(ground.phase,'crashed','walking through train front is not allowed');
});

test('coach roof gap grants brief support continuity, not permanent invulnerability',()=>{
  const r=isolated();r._new_object('train',0,-1.1,14,2.7);
  r.player_y=2.7;r._grounded=true;r._support_id=r._objects[0].id;
  tick(r,.03);
  assert.ok(r._roof_grace>0 && r.player_y>2.4);
  r._objects=[];tick(r,.6);
  assert.ok(r._roof_grace===0 && r.player_y<2.7,'unsupported runner must fall');
});

test('3D train uses enclosed passenger coaches, matching roof visual height, human faces forward in game',()=>{
  const render=fs.readFileSync(path.join(__dirname,'../web/renderer.js'),'utf8');
  assert.ok(render.includes("train-electric-subway-b"));
  assert.ok(!render.includes("o.car_role==='coach'?'train-carriage-box'"),'open-top cargo carriages were old roof mismatch');
  assert.ok(render.includes('const scaleY=(o.roof_height||2.7)/(heights[name]||1.7)'));
  assert.ok(render.includes('const scaleZ=(o.length||14)/(2*(halfLengths[name]||1.30))'));
  assert.ok(render.includes('Math.sin(this.clock*.5)*.12:PI'),'gameplay player should face running direction');
});
