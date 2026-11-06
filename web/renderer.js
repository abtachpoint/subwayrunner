/* Native original Subway Runner geometry, rendered locally with WebGL 1.
 * No libraries, textures, network requests or runtime geometry generation.
 * Geometry buffers are immutable; scenery repeats and coins are instanced.
 */
(function(global){
  'use strict';
  const PI=Math.PI,TAU=PI*2,clamp=(x,a,b)=>Math.min(b,Math.max(a,x)),mod=(x,n)=>(x%n+n)%n;
  function identity(out){out.fill(0);out[0]=out[5]=out[10]=out[15]=1;return out;}
  function multiply(out,a,b){
    // All callers use a separate destination, except the documented temp path.
    for(let c=0;c<4;c++){const j=c*4,b0=b[j],b1=b[j+1],b2=b[j+2],b3=b[j+3];
      out[j]=a[0]*b0+a[4]*b1+a[8]*b2+a[12]*b3;
      out[j+1]=a[1]*b0+a[5]*b1+a[9]*b2+a[13]*b3;
      out[j+2]=a[2]*b0+a[6]*b1+a[10]*b2+a[14]*b3;
      out[j+3]=a[3]*b0+a[7]*b1+a[11]*b2+a[15]*b3;
    }return out;
  }
  function transform(out,x,y,z,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1){
    const a=Math.cos(rx),b=Math.sin(rx),c=Math.cos(ry),d=Math.sin(ry),e=Math.cos(rz),f=Math.sin(rz);
    // Godot's default Y-X-Z Euler order: Ry * Rx * Rz.
    out[0]=(c*e+d*b*f)*sx;out[1]=a*f*sx;out[2]=(-d*e+c*b*f)*sx;out[3]=0;
    out[4]=(-c*f+d*b*e)*sy;out[5]=a*e*sy;out[6]=(d*f+c*b*e)*sy;out[7]=0;
    out[8]=d*a*sz;out[9]=-b*sz;out[10]=c*a*sz;out[11]=0;
    out[12]=x;out[13]=y;out[14]=z;out[15]=1;return out;
  }
  function perspective(out,fov,aspect,near,far){const f=1/Math.tan(fov/2);out.fill(0);out[0]=f/aspect;out[5]=f;out[10]=(far+near)/(near-far);out[11]=-1;out[14]=2*far*near/(near-far);return out;}
  function lookAt(out,x,y,z,tx,ty,tz){
    let zx=x-tx,zy=y-ty,zz=z-tz;let l=Math.hypot(zx,zy,zz);zx/=l;zy/=l;zz/=l;
    let xx=zz,xy=0,xz=-zx;l=Math.hypot(xx,xz);xx/=l;xz/=l;
    const yx=zy*xz,yy=zz*xx-zx*xz,yz=-zy*xx;
    out[0]=xx;out[1]=yx;out[2]=zx;out[3]=0;out[4]=xy;out[5]=yy;out[6]=zy;out[7]=0;
    out[8]=xz;out[9]=yz;out[10]=zz;out[11]=0;out[12]=-(xx*x+xz*z);out[13]=-(yx*x+yy*y+yz*z);out[14]=-(zx*x+zy*y+zz*z);out[15]=1;return out;
  }
  const VERTEX=`precision highp float;
attribute vec3 aPosition;attribute vec3 aNormal;attribute vec4 aColor;
attribute vec4 aI0;attribute vec4 aI1;attribute vec4 aI2;attribute vec4 aI3;
uniform mat4 uVP;uniform mat4 uModel;uniform float uInstanced;
varying vec3 vNormal;varying vec3 vWorld;varying vec4 vColor;
void main(){mat4 model=uModel;if(uInstanced>0.5)model=mat4(aI0,aI1,aI2,aI3);
vec4 world=model*vec4(aPosition/128.0,1.0);vWorld=world.xyz;
vNormal=normalize(mat3(model)*aNormal);vColor=aColor;gl_Position=uVP*world;}`;
  const FRAGMENT=`precision mediump float;
varying vec3 vNormal;varying vec3 vWorld;varying vec4 vColor;
uniform vec3 uEye;uniform vec4 uTint;uniform float uAlpha;
uniform vec3 uFogColor;uniform float uFogDensity;uniform float uAmbientLevel;
void main(){
vec3 n=normalize(vNormal);vec3 light=normalize(vec3(-0.48,0.82,0.35));
vec3 base=pow(max(vColor.rgb*uTint.rgb,vec3(0.001)),vec3(2.2));
float hemi=n.y*0.5+0.5;vec3 ambient=mix(vec3(0.42,0.34,0.29),vec3(0.68,0.85,1.0),hemi)*uAmbientLevel;
float diffuse=max(dot(n,light),0.0);vec3 view=normalize(uEye-vWorld);
float spec=pow(max(dot(n,normalize(light+view)),0.0),mix(24.0,64.0,vColor.a));
float rim=pow(1.0-max(dot(n,view),0.0),3.0)*0.07;
vec3 color=base*(ambient+vec3(1.0,0.91,0.76)*diffuse*0.95)+vec3(1.0,0.92,0.77)*spec*(0.03+vColor.a*0.42)+base*rim;
color=pow(color/(vec3(1.0)+color*0.16),vec3(0.454545));
float fog=1.0-exp(-max(0.0,-vWorld.z-20.0)*0.008);
color=mix(color,vec3(0.88,0.82,0.74),min(0.94,fog));
gl_FragColor=vec4(color,uAlpha);}`;
  const SKY_V=`attribute vec2 p;varying vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.999,1.0);}`;
  const SKY_F=`precision mediump float;varying vec2 uv;uniform vec3 uHorizon;uniform vec3 uZenith;uniform float uSunStrength;void main(){float t=smoothstep(0.32,1.0,uv.y);vec3 c=mix(uHorizon,uZenith,t);float sunlight=1.0-smoothstep(0.035,0.19,length((uv-vec2(0.80,0.77))*vec2(1.0,1.3)));c+=vec3(1.0,0.73,0.43)*sunlight*uSunStrength*0.20;gl_FragColor=vec4(c,1.0);}`;
  const SHADOW_V=`attribute vec2 p;uniform mat4 vp;uniform mat4 model;varying vec2 uv;void main(){uv=p;gl_Position=vp*model*vec4(p.x,0.0,p.y,1.0);}`;
  const SHADOW_F=`precision mediump float;varying vec2 uv;uniform float opacity;void main(){float a=(1.0-smoothstep(0.1,1.0,length(uv)))*opacity;gl_FragColor=vec4(0.08,0.12,0.14,a);}`;
  const DUST_V=`attribute vec2 p;uniform mat4 vp;uniform vec3 center;uniform vec3 right;uniform vec3 up;uniform float size;varying vec2 uv;void main(){uv=p;vec3 w=center+(right*p.x+up*p.y)*size;gl_Position=vp*vec4(w,1.0);}`;
  const DUST_F=`precision mediump float;varying vec2 uv;uniform vec4 color;void main(){float d=length(uv);float a=(1.0-smoothstep(0.25,1.0,d))*color.a;gl_FragColor=vec4(color.rgb,a);}`;
  const easeInOut=t=>t*t*(3-2*t);
  // Which street geometry each neighbourhood (zone) uses; 'base' is the original city canyon.
  const GEOMETRY=['base','suburb','downtown','downtown'];
  const BRIDGE_SPACING=550;
  class RunnerRenderer{
    constructor(canvas,assets){
      if(!canvas||!assets||assets.version!==1||assets.stride!==16)throw Error('The city model is incomplete.');
      this.canvas=canvas;this.assets=assets;this.quality='medium';this.clock=0;this.phase=0;this.speedBlend=0;this.slideBlend=0;this.airBlend=0;this.lean=0;this.turn=0;this.prevX=0;this.cameraY=4.8;this.cameraX=0;this.cameraZ=8.2;this.districtMeshes={};this.bridgeMesh=null;this.landBlend=0;this.currentDistrict=-1;this.tuckBlend=0;this.slideT=0;this.rollMode=false;this.wasSliding=false;this.diveRecent=0;this.prevLanding=0;this.dust=[];this.dustTimer=0;this.showcaseRect=null;this.showcaseOffset=0;this.showcaseDragging=false;this.rollAngle=0;
      const gl=this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:true,stencil:false,powerPreference:'high-performance'})||canvas.getContext('experimental-webgl',{alpha:false,antialias:false});
      if(!gl)throw Error('This device needs a WebGL-enabled Android WebView.');
      this.instancing=gl.getExtension('ANGLE_instanced_arrays');
      this.program=this._program(VERTEX,FRAGMENT,{aPosition:0,aNormal:1,aColor:2,aI0:3,aI1:4,aI2:5,aI3:6});
      this.uniform={};for(const name of ['uVP','uModel','uInstanced','uEye','uTint','uAlpha','uFogColor','uFogDensity','uAmbientLevel'])this.uniform[name]=gl.getUniformLocation(this.program,name);
      this.sky=this._program(SKY_V,SKY_F,{p:0});this.skyU={horizon:gl.getUniformLocation(this.sky,'uHorizon'),zenith:gl.getUniformLocation(this.sky,'uZenith'),sun:gl.getUniformLocation(this.sky,'uSunStrength')};this.shadow=this._program(SHADOW_V,SHADOW_F,{p:0});
      this.shadowU={vp:gl.getUniformLocation(this.shadow,'vp'),model:gl.getUniformLocation(this.shadow,'model'),opacity:gl.getUniformLocation(this.shadow,'opacity')};
      this.dustProgram=this._program(DUST_V,DUST_F,{p:0});this.dustU={};for(const name of ['vp','center','right','up','size','color'])this.dustU[name]=gl.getUniformLocation(this.dustProgram,name);
      this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      this.identity=identity(new Float32Array(16));this.model=new Float32Array(16);this.local=new Float32Array(16);this.root=new Float32Array(16);this.view=new Float32Array(16);this.projection=new Float32Array(16);this.vp=new Float32Array(16);
      this.chunks=assets.chunks.map(m=>this._mesh(m));this.track=this._mesh(assets.track);this.templates={};for(const k of Object.keys(assets.templates))this.templates[k]=this._mesh(assets.templates[k]);
      this.characters={};this.coinMatrices=new Float32Array(512*16);this.coinObjects=new Array(512);this.coinBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.coinBuffer);gl.bufferData(gl.ARRAY_BUFFER,this.coinMatrices.byteLength,gl.DYNAMIC_DRAW);
      this.lastStats={drawCalls:0,vertices:0,objects:0};this.resize();
      canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;});
      canvas.addEventListener('webglcontextrestored',()=>{this.lost=true;});
    }
    _program(vs,fs,attributes){const gl=this.gl;const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error('Graphics shader: '+message);}return s;};const v=compile(gl.VERTEX_SHADER,vs),f=compile(gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);for(const k of Object.keys(attributes))gl.bindAttribLocation(p,attributes[k],k);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Graphics program: '+gl.getProgramInfoLog(p));return p;}
    _mesh(model){if(!model||!model.count)return null;const raw=global.atob(model.data),bytes=new Uint8Array(raw.length);if(bytes.length!==model.count*16)throw Error('A city mesh has invalid geometry.');for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const gl=this.gl,b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);return {buffer:b,count:model.count};}
    _bind(mesh){const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.enableVertexAttribArray(0);gl.enableVertexAttribArray(1);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(0,3,gl.SHORT,false,16,0);gl.vertexAttribPointer(1,3,gl.SHORT,true,16,6);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,16,12);}
    _regular(){const gl=this.gl;gl.uniform1f(this.uniform.uInstanced,0);for(let i=3;i<=6;i++){if(this.instancing)this.instancing.vertexAttribDivisorANGLE(i,0);gl.disableVertexAttribArray(i);}}
    _draw(mesh,matrix){if(!mesh)return;this._bind(mesh);this.gl.uniformMatrix4fv(this.uniform.uModel,false,matrix);this.gl.drawArrays(this.gl.TRIANGLES,0,mesh.count);this.lastStats.drawCalls++;this.lastStats.vertices+=mesh.count;}
    setQuality(value){this.quality=['low','medium','high'].includes(value)?value:'medium';this.resize();}
    resize(){const cssW=Math.max(1,this.canvas.clientWidth||global.innerWidth||450),cssH=Math.max(1,this.canvas.clientHeight||global.innerHeight||800);let ratio=Math.min(global.devicePixelRatio||1,this.quality==='high'?2:this.quality==='medium'?1.5:1);const cap=this.quality==='high'?1500000:this.quality==='medium'?750000:420000;ratio=Math.min(ratio,Math.sqrt(cap/(cssW*cssH)));const w=Math.max(1,Math.floor(cssW*ratio)),h=Math.max(1,Math.floor(cssH*ratio));if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;this.gl.viewport(0,0,w,h);perspective(this.projection,66*PI/180,w/h,.1,205);}
    _setupMeshProgram(){const gl=this.gl;gl.useProgram(this.program);gl.uniformMatrix4fv(this.uniform.uVP,false,this.vp);gl.uniform3f(this.uniform.uEye,this.cameraX,this.cameraY,this.cameraZ);gl.uniform4f(this.uniform.uTint,1,1,1,1);gl.uniform1f(this.uniform.uAlpha,1);gl.uniform3fv(this.uniform.uFogColor,this.district.fog);gl.uniform1f(this.uniform.uFogDensity,this.district.density);gl.uniform1f(this.uniform.uAmbientLevel,this.district.ambient);this._regular();}
    _district(distance){
      // Same immutable original models, with a gentle sequence of lighting
      // districts that follows actual distance rather than arbitrary time.
      const zones=[
        {name:'SUNRISE CITY',horizon:[.96,.81,.68],zenith:[.34,.69,.91],fog:[.84,.81,.76],density:.008,ambient:.78,sun:.86,tint:[1,1,1]},
        {name:'GREEN LINE',horizon:[.81,.93,.74],zenith:[.31,.73,.86],fog:[.65,.85,.73],density:.010,ambient:.79,sun:.75,tint:[.92,1.03,.93]},
        {name:'GOLDEN TERMINAL',horizon:[1.0,.71,.50],zenith:[.56,.48,.72],fog:[.91,.69,.58],density:.012,ambient:.68,sun:1,tint:[1.06,.94,.90]},
        {name:'NEON NIGHT',horizon:[.37,.40,.65],zenith:[.09,.17,.35],fog:[.32,.38,.55],density:.014,ambient:.70,sun:.2,tint:[.85,.91,1.11]}
      ];
      const position=Math.max(0,Number(distance)||0)/1100,part=Math.floor(position),t=position-part;
      // Fade in the next skyline only near the end of each neighborhood.
      const blend=t<=.78?0:(t-.78)/.22,b=blend*blend*(3-2*blend);
      const a=zones[part%zones.length],c=zones[(part+1)%zones.length],mix=(x,y)=>x+(y-x)*b;
      const blendVec=(x,y)=>x.map((v,i)=>mix(v,y[i]));
      this.district={name:a.name,horizon:blendVec(a.horizon,c.horizon),zenith:blendVec(a.zenith,c.zenith),fog:blendVec(a.fog,c.fog),density:mix(a.density,c.density),ambient:mix(a.ambient,c.ambient),sun:mix(a.sun,c.sun),tint:blendVec(a.tint,c.tint)};
      return this.district;
    }

    _shadow(x,y,z,sx,sz,opacity){const gl=this.gl;transform(this.model,x,y,z,0,0,0,sx,1,sz);gl.uniformMatrix4fv(this.shadowU.model,false,this.model);gl.uniform1f(this.shadowU.opacity,opacity);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.lastStats.drawCalls++;}
    _districtMesh(set,index){const sets=this.assets&&this.assets.districtChunks;if(!sets||!sets[set])return null;const key=set+index;if(!(key in this.districtMeshes)){const src=sets[set][index];this.districtMeshes[key]=src?this._mesh(src):null;}return this.districtMeshes[key];}
    setShowcaseRect(rect){this.showcaseRect=rect&&rect.width>0&&rect.height>0?{left:rect.left,top:rect.top,width:rect.width,height:rect.height}:null;}
    turnShowcase(delta){this.showcaseOffset+=Number(delta)||0;}
    _emitDust(x,y,z,count,spread,rise,size,alpha){for(let i=0;i<count;i++){if(this.dust.length>=72)this.dust.shift();const a=Math.random()*TAU,r=Math.random()*spread;this.dust.push({x:x+Math.cos(a)*r,y:y+.24+Math.random()*.14,z:z+Math.sin(a)*r*.6,vx:Math.cos(a)*spread*1.3,vy:rise*(.5+Math.random()*.7),vz:Math.sin(a)*spread*.8,age:0,life:.42+Math.random()*.3,size,alpha});}}
    _updateDust(dt,speed){for(let i=this.dust.length-1;i>=0;i--){const d=this.dust[i];d.age+=dt;if(d.age>=d.life){this.dust.splice(i,1);continue;}const drag=Math.exp(-3.2*dt);d.vx*=drag;d.vz*=drag;d.vy*=Math.exp(-2.2*dt);d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=(d.vz+speed)*dt;}}
    _drawDust(){
      if(!this.dust.length)return;const gl=this.gl,v=this.view;
      gl.useProgram(this.dustProgram);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.enableVertexAttribArray(0);for(let i=1;i<=6;i++)gl.disableVertexAttribArray(i);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.uniformMatrix4fv(this.dustU.vp,false,this.vp);gl.uniform3f(this.dustU.right,v[0],v[4],v[8]);gl.uniform3f(this.dustU.up,v[1],v[5],v[9]);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      for(const d of this.dust){const t=d.age/d.life,fade=(1-t)*(1-t);gl.uniform3f(this.dustU.center,d.x,d.y,d.z);gl.uniform1f(this.dustU.size,d.size*(.55+t*1.1));gl.uniform4f(this.dustU.color,.93,.87,.78,d.alpha*fade);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.lastStats.drawCalls++;}
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
    _character(style,state,dt){
      style=this.assets.characters[style]?style:'courier';let actor=this.characters[style];
      if(!actor){actor=this.characters[style]={bones:this.assets.characters[style].bones.map(b=>({source:b,mesh:this._mesh(b.mesh),world:new Float32Array(16)}))};}
      const showcase=!!this.showcase,active=state.phase==='running',speed=active?Number(state.speed)||13:0;
      this.speedBlend+=(speed-this.speedBlend)*(1-Math.exp(-12*dt));this.phase=mod(this.phase+this.speedBlend*dt*.73,TAU);
      const sliding=!showcase&&!!state.sliding,diving=!showcase&&!!state.diving;
      if(sliding&&!this.wasSliding){this.slideT=0;this.rollMode=this.diveRecent>0;if(!this.rollMode)this._emitDust(Number(state.player_x)||0,Number(state.player_y)||0,.2,6,.6,.45,.85,.5);}
      if(!sliding)this.rollMode=false;this.wasSliding=sliding;if(sliding)this.slideT+=dt;this.diveRecent=diving?.7:Math.max(0,this.diveRecent-dt);
      const groundSlide=sliding&&!this.rollMode,rolling=sliding&&this.rollMode&&this.slideT<.52;
      this.slideBlend+=((groundSlide?1:0)-this.slideBlend)*(1-Math.exp(-20*dt));this.tuckBlend+=(((diving||rolling)?1:0)-this.tuckBlend)*(1-Math.exp(-22*dt));
      this.rollAngle=rolling?-TAU*easeInOut(clamp(this.slideT/.5,0,1)):0;
      this.airBlend+=((!showcase&&Math.abs(state.vertical_velocity||0)>.15?1:0)-this.airBlend)*(1-Math.exp(-15*dt));
      const landing=!showcase&&Number(state.landing)>0?Number(state.landing):0;
      this.landBlend+=((landing>0?1:0)-this.landBlend)*(1-Math.exp(-17*dt));
      const x=showcase?0:Number(state.player_x)||0,y=showcase?0:Number(state.player_y)||0,lateral=(x-this.prevX)/Math.max(dt,.001);this.prevX=x;
      // Light dust: one soft puff cloud when touching down, a trickle while sliding.
      if(landing>this.prevLanding+.05&&landing>.2)this._emitDust(x,y,.1,this.tuckBlend>.4||sliding?9:7,.65,.5,.95,.55);
      this.prevLanding=landing;
      if(groundSlide&&(this.dustTimer-=dt)<=0){this.dustTimer=.06;this._emitDust(x,y,.55,1,.25,.3,.6,.4);}
      this._updateDust(dt,active?Number(state.speed)||13:0);
      this.lean+=(clamp(-lateral*.018,-.15,.15)-this.lean)*(1-Math.exp(-16*dt));this.turn+=(clamp(-lateral*.025,-.25,.25)-this.turn)*(1-Math.exp(-10*dt));
      const run=clamp(this.speedBlend/8,0,1),slide=this.slideBlend,tuck=this.tuckBlend,air=this.airBlend*(1-tuck),gait=run*(1-this.airBlend)*(1-slide)*(1-tuck);
      // Whole-body pivots: baseball slide leans back about the hips, roll tumbles about the belly.
      const slidePitch=slide*1.12,hipY=.94,rollY=.95,spin=this.rollAngle;
      if(showcase&&!this.showcaseDragging)this.showcaseOffset+=dt*.5;const yaw=showcase?PI+this.showcaseOffset:0;
      const offY=hipY*(1-Math.cos(slidePitch))+rollY*(1-Math.cos(spin))-slide*.5,offZ=-hipY*Math.sin(slidePitch)-rollY*Math.sin(spin);
      transform(this.root,x,y+offY,offZ,slidePitch+spin,yaw,0);
      for(let i=0;i<actor.bones.length;i++){
        const bone=actor.bones[i],b=bone.source;let px=b.p[0],py=b.p[1],pz=b.p[2],rx=b.r[0],ry=b.r[1],rz=b.r[2],sx=b.s[0],sy=b.s[1],sz=b.s[2];
        if(i===0){py+=Math.abs(Math.sin(this.phase))*.045*gait-this.landBlend*.05+(showcase?Math.sin(this.clock*2)*.025:0);rz+=this.lean;ry+=this.turn;sy*=1-this.landBlend*.05;}
        else if(i===1){rx+=-.09*run*(1-slide)-slide*.12-air*.10-tuck*.62;ry+=Math.sin(this.phase)*.045*gait;}
        else if(i===2)rx+=-slide*.78+air*.04+tuck*.5;
        else{
          const side=i>=8?1:0,part=(i-3)%5,wave=Math.sin(this.phase+(side?PI:0));
          if(part===0){rx+=-wave*.76*gait-.12*(1-slide)+air*.75+slide*-.55+tuck*1.15;rz+=(side?-.12:.12)+air*(side?-.45:.45)+slide*(side?-.5:.5);}
          else if(part===1)rx+=-.55-Math.max(0,wave)*.33*gait-air*.35-slide*.2-tuck*.7;
          else if(part===2){rx+=wave*.77*gait+air*(side?-.18:.23)+slide*(side?.1:-.18)+tuck*1.35;rz+=(side?-.035:.035)+air*(side?-.12:.12);}
          else if(part===3)rx+=-Math.max(0,-wave)*1.16*gait-air*(side?.65:.85)-slide*(side?.1:.5)-tuck*1.75;
          else rx+=Math.max(0,wave)*.2*gait+air*.1+slide*-.25+tuck*.5;
        }
        transform(this.local,px,py,pz,rx,ry,rz,sx,sy,sz);multiply(bone.world,b.parent<0?this.root:actor.bones[b.parent].world,this.local);this._draw(bone.mesh,bone.world);
      }
    }
    render(state,delta,style='courier',showcase=false){
      if(this.lost)throw Error('Graphics were interrupted. Restart the game to restore the city.');
      const gl=this.gl,dt=clamp(Number(delta)||0,0,.075);this.showcase=showcase;this.clock+=state.phase==='paused'&&!showcase?0:dt;
      this.lastStats.drawCalls=0;this.lastStats.vertices=0;this.lastStats.objects=0;
      const playerY=Number(state.player_y)||0,playerX=Number(state.player_x)||0;
      let showD=6.4,shiftX=0,shiftY=0;
      if(showcase&&this.showcaseRect){const W=Math.max(1,this.canvas.clientWidth||global.innerWidth||450),H=Math.max(1,this.canvas.clientHeight||global.innerHeight||800),r=this.showcaseRect;
        // Fit the whole runner (about 2.5 m tall) inside the shop panel and shift the lens so it is centred there.
        showD=clamp(2.5*H/(.8*r.height)/1.2988,4.4,13);shiftX=2*(r.left+r.width/2)/W-1;shiftY=1-2*(r.top+r.height/2)/H;}
      this.cameraY+=((showcase?2.0:4.8+playerY*.40)-this.cameraY)*(1-Math.exp(-5*dt));this.cameraX+=((showcase?0:playerX*.13)-this.cameraX)*(1-Math.exp(-4*dt));
      this.cameraZ+=((showcase?showD:8.2)-this.cameraZ)*(1-Math.exp(-6*dt));
      lookAt(this.view,this.cameraX,this.cameraY,this.cameraZ,this.cameraX,showcase?1.15:1.1+playerY*.15,showcase?0:-11);
      this.projection[8]=-shiftX;this.projection[9]=-shiftY;multiply(this.vp,this.projection,this.view);this.projection[8]=0;this.projection[9]=0;
      const district=this._district(state.distance||0);
      gl.clearColor(.65,.80,.87,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);
      gl.useProgram(this.sky);gl.uniform3fv(this.skyU.horizon,district.horizon);gl.uniform3fv(this.skyU.zenith,district.zenith);gl.uniform1f(this.skyU.sun,district.sun);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);for(let i=1;i<=6;i++)gl.disableVertexAttribArray(i);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);
      // Godot mesh front faces wind clockwise. Double-sided rendering also
      // keeps thin flags, leaves and paired ramp panels visible from both sides.
      gl.disable(gl.CULL_FACE);this._setupMeshProgram();this._draw(this.track,this.identity);
      const distance=Number(state.distance)||0;
      gl.uniform4f(this.uniform.uTint,...district.tint,1);
      for(let i=0;i<this.chunks.length;i++){
        const z=mod(distance-i*24+24,192)-192+24,k=i+8*Math.floor((distance-24*i+24)/192),part=Math.floor((144+24*k-12)/1100),set=GEOMETRY[mod(part,GEOMETRY.length)];
        let mesh=this.chunks[i],mirror=1;
        if(set!=='base'){const list=this.assets.districtChunks&&this.assets.districtChunks[set];if(list&&list.length){const alt=this._districtMesh(set,mod(k,list.length));if(alt){mesh=alt;mirror=(Math.floor(k/list.length)&1)?-1:1;}}}
        transform(this.model,0,0,z,0,0,0,mirror,1,1);this._draw(mesh,this.model);
      }
      // Foot-over bridges span the tracks every 550 m (just before each district change and halfway through it).
      if(this.assets.bridge){
        if(!this.bridgeMesh)this.bridgeMesh=this._mesh(this.assets.bridge);
        for(let n=Math.max(1,Math.floor((distance-6+20)/BRIDGE_SPACING));BRIDGE_SPACING*n-20-distance<205;n++){const z=distance-(BRIDGE_SPACING*n-20);if(z>6)continue;transform(this.model,0,0,z);this._draw(this.bridgeMesh,this.model);}
      }
      gl.uniform4f(this.uniform.uTint,1,1,1,1);
      // Soft planar contact shadows; no costly full-scene shadow maps.
      gl.useProgram(this.shadow);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.enableVertexAttribArray(0);for(let i=1;i<=6;i++)gl.disableVertexAttribArray(i);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(this.shadowU.vp,false,this.vp);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      const objects=state.objects||[];
      for(let i=0;i<objects.length;i++){const o=objects[i];if(o.removed||o.z>32||o.z<-190)continue;if(o.kind==='train')this._shadow(o.lane*2.6,.012,o.z,1.22,(o.length||14)*.53,.26);}
      this._shadow(playerX,(state.grounded?playerY:0)+.025,0,.48,.38,clamp(.32-playerY*.025,.12,.32));
      gl.depthMask(true);gl.disable(gl.BLEND);this._setupMeshProgram();let coinCount=0;
      for(let i=0;i<objects.length;i++){
        const o=objects[i];if(o.removed||o.collected||o.z>32||o.z<-190)continue;this.lastStats.objects++;
        const x=(Number(o.lane)||0)*2.6;
        if(o.kind==='coin'){if(coinCount<512){this.coinObjects[coinCount]=o;transform(this.model,x,Number(o.height)||.95,o.z,0,this.clock*3.2+o.id*.37,0);this.coinMatrices.set(this.model,coinCount*16);coinCount++;}continue;}
        let key=o.kind,y=0,ry=0;
        if(key==='train')key='train'+mod(Number(o.color_index)||o.id||0,3);if(o.kind==='train'&&o.away)ry=PI;
        if(o.kind==='powerup'){key=o.tag||'magnet';y=(Number(o.height)||1.05)+Math.sin(this.clock*3.5+o.id)*.12;ry=this.clock*1.5;}
        transform(this.model,x,y,o.z,0,ry,0);this._draw(this.templates[key],this.model);
      }
      const coin=this.templates.coin;
      if(coinCount&&coin){
        if(this.instancing){this._bind(coin);gl.bindBuffer(gl.ARRAY_BUFFER,this.coinBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.coinMatrices.subarray(0,coinCount*16));for(let i=0;i<4;i++){gl.enableVertexAttribArray(3+i);gl.vertexAttribPointer(3+i,4,gl.FLOAT,false,64,i*16);this.instancing.vertexAttribDivisorANGLE(3+i,1);}gl.uniform1f(this.uniform.uInstanced,1);this.instancing.drawArraysInstancedANGLE(gl.TRIANGLES,0,coin.count,coinCount);this.lastStats.drawCalls++;this.lastStats.vertices+=coin.count*coinCount;this._regular();}
        else for(let i=0;i<coinCount;i++)this._draw(coin,this.coinMatrices.subarray(i*16,i*16+16));
      }
      this._character(style,state,dt);
      if(Number(state.shield)>0){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.uniform1f(this.uniform.uAlpha,.25);gl.uniform4f(this.uniform.uTint,.38,1,1,1);transform(this.model,playerX,playerY+1.1,0,0,this.clock,0,2.8,3.6,2.8);this._draw(this.templates.shield,this.model);gl.uniform1f(this.uniform.uAlpha,1);gl.uniform4f(this.uniform.uTint,1,1,1,1);gl.depthMask(true);gl.disable(gl.BLEND);}
      this._drawDust();
    }
  }
  global.RunnerRenderer=RunnerRenderer;
})(typeof window!=='undefined'?window:globalThis);
