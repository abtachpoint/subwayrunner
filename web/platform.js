/* Origin-restricted Android WebMessage bridge. Credentials remain native. */
(function (scope) {
  'use strict';
  const inflight = new Map();
  let counter = 0;
  const bridge = () => scope.SubwayNative && typeof scope.SubwayNative.postMessage === 'function' ? scope.SubwayNative : null;
  function id() {
    if (scope.crypto && typeof scope.crypto.randomUUID === 'function') return scope.crypto.randomUUID();
    if (scope.crypto && typeof scope.crypto.getRandomValues === 'function') {
      const bytes = scope.crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
      const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
    }
    // An operation identifier is not an identity or reward proof. Native Android
    // always provides Web Crypto; this fallback keeps offline guests playable.
    return Date.now().toString(36)+'-offline-'+(++counter).toString(36);
  }
  function attach() {
    const native=bridge(); if (!native) return null;
    native.onmessage = function(event) {
      let message;
      try { message=JSON.parse(typeof event.data==='string'?event.data:String(event.data)); } catch (_) { return; }
      const pending=inflight.get(String(message.id)); if(!pending)return;
      inflight.delete(String(message.id));clearTimeout(pending.timer);
      if(message.ok===true)pending.resolve(message.result||{});
      else { const problem=message.error||{};const error=new Error(problem.message||'This service is temporarily unavailable.');error.code=problem.code||'SERVICE_ERROR';pending.reject(error); }
    };
    return native;
  }
  function call(method,params={},timeout=25000) {
    return new Promise((resolve,reject)=>{
      const native=attach();
      if(!native){const error=new Error('This feature needs the Android app and a network connection. Guest play remains available.');error.code='NATIVE_UNAVAILABLE';reject(error);return;}
      const request=id(),timer=setTimeout(()=>{inflight.delete(request);const error=new Error('The service did not respond. Your request can be retried safely.');error.code='TIMEOUT';reject(error);},timeout);
      inflight.set(request,{resolve,reject,timer});
      try{native.postMessage(JSON.stringify({id:request,method,params}));}catch(_){clearTimeout(timer);inflight.delete(request);const error=new Error('Android services are unavailable.');error.code='BRIDGE_UNAVAILABLE';reject(error);}
    });
  }
  scope.RunnerPlatform={available:()=>!!bridge(),call,id};
  attach();
})(typeof window!=='undefined'?window:globalThis);
