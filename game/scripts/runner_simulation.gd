class_name RunnerSimulation
extends RefCounted
## Deterministic, rendering-independent runner. The player stays at z = 0 and
## world objects move toward +z. Lanes are -1, 0, 1, spaced 2.6 metres apart.
## Train z is its centre; its roof is 2.7 m. A linked stationary ramp rises from
## its near (+z) edge to its far (-z) edge and meets the train's near end.
## Moving trains have an extra positive `own_speed` in addition to run speed.
## `height` means collision top for hazards, and pickup centre for pickups.
## Every bounded wave has a ground-safe lane. Safe lanes move by at most one
## lane between waves, with at least 34 m clear between hazard footprints.
## Oncoming trains are compensated against analytic arrival time, so their
## independently moving collision windows remain inside their owning wave.

signal event(kind: String, payload: Dictionary)

const LANE_WIDTH: float = 2.6
const BASE_SPEED: float = 13.0
const MAX_SPEED: float = 27.0
const SPEED_PER_METRE: float = 0.006
const GRAVITY: float = 31.0
const JUMP_VELOCITY: float = 11.8
const ROOF_HEIGHT: float = 2.7
const PLAYER_RADIUS: float = 0.30
const FIXED_STEP: float = 1.0 / 120.0
const MAX_FRAME_TIME: float = 0.25

var phase: String = "ready"
var distance: float = 0.0
var speed: float = BASE_SPEED
var score: int = 0
var coins: int = 0
var lane: int = 0
var player_x: float = 0.0
var player_y: float = 0.0
var vertical_velocity: float = 0.0
var shield: float = 0.0
var magnet: float = 0.0
var double_score: float = 0.0
var elapsed: float = 0.0
var shield_charges: int = 1
var ground_safe_lane: int = 0
var jumps: int = 0
var slides: int = 0
var dodges: int = 0

var _objects: Array[Dictionary] = []
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()
var _next_id: int = 1
var _next_segment: float = 38.0
var _segment_number: int = 0
var _slide_time: float = 0.0
var _grounded: bool = true
var _support_id: int = 0
var _score_accumulator: float = 0.0
var _invulnerable: float = 0.0
var _revived: bool = false
var _resume_phase: String = "running"
var _route: Array[Dictionary] = []
var _generated_safe_lane: int = 0
var _route_direction: int = 1


func start(seed_value: int = 1) -> void:
	_rng.seed = seed_value
	phase = "running"
	distance = 0.0
	speed = BASE_SPEED
	score = 0
	coins = 0
	lane = 0
	player_x = 0.0
	player_y = 0.0
	vertical_velocity = 0.0
	shield = 0.0
	magnet = 0.0
	double_score = 0.0
	elapsed = 0.0
	shield_charges = 1
	ground_safe_lane = 0
	jumps = 0
	slides = 0
	dodges = 0
	_objects.clear()
	_next_id = 1
	_next_segment = 44.0
	_segment_number = 0
	_slide_time = 0.0
	_grounded = true
	_support_id = 0
	_score_accumulator = 0.0
	_invulnerable = 0.0
	_revived = false
	_route.clear()
	_generated_safe_lane = 0
	_route_direction = 1 if _rng.randi_range(0, 1) else -1
	_generate_ahead()
	event.emit("start", {"seed": seed_value})


func update(delta: float) -> void:
	if phase != "running" or not is_finite(delta) or delta <= 0.0:
		return
	# A resumed app or one very slow frame must not teleport into an obstacle.
	var remaining: float = minf(delta, MAX_FRAME_TIME)
	while remaining > 0.000001 and phase == "running":
		var step: float = minf(FIXED_STEP, remaining)
		_step(step)
		remaining -= step


func move_lane(direction: int) -> void:
	if phase != "running" or direction == 0:
		return
	var next_lane: int = clampi(lane + signi(direction), -1, 1)
	if next_lane != lane:
		lane = next_lane
		dodges += 1
		event.emit("lane", {"lane": lane})


func jump() -> void:
	if phase != "running" or not _grounded:
		return
	_grounded = false
	_support_id = 0
	_slide_time = 0.0
	vertical_velocity = JUMP_VELOCITY
	jumps += 1
	event.emit("jump", {"count": jumps})


func slide() -> void:
	if phase != "running" or not _grounded:
		return
	_slide_time = 0.78
	slides += 1
	event.emit("slide", {"count": slides})


func use_shield() -> void:
	if phase != "running" or shield_charges <= 0 or shield > 0.0:
		return
	shield_charges -= 1
	shield = 9.0
	event.emit("shield", {"duration": shield, "charges": shield_charges})


func revive() -> bool:
	if phase != "crashed" or _revived:
		return false
	_revived = true
	phase = "running"
	player_y = 0.0
	vertical_velocity = 0.0
	_grounded = true
	_support_id = 0
	_slide_time = 0.0
	_invulnerable = 3.0
	var retained: Array[Dictionary] = []
	for object: Dictionary in _objects:
		if float(object.z) < -40.0 or float(object.z) > float(object.length) * 0.5 + 4.0:
			retained.append(object)
	_objects = retained
	event.emit("revive", {"distance": distance})
	return true


func set_paused(paused: bool) -> void:
	if paused and phase == "running":
		_resume_phase = phase
		phase = "paused"
	elif not paused and phase == "paused":
		phase = _resume_phase


func snapshot() -> Dictionary:
	return {
		"phase": phase, "distance": distance, "speed": speed, "score": score,
		"coins": coins, "lane": lane, "player_x": player_x, "player_y": player_y,
		"vertical_velocity": vertical_velocity, "sliding": _slide_time > 0.0,
		"grounded": _grounded, "shield": shield, "magnet": magnet,
		"double_score": double_score, "invulnerable": _invulnerable,
		"elapsed": elapsed, "shield_charges": shield_charges,
		"can_revive": phase == "crashed" and not _revived,
		"jumps": jumps, "slides": slides, "dodges": dodges,
		"ground_safe_lane": ground_safe_lane,
		# Consumers must treat objects as read-only; avoid deep copies every frame.
		"objects": _objects,
	}


func _step(delta: float) -> void:
	elapsed += delta
	shield = maxf(0.0, shield - delta)
	magnet = maxf(0.0, magnet - delta)
	double_score = maxf(0.0, double_score - delta)
	_invulnerable = maxf(0.0, _invulnerable - delta)
	_slide_time = maxf(0.0, _slide_time - delta)
	speed = minf(MAX_SPEED, BASE_SPEED + distance * SPEED_PER_METRE)
	var travel: float = speed * delta
	distance += travel
	_score_accumulator += travel * (6.0 if double_score > 0.0 else 3.0)
	player_x = move_toward(player_x, float(lane) * LANE_WIDTH, 15.0 * delta)
	for object: Dictionary in _objects:
		object["previous_z"] = float(object.z)
		object["z"] = float(object.z) + travel + float(object.get("own_speed", 0.0)) * delta
	_update_vertical(delta)
	_process_contacts()
	score = int(_score_accumulator)
	var retained: Array[Dictionary] = []
	for object: Dictionary in _objects:
		if not bool(object.get("removed", false)) and float(object.z) < 25.0 + float(object.length) * 0.5:
			retained.append(object)
	_objects = retained
	_generate_ahead()


func _update_vertical(delta: float) -> void:
	var support: Dictionary = _find_support()
	var support_height: float = float(support.height)
	if _grounded and absf(player_y - support_height) < 0.42:
		player_y = support_height
		vertical_velocity = 0.0
		_support_id = int(support.id)
		return
	var previous_y: float = player_y
	vertical_velocity -= GRAVITY * delta
	player_y += vertical_velocity * delta
	_grounded = false
	if vertical_velocity <= 0.0 and previous_y >= support_height - 0.08 and player_y <= support_height:
		player_y = support_height
		vertical_velocity = 0.0
		_grounded = true
		_support_id = int(support.id)
	if player_y <= 0.0:
		player_y = 0.0
		vertical_velocity = 0.0
		_grounded = true
		_support_id = 0


func _find_support() -> Dictionary:
	var highest: float = 0.0
	var support_id: int = 0
	for object: Dictionary in _objects:
		if bool(object.get("removed", false)) or not _shares_lane(object, 0.93):
			continue
		var kind: String = str(object.kind)
		if kind != "ramp" and kind != "train":
			continue
		var half_length: float = float(object.length) * 0.5
		if absf(float(object.z)) > half_length:
			continue
		var top: float = ROOF_HEIGHT
		if kind == "ramp":
			top = clampf((float(object.z) + half_length) / float(object.length), 0.0, 1.0) * ROOF_HEIGHT
		if top > highest and (player_y >= top - 0.42 or _support_id == int(object.id)):
			highest = top
			support_id = int(object.id)
	return {"height": highest, "id": support_id}


func _process_contacts() -> void:
	for object: Dictionary in _objects:
		if bool(object.get("removed", false)):
			continue
		var kind: String = str(object.kind)
		if kind == "coin" or kind == "powerup":
			_collect_pickup(object)
			continue
		if kind == "ramp" or not _shares_lane(object, 1.05):
			continue
		var half_length: float = float(object.length) * 0.5 + PLAYER_RADIUS
		var previous_z: float = float(object.get("previous_z", object.z))
		if previous_z - half_length > 0.0 or float(object.z) + half_length < 0.0:
			continue
		var collision: bool = false
		if kind == "train":
			collision = player_y < ROOF_HEIGHT - 0.24
		elif kind == "barrier":
			collision = player_y < float(object.height) - 0.04
		elif kind == "lowbar":
			var player_top: float = player_y + (0.70 if _slide_time > 0.0 else 1.70)
			collision = player_y < 1.95 and player_top > 1.20
		if collision and _invulnerable <= 0.0:
			_hit(object)
			if phase == "crashed":
				return


func _collect_pickup(object: Dictionary) -> void:
	var kind: String = str(object.kind)
	var height_difference: float = absf(player_y + 0.90 - float(object.height))
	var use_magnet: bool = magnet > 0.0 and kind == "coin"
	var reach: float = 7.0 if use_magnet else 0.65
	var previous_z: float = float(object.get("previous_z", object.z))
	if previous_z > reach or float(object.z) < -reach:
		return
	if not use_magnet and not _shares_lane(object, 0.85):
		return
	if height_difference > (3.2 if use_magnet else 0.95):
		return
	object["removed"] = true
	if kind == "coin":
		coins += 1
		_score_accumulator += 40.0 if double_score > 0.0 else 20.0
		event.emit("coin", {"amount": 1, "total": coins, "id": object.id})
		return
	var tag: String = str(object.get("tag", "magnet"))
	if tag == "magnet":
		magnet = 12.0
	elif tag == "double_score":
		double_score = 14.0
	elif tag == "shield":
		shield_charges = mini(3, shield_charges + 1)
	event.emit("powerup", {"tag": tag, "id": object.id})


func _hit(object: Dictionary) -> void:
	if shield > 0.0:
		shield = 0.0
		_invulnerable = 1.8
		object["removed"] = true
		event.emit("shield_hit", {"kind": object.kind, "id": object.id})
		return
	phase = "crashed"
	_slide_time = 0.0
	event.emit("crash", {
		"kind": object.kind, "id": object.id, "score": int(_score_accumulator),
		"coins": coins, "distance": distance,
	})


func _shares_lane(object: Dictionary, half_width: float) -> bool:
	return absf(player_x - float(object.lane) * LANE_WIDTH) < half_width


func _generate_ahead() -> void:
	while _next_segment < distance + 205.0:
		_spawn_segment(_next_segment)
		_next_segment += _rng.randf_range(56.0, 64.0)
		_segment_number += 1
	while _route.size() > 1 and distance > float(_route[0].distance) + 9.0:
		_route.pop_front()
	if not _route.is_empty():
		ground_safe_lane = int(_route[0].safe_lane)


func _spawn_segment(at_distance: float) -> void:
	var z: float = distance - at_distance
	if absi(_generated_safe_lane + _route_direction) > 1:
		_route_direction *= -1
	_generated_safe_lane += _route_direction
	var safe_lane: int = _generated_safe_lane
	_route.append({"distance": at_distance, "safe_lane": safe_lane})
	var hazard_lanes: Array[int] = []
	for candidate: int in [-1, 0, 1]:
		if candidate != safe_lane:
			hazard_lanes.append(candidate)
	var hazard_lane: int = hazard_lanes[_segment_number % 2]
	var other_lane: int = hazard_lanes[1 - _segment_number % 2]
	var variant: int = _segment_number % 6
	if variant == 0 or variant == 4:
		# Place the train by predicted arrival *time*, rather than current speed.
		# Speed increases over the run; naive distance/speed compensation causes
		# fast future trains to leak into an earlier wave's escape corridor.
		var own_speed: float = _rng.randf_range(9.0, 17.0)
		var travel_time: float = maxf(0.0, _time_at_distance(at_distance) - elapsed)
		var train: Dictionary = _new_object("train", hazard_lane, z - own_speed * travel_time, 14.0, ROOF_HEIGHT)
		train["moving"] = true
		train["own_speed"] = own_speed
		train["color_index"] = _segment_number % 4
		_new_object("barrier" if variant == 0 else "lowbar", other_lane, z, 1.1, 1.05 if variant == 0 else 1.9)
	elif variant == 1 or variant == 5:
		var train: Dictionary = _new_object("train", hazard_lane, z, 14.0, ROOF_HEIGHT)
		train["color_index"] = _segment_number % 4
		var ramp: Dictionary = _new_object("ramp", hazard_lane, z + 10.4, 7.0, ROOF_HEIGHT)
		ramp["train_id"] = train.id
		_spawn_coin_line(hazard_lane, z + 5.0, 6, 2.0, ROOF_HEIGHT + 0.9)
		_new_object("lowbar", other_lane, z - 4.0, 1.1, 1.9)
	elif variant == 2:
		_new_object("barrier", hazard_lane, z, 1.2, 1.05)
		_new_object("lowbar", other_lane, z - 7.0, 1.1, 1.9)
		_spawn_coin_line(hazard_lane, z - 6.0, 5, 2.0, 0.95)
	else:
		_new_object("lowbar", hazard_lane, z, 1.1, 1.9)
		_new_object("barrier", other_lane, z - 6.0, 1.2, 1.05)
		_spawn_coin_line(other_lane, z - 11.0, 5, 2.0, 0.95)
	# All ground hazards lie inside [D - 14, D + 8]. With minimum wave
	# spacing56m, the clear transition is34m (>1.25s at maximum speed),
	# comfortably above a one-lane switch (0.174s) plus reaction time.
	_spawn_coin_line(safe_lane, z - 4.0, 4, 3.0, 0.95)
	if _segment_number % 4 == 2:
		var tags: Array[String] = ["magnet", "double_score", "shield"]
		var pickup: Dictionary = _new_object("powerup", safe_lane, z - 17.0, 0.6, 1.05)
		pickup["tag"] = tags[floori(float(_segment_number) / 4.0) % 3]


func _time_at_distance(at_distance: float) -> float:
	# Exact inverse for d' = min(BASE_SPEED + SPEED_PER_METRE*d, MAX_SPEED).
	# Fixed-step Euler integration differs by <0.01s over the visible horizon;
	# wave gaps deliberately exceed that approximation by over one second.
	var capped_distance: float = (MAX_SPEED - BASE_SPEED) / SPEED_PER_METRE
	if at_distance <= capped_distance:
		return log(1.0 + SPEED_PER_METRE * at_distance / BASE_SPEED) / SPEED_PER_METRE
	var capped_time: float = log(MAX_SPEED / BASE_SPEED) / SPEED_PER_METRE
	return capped_time + (at_distance - capped_distance) / MAX_SPEED


func _spawn_coin_line(coin_lane: int, z: float, count: int, spacing: float, height: float) -> void:
	for i: int in range(count):
		_new_object("coin", coin_lane, z - float(i) * spacing, 0.45, height)


func _new_object(kind: String, object_lane: int, z: float, length: float, height: float) -> Dictionary:
	var object: Dictionary = {
		"id": _next_id, "kind": kind, "lane": object_lane, "z": z,
		"previous_z": z, "length": length, "height": height,
		"moving": false, "own_speed": 0.0,
	}
	_next_id += 1
	_objects.append(object)
	return object
