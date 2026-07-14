import math
import os

import bpy
from mathutils import Vector


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GLB_PATH = os.path.join(PROJECT_ROOT, 'public', 'models', 'pigeon.glb')
BLEND_PATH = os.path.join(PROJECT_ROOT, 'assets', 'blender', 'pigeon.blend')


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def material(name, color, roughness=0.65, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (*color, 1.0)
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Metallic'].default_value = metallic
    return mat


def smooth_mesh(obj):
    if obj.type != 'MESH':
        return
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def uv_sphere(name, location, scale, mat, parent, segments=28, rings=18):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    smooth_mesh(obj)
    return obj


def cone(name, location, radius, depth, rotation, mat, parent):
    bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=radius, radius2=0.025, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    smooth_mesh(obj)
    return obj


def cylinder(name, location, radius, depth, rotation, mat, parent):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    obj.parent = parent
    smooth_mesh(obj)
    return obj


def wing_surface(name, side, parent, mat):
    direction = -1 if side == 'L' else 1
    points = [
        (0.0, -0.28, 0.03),
        (0.42 * direction, -0.35, 0.07),
        (1.08 * direction, -0.04, 0.02),
        (1.52 * direction, 0.48, -0.06),
        (1.34 * direction, 0.95, -0.12),
        (0.72 * direction, 0.72, -0.04),
        (0.12 * direction, 0.36, 0.04),
    ]
    mesh = bpy.data.meshes.new(f'{name}.Mesh')
    mesh.from_pydata(points, [], [list(range(len(points)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    solidify = obj.modifiers.new('Feather thickness', 'SOLIDIFY')
    solidify.thickness = 0.055
    bevel = obj.modifiers.new('Soft feather edge', 'BEVEL')
    bevel.width = 0.035
    bevel.segments = 2
    return obj


def add_wing(side, root, feather_materials):
    direction = -1 if side == 'L' else 1
    pivot = bpy.data.objects.new(f'Wing.{side}', None)
    bpy.context.collection.objects.link(pivot)
    pivot.empty_display_type = 'PLAIN_AXES'
    pivot.location = (0.38 * direction, -0.03, 0.1)
    pivot.parent = root
    wing_surface(f'WingSurface.{side}', side, pivot, feather_materials[0])

    for index in range(7):
        feather = uv_sphere(
            f'Primary.{side}.{index + 1:02d}',
            (
                direction * (0.48 + index * 0.13),
                0.18 + index * 0.095,
                -0.04 - index * 0.012,
            ),
            (0.105, 0.48 + index * 0.018, 0.038),
            feather_materials[1 + index % (len(feather_materials) - 1)],
            pivot,
            segments=18,
            rings=10,
        )
        feather.rotation_euler.z = direction * (-0.08 + index * 0.025)
    return pivot


def add_tail(root, materials):
    for index, x in enumerate((-0.32, -0.16, 0.0, 0.16, 0.32)):
        feather = uv_sphere(
            f'TailFeather.{index + 1:02d}',
            (x, 1.02 + abs(x) * 0.18, -0.06),
            (0.13, 0.72, 0.055),
            materials[index % len(materials)],
            root,
            segments=18,
            rings=10,
        )
        feather.rotation_euler.z = -x * 0.46


def build_pigeon():
    clear_scene()
    white = material('Warm white plumage', (0.79, 0.82, 0.82), 0.82)
    breast = material('Silver breast', (0.56, 0.61, 0.62), 0.84)
    charcoal = material('Charcoal flight feathers', (0.11, 0.15, 0.17), 0.9)
    slate = material('Slate flight feathers', (0.24, 0.30, 0.32), 0.88)
    neck_green = material('Iridescent green neck', (0.05, 0.31, 0.24), 0.34, 0.28)
    neck_violet = material('Iridescent violet neck', (0.22, 0.10, 0.27), 0.32, 0.25)
    orange = material('Beak and feet', (0.78, 0.39, 0.08), 0.62)
    eye = material('Glossy black eyes', (0.006, 0.009, 0.01), 0.12, 0.08)
    eye_ring = material('Eye ring', (0.68, 0.18, 0.08), 0.48)

    root = bpy.data.objects.new('Pigeon.Root', None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = 'PLAIN_AXES'

    uv_sphere('Body', (0, 0.02, 0), (0.53, 1.02, 0.51), white, root)
    uv_sphere('Breast', (0, -0.52, 0.02), (0.48, 0.56, 0.5), breast, root)
    uv_sphere('NeckBase', (0, -0.78, 0.2), (0.36, 0.38, 0.4), neck_green, root)
    uv_sphere('NeckCollar', (0, -0.91, 0.31), (0.33, 0.28, 0.31), neck_violet, root)
    uv_sphere('Head', (0, -1.13, 0.47), (0.34, 0.38, 0.34), white, root)
    cone('Beak', (0, -1.48, 0.42), 0.105, 0.47, (math.pi / 2, 0, 0), orange, root)

    for side, x in (('L', -0.285), ('R', 0.285)):
        uv_sphere(f'EyeRing.{side}', (x, -1.24, 0.55), (0.072, 0.038, 0.072), eye_ring, root, 16, 10)
        uv_sphere(f'Eye.{side}', (x * 1.03, -1.272, 0.56), (0.042, 0.025, 0.042), eye, root, 16, 10)

    feather_materials = [slate, charcoal, slate, charcoal]
    add_wing('L', root, feather_materials)
    add_wing('R', root, feather_materials)
    add_tail(root, [charcoal, slate])

    for side, x in (('L', -0.19), ('R', 0.19)):
        cylinder(f'Leg.{side}', (x, 0.05, -0.5), 0.028, 0.2, (0, 0, 0), orange, root)
        for toe_index, toe_x in enumerate((-0.055, 0, 0.055)):
            cylinder(
                f'Toe.{side}.{toe_index + 1}',
                (x + toe_x, -0.06, -0.61),
                0.014,
                0.2,
                (math.pi / 2, 0, 0),
                orange,
                root,
            )

    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            smooth_mesh(obj)
    return root


def export_assets():
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f'Wrote {GLB_PATH}')
    print(f'Wrote {BLEND_PATH}')


if __name__ == '__main__':
    build_pigeon()
    export_assets()
