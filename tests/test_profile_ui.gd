extends SceneTree
## Run with:
## godot --headless --path game --script ../tests/test_profile_ui.gd
## Uses an isolated save filename, never the actual player/test save.
const Profile = preload("res://scripts/player_profile.gd")
const Hud = preload("res://scripts/runner_hud.gd")
const ISOLATED_SAVE := "user://profile_ui_verification.json"
var intents: Array[Dictionary] = []

func _init() -> void:
	call_deferred("run")

func _find_button(node: Node, prefix: String) -> Button:
	if node is Button and node.text.begins_with(prefix):
		return node
	for child in node.get_children():
		var found := _find_button(child, prefix)
		if found != null:
			return found
	return null

func run() -> void:
	var profile := Profile.new()
	profile.configure_test_mode(true)
	assert(profile._save_path == Profile.TEST_SAVE_PATH, "Test mode needs its own save namespace")
	assert(profile._save_path != Profile.SAVE_PATH)
	profile._save_path = ISOLATED_SAVE
	DirAccess.remove_absolute(ISOLATED_SAVE)
	var state := profile.load_profile()
	assert(state.wallet == 99999 and state.test_mode)
	assert(not profile.unlock_style("robot", 1), "Caller cannot lower a character price")
	assert(profile.unlock_style("robot", 3500))
	assert(profile.data.wallet == 96499)
	assert(profile.finish_run({"run_id": "run-one", "coins": 23, "score": 456, "distance": 100.0}).credited)
	assert(not profile.finish_run({"run_id": "run-one", "coins": 23}).credited)
	assert(profile.data.wallet == 96522, "Finishing a run twice must not double-pay")
	var restored := Profile.new()
	restored.configure_test_mode(true)
	restored._save_path = ISOLATED_SAVE
	assert(restored.load_profile().wallet == 96522, "The test seed applies once, not on every launch")
	assert(not restored.select_style("neon"), "Test coins cannot buy a premium entitlement")
	profile.apply_verified_entitlements([{"kind": "coin_delivery", "delivery_id": "delivery-one", "coins": 1000}])
	profile.apply_verified_entitlements([{"kind": "coin_delivery", "delivery_id": "delivery-one", "coins": 1000}])
	assert(profile.data.wallet == 97522, "A verified delivery ID can be credited only once")
	profile.apply_verified_entitlements([{"product_id": "character_neon", "active": true}])
	assert(profile.select_style("neon"))
	profile.apply_verified_entitlements([{"product_id": "character_neon", "active": false}])
	assert(profile.data.selected_style == "courier")
	assert(not profile.select_style("neon"), "Revocation removes premium access")
	var catalog: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://config/catalog.json"))
	for style in catalog.styles:
		if style.id in Profile.STYLE_COSTS:
			assert(int(style.cost) == int(Profile.STYLE_COSTS[style.id]))
	for product in catalog.products:
		if product.id == "coin_pack_large":
			assert(product.coins == 15000 and product.description == "15,000 coins")
	var hud := Hud.new()
	root.add_child(hud)
	hud.action.connect(func(name: String, payload: Dictionary): intents.append({"name": name, "payload": payload.duplicate(true)}))
	hud.configure(profile.snapshot(), catalog)
	hud.show_menu()
	await process_frame
	assert(hud.current_screen == "menu")
	hud.show_shop()
	await process_frame
	assert(hud.current_screen == "shop" and intents.back().name == "pause")
	var preview := _find_button(hud.screen, "PREVIEW")
	assert(preview != null)
	preview.pressed.emit()
	assert(intents.back().name == "preview_style")
	assert(not profile.snapshot().unlocked_styles.has("neon"))
	hud.shop_tab = "packs"
	hud.show_shop()
	await process_frame
	assert(_find_button(hud.screen, "TEST · NOT LIVE") != null)
	hud.show_pause()
	hud.show_settings()
	await process_frame
	assert(hud._settings_return == "pause")
	var high := _find_button(hud.screen, "High")
	assert(high != null)
	high.pressed.emit()
	assert(hud.current_screen == "settings" and hud._settings_return == "pause")
	hud.show_age_gate()
	await process_frame
	assert(_find_button(hud.screen, "Under 13") != null)
	assert(_find_button(hud.screen, "13–17") != null)
	assert(_find_button(hud.screen, "18 or older") != null)
	hud.show_parent_gate("purchase", {"product_id": "character_neon"})
	await process_frame
	var before := intents.size()
	hud._gate_answer.text = "0"
	hud._gate_button.button_down.emit()
	hud._process(2.0)
	assert(intents.size() == before, "A wrong parental answer cannot trigger a purchase intent")
	hud._gate_answer.text = str(hud._gate_expected)
	hud._gate_button.button_down.emit()
	hud._process(0.8)
	assert(intents.size() == before, "A correct answer still requires holding")
	hud._gate_button.button_up.emit()
	hud._gate_button.button_down.emit()
	hud._process(1.6)
	assert(intents.back().name == "purchase" and intents.back().payload.product_id == "character_neon")
	var young_profile := profile.snapshot()
	young_profile.age_group = "under13"
	hud.configure(young_profile, catalog)
	hud.show_results({"score": 456, "coins": 23, "distance": 100.0, "can_revive": true})
	await process_frame
	assert(_find_button(hud.screen, "WATCH VIDEO") == null, "Protected players do not see a rewarded-ad CTA")
	var adult_profile := profile.snapshot()
	adult_profile.age_group = "adult"
	hud.configure(adult_profile, catalog)
	hud.show_results({"score": 456, "coins": 23, "distance": 100.0, "can_revive": true})
	await process_frame
	assert(_find_button(hud.screen, "WATCH VIDEO") != null)
	hud.render({"phase": "running", "score": 456, "coins": 23, "shield": 1.5}, profile.snapshot())
	await process_frame
	assert(hud.current_screen.is_empty())
	hud.render({"phase": "paused"}, profile.snapshot())
	await process_frame
	assert(hud.current_screen == "pause")
	DirAccess.remove_absolute(ISOLATED_SAVE)
	print("PASS: test-save isolation/seed persistence, price guards, run/delivery deduplication, revoked entitlements, parental gate, age-specific rewards, and every HUD screen.")
	quit()
