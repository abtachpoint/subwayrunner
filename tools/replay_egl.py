#!/usr/bin/env python3
"""Replay the actual WebGL shaders/geometry using local surfaceless Mesa GLES.

This verifies rendering output without a browser; it does not verify WebView or
Android installation. Uses no display server, sockets, network or GPU dependency.
"""
from __future__ import annotations
import base64
import ctypes as C
import json
import os
from pathlib import Path
import sys

os.environ.setdefault('EGL_PLATFORM','surfaceless')
os.environ.setdefault('LIBGL_ALWAYS_SOFTWARE','1')
cache_dir=Path(__file__).resolve().parents[1]/'.runtime'/'mesa-shader-cache'
cache_dir.mkdir(parents=True,exist_ok=True)
os.environ.setdefault('MESA_SHADER_CACHE_DIR',str(cache_dir))
from PIL import Image

EGL_NONE=0x3038
E=C.CDLL('libEGL.so.1')
void=C.c_void_p; uint=C.c_uint; integer=C.c_int; boolean=C.c_ubyte; size=C.c_ssize_t
E.eglGetProcAddress.argtypes=[C.c_char_p];E.eglGetProcAddress.restype=void
E.eglGetDisplay.argtypes=[void];E.eglGetDisplay.restype=void
E.eglInitialize.argtypes=[void,C.POINTER(integer),C.POINTER(integer)];E.eglInitialize.restype=uint
E.eglBindAPI.argtypes=[uint];E.eglBindAPI.restype=uint
E.eglChooseConfig.argtypes=[void,C.POINTER(integer),C.POINTER(void),integer,C.POINTER(integer)];E.eglChooseConfig.restype=uint
E.eglCreatePbufferSurface.argtypes=[void,void,C.POINTER(integer)];E.eglCreatePbufferSurface.restype=void
E.eglCreateContext.argtypes=[void,void,void,C.POINTER(integer)];E.eglCreateContext.restype=void
E.eglMakeCurrent.argtypes=[void,void,void,void];E.eglMakeCurrent.restype=uint
E.eglGetError.restype=uint

def arr(values):return (integer*len(values))(*values)
def must(value,what):
    if not value:raise RuntimeError(f'{what}: EGL 0x{E.eglGetError():04x}')
    return value

def load_gl(name,restype,args):
    ptr=E.eglGetProcAddress(name.encode())
    if not ptr:raise RuntimeError('Missing GLES entry point '+name)
    return C.CFUNCTYPE(restype,*args)(ptr)

def main():
    source=Path(sys.argv[1] if len(sys.argv)>1 else '/workspace/subway-runner/release/webgl-trace.json')
    target=Path(sys.argv[2] if len(sys.argv)>2 else '/workspace/subway-runner/release/Subway-Runner-WebGL-preview.png')
    trace=json.loads(source.read_text());width,height=int(trace['width']),int(trace['height'])
    platform=E.eglGetProcAddress(b'eglGetPlatformDisplayEXT')
    if platform:
        display=C.CFUNCTYPE(void,uint,void,C.POINTER(integer))(platform)(0x31DD,None,None)
    else:display=E.eglGetDisplay(None)
    major,minor=integer(),integer();must(E.eglInitialize(display,C.byref(major),C.byref(minor)),'initialize')
    must(E.eglBindAPI(0x30A0),'bind GLES API')
    config=void();count=integer()
    attrs=arr([0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3025,24,EGL_NONE])
    must(E.eglChooseConfig(display,attrs,C.byref(config),1,C.byref(count)) and count.value,'choose GLES3 config')
    surface=must(E.eglCreatePbufferSurface(display,config,arr([0x3057,width,0x3056,height,EGL_NONE])),'create pbuffer')
    context=must(E.eglCreateContext(display,config,None,arr([0x3098,3,EGL_NONE])),'create context')
    must(E.eglMakeCurrent(display,surface,surface,context),'make current')
    sigs={
      'GetString':(C.c_char_p,[uint]),'GetError':(uint,[]),
      'CreateShader':(uint,[uint]),'ShaderSource':(None,[uint,integer,C.POINTER(C.c_char_p),C.POINTER(integer)]),
      'CompileShader':(None,[uint]),'GetShaderiv':(None,[uint,uint,C.POINTER(integer)]),'GetShaderInfoLog':(None,[uint,integer,C.POINTER(integer),C.c_char_p]),
      'CreateProgram':(uint,[]),'AttachShader':(None,[uint,uint]),'BindAttribLocation':(None,[uint,uint,C.c_char_p]),'LinkProgram':(None,[uint]),
      'GetProgramiv':(None,[uint,uint,C.POINTER(integer)]),'GetProgramInfoLog':(None,[uint,integer,C.POINTER(integer),C.c_char_p]),
      'DeleteShader':(None,[uint]),'DeleteProgram':(None,[uint]),'UseProgram':(None,[uint]),'GenBuffers':(None,[integer,C.POINTER(uint)]),
      'DeleteBuffers':(None,[integer,C.POINTER(uint)]),'BindBuffer':(None,[uint,uint]),'BufferData':(None,[uint,size,void,uint]),'BufferSubData':(None,[uint,size,size,void]),
      'GetUniformLocation':(integer,[uint,C.c_char_p]),'Viewport':(None,[integer,integer,integer,integer]),
      'ClearColor':(None,[C.c_float]*4),'Clear':(None,[uint]),'Enable':(None,[uint]),'Disable':(None,[uint]),'DepthFunc':(None,[uint]),'DepthMask':(None,[boolean]),
      'BlendFunc':(None,[uint,uint]),'EnableVertexAttribArray':(None,[uint]),'DisableVertexAttribArray':(None,[uint]),
      'VertexAttribPointer':(None,[uint,integer,uint,boolean,integer,void]),'UniformMatrix4fv':(None,[integer,integer,boolean,C.POINTER(C.c_float)]),
      'UniformMatrix3fv':(None,[integer,integer,boolean,C.POINTER(C.c_float)]),'Uniform1f':(None,[integer,C.c_float]),'Uniform1i':(None,[integer,integer]),
      'Uniform2f':(None,[integer,C.c_float,C.c_float]),'Uniform3f':(None,[integer,C.c_float,C.c_float,C.c_float]),'Uniform4f':(None,[integer]+[C.c_float]*4),
      'DrawArrays':(None,[uint,integer,integer]),'DrawElements':(None,[uint,integer,uint,void]),'CullFace':(None,[uint]),'FrontFace':(None,[uint]),
      'Scissor':(None,[integer]*4),'ColorMask':(None,[boolean]*4),'Finish':(None,[]),'ReadPixels':(None,[integer,integer,integer,integer,uint,uint,void]),
    }
    G={name:load_gl('gl'+name,*signature) for name,signature in sigs.items()}
    print('EGL',major.value,minor.value,'GLES',G['GetString'](0x1F02).decode(),'renderer',G['GetString'](0x1F01).decode())
    objects={};calls=trace['calls']
    def decode(value):
        if isinstance(value,dict) and '$ref'in value:return objects[value['$ref']]
        return value
    def data(value):
        raw=base64.b64decode(value['$data']);return raw,C.create_string_buffer(raw)
    for index,call in enumerate(calls):
        op=call['op'];args=[decode(x) for x in call['args']]
        if op=='createShader':result=G['CreateShader'](*args)
        elif op=='createProgram':result=G['CreateProgram']()
        elif op=='createBuffer':
            value=uint();G['GenBuffers'](1,C.byref(value));result=value.value
        elif op=='shaderSource':
            raw=args[1].encode();text=C.c_char_p(raw);length=integer(len(raw));G['ShaderSource'](args[0],1,C.byref(text),C.byref(length));result=None
        elif op=='getUniformLocation':result=G['GetUniformLocation'](args[0],args[1].encode())
        elif op=='bindAttribLocation':G['BindAttribLocation'](args[0],args[1],args[2].encode());result=None
        elif op=='bufferData':
            if isinstance(args[1],int):G['BufferData'](args[0],args[1],None,args[2])
            else:
                raw,memory=data(args[1]);G['BufferData'](args[0],len(raw),memory,args[2])
            result=None
        elif op=='bufferSubData':
            raw,memory=data(args[2]);G['BufferSubData'](args[0],args[1],len(raw),memory);result=None
        elif op in ('uniformMatrix4fv','uniformMatrix3fv'):
            raw,memory=data(args[2]);dimension=4 if op=='uniformMatrix4fv'else 3
            G['UniformMatrix4fv'if dimension==4 else'UniformMatrix3fv'](args[0],len(raw)//(4*dimension*dimension),bool(args[1]),C.cast(memory,C.POINTER(C.c_float)));result=None
        elif op=='vertexAttribPointer':G['VertexAttribPointer'](*args[:-1],void(args[-1]));result=None
        elif op=='drawElements':G['DrawElements'](*args[:-1],void(args[-1]));result=None
        elif op=='deleteBuffer':
            item=uint(args[0]);G['DeleteBuffers'](1,C.byref(item));result=None
        else:
            name=op[0].upper()+op[1:]
            if name not in G:raise RuntimeError(f'Unsupported GL call {op}')
            result=G[name](*args)
        if'result'in call:objects[call['result']['$ref']]=result
        if op in ('compileShader','linkProgram'):
            status=integer();shader=op=='compileShader'
            G['GetShaderiv'if shader else'GetProgramiv'](args[0],0x8B81 if shader else 0x8B82,C.byref(status))
            if not status.value:
                message=C.create_string_buffer(16384)
                G['GetShaderInfoLog'if shader else'GetProgramInfoLog'](args[0],16384,None,message)
                raise RuntimeError(op+': '+message.value.decode())
        error=G['GetError']()
        if error:raise RuntimeError(f'GL error0x{error:04x} at call{index} {op}')
    G['Finish']();pixels=(C.c_ubyte*(width*height*4))();G['ReadPixels'](0,0,width,height,0x1908,0x1401,pixels)
    error=G['GetError']()
    if error:raise RuntimeError(f'ReadPixels GL error0x{error:04x}')
    image=Image.frombytes('RGBA',(width,height),bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    target.parent.mkdir(parents=True,exist_ok=True);image.save(target)
    print('PASS: actual shader replay,',len(calls),'calls,',trace.get('stats'),str(target))

if __name__=='__main__':main()
