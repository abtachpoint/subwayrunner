extends SceneTree
## Actual-scene integration tests; run with isolated writable XDG data/config/cache.
## No Android ad or purchase is performed: native SDK events are explicitly mocked.
const MainScene = preload("res://main.tscn")
const Profile = preload("res://scripts/player_profile.gd")
var failures := 0
var checks := 0
var _old_save: String = ""
var _had_save := false
var _fake: FakeNative

class FakeNative extends RefCounted:
	signal event_json(json: String)
	var calls: Array[Dictionary] = []
	func configure(raw: String) -> void:
		calls.append({"method": "configure", "config": JSON.parse_string(raw)})
	func set_age_group(group: String) -> void:
		calls.append({"method": "age", "group": group})
	func request_reward(placement: String) -> void:
		calls.append({"method": "reward", "placement": placement})
	func show_interstitial() -> void:
		calls.append({"method": "interstitial"})
	func request_purchase(product_id: String) -> void:
		calls.append({"method": "purchase", "product_id": product_id})
	func restore_purchases() -> void:
		calls.append({"method": "restore"})
	func show_privacy_options() -> void:
		calls.append({"method": "privacy"})
	func emit_event(payload: Dictionary) -> void:
		event_json.emit(JSON.stringify(payload))
	func count(method: String) -> int:
		var result := 0
		for call in calls:
			if call.method == method:
				result += 1
		return result

func _init() -> void:
	call_deferred("run")

func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		push_error("CONTROLLER TEST: " + message)

func run() -> void:
	_had_save = FileAccess.file_exists(Profile.TEST_SAVE_PATH)
	if _had_save:
		_old_save = FileAccess.get_file_as_string(Profile.TEST_SAVE_PATH)
	DirAccess.remove_absolute(Profile.TEST_SAVE_PATH)
	# A remembered adult choice must not initialize advertising before this
	# launch's neutral age choice. The UI is deliberately shown every launch.
	var seed_profile := Profile.new()
	seed_profile.configure_test_mode(true)
	seed_profile.load_profile()
	seed_profile.set_age_group("adult")
	_fake = FakeNative.new()
	Engine.register_singleton("SubwayRunnerServices", _fake)
	var game = MainScene.instantiate()
	root.add_child(game)
	game.set_process(false)
	await process_frame
	check(game.hud.current_screen == "age", "Every launch starts at age selection")
	check(game.services.age_group == "unknown", "Saved adult profile is not sufficient to initialize ads")
	check(_fake.count("configure") == 1, "Native plugin configured once")
	var adult_calls := 0
	for entry in _fake.calls:
		if entry.method == "age" and entry.group == "adult":
			adult_calls += 1
	check(adult_calls == 0, "No native adult call precedes age selection")
	check(game.profile.snapshot().wallet == 99999, "Fresh isolated test wallet has requested seed")
	check(not bool(_fake.calls[0].config.billing_enabled), "Real billing disabled in test build")

	game._on_action("age", {"group": "under13"})
	check(game.hud.current_screen == "menu", "Age choice opens menu")
	check(game.services.age_group == "under13", "Protected age sent to native services")
	var reward_calls := _fake.count("reward")
	game.services.request_reward("revive")
	check(_fake.count("reward") == reward_calls, "Protected player never requests native rewarded ad")
	_fake.emit_event({"type": "reward", "placement": "revive"})
	check(game.simulation.phase == "ready", "Unrequested reward cannot start a run")

	game._on_action("start", {})
	check(game.simulation.phase == "running", "Start begins a run")
	game._process(0.1)
	check(game.simulation.distance > 0.0, "Actual simulation advances")
	game._on_action("pause", {})
	game._process(0.01)
	check(game.simulation.phase == "paused" and game.hud.current_screen == "pause", "Pause opens pause screen")
	var frozen_distance: float = game.simulation.distance
	game.hud.show_settings()
	game._toggle_pause()
	check(game.simulation.phase == "paused" and game.hud.current_screen == "pause", "Pause key closes settings before allowing resume")
	game.hud.show_shop()
	game._notification(Node.NOTIFICATION_WM_GO_BACK_REQUEST)
	check(game.simulation.phase == "paused" and game.hud.current_screen == "pause", "Android Back closes shop without running behind it")
	game.hud.show_parent_gate("purchase", {"product_id": "character_neon"})
	game._toggle_pause()
	check(game.simulation.phase == "paused", "Parent gate cannot resume hidden game")
	game._process(0.2)
	check(is_equal_approx(game.simulation.distance, frozen_distance), "Simulation does not move under modal")
	game._toggle_pause()
	game._process(0.01)
	check(game.simulation.phase == "running" and game.hud.current_screen.is_empty(), "Pause screen resumes cleanly")

	var start_lane: int = game.simulation.lane
	game._begin_pointer(Vector2(200, 400))
	game._drag_pointer(Vector2(120, 400))
	game._end_pointer(Vector2(120, 400))
	check(game.simulation.lane == start_lane - 1, "A completed swipe changes one lane")
	check(not game._pointer_active, "Swipe release cannot be reused as tap")
	game._begin_pointer(Vector2(200, 400))
	game._end_pointer(Vector2(200, 400))
	check(game.simulation.shield == 0.0, "First tap cannot accidentally trigger double-tap shield")
	game._begin_pointer(Vector2(200, 400))
	game._end_pointer(Vector2(200, 400))
	check(game.simulation.shield > 0.0, "Second quick tap activates one shield")

	var wallet: int = game.profile.snapshot().wallet
	var owned: Array = game.profile.snapshot().entitlements
	game._on_action("purchase", {"product_id": "coin_pack_large"})
	check(_fake.count("purchase") == 0, "Test shop never starts a real Billing purchase")
	_fake.emit_event({"type": "purchase", "state": "PENDING", "product_id": "coin_pack_large", "purchase_token": "mock-token"})
	_fake.emit_event({"type": "purchase", "state": "PURCHASED", "product_id": "coin_pack_large", "purchase_token": "mock-token"})
	_fake.emit_event({"type": "error", "operation": "purchase", "code": "USER_CANCELLED"})
	check(game.profile.snapshot().wallet == wallet, "Unverified, pending and failed callbacks grant no coins")
	check(game.profile.snapshot().entitlements == owned, "Unverified callbacks grant no permanent entitlement")
	game._on_action("preview_style", {"id": "neon"})
	check(game._preview_style == "neon", "Explicit test preview can select premium appearance")
	check(not game.profile.snapshot().unlocked_styles.has("neon"), "Preview never unlocks a premium purchase")

	# Finalize this run once when leaving it; duplicate menu intents cannot bank twice.
	game.simulation.coins = 11
	game._on_action("menu", {})
	check(game.profile.snapshot().wallet == wallet + 11, "Leaving run banks its coins")
	game._on_action("menu", {})
	check(game.profile.snapshot().wallet == wallet + 11, "Leaving same run twice cannot bank twice")
	game._on_action("age", {"group": "adult"})
	check(game.services.age_group == "adult" and _fake.calls.back().group == "adult", "Adult ads enabled only after explicit age choice")
	game._on_action("start", {})
	game.simulation.coins = 17
	game.simulation.phase = "crashed"
	game._show_results()
	var before_revive_wallet: int = game.profile.snapshot().wallet
	check(not game._run_banked, "Crash results do not bank before possible revive")
	game._on_action("reward", {"placement": "revive"})
	check(_fake.count("reward") == reward_calls + 1, "Adult crash explicitly requests rewarded revive")
	_fake.emit_event({"type": "ad_opened", "format": "rewarded"})
	_fake.emit_event({"type": "reward", "placement": "revive"})
	check(game.simulation.phase == "crashed", "SDK earning callback does not run behind open fullscreen ad")
	_fake.emit_event({"type": "ad_closed", "format": "rewarded", "earned": true})
	check(game.simulation.phase == "running", "Earned revive resumes only after dismissal")
	check(game.profile.snapshot().wallet == before_revive_wallet, "Revive does not bank coins mid-run")
	game.simulation.coins = 23
	game._on_action("menu", {})
	check(game.profile.snapshot().wallet == before_revive_wallet + 23, "Whole revived run is banked exactly once")
	_fake.emit_event({"type": "reward", "placement": "revive"})
	check(game.simulation.phase == "ready", "Duplicate reward cannot revive a completed run")

	# The SDK may deliver the earning event just after its dismissal callback.
	game._on_action("start", {})
	game.simulation.phase = "crashed"
	game._on_action("reward", {"placement": "revive"})
	_fake.emit_event({"type": "ad_opened", "format": "rewarded"})
	_fake.emit_event({"type": "ad_closed", "format": "rewarded", "earned": true})
	check(game.simulation.phase == "crashed", "Closing without an earned callback grants no revive")
	_fake.emit_event({"type": "reward", "placement": "revive"})
	check(game.simulation.phase == "running", "Late earned callback still authorizes the same crashed run")

	# A requested but unearned reward must not become a reward for a new run.
	game._on_action("retry", {})
	game.simulation.phase = "crashed"
	game._on_action("reward", {"placement": "revive"})
	game._on_action("retry", {})
	_fake.emit_event({"type": "reward", "placement": "revive"})
	_fake.emit_event({"type": "ad_closed", "format": "rewarded", "earned": true})
	check(game.simulation.phase == "running" and game._pending_revive_run_id.is_empty(), "Stale previous-run callback cannot alter the new run")
	game._on_action("age", {"group": "teen"})
	check(game.services._pending_reward.is_empty(), "Age change invalidates pending native rewards")

	game.free()
	# HUD screen changes queue old controls for deletion; flush that queue before
	# quitting so this integration test does not leave orphan test controls.
	await process_frame
	Engine.unregister_singleton("SubwayRunnerServices")
	_fake = null
	if _had_save:
		var file := FileAccess.open(Profile.TEST_SAVE_PATH, FileAccess.WRITE)
		file.store_string(_old_save)
		file.close()
	else:
		DirAccess.remove_absolute(Profile.TEST_SAVE_PATH)
	print("CONTROLLER: %d checks, %d failures. SDK callbacks were mocked; Android SDK/device behavior is not covered." % [checks, failures])
	quit(0 if failures == 0 else 1)
