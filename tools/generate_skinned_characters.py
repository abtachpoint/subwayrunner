#!/usr/bin/env python3
"""Bake Quaternius CC0 skeletal action tracks and base human meshes for Subway Runner.

Outputs WebGL1/Canvas friendly, self-contained offline JS data. This preserves
an actual skinned humanoid mesh with vertex colors derived from CC0 textures.
The runtime skins only the selected actor; no network or JS libraries required.
"""
import base64, json, math, os, struct
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'asset_sources/quaternius'
DST=ROOT/'web/assets/skinned_characters.js'
COMPONENT={5120:np.dtype('i1'),5121:np.dtype('u1'),5122:np.dtype('<i2'),5123:np.dtype('<u2'),5125:np.dtype('<u4'),5126:np.dtype('<f4')}
COMPONENT_SIZE={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

class GLTF:
 def __init__(self,path):
  self.base=path.parent
  if path.suffix=='.gltf':
   self.doc=json.loads(path.read_text());self.blobs=[(path.parent/b['uri']).read_bytes() for b in self.doc['buffers']]
  else:
   data=path.read_bytes();assert data[:4]==b'glTF'
   offset=12; chunks=[]
   while offset<len(data):
    length,typ=struct.unpack_from('<II',data,offset);offset+=8;chunks.append((typ,data[offset:offset+length]));offset+=length
   self.doc=json.loads(next(c for t,c in chunks if t==0x4e4f534a));self.blobs=[next(c for t,c in chunks if t==0x004e4942)]
 def array(self,idx):
  a=self.doc['accessors'][idx];v=self.doc['bufferViews'][a['bufferView']];dt=COMPONENT[a['componentType']];stride=v.get('byteStride')
  offset=v.get('byteOffset',0)+a.get('byteOffset',0);count=a['count'];size=COMPONENT_SIZE[a['type']]
  if not stride or stride==size*dt.itemsize:
   res=np.frombuffer(self.blobs[v['buffer']],dtype=dt,count=count*size,offset=offset).reshape(count,size).copy()
  else:
   res=np.ndarray((count,size),dtype=dt,buffer=self.blobs[v['buffer']],offset=offset,strides=(stride,dt.itemsize)).copy()
  if a.get('normalized'):
   if np.issubdtype(dt,np.unsignedinteger):res=res.astype(np.float32)/np.iinfo(dt).max
   elif np.issubdtype(dt,np.signedinteger):res=np.maximum(-1,res.astype(np.float32)/np.iinfo(dt).max)
  return res

def packed(arr):return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()

def quat_matrix(q):
 x,y,z,w=[float(t) for t in q];n=x*x+y*y+z*z+w*w
 if n>0:x,y,z,w=[v/math.sqrt(n) for v in (x,y,z,w)]
 return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                  [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                  [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]],dtype=np.float64)

def trs(t,r,s):
 m=np.eye(4);m[:3,:3]=quat_matrix(r)*np.asarray(s);m[:3,3]=t;return m

def bind_nodes(doc, overrides=None):
 nodes=doc['nodes'];parents=[-1]*len(nodes)
 for i,node in enumerate(nodes):
  for c in node.get('children',[]):parents[c]=i
 cache={}
 def world(i):
  if i in cache:return cache[i]
  node=nodes[i];t=node.get('translation',[0,0,0]);r=node.get('rotation',[0,0,0,1]);s=node.get('scale',[1,1,1])
  if overrides and i in overrides:t,r,s=overrides[i]
  local=np.array(node['matrix']).reshape(4,4).T if 'matrix' in node and not overrides else trs(t,r,s)
  m=world(parents[i])@local if parents[i]!=-1 else local
  cache[i]=m;return m
 return world

def get_texture(gl,mat):
 mats=gl.doc.get('materials',[]);pbr=mats[mat].get('pbrMetallicRoughness',{}) if 0<=mat<len(mats) else {}
 tx=pbr.get('baseColorTexture',{}).get('index');factor=np.array(pbr.get('baseColorFactor',[1,1,1,1]),dtype=np.float32)
 if tx is None:return None,factor
 ti=gl.doc['textures'][tx]['source'];im=gl.doc['images'][ti];path=gl.base/im['uri'];return np.array(Image.open(path).convert('RGBA')),factor

def export_model(name,path):
 gl=GLTF(path);doc=gl.doc;sk=doc['skins'][0];joints=sk['joints'];world=bind_nodes(doc)
 ibm=gl.array(sk['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1).astype(np.float64)
 result=[]
 for meshdef in doc['meshes']:
  for prim in meshdef['primitives']:
   attrs=prim['attributes'];pos=gl.array(attrs['POSITION']).astype(np.float32)
   norm=gl.array(attrs['NORMAL']).astype(np.float32)
   inds=gl.array(prim['indices']).reshape(-1).astype(np.uint16)
   uv=gl.array(attrs['TEXCOORD_0']).astype(np.float32)
   joint=gl.array(attrs['JOINTS_0']).astype(np.uint8)
   weight=gl.array(attrs['WEIGHTS_0']).astype(np.float32)
   weight=weight/np.maximum(np.sum(weight,axis=1,keepdims=True),1e-7)
   # GLTF JOINTS_0 are skin joint indices, not document node indices.
   tex,factor=get_texture(gl,prim.get('material',-1))
   colors=np.tile(factor,(len(pos),1))
   if tex is not None:
    h,w=tex.shape[:2];xs=(np.mod(uv[:,0],1)*w).astype(int)%w;ys=((1-np.mod(uv[:,1],1))*h).astype(int)%h
    colors*=tex[ys,xs].astype(np.float32)/255.0
   cols=np.clip(colors*255,0,255).astype(np.uint8)
   # source geometry is centered and upright, matches engine y-up metres
   result.append({'count':len(pos),'triangles':len(inds)//3,'p':packed(pos),'n':packed(norm),'j':packed(joint),'w':packed(weight.astype(np.float32)),'c':packed(cols),'i':packed(inds)})
 return {'meshes':result,'jointNames':[doc['nodes'][x]['name'] for x in joints],'ibm':packed(ibm.astype('<f4'))}

def interpolate(times,values,t,quaternion=False):
 if len(times)==1:return values[0]
 i=max(0,min(len(times)-2,int(np.searchsorted(times,t,side='right')-1)))
 a,b=times[i],times[i+1];f=float(np.clip((t-a)/max(1e-7,b-a),0,1))
 v0,v1=values[i],values[i+1]
 if quaternion:
  dot=float(np.dot(v0,v1))
  if dot<0:v1=-v1;dot=-dot
  if dot>.9995:r=v0*(1-f)+v1*f
  else:
   theta=math.acos(np.clip(dot,-1,1));q=math.sin(theta)
   r=v0*math.sin((1-f)*theta)/q+v1*math.sin(f*theta)/q
  return r/np.linalg.norm(r)
 return v0*(1-f)+v1*f

def export_clips(ibm,joint_names):
 names={'idle':('animation-1','Idle_Loop'),'run':('animation-1','Sprint_Loop'),
        'jog':('animation-1','Jog_Fwd_Loop'),'jump':('animation-1','Jump_Loop'),
        'jump_start':('animation-1','Jump_Start'),'jump_land':('animation-1','Jump_Land'),
        'slide':('animation-2','Slide_Loop'),'slide_start':('animation-2','Slide_Start'),
        'slide_exit':('animation-2','Slide_Exit'),'roll':('animation-1','Roll'),
        'crouch':('animation-1','Crouch_Fwd_Loop'),'crash':('animation-1','Death01')}
 out={}
 for alias,(folder,name) in names.items():
  gl=GLTF(SRC/folder/('UAL2_Standard.glb' if folder=='animation-2' else 'UAL1_Standard.glb'))
  anim=next(a for a in gl.doc['animations'] if a.get('name')==name)
  tracks={};length=0.
  for channel in anim['channels']:
   node=channel['target']['node'];key=channel['target']['path'];sm=anim['samplers'][channel['sampler']]
   if key not in ('translation','rotation','scale'):continue
   times=gl.array(sm['input']).reshape(-1);values=gl.array(sm['output']);length=max(length,float(times[-1]));tracks[(node,key)]=(times,values)
  fps=20;frames=max(2,int(math.ceil(length*fps))+1)
  skin_matrices=np.empty((frames,len(joint_names),16),dtype='<f4')
  nodes=gl.doc['nodes'];index_by_name={n.get('name'):i for i,n in enumerate(nodes)}
  for fi in range(frames):
   t=min(length,fi/fps)
   transforms={}
   for i,node in enumerate(nodes):
    if node.get('name') not in joint_names:continue
    values=[]
    for key,default in [('translation',[0,0,0]),('rotation',[0,0,0,1]),('scale',[1,1,1])]:
     x=tracks.get((i,key));values.append(interpolate(*x,t,quaternion=key=='rotation') if x else np.array(node.get(key,default)))
    transforms[i]=values
   world=bind_nodes(gl.doc,transforms)
   for j,n in enumerate(joint_names):
    k=index_by_name[n];skin_matrices[fi,j]=np.asarray(world(k)@ibm[j],dtype='<f4').T.reshape(16)
  out[alias]={'fps':fps,'length':round(length,4),'frames':frames,'matrices':packed(skin_matrices)}
  print('clip',alias,frames,round(length,2))
 return out

def main():
 male=export_model('male',SRC/'universal-base/Superhero_Male_FullBody.gltf')
 female=export_model('female',SRC/'universal-base/Superhero_Female_FullBody.gltf')
 joint_names=male['jointNames'];assert joint_names==female['jointNames']
 ibm=np.frombuffer(base64.b64decode(male['ibm']),dtype='<f4').reshape(-1,4,4).astype(np.float64)
 clips=export_clips(ibm,joint_names)
 models={'male':{'meshes':male['meshes']},'female':{'meshes':female['meshes']}}
 data={'version':1,'jointCount':len(joint_names),'models':models,'clips':clips,'license':'Quaternius CC0'}
 DST.write_text('/* Quaternius CC0 rigged humanoids & sampled skeletal animation, fully offline. */\nwindow.RUNNER_SKIN_ASSETS='+json.dumps(data,separators=(',',':'))+';\n')
 print('wrote',DST,DST.stat().st_size,'bytes')

if __name__=='__main__':main()
