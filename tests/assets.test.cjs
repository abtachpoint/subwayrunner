'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
let checks = 0;
function check(value, label) { checks++; assert.ok(value, label); }

function load(...files) {
  const context = {window: {}};
  context.window.window = context.window;
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, 'web/assets', file), 'utf8'), context);
  return context.window.RUNNER_MODELS;
}
const original = load('models.js');
const originalFox = load('models.js', 'fox.js').characters.fox;
const models = load('models.js', 'fox.js', 'humans.js', 'city_extra.js');

function decode(mesh) {
  const buffer = Buffer.from(mesh.data, 'base64');
  check(buffer.length === mesh.count * 16, 'packed mesh length matches its vertex count');
  return buffer;
}
function bounds(mesh) {
  const b = decode(mesh), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < mesh.count; i++) for (let k = 0; k < 3; k++) { const v = b.readInt16LE(i * 16 + k * 2) / 128; lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }
  return {lo, hi};
}

// ---- human runners ----
for (const id of ['courier', 'skater', 'sprinter', 'robot', 'astronaut', 'neon']) {
  const bones = models.characters[id].bones, old = original.characters[id].bones;
  check(bones.length === 13, id + ' keeps the 13-bone rig');
  let vertices = 0;
  bones.forEach((bone, i) => {
    check(bone.parent === old[i].parent && bone.name === old[i].name, id + ' bone ' + i + ' hierarchy matches the original rig');
    check(JSON.stringify(bone.p) === JSON.stringify(old[i].p), id + ' bone ' + i + ' pivot matches the original rig');
    decode(bone.mesh); vertices += bone.mesh.count;
  });
  check(vertices > 20000 && vertices < 45000, id + ' stays within the mobile vertex budget (' + vertices + ')');
  const head = bounds(bones[2].mesh), torso = bounds(bones[1].mesh), shoe = bounds(bones[7].mesh);
  check(head.hi[1] - head.lo[1] > 0.55 && head.hi[1] < 0.8 && head.lo[1] > -0.5, id + ' has a head of cartoon proportions');
  check(torso.lo[1] > -0.5 && torso.hi[1] < 0.6, id + ' torso stays on its pivot');
  check(shoe.lo[1] > -0.22 && shoe.hi[1] < 0.2, id + ' shoes sit on the ground pivot');
}
check(JSON.stringify(models.characters.courier.bones[1].mesh) !== JSON.stringify(original.characters.courier.bones[1].mesh), 'runners are the new models, not the originals');

// ---- Fenn the fox is turned to face his running direction ----
{
  const turned = models.characters.fox.bones;
  check(turned.length === 13, 'fox keeps its rig');
  turned.forEach((bone, i) => {
    const before = originalFox.bones[i];
    check(bone.p[0] === -before.p[0] && bone.p[1] === before.p[1] && bone.p[2] === -before.p[2], 'fox pivot ' + i + ' is rotated 180 degrees about Y');
    check(bone.mesh.count === before.mesh.count, 'fox mesh ' + i + ' keeps every vertex');
  });
  const a = decode(turned[1].mesh), b = decode(originalFox.bones[1].mesh);
  check(a.readInt16LE(0) === -b.readInt16LE(0) && a.readInt16LE(4) === -b.readInt16LE(4) && a.readInt16LE(2) === b.readInt16LE(2), 'fox vertices are mirrored through the vertical axis');
}

// ---- districts and bridge ----
{
  const sets = models.districtChunks;
  check(sets && sets.suburb.length === 4 && sets.downtown.length === 4, 'two neighbourhood sets of four street slices');
  for (const [name, list] of Object.entries(sets)) {
    for (const mesh of list) {
      decode(mesh);
      const {lo, hi} = bounds(mesh);
      check(mesh.count % 3 === 0 && mesh.count < 26000, name + ' slice within vertex budget (' + mesh.count + ')');
      check(lo[2] > -24.5 && hi[2] < 0.5, name + ' slice stays inside its 24 m window');
      check(lo[0] > -32 && hi[0] < 32 && lo[1] > -0.3 && hi[1] < 40, name + ' slice dimensions are sane');
    }
  }
  const bridge = bounds(models.bridge);
  decode(models.bridge);
  check(bridge.lo[1] >= -0.1 && bridge.hi[1] > 9 && bridge.lo[0] < -6 && bridge.hi[0] > 6, 'bridge spans the whole street');
  // deck underside must clear the roof of a train (2.7 m) plus a jump with room to spare
  const b = decode(models.bridge); let underside = 1e9;
  for (let i = 0; i < models.bridge.count; i++) { const x = b.readInt16LE(i * 16) / 128, y = b.readInt16LE(i * 16 + 2) / 128; if (Math.abs(x) < 4 && y > 3) underside = Math.min(underside, y); }
  check(underside > 6.5, 'bridge clearance above the track is ' + underside.toFixed(2) + ' m');
}

// ---- page wiring ----
{
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  const order = ['assets/models.js', 'assets/fox.js', 'assets/humans.js', 'assets/city_extra.js', 'audio.js', 'simulation.js', 'renderer.js', 'app.js'].map(f => html.indexOf('src="' + f + '"'));
  check(order.every(i => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'scripts load in dependency order');
  check(html.includes('href="ui3d.css"') && html.indexOf('href="style.css"') < html.indexOf('href="ui3d.css"'), '3D UI layer loads after the base stylesheet');
  const css = fs.readFileSync(path.join(root, 'web/ui3d.css'), 'utf8');
  check(!/https?:\/\//.test(css.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'UI layer makes no network references (only inline SVG namespaces)');
  check(/img-src 'self' data:/.test(html), 'CSP allows the inline SVG icons used by the UI layer');
  check(/\.btn\.play3d/.test(css) && /\.spin-wheel/.test(css) && /\.t3::before/.test(css), 'UI layer styles the PLAY text, daily-spin wheel and extruded titles');
}
console.log(`ASSETS: ${checks} checks passed. Geometry/packing/wiring only; looks and device frame rate need a phone.`);
