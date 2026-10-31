extends Node3D
class_name RunnerWorldView

# Streaming visual presentation only. Simulation owns all collisions and object motion.
const CHUNK_LENGTH := 24.0
const CHUNK_COUNT := 8
const TRACK_WIDTH := 2.6
var _quality := "medium"
var _materials: Dictionary = {}
var _meshes: Dictionary = {}
var _objects: Dictionary = {}
var _pools: Dictionary = {}
var _chunks: Array[Node3D] = []
var _sun: DirectionalLight3D
var _environment: WorldEnvironment
var _clock := 0.0
var _ready_visuals := false
var _box := BoxMesh.new()
var _batches: Dictionary = {}
var _coin_batch: MultiMeshInstance3D
var _assembled_meshes: Dictionary = {}

func setup(quality: String = "medium") -> void:
	if _ready_visuals:
		set_quality(quality)
		return
	_ready_visuals = true
	_box.size = Vector3.ONE
	_make_environment()
	_make_track()
	_make_coin_batch()
	for i in CHUNK_COUNT:
		var chunk := Node3D.new()
		chunk.name = "CityBlock%02d" % i
		add_child(chunk)
		_build_city_block(chunk, i)
		_chunks.append(chunk)
	set_quality(quality)

func set_quality(quality: String) -> void:
	_quality = quality
	if is_inside_tree():
		get_viewport().msaa_3d = Viewport.MSAA_DISABLED if quality == "low" else Viewport.MSAA_2X if quality == "medium" else Viewport.MSAA_4X
	if is_instance_valid(_sun):
		_sun.shadow_enabled = quality != "low"
		_sun.directional_shadow_max_distance = 75.0 if quality == "high" else 45.0
	if is_instance_valid(_environment):
		_environment.environment.ssao_enabled = false
		_environment.environment.glow_enabled = false

func render(state: Dictionary, delta: float) -> void:
	if not _ready_visuals:
		setup()
	_clock += delta
	var distance := float(state.get("distance", 0.0))
	for i in _chunks.size():
		_chunks[i].position.z = fposmod(distance - i * CHUNK_LENGTH + 24.0, CHUNK_LENGTH * CHUNK_COUNT) - CHUNK_LENGTH * CHUNK_COUNT + 24.0
	var alive: Dictionary = {}
	var coin_count := 0
	var offline_coin_transforms: Array[Transform3D] = []
	for item_variant in state.get("objects", []):
		var item: Dictionary = item_variant
		var identifier := int(item.get("id", 0))
		var kind := str(item.get("kind", "coin"))
		if kind == "coin":
			if coin_count < _coin_batch.multimesh.instance_count:
				var spin := Basis(Vector3.UP, _clock * 3.2 + identifier * 0.37) * Basis(Vector3.RIGHT, PI * 0.5)
				var coin_transform := Transform3D(spin, Vector3(float(item.get("lane", 0)) * TRACK_WIDTH, float(item.get("height", 1.0)), float(item.get("z", -100.0))))
				_coin_batch.multimesh.set_instance_transform(coin_count, coin_transform)
				if bool(get_meta("offline_export", false)):
					offline_coin_transforms.append(coin_transform)
				coin_count += 1
			continue
		alive[identifier] = true
		var visual: Node3D
		if not _objects.has(identifier):
			visual = _take_object(kind, item)
			_objects[identifier] = visual
		else:
			visual = _objects[identifier]
		visual.position = Vector3(float(item.get("lane", 0)) * TRACK_WIDTH, 0.0, float(item.get("z", -100.0)))
		if kind == "coin":
			visual.position.y = float(item.get("height", 1.0))
			visual.rotation.y = _clock * 3.2 + identifier * 0.37
		elif kind == "powerup":
			visual.position.y = float(item.get("height", 1.1)) + sin(_clock * 3.5 + identifier) * 0.12
			visual.rotation.y = _clock * 1.5
		visual.visible = not bool(item.get("collected", false))
	_coin_batch.multimesh.visible_instance_count = coin_count
	if bool(get_meta("offline_export", false)):
		_coin_batch.set_meta("preview_transforms", offline_coin_transforms)
	for identifier in _objects.keys():
		if not alive.has(identifier):
			var visual: Node3D = _objects[identifier]
			var kind: String = visual.get_meta("pool_kind", "coin")
			visual.visible = false
			if not _pools.has(kind):
				_pools[kind] = []
			if _pools[kind].size() < 72:
				_pools[kind].append(visual)
			else:
				visual.queue_free()
			_objects.erase(identifier)

func _material(key: String, color: Color, metallic: float = 0.0, roughness: float = 0.65, emission: float = 0.0) -> StandardMaterial3D:
	if _materials.has(key):
		return _materials[key]
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.metallic = metallic
	mat.roughness = roughness
	if emission > 0.0:
		mat.emission_enabled = true
		mat.emission = color
		mat.emission_energy_multiplier = emission
	_materials[key] = mat
	return mat

func _mat(key: String) -> StandardMaterial3D:
	match key:
		"cream": return _material(key, Color("ffe0ab"))
		"coral": return _material(key, Color("ea8875"))
		"ochre": return _material(key, Color("d6a35f"))
		"mint": return _material(key, Color("8bc3b1"))
		"teal": return _material(key, Color("159fa6"), 0.22, 0.35)
		"orange": return _material(key, Color("f99840"), 0.15, 0.36)
		"plum": return _material(key, Color("a65883"), 0.12, 0.42)
		"glass": return _material(key, Color("234b61"), 0.45, 0.19)
		"window": return _material(key, Color("38768a"), 0.2, 0.3)
		"window_light": return _material(key, Color("ffe496"), 0.05, 0.48, 0.18)
		"roof": return _material(key, Color("527b85"), 0.35, 0.52)
		"metal": return _material(key, Color("abbac2"), 0.7, 0.28)
		"dark": return _material(key, Color("26383f"), 0.12, 0.65)
		"gold": return _material(key, Color("ffcd3c"), 0.55, 0.24, 0.12)
		"red": return _material(key, Color("f15d54"), 0.08, 0.55)
		"white": return _material(key, Color("fff6de"), 0.06, 0.55)
		"green": return _material(key, Color("4aab77"))
		"leaf": return _material(key, Color("72c97d"))
		"wood": return _material(key, Color("815750"))
		"ballast": return _material(key, Color("b08f78"))
		"pavement": return _material(key, Color("dfb69c"))
	return _material(key, Color("ff00ff"))

func _mesh_instance(parent: Node3D, mesh: Mesh, material: Material, at: Vector3 = Vector3.ZERO, scale_by: Vector3 = Vector3.ONE) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material
	node.position = at
	node.scale = scale_by
	parent.add_child(node)
	return node

func _rect(parent: Node3D, size: Vector3, at: Vector3, mat: String, rounded: float = 0.0) -> MeshInstance3D:
	if rounded > 0.0:
		return _mesh_instance(parent, _rounded_box(size, rounded), _mat(mat), at)
	return _mesh_instance(parent, _box, _mat(mat), at, size)

# Bevel mesh shared by exact size; smooth corner normals avoid cube-like train silhouettes.
func _rounded_box(size: Vector3, radius: float) -> ArrayMesh:
	var key := "%s/%0.3f" % [size, radius]
	if _meshes.has(key): return _meshes[key]
	var half := size * 0.5
	var r := minf(radius, minf(half.x, minf(half.y, half.z)) * 0.9)
	var inner := half - Vector3.ONE * r
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var indices := PackedInt32Array()
	var axes := [Vector3.RIGHT, Vector3.LEFT, Vector3.UP, Vector3.DOWN, Vector3.BACK, Vector3.FORWARD]
	for axis_variant in axes:
		var axis: Vector3 = axis_variant
		var u: Vector3 = Vector3.UP.cross(axis).normalized() if absf(axis.y) < 0.5 else Vector3.RIGHT
		var v: Vector3 = axis.cross(u)
		var hu := absf(u.dot(half))
		var hv := absf(v.dot(half))
		var ha := absf(axis.dot(half))
		var us := [-hu, -hu + r, hu - r, hu]
		var vs := [-hv, -hv + r, hv - r, hv]
		var start := vertices.size()
		for iy in 4:
			for ix in 4:
				var p: Vector3 = axis * ha + u * float(us[ix]) + v * float(vs[iy])
				var q: Vector3 = p.clamp(-inner, inner)
				var normal: Vector3 = (p - q).normalized()
				vertices.append(q + normal * r)
				normals.append(normal)
		for iy in 3:
			for ix in 3:
				var a := start + iy * 4 + ix
				indices.append_array(PackedInt32Array([a, a + 4, a + 1, a + 1, a + 4, a + 5]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_meshes[key] = mesh
	return mesh

func _cylinder(parent: Node3D, radius: float, height: float, at: Vector3, mat: String, top_radius: float = -1.0) -> MeshInstance3D:
	var key := "cylinder:%s:%s:%s" % [radius, height, top_radius]
	if not _meshes.has(key):
		var mesh := CylinderMesh.new()
		mesh.bottom_radius = radius
		mesh.top_radius = radius if top_radius < 0.0 else top_radius
		mesh.height = height
		mesh.radial_segments = 12
		_meshes[key] = mesh
	return _mesh_instance(parent, _meshes[key], _mat(mat), at)

func _sphere(parent: Node3D, size: Vector3, at: Vector3, mat: String) -> MeshInstance3D:
	if not _meshes.has("sphere"):
		var mesh := SphereMesh.new()
		mesh.radius = 0.5
		mesh.height = 1.0
		mesh.radial_segments = 12
		mesh.rings = 6
		_meshes["sphere"] = mesh
	return _mesh_instance(parent, _meshes["sphere"], _mat(mat), at, size)

func _make_environment() -> void:
	_environment = WorldEnvironment.new()
	var env := Environment.new()
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("459dce")
	sky_mat.sky_horizon_color = Color("ffd6b1")
	sky_mat.ground_bottom_color = Color("ac9a91")
	sky_mat.ground_horizon_color = Color("ffd6b1")
	sky_mat.sky_curve = 0.22
	sky.sky_material = sky_mat
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("b8dded")
	env.ambient_light_energy = 0.68
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.12
	env.fog_enabled = true
	env.fog_light_color = Color("e6c7b1")
	env.fog_light_energy = 0.7
	env.fog_density = 0.006
	env.fog_sky_affect = 0.2
	_environment.environment = env
	add_child(_environment)
	_sun = DirectionalLight3D.new()
	_sun.name = "GoldenHourSun"
	_sun.rotation_degrees = Vector3(-48, -32, 0)
	_sun.light_color = Color("fff0d3")
	_sun.light_energy = 1.2
	_sun.shadow_bias = 0.045
	_sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	add_child(_sun)

func _make_track() -> void:
	_rect(self, Vector3(52, 0.4, 230), Vector3(0, -0.43, -85), "pavement")
	_rect(self, Vector3(8.7, 0.24, 225), Vector3(0, -0.16, -85), "ballast")
	for side in [-1, 1]:
		_rect(self, Vector3(0.35, 0.36, 230), Vector3(side * 4.55, -0.03, -85), "cream")
	for lane in [-1, 0, 1]:
		for rail in [-1, 1]:
			_rect(self, Vector3(0.10, 0.14, 225), Vector3(lane * 2.6 + rail * 0.72, 0.05, -85), "metal")

func _make_coin_batch() -> void:
	# Every coin shares one draw call and one lit relief shader. The engraved
	# star and raised rim use local coordinates, with no image or texture fetch.
	var disk := CylinderMesh.new()
	disk.top_radius = 0.255
	disk.bottom_radius = 0.255
	disk.height = 0.075
	disk.radial_segments = 24
	var shader := Shader.new()
	shader.code = """shader_type spatial;
varying vec3 coin_local;
void vertex() { coin_local = VERTEX; }
void fragment() {
    float radius = length(coin_local.xz) / 0.255;
    float angle = atan(coin_local.z, coin_local.x);
    float star = 0.40 + 0.18 * cos(angle * 5.0);
    float face = step(0.032, abs(coin_local.y));
    vec3 gold = vec3(1.0, 0.65, 0.07);
    vec3 stamp = vec3(1.0, 0.85, 0.22);
    vec3 inset = vec3(0.93, 0.47, 0.025);
    vec3 pigment = mix(gold, inset, face * (1.0 - step(0.82, radius)));
    pigment = mix(pigment, stamp, face * (1.0 - smoothstep(star - 0.015, star + 0.015, radius)));
    ALBEDO = pigment;
    METALLIC = 0.48;
    ROUGHNESS = 0.32;
    EMISSION = pigment * 0.08;
}"""
	var material := ShaderMaterial.new()
	material.shader = shader
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.mesh = disk
	multi.instance_count = 512
	multi.visible_instance_count = 0
	_coin_batch = MultiMeshInstance3D.new()
	_coin_batch.name = "InstancedCoins"
	_coin_batch.multimesh = multi
	_coin_batch.material_override = material
	_coin_batch.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_coin_batch)

func _batch_box(size: Vector3, at: Vector3, mat: String, rotation: Vector3 = Vector3.ZERO) -> void:
	if not _batches.has(mat): _batches[mat] = []
	var basis := Basis.from_euler(rotation).scaled(size)
	_batches[mat].append(Transform3D(basis, at))

func _flush_batches(parent: Node3D) -> void:
	for mat in _batches:
		var transforms: Array = _batches[mat]
		var multi := MultiMesh.new()
		multi.transform_format = MultiMesh.TRANSFORM_3D
		multi.mesh = _box
		multi.instance_count = transforms.size()
		for i in transforms.size(): multi.set_instance_transform(i, transforms[i])
		var node := MultiMeshInstance3D.new()
		node.multimesh = multi
		node.material_override = _mat(mat)
		if bool(get_meta("offline_export", false)):
			node.set_meta("preview_transforms", transforms.duplicate())
		parent.add_child(node)
	_batches.clear()

func _build_city_block(parent: Node3D, block_index: int) -> void:
	_batches.clear()
	for lane in [-1, 0, 1]:
		for step in 20:
			_batch_box(Vector3(1.95, 0.13, 0.20), Vector3(lane * 2.6, -0.02, -step * 1.2), "wood")
	for side in [-1, 1]:
		for parcel in 3:
			var n := block_index * 7 + parcel * 3 + (1 if side > 0 else 0)
			var height := 8.8 + float((n * 7) % 11) * 0.65
			var depth := 6.9
			var z := -parcel * 8.0 - 4.0
			var width := 5.1 + float(n % 3) * 0.5
			var x: float = float(side) * (5.15 + width * 0.5)
			var color_key: String = ["cream", "coral", "ochre", "mint"][n % 4]
			_batch_box(Vector3(width, height, depth), Vector3(x, height * 0.5 - 0.1, z), color_key)
			_batch_box(Vector3(width + 0.25, 0.32, depth + 0.25), Vector3(x, height, z), "cream")
			_batch_box(Vector3(width + 0.40, 0.20, depth + 0.40), Vector3(x, height - 0.43, z), color_key)
			_batch_box(Vector3(0.15, 2.8, depth + 0.1), Vector3(side * 5.10, 1.4, z), "cream")
			# Facing track shopfronts, upper windows and projecting balconies.
			var facade_x: float = side * 5.10
			for window_z in [-2.2, 0.0, 2.2]:
				_batch_box(Vector3(0.10, 1.8, 1.38), Vector3(facade_x - side * 0.05, 1.25, z + window_z), "glass")
				_batch_box(Vector3(0.19, 0.12, 1.60), Vector3(facade_x - side * 0.10, 2.22, z + window_z), "cream")
			for floor_index in int((height - 3.5) / 2.1):
				var y := 4.1 + floor_index * 2.1
				for wz in [-2.1, 0.0, 2.1]:
					_batch_box(Vector3(0.1, 1.30, 1.08), Vector3(facade_x - side * 0.06, y, z + wz), "window")
					_batch_box(Vector3(0.18, 0.12, 1.30), Vector3(facade_x - side * 0.10, y - 0.72, z + wz), "cream")
					_batch_box(Vector3(0.14, 1.30, 0.06), Vector3(facade_x - side * 0.12, y, z + wz), "cream")
			# Sloping fabric canopy with cream alternating strips.
			_batch_box(Vector3(1.18, 0.13, 6.1), Vector3(side * 4.73, 2.9, z), "teal" if n % 2 == 0 else "red", Vector3(0, 0, side * -0.16))
			for stripe in 6:
				_batch_box(Vector3(1.20, 0.14, 0.31), Vector3(side * 4.73, 2.91, z - 2.5 + stripe), "cream", Vector3(0, 0, side * -0.16))
			# Low rooftop water tank and air-conditioning silhouettes.
			_batch_box(Vector3(1.2, 0.8, 1.5), Vector3(x, height + 0.55, z + 1.7), "roof")
			if parcel == 1:
				_batch_box(Vector3(0.15, 2.4, 0.15), Vector3(x, height + 1.4, z - 1.7), "dark")
				_batch_box(Vector3(1.8, 0.06, 0.06), Vector3(x, height + 2.2, z - 1.7), "dark")
		# Trackside lamps, colored station signs and simple plants repeat with chunks.
		for lamp_z in [-2.0, -16.0]:
			_batch_box(Vector3(0.14, 5.1, 0.14), Vector3(side * 4.75, 2.55, lamp_z), "dark")
			_batch_box(Vector3(0.76, 0.18, 0.4), Vector3(side * 4.5, 5.05, lamp_z), "cream")
		_batch_box(Vector3(0.18, 1.3, 1.7), Vector3(side * 4.65, 3.45, -8), "teal")
		_batch_box(Vector3(0.2, 0.15, 1.3), Vector3(side * 4.52, 3.45, -8), "white")
		_rect(parent, Vector3(0.60, 0.75, 0.60), Vector3(side * 4.9, 0.38, -12), "ochre", 0.08)
		_sphere(parent, Vector3(1.05, 1.2, 1.05), Vector3(side * 4.9, 1.18, -12), "green")
		_sphere(parent, Vector3(0.75, 0.8, 0.75), Vector3(side * 4.9, 1.8, -12), "leaf")
	# Thin overhead span and colorful festival flags create parallax above the lane.
	_batch_box(Vector3(10.0, 0.08, 0.08), Vector3(0, 6.3, -20), "dark")
	for flag in 11:
		_batch_box(Vector3(0.65, 0.45, 0.035), Vector3(-4.3 + flag * 0.86, 6.05, -20), ["teal", "gold", "coral"][flag % 3], Vector3(0.05, 0, 0.18 if flag % 2 else -0.18))
	_flush_batches(parent)

func _take_object(kind: String, item: Dictionary) -> Node3D:
	# Geometry dimensions form the pool key, so a reused ramp/train keeps correct size.
	var color_variant := int(item.get("color_index", item.get("id", 0))) % 3 if kind == "train" else 0
	var pool_key := "%s:%s:%s:%s:%s" % [kind, item.get("length", 0.0), item.get("height", 0.0), item.get("tag", ""), color_variant]
	var node: Node3D
	if _pools.has(pool_key) and not _pools[pool_key].is_empty():
		node = _pools[pool_key].pop_back()
	else:
		node = Node3D.new()
		node.name = kind.capitalize()
		node.set_meta("pool_kind", pool_key)
		add_child(node)
		if _assembled_meshes.has(pool_key):
			_mesh_instance(node, _assembled_meshes[pool_key], null)
		else:
			match kind:
				"train": _make_train(node, item)
				"coin": _make_coin(node)
				"barrier": _make_barrier(node, float(item.get("height", 0.85)))
				"lowbar": _make_lowbar(node)
				"ramp": _make_ramp(node, float(item.get("length", 4.0)), float(item.get("height", 2.7)))
				"powerup": _make_powerup(node, str(item.get("tag", "shield")))
				_: _make_barrier(node, 0.8)
			_assemble_static_mesh(node, pool_key)
		if kind == "train":
			_make_route_sign(node, item)
	node.rotation = Vector3.ZERO
	node.scale = Vector3.ONE
	node.visible = true
	return node

func _assemble_static_mesh(parent: Node3D, cache_key: String) -> void:
	# A detailed train has many decorative parts, but its shape never changes.
	# Bake parts sharing a material into one surface once, then reuse that mesh.
	# This retains the detail while avoiding dozens of draw calls per carriage.
	var groups: Dictionary = {}
	var sources: Array[MeshInstance3D] = []
	for child in parent.get_children():
		if not child is MeshInstance3D or child.mesh == null:
			continue
		sources.append(child)
		for surface_index in child.mesh.get_surface_count():
			var material: Material = child.material_override if child.material_override != null else child.mesh.surface_get_material(surface_index)
			var material_id := material.get_instance_id() if material != null else 0
			if not groups.has(material_id):
				var tool := SurfaceTool.new()
				tool.begin(Mesh.PRIMITIVE_TRIANGLES)
				groups[material_id] = {"tool": tool, "material": material, "count": 0}
			var group: Dictionary = groups[material_id]
			var surface_tool: SurfaceTool = group.tool
			var arrays: Array = child.mesh.surface_get_arrays(surface_index)
			var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
			var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var normal_basis: Basis = child.transform.basis.inverse().transposed()
			var first: int = group.count
			for vertex_index in vertices.size():
				surface_tool.set_normal((normal_basis * normals[vertex_index]).normalized() if vertex_index < normals.size() else Vector3.UP)
				surface_tool.add_vertex(child.transform * vertices[vertex_index])
			if indices.is_empty():
				for vertex_index in vertices.size():
					surface_tool.add_index(first + vertex_index)
			else:
				for index in indices:
					surface_tool.add_index(first + index)
			group.count = first + vertices.size()
	var combined := ArrayMesh.new()
	for group_variant in groups.values():
		var group: Dictionary = group_variant
		var surface_tool: SurfaceTool = group.tool
		surface_tool.set_material(group.material)
		surface_tool.commit(combined)
	for source in sources:
		parent.remove_child(source)
		source.queue_free()
	_assembled_meshes[cache_key] = combined
	_mesh_instance(parent, combined, null)

func _make_train(parent: Node3D, item: Dictionary) -> void:
	var length := float(item.get("length", 14.0))
	var height := float(item.get("height", 2.7))
	var palette: String = ["teal", "orange", "plum"][int(item.get("color_index", item.get("id", 0))) % 3]
	_rect(parent, Vector3(2.1, height - 0.56, length), Vector3(0, height * 0.5 + 0.18, 0), palette, 0.22)
	_rect(parent, Vector3(2.12, 0.31, length - 0.2), Vector3(0, 0.52, 0), "cream", 0.09)
	_rect(parent, Vector3(1.95, 0.20, length - 0.25), Vector3(0, height - 0.10, 0), "roof", 0.09)
	for side in [-1, 1]:
		_rect(parent, Vector3(0.14, 0.055, length - 1.8), Vector3(side * 0.84, height + 0.027, -0.3), palette, 0.025)
	# Cab faces toward the player. Its inset glazing and rounded nose are readable at speed.
	var front := length * 0.5
	_rect(parent, Vector3(1.94, 1.26, 0.16), Vector3(0, height - 0.94, front - 0.05), "cream", 0.16)
	for sx in [-1, 1]:
		_rect(parent, Vector3(0.75, 0.77, 0.09), Vector3(sx * 0.45, height - 0.88, front + 0.052), "glass", 0.075)
		_rect(parent, Vector3(0.58, 0.06, 0.03), Vector3(sx * 0.45, height - 0.54, front + 0.104), "window", 0.02)
		var lamp := _cylinder(parent, 0.14, 0.06, Vector3(sx * 0.70, 0.79, front + 0.06), "window_light")
		lamp.rotation.x = PI * 0.5
	_rect(parent, Vector3(1.8, 0.20, 0.32), Vector3(0, 0.41, front + 0.04), "dark", 0.08)
	_rect(parent, Vector3(0.56, 0.25, 0.12), Vector3(0, height - 0.18, front + 0.02), "dark", 0.05)
	_rect(parent, Vector3(0.30, 0.055, 0.02), Vector3(0, height - 0.18, front + 0.09), "gold")
	for side in [-1, 1]:
		for index in maxi(2, int(length / 1.9)):
			var z := -length * 0.5 + 1.0 + index * 1.85
			if z > front - 0.7: continue
			_rect(parent, Vector3(0.045, 0.72, 1.15), Vector3(side * 1.057, height - 0.98, z), "glass", 0.02)
			_rect(parent, Vector3(0.048, 0.045, 1.0), Vector3(side * 1.084, height - 0.67, z), "window_light")
			_rect(parent, Vector3(0.055, 0.075, 1.35), Vector3(side * 1.08, height - 1.41, z), "cream")
		for door_z in [-length * 0.29, length * 0.28]:
			_rect(parent, Vector3(0.05, 1.7, 0.82), Vector3(side * 1.076, 1.36, door_z), "roof")
			_rect(parent, Vector3(0.055, 0.75, 0.55), Vector3(side * 1.11, 1.75, door_z), "glass")
			_rect(parent, Vector3(0.058, 1.65, 0.035), Vector3(side * 1.12, 1.36, door_z), "metal")
			_rect(parent, Vector3(0.06, 0.12, 0.05), Vector3(side * 1.13, 1.1, door_z + 0.2), "gold")
		for wheel_z in [-length * 0.32, length * 0.32]:
			var wheel := _cylinder(parent, 0.36, 0.13, Vector3(side * 0.93, 0.30, wheel_z), "dark")
			wheel.rotation.z = PI * 0.5
	for vent_z in [-length * 0.25, 0.0, length * 0.25]:
		for side in [-1, 1]:
			_rect(parent, Vector3(0.42, 0.06, 0.8), Vector3(side * 0.63, height + 0.03, vent_z), "dark", 0.025)
			for slat in 4:
				_rect(parent, Vector3(0.34, 0.025, 0.06), Vector3(side * 0.63, height + 0.07, vent_z - 0.27 + slat * 0.18), "metal")
func _make_route_sign(parent: Node3D, item: Dictionary) -> void:
	var height := float(item.get("height", 2.7))
	var front := float(item.get("length", 14.0)) * 0.5
	var route := Label3D.new()
	route.text = "SR %02d" % (1 + int(item.get("id", 0)) % 8)
	route.font_size = 26
	route.pixel_size = 0.0023
	route.position = Vector3(0, height - 0.18, front + 0.09)
	route.modulate = Color("ffdc83")
	route.outline_size = 0
	parent.add_child(route)

func _make_coin(parent: Node3D) -> void:
	var disk := _cylinder(parent, 0.255, 0.075, Vector3.ZERO, "gold")
	disk.rotation.x = PI * 0.5
	var inset := _cylinder(parent, 0.19, 0.082, Vector3.ZERO, "orange")
	inset.rotation.x = PI * 0.5
	_rect(parent, Vector3(0.075, 0.27, 0.09), Vector3.ZERO, "gold", 0.02)
	_rect(parent, Vector3(0.18, 0.055, 0.09), Vector3(0, 0.10, 0), "gold", 0.02)
	_rect(parent, Vector3(0.18, 0.055, 0.09), Vector3(0, -0.10, 0), "gold", 0.02)

func _make_barrier(parent: Node3D, height: float) -> void:
	for side in [-1, 1]:
		_rect(parent, Vector3(0.13, height + 0.05, 0.18), Vector3(side * 0.82, height * 0.5, 0), "dark")
		_rect(parent, Vector3(0.43, 0.10, 0.54), Vector3(side * 0.82, 0.05, 0), "dark", 0.04)
	_rect(parent, Vector3(1.94, height * 0.72, 0.22), Vector3(0, height * 0.56, 0), "white", 0.05)
	for stripe in 5:
		var panel := _rect(parent, Vector3(0.20, height * 0.66, 0.035), Vector3(-0.73 + stripe * 0.36, height * 0.56, 0.13), "red")
		panel.rotation.z = -0.3
	for side in [-1, 1]:
		_sphere(parent, Vector3(0.15, 0.15, 0.15), Vector3(side * 0.82, height + 0.07, 0), "gold")

func _make_lowbar(parent: Node3D) -> void:
	for side in [-1, 1]:
		_rect(parent, Vector3(0.17, 2.45, 0.20), Vector3(side * 0.90, 1.22, 0), "dark", 0.04)
		_rect(parent, Vector3(0.38, 0.12, 0.48), Vector3(side * 0.90, 0.06, 0), "dark")
	_rect(parent, Vector3(2.1, 1.02, 0.30), Vector3(0, 1.99, 0), "red", 0.08)
	for stripe in 5:
		var panel := _rect(parent, Vector3(0.23, 0.90, 0.03), Vector3(-0.82 + stripe * 0.41, 1.99, 0.17), "white")
		panel.rotation.z = 0.28

func _make_ramp(parent: Node3D, length: float, height: float) -> void:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var a := Vector3(-1.03, 0.05, length * 0.5)
	var b := Vector3(1.03, 0.05, length * 0.5)
	var c := Vector3(-1.03, height, -length * 0.5)
	var d := Vector3(1.03, height, -length * 0.5)
	for vertex in [a, c, b, b, c, d, a, Vector3(a.x, 0, c.z), c, b, d, Vector3(b.x, 0, d.z)]:
		surface.add_vertex(vertex)
	surface.generate_normals()
	_mesh_instance(parent, surface.commit(), _mat("teal"))
	for side in [-1, 1]:
		var rail := _rect(parent, Vector3(0.08, 0.08, sqrt(length * length + height * height)), Vector3(side * 1.0, height * 0.5 + 0.06, 0), "gold")
		rail.rotation.x = atan2(height, length)
	for stripe in 7:
		var z := length * 0.5 - stripe * length / 7.0
		var y := 0.05 + (1.0 - float(stripe) / 7.0) * 0.0 + float(stripe) / 7.0 * height
		var line := _rect(parent, Vector3(1.84, 0.035, 0.12), Vector3(0, y + 0.045, z), "cream")
		line.rotation.x = atan2(height, length)

func _make_powerup(parent: Node3D, tag: String) -> void:
	var key := "teal" if tag == "magnet" else "gold" if tag == "double_score" else "mint"
	_sphere(parent, Vector3(0.66, 0.66, 0.66), Vector3.ZERO, key)
	var ring_mesh := TorusMesh.new()
	ring_mesh.inner_radius = 0.36
	ring_mesh.outer_radius = 0.43
	ring_mesh.rings = 12
	ring_mesh.ring_segments = 8
	var ring := _mesh_instance(parent, ring_mesh, _mat("white"))
	ring.rotation.x = PI * 0.35
	_rect(parent, Vector3(0.13, 0.46, 0.11), Vector3(0, 0, 0.34), "white", 0.04)
	_rect(parent, Vector3(0.39, 0.12, 0.11), Vector3(0, 0, 0.35), "white", 0.04)
