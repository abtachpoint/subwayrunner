'use strict';
// Capture real renderer calls for local surfaceless GLES replay. This is not a
// browser/device test; actual shaders and immutable geometry are replayed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const target=process.argv[2]||path.join(root,'release','webgl-trace.json');
const distance=Number(process.argv[3]||80),style=process.argv[4]||'courier';
const constants={
  DEPTH_BUFFER_BIT:0x100,COLOR_BUFFER_BIT:0x4000,TRIANGLES:4,TRIANGLE_STRIP:5,
  ZERO:0,ONE:1,SRC_ALPHA:0x302,ONE_MINUS_SRC_ALPHA:0x303,LESS:0x201,LEQUAL:0x203,
  FRONT:0x404,BACK:0x405,CW:0x900,CCW:0x901,CULL_FACE:0xB44,BLEND:0xBE2,DEPTH_TEST:0xB71,
  FLOAT:0x1406,SHORT:0x1402,UNSIGNED_SHORT:0x1403,UNSIGNED_BYTE:0x1401,UNSIGNED_INT:0x1405,
  ARRAY_BUFFER:0x8892,ELEMENT_ARRAY_BUFFER:0x8893,STATIC_DRAW:0x88E4,DYNAMIC_DRAW:0x88E8,
  VERTEX_SHADER:0x8B31,FRAGMENT_SHADER:0x8B30,COMPILE_STATUS:0x8B81,LINK_STATUS:0x8B82,
  MAX_VERTEX_ATTRIBS:0x8869,MAX_VERTEX_UNIFORM_VECTORS:0x8DFB,MAX_TEXTURE_SIZE:0xD33,
  HIGH_FLOAT:0x8DF2,MEDIUM_FLOAT:0x8DF1,LOW_FLOAT:0x8DF0,NO_ERROR:0,
  RGBA:0x1908,TEXTURE_2D:0xDE1,TEXTURE0:0x84C0,
};
let nextId=1,recording=true;const calls=[];
function encode(value){
  if(value===undefined)return null;
  if(value&&value.__resource)return {$ref:value.id,kind:value.kind};
  if(ArrayBuffer.isView(value))return {$data:Buffer.from(value.buffer,value.byteOffset,value.byteLength).toString('base64'),type:value.constructor.name};
  if(value instanceof ArrayBuffer)return {$data:Buffer.from(value).toString('base64'),type:'ArrayBuffer'};
  return value;
}
function record(op,args){if(recording)calls.push({op,args:Array.from(args,encode)});}
function resource(kind,args){const r={__resource:true,id:nextId++,kind};record('create'+kind,args);if(recording)calls[calls.length-1].result=encode(r);return r;}
const gl={...constants,
  createShader(type){return resource('Shader',[type]);},createProgram(){return resource('Program',[]);},createBuffer(){return resource('Buffer',[]);},
  getExtension(){return null;},getSupportedExtensions(){return [];},
  getShaderParameter(){return true;},getProgramParameter(){return true;},
  getShaderInfoLog(){return '';},getProgramInfoLog(){return '';},getError(){return 0;},
  getShaderPrecisionFormat(){return{rangeMin:127,rangeMax:127,precision:23};},
  getContextAttributes(){return{alpha:false,antialias:false,depth:true,stencil:false};},
  getParameter(which){return which===constants.MAX_VERTEX_ATTRIBS?16:which===constants.MAX_VERTEX_UNIFORM_VECTORS?256:8192;},
  getUniformLocation(program,name){const r={__resource:true,id:nextId++,kind:'Uniform'};record('getUniformLocation',[program,name]);calls[calls.length-1].result=encode(r);return r;},
};
for(const name of ['shaderSource','compileShader','attachShader','bindAttribLocation','linkProgram','deleteShader','useProgram','bindBuffer','bufferData','bufferSubData','viewport','clearColor','clear','enable','disable','depthFunc','depthMask','blendFunc','enableVertexAttribArray','disableVertexAttribArray','vertexAttribPointer','uniformMatrix4fv','uniformMatrix3fv','uniform1f','uniform1i','uniform2f','uniform3f','uniform4f','drawArrays','drawElements','cullFace','frontFace','deleteBuffer','deleteProgram','scissor','colorMask'])gl[name]=function(...args){record(name,args);};
const canvas={width:450,height:800,clientWidth:450,clientHeight:800,style:{},addEventListener(){},getContext(type){if(type==='webgl'||type==='experimental-webgl')return gl;return null;}};
const context={console,performance:{now:()=>0},innerWidth:450,innerHeight:800,devicePixelRatio:1,
  atob:input=>Buffer.from(input,'base64').toString('binary'),btoa:input=>Buffer.from(input,'binary').toString('base64'),
  Float32Array,Float64Array,Int16Array,Int32Array,Uint8Array,Uint16Array,Uint32Array,ArrayBuffer,Math,Number,Object,Array,JSON,Error};
context.window=context;context.globalThis=context;vm.createContext(context);
for(const file of ['assets/models.js','simulation.js','renderer.js'])vm.runInContext(fs.readFileSync(path.join(root,'web',file),'utf8'),context,{filename:file});
const sim=new context.RunnerSimulation();sim.start(2026);sim._invulnerable=1e6;
while(sim.distance<distance)sim.update(1/120);
const state=sim.snapshot();
// Inspect the model at a stable centred gameplay position while preserving the
// actual simulation-generated obstacle locations.
state.player_x=0;state.player_y=0;state.vertical_velocity=0;state.sliding=false;
const renderer=new context.RunnerRenderer(canvas,context.RUNNER_MODELS);renderer.setQuality('medium');
// Warm the articulated pose. Only the last frame needs replay, but initialization
// geometry uploads, including the lazy character, must be kept.
renderer.render(state,1/60,style);
const init=calls.length;
recording=false;for(let i=0;i<48;i++)renderer.render(state,1/60,style);recording=true;
renderer.render(state,1/60,style);
const output={format:1,width:canvas.width,height:canvas.height,distance:state.distance,style,calls,stats:renderer.lastStats,initializationCalls:init};
fs.writeFileSync(target,JSON.stringify(output));
console.log(JSON.stringify({target,bytes:fs.statSync(target).size,calls:calls.length,stats:renderer.lastStats,width:canvas.width,height:canvas.height}));
