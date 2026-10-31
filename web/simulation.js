/* Subway Runner's deterministic runner simulation. No DOM or rendering work.
 * The player stays at z=0; scenery moves toward +z. All lengths are metres.
 * Ported from the native Godot simulation; every wave has a shifting safe lane.
 */
(function (scope) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const approach = (x, y, d) => Math.abs(y - x) <= d ? y : x + Math.sign(y - x) * d;
  class RunnerSimulation {
    constructor() {
      this.onEvent = function () {};
      this.start(1);
      this.phase = 'ready';
    }
    _emit(kind, payload) { if (typeof this.onEvent === 'function') this.onEvent(kind, payload); }
    _random() {
      this._seed = (this._seed + 0x6D2B79F5) >>> 0;
      let v = this._seed;
      v = Math.imul(v ^ v >>> 15, v | 1);
      v ^= v + Math.imul(v ^ v >>> 7, v | 61);
      return ((v ^ v >>> 14) >>> 0) / 4294967296;
    }
    start(seed = 1, runnerStyle = 'courier') {
      this._seed = Number(seed) >>> 0;
      this.runner_style = ['courier','skater','sprinter','robot','astronaut','neon','fox'].includes(runnerStyle) ? runnerStyle : 'courier';
      this.phase = 'running'; this.distance = 0; this.speed = 21; this.score = 0;
      this.coins = 0; this.lane = 0; this.player_x = 0; this.player_y = 0;
      this.vertical_velocity = 0; this.shield = 0; this.magnet = 0; this.double_score = 0;
      this.elapsed = 0; this.shield_charges = this.runner_style === 'robot' ? 2 : 1; this.ground_safe_lane = 0;
      if (this.runner_style === 'neon' || this.runner_style === 'fox') this.magnet = this.runner_style === 'fox' ? 4 : 3;
      this.jumps = 0; this.slides = 0; this.dodges = 0;
      this._objects = []; this._next_id = 1; this._next_segment = 44;
      this._segment_number = 0; this._slide_time = 0; this._grounded = true;
      this._queued_slide = false; this._landing_time = 0;
      this._support_id = 0; this._score_accumulator = 0; this._invulnerable = 0;
      this._revived = false; this._resume_phase = 'running'; this._route = [];
      this._generated_safe_lane = 0; this._route_direction = this._random() >= 0.5 ? 1 : -1;
      this._generate_ahead(); this._emit('start', {seed});
    }
    update(delta) {
      if (this.phase !== 'running' || !Number.isFinite(delta) || delta <= 0) return;
      let remaining = Math.min(delta, 0.25);
      while (remaining > 0.000001 && this.phase === 'running') {
        const step = Math.min(1 / 120, remaining);
        this._step(step); remaining -= step;
      }
    }
    move_lane(direction) {
      if (this.phase !== 'running' || !direction) return;
      const next = clamp(this.lane + Math.sign(direction), -1, 1);
      if (next !== this.lane) { this.lane = next; this.dodges++; this._emit('lane', {lane:next}); }
    }
    jump() {
      if (this.phase !== 'running' || !this._grounded) return;
      this._grounded = false; this._support_id = 0; this._slide_time = 0;
      this.vertical_velocity = this.runner_style === 'sprinter' ? 13.1 : 11.8; this.jumps++; this._emit('jump', {count:this.jumps});
    }
    slide() {
      if (this.phase !== 'running') return;
      if (!this._grounded) { // Fast-fall into a buffered roll; works on train roofs too.
        if (!this._queued_slide) { this._queued_slide = true; this.slides++; this._emit('dive', {count:this.slides}); }
        this.vertical_velocity = Math.min(this.vertical_velocity, -8);
        return;
      }
      this._slide_time = this.runner_style === 'skater' ? 1.12 : 0.78; this.slides++; this._emit('slide', {count:this.slides});
    }
    use_shield() {
      if (this.phase !== 'running' || this.shield_charges <= 0 || this.shield > 0) return;
      this.shield_charges--; this.shield = 9;
      this._emit('shield', {duration:this.shield, charges:this.shield_charges});
    }
    revive() {
      if (this.phase !== 'crashed' || this._revived) return false;
      this._revived = true; this.phase = 'running'; this.player_y = 0;
      this.vertical_velocity = 0; this._grounded = true; this._support_id = 0;
      this._slide_time = 0; this._queued_slide = false; this._landing_time = 0; this._invulnerable = 3;
      this._objects = this._objects.filter(o => o.z < -40 || o.z > o.length * 0.5 + 4);
      this._emit('revive', {distance:this.distance}); return true;
    }
    set_paused(paused) {
      if (paused && this.phase === 'running') { this._resume_phase = this.phase; this.phase = 'paused'; }
      else if (!paused && this.phase === 'paused') this.phase = this._resume_phase;
    }
    snapshot() {
      return {phase:this.phase, distance:this.distance, speed:this.speed, score:this.score,
        coins:this.coins, lane:this.lane, player_x:this.player_x, player_y:this.player_y,
        vertical_velocity:this.vertical_velocity, sliding:this._slide_time > 0,
        diving:this._queued_slide, landing:this._landing_time,
        grounded:this._grounded, shield:this.shield, magnet:this.magnet,
        double_score:this.double_score, invulnerable:this._invulnerable, elapsed:this.elapsed,
        shield_charges:this.shield_charges, can_revive:this.phase === 'crashed' && !this._revived,
        jumps:this.jumps, slides:this.slides, dodges:this.dodges,
        ground_safe_lane:this.ground_safe_lane, objects:this._objects};
    }
    _step(dt) {
      this.elapsed += dt;
      for (const key of ['shield','magnet','double_score','_invulnerable','_slide_time','_landing_time'])
        this[key] = Math.max(0, this[key] - dt);
      // Immediate mid-run pace, then continuous distance-based growth without an arbitrary cap.
      // Course spacing and lane-change responsiveness adapt to the same pace.
      this.speed = 21 + this.distance * 0.003;
      const travel = this.speed * dt;
      this.distance += travel;
      this._score_accumulator += travel * (this.double_score > 0 ? 6 : 3);
      this.player_x = approach(this.player_x, this.lane * 2.6, (17 + this.speed * 0.30 + (this.runner_style==='courier'?2:0)) * dt);
      for (const o of this._objects) { o.previous_z = o.z; o.z += travel + (o.own_speed || 0) * dt; }
      this._update_vertical(dt); this._process_contacts();
      this.score = Math.floor(this._score_accumulator);
      this._objects = this._objects.filter(o => !o.removed && o.z < 25 + o.length * 0.5);
      this._generate_ahead();
    }
    _update_vertical(dt) {
      const support = this._find_support(), height = support.height;
      if (this._grounded && Math.abs(this.player_y - height) < 0.42) {
        this.player_y = height; this.vertical_velocity = 0; this._support_id = support.id; return;
      }
      const previous = this.player_y;
      this.vertical_velocity -= 31 * dt; this.player_y += this.vertical_velocity * dt;
      this._grounded = false;
      if (this.vertical_velocity <= 0 && previous >= height - 0.08 && this.player_y <= height) {
        this.player_y = height; this.vertical_velocity = 0; this._grounded = true; this._support_id = support.id;
        this._land();
      }
      if (this.player_y <= 0) {
        const wasAirborne = !this._grounded;
        this.player_y = 0; this.vertical_velocity = 0; this._grounded = true; this._support_id = 0;
        if (wasAirborne) this._land();
      }
    }
    _land() {
      this._landing_time = 0.30;
      if (this.runner_style === 'astronaut') this._invulnerable = Math.max(this._invulnerable,0.20);
      if (this._queued_slide) { this._slide_time = this.runner_style === 'skater' ? 1.12 : 0.78; this._queued_slide = false; this._emit('roll', {count:this.slides}); }
      else this._emit('land', {});
    }
    _find_support() {
      let height = 0, id = 0;
      for (const o of this._objects) {
        if (o.removed || !this._shares_lane(o, 0.93) || !['ramp','train'].includes(o.kind) || Math.abs(o.z) > o.length * 0.5) continue;
        const top = o.kind === 'ramp' ? clamp((o.z + o.length * 0.5) / o.length, 0, 1) * 2.7 : 2.7;
        if (top > height && (this.player_y >= top - 0.42 || this._support_id === o.id)) { height = top; id = o.id; }
      }
      return {height, id};
    }
    _process_contacts() {
      for (const o of this._objects) {
        if (o.removed) continue;
        if (o.kind === 'coin' || o.kind === 'powerup') { this._collect_pickup(o); continue; }
        if (o.kind === 'ramp' || !this._shares_lane(o, 1.05)) continue;
        const half = o.length * 0.5 + 0.30;
        if ((o.previous_z ?? o.z) - half > 0 || o.z + half < 0) continue;
        let hit = false;
        if (o.kind === 'train') hit = this.player_y < 2.7 - 0.24;
        else if (o.kind === 'barrier') hit = this.player_y < o.height - 0.04;
        else if (o.kind === 'lowbar') hit = this.player_y < 1.95 && this.player_y + (this._slide_time > 0 ? 0.70 : 1.70) > 1.20;
        if (hit && this._invulnerable <= 0) { this._hit(o); if (this.phase === 'crashed') return; }
      }
    }
    _collect_pickup(o) {
      const difference = Math.abs(this.player_y + 0.90 - o.height);
      const magnet = this.magnet > 0 && o.kind === 'coin', reach = magnet ? 7 : 0.65;
      if ((o.previous_z ?? o.z) > reach || o.z < -reach || (!magnet && !this._shares_lane(o, 0.85)) || difference > (magnet ? 3.2 : 0.95)) return;
      o.removed = true;
      if (o.kind === 'coin') {
        this.coins++; this._score_accumulator += this.double_score > 0 ? 40 : 20;
        this._emit('coin', {amount:1, total:this.coins, id:o.id}); return;
      }
      const tag = o.tag || 'magnet';
      if (tag === 'magnet') this.magnet = 12;
      else if (tag === 'double_score') this.double_score = 14;
      else if (tag === 'shield') this.shield_charges = Math.min(3, this.shield_charges + 1);
      this._emit('powerup', {tag, id:o.id});
    }
    _hit(o) {
      if (this.shield > 0) {
        this.shield = 0; this._invulnerable = 1.8; o.removed = true;
        this._emit('shield_hit', {kind:o.kind,id:o.id}); return;
      }
      this.phase = 'crashed'; this._slide_time = 0;
      this._emit('crash', {kind:o.kind,id:o.id,score:Math.floor(this._score_accumulator),coins:this.coins,distance:this.distance});
    }
    _shares_lane(o, width) { return Math.abs(this.player_x - o.lane * 2.6) < width; }
    _generate_ahead() {
      while (this._next_segment < this.distance + 205) {
        this._spawn_segment(this._next_segment); this._next_segment += 80 + this._random() * 8; this._segment_number++;
      }
      while (this._route.length > 1 && this.distance > this._route[0].distance + 9) this._route.shift();
      if (this._route.length) this.ground_safe_lane = this._route[0].safe_lane;
    }
    _spawn_segment(at) {
      const z = this.distance - at;
      if (Math.abs(this._generated_safe_lane + this._route_direction) > 1) this._route_direction *= -1;
      this._generated_safe_lane += this._route_direction;
      const safe = this._generated_safe_lane;
      this._route.push({distance:at, safe_lane:safe});
      const lanes = [-1, 0, 1].filter(l => l !== safe), n = this._segment_number;
      const hazard = lanes[n % 2], other = lanes[1 - n % 2], variant = n % 6;
      if (variant === 0 || variant === 4) {
        const own = 9 + this._random() * 8;
        const train = this._new_object('train', hazard, z - own * Math.max(0, this._time_at_distance(at) - this.elapsed), 14, 2.7);
        train.moving = true; train.own_speed = own; train.color_index = n % 3;
        // A moving three-car metro convoy (lead car + two followers) shares
        // one track and keeps the planned escape lane entirely clear.
        const carCount = n % 3 === 0 ? 3 : 2;
        train.car_index = 0; train.car_role = 'engine'; train.convoy = n;
        for (let car = 1; car < carCount; car++) {
          const follower = this._new_object('train', hazard, train.z - car * 17.5, 14, 2.7);
          follower.moving = true; follower.own_speed = own; follower.color_index = n % 3;
          follower.car_index = car; follower.car_role = 'coach'; follower.convoy = n;
        }
        this._new_object(variant === 0 ? 'barrier' : 'lowbar', other, z, 1.1, variant === 0 ? 1.05 : 1.9);
      } else if (variant === 1 || variant === 5) {
        const train = this._new_object('train', hazard, z, 14, 2.7); train.color_index = n % 4;
        const ramp = this._new_object('ramp', hazard, z + 10.4, 7, 2.7); ramp.train_id = train.id;
        // A second, staggered roof provides a jump/lane-transfer opportunity.
        // The empty route lane remains available for ground-only play.
        if (n % 2) {
          const transfer = this._new_object('train', other, z - 16.5, 14, 2.7);
          transfer.color_index = (n + 1) % 3; transfer.car_role = 'coach';
        }
        this._spawn_coin_line(hazard, z + 5, 6, 2, 3.6);
        this._new_object('lowbar', other, z - 4, 1.1, 1.9);
      } else if (variant === 2) {
        this._new_object('barrier', hazard, z, 1.2, 1.05);
        this._new_object('lowbar', other, z - 7, 1.1, 1.9);
        this._spawn_coin_line(hazard, z - 6, 5, 2, 0.95);
      } else {
        this._new_object('lowbar', hazard, z, 1.1, 1.9);
        this._new_object('barrier', other, z - 6, 1.2, 1.05);
        this._spawn_coin_line(other, z - 11, 5, 2, 0.95);
      }
      this._spawn_coin_line(safe, z - 4, 4, 3, 0.95);
      if (n % 4 === 2) {
        const p = this._new_object('powerup', safe, z - 17, 0.6, 1.05);
        p.tag = ['magnet','double_score','shield'][Math.floor(n / 4) % 3];
      }
    }
    _time_at_distance(distance) {
      return Math.log1p(0.003 * Math.max(0, distance) / 21) / 0.003;
    }
    _spawn_coin_line(lane, z, count, spacing, height) {
      for (let i = 0; i < count; i++) this._new_object('coin', lane, z - i * spacing, 0.45, height);
    }
    _new_object(kind, lane, z, length, height) {
      const o = {id:this._next_id++,kind,lane,z,previous_z:z,length,height,moving:false,own_speed:0};
      this._objects.push(o); return o;
    }
  }
  RunnerSimulation.MAX_SPEED = Infinity; RunnerSimulation.START_SPEED = 21; RunnerSimulation.ROOF_HEIGHT = 2.7; RunnerSimulation.LANE_WIDTH = 2.6;
  scope.RunnerSimulation = RunnerSimulation;
  if (typeof module !== 'undefined' && module.exports) module.exports = RunnerSimulation;
})(typeof globalThis !== 'undefined' ? globalThis : window);
