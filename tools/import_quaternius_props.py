#!/usr/bin/env python3
"""Bake CC0 Quaternius Robot/Farm Animal OBJ static scenery meshes.
These are environmental cameo models; original FBX rigs are packaged separately.
"""
import base64, io, json, math, struct, sys, zipfile, tempfile
from pathlib import Path
import numpy as np
import trimesh
ROOT=Path(__file__).resolve().parents[1];downloads=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT
pack=struct.Struct('<3h3h4B')
props={};names=[]
colors={'Black':(40,48,65),'Grey':(172,180,194),'White':(236,235,224),'Pink':(242,156,179),'Brown':(150,105,73),'Blue':(68,166,219),'Green':(114,184,97),'Red':(221,89,87),'Yellow':(246,199,76),'Orange':(239,154,86),'Material.006':(203,153,109),'Material.003':(133,93,73)}
for archive in ['Animated Robot by Quaternius.zip','Farm Animals Animated  by Quaternius.zip']:
 with zipfile.ZipFile(downloads/archive) as z,tempfile.TemporaryDirectory() as d:
  wanted=[x for x in z.namelist() if x.endswith('.obj')]
  for f in z.namelist():
   if f.endswith(('.obj','.mtl')):z.extract(f,d)
  for name in wanted:
   s=trimesh.load(Path(d)/name,file_type='obj',force='scene')
   raw=bytearray();bounds=s.bounds;all_tri=0
   for node in s.graph.nodes_geometry:
    matrix,geom_name=s.graph.get(node);mesh=s.geometry[geom_name]
    xyz=trimesh.transform_points(mesh.vertices,matrix).astype('float32')
    faces=mesh.faces
    if len(faces)>5000:faces=faces[::math.ceil(len(faces)/5000)]
    verts=xyz[faces].reshape(-1,3)
    norms=mesh.vertex_normals[faces].reshape(-1,3)
    norms=norms@np.linalg.inv(matrix[:3,:3]).T
    norms/=np.maximum(1e-6,np.linalg.norm(norms,axis=1,keepdims=True))
    color=colors.get(geom_name,(196,139,109))
    pos=np.clip(np.round(verts*128),-32767,32767).astype('int16')
    norm=np.clip(np.round(norms*32767),-32767,32767).astype('int16')
    for p,n in zip(pos,norm):raw+=pack.pack(*p,*n,*color,35)
    all_tri+=len(faces)
   if not raw:continue
   key=Path(name).stem.lower();props[key]={'count':len(raw)//16,'data':base64.b64encode(raw).decode(),'bounds':np.asarray(bounds).round(2).tolist()};names.append(key)
(ROOT/'web/assets/quaternius_props.js').write_text('/* Original Quaternius CC0 robot/animal geometry, environmental cameo props */\nwindow.QUATERNIUS_PROPS='+json.dumps({'version':1,'keys':names,'models':props},separators=(',',':'))+';\n')
print('Quaternius props:',names)
