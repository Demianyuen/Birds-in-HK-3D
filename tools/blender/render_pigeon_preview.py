import os

import bpy
from mathutils import Vector


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUTPUT_PATH = os.path.join(PROJECT_ROOT, 'production', 'playtests', 'pigeon-preview.png')


def point_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def add_preview_scene():
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.66))
    ground = bpy.context.object
    ground.name = 'Preview Ground'
    material = bpy.data.materials.new('Preview Ground Material')
    material.diffuse_color = (0.08, 0.11, 0.12, 1)
    material.use_nodes = True
    principled = material.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (0.08, 0.11, 0.12, 1)
    principled.inputs['Roughness'].default_value = 0.8
    ground.data.materials.append(material)

    bpy.ops.object.light_add(type='AREA', location=(-3.5, -4.5, 5.2))
    key = bpy.context.object
    key.name = 'Key Light'
    key.data.energy = 900
    key.data.shape = 'DISK'
    key.data.size = 4.5
    point_at(key, (0, 0, 0))

    bpy.ops.object.light_add(type='AREA', location=(4.0, 1.5, 2.8))
    fill = bpy.context.object
    fill.name = 'Fill Light'
    fill.data.energy = 560
    fill.data.size = 3.0
    point_at(fill, (0, 0, 0.1))

    bpy.ops.object.light_add(type='AREA', location=(0, 4.5, 4.0))
    rim = bpy.context.object
    rim.name = 'Rim Light'
    rim.data.energy = 780
    rim.data.size = 2.5
    point_at(rim, (0, 0.2, 0.2))

    bpy.ops.object.camera_add(location=(4.2, -5.5, 3.0))
    camera = bpy.context.object
    camera.name = 'Preview Camera'
    camera.data.lens = 62
    point_at(camera, (0, -0.05, 0.1))
    bpy.context.scene.camera = camera

    world = bpy.context.scene.world
    world.color = (0.035, 0.055, 0.07)
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.035, 0.055, 0.07, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.42


def render():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = OUTPUT_PATH
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    bpy.ops.render.render(write_still=True)
    print(f'Wrote {OUTPUT_PATH}')


if __name__ == '__main__':
    add_preview_scene()
    render()
