'use strict';
// Runs the production controller and simulation with DOM/renderer/native adapters.
// These tests exercise state and service boundaries; they do not validate browser
// layout, WebGL rendering, a deployed backend, or Google SDK/device behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
let checks = 0;
function check(condition, label) { checks++; assert.ok(condition, label); }
const clone = value => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i=0;i<40;i++) await Promise.resolve(); };
const day = '2026-10-30';
const canonicalProfile = extra => ({coins:1800,diamonds:200,inventory:{magnet:1,shield:1},owned_styles:['courier','skater'],selected_style:'courier',high_score:300,best_distance:100,day_utc:day,server_time:'2026-10-30T12:00:00Z',free_spin_day:'',ad_spins_day:day,ad_spins_used:0,...extra});
const catalog = {
  styles:[{id:'courier',name:'Kai',currency:'free',cost:0},{id:'skater',name:'Mira',currency:'free',cost:0},{id:'sprinter',name:'Zuri',currency:'coins',cost:1200},{id:'robot',name:'Bolt',currency:'coins',cost:3500},{id:'astronaut',name:'Nova',currency:'diamonds',cost:100},{id:'neon',name:'Flux',currency:'diamonds',cost:150}],
  items:[{id:'magnet',currency:'coins',cost:150},{id:'shield',currency:'coins',cost:200},{id:'coins_1000',currency:'diamonds',cost:10}],
  products:[{id:'diamonds_100',diamonds:100},{id:'diamonds_500',diamonds:500},{id:'diamonds_1200',diamonds:1200},{id:'diamonds_2500',diamonds:2500}],
  spin_outcomes:[{id:'coins_100',kind:'coins',amount:100,probability:.35},{id:'coins_300',kind:'coins',amount:300,probability:.25},{id:'magnet_1',kind:'item',item_id:'magnet',amount:1,probability:.15},{id:'shield_1',kind:'item',item_id:'shield',amount:1,probability:.15},{id:'character_sprinter',kind:'character',style_id:'sprinter',probability:.06},{id:'character_robot',kind:'character',style_id:'robot',probability:.03},{id:'character_astronaut',kind:'character',style_id:'astronaut',probability:.01}],
  spin_cost:20,limits:{free_daily:1,ad_daily:2,revives_per_run:1},daily_timezone:'UTC',duplicate_character_compensation:{kind:'coins',amount:300}
};

class Element {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.className='';this.style={};this.attributes={};this.listeners={};this.disabled=false;this.value='';this._text='';
    this.classList={add:(...items)=>{this.className=[...new Set([...this.className.split(/\s+/),...items])].join(' ').trim();},remove:(...items)=>{this.className=this.className.split(/\s+/).filter(item=>!items.includes(item)).join(' ');},contains:item=>this.className.split(/\s+/).includes(item)};
  }
  set textContent(value){this._text=String(value);this.children.forEach(child=>{child.parentNode=null;});this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  appendChild(child){if(child.parentNode)child.remove();this.children.push(child);child.parentNode=this;return child;}
  append(...children){children.forEach(child=>this.appendChild(child));}
  replaceChildren(...children){this._text='';this.children.forEach(child=>{child.parentNode=null;});this.children=[];this.append(...children);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  addEventListener(name,callback){(this.listeners[name]||=[]).push(callback);}
  dispatch(name,fields={}){if(name==='click'&&this.disabled)return;const event={target:this,stopPropagation(){},preventDefault(){},...fields};for(const callback of this.listeners[name]||[])callback(event);}
  setPointerCapture(){}
}

function nativeService(extra={}) {
  const state={profile:canonicalProfile(),signedIn:true,run:0,calls:[],handlers:{},...extra};
  state.platform={available:()=>true,id:(()=>{let n=0;return()=>`request_${++n}_stable`;})(),call(method,params={}){
    state.calls.push({method,params:clone(params)});
    try {
      if(state.handlers[method])return Promise.resolve(state.handlers[method](clone(params),state));
      const results={set_age:{group:params.group},auth_status:{signed_in:state.signedIn,uid:state.signedIn?'test-uid':'',display_name:'Runner Test',play_games_configured:true},sign_in:{signed_in:true,uid:'test-uid',display_name:'Runner Test',play_games_configured:true},sign_out:{signed_in:false},profile:{profile:state.profile},catalog,
        products:{products:catalog.products.map((item,i)=>({product_id:item.id,formatted_price:['$0.99','$3.99','$7.99','$14.99'][i]}))},progress_save:{saved:true,profile:state.profile},run_start:{run_id:`run_${state.run+1}_server`,profile:state.profile},run_finish:{run_id:params.run_id,profile:state.profile},purchase:{status:'launched'},reward:{status:'pending',run_id:params.run_id},reward_refresh:{status:'refreshing'},privacy_options:{status:'opened'},open_privacy:{status:'opened'},open_deletion:{status:'opened'},delete_account:{status:'pending'}};
      if(method==='run_start')state.run++;
      if(method==='sign_in')state.signedIn=true;
      if(method==='sign_out')state.signedIn=false;
      if(!(method in results))throw Error('Unexpected native method: '+method);
      return Promise.resolve(clone(results[method]));
    }catch(error){return Promise.reject(error);}
  }};
  return state;
}

function boot(storage=new Map(),native=null) {
  let now=1000,nextId=1,frame=null;
  const timers=new Map(),errors=[],listeners={},documentListeners={};
  const elements=Object.fromEntries(['ui','game','toast','loading'].map(id=>[id,new Element(id==='game'?'canvas':'div')]));
  const body=new Element('body');Object.values(elements).forEach(element=>body.append(element));
  const document={hidden:false,body,getElementById:id=>elements[id],createElement:tag=>new Element(tag),addEventListener(name,callback){(documentListeners[name]||=[]).push(callback);}};
  class MockRenderer{constructor(){this.frames=[];this.quality='';this.styles=[];}setQuality(value){this.quality=value;}resize(){}render(state,delta,style){this.frames.push({phase:state.phase,distance:state.distance,delta,style});this.styles.push(style);}}
  const context={document,console:{error:error=>errors.push(error),log(){}},RUNNER_MODELS:{},RunnerRenderer:MockRenderer,navigator:{onLine:true},localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},performance:{now:()=>now},setTimeout(callback,delay){const id=nextId++;timers.set(id,{callback,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(callback){frame=callback;return nextId++;},cancelAnimationFrame(){frame=null;},addEventListener(name,callback){(listeners[name]||=[]).push(callback);},location:{reload(){throw Error('Unexpected reload');}}};
  if(native)context.RunnerPlatform=native.platform;
  context.window=context;context.globalThis=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'web/simulation.js'),'utf8'),context,{filename:'simulation.js'});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'web/app.js'),'utf8'),context,{filename:'app.js'});
  check(context.subwayRunner&&errors.length===0,'Production app initializes without errors: '+errors.map(String).join('; '));
  function tick(milliseconds=16){now+=milliseconds;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.callback();}if(frame){const callback=frame;frame=null;callback(now);}check(errors.length===0,'Frame has no controller/render exception');}
  function descendants(element=elements.ui){return[element,...element.children.flatMap(child=>descendants(child))];}
  function buttons(){return descendants().filter(element=>element.tagName==='BUTTON');}
  function button(prefix,index=0){const matches=buttons().filter(element=>prefix instanceof RegExp?prefix.test(element.textContent):element.textContent.startsWith(prefix));assert.ok(matches[index],'Button exists: '+prefix+'; available: '+buttons().map(e=>e.textContent).join(' | '));return matches[index];}
  function emit(name,fields={},onDocument=false){for(const callback of(onDocument?documentListeners:listeners)[name]||[])callback({target:null,key:'',repeat:false,preventDefault(){},...fields});}
  return{api:context.subwayRunner,context,storage,elements,document,tick,button,buttons,descendants,emit,get now(){return now;}};
}

async function connected(extra={}){const native=nativeService(extra),h=boot(new Map(),native);h.api.chooseAge('adult');await settle();check(h.api.identity.signedIn,'Native signed_in identity is normalized');check(h.api.serverProfile&&h.api.serverProfile.diamonds===native.profile.diamonds,'Cloud balance comes from canonical server profile');return{h,a:h.api,native};}
function crash(a){a.sim.coins=11;a.sim.score=123;a.sim.distance=100;a.sim.phase='crashed';a.showResults();}

(async()=>{
  // Exercise the real JSON bridge independently of the application adapter.
  {
    const sent=[],timers=new Map();let timerId=0,requestId=0;
    const context={crypto:{randomUUID:()=>`bridge_request_${++requestId}`},setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),SubwayNative:{postMessage:json=>sent.push(JSON.parse(json))}};
    context.window=context;context.globalThis=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ROOT,'web/platform.js'),'utf8'),context,{filename:'platform.js'});
    check(context.RunnerPlatform.available(),'Real platform adapter recognizes the native WebMessage bridge');
    const auth=context.RunnerPlatform.call('auth_status',{});check(sent[0].method==='auth_status'&&typeof sent[0].id==='string','Real adapter sends structured request IDs and methods');context.SubwayNative.onmessage({data:JSON.stringify({id:sent[0].id,ok:true,result:{signed_in:true,display_name:'Runner'}})});check((await auth).signed_in===true&&timers.size===0,'Native success resolves the matching promise and clears its timer');
    const failed=context.RunnerPlatform.call('spin',{source:'diamonds',request_id:'operation_stable'});const rejection=assert.rejects(failed,error=>error.code==='OFFLINE');context.SubwayNative.onmessage({data:JSON.stringify({id:sent[1].id,ok:false,error:{code:'OFFLINE',message:'Reconnect to retry.'}})});await rejection;check(sent[1].params.request_id==='operation_stable','Bridge preserves server mutation operation IDs');
    const timed=context.RunnerPlatform.call('profile'),timedRejection=assert.rejects(timed,error=>error.code==='TIMEOUT');for(const fn of [...timers.values()])fn();await timedRejection;check(true,'Bridge timeout rejects without manufacturing a service result');
    delete context.SubwayNative;await assert.rejects(context.RunnerPlatform.call('sign_in'),error=>error.code==='NATIVE_UNAVAILABLE');check(!context.RunnerPlatform.available(),'Offline guest has no synthetic authentication provider');
  }
  // Existing playable guest flow, coin shop and non-persistent cosmetic previews.
  {
    const h=boot(),a=h.api;check(a.screen==='age'&&a.age==='unknown','Fresh launch is age gated');check(a.profile.wallet===0,'Fresh profile starts at zero coins');
    a.start();check(a.screen==='age'&&a.sim.phase==='ready','Unknown age cannot bypass the gate');h.button('Under 13').dispatch('click');await settle();check(a.screen==='menu'&&a.age==='under13','Child guests can play');
    a.profile.wallet=1500;a.showShop();const copy=h.elements.ui.textContent;for(const name of['Kai','Mira','Zuri','Bolt','Nova','Flux'])check(copy.includes(name),'Original character remains available: '+name);
    h.button('● 1,200').dispatch('click');check(a.profile.wallet===300&&a.profile.unlocked.includes('sprinter')&&a.profile.selected==='sprinter','Guest normal character costs its configured coin price');h.button('SELECTED').dispatch('click');check(a.profile.wallet===300,'Selected character cannot be charged twice');
    h.button('PREVIEW',4).dispatch('click');check(!a.profile.unlocked.includes('astronaut'),'Preview creates no premium entitlement');h.button('DONE').dispatch('click');a.start();h.tick();check(a.renderer.styles.at(-1)==='sprinter','Racing uses the selected owned character');
    crash(a);check(!h.buttons().some(e=>/WATCH AD|DEMO/.test(e.textContent)),'Children and guests have no rewarded ad CTA');await a.showRewardedRevive();check(a.sim.phase==='crashed','Protected age cannot invoke a reward programmatically');
    a.showMenu();check(a.profile.wallet===311&&a.profile.runs===1,'Guest finish banks collected coins once');a.bankRun();a.showMenu();check(a.profile.wallet===311&&a.profile.runs===1,'Repeated bank/menu cannot duplicate coins');const fresh=boot(h.storage);check(fresh.api.profile.wallet===311&&fresh.api.age==='under13'&&fresh.api.screen==='menu','Guest progress persists and a returning player skips the age slider');
    check(h.storage.get('subway-runner-age-group-v1')==='under13'&&!h.storage.get('subway-runner-age-group-v1').includes('year'),'Only the age group is stored, never a birthday or exact age');
    fresh.api.showSettings('menu');fresh.button('CHANGE AGE').dispatch('click');check(fresh.api.screen==='age','Age can be corrected from Settings');fresh.button('13–17').dispatch('click');await settle();check(fresh.api.age==='teen'&&fresh.api.screen==='settings'&&fresh.storage.get('subway-runner-age-group-v1')==='teen','Changing age returns to Settings and is remembered');
    const corrupt=boot(new Map([['subway-runner-age-group-v1','not-a-group']]));check(corrupt.api.screen==='age'&&corrupt.api.age==='unknown','An invalid stored age group is ignored and the slider is shown');
    const privacy=nativeService(),relaunch=boot(new Map([['subway-runner-age-group-v1','adult']]),privacy);await settle();check(privacy.calls.some(c=>c.method==='set_age'&&c.params.group==='adult')&&!privacy.calls.some(c=>c.method==='set_age'&&c.params.group==='unknown'),'Native ad layer receives the remembered age group at launch');
    fresh.api.showSpin();check(fresh.buttons().filter(e=>/SPIN/.test(e.textContent)).every(e=>e.disabled),'Guest spin actions are disabled');
  }
  {
    const legacy=JSON.stringify({version:2,wallet:99999,diamonds:9000,unlocked:['courier','astronaut','sprinter'],selected:'astronaut',highScore:700,settings:{quality:'low',music:false,sfx:true,tap:false}}),storage=new Map([['subway-runner-local-test-v2',legacy]]),h=boot(storage);
    check(storage.get('subway-runner-local-test-v2')===legacy,'Old test save is retained as a backup');check(h.api.profile.wallet===0&&!h.api.profile.unlocked.includes('astronaut'),'Legacy test currency and premium ownership are not imported');check(h.api.profile.highScore===700&&h.api.profile.settings.quality==='low','Non-currency legacy progress and settings survive migration');
  }
  // Real controls and modal/lifecycle pause semantics.
  {
    const h=boot(),a=h.api;a.chooseAge('adult');a.start();h.tick(30);const distance=a.sim.distance;a.controls.togglePause();h.tick(50);check(a.screen==='pause'&&a.sim.phase==='paused'&&a.sim.distance===distance,'Pause freezes simulation');h.button('SETTINGS').dispatch('click');h.button('High').dispatch('click');check(a.profile.settings.quality==='high'&&a.renderer.quality==='high','Graphics choice reaches renderer');h.emit('keydown',{key:'p'});check(a.screen==='pause'&&a.sim.phase==='paused','Pause key closes settings before resuming');h.emit('keydown',{key:'p'});check(a.screen==='running'&&a.sim.phase==='running','Second pause key resumes');a.showShop();h.emit('keydown',{key:'Escape'});check(a.screen==='pause'&&a.sim.phase==='paused','Shop cannot resume behind its overlay');h.button('KEEP RUNNING').dispatch('click');a.sim._objects=[];a.sim._next_segment=1e12;
    const pointer=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,preventDefault(){}});a.controls.beginPointer(pointer(1,180,350));a.controls.movePointer(pointer(1,230,350));check(a.sim.lane===1,'Right swipe changes lane');a.controls.endPointer(pointer(1,230,350));check(a.sim.shield_charges===1,'Swipe release is not a shield tap');a.controls.beginPointer(pointer(2,200,350));a.controls.beginPointer(pointer(3,200,350));a.controls.movePointer(pointer(2,100,350));check(a.sim.lane===1,'Conflicting multitouch cancels active gesture');a.controls.beginPointer(pointer(4,200,350));h.tick(30);a.controls.endPointer(pointer(4,200,350));h.tick(30);a.controls.beginPointer(pointer(5,200,350));h.tick(30);a.controls.endPointer(pointer(5,200,350));check(a.sim.shield_charges===0&&a.sim.shield>0,'Double tap activates one shield');
    h.document.hidden=true;const before=a.sim.distance;h.emit('visibilitychange',{},true);h.tick(1000);check(a.screen==='pause'&&a.sim.phase==='paused'&&a.sim.distance===before,'Background pauses gameplay');h.document.hidden=false;h.emit('visibilitychange',{},true);check(a.screen==='pause','Foreground never automatically resumes');
    h.button('KEEP RUNNING').dispatch('click');h.emit('subway-native',{detail:{type:'ad_state',payload:{paused:true}}});check(a.sim.phase==='paused','Native ad lifecycle pauses simulation');h.emit('subway-native',{detail:{type:'ad_state',payload:{paused:false}}});check(a.sim.phase==='paused','Ad dismissal never resumes automatically');
  }
  // Secure spin/store/purchase/reward integration checks are below.
  {
    const {h,a,native}=await connected();a.showSpin();const copy=h.elements.ui.textContent;for(const percentage of['35%','25%','15%','6%','3%','1%'])check(copy.includes(percentage),'Spin odds are disclosed before payment: '+percentage);check(copy.includes('UTC'),'Daily spin reset states UTC');
    native.handlers.spin=(params,state)=>{if(params.source==='free'){state.profile.free_spin_day=day;state.profile.coins=1900;}else{state.profile.diamonds=180;state.profile.coins=2200;}return{source:params.source,reward:{kind:'coins',amount:params.source==='free'?100:300},profile:state.profile};};
    h.button(/FREE.*SPIN|SPIN.*FREE/).dispatch('click');await settle();check(native.calls.some(c=>c.method==='spin'&&c.params.source==='free'),'Free button calls server spin endpoint');check(a.serverProfile.coins===1900&&a.profile.wallet===0,'Free spin replaces cloud wallet without local credit');a.showSpin();check(h.button(/FREE.*SPIN|SPIN.*FREE/).disabled,'Server-used daily free spin is disabled');
    h.button(/20/).dispatch('click');await settle();check(native.calls.some(c=>c.method==='spin'&&c.params.source==='diamonds'),'Paid spin spends through server endpoint');check(a.serverProfile.diamonds===180&&a.serverProfile.coins===2200,'Paid spin applies only returned server balances');
    native.profile.ad_spins_used=2;await a.refreshAccount();a.showSpin();check(h.buttons().filter(e=>/AD/.test(e.textContent)).every(e=>e.disabled),'Server daily ad spin cap disables rewarded action');a.chooseAge('teen');await settle();a.showSpin();check(!h.buttons().some(e=>/WATCH AD/.test(e.textContent)&&!e.disabled),'Teen cannot request rewarded spins');
  }
  {
    const {h,a,native}=await connected();let attempts=0;native.handlers.spin=(params,state)=>{if(++attempts===1)throw Error('Network interrupted after submission');state.profile.free_spin_day=day;state.profile.coins=1900;return{source:'free',reward:{kind:'coins',amount:100},profile:state.profile};};a.showSpin();h.button(/FREE.*SPIN|SPIN.*FREE/).dispatch('click');await settle();const first=native.calls.find(c=>c.method==='spin').params.request_id;check(typeof first==='string'&&first.length>=8,'Mutation uses an opaque operation ID');check([...h.storage.values()].some(value=>value.includes(first)),'Failed operation ID survives in device storage');a.showSpin();h.button(/FREE.*SPIN|SPIN.*FREE/).dispatch('click');await settle();check(native.calls.filter(c=>c.method==='spin').at(-1).params.request_id===first,'Retry reuses the original spin operation ID');check(a.serverProfile.coins===1900,'Retry does not locally duplicate the prize');
  }
  {
    const {h,a,native}=await connected();native.handlers.store=(params,state)=>{check(params.kind==='style'&&params.id==='astronaut','Premium character uses canonical style store contract');state.profile.diamonds=100;state.profile.owned_styles.push('astronaut');return{purchased:{kind:'style',id:'astronaut'},profile:state.profile};};a.showShop();h.button('◆ 100').dispatch('click');await settle();check(a.serverProfile.diamonds===100&&a.serverProfile.owned_styles.includes('astronaut'),'Premium ownership comes from server response');check(a.profile.wallet===0&&!a.profile.unlocked.includes('astronaut'),'Cloud purchase does not mint local guest entitlements');
    h.button('DIAMONDS').dispatch('click');await settle();h.button('$0.99').dispatch('click');await settle();check(native.calls.some(c=>c.method==='purchase'&&c.params.product_id==='diamonds_100'),'Diamond purchase launches with Play product ID');check(a.serverProfile.diamonds===100,'SDK purchase launch does not grant Diamonds');h.emit('subway-native',{detail:{type:'purchase_verified',payload:{profile:{diamonds:999999},status:'granted'}}});await settle();check(a.serverProfile.diamonds===100,'Native purchase event triggers server refresh and never trusts event balance');
    h.button('RECONCILE PURCHASES').dispatch('click');await settle();check(native.calls.some(c=>c.method==='products'&&c.params.reconcile===true),'Reconcile requests native Play purchase recovery');
  }
  {
    const {h,a,native}=await connected();a.chooseAge('teen');await settle();a.showShop();h.button('DIAMONDS').dispatch('click');h.button('$0.99').dispatch('click');check(a.screen==='parent','Minor paid action requires the existing parental gate');const hold=h.button('HOLD TO CONTINUE'),answer=h.descendants().find(e=>e.tagName==='INPUT');answer.value='0';hold.dispatch('pointerdown');h.tick(1400);check(a.screen==='parent'&&!native.calls.some(c=>c.method==='purchase'),'Incorrect parent answer cannot launch payment');const equation=h.descendants().find(e=>/^\d+ \+ \d+ = \?$/.test(e.textContent)),[x,y]=equation.textContent.match(/\d+/g).map(Number);answer.value=String(x+y);hold.dispatch('pointerdown');h.tick(600);hold.dispatch('pointerup');h.tick(800);check(a.screen==='parent','Releasing parent hold early cancels it');hold.dispatch('pointerdown');h.tick(1300);await settle();check(native.calls.some(c=>c.method==='purchase')&&a.serverProfile.diamonds===200,'Completed parent gate launches Play without granting a local purchase');
    a.showSettings('menu');h.button('PRIVACY POLICY').dispatch('click');check(a.screen==='parent','Minor external privacy link also uses parental gate');const staleHold=h.button('HOLD TO CONTINUE'),staleEquation=h.descendants().find(e=>/^\d+ \+ \d+ = \?$/.test(e.textContent));h.descendants().find(e=>e.tagName==='INPUT').value=String(staleEquation.textContent.match(/\d+/g).map(Number).reduce((sum,n)=>sum+n,0));staleHold.dispatch('pointerdown');h.emit('keydown',{key:'p'});h.tick(1300);await settle();check(!native.calls.some(c=>c.method==='open_privacy'),'Leaving parent gate invalidates its outstanding hold');
  }
  {
    const {h,a}=await connected({handlers:{catalog(){throw Error('Catalog offline');}}});a.showSpin();check(h.buttons().filter(e=>/SPIN/.test(e.textContent)).every(e=>e.disabled),'Missing canonical catalog disables every spin action');a.showShop();h.button('DIAMONDS').dispatch('click');check(h.buttons().filter(e=>/^\$/.test(e.textContent)).every(e=>e.disabled),'Missing canonical catalog disables paid product actions');
    const native=nativeService({handlers:{profile(){throw Error('Network unavailable');}}}),offline=boot(new Map(),native);offline.api.chooseAge('adult');await settle();offline.api.showSpin();check(offline.buttons().filter(e=>/SPIN/.test(e.textContent)).every(e=>e.disabled),'Unavailable authenticated profile disables wallet actions');offline.api.start();await settle();check(offline.api.sim.phase==='running','Service outage keeps the runner playable');
  }
  {
    const {h,a,native}=await connected();a.start();await settle();crash(a);native.handlers.reward=(params)=>({status:'pending',intent_id:'intent_revive_1',placement:'revive',run_id:params.run_id});await a.showRewardedRevive();check(a.sim.phase==='crashed'&&!a.sim._revived,'Pending server verification never revives');const request=native.calls.filter(c=>c.method==='reward').at(-1);await a.showRewardedRevive();check(native.calls.filter(c=>c.method==='reward').length===1&&native.calls.some(c=>c.method==='reward_refresh'),'Pending reward retry checks the existing intent without another ad');check([...h.storage.values()].some(value=>value.includes(request.params.request_id)),'Pending SSV operation remains durable until a terminal result');const verified={type:'reward',payload:{status:'granted',intent_id:'intent_revive_1',placement:'revive',run_id:request.params.run_id}};h.emit('subway-native',{detail:verified});await settle();check(a.sim.phase==='running'&&a.sim._revived,'Only confirmed server grant revives the matching run');crash(a);h.emit('subway-native',{detail:verified});const before=native.calls.filter(c=>c.method==='reward').length;await a.showRewardedRevive();check(native.calls.filter(c=>c.method==='reward').length===before&&a.sim.phase==='crashed','Duplicate verified event and repeated action cannot revive a run twice');
  }
  {
    const {h,a,native}=await connected();let complete;native.handlers.reward=params=>new Promise(resolve=>{complete=()=>resolve({status:'granted',run_id:params.run_id});});a.start();await settle();crash(a);const pending=a.showRewardedRevive();await settle();a.start();await settle();complete();await pending;check(a.sim.phase==='running'&&!a.sim._revived,'Late confirmed reward cannot revive a different run');
  }
  {
    const {h,a,native}=await connected();let attempts=0;native.handlers.run_finish=(params,state)=>{if(++attempts===1)throw Error('Offline finish');state.profile.coins=1811;return{run_id:params.run_id,coins_awarded:11,profile:state.profile};};a.start();await settle();crash(a);a.showMenu();await settle();const finish=native.calls.find(c=>c.method==='run_finish');check(finish&&typeof finish.params.request_id==='string','Signed-in finish submits a server operation');check([...h.storage.values()].some(value=>value.includes(finish.params.run_id)&&value.includes(finish.params.request_id)),'Unsent run record and operation ID are durably retained');a.start();await settle();const finishCalls=native.calls.filter(c=>c.method==='run_finish');check(finishCalls.length>=2&&finishCalls[1].params.request_id===finish.params.request_id,'Starting another run safely retries the previous finish');check(!('jumps' in finish.params)&&Number.isInteger(finish.params.distance),'Run finish payload matches canonical allowlist and integer units');check(a.serverProfile.coins===1811,'Only server-confirmed run coins update cloud wallet');
    const syncCalls=native.calls.filter(c=>c.method==='progress_save');for(const call of syncCalls)check(!['coins','diamonds','wallet','inventory','owned_styles'].some(key=>key in(call.params.progress||{})),'Cloud progress sync cannot import local currency or ownership');
  }
  {
    const {h,a,native}=await connected();a.start();await settle();let resolveUse;native.handlers.store=params=>new Promise(resolve=>{resolveUse=()=>{native.profile.inventory.magnet=0;resolve({consumed:{id:'magnet',quantity:1},run_id:params.run_id,profile:native.profile});};});h.button(/USE.*MAGNET/i).dispatch('click');await settle();check(a.sim.magnet===0,'Inventory click cannot activate before server consumption');resolveUse();await settle();check(a.sim.magnet>0&&a.serverProfile.inventory.magnet===0,'Confirmed inventory consumption activates matching run power');const call=native.calls.find(c=>c.method==='store');check(call.params.kind==='use_item'&&call.params.id==='magnet'&&!!call.params.run_id,'Inventory use is tied to canonical current server run');
  }
  {
    const {h,a,native}=await connected();a.showSettings('menu');h.button('DELETE MY ACCOUNT').dispatch('click');h.button(/DELETE.*(?:PERMANENT|ACCOUNT)|CONFIRM.*DELETE/i).dispatch('click');await settle();check(native.calls.some(c=>c.method==='delete_account'),'Delete confirmation invokes authenticated native deletion');check(a.identity.signedIn&&a.serverProfile,'Pending deletion retains account state until server confirms');native.handlers.delete_account=()=>({deleted:true,status:'deleted'});a.showSettings('menu');h.button('DELETE MY ACCOUNT').dispatch('click');h.button(/DELETE.*(?:PERMANENT|ACCOUNT)|CONFIRM.*DELETE/i).dispatch('click');await settle();check(!a.identity.signedIn&&!a.serverProfile,'Only explicit completed deletion clears cloud account state');
  }
  // Partial/malformed deletion confirmations must not sign a player out.
  for(const response of [{deleted:true,status:'deletion_pending'},{deleted:false,status:'deleted'}]){
    const {h,a,native}=await connected();native.handlers.delete_account=()=>response;
    a.showSettings('menu');h.button('DELETE MY ACCOUNT').dispatch('click');
    h.button(/DELETE.*(?:PERMANENT|ACCOUNT)|CONFIRM.*DELETE/i).dispatch('click');
    await settle();check(a.identity.signedIn&&a.serverProfile,'Both explicit server deletion fields are required before account state is cleared');
  }
  console.log(`WEB UI: ${checks} checks passed. Production app/simulation with DOM, renderer and native-service adapters; browser rendering, deployed backend and Android SDK/device behavior are not covered.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
