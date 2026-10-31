extends Node
class_name RunnerServices

## Only native SDK callbacks can award ad revives. Test mode is an explicit
## build configuration, and never reports a successful payment.
signal event(kind: String, payload: Dictionary)
const LIVE_PURCHASE_GRANTS_IMPLEMENTED := false
var config: Dictionary = {}
var native: Object
var age_group := "unknown"
var _pending_reward := ""
var _session := ""
var _request: HTTPRequest
var _request_kind := ""

func setup(settings: Dictionary) -> void:
	config = settings.duplicate(true)
	_request = HTTPRequest.new()
	_request.timeout = 15.0
	add_child(_request)
	_request.request_completed.connect(_http_completed)
	if Engine.has_singleton("SubwayRunnerServices"):
		native = Engine.get_singleton("SubwayRunnerServices")
		if native.has_signal("event_json"):
			native.connect("event_json", _on_native_event)
		var native_config := config.duplicate(true)
		native_config.billing_enabled = bool(config.get("live_payments", false)) and LIVE_PURCHASE_GRANTS_IMPLEMENTED
		native.call("configure", JSON.stringify(native_config))
	else:
		event.emit("status", {"message": "Native services are available in the Android build."})
	if FileAccess.file_exists("user://commerce_session.txt"):
		_session = FileAccess.get_file_as_string("user://commerce_session.txt").strip_edges()

func set_age_group(group: String) -> void:
	age_group = group
	_pending_reward = ""
	if native != null:
		native.call("set_age_group", group)

func request_reward(placement: String) -> void:
	if age_group != "adult":
		event.emit("message", {"message": "Videos are available to adults only."})
		return
	if native == null:
		event.emit("message", {"message": "Test videos are available in the Android APK."})
		return
	_pending_reward = placement
	native.call("request_reward", placement)

func interstitial() -> void:
	if age_group == "adult" and native != null:
		native.call("show_interstitial")

func purchase(product_id: String) -> void:
	if not bool(config.get("live_payments", false)):
		event.emit("message", {"message": "TEST BUILD: real payments are disabled."})
		return
	if not LIVE_PURCHASE_GRANTS_IMPLEMENTED:
		event.emit("message", {"message": "The live shop is not ready. No payment was started."})
		return
	if native == null or not _backend_ready():
		event.emit("message", {"message": "Purchases are currently unavailable."})
		return
	native.call("request_purchase", product_id)

func restore() -> void:
	if native == null or not bool(config.get("live_payments", false)) or not LIVE_PURCHASE_GRANTS_IMPLEMENTED:
		event.emit("message", {"message": "Purchase restore becomes available with the live shop."})
		return
	native.call("restore_purchases")

func privacy() -> void:
	if native != null and age_group == "adult":
		native.call("show_privacy_options")
	else:
		event.emit("message", {"message": "No ads are initialized for children, teens or unknown ages."})

func _on_native_event(raw: String) -> void:
	var parsed: Variant = JSON.parse_string(raw)
	if not parsed is Dictionary:
		return
	var payload: Dictionary = parsed
	var kind := str(payload.get("type", payload.get("event", "message")))
	if kind in ["reward", "reward_earned"]:
		var placement := str(payload.get("placement", ""))
		if age_group == "adult" and not _pending_reward.is_empty() and placement == _pending_reward:
			_pending_reward = ""
			event.emit("reward", {"placement": placement})
	elif kind == "purchase":
		if str(payload.get("state", "")) == "PURCHASED":
			# Receiving a Billing callback is not proof of payment. Granting stays
			# disabled until the live backend release integration is configured.
			event.emit("purchase_pending_verification", payload)
		elif str(payload.get("state", "")) == "PENDING":
			event.emit("message", {"message": "Purchase awaits payment or parental approval."})
	elif kind == "products":
		event.emit("products", payload)
	elif kind in ["error", "message", "status", "ads_status", "ad_error"]:
		event.emit("message", {"message": str(payload.get("message", "Test ad is not ready. Try again later."))})
	else:
		event.emit(kind, payload)

func _backend_ready() -> bool:
	return str(config.get("backend_url", "")).begins_with("https://")

func _http_completed(_result: int, _code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	_request_kind = ""
