extends RefCounted
class_name PlayerProfile

## Offline progress is separate from purchase authority. Only the verified native
## purchase service may call apply_verified_entitlements(). A price button never
## unlocks a paid item. Consumable delivery must use a stable server delivery_id.
const SAVE_PATH := "user://subway_runner_profile.json"
const TEST_SAVE_PATH := "user://subway_runner_test_profile.json"
const STYLE_COSTS := {"sprinter": 1200, "robot": 3500}
const PREMIUM_STYLES := {
	"character_astronaut": "astronaut",
	"character_neon": "neon",
	"starter_pack": "astronaut"
}
const ALL_STYLES := ["courier", "skater", "sprinter", "robot", "astronaut", "neon"]

var data: Dictionary = _defaults()
var _test_mode := false
var _save_path := SAVE_PATH

func configure_test_mode(enabled: bool) -> void:
	_test_mode = enabled
	_save_path = TEST_SAVE_PATH if enabled else SAVE_PATH

func _fresh_profile() -> Dictionary:
	var fresh := _defaults()
	fresh["test_mode"] = _test_mode
	if _test_mode:
		fresh.wallet = 99999
	return fresh

static func _defaults() -> Dictionary:
	return {
		"schema": 1, "wallet": 0, "high_score": 0, "best_distance": 0.0,
		"total_distance": 0.0, "runs": 0, "unlocked_styles": ["courier", "skater"],
		"selected_style": "courier", "age_group": "unknown", "entitlements": [],
		"processed_runs": [], "processed_deliveries": [],
		"settings": {"quality": "medium", "music": true, "sfx": true, "tap_controls": false}
	}

func load_profile() -> Dictionary:
	data = _fresh_profile()
	if not FileAccess.file_exists(_save_path):
		save_profile()
		return snapshot()
	var file := FileAccess.open(_save_path, FileAccess.READ)
	if file == null:
		return snapshot()
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		return snapshot()
	var saved: Dictionary = parsed
	for key in ["wallet", "high_score", "runs"]:
		if saved.get(key) is int or saved.get(key) is float:
			data[key] = clampi(int(saved[key]), 0, 2000000000)
	for key in ["total_distance", "best_distance"]:
		if saved.get(key) is int or saved.get(key) is float:
			var value := float(saved[key])
			data[key] = maxf(0.0, value) if is_finite(value) else 0.0
	for key in ["processed_runs", "processed_deliveries"]:
		if saved.get(key) is Array:
			var identifiers: Array = []
			for identifier in saved[key]:
				if identifier is String and identifier.length() < 256 and not identifiers.has(identifier):
					identifiers.append(identifier)
			data[key] = identifiers
	# Saved premium flags are not a purchase authority: the service revalidates them.
	# Cached access is usable offline; paid token validation/refunds are server-owned.
	if saved.get("entitlements") is Array:
		for product_id in saved.entitlements:
			if product_id in PREMIUM_STYLES or product_id == "remove_forced_ads":
				data.entitlements.append(product_id)
	if saved.get("unlocked_styles") is Array:
		for style in saved.unlocked_styles:
			if style in ALL_STYLES and not data.unlocked_styles.has(style):
				if style in ["sprinter", "robot"] or _style_is_entitled(style):
					data.unlocked_styles.append(style)
	var selection: String = str(saved.get("selected_style", "courier"))
	data.selected_style = selection if data.unlocked_styles.has(selection) else "courier"
	var age: String = str(saved.get("age_group", "unknown"))
	data.age_group = age if age in ["under13", "teen", "adult"] else "unknown"
	if saved.get("settings") is Dictionary:
		_sanitize_settings(saved.settings)
	return snapshot()

func save_profile() -> bool:
	var temporary := _save_path + ".tmp"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(data))
	file.flush()
	file.close()
	return DirAccess.rename_absolute(temporary, _save_path) == OK

func snapshot() -> Dictionary:
	return data.duplicate(true)

func select_style(id: String) -> bool:
	if not data.unlocked_styles.has(id):
		return false
	data.selected_style = id
	save_profile()
	return true

func unlock_style(id: String, cost: int) -> bool:
	if not STYLE_COSTS.has(id) or int(STYLE_COSTS[id]) != cost:
		return false
	if data.unlocked_styles.has(id):
		return true
	if int(data.wallet) < cost:
		return false
	data.wallet = int(data.wallet) - cost
	data.unlocked_styles.append(id)
	save_profile()
	return true

func finish_run(stats: Dictionary) -> Dictionary:
	var run_id := str(stats.get("run_id", ""))
	if run_id.is_empty() or data.processed_runs.has(run_id):
		return {"credited": false, "wallet": data.wallet, "high_score": data.high_score}
	var coins := clampi(int(stats.get("coins", 0)), 0, 100000)
	var score := clampi(int(stats.get("score", 0)), 0, 2000000000)
	var distance := maxf(0.0, float(stats.get("distance", 0.0)))
	if not is_finite(distance):
		distance = 0.0
	var new_best := score > int(data.high_score)
	data.wallet = mini(2000000000, int(data.wallet) + coins)
	data.high_score = maxi(int(data.high_score), score)
	data.best_distance = maxf(float(data.best_distance), distance)
	data.total_distance = float(data.total_distance) + distance
	data.runs = int(data.runs) + 1
	data.processed_runs.append(run_id)
	while data.processed_runs.size() > 256:
		data.processed_runs.pop_front()
	save_profile()
	return {"credited": true, "coins": coins, "wallet": data.wallet,
		"new_best": new_best, "high_score": data.high_score}

func update_settings(changes: Dictionary) -> void:
	_sanitize_settings(changes)
	save_profile()

func _sanitize_settings(changes: Dictionary) -> void:
	var quality := str(changes.get("quality", data.settings.quality))
	if quality in ["low", "medium", "high"]:
		data.settings.quality = quality
	for key in ["music", "sfx", "tap_controls"]:
		if changes.get(key) is bool:
			data.settings[key] = changes[key]

func set_age_group(group: String) -> void:
	if group in ["under13", "teen", "adult"]:
		data.age_group = group
		save_profile()

func apply_verified_entitlements(items: Array) -> void:
	# Required item forms from the verified service:
	# {product_id, active:true/false}, or
	# {kind:"coin_delivery", delivery_id, coins}. Never pass UI-supplied payloads.
	for raw in items:
		if not raw is Dictionary:
			continue
		var item: Dictionary = raw
		if item.get("kind") == "coin_delivery":
			var delivery_id := str(item.get("delivery_id", ""))
			if delivery_id.is_empty() or data.processed_deliveries.has(delivery_id):
				continue
			var amount := clampi(int(item.get("coins", 0)), 0, 1000000)
			data.wallet = mini(2000000000, int(data.wallet) + amount)
			data.processed_deliveries.append(delivery_id)
			continue
		var product_id := str(item.get("product_id", ""))
		if not PREMIUM_STYLES.has(product_id) and product_id != "remove_forced_ads":
			continue
		if bool(item.get("active", false)):
			if not data.entitlements.has(product_id):
				data.entitlements.append(product_id)
		else:
			data.entitlements.erase(product_id)
	for style in ["astronaut", "neon"]:
		if _style_is_entitled(style):
			if not data.unlocked_styles.has(style):
				data.unlocked_styles.append(style)
		else:
			data.unlocked_styles.erase(style)
	if not data.unlocked_styles.has(data.selected_style):
		data.selected_style = "courier"
	save_profile()

func _style_is_entitled(style: String) -> bool:
	for product_id in PREMIUM_STYLES:
		if PREMIUM_STYLES[product_id] == style and data.entitlements.has(product_id):
			return true
	return false
