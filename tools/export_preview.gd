extends SceneTree

## Offline art preview only. This exports the native scene's geometry for a
## CPU-rendered Blender illustration; it is not an Android/Godot screenshot.

func _initialize() -> void:
	call_deferred("_export_scene")

func _export_scene() -> void:
	var scene := Node3D.new()
	scene.name = "SubwayRunnerOfflinePreview"
	root.add_child(scene)
	var simulation = load("res://scripts/runner_simulation.gd").new()
	simulation.start(2026)
	simulation._invulnerable = 100000.0
	while simulation.distance < 80.0:
		simulation.update(1.0 / 120.0)
	var state: Dictionary = simulation.snapshot()
	state.player_y = 0.0
	state.vertical_velocity = 0.0
	state.sliding = false
	var world = load("res://scripts/world_view.gd").new()
	world.set_meta("offline_export", true)
	scene.add_child(world)
	world.setup("high")
	world.render(state, 1.0)
	var runner = load("res://scripts/runner_visual.gd").new()
	scene.add_child(runner)
	runner.setup("courier")
	for i in 60:
		runner.animate(state, 1.0 / 60.0)
	var camera := Camera3D.new()
	camera.name = "PreviewCamera"
	camera.position = Vector3(0, 4.8, 8.2)
	camera.fov = 66.0
	scene.add_child(camera)
	camera.look_at(Vector3(0, 1.1, -11.0))
	camera.current = true
	_expand_instances(scene)
	var document := GLTFDocument.new()
	var gltf_state := GLTFState.new()
	var result := document.append_from_scene(scene, gltf_state)
	if result != OK:
		printerr("PREVIEW_EXPORT_FAILED ", result)
		quit(1)
		return
	var args := OS.get_cmdline_user_args()
	var path := args[0] if args.size() > 0 else "/workspace/subway-runner/release/Subway-Runner-scene.glb"
	result = document.write_to_filesystem(gltf_state, path)
	print("PREVIEW_EXPORT ", result, " ", path)
	scene.queue_free()
	await process_frame
	quit(0 if result == OK else 1)

func _expand_instances(parent: Node) -> void:
	for child in parent.get_children():
		if child is Node3D and not child.visible:
			parent.remove_child(child)
			child.queue_free()
			continue
		if child is MultiMeshInstance3D:
			var count: int = child.multimesh.visible_instance_count
			if count < 0:
				count = child.multimesh.instance_count
			var material: Material = child.material_override
			# GLTF cannot serialize the engine's custom gold-relief shader.
			# The offline illustration uses a plain metallic gold fallback.
			if material is ShaderMaterial:
				var fallback := StandardMaterial3D.new()
				fallback.albedo_color = Color("ffce42")
				fallback.metallic = 0.48
				fallback.roughness = 0.32
				material = fallback
			for i in count:
				var instance := MeshInstance3D.new()
				instance.name = "%s_%04d" % [child.name, i]
				instance.mesh = child.multimesh.mesh
				instance.material_override = material
				var transforms: Array = child.get_meta("preview_transforms", [])
				var transform: Transform3D = transforms[i] if i < transforms.size() else child.multimesh.get_instance_transform(i)
				instance.transform = child.transform * transform
				parent.add_child(instance)
			parent.remove_child(child)
			child.queue_free()
		elif child is Label3D:
			# Labels are runtime font geometry and are absent from GLTF preview.
			parent.remove_child(child)
			child.queue_free()
		else:
			_expand_instances(child)
