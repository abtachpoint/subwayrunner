"""CPU render of exported game geometry. This is NOT an engine screenshot.

Usage: blender -b --factory-startup --python tools/render_preview.py -- scene.glb preview.png
"""
import math
import sys
from pathlib import Path

import bpy


def render():
    args = sys.argv[sys.argv.index("--") + 1 :]
    scene_path, output_path = map(Path, args[:2])
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(scene_path))
    scene = bpy.context.scene
    camera = next(obj for obj in scene.objects if obj.type == "CAMERA")
    scene.camera = camera
    scene.render.resolution_x = 450
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 2
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output_path)
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("Warm city ambient")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.60, 0.77, 0.88, 1.0)
    background.inputs["Strength"].default_value = 0.55
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.data.energy = 2.1 if obj.data.type == "SUN" else obj.data.energy
            if obj.data.type == "SUN":
                obj.data.angle = math.radians(7.0)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.35
    scene.view_settings.gamma = 1.0
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path.with_suffix(".blend")))
    bpy.ops.render.render(write_still=True)
    print("OFFLINE_GEOMETRY_PREVIEW", output_path)


render()
