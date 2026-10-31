extends CanvasLayer
class_name RunnerHUD

## Presentation only: intents are sent to the root controller. Purchases, rewards
## and entitlement checks are never simulated by this view.
signal action(name: String, payload: Dictionary)

const INK := Color("112338")
const MUTED := Color("9eafbe")
const MINT := Color("72ebca")
const ORANGE := Color("ffb665")
const WHITE := Color("f6fafb")
const PANEL := Color("13283a")

var profile: Dictionary = {}
var catalog: Dictionary = {}
var current_screen := ""
var root: Control
var screen: Control
var hud: MarginContainer
var score_label: Label
var run_coin_label: Label
var power_label: Label
var mission_label: Label
var shield_button: Button
var test_badge: Label
var touch_controls: HBoxContainer
var toast: PanelContainer
var toast_label: Label
var toast_left := 0.0
var shop_tab := "characters"
var latest_state: Dictionary = {}
var _initialized := false
var _gate_next := ""
var _gate_payload: Dictionary = {}
var _gate_expected := 0
var _gate_answer: LineEdit
var _gate_hold := false
var _gate_seconds := 0.0
var _gate_button: Button
var _gate_return := "shop"
var _settings_return := "menu"
var _result_stats: Dictionary = {}

func configure(new_profile: Dictionary, new_catalog: Dictionary) -> void:
	profile = new_profile.duplicate(true)
	catalog = new_catalog.duplicate(true)
	if not _initialized:
		_build()
		_initialized = true
	elif current_screen == "shop":
		show_shop()

func _build() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	root = Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	root.resized.connect(_on_viewport_resized)
	var ui_theme := Theme.new()
	ui_theme.default_font_size = 16
	ui_theme.set_color("font_color", "Label", WHITE)
	ui_theme.set_color("font_color", "Button", WHITE)
	root.theme = ui_theme
	screen = Control.new()
	screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(screen)
	_build_hud()
	toast = PanelContainer.new()
	toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toast.add_theme_stylebox_override("panel", _style(INK, 18, Color("395568")))
	toast.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	toast.offset_left = -156
	toast.offset_right = 156
	toast.offset_top = -126
	toast.offset_bottom = -66
	toast_label = _label("", 14, WHITE)
	toast_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	toast.add_child(toast_label)
	root.add_child(toast)
	toast.hide()

func _build_hud() -> void:
	hud = MarginContainer.new()
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for edge in ["left", "right", "top", "bottom"]:
		hud.add_theme_constant_override("margin_" + edge, 18 if edge != "top" else 24)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(hud)
	var stack := VBoxContainer.new()
	stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(stack)
	var top := HBoxContainer.new()
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_theme_constant_override("separation", 10)
	stack.add_child(top)
	test_badge = _label("TEST BUILD · 99,999 starting coins", 10, ORANGE)
	test_badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	test_badge.visible = bool(profile.get("test_mode", false))
	stack.add_child(test_badge)
	var pause_button := _button("Ⅱ", func(): action.emit("pause", {}), "subtle")
	pause_button.custom_minimum_size = Vector2(48, 48)
	top.add_child(pause_button)
	var score_box := _pill(Color("112338"))
	score_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(score_box)
	var score_stack := VBoxContainer.new()
	score_stack.add_theme_constant_override("separation", 0)
	score_box.add_child(score_stack)
	score_label = _label("000000", 25, WHITE)
	score_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	score_stack.add_child(score_label)
	run_coin_label = _label("●  0", 18, ORANGE)
	var coin_box := _pill(Color("112338"))
	coin_box.custom_minimum_size.x = 84
	coin_box.add_child(run_coin_label)
	top.add_child(coin_box)
	shield_button = _button("◇", func(): action.emit("shield", {}), "subtle")
	shield_button.custom_minimum_size = Vector2(42, 48)
	shield_button.tooltip_text = "Shield · double tap or H"
	top.add_child(shield_button)
	power_label = _label("", 13, MINT)
	power_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(power_label)
	mission_label = _label("", 11, WHITE)
	mission_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	stack.add_child(mission_label)
	var spacer := Control.new()
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	stack.add_child(spacer)
	touch_controls = HBoxContainer.new()
	touch_controls.alignment = BoxContainer.ALIGNMENT_CENTER
	touch_controls.add_theme_constant_override("separation", 8)
	touch_controls.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for entry in [["‹", "left"], ["↑", "jump"], ["↓", "slide"], ["›", "right"]]:
		var action_name: String = entry[1]
		var button := _button(entry[0], func(): action.emit(action_name, {}), "subtle")
		button.custom_minimum_size = Vector2(56, 52)
		touch_controls.add_child(button)
	stack.add_child(touch_controls)
	hud.hide()

func render(state: Dictionary, new_profile: Dictionary) -> void:
	if not _initialized:
		return
	latest_state = state
	profile = new_profile.duplicate(true)
	test_badge.visible = bool(profile.get("test_mode", false))
	var phase := str(state.get("phase", "ready"))
	hud.visible = phase == "running" and current_screen.is_empty()
	score_label.text = "%06d" % int(state.get("score", 0))
	run_coin_label.text = "●  %d" % int(state.get("coins", 0))
	var powers: PackedStringArray = []
	if float(state.get("shield", 0.0)) > 0.0:
		powers.append("SHIELD  %ds" % ceili(float(state.shield)))
	if float(state.get("magnet", 0.0)) > 0.0:
		powers.append("MAGNET  %ds" % ceili(float(state.magnet)))
	if float(state.get("double_score", 0.0)) > 0.0:
		powers.append("SCORE ×2")
	power_label.text = "   ·   ".join(powers)
	shield_button.disabled = int(state.get("shield_charges", 0)) <= 0
	var missions: PackedStringArray = []
	for mission in state.get("missions", []):
		var completed: bool = int(mission.value) >= int(mission.target)
		missions.append(("✓ " if completed else "") + "%s %d/%d" % [mission.title, int(mission.value), int(mission.target)])
	mission_label.text = "   ·   ".join(missions)
	touch_controls.visible = bool(profile.get("settings", {}).get("tap_controls", false)) and phase == "running"
	if phase == "running" and current_screen in ["menu", "results", "pause"]:
		_clear()
	elif phase == "paused" and current_screen.is_empty():
		show_pause()

func show_menu() -> void:
	if not _initialized:
		return
	_clear("menu")
	hud.hide()
	var title := VBoxContainer.new()
	title.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	title.offset_left = 26
	title.offset_right = -26
	var compact := root.size.y < 550.0
	title.offset_top = 22 if compact else 72
	title.add_theme_constant_override("separation", -4)
	title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	screen.add_child(title)
	var first := _label("SUBWAY", 25 if compact else 38, WHITE)
	first.add_theme_color_override("font_shadow_color", Color("143843"))
	first.add_theme_constant_override("shadow_offset_y", 3)
	title.add_child(first)
	var second := _label("RUNNER", 34 if compact else 54, MINT)
	second.add_theme_color_override("font_shadow_color", Color("143843"))
	second.add_theme_constant_override("shadow_offset_y", 3)
	title.add_child(second)
	if not compact:
		title.add_child(_label("THE CITY IS YOUR PLAYGROUND", 11, WHITE))
	if bool(profile.get("test_mode", false)):
		title.add_child(_label("TEST BUILD · 99,999 starting coins", 10, ORANGE))
	var bottom := VBoxContainer.new()
	bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_left = 24
	bottom.offset_right = -24
	bottom.offset_top = -208 if compact else -258
	bottom.offset_bottom = -16 if compact else -26
	bottom.add_theme_constant_override("separation", 8 if compact else 12)
	screen.add_child(bottom)
	var record := HBoxContainer.new()
	var best := _label("BEST  %s" % _number(int(profile.get("high_score", 0))), 14, WHITE)
	best.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	record.add_child(best)
	record.add_child(_label("●  %s" % _number(int(profile.get("wallet", 0))), 18, ORANGE))
	bottom.add_child(record)
	var play := _button("LET’S RUN  ›", func(): _clear(); action.emit("start", {}), "primary")
	play.custom_minimum_size.y = 54 if compact else 68
	play.add_theme_font_size_override("font_size", 24)
	bottom.add_child(play)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var runners := _button("RUNNERS + SHOP", func(): show_shop(), "subtle")
	runners.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(runners)
	var settings := _button("SETTINGS", func(): show_settings(), "subtle")
	settings.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(settings)
	bottom.add_child(row)
	var instructions := "Swipe to move · up to jump · down to slide"
	if not OS.has_feature("mobile"):
		instructions = "Arrow keys / WASD · Space to jump"
	var hint := _label(instructions, 12, WHITE)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	bottom.add_child(hint)

func show_pause() -> void:
	_clear("pause")
	var body := _modal("TAKE A BREATHER", "Your run is paused.")
	body.add_child(_button("KEEP RUNNING", func(): _clear(); action.emit("resume", {}), "primary"))
	body.add_child(_button("SETTINGS", func(): show_settings(), "subtle"))
	body.add_child(_button("BACK TO MENU", func(): action.emit("menu", {}), "subtle"))

func show_results(stats: Dictionary) -> void:
	_result_stats = stats.duplicate(true)
	_clear("results")
	hud.hide()
	var body := _modal("NICE RUN!", "There’s always another route.")
	var score := _label(_number(int(stats.get("score", 0))), 48, MINT)
	score.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(score)
	var details := _label("%dm travelled     ● %d collected" % [int(stats.get("distance", 0)), int(stats.get("coins", 0))], 15, WHITE)
	details.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(details)
	if int(stats.get("mission_bonus", 0)) > 0:
		var mission_reward := _label("MISSION BONUS  +%d coins" % int(stats.mission_bonus), 14, ORANGE)
		mission_reward.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		body.add_child(mission_reward)
	if bool(stats.get("new_best", false)):
		var badge := _label("NEW PERSONAL BEST", 13, ORANGE)
		badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		body.add_child(badge)
	body.add_child(_button("RUN AGAIN  ›", func(): _clear(); action.emit("retry", {}), "primary"))
	if profile.get("age_group", "unknown") == "adult" and bool(stats.get("can_revive", false)):
		body.add_child(_button("WATCH VIDEO · REVIVE", func(): action.emit("reward", {"placement": "revive"}), "subtle"))
	body.add_child(_button("BACK TO MENU", func(): action.emit("menu", {}), "subtle"))

func show_shop() -> void:
	_clear("shop")
	action.emit("pause", {})
	hud.hide()
	var body := _page("YOUR RUN. YOUR STYLE.", "● %s coins" % _number(int(profile.get("wallet", 0))))
	var tabs := HBoxContainer.new()
	tabs.add_theme_constant_override("separation", 8)
	for tab in ["characters", "packs"]:
		var selected_tab: String = tab
		var button := _button(tab.to_upper(), func(): shop_tab = selected_tab; show_shop(), "primary" if shop_tab == tab else "subtle")
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		tabs.add_child(button)
	body.add_child(tabs)
	var scroller := ScrollContainer.new()
	scroller.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroller.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(scroller)
	var cards := VBoxContainer.new()
	cards.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cards.add_theme_constant_override("separation", 10)
	scroller.add_child(cards)
	if shop_tab == "characters":
		for raw in catalog.get("styles", []):
			if raw is Dictionary:
				cards.add_child(_style_card(raw))
	else:
		for raw in catalog.get("products", []):
			if raw is Dictionary and not str(raw.get("id", "")).begins_with("character_"):
				cards.add_child(_product_card(raw))
		var information := _label("Prices come from Google Play. Purchases need internet. Permanent purchases can be restored.", 12, MUTED)
		information.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		cards.add_child(information)
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 8)
	var restore := _button("RESTORE PURCHASES", func(): _protected_action("restore", {}), "subtle")
	restore.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(restore)
	footer.add_child(_button("DONE", func(): _close_overlay(), "primary"))
	body.add_child(footer)

func show_settings() -> void:
	var previous := current_screen
	_clear("settings")
	if previous != "settings" and previous != "parent_gate":
		_settings_return = "pause" if previous in ["pause", ""] else "menu"
	action.emit("pause", {})
	hud.hide()
	var body := _page("MAKE IT YOURS", "Settings")
	var settings: Dictionary = profile.get("settings", {})
	body.add_child(_label("GRAPHICS", 12, MINT))
	var qualities := HBoxContainer.new()
	qualities.add_theme_constant_override("separation", 8)
	for q in ["low", "medium", "high"]:
		var quality: String = q
		var selected: bool = settings.get("quality", "medium") == q
		var button := _button(q.capitalize(), func():
			profile.settings.quality = quality
			action.emit("settings", {"quality": quality})
			show_settings(), "primary" if selected else "subtle")
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		qualities.add_child(button)
	body.add_child(qualities)
	var note := _label("Choose Low for longer battery life or a smoother run on older phones.", 12, MUTED)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(note)
	for row in [["Music", "music"], ["Sound effects", "sfx"], ["On-screen controls", "tap_controls"]]:
		var key: String = row[1]
		var toggle := CheckButton.new()
		toggle.text = row[0]
		toggle.custom_minimum_size.y = 54
		toggle.button_pressed = bool(settings.get(key, key != "tap_controls"))
		toggle.toggled.connect(func(enabled: bool):
			profile.settings[key] = enabled
			action.emit("settings", {key: enabled}))
		body.add_child(toggle)
	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(spacer)
	body.add_child(_button("PRIVACY & CONSENT", func(): _protected_action("privacy", {}), "subtle"))
	body.add_child(_button("SUPPORT", func(): _protected_action("website", {}), "subtle"))
	body.add_child(_button("DONE", func():
		if _settings_return == "pause":
			show_pause()
		else:
			show_menu(), "primary"))

func show_age_gate() -> void:
	_clear("age")
	hud.hide()
	var body := _modal("WELCOME, RUNNER", "Choose your age group. This helps us show suitable features. You can play in every group.")
	for item in [["Under 13", "under13"], ["13–17", "teen"], ["18 or older", "adult"]]:
		var group: String = item[1]
		body.add_child(_button(item[0], func(): action.emit("age", {"group": group}), "subtle"))
	var note := _label("Your choice stays on this device. We don’t ask for your birthday.", 12, MUTED)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(note)

func show_parent_gate(next_action: String, payload: Dictionary = {}) -> void:
	_gate_next = next_action
	_gate_payload = payload.duplicate(true)
	_gate_return = current_screen if current_screen in ["shop", "settings"] else "shop"
	_clear("parent_gate")
	var body := _modal("FOR A GROWN-UP", "Please ask a parent or guardian to continue.")
	var a := randi_range(13, 25)
	var b := randi_range(7, 18)
	_gate_expected = a + b
	var equation := _label("%d + %d = ?" % [a, b], 29, MINT)
	equation.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(equation)
	_gate_answer = LineEdit.new()
	_gate_answer.placeholder_text = "Answer"
	_gate_answer.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_gate_answer.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_NUMBER
	_gate_answer.custom_minimum_size.y = 52
	body.add_child(_gate_answer)
	_gate_button = _button("HOLD TO CONTINUE", func(): pass, "primary")
	_gate_button.button_down.connect(func():
		_gate_hold = _gate_answer.text.strip_edges() == str(_gate_expected)
		_gate_seconds = 0.0
		if not _gate_hold:
			show_message("Please check the answer."))
	_gate_button.button_up.connect(func():
		_gate_hold = false
		_gate_seconds = 0.0
		if is_instance_valid(_gate_button):
			_gate_button.text = "HOLD TO CONTINUE")
	body.add_child(_gate_button)
	body.add_child(_button("GO BACK", func():
		if _gate_return == "settings":
			show_settings()
		else:
			show_shop(), "subtle"))
	var note := _label("Google Play may also ask for purchase approval.", 12, MUTED)
	note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(note)

func show_message(text: String) -> void:
	if not _initialized:
		return
	toast_label.text = text
	toast.show()
	toast_left = 3.8

func _process(delta: float) -> void:
	if toast_left > 0.0:
		toast_left -= delta
		if toast_left <= 0.0 and is_instance_valid(toast):
			toast.hide()
	if _gate_hold and current_screen == "parent_gate":
		_gate_seconds += delta
		_gate_button.text = "KEEP HOLDING  %.1fs" % maxf(0.0, 1.5 - _gate_seconds)
		if _gate_seconds >= 1.5:
			_gate_hold = false
			var next := _gate_next
			var payload := _gate_payload.duplicate(true)
			if _gate_return == "settings":
				show_settings()
			else:
				show_shop()
			action.emit(next, payload)

func _style_card(style: Dictionary) -> PanelContainer:
	var panel := _pill(PANEL)
	panel.custom_minimum_size.y = 100
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	panel.add_child(row)
	var accent := Color("#" + str(style.get("accent", "72ebca")))
	var badge := _pill(accent.darkened(0.67))
	badge.custom_minimum_size = Vector2(48, 58)
	var initial := _label(str(style.get("name", "?")).left(1), 28, accent)
	initial.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	initial.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	badge.add_child(initial)
	row.add_child(badge)
	var details := VBoxContainer.new()
	details.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	details.add_theme_constant_override("separation", 2)
	details.add_child(_label(str(style.get("name", "Runner")), 19, WHITE))
	details.add_child(_label(str(style.get("subtitle", "")), 11, MUTED))
	row.add_child(details)
	var id := str(style.get("id", "courier"))
	var unlocked: bool = profile.get("unlocked_styles", []).has(id)
	var selected: bool = str(profile.get("selected_style", "courier")) == id
	var text := "SELECTED" if selected else "SELECT"
	var callback: Callable = func(): action.emit("select_style", {"id": id})
	if not unlocked:
		if style.get("unlock") == "coins":
			var cost := int(style.get("cost", 0))
			text = "● %d" % cost
			callback = func(): action.emit("unlock_style", {"id": id, "cost": cost})
		else:
			var product_id := str(style.get("product_id", ""))
			if bool(profile.get("test_mode", false)):
				text = "PREVIEW · TEST"
				callback = func(): action.emit("preview_style", {"id": id})
			else:
				text = _price(product_id)
				callback = func(): _protected_action("purchase", {"product_id": product_id})
	var button := _button(text, callback, "primary" if selected else "subtle")
	button.custom_minimum_size.x = 96
	button.add_theme_font_size_override("font_size", 12)
	button.disabled = selected
	row.add_child(button)
	return panel

func _product_card(product: Dictionary) -> PanelContainer:
	var panel := _pill(PANEL)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	panel.add_child(body)
	body.add_child(_label(str(product.get("name", "Pack")), 19, WHITE))
	var description := _label(str(product.get("description", "")), 13, MUTED)
	description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(description)
	var product_id := str(product.get("id", ""))
	var owned: bool = profile.get("entitlements", []).has(product_id)
	var button := _button("OWNED" if owned else _price(product_id), func(): _protected_action("purchase", {"product_id": product_id}), "subtle")
	button.disabled = owned
	body.add_child(button)
	return panel

func _price(product_id: String) -> String:
	if bool(profile.get("test_mode", false)):
		return "TEST · NOT LIVE"
	for product in catalog.get("products", []):
		if str(product.get("id", "")) == product_id:
			var price := str(product.get("localized_price", ""))
			if not price.is_empty():
				return price
	return "CHECK PRICE"

func _protected_action(name: String, payload: Dictionary) -> void:
	if profile.get("age_group", "unknown") != "adult":
		show_parent_gate(name, payload)
	else:
		action.emit(name, payload)

func _close_overlay() -> void:
	if str(latest_state.get("phase", "ready")) == "paused" and float(latest_state.get("distance", 0.0)) > 0.0:
		show_pause()
	else:
		show_menu()

func _clear(next_screen: String = "") -> void:
	current_screen = next_screen
	_gate_hold = false
	_gate_seconds = 0.0
	for child in screen.get_children():
		screen.remove_child(child)
		child.queue_free()

func _modal(title: String, subtitle: String) -> VBoxContainer:
	_shade()
	var outer := MarginContainer.new()
	outer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for edge in ["left", "right"]:
		outer.add_theme_constant_override("margin_" + edge, 24)
	outer.add_theme_constant_override("margin_top", 30)
	outer.add_theme_constant_override("margin_bottom", 30)
	screen.add_child(outer)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	outer.add_child(scroll)
	var center := VBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	var panel := _pill(INK)
	center.add_child(panel)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 16)
	panel.add_child(body)
	var heading := _label(title, 24, WHITE)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	heading.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(heading)
	if not subtitle.is_empty():
		var note := _label(subtitle, 14, MUTED)
		note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		body.add_child(note)
	return body

func _page(title: String, subtitle: String) -> VBoxContainer:
	_shade()
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for edge in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + edge, 20)
	margin.add_theme_constant_override("margin_top", 36)
	margin.add_theme_constant_override("margin_bottom", 24)
	screen.add_child(margin)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 14)
	margin.add_child(body)
	var heading := _label(title, 23, WHITE)
	heading.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(heading)
	body.add_child(_label(subtitle, 15, ORANGE))
	return body

func _shade() -> void:
	var shade := ColorRect.new()
	shade.color = Color(0.025, 0.065, 0.11, 0.88)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	screen.add_child(shade)

func _label(value: String, size: int = 16, color: Color = WHITE) -> Label:
	var label := Label.new()
	label.text = value
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label

func _button(value: String, callback: Callable, variant: String = "subtle") -> Button:
	var button := Button.new()
	button.text = value
	button.custom_minimum_size.y = 48
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_size_override("font_size", 15)
	var color := MINT if variant == "primary" else Color("233e51")
	button.add_theme_stylebox_override("normal", _style(color, 16))
	button.add_theme_stylebox_override("hover", _style(color.lightened(0.10), 16))
	button.add_theme_stylebox_override("pressed", _style(color.darkened(0.13), 16))
	button.add_theme_stylebox_override("disabled", _style(Color("2b494e"), 16))
	button.add_theme_color_override("font_color", INK if variant == "primary" else WHITE)
	button.add_theme_color_override("font_hover_color", INK if variant == "primary" else WHITE)
	button.add_theme_color_override("font_pressed_color", INK if variant == "primary" else WHITE)
	button.add_theme_color_override("font_disabled_color", MINT)
	button.pressed.connect(callback)
	return button

func _pill(color: Color) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _style(color, 18))
	return panel

func _style(color: Color, radius: int = 16, border: Color = Color.TRANSPARENT) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.corner_radius_top_left = radius
	style.corner_radius_top_right = radius
	style.corner_radius_bottom_left = radius
	style.corner_radius_bottom_right = radius
	style.content_margin_left = 15
	style.content_margin_right = 15
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	if border.a > 0.0:
		style.border_color = border
		style.set_border_width_all(1)
	return style

func _number(value: int) -> String:
	var text := str(maxi(0, value))
	var output := ""
	for index in range(text.length()):
		if index > 0 and (text.length() - index) % 3 == 0:
			output += ","
		output += text[index]
	return output

func _on_viewport_resized() -> void:
	# Reflow the title/actions for short landscape windows. Modal content scrolls
	# when the keyboard or display leaves less room than its natural height.
	if _initialized and current_screen == "menu":
		show_menu.call_deferred()
