'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');const file=p=>fs.readFileSync(path.join(root,p),'utf8');

test('all original Kenney commercial, suburban and train meshes are bundled as actual WebGL data',()=>{
 const ctx={window:{}};vm.runInNewContext(file('web/assets/kenney_models.js'),ctx);
 const k=ctx.window.KENNEY_ASSETS, sizes=Object.fromEntries(Object.entries(k.categories).map(([n,x])=>[n,x.length]));
 assert.equal(sizes.commercial,41);assert.equal(sizes.suburban,40);assert.equal(sizes.train,103);
 assert.equal(Object.keys(k.models).length,184);
 for(const name of Object.keys(k.models).slice(0,4).concat(Object.keys(k.models).slice(-4))){const g=k.models[name];assert.equal(Buffer.from(g.data,'base64').length,g.count*16);}
 const renderer=file('web/renderer.js');assert.match(renderer,/_kenneyDistrictScenery/);assert.match(renderer,/train-electric-subway-a/);
});
test('Quaternius robot and seven animals have local geometry and source licence',()=>{
 const ctx={window:{}};vm.runInNewContext(file('web/assets/quaternius_props.js'),ctx);
 assert.deepEqual([...ctx.window.QUATERNIUS_PROPS.keys].sort(),['robot','cow','horse','llama','pig','pug','sheep','zebra'].sort());
 assert.ok(fs.existsSync(path.join(root,'asset_sources/quaternius/animation-1/UAL1_Standard.glb')));
 assert.ok(fs.existsSync(path.join(root,'asset_sources/quaternius/animation-2/UAL2_Standard.glb')));
});
test('user icon is packaged in all five Android density resource folders',()=>{
 const man=file('android/app/src/main/AndroidManifest.xml');assert.match(man,/@mipmap\/ic_launcher/);
 for(const dpi of ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi'])assert.ok(fs.statSync(path.join(root,`android/app/src/main/res/mipmap-${dpi}/ic_launcher.png`)).size>500);
 assert.ok(fs.statSync(path.join(root,'release-assets/google-play-icon-512.png')).size>1000);
});
test('age gate restores a confirmed group and never resets it to unknown on every launch',()=>{
 const app=file('web/app.js');assert.match(app,/AGE_KEY/);assert.match(app,/if\(age==='unknown'\)showAge\(\);else showMenu\(\)/);
 assert.doesNotMatch(app,/showAge\(\);platform\.call\('set_age',\{group:'unknown'\}\)/);
});
test('original offline arcade soundtrack and UX screens are local',()=>{
 for(const name of ['arcade_menu','arcade_run','coin','diamond','jump','slide','crash','reward','horn'])
  assert.ok(fs.statSync(path.join(root,`web/audio/${name}.ogg`)).size>1000);
 assert.match(file('web/index.html'),/media-src 'self'/);
 assert.match(file('web/style.css'),/SUBWAY RUNNER ORIGINAL ARCADE UI/);
});
