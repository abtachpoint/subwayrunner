extends SceneTree
## Native original scene geometry, quantized for the offline WebGL test build.
## Each vertex: signed16 position/128, signed16 normal/32767, RGB8+metal8.
var total_vertices := 0

func _initialize() -> void:
	call_deferred("export_models")

func export_models() -> void:
	var world = load("res://scripts/world_view.gd").new()
	world.set_meta("offline_export", true)
	root.add_child(world)
	world.setup("medium")
	var result := {"version": 1, "stride": 16, "chunks": [], "templates": {}, "characters": {}}
	for chunk in world._chunks:
		result.chunks.append(_model(chunk))
	var track_data := PackedByteArray()
	for child in world.get_children():
		if child is MeshInstance3D:
			_collect(child, child.transform, track_data, {})
	result.track = _encoded(track_data)
	for kind in ["train0", "train1", "train2", "ramp", "barrier", "lowbar", "coin", "magnet", "double_score", "shield"]:
		var node := Node3D.new()
		world.add_child(node)
		if kind.begins_with("train"):
			world._make_train(node, {"length": 14.0, "height": 2.7, "color_index": int(kind.right(1)), "id": int(kind.right(1))})
		elif kind == "ramp": world._make_ramp(node, 7.0, 2.7)
		elif kind == "barrier": world._make_barrier(node, 1.05)
		elif kind == "lowbar": world._make_lowbar(node)
		elif kind == "coin": world._make_coin(node)
		else: world._make_powerup(node, kind)
		result.templates[kind] = _model(node)
		world.remove_child(node)
		node.queue_free()
	for style in ["courier", "skater", "sprinter", "robot", "astronaut", "neon"]:
		var actor = load("res://scripts/runner_visual.gd").new()
		root.add_child(actor)
		actor.setup(style)
		var bones: Array = [actor._motion, actor._torso, actor._head]
		for i in 2:
			bones.append_array([actor._arms[i], actor._elbows[i], actor._legs[i], actor._knees[i], actor._feet[i]])
		var bone_lookup := {}
		for i in bones.size(): bone_lookup[bones[i].get_instance_id()] = i
		var exported: Array = []
		for i in bones.size():
			var bone: Node3D = bones[i]
			var parent_index := int(bone_lookup.get(bone.get_parent().get_instance_id(), -1))
			var skip := bone_lookup.duplicate()
			skip.erase(bone.get_instance_id())
			var packed := PackedByteArray()
			for child in bone.get_children():
				if child is Node3D: _collect(child, child.transform, packed, skip)
			exported.append({"name": str(bone.name), "parent": parent_index,
				"p": _vector(bone.position), "r": _vector(bone.rotation), "s": _vector(bone.scale), "mesh": _encoded(packed)})
		result.characters[style] = {"bones": exported}
		actor.queue_free()
	var output := "/workspace/subway-runner/web/assets/models.js"
	var file := FileAccess.open(output, FileAccess.WRITE)
	file.store_string("window.RUNNER_MODELS=" + JSON.stringify(result) + ";\n")
	file.close()
	print("WEB_MODELS exported ", total_vertices, " vertices to ", output)
	world.queue_free()
	await process_frame
	quit()

func _vector(v: Vector3) -> Array:
	return [snappedf(v.x, 0.0001), snappedf(v.y, 0.0001), snappedf(v.z, 0.0001)]

func _model(node: Node3D) -> Dictionary:
	var bytes := PackedByteArray()
	for child in node.get_children():
		if child is Node3D: _collect(child, child.transform, bytes, {})
	return _encoded(bytes)

func _encoded(bytes: PackedByteArray) -> Dictionary:
	var count := bytes.size() / 16
	total_vertices += count
	return {"count": count, "data": "" if bytes.is_empty() else Marshalls.raw_to_base64(bytes)}

func _collect(node: Node3D, transform: Transform3D, out: PackedByteArray, skip: Dictionary) -> void:
	if skip.has(node.get_instance_id()) or not node.visible: return
	if node is MeshInstance3D and node.mesh != null:
		_append_mesh(node.mesh, node.material_override, transform, out)
	elif node is MultiMeshInstance3D:
		var transforms: Array = node.get_meta("preview_transforms", [])
		var count: int = node.multimesh.visible_instance_count
		if count < 0: count = node.multimesh.instance_count
		for i in mini(count, transforms.size()):
			_append_mesh(node.multimesh.mesh, node.material_override, transform * transforms[i], out)
	for child in node.get_children():
		if child is Node3D: _collect(child, transform * child.transform, out, skip)

func _append_mesh(mesh: Mesh, override_material: Material, transform: Transform3D, out: PackedByteArray) -> void:
	var normal_basis := transform.basis.inverse().transposed()
	for surface in mesh.get_surface_count():
		var arrays := mesh.surface_get_arrays(surface)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		var material: Material = override_material if override_material != null else mesh.surface_get_material(surface)
		var color := Color.WHITE
		var metallic := 0.0
		if material is StandardMaterial3D:
			color = material.albedo_color
			metallic = material.metallic
			if material.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED: continue
		var count := indices.size() if not indices.is_empty() else vertices.size()
		var offset := out.size()
		out.resize(offset + count * 16)
		for i in count:
			var index := int(indices[i]) if not indices.is_empty() else i
			var point := transform * vertices[index]
			var normal: Vector3 = (normal_basis * normals[index]).normalized() if index < normals.size() else Vector3.UP
			var pos := offset + i * 16
			out.encode_s16(pos, clampi(roundi(point.x * 128), -32767, 32767))
			out.encode_s16(pos + 2, clampi(roundi(point.y * 128), -32767, 32767))
			out.encode_s16(pos + 4, clampi(roundi(point.z * 128), -32767, 32767))
			out.encode_s16(pos + 6, clampi(roundi(normal.x * 32767), -32767, 32767))
			out.encode_s16(pos + 8, clampi(roundi(normal.y * 32767), -32767, 32767))
			out.encode_s16(pos + 10, clampi(roundi(normal.z * 32767), -32767, 32767))
			out[pos + 12] = clampi(roundi(color.r * 255), 0, 255)
			out[pos + 13] = clampi(roundi(color.g * 255), 0, 255)
			out[pos + 14] = clampi(roundi(color.b * 255), 0, 255)
			out[pos + 15] = clampi(roundi(metallic * 255), 0, 255)
