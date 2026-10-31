@tool
extends EditorPlugin

var _export_plugin: EditorExportPlugin

func _enter_tree() -> void:
	_export_plugin = ServicesExport.new()
	add_export_plugin(_export_plugin)

func _exit_tree() -> void:
	if _export_plugin:
		remove_export_plugin(_export_plugin)
	_export_plugin = null

class ServicesExport extends EditorExportPlugin:
	func _get_name() -> String:
		return "SubwayRunnerServices"

	func _supports_platform(platform: EditorExportPlatform) -> bool:
		return platform is EditorExportPlatformAndroid

	func _get_android_libraries(_platform: EditorExportPlatform, debug: bool) -> PackedStringArray:
		var variant := "debug" if debug else "release"
		return PackedStringArray(["subway_runner_services/bin/services-%s.aar" % variant])

	func _get_android_dependencies(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
		# A local AAR does not carry its Maven runtime dependencies into Godot.
		return PackedStringArray([
			"com.android.billingclient:billing:8.1.0",
			"com.google.android.gms:play-services-ads:25.5.0",
			"com.google.android.ump:user-messaging-platform:4.0.0"
		])
