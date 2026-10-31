extends SceneTree

const Simulation = preload("res://scripts/runner_simulation.gd")
var checks: int = 0
var failures: int = 0


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	_test_seeded_generation()
	_test_time_and_inputs()
	_test_moving_trains()
	_test_hazard_actions()
	_test_rooftops()
	_test_pickups()
	_test_shields_and_revive()
	_test_dynamic_route()
	_test_long_safe_route()
	_test_speed_cap_route()
	print("Simulation: %d checks, %d failures" % [checks, failures])
	quit(1 if failures else 0)


func _check(condition: bool, label: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		printerr("FAIL: " + label)


func _clear_sim(seed_value: int = 7):
	var simulation = Simulation.new()
	simulation.start(seed_value)
	simulation._objects.clear()
	simulation._next_segment = 1.0e12
	return simulation


func _advance(simulation, seconds: float, frame: float = 1.0 / 60.0) -> void:
	var remaining: float = seconds
	while remaining > 0.000001:
		var step: float = minf(frame, remaining)
		simulation.update(step)
		remaining -= step


func _test_seeded_generation() -> void:
	var first = Simulation.new()
	var second = Simulation.new()
	var other = Simulation.new()
	first.start(41)
	second.start(41)
	other.start(42)
	_check(first.snapshot().objects == second.snapshot().objects, "same seed creates identical course")
	_check(first.snapshot().objects != other.snapshot().objects, "different seeds vary course")
	var moving_count: int = 0
	var ramp_count: int = 0
	for object: Dictionary in first.snapshot().objects:
		if object.kind == "train" and object.moving:
			moving_count += 1
		if object.kind == "ramp":
			ramp_count += 1
	_check(moving_count > 0 and ramp_count > 0, "course offers both oncoming trains and rooftop ramps")


func _test_time_and_inputs() -> void:
	var slow = _clear_sim()
	var fast = _clear_sim()
	_advance(slow, 20.0, 1.0 / 30.0)
	_advance(fast, 20.0, 1.0 / 120.0)
	_check(absf(slow.distance - fast.distance) < 0.01, "distance independent of 30 vs120 FPS")
	_check(slow.score == fast.score, "score independent of render frame rate")
	var distance_before: float = slow.distance
	slow.set_paused(true)
	slow.update(0.2)
	_check(slow.distance == distance_before and slow.phase == "paused", "pause freezes simulation")
	slow.set_paused(false)
	slow.move_lane(1)
	slow.move_lane(1)
	_advance(slow, 0.3)
	_check(slow.lane == 1 and is_equal_approx(slow.player_x, 2.6), "lane input clamps and eases to track")
	slow.jump()
	var initial_velocity: float = slow.vertical_velocity
	slow.jump()
	_check(slow.jumps == 1 and slow.vertical_velocity == initial_velocity, "airborne input cannot double jump")
	var before_resume: float = slow.distance
	slow.update(20.0)
	_check(slow.distance - before_resume < 7.0, "resume stall cannot simulate an unfair twenty-second jump")


func _test_moving_trains() -> void:
	var simulation = _clear_sim()
	var moving: Dictionary = simulation._new_object("train", -1, -50.0, 14.0, 2.7)
	moving.moving = true
	moving.own_speed = 12.0
	var stationary: Dictionary = simulation._new_object("train", 1, -50.0, 14.0, 2.7)
	_advance(simulation, 0.2)
	_check(absf(float(moving.z) - float(stationary.z) - 2.4) < 0.001, "oncoming trains approach faster than scenery and stationary trains")
	_check(float(stationary.z) > -50.0, "stationary train still scrolls toward player")
	var crash = _clear_sim()
	var train: Dictionary = crash._new_object("train", 0, -16.0, 14.0, 2.7)
	train.own_speed = 40.0
	train.moving = true
	crash.update(0.25)
	_check(crash.phase == "crashed", "slow frame cannot tunnel through an oncoming locomotive")


func _test_hazard_actions() -> void:
	var standing = _clear_sim()
	standing._new_object("barrier", 0, -5.0, 1.1, 1.05)
	_advance(standing, 0.5)
	_check(standing.phase == "crashed", "standing runner collides with low barrier")
	var jumping = _clear_sim()
	jumping._new_object("barrier", 0, -5.0, 1.1, 1.05)
	jumping.jump()
	_advance(jumping, 0.8)
	_check(jumping.phase == "running", "correctly timed jump clears barrier")
	_check(jumping.player_y >= 0.0, "jump never falls below ground")
	var tall = _clear_sim()
	tall._new_object("lowbar", 0, -5.0, 1.1, 1.9)
	_advance(tall, 0.5)
	_check(tall.phase == "crashed", "overhead obstacle hits standing runner")
	var crouching = _clear_sim()
	crouching._new_object("lowbar", 0, -5.0, 1.1, 1.9)
	crouching.slide()
	_advance(crouching, 0.6)
	_check(crouching.phase == "running", "slide safely passes underneath overhead bar")
	_advance(crouching, 0.3)
	_check(not crouching.snapshot().sliding, "slide ends automatically")
	var changing = _clear_sim()
	changing._new_object("train", 0, -18.0, 14.0, 2.7)
	changing.move_lane(1)
	_advance(changing, 1.0)
	_check(changing.phase == "running", "lane switch avoids approaching train")


func _test_rooftops() -> void:
	var climbing = _clear_sim()
	climbing._new_object("train", 0, -19.0, 14.0, 2.7)
	climbing._new_object("ramp", 0, -8.6, 7.0, 2.7)
	_advance(climbing, 1.2)
	_check(climbing.phase == "running" and absf(climbing.player_y - 2.7) < 0.02, "ramp joins stationary train roof without collision or teleport")
	climbing.jump()
	_advance(climbing, 0.25)
	_check(climbing.player_y > 4.3, "jump begins from roof height")
	_advance(climbing, 2.2)
	_check(climbing.phase == "running" and climbing.player_y == 0.0, "runner falls smoothly to ground when train has passed")
	var landing = _clear_sim()
	landing._new_object("train", 0, 0.0, 14.0, 2.7)
	landing.player_y = 3.2
	landing.vertical_velocity = -1.0
	landing._grounded = false
	_advance(landing, 0.2)
	_check(landing.phase == "running" and is_equal_approx(landing.player_y, 2.7), "falling runner lands on roof rather than colliding with it")


func _test_pickups() -> void:
	var simulation = _clear_sim()
	simulation._new_object("coin", 0, -1.0, 0.45, 0.95)
	_advance(simulation, 0.15)
	_check(simulation.coins == 1, "coin collected once on current lane")
	_advance(simulation, 0.15)
	_check(simulation.coins == 1, "collected coin cannot grant twice")
	simulation.magnet = 1.0
	simulation._new_object("coin", 1, -5.0, 0.45, 0.95)
	simulation.update(0.02)
	_check(simulation.coins == 2, "magnet collects nearby coin across lanes")
	var pickup: Dictionary = simulation._new_object("powerup", 0, -0.8, 0.6, 1.05)
	pickup.tag = "double_score"
	_advance(simulation, 0.1)
	_check(simulation.double_score > 13.8, "double-score pickup applies timed effect")
	var before: int = simulation.score
	_advance(simulation, 15.0)
	_check(simulation.double_score == 0.0 and simulation.score >= before, "score cannot drop when multiplier expires")


func _test_shields_and_revive() -> void:
	var simulation = _clear_sim()
	simulation.use_shield()
	simulation._new_object("barrier", 0, -0.7, 1.1, 1.05)
	_advance(simulation, 0.1)
	_check(simulation.phase == "running" and simulation.shield == 0.0, "shield absorbs one collision")
	simulation.use_shield()
	_check(simulation.shield == 0.0 and simulation.shield_charges == 0, "shield charge cannot be reused")
	_advance(simulation, 2.0)
	simulation._new_object("barrier", 0, -0.7, 1.1, 1.05)
	simulation.update(0.1)
	_check(simulation.phase == "crashed", "new collision after protection expires ends run")
	_check(simulation.revive() and simulation.phase == "running", "verified revive resumes a crashed run")
	_check(simulation.snapshot().objects.is_empty(), "revive clears hazards immediately around player")
	_advance(simulation, 3.1)
	simulation._new_object("barrier", 0, -0.7, 1.1, 1.05)
	simulation.update(0.1)
	_check(simulation.phase == "crashed" and not simulation.revive(), "only one revive can be used per run")


func _test_dynamic_route() -> void:
	var simulation = Simulation.new()
	simulation.start(17)
	var previous_safe: int = 0
	var centre_blocked: bool = false
	for wave: Dictionary in simulation._route:
		_check(absi(int(wave.safe_lane) - previous_safe) <= 1, "safe route changes by at most one lane")
		previous_safe = int(wave.safe_lane)
	for object: Dictionary in simulation._objects:
		if int(object.lane) == 0 and object.kind in ["train", "barrier", "lowbar"]:
			centre_blocked = true
	_check(centre_blocked, "centre lane eventually contains genuine hazards")
	_advance(simulation, 12.0)
	_check(simulation.phase == "crashed", "doing nothing in centre cannot survive indefinitely")


func _earliest_ground_hazard(simulation, candidate_lane: int) -> float:
	# Independent conservative planner reads rendered hazard geometry only.
	# It does not use ground_safe_lane, route metadata, jump, slide or shields.
	var earliest: float = 10000.0
	for object: Dictionary in simulation._objects:
		if int(object.lane) != candidate_lane or object.kind not in ["train", "barrier", "lowbar"]:
			continue
		var velocity: float = simulation.speed + float(object.get("own_speed", 0.0))
		var half_length: float = float(object.length) * 0.5 + 0.4
		var exit_time: float = (-float(object.z) + half_length) / velocity
		if exit_time <= 0.0:
			continue
		var arrival: float = maxf(0.0, (-float(object.z) - half_length) / velocity)
		earliest = minf(earliest, arrival)
	return earliest


func _steer_ground_route(simulation) -> void:
	if absf(simulation.player_x - float(simulation.lane) * 2.6) > 0.1:
		return
	var best_lane: int = simulation.lane
	var current_clearance: float = _earliest_ground_hazard(simulation, simulation.lane)
	if current_clearance > 1.45:
		return
	var best_clearance: float = current_clearance
	for candidate: int in [simulation.lane - 1, simulation.lane + 1]:
		if candidate < -1 or candidate > 1:
			continue
		var clearance: float = _earliest_ground_hazard(simulation, candidate)
		if clearance > best_clearance:
			best_clearance = clearance
			best_lane = candidate
	if best_lane != simulation.lane:
		simulation.move_lane(best_lane - simulation.lane)


func _test_long_safe_route() -> void:
	for seed_value: int in [1, 3, 13, 41, 777, 2601]:
		var simulation = Simulation.new()
		simulation.start(seed_value)
		var frames: int = 0
		var maximum_objects: int = 0
		while simulation.distance < 1800.0 and simulation.phase == "running" and frames < 12000:
			_steer_ground_route(simulation)
			simulation.update(1.0 / 30.0)
			maximum_objects = maxi(maximum_objects, simulation._objects.size())
			frames += 1
		_check(simulation.distance >= 1800.0 and simulation.phase == "running", "seed %d retains reachable ground escape for1800m" % seed_value)
		_check(maximum_objects < 180, "seed %d keeps active objects bounded" % seed_value)
		_check(simulation.coins > 80 and simulation.speed > 23.0, "seed %d progresses rewards and difficulty" % seed_value)
		_check(simulation.dodges > 20, "seed %d requires active lane changes along verified ground route" % seed_value)


func _test_speed_cap_route() -> void:
	var simulation = Simulation.new()
	simulation.start(90909)
	var frames: int = 0
	while simulation.distance < 4000.0 and simulation.phase == "running" and frames < 10000:
		_steer_ground_route(simulation)
		simulation.update(1.0 / 30.0)
		frames += 1
	_check(simulation.distance >= 4000.0 and simulation.phase == "running", "geometry planner survives acceleration through speed cap to4000m")
	_check(simulation.speed == Simulation.MAX_SPEED, "difficulty speed is capped")
	_check(simulation._objects.size() < 180, "late-run moving trains remain bounded and clear")
