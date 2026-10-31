extends Node3D
class_name RunnerVisual

# Articulated original character. Travel is simulation-driven; only the local pose blends.
var _style := "courier"
var _motion: Node3D
var _torso: Node3D
var _head: Node3D
var _arms: Array[Node3D] = []
var _elbows: Array[Node3D] = []
var _legs: Array[Node3D] = []
var _knees: Array[Node3D] = []
var _feet: Array[Node3D] = []
var _shadow: MeshInstance3D
var _shield: MeshInstance3D
var _materials: Dictionary = {}
var _meshes: Dictionary = {}
var _phase := 0.0
var _speed_blend := 0.0
var _slide_blend := 0.0
var _air_blend := 0.0
var _previous_x := 0.0
var _clock := 0.0
var _initialized := false

func setup(style: String = "courier") -> void:
	set_style(style)

func set_style(style: String) -> void:
	if _initialized and _style == style: return
	_style = style
	_initialized = true
	for child in get_children():
		remove_child(child)
		child.queue_free()
	_arms.clear()
	_elbows.clear()
	_legs.clear()
	_knees.clear()
	_feet.clear()
	_build_character()

func animate(state: Dictionary, delta: float) -> void:
	if not _initialized: setup()
	var dt := clampf(delta, 0.0, 0.08)
	_clock += dt
	var active := str(state.get("phase", "ready")) == "running"
	var speed := float(state.get("speed", 12.0)) if active else 0.0
	_speed_blend = lerpf(_speed_blend, speed, 1.0 - exp(-12.0 * dt))
	_phase = fposmod(_phase + _speed_blend * dt * 0.73, TAU)
	var sliding := bool(state.get("sliding", false))
	_slide_blend = lerpf(_slide_blend, 1.0 if sliding else 0.0, 1.0 - exp(-22.0 * dt))
	var height := float(state.get("player_y", 0.0))
	var velocity_y := float(state.get("vertical_velocity", 0.0))
	var airborne := absf(velocity_y) > 0.15
	_air_blend = lerpf(_air_blend, 1.0 if airborne else 0.0, 1.0 - exp(-15.0 * dt))
	var x := float(state.get("player_x", 0.0))
	var lateral_velocity := (x - _previous_x) / maxf(dt, 0.001)
	_previous_x = x
	position = Vector3(x, height, 0.0)
	var run_weight := clampf(_speed_blend / 8.0, 0.0, 1.0)
	var gait_weight := run_weight * (1.0 - _air_blend) * (1.0 - _slide_blend)
	_motion.position.y = absf(sin(_phase)) * 0.045 * gait_weight - _slide_blend * 0.25
	_motion.rotation.z = lerpf(_motion.rotation.z, clampf(-lateral_velocity * 0.018, -0.15, 0.15), 1.0 - exp(-16.0 * dt))
	_motion.rotation.y = lerp_angle(_motion.rotation.y, clampf(-lateral_velocity * 0.025, -0.25, 0.25), 1.0 - exp(-10.0 * dt))
	_motion.scale.y = 1.0 - _slide_blend * 0.36
	_torso.rotation.x = -0.09 * run_weight - _slide_blend * 0.60 - _air_blend * 0.10
	_torso.rotation.y = sin(_phase) * 0.045 * gait_weight
	_head.rotation.x = _slide_blend * 0.40 + _air_blend * 0.04
	for i in 2:
		var offset := 0.0 if i == 0 else PI
		var wave := sin(_phase + offset)
		_legs[i].rotation.x = wave * 0.77 * gait_weight + _air_blend * (0.23 if i == 0 else -0.18) + _slide_blend * 0.9
		_legs[i].rotation.z = (0.035 if i == 0 else -0.035) + _air_blend * (0.12 if i == 0 else -0.12)
		_knees[i].rotation.x = -maxf(0.0, -wave) * 1.16 * gait_weight - _air_blend * (0.85 if i == 0 else 0.65) - _slide_blend * 1.35
		_feet[i].rotation.x = maxf(0.0, wave) * 0.20 * gait_weight + _air_blend * 0.10
		_arms[i].rotation.x = -wave * 0.76 * gait_weight - 0.12 + _air_blend * 0.75 + _slide_blend * 0.8
		_arms[i].rotation.z = (0.12 if i == 0 else -0.12) + _air_blend * (0.45 if i == 0 else -0.45)
		_elbows[i].rotation.x = -0.55 - maxf(0.0, wave) * 0.33 * gait_weight - _air_blend * 0.35
	_shadow.position.y = -height + 0.018
	var shadow_scale := clampf(1.0 - height * 0.08, 0.5, 1.0)
	_shadow.scale = Vector3(shadow_scale, shadow_scale, shadow_scale * 0.72)
	_shield.visible = float(state.get("shield", 0.0)) > 0.0
	_shield.rotation.y = _clock
	_shield.position.y = 1.05 + sin(_clock * 4.0) * 0.03

func _mat(name_key: String, color: Color, metallic: float = 0.0, roughness: float = 0.65) -> StandardMaterial3D:
	var key := "%s:%s" % [name_key, color.to_html()]
	if _materials.has(key): return _materials[key]
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.metallic = metallic
	mat.roughness = roughness
	_materials[key] = mat
	return mat

func _mesh(parent: Node3D, mesh: Mesh, mat: Material, at: Vector3 = Vector3.ZERO, scale_by: Vector3 = Vector3.ONE) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = mat
	node.position = at
	node.scale = scale_by
	parent.add_child(node)
	return node

func _box(parent: Node3D, size: Vector3, at: Vector3, mat: Material) -> MeshInstance3D:
	if not _meshes.has("box"):
		var mesh := BoxMesh.new()
		mesh.size = Vector3.ONE
		_meshes["box"] = mesh
	return _mesh(parent, _meshes["box"], mat, at, size)

func _ball(parent: Node3D, size: Vector3, at: Vector3, mat: Material) -> MeshInstance3D:
	if not _meshes.has("ball"):
		var mesh := SphereMesh.new()
		mesh.radius = 0.5
		mesh.height = 1.0
		mesh.radial_segments = 20
		mesh.rings = 10
		_meshes["ball"] = mesh
	return _mesh(parent, _meshes["ball"], mat, at, size)

func _capsule(parent: Node3D, radius: float, height: float, at: Vector3, mat: Material, depth_scale: float = 1.0) -> MeshInstance3D:
	var key := "capsule:%0.3f:%0.3f" % [radius, height]
	if not _meshes.has(key):
		var mesh := CapsuleMesh.new()
		mesh.radius = radius
		mesh.height = maxf(height, radius * 2.0)
		mesh.radial_segments = 16
		mesh.rings = 6
		_meshes[key] = mesh
	return _mesh(parent, _meshes[key], mat, at, Vector3(1, 1, depth_scale))

func _pivot(parent: Node3D, at: Vector3, title: String) -> Node3D:
	var node := Node3D.new()
	node.name = title
	node.position = at
	parent.add_child(node)
	return node

func _build_character() -> void:
	var robot := _style == "robot"
	var space := _style == "astronaut"
	var neon := _style == "neon"
	var colors := {
		"courier": [Color("f5a53e"), Color("218d9c"), Color("e9544c")],
		"skater": [Color("8c69bd"), Color("253d59"), Color("5bcfc1")],
		"sprinter": [Color("e75f64"), Color("263e58"), Color("f8ce53")],
		"robot": [Color("4eb6c1"), Color("607d94"), Color("f6bb4b")],
		"astronaut": [Color("e9f2eb"), Color("b6d0cf"), Color("e66e43")],
		"neon": [Color("263d59"), Color("1e2942"), Color("6de2c4")]
	}
	var palette: Array = colors.get(_style, colors["courier"])
	var shirt := _mat("shirt", palette[0])
	var trousers := _mat("trousers", palette[1])
	var accent := _mat("accent", palette[2], 0.15, 0.4)
	var skin := _mat("skin", Color("bb7955"))
	var hair := _mat("hair", Color("342d35"))
	var white := _mat("white", Color("fff4dc"))
	var dark := _mat("dark", Color("253244"), 0.1, 0.42)
	var glass := _mat("visor", Color("174e67"), 0.6, 0.16)
	var gold := _mat("gold", Color("ffcd65"), 0.6, 0.3)
	if neon:
		accent.emission_enabled = true
		accent.emission = Color("39c7bd")
		accent.emission_energy_multiplier = 0.45
	_motion = _pivot(self, Vector3.ZERO, "BodyMotion")
	_torso = _pivot(_motion, Vector3(0, 1.22, 0), "Torso")
	_capsule(_torso, 0.28, 0.73, Vector3(0, 0.15, 0), shirt, 0.76)
	# Hoodie hem, seams and pocket define the silhouette even on a small screen.
	_capsule(_torso, 0.265, 0.28, Vector3(0, -0.13, 0), trousers, 0.79)
	_box(_torso, Vector3(0.48, 0.065, 0.35), Vector3(0, -0.12, 0), accent)
	for side in [-1, 1]:
		_box(_torso, Vector3(0.032, 0.45, 0.032), Vector3(side * 0.16, 0.20, -0.20), white)
		_ball(_torso, Vector3(0.055, 0.055, 0.055), Vector3(side * 0.16, -0.025, -0.20), gold)
	_capsule(_torso, 0.18, 0.36, Vector3(0, 0.22, 0.22), shirt, 0.65)
	# Backpack is on the camera-facing back, with contrasting straps and a stitched badge.
	_capsule(_torso, 0.22, 0.55, Vector3(0, 0.15, 0.29), accent, 0.58)
	_capsule(_torso, 0.17, 0.24, Vector3(0, 0.035, 0.40), shirt, 0.46)
	_box(_torso, Vector3(0.18, 0.12, 0.03), Vector3(0, 0.26, 0.43), white)
	_box(_torso, Vector3(0.08, 0.035, 0.035), Vector3(0, 0.26, 0.45), accent)
	for side in [-1, 1]:
		_box(_torso, Vector3(0.055, 0.5, 0.05), Vector3(side * 0.22, 0.18, 0.20), trousers)
		_box(_torso, Vector3(0.065, 0.09, 0.055), Vector3(side * 0.22, -0.005, 0.22), gold)
	_head = _pivot(_torso, Vector3(0, 0.72, -0.015), "Head")
	_capsule(_head, 0.11, 0.20, Vector3(0, -0.23, 0), skin)
	if robot:
		_capsule(_head, 0.26, 0.49, Vector3.ZERO, shirt, 0.85)
		_box(_head, Vector3(0.42, 0.18, 0.10), Vector3(0, 0, -0.22), glass)
		for side in [-1, 1]:
			_ball(_head, Vector3(0.08, 0.08, 0.06), Vector3(side * 0.11, 0.015, -0.28), gold)
		_capsule(_head, 0.025, 0.20, Vector3(0, 0.32, 0), dark)
		_ball(_head, Vector3(0.09, 0.09, 0.09), Vector3(0, 0.44, 0), accent)
	elif space:
		_ball(_head, Vector3(0.69, 0.69, 0.62), Vector3(0, 0, 0), white)
		_ball(_head, Vector3(0.58, 0.47, 0.24), Vector3(0, -0.02, -0.26), glass)
		_box(_head, Vector3(0.25, 0.035, 0.025), Vector3(-0.08, 0.12, -0.38), white)
		for side in [-1, 1]:
			_ball(_head, Vector3(0.12, 0.19, 0.23), Vector3(side * 0.33, 0, 0), accent)
	else:
		_ball(_head, Vector3(0.48, 0.56, 0.46), Vector3.ZERO, skin)
		_ball(_head, Vector3(0.51, 0.35, 0.48), Vector3(0, 0.16, 0.04), hair)
		for side in [-1, 1]:
			_ball(_head, Vector3(0.10, 0.15, 0.10), Vector3(side * 0.245, -0.015, 0), skin)
			_ball(_head, Vector3(0.055, 0.06, 0.025), Vector3(side * 0.11, 0.01, -0.217), dark)
		_ball(_head, Vector3(0.07, 0.09, 0.08), Vector3(0, -0.055, -0.25), skin)
		# Backwards cap reads from the follow camera; brim and stitched panels are separate.
		_ball(_head, Vector3(0.55, 0.31, 0.53), Vector3(0, 0.23, 0.01), accent)
		_cap_brim(_head, accent)
		_box(_head, Vector3(0.15, 0.07, 0.025), Vector3(0, 0.18, 0.273), white)
	for i in 2:
		var side := -1.0 if i == 0 else 1.0
		var arm := _pivot(_torso, Vector3(side * 0.34, 0.40, 0), "Arm%d" % i)
		_arms.append(arm)
		_capsule(arm, 0.12, 0.36, Vector3(0, -0.14, 0), shirt)
		var elbow := _pivot(arm, Vector3(0, -0.30, 0), "Elbow")
		_elbows.append(elbow)
		_capsule(elbow, 0.093, 0.30, Vector3(0, -0.13, 0), trousers if robot or space else skin)
		_box(elbow, Vector3(0.19, 0.07, 0.17), Vector3(0, -0.22, 0), accent)
		_ball(elbow, Vector3(0.18, 0.20, 0.17), Vector3(0, -0.32, -0.01), white if space else skin)
		var leg := _pivot(_motion, Vector3(side * 0.17, 0.94, 0), "Leg%d" % i)
		_legs.append(leg)
		_capsule(leg, 0.135, 0.48, Vector3(0, -0.18, 0), trousers)
		_box(leg, Vector3(0.035, 0.35, 0.12), Vector3(side * 0.125, -0.18, 0), accent)
		var knee := _pivot(leg, Vector3(0, -0.40, 0), "Knee")
		_knees.append(knee)
		_capsule(knee, 0.11, 0.41, Vector3(0, -0.15, 0), trousers)
		_capsule(knee, 0.115, 0.15, Vector3(0, -0.30, 0), white)
		var foot := _pivot(knee, Vector3(0, -0.34, 0), "Sneaker")
		_feet.append(foot)
		_capsule(foot, 0.14, 0.33, Vector3(0, -0.025, -0.07), accent, 1.35).rotation.z = PI * 0.5
		_box(foot, Vector3(0.28, 0.07, 0.42), Vector3(0, -0.105, -0.08), white)
		for lace in 3:
			_box(foot, Vector3(0.19, 0.022, 0.026), Vector3(0, 0.075 - lace * 0.012, -0.07 - lace * 0.055), white)
	# Soft contact shadow complements the directional shadow without expensive postprocessing.
	var shadow_mat := StandardMaterial3D.new()
	shadow_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	shadow_mat.albedo_color = Color(0.12, 0.18, 0.23, 0.20)
	shadow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	shadow_mat.disable_receive_shadows = true
	var shadow_mesh := CylinderMesh.new()
	shadow_mesh.top_radius = 0.55
	shadow_mesh.bottom_radius = 0.55
	shadow_mesh.height = 0.005
	shadow_mesh.radial_segments = 24
	_shadow = _mesh(self, shadow_mesh, shadow_mat, Vector3(0, 0.018, 0))
	_shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_shadow.scale.z = 0.72
	var ring_mesh := TorusMesh.new()
	ring_mesh.inner_radius = 0.63
	ring_mesh.outer_radius = 0.69
	ring_mesh.rings = 28
	ring_mesh.ring_segments = 6
	var shield_mat := _mat("shield", Color("66e2d0"), 0.2, 0.25)
	shield_mat.emission_enabled = true
	shield_mat.emission = Color("40b7c3")
	shield_mat.emission_energy_multiplier = 0.7
	_shield = _mesh(self, ring_mesh, shield_mat, Vector3(0, 1.05, 0))
	_shield.rotation.z = 0.2
	_shield.visible = false

func _cap_brim(parent: Node3D, mat: Material) -> void:
	var brim := _capsule(parent, 0.07, 0.40, Vector3(0, 0.19, 0.30), mat, 1.8)
	brim.rotation.z = PI * 0.5
