/* Offline Quaternius CC0 humanoid skeletal playback on WebGL1.
 * Real skinned meshes and original sampled motion matrices; no remote loader.
 * Each active player's deformed VBO is reused, not recreated each frame.
 */
(function(global){
'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const decode=(value,Type)=>{
  const bin=global.atob(value),raw=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)raw[i]=bin.charCodeAt(i);
  return new Type(raw.buffer);
};
class OfflineSkinPlayer{
  constructor(gl,assets){
    this.gl=gl;this.asset=assets;this.meshes={};this.lastAnimation='';this.elapsed=0;
    this.pose=new Float32Array(assets.jointCount*16);
    this.clips={};
    for(const [name,clip] of Object.entries(assets.clips)){
      this.clips[name]={...clip,data:decode(clip.matrices,Float32Array)};
    }
    for(const [key,model] of Object.entries(assets.models))this.meshes[key]=model.meshes.map(m=>this._makeMesh(m));
  }
  _makeMesh(src){
    const gl=this.gl;
    const mesh={count:src.count,triangles:src.triangles,
      p:decode(src.p,Float32Array),n:decode(src.n,Float32Array),
      joints:decode(src.j,Uint8Array),weights:decode(src.w,Float32Array),
      colors:decode(src.c,Uint8Array),indices:decode(src.i,Uint16Array),
      buffer:gl.createBuffer(),element:gl.createBuffer(),bytes:new Uint8Array(src.count*16)};
    const v=mesh.view=new Int16Array(mesh.bytes.buffer);
    for(let i=0;i<src.count;i++){
      const k=i*16;mesh.bytes[k+12]=mesh.colors[i*4];mesh.bytes[k+13]=mesh.colors[i*4+1];
      mesh.bytes[k+14]=mesh.colors[i*4+2];mesh.bytes[k+15]=35;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.bytes.byteLength,gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.element);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
    return mesh;
  }
  _sample(clip,seconds){
    const c=this.clips[clip]||this.clips.idle;
    const duration=Math.max(.05,c.length);
    const time=seconds%duration;
    const pos=Math.min(c.frames-1,time*c.fps),i=Math.floor(pos),j=Math.min(c.frames-1,i+1),blend=pos-i;
    const stride=this.pose.length,low=i*stride,high=j*stride;
    if(blend<.001){this.pose.set(c.data.subarray(low,low+stride));return;}
    for(let k=0;k<stride;k++)this.pose[k]=c.data[low+k]*(1-blend)+c.data[high+k]*blend;
  }
  advance(dt,clip){
    if(clip!==this.lastAnimation){this.lastAnimation=clip;this.elapsed=0;}
    else this.elapsed+=clamp(dt,0,.075);
    this._sample(clip,this.elapsed);
  }
  draw(meshes,bind,draw){
    const gl=this.gl,matrix=this.pose;
    for(const mesh of meshes){
      const {p,n,joints:j,weights:w,count,view:v,bytes}=mesh;
      for(let k=0;k<count;k++){
        const ix=k*3,iw=k*4,px=p[ix],py=p[ix+1],pz=p[ix+2],nx=n[ix],ny=n[ix+1],nz=n[ix+2];
        let x=0,y=0,z=0,normalX=0,normalY=0,normalZ=0;
        for(let b=0;b<4;b++){
          const weight=w[iw+b];if(weight<=.000001)continue;
          const o=j[iw+b]*16;
          if(o+15>=matrix.length)continue;
          x+=weight*(matrix[o]*px+matrix[o+4]*py+matrix[o+8]*pz+matrix[o+12]);
          y+=weight*(matrix[o+1]*px+matrix[o+5]*py+matrix[o+9]*pz+matrix[o+13]);
          z+=weight*(matrix[o+2]*px+matrix[o+6]*py+matrix[o+10]*pz+matrix[o+14]);
          normalX+=weight*(matrix[o]*nx+matrix[o+4]*ny+matrix[o+8]*nz);
          normalY+=weight*(matrix[o+1]*nx+matrix[o+5]*ny+matrix[o+9]*nz);
          normalZ+=weight*(matrix[o+2]*nx+matrix[o+6]*ny+matrix[o+10]*nz);
        }
        const mag=Math.hypot(normalX,normalY,normalZ)||1,off=k*8;
        v[off]=clamp(Math.round(x*128),-32767,32767);
        v[off+1]=clamp(Math.round(y*128),-32767,32767);
        v[off+2]=clamp(Math.round(z*128),-32767,32767);
        v[off+3]=clamp(Math.round(normalX/mag*32767),-32767,32767);
        v[off+4]=clamp(Math.round(normalY/mag*32767),-32767,32767);
        v[off+5]=clamp(Math.round(normalZ/mag*32767),-32767,32767);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,bytes);
      bind(mesh);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.element);
      draw(mesh);
    }
  }
}
// For logic tests only, the production skin assets are deliberately not loaded by Node.
global.OfflineSkinPlayer=OfflineSkinPlayer;
})(typeof window!=='undefined'?window:globalThis);
