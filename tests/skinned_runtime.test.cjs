'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function setup(){
  const sandbox={window:{atob:s=>Buffer.from(s,'base64').toString('binary')}};
  sandbox.window.window=sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'web/assets/skinned_characters.js'),'utf8'),sandbox,{timeout:15000});
  vm.runInContext(fs.readFileSync(path.join(root,'web/skinned_player.js'),'utf8'),sandbox,{timeout:15000});
  const gl={ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,STATIC_DRAW:35044,DYNAMIC_DRAW:35048,
    createBuffer:()=>({}),bindBuffer(){},bufferData(){},bufferSubData(){}};
  return {gl,assets:sandbox.window.RUNNER_SKIN_ASSETS,player:new sandbox.window.OfflineSkinPlayer(gl,sandbox.window.RUNNER_SKIN_ASSETS)};
}
test('CC0 real skinned humanoids carry 65-joint skeleton and 12 real animation clips',()=>{
 const {assets,player}=setup();assert.equal(assets.jointCount,65);
 for(const clip of ['idle','run','jump','jump_start','jump_land','slide','slide_start','slide_exit','roll','crouch','jog','crash']){
  assert.ok(player.clips[clip],clip+' missing');assert.ok(player.clips[clip].frames>=2);
  assert.equal(player.clips[clip].data.length,player.clips[clip].frames*65*16);
 }
 for(const style of ['male','female']){
  assert.equal(player.meshes[style].length,3);
  assert.ok(player.meshes[style].reduce((n,m)=>n+m.count,0)>8000);
  assert.ok(player.meshes[style].every(m=>m.indices.length>0&&m.indices.length%3===0));
 }
});
test('real skinned player bends to a low sliding pose and keeps natural upright running proportions',()=>{
 const {player}=setup();let last=[];
 const inspect=(clip)=>{
  player.advance(.03,clip);let ys=[];
  player.draw(player.meshes.male,()=>{},m=>{for(let i=0;i<m.count;i++)ys.push(m.view[i*8+1]/128);});
  assert.ok(ys.length>8000);assert.ok(ys.every(Number.isFinite));
  return {min:Math.min(...ys),max:Math.max(...ys)};
 };
 const run=inspect('run'),slide=inspect('slide'),idle=inspect('idle');
 assert.ok(run.max>1.25,'running player must remain visibly upright');
 assert.ok(slide.max<.98,'sliding player must actually lower the body/head');
 assert.ok(idle.max>1.5,'idle character must be shown at full height');
 assert.ok(slide.max<run.max*.75);
});
test('all added gameplay UI flows are present, with no second synthesized backing tune',()=>{
 const app=fs.readFileSync(path.join(root,'web/app.js'),'utf8');
 const css=fs.readFileSync(path.join(root,'web/style.css'),'utf8');
 for(const fn of ['showPostAgeLoading','showRevivePrompt','showMultiplierReward','showHighScore','showResults','showShop','showSettings'])assert.ok(app.includes('function '+fn),fn);
 for(const selector of ['transition-panel','results-score-grid','revive-panel','reward-content','diamond-grid','settings-region'])assert.ok(css.includes(selector),selector);
 assert.ok(!app.includes('const notes=[261.63'),'old overlapping music still plays');
 assert.ok(app.includes('renderer.rotatePreview'),'3D preview should rotate with touch');
});
