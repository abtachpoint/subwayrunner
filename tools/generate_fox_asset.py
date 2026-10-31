"""Deterministic offline source of the original, rigged low-poly fox model."""
from pathlib import Path
import math, json, base64, struct
root=Path(__file__).resolve().parent.parent
skeleton=[('BodyMotion',-1,[0,0,0]),('Torso',0,[0,1.22,0]),('Head',1,[0,.72,-.015]),('Arm0',1,[-.34,.4,0]),('Elbow',3,[0,-.3,0]),('Leg0',0,[-.17,.94,0]),('Knee',5,[0,-.4,0]),('Sneaker',6,[0,-.34,0]),('Arm1',1,[.34,.4,0]),('Elbow',8,[0,-.3,0]),('Leg1',0,[.17,.94,0]),('Knee',10,[0,-.4,0]),('Sneaker',11,[0,-.34,0])]
orange=(243,119,53);fur=(255,148,67);white=(246,238,220);cream=(252,217,169);eyes=(32,29,34);nose=(44,29,30);green=(56,163,132);paws=(56,68,73)
meshes=[bytearray() for _ in skeleton]
def append(i,p,n,c,shininess=110):
 p=[max(-32768,min(32767,round(v*128))) for v in p]
 length=math.sqrt(sum(v*v for v in n)) or 1
 nn=[max(-32767,min(32767,round(v/length*32767))) for v in n]
 meshes[i].extend(struct.pack('<hhhhhhBBBB',*p,*nn,*c,shininess))
def ball(i,c,r,col,lats=9,lons=13):
 def sphere(t,u):
  return (math.sin(t)*math.cos(u),math.cos(t),math.sin(t)*math.sin(u))
 def point(t,u):
  n=sphere(t,u)
  return ([c[j]+n[j]*r[j] for j in range(3)],[n[j]/r[j] for j in range(3)])
 for a in range(lats):
  th0=math.pi*a/lats;th1=math.pi*(a+1)/lats
  for b in range(lons):
   ph0=2*math.pi*b/lons;ph1=2*math.pi*(b+1)/lons
   v00=point(th0,ph0);v10=point(th1,ph0);v01=point(th0,ph1);v11=point(th1,ph1)
   for v in [v00,v10,v11,v00,v11,v01]:append(i,*v,col)
def triangles(i,points,col):
 for a,b,c in points:
  u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
  n=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
  for p in [a,b,c]:append(i,p,n,col)
def ear(i,x):
 # 3D pointed cartoon fox ears, orange outside, blush inside front.
 peak=(x*1.12,.66,.05);rear1=(x-.125,.25,-.17);rear2=(x+.125,.25,-.17);front1=(x-.12,.26,.18);front2=(x+.12,.26,.18)
 triangles(i,[(front1,front2,peak),(front1,peak,rear1),(rear2,peak,front2),(front1,rear1,rear2),(front1,rear2,front2)],fur)
 triangles(i,[((x-.064,.33,.188),(x+.064,.33,.188),(x*1.12,.55,.09))],cream)
ball(1,(0,.06,-.02),(.34,.50,.25),orange)
ball(1,(0,-.07,.23),(.255,.34,.065),white)
ball(1,(0,.4,.0),(.29,.12,.29),green)
# Bushy tail visible behind the fox during running and in preview.
ball(1,(0,-.02,-.42),(.21,.23,.43),fur,8,11)
ball(1,(0,-.10,-.74),(.20,.19,.19),cream,7,11)
ball(2,(0,.075,0),(.35,.33,.31),fur,10,14)
ear(2,-.23);ear(2,.23)
ball(2,(0,-.05,.295),(.245,.15,.13),white)
ball(2,(-.16,.095,.282),(.07,.084,.052),white,7,9)
ball(2,(.16,.095,.282),(.07,.084,.052),white,7,9)
ball(2,(-.155,.09,.326),(.039,.055,.03),eyes,7,9)
ball(2,(.155,.09,.326),(.039,.055,.03),eyes,7,9)
ball(2,(0,-.075,.405),(.08,.052,.059),nose,7,9)
for i in [3,8]:
 ball(i,(0,-.13,0),(.145,.25,.145),orange)
for i in [4,9]:
 ball(i,(0,-.20,0),(.115,.24,.12),fur)
 ball(i,(0,-.39,.06),(.125,.07,.15),white)
for i in [5,10]:
 ball(i,(0,-.19,0),(.165,.30,.19),orange)
for i in [6,11]:
 ball(i,(0,-.20,0),(.12,.25,.15),fur)
for i in [7,12]:
 ball(i,(0,-.075,.09),(.18,.12,.25),paws)
 ball(i,(0,-.02,.20),(.15,.06,.09),cream)
fox={'bones':[]}
for i,(name,parent,pos) in enumerate(skeleton):
 data=base64.b64encode(meshes[i]).decode('ascii')
 fox['bones'].append({'name':name,'parent':parent,'p':pos,'r':[0,0,0],'s':[1,1,1],'mesh':{'count':len(meshes[i])//16,'data':data}})
output='/* Original rigged fox character, offline-baked for existing 16-byte WebGL meshes. */\n(function(){if(!window.RUNNER_MODELS||!window.RUNNER_MODELS.characters)return;window.RUNNER_MODELS.characters.fox='+json.dumps(fox,separators=(',',':'))+';})();\n'
(root/'web/assets/fox.js').write_text(output)
print('fox asset',sum(len(b)//16 for b in meshes),'vertices',len(output),'bytes')
