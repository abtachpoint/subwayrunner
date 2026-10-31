extends Node3D

const Simulation = preload("res://scripts/runner_simulation.gd")
const World = preload("res://scripts/world_view.gd")
const Character = preload("res://scripts/runner_visual.gd")
const HUD = preload("res://scripts/runner_hud.gd")
const Profile = preload("res://scripts/player_profile.gd")
const Services = preload("res://scripts/services.gd")
const Audio = preload("res://scripts/game_audio.gd")

var simulation := Simulation.new()
var profile := Profile.new()
var world := World.new()
var character := Character.new()
var hud := HUD.new()
var services := Services.new()
var audio := Audio.new()
var camera: Camera3D
var config: Dictionary = {}
var catalog: Dictionary = {}
var _run_id := ""
var _run_banked := false
var _run_stats: Dictionary = {}
var _pointer_start := Vector2.ZERO
var _pointer_active := false
var _pointer_time := 0
var _last_tap := -10000
var _result_delay := -1.0
var _preview_style := ""
var _frame_count := 0
var _capture_path := ""
var _capture_frame := 100
var _autoplay := false
var _demo_clock := 0.0
var _profile_cache: Dictionary = {}
var _ad_open := false
var _pending_revive_run_id := ""
var _earned_revive_run_id := ""
var _ad_closed_for_request := false

func _ready() -> void:
	config = _read_json("res://config/runtime.json")
	catalog = _read_json("res://config/catalog.json")
	profile.configure_test_mode(bool(config.get("test_mode", false)))
	_profile_cache = profile.load_profile()
	add_child(world)
	world.setup(str(_profile_cache.settings.quality))
	add_child(character)
	character.setup(str(_profile_cache.selected_style))
	camera = Camera3D.new()
	camera.position = Vector3(0.0, 4.8, 8.2)
	camera.fov = 66.0
	camera.near = 0.1
	camera.far = 195.0
	add_child(camera)
	camera.look_at(Vector3(0, 1.1, -11.0))
	camera.current = true
	add_child(hud)
	hud.configure(_profile_cache, catalog)
	hud.action.connect(_on_action)
	add_child(services)
	services.event.connect(_service_event)
	services.setup(config)
	add_child(audio)
	audio.setup()
	audio.configure(_profile_cache.settings)
	simulation.event.connect(_simulation_event)
	simulation.start(421)
	simulation.phase = "ready"
	# A neutral choice is shown on every fresh launch, before ads initialize.
	services.set_age_group("unknown")
	hud.show_age_gate()
	_parse_capture_args()
	if _autoplay:
		hud.show_menu()
		_start_run()

func _process(delta: float) -> void:
	_frame_count += 1
	if _autoplay and simulation.phase == "running":
		_demo_clock += delta
		if _demo_clock > 4.0:
			_demo_clock = 0.0
			simulation.jump()
	simulation.update(delta)
	var state := simulation.snapshot()
	state.missions = _mission_progress(state)
	world.render(state, delta if simulation.phase != "paused" else 0.0)
	character.animate(state, delta)
	# Camera follows height and lane gently, without disorienting sideways snaps.
	var desired_y := 4.8 + float(state.player_y) * 0.40
	camera.position.y = lerpf(camera.position.y, desired_y, 1.0 - exp(-5.0 * delta))
	camera.position.x = lerpf(camera.position.x, float(state.player_x) * 0.13, 1.0 - exp(-4.0 * delta))
	hud.render(state, _profile_cache)
	audio.set_running(simulation.phase == "running")
	if _result_delay >= 0.0:
		_result_delay -= delta
		if _result_delay < 0.0 and simulation.phase == "crashed":
			_show_results()
	if not _capture_path.is_empty() and _frame_count == _capture_frame:
		_capture.call_deferred()

func _on_action(name: String, payload: Dictionary) -> void:
	match name:
		"start", "retry":
			_bank_run()
			_start_run()
		"menu":
			_bank_run()
			simulation.phase = "ready"
			_result_delay = -1.0
			_preview_style = ""
			character.set_style(str(_profile_cache.selected_style))
			hud.show_menu()
			_maybe_interstitial()
		"pause":
			simulation.set_paused(true)
		"resume":
			simulation.set_paused(false)
		"left": simulation.move_lane(-1)
		"right": simulation.move_lane(1)
		"jump": simulation.jump()
		"slide": simulation.slide()
		"shield": simulation.use_shield()
		"select_style":
			if profile.select_style(str(payload.get("id", ""))):
				_preview_style = ""
				_refresh_profile()
				character.set_style(str(_profile_cache.selected_style))
				hud.show_shop()
		"preview_style":
			if bool(config.get("test_mode", false)) and str(payload.get("id", "")) in ["astronaut", "neon"]:
				_preview_style = str(payload.id)
				character.set_style(_preview_style)
				hud.show_message("TEST preview selected for your next run. No purchase made.")
		"unlock_style":
			if profile.unlock_style(str(payload.get("id", "")), int(payload.get("cost", 0))):
				profile.select_style(str(payload.id))
				_refresh_profile()
				character.set_style(str(_profile_cache.selected_style))
				hud.show_shop()
			else:
				hud.show_message("Collect more coins to unlock this runner.")
		"settings":
			profile.update_settings(payload)
			_refresh_profile()
			world.set_quality(str(_profile_cache.settings.quality))
			audio.configure(_profile_cache.settings)
		"age":
			profile.set_age_group(str(payload.get("group", "unknown")))
			_refresh_profile()
			services.set_age_group(str(_profile_cache.age_group))
			hud.show_menu()
		"purchase": services.purchase(str(payload.get("product_id", "")))
		"restore": services.restore()
		"reward":
			if str(payload.get("placement", "")) == "revive" and simulation.phase == "crashed" and not _run_banked and _profile_cache.age_group == "adult":
				_pending_revive_run_id = _run_id
				_earned_revive_run_id = ""
				_ad_closed_for_request = false
				services.request_reward("revive")
		"privacy": services.privacy()
		"website":
			var url := str(config.get("developer_website_url", ""))
			if url.begins_with("https://"):
				OS.shell_open(url)
			else:
				hud.show_message("Support link will be added for the live release.")

func _start_run() -> void:
	_pending_revive_run_id = ""
	_earned_revive_run_id = ""
	_ad_closed_for_request = false
	_run_id = "%s-%s-%s" % [Time.get_unix_time_from_system(), Time.get_ticks_usec(), randi()]
	_run_banked = false
	_run_stats = {}
	_result_delay = -1.0
	character.set_style(_preview_style if not _preview_style.is_empty() else str(_profile_cache.selected_style))
	simulation.start(randi())

func _simulation_event(kind: String, _payload: Dictionary) -> void:
	audio.effect(kind)
	if kind == "crash":
		_result_delay = 0.32

func _show_results() -> void:
	_run_stats = simulation.snapshot().duplicate(true)
	_run_stats.erase("objects")
	_run_stats.run_id = _run_id
	_run_stats.new_best = simulation.score > int(_profile_cache.high_score)
	_run_stats.missions = _mission_progress(_run_stats)
	_run_stats.mission_bonus = _mission_bonus(_run_stats)
	hud.show_results(_run_stats)

func _bank_run() -> void:
	if _run_id.is_empty() or _run_banked:
		return
	var stats := simulation.snapshot().duplicate()
	stats.run_id = _run_id
	stats.coins = int(stats.coins) + _mission_bonus(stats)
	profile.finish_run(stats)
	_run_banked = true
	_refresh_profile()

func _mission_progress(state: Dictionary) -> Array:
	return [
		{"title": "500m", "value": mini(500, int(state.get("distance", 0))), "target": 500},
		{"title": "25 coins", "value": mini(25, int(state.get("coins", 0))), "target": 25},
		{"title": "5 jumps", "value": mini(5, int(state.get("jumps", 0))), "target": 5}
	]

func _mission_bonus(state: Dictionary) -> int:
	var bonus := 0
	for mission in _mission_progress(state):
		if int(mission.value) >= int(mission.target):
			bonus += 100
	return bonus

func _refresh_profile() -> void:
	_profile_cache = profile.snapshot()
	hud.configure(_profile_cache, catalog)

func _service_event(kind: String, payload: Dictionary) -> void:
	if kind == "ad_opened":
		_ad_open = true
		simulation.set_paused(true)
	elif kind == "ad_closed":
		_ad_open = false
		_ad_closed_for_request = true
		_try_earned_revive()
	elif kind == "reward" and str(payload.get("placement", "")) == "revive":
		if not _pending_revive_run_id.is_empty() and _pending_revive_run_id == _run_id and not _run_banked:
			_earned_revive_run_id = _run_id
			_try_earned_revive()
	elif kind == "products":
		for item in payload.get("products", []):
			if item is Dictionary:
				for product in catalog.get("products", []):
					if str(product.id) == str(item.get("product_id", item.get("id", ""))):
						product.localized_price = str(item.get("price", item.get("formatted_price", "")))
		hud.configure(_profile_cache, catalog)
	elif kind == "message":
		hud.show_message(str(payload.get("message", "")))

func _try_earned_revive() -> void:
	if _ad_open or not _ad_closed_for_request:
		return
	if _earned_revive_run_id.is_empty() or _earned_revive_run_id != _run_id or _pending_revive_run_id != _run_id:
		return
	if not _run_banked and simulation.phase == "crashed" and _profile_cache.age_group == "adult":
		simulation.revive()
	_pending_revive_run_id = ""
	_earned_revive_run_id = ""

func _maybe_interstitial() -> void:
	if not _profile_cache.entitlements.has("remove_forced_ads") and int(_profile_cache.runs) > 0 and int(_profile_cache.runs) % 3 == 0:
		services.interstitial()

func _unhandled_input(input: InputEvent) -> void:
	if input is InputEventKey and input.pressed and not input.echo:
		match input.keycode:
			KEY_LEFT, KEY_A: simulation.move_lane(-1)
			KEY_RIGHT, KEY_D: simulation.move_lane(1)
			KEY_UP, KEY_W, KEY_SPACE: simulation.jump()
			KEY_DOWN, KEY_S: simulation.slide()
			KEY_H: simulation.use_shield()
			KEY_ESCAPE, KEY_P:
				_toggle_pause()
		return
	if simulation.phase != "running":
		return
	if input is InputEventScreenTouch:
		if input.pressed:
			_begin_pointer(input.position)
		else:
			_end_pointer(input.position)
	elif input is InputEventScreenDrag and _pointer_active:
		_drag_pointer(input.position)
	elif input is InputEventMouseButton and input.button_index == MOUSE_BUTTON_LEFT:
		if input.pressed:
			_begin_pointer(input.position)
		else:
			_end_pointer(input.position)
	elif input is InputEventMouseMotion and _pointer_active:
		_drag_pointer(input.position)

func _begin_pointer(at: Vector2) -> void:
	_pointer_start = at
	_pointer_time = Time.get_ticks_msec()
	_pointer_active = true

func _drag_pointer(at: Vector2) -> void:
	var offset := at - _pointer_start
	if offset.length() < 30.0:
		return
	_pointer_active = false
	_last_tap = -10000
	if absf(offset.x) > absf(offset.y):
		simulation.move_lane(1 if offset.x > 0.0 else -1)
	elif offset.y < 0.0:
		simulation.jump()
	else:
		simulation.slide()

func _end_pointer(at: Vector2) -> void:
	if not _pointer_active:
		return
	_drag_pointer(at)
	if _pointer_active:
		var now := Time.get_ticks_msec()
		if now - _pointer_time < 250 and now - _last_tap < 300:
			simulation.use_shield()
			_last_tap = -10000
		else:
			_last_tap = now
	_pointer_active = false

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		_pointer_active = false
		if simulation != null:
			simulation.set_paused(true)
	elif what == NOTIFICATION_WM_GO_BACK_REQUEST:
		if hud.current_screen == "age":
			return
		if hud.current_screen in ["shop", "settings", "parent_gate"]:
			if simulation.phase == "paused":
				hud.show_pause()
			else:
				hud.show_menu()
		elif simulation.phase in ["running", "paused"]:
			_toggle_pause()
		elif hud.current_screen == "results":
			_on_action("menu", {})
		else:
			get_tree().quit()

func _toggle_pause() -> void:
	if simulation.phase == "running":
		simulation.set_paused(true)
	elif simulation.phase == "paused":
		if hud.current_screen in ["pause", ""]:
			simulation.set_paused(false)
		else:
			hud.show_pause()

func _read_json(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Dictionary else {}

func _parse_capture_args() -> void:
	if not OS.has_feature("editor"):
		return
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == "--autoplay":
			_autoplay = true
		if args[i] == "--capture" and i + 1 < args.size():
			_capture_path = args[i + 1]
		if args[i] == "--capture-frame" and i + 1 < args.size():
			_capture_frame = maxi(2, int(args[i + 1]))

func _capture() -> void:
	await RenderingServer.frame_post_draw
	var result := get_viewport().get_texture().get_image().save_png(_capture_path)
	print("CAPTURE_RESULT ", result, " ", _capture_path)
	get_tree().quit(0 if result == OK else 1)
