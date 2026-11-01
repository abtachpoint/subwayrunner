#!/usr/bin/env python3
"""Procedurally synthesize original CC0-style arcade audio for Subway Runner.
All motifs are original; no sampled/copyrighted game audio is included.
Requires numpy and ffmpeg only during generation, not at runtime.
"""
from pathlib import Path
import numpy as np, wave, subprocess, math, tempfile
rng=np.random.default_rng(20261101)
out=Path(__file__).resolve().parents[1]/'web/audio';out.mkdir(parents=True,exist_ok=True)
SR=22050

def osc(n,f,typ='sine'):
 t=np.arange(n)/SR;ph=2*np.pi*np.cumsum(np.asarray(f) if not np.isscalar(f) else np.full(n,f))/SR
 if typ=='tri':return 2/np.pi*np.arcsin(np.sin(ph))
 if typ=='square':return np.tanh(3*np.sin(ph))
 if typ=='saw':return 2*(ph/(2*np.pi)%1)-1
 return np.sin(ph)
def sound(name,a):
 a=np.asarray(a,float)
 if len(a)<SR//4:a=np.pad(a,(0,SR//4-len(a)))
 a=np.clip(a,-1,1)
 pcm=np.int16(a*26000)
 tmp=out/(name+'.wav')
 with wave.open(str(tmp),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes(pcm.tobytes())
 subprocess.run(['ffmpeg','-hide_banner','-nostats','-loglevel','error','-y','-i',str(tmp),'-c:a','libvorbis','-q:a','3',str(out/(name+'.ogg'))],check=True)
 tmp.unlink()
def blip(name,length,f0,f1,shape='sine',vol=.4,noise=0):
 n=int(SR*length);t=np.arange(n)/SR;frequencies=np.linspace(f0,f1,n);env=np.sin(np.pi*np.maximum(0,np.minimum(1,t/length)))**1.4
 a=vol*osc(n,frequencies,shape)*env
 if noise:a+=rng.normal(0,noise,n)*env
 sound(name,a)
for name,L,f0,f1,typ,vol,noise in [
 ('coin',.17,720,1280,'tri',.5,0),('diamond',.3,860,1710,'sine',.48,0),('jump',.25,230,580,'sine',.32,.018),('land',.16,190,74,'tri',.25,.05),
 ('slide',.38,630,95,'saw',.22,.035),('roll',.22,300,85,'tri',.19,.06),('crash',.55,260,38,'saw',.43,.12),('reward',.52,410,1200,'tri',.38,0),
 ('shield',.4,240,900,'tri',.28,.018),('button',.11,380,590,'sine',.26,0),('horn',.9,210,165,'saw',.16,.03),('powerup',.48,490,1100,'tri',.33,0)]:
 blip(name,L,f0,f1,typ,vol,noise)

def loop(name,bpm,melody,bass):
 beats=32;dur=beats*60/bpm;n=int(dur*SR);audio=np.zeros(n,float);beat=60/bpm
 for k,pitch in enumerate(melody):
  start=int(k*beat*.5*SR);length=int(.44*beat*SR);end=min(n,start+length)
  if end<=start:continue
  v=np.arange(end-start)/SR;env=np.exp(-v*7)*(1-np.exp(-v*45));freq=440*2**((pitch-69)/12)
  audio[start:end]+=.21*osc(len(v),freq,'tri')*env+.07*osc(len(v),freq*2,'sine')*env
 for k in range(beats):
  start=int(k*beat*SR);size=min(int(.23*SR),n-start);t=np.arange(size)/SR
  bassfreq=440*2**((bass[(k//4)%len(bass)]-69)/12)
  audio[start:start+size]+=.18*osc(size,bassfreq,'sine')*np.exp(-t*13)
  audio[start:start+size]+=.24*osc(size,60*np.exp(-t*18)+45,'sine')*np.exp(-t*25)
  if k%2==1:
   w=np.minimum(size,int(.15*SR));tt=np.arange(w)/SR
   audio[start:start+w]+=.08*rng.normal(size=w)*np.exp(-tt*26)
  half=int((k+.5)*beat*SR);w=min(int(.09*SR),n-half)
  if w>0:audio[half:half+w]+=.045*rng.normal(size=w)*np.exp(-np.arange(w)/SR*45)
 audio=np.tanh(audio*1.7)*.77
 fade=int(.08*SR);audio[:fade]*=np.linspace(0,1,fade)
 audio[-fade:]*=np.linspace(1,0,fade)
 sound(name,audio)
# Original arcade melodies in E minor / A Dorian; no source-game melodies sampled.
loop('arcade_menu',128,[64,67,71,74,71,67,64,0, 62,66,69,73,69,66,62,0]*4,[40,43,45,47,40,43,45,38])
loop('arcade_run',152,[76,76,79,83,81,79,76,72,74,77,81,84,81,77,74,71]*4,[40,47,45,43,40,47,38,43])
print('Audio files:',[(p.name,p.stat().st_size) for p in out.iterdir()])
