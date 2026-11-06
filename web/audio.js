/* Subway Runner audio engine.
 * 100% procedural Web Audio (no sample files, no network): a driving minor-key
 * run theme, a calmer menu theme, footsteps, jump / slide / dive / landing
 * effects, oncoming-train horns and rail-joint wheel clatter as trains pass.
 * The engine is created with RunnerAudio.create({settings, AudioContextClass}). */
(function (global) {
  'use strict';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  // Run theme: D minor, i - VI - III - VII, then a tenser turnaround.
  const RUN_BARS = [
    {root: 38, chord: [62, 65, 69]}, {root: 34, chord: [58, 62, 65]}, {root: 41, chord: [60, 65, 69]}, {root: 36, chord: [60, 64, 67]},
    {root: 38, chord: [62, 65, 69]}, {root: 34, chord: [58, 62, 65]}, {root: 43, chord: [58, 62, 67]}, {root: 33, chord: [61, 64, 69]}
  ];
  const MENU_BARS = [
    {root: 33, chord: [57, 60, 64]}, {root: 29, chord: [53, 57, 60]}, {root: 36, chord: [55, 60, 64]}, {root: 31, chord: [55, 59, 62]}
  ];
  const BASS_STEPS = [0, 2, 3, 6, 8, 10, 11, 14];
  const ARP_ORDER = [0, 1, 2, 1, 2, 1, 0, 2];

  function create(options) {
    options = options || {};
    const getSettings = options.settings || function () { return {music: true, sfx: true}; };
    const Ctor = options.AudioContextClass || global.AudioContext || global.webkitAudioContext;
    const api = {ctx: null, mode: 'off', events: 0};
    let ctx = null, master = null, musicBus = null, sfxBus = null, noise = null, rumble = null;
    let nextStep = 0, step = 0, bar = 0, theme = '', lastNow = 0, stepTimer = 0, footIndex = 0;
    let coinStreak = 0, lastCoin = -9, nextClack = 0, clackSide = 0;
    const horned = new Set();

    const settings = () => { const s = getSettings() || {}; return {music: s.music !== false, sfx: s.sfx !== false}; };
    const ready = () => !!ctx && ctx.state === 'running';

    function ensure() {
      if (ctx || !Ctor) return;
      ctx = new Ctor(); api.ctx = ctx;
      master = ctx.createGain(); master.gain.value = .85;
      const comp = ctx.createDynamicsCompressor ? ctx.createDynamicsCompressor() : null;
      if (comp) { comp.threshold.value = -14; comp.ratio.value = 4; master.connect(comp); comp.connect(ctx.destination); } else master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
      const length = Math.max(1, Math.floor((ctx.sampleRate || 44100) * 2));
      noise = ctx.createBuffer(1, length, ctx.sampleRate || 44100);
      const data = noise.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data[i] = (seed / 2147483648) - 1; }
    }

    // ---------- tiny synth helpers ----------
    function done(node, ...more) { node.onended = () => { try { node.disconnect(); more.forEach(n => n.disconnect()); } catch (_e) {} }; }
    function panner(pan) {
      if (!ctx.createStereoPanner || !pan) return null;
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); return p;
    }
    function route(node, bus, pan) {
      const p = panner(pan);
      if (p) { node.connect(p); p.connect(bus); return p; }
      node.connect(bus); return null;
    }
    function tone(bus, type, f0, f1, t, dur, peak, opts) {
      opts = opts || {};
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      if (opts.detune) o.detune.value = opts.detune;
      const attack = opts.attack || .006;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + attack);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      let out = g;
      o.connect(g);
      let filter = null;
      if (opts.lowpass) { filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(opts.lowpass, t); if (opts.lowpassTo) filter.frequency.exponentialRampToValueAtTime(opts.lowpassTo, t + dur); g.connect(filter); out = filter; }
      const p = route(out, bus, opts.pan);
      o.start(t); o.stop(t + dur + .02);
      done(o, g, ...(filter ? [filter] : []), ...(p ? [p] : []));
      api.events++;
      return o;
    }
    function burst(bus, type, f0, f1, t, dur, peak, opts) {
      opts = opts || {};
      const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noise; src.loop = true;
      filter.type = type; filter.Q.value = opts.q || .8;
      filter.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const attack = opts.attack || .004;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + attack);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      src.connect(filter); filter.connect(g);
      const p = route(g, bus, opts.pan);
      src.start(t, Math.random() * 1.4); src.stop(t + dur + .02);
      done(src, filter, g, ...(p ? [p] : []));
      api.events++;
      return src;
    }

    // ---------- music ----------
    function kick(t, g) { tone(musicBus, 'sine', 150, 42, t, .2, g); burst(musicBus, 'lowpass', 600, 120, t, .04, g * .35); }
    function snare(t, g) { burst(musicBus, 'bandpass', 1800, 1200, t, .13, g, {q: .7}); tone(musicBus, 'triangle', 220, 140, t, .09, g * .5); }
    function hat(t, g, open) { burst(musicBus, 'highpass', 7000, 7000, t, open ? .16 : .035, g, {q: .5}); }
    function bassNote(t, note, dur, g) { tone(musicBus, 'sawtooth', midi(note), midi(note), t, dur, g, {lowpass: 520, lowpassTo: 260}); tone(musicBus, 'sine', midi(note - 12), midi(note - 12), t, dur, g * .9); }
    function arpNote(t, note, dur, g) { tone(musicBus, 'square', midi(note), midi(note), t, dur, g, {lowpass: 2400, lowpassTo: 900, detune: 4}); }
    function pad(t, chord, dur, g) { chord.forEach((n, i) => { tone(musicBus, 'sawtooth', midi(n - 12), midi(n - 12), t, dur, g, {lowpass: 760, attack: dur * .35, detune: i % 2 ? 7 : -7}); }); }

    function playRunStep(t, s, barInfo, barIndex, intensity) {
      const down = s % 4 === 0;
      if (down || (s === 10 && barIndex % 2 === 1)) kick(t, .5);
      if (s === 4 || s === 12) snare(t, .26 + intensity * .08);
      if (s % 2 === 0 || intensity > .55) hat(t, s % 4 === 2 ? .085 : .045, s === 14 && barIndex % 2 === 1);
      if (BASS_STEPS.includes(s)) bassNote(t, barInfo.root + (s === 6 || s === 14 ? 12 : 0), .2, .2);
      if (s === 0) pad(t, barInfo.chord, 60 / currentBpm * 4, .05);
      if (s % 2 === 0 && (intensity > .12 || barIndex >= 2)) {
        const note = barInfo.chord[ARP_ORDER[(s / 2) % ARP_ORDER.length] % barInfo.chord.length] + (intensity > .5 && s % 8 === 4 ? 24 : 12);
        arpNote(t, note, .13, .06 + intensity * .03);
      }
    }
    function playMenuStep(t, s, barInfo) {
      if (s === 0) { pad(t, barInfo.chord, 60 / currentBpm * 4, .06); bassNote(t, barInfo.root + 12, .5, .1); }
      if (s % 2 === 0) tone(musicBus, 'triangle', midi(barInfo.chord[(s / 2) % 3] + 12), midi(barInfo.chord[(s / 2) % 3] + 12), t, .34, .055, {lowpass: 1800});
      if (s === 8) tone(musicBus, 'sine', midi(barInfo.root + 24), midi(barInfo.root + 24), t, .5, .04);
    }
    let currentBpm = 120;
    function schedule(until, mode, intensity) {
      const bars = mode === 'run' ? RUN_BARS : MENU_BARS;
      currentBpm = mode === 'run' ? 126 + intensity * 24 : 84;
      if (nextStep < ctx.currentTime - .08) nextStep = ctx.currentTime + .03;
      let guard = 0;
      while (nextStep < until && guard++ < 32) {
        const info = bars[bar % bars.length];
        if (mode === 'run') playRunStep(nextStep, step, info, bar, intensity); else playMenuStep(nextStep, step, info);
        nextStep += 60 / currentBpm / 4;
        step++; if (step >= 16) { step = 0; bar++; }
      }
    }
    function setMode(mode) {
      if (mode === api.mode) return;
      api.mode = mode;
      if (!ctx) return;
      const t = ctx.currentTime;
      musicBus.gain.cancelScheduledValues(t);
      const wanted = !settings().music ? 0 : mode === 'run' ? .62 : mode === 'menu' ? .34 : 0;
      musicBus.gain.setTargetAtTime(wanted, t, mode === 'hush' ? .06 : .18);
      if (mode === 'run' || mode === 'menu') { theme = mode; step = 0; bar = 0; nextStep = t + .06; }
    }

    // ---------- one-shot effects ----------
    const FX = {
      coin(t) {
        const now = ctx.currentTime;
        coinStreak = now - lastCoin < .7 ? Math.min(coinStreak + 1, 7) : 0; lastCoin = now;
        const base = 988 * Math.pow(2, coinStreak / 12);
        tone(sfxBus, 'sine', base, base, t, .09, .2); tone(sfxBus, 'sine', base * 1.335, base * 1.335, t + .06, .16, .18);
      },
      jump(t) { tone(sfxBus, 'triangle', 280, 640, t, .15, .17); burst(sfxBus, 'highpass', 1400, 3600, t, .13, .06); },
      slide(t) { burst(sfxBus, 'bandpass', 2600, 700, t, .38, .17, {q: 1.1}); burst(sfxBus, 'lowpass', 400, 200, t, .3, .12); },
      dive(t) { burst(sfxBus, 'highpass', 3600, 500, t, .24, .13); tone(sfxBus, 'sine', 360, 90, t, .22, .18); },
      roll(t) { tone(sfxBus, 'sine', 120, 46, t, .16, .3); burst(sfxBus, 'lowpass', 1100, 400, t, .28, .1); burst(sfxBus, 'bandpass', 2200, 1500, t + .06, .12, .05); },
      land(t) { tone(sfxBus, 'sine', 135, 52, t, .14, .3); burst(sfxBus, 'lowpass', 600, 220, t, .09, .12); },
      crash(t) { burst(sfxBus, 'lowpass', 1500, 110, t, .6, .5); tone(sfxBus, 'sine', 150, 32, t, .5, .45); tone(sfxBus, 'sawtooth', 240, 90, t, .35, .12, {lowpass: 900}); },
      powerup(t) { [0, 4, 7, 12].forEach((n, i) => tone(sfxBus, 'triangle', midi(72 + n), midi(72 + n), t + i * .055, .16, .16)); },
      shield(t) { [660, 990, 1320].forEach((f, i) => tone(sfxBus, 'sine', f, f * 1.02, t + i * .02, .28, .12)); },
      shield_hit(t) { burst(sfxBus, 'bandpass', 1800, 600, t, .22, .3); tone(sfxBus, 'triangle', 880, 330, t, .25, .2); },
      revive(t) { [0, 7, 12, 19].forEach((n, i) => tone(sfxBus, 'triangle', midi(60 + n), midi(60 + n), t + i * .07, .22, .16)); }
    };
    function effect(kind) {
      if (!settings().sfx) return;
      ensure(); if (!ready() || !FX[kind]) return;
      FX[kind](ctx.currentTime + .005);
    }

    // ---------- footsteps ----------
    function footstep(onRoof) {
      const t = ctx.currentTime + .004, side = (footIndex++ % 2) ? .18 : -.18, jitter = .92 + Math.random() * .16;
      if (onRoof) {
        burst(sfxBus, 'bandpass', 1700 * jitter, 1300, t, .05, .075, {q: 2.2, pan: side});
        tone(sfxBus, 'sine', 390 * jitter, 330, t, .07, .05, {pan: side});
      } else {
        burst(sfxBus, 'lowpass', 760 * jitter, 340, t, .06, .12, {pan: side});
        tone(sfxBus, 'sine', 96 * jitter, 62, t, .06, .1, {pan: side});
      }
    }

    // ---------- trains ----------
    function horn(distance, pan, pitch) {
      const t = ctx.currentTime + .01, level = clamp(1.15 - distance / 110, .25, 1);
      [311, 392].forEach(f => {
        const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f * pitch, t); o.frequency.linearRampToValueAtTime(f * pitch * .985, t + .8);
        lp.type = 'lowpass'; lp.frequency.value = 1500;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.11 * level, t + .05); g.gain.setValueAtTime(.11 * level, t + .5); g.gain.exponentialRampToValueAtTime(.0001, t + .85);
        o.connect(lp); lp.connect(g); const p = route(g, sfxBus, pan);
        o.start(t); o.stop(t + .9); done(o, lp, g, ...(p ? [p] : [])); api.events++;
      });
    }
    function clack(closeness, lanesAway, approaching, pan) {
      const t = ctx.currentTime + .004, level = .2 * closeness / (1 + lanesAway * .85);
      const f = approaching ? 2700 : 1500;
      burst(sfxBus, 'bandpass', f, f * .7, t, .035, level, {q: 1.6, pan});
      tone(sfxBus, 'sine', approaching ? 210 : 150, 120, t, .05, level * .55, {pan});
      burst(sfxBus, 'bandpass', f * .92, f * .6, t + .075, .03, level * .75, {q: 1.6, pan});
    }
    function updateRumble(level, pan) {
      if (!rumble) {
        if (level < .02) return;
        const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = noise; src.loop = true; filter.type = 'lowpass'; filter.frequency.value = 170; filter.Q.value = 1.2; g.gain.value = 0;
        src.connect(filter); filter.connect(g); const p = route(g, sfxBus, .0001);
        src.start(0, Math.random()); rumble = {src, g, p}; 
      }
      rumble.g.gain.setTargetAtTime(level * .5, ctx.currentTime, .08);
      if (rumble.p && rumble.p.pan) rumble.p.pan.setTargetAtTime(clamp(pan, -1, 1), ctx.currentTime, .1);
    }
    function trains(state, dt) {
      const objects = state.objects || [], px = Number(state.player_x) || 0, speed = Number(state.speed) || 0;
      let rumbleLevel = 0, rumblePan = 0, clackSource = null, clackCloseness = 0;
      for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (o.kind !== 'train' || o.removed) continue;
        const dx = (o.lane || 0) * 2.6 - px, away = Math.abs(dx) / 2.6, rel = speed + (o.own_speed || 0), half = (o.length || 14) * .5;
        // Rush horn: every oncoming train sounds once while it is still far enough to dodge.
        if (o.moving && (o.own_speed || 0) > 0 && o.z > -105 && o.z < -26 && !horned.has(o.id)) {
          horned.add(o.id); if (horned.size > 80) horned.delete(horned.values().next().value);
          horn(-o.z, clamp(dx / 6, -.9, .9), 1 + ((o.id % 3) - 1) * .04);
        }
        const gap = Math.abs(o.z) - half;
        if (gap < 34) {
          const closeness = clamp(1 - Math.max(0, gap) / 34, 0, 1);
          const rumbleHere = closeness / (1 + away * .9);
          if (rumbleHere > rumbleLevel) { rumbleLevel = rumbleHere; rumblePan = dx / 6; }
          if (gap < 11 && (!clackSource || closeness / (1 + away) > clackCloseness)) { clackSource = {o, away, rel, dx}; clackCloseness = closeness / (1 + away); }
        }
      }
      updateRumble(rumbleLevel, rumblePan);
      if (clackSource) {
        const now = ctx.currentTime;
        if (now >= nextClack) {
          const approaching = clackSource.o.z < 0;
          clack(clamp(clackCloseness * 1.6, .25, 1), clackSource.away, approaching, clamp(clackSource.dx / 6, -.9, .9) * (clackSide++ % 2 ? 1 : .9));
          nextClack = now + clamp(12.5 / Math.max(8, clackSource.rel), .06, .22);
        }
      }
    }

    // ---------- per-frame ----------
    function tick(now, running, state, mode) {
      if (!ctx) return;
      const wanted = mode || (running ? 'run' : 'menu');
      const dt = clamp(now - lastNow, 0, .1); lastNow = now;
      if (!ready()) { return; }
      const cfg = settings();
      if (!cfg.music && api.mode !== 'off' && musicBus.gain.value > .001) musicBus.gain.setTargetAtTime(0, ctx.currentTime, .05);
      setMode(wanted);
      if (cfg.music && (api.mode === 'run' || api.mode === 'menu')) {
        const intensity = state ? clamp(((Number(state.speed) || 21) - 21) / 24, 0, 1) : 0;
        if (musicBus.gain.value < .001 && ctx.currentTime > 0) musicBus.gain.setTargetAtTime(api.mode === 'run' ? .62 : .34, ctx.currentTime, .15);
        schedule(ctx.currentTime + .2, api.mode, intensity);
      }
      if (!cfg.sfx || !running || !state || state.phase !== 'running') { if (rumble) rumble.g.gain.setTargetAtTime(0, ctx.currentTime, .1); stepTimer = 0; return; }
      const speed = Number(state.speed) || 21;
      if (state.grounded !== false && !state.sliding) {
        stepTimer += dt;
        const interval = Math.max(.1, 4.3 / speed);
        if (stepTimer >= interval) { stepTimer -= interval; footstep((Number(state.player_y) || 0) > 2.4); }
      } else stepTimer = 0;
      trains(state, dt);
    }
    function unlock() {
      try { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {}); } catch (_e) {}
    }
    function suspend() { try { if (ctx && ctx.state === 'running') ctx.suspend().catch(function () {}); } catch (_e) {} }
    Object.defineProperty(api, 'currentMode', {get: function () { return api.mode; }});
    return Object.assign(api, {unlock: unlock, suspend: suspend, effect: effect, tick: tick});
  }
  global.RunnerAudio = {create};
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RunnerAudio;
})(typeof window !== 'undefined' ? window : globalThis);
