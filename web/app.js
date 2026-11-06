(function () {
  'use strict';
  const SAVE_KEY = 'subway-runner-player-v3';
  const LEGACY_SAVE_KEY = 'subway-runner-local-test-v2';
  const platform = window.RunnerPlatform || {available:()=>false,id:()=>Date.now().toString(36),call:()=>Promise.reject(new Error('Android services unavailable. Guest play is available.'))};
  const DIAMOND_PRODUCTS = [{id:'diamonds_100',diamonds:100},{id:'diamonds_500',diamonds:500},{id:'diamonds_1200',diamonds:1200},{id:'diamonds_2500',diamonds:2500}];
  const STYLES = [
    {id:'courier',name:'Kai',subtitle:'City courier · Quick Step',accent:'#ffbd72',type:'free'},
    {id:'skater',name:'Mira',subtitle:'Weekend skater · Long Slide',accent:'#7de8c6',type:'free'},
    {id:'sprinter',name:'Zuri',subtitle:'Track champion · High Jump',accent:'#f68ca5',type:'coins',cost:1200},
    {id:'robot',name:'Bolt',subtitle:'Metro mechanic · Extra Shield',accent:'#91b9ff',type:'coins',cost:3500},
    {id:'astronaut',name:'Nova',subtitle:'Space explorer · Soft Landing',accent:'#e8e4ff',type:'premium'},
    {id:'neon',name:'Flux',subtitle:'After-dark runner · Magnet Pulse',accent:'#bf9cff',type:'premium'},
    {id:'fox',name:'Fenn',subtitle:'Fox runner · Treasure Sense',accent:'#ff9859',type:'coins',cost:2800}
  ];
  const ui = document.getElementById('ui'), canvas = document.getElementById('game');
  let sim, renderer, profile, screen = 'age', age = 'unknown', preview = '', tab = 'characters';
  let runId = '', banked = true, crashDelay = -1, settingsReturn = 'menu', lastFrame = 0;
  let pointer = null, lastTap = -10000, toastTimer = 0, animationId = 0;
  let hudRefs = null, renderErrorShown = false, screenGeneration = 0;
  let identity={signedIn:false},serverProfile=null,serverCatalog=null,productDetails=[],syncStatus='Guest · saved on this device',busy=false,serverRunId='',serverRunLocalId='';
  const PENDING_KEY='subway-runner-pending-v1';
  const AGE_KEY='subway-runner-age-group-v1',AGE_GROUPS=['under13','teen','adult'];
  let ageReturn='',showcaseEl=null;
  const retryIds=new Map(), pending=new Map(), cloudRuns=new Map();
  let online=false, refreshing=null, cloudQueue=Promise.resolve(), accountGeneration=0, productsLoading=false;
  const format = n => Math.max(0,Math.floor(Number(n)||0)).toLocaleString('en-US');
  const text = (tag, value, className) => {const e=document.createElement(tag);e.textContent=value;if(className)e.className=className;return e;};
  const box = (className, ...children) => {const e=document.createElement('div');e.className=className;children.filter(Boolean).forEach(c=>e.appendChild(c));return e;};
  const button = (label, fn, type='') => {const b=text('button',label,'btn '+type);b.type='button';b.addEventListener('click',e=>{e.stopPropagation();sound.unlock();fn();});return b;};
  const defaults = () => ({version:3,wallet:0,highScore:0,bestDistance:0,runs:0,totalDistance:0,selected:'courier',unlocked:['courier','skater'],processed:[],settings:{quality:'medium',music:true,sfx:true,tap:false}});
  function load() {
    const p=defaults();
    try {const v=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');if(v&&v.version===3){
      for(const k of ['wallet','highScore','runs','bestDistance','totalDistance'])if(Number.isFinite(v[k]))p[k]=Math.max(0,Math.min(2000000000,Math.floor(v[k])));
      if(Array.isArray(v.unlocked))for(const id of v.unlocked)if(['sprinter','robot','fox'].includes(id)&&!p.unlocked.includes(id))p.unlocked.push(id);
      if(p.unlocked.includes(v.selected))p.selected=v.selected;
      if(Array.isArray(v.processed))p.processed=v.processed.filter(x=>typeof x==='string').slice(-256);
      if(v.settings){if(['low','medium','high'].includes(v.settings.quality))p.settings.quality=v.settings.quality;for(const k of ['music','sfx','tap'])if(typeof v.settings[k]==='boolean')p.settings[k]=v.settings[k];}
    }else{const legacy=JSON.parse(localStorage.getItem(LEGACY_SAVE_KEY)||'null');if(legacy&&legacy.version===2){for(const k of ['highScore','runs','bestDistance','totalDistance'])if(Number.isFinite(legacy[k]))p[k]=Math.max(0,legacy[k]);if(legacy.settings){if(['low','medium','high'].includes(legacy.settings.quality))p.settings.quality=legacy.settings.quality;for(const k of ['music','sfx','tap'])if(typeof legacy.settings[k]==='boolean')p.settings[k]=legacy.settings[k];}if(Array.isArray(legacy.unlocked))for(const id of legacy.unlocked)if(['sprinter','robot','fox'].includes(id)&&!p.unlocked.includes(id))p.unlocked.push(id);if(p.unlocked.includes(legacy.selected))p.selected=legacy.selected;p.legacyAvailable=true;}}}catch(_e){}
    return p;
  }
  function save(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(profile));}catch(_e){toast('Progress could not be saved on this device.');}}
  function toast(message){const e=document.getElementById('toast');e.textContent=message;e.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('visible'),3300);}
  function state(){return sim.snapshot();}
  function setScreen(name,className=''){screenGeneration++;screen=name;pointer=null;hudRefs=null;ui.replaceChildren();const e=box('screen '+className);ui.appendChild(e);return e;}
  function pause(){if(sim.phase==='running')sim.set_paused(true);}
  function coinBalance(){return identity.signedIn?Number(serverProfile&&serverProfile.coins)||0:profile.wallet;}
  function diamondBalance(){return identity.signedIn?Number(serverProfile&&serverProfile.diamonds)||0:0;}
  function ownedStyles(){return identity.signedIn?['courier','skater',...((serverProfile&&serverProfile.owned_styles)||[])]:profile.unlocked;}
  function canTransact(){return identity.signedIn&&online&&!!serverProfile&&!!serverCatalog&&platform.available()&&!busy;}
  function persistPending(){try{localStorage.setItem(PENDING_KEY,JSON.stringify({actions:[...pending],runs:[...cloudRuns]}));}catch(_){toast('Keep the app open until this request is confirmed. Device storage is unavailable.');}}
  function loadPending(){try{const saved=JSON.parse(localStorage.getItem(PENDING_KEY)||'{}');for(const [key,value]of saved.actions||[])if(typeof key==='string'&&value&&typeof value.request_id==='string'){pending.set(key,value);retryIds.set(key,value.request_id);}for(const [key,value]of saved.runs||[])if(typeof key==='string'&&value&&value.finish)cloudRuns.set(key,value);}catch(_){}}
  function actionKey(key){return (identity.uid||'guest')+':'+key;}
  function operationId(key){const scoped=actionKey(key);if(!retryIds.has(scoped))retryIds.set(scoped,platform.id());return retryIds.get(scoped);}
  function clearPending(key){pending.delete(key);retryIds.delete(key);persistPending();}
  function report(error){toast(error&&error.message||'This service is unavailable. Please try again.');}
  function repaintAccount(){if(screen==='menu')showMenu();else if(screen==='shop')showShop();else if(screen==='spin')showSpin();else if(screen==='settings')showSettings(settingsReturn);else if(screen==='results')showResults();}
  function applyServer(result){
    const remote=result&&result.profile;if(!remote||!identity.signedIn)return false;
    // Wallets and entitlements are read only from authenticated service replies.
    serverProfile=remote;online=true;profile.highScore=Math.max(profile.highScore,Number(remote.high_score)||0);profile.bestDistance=Math.max(profile.bestDistance,Number(remote.best_distance)||0);
    if(Array.isArray(remote.owned_styles)&&remote.owned_styles.includes(remote.selected_style))profile.selected=remote.selected_style;
    save();return true;
  }
  function normalizeIdentity(value){return {signedIn:value&&value.signed_in===true,uid:value&&typeof value.uid==='string'?value.uid:'',displayName:value&&typeof value.display_name==='string'?value.display_name:'',playGamesConfigured:value&&value.play_games_configured===true};}
  function acceptIdentity(value){const next=normalizeIdentity(value);if(next.uid!==identity.uid||next.signedIn!==identity.signedIn){accountGeneration++;serverProfile=null;online=false;serverRunId='';serverRunLocalId='';productDetails=[];}identity=next;}
  async function refreshAccount(retry=false){
    if(!platform.available()){syncStatus='Guest · saved on this device';return;}
    if(refreshing)return refreshing;
    refreshing=(async()=>{try{
      acceptIdentity(await platform.call('auth_status'));
      if(!identity.signedIn){syncStatus='Guest · saved on this device';return;}
      const generation=accountGeneration,owner=identity.uid;
      const results=await Promise.allSettled([platform.call('profile'),platform.call('catalog'),platform.call('products')]);
      if(owner!==identity.uid||generation!==accountGeneration)return;
      if(results[1].status==='fulfilled')serverCatalog=results[1].value.catalog||results[1].value;
      if(results[2].status==='fulfilled')loadProducts(results[2].value);
      if(results[0].status==='rejected'){online=false;syncStatus='Play Games connected · offline. Retry from Settings.';if(retry)report(results[0].reason);return;}
      applyServer(results[0].value);syncStatus='Play Games · cloud progress connected';
      if(retry){await retryCloudRuns();await retryActions();await syncProgress();await platform.call('reward_refresh').catch(report);}
    }catch(error){online=false;syncStatus=identity.signedIn?'Play Games connected · offline. Retry from Settings.':'Guest · sign-in unavailable';if(retry)report(error);}finally{refreshing=null;repaintAccount();}})();
    return refreshing;
  }
  async function signIn(){if(busy)return;busy=true;try{acceptIdentity(await platform.call('sign_in',{},180000));if(!identity.signedIn)toast('Sign-in was not completed. Guest play is available.');}catch(error){report(error);}finally{busy=false;}await refreshAccount();}
  function progressPayload(){const selected=ownedStyles().includes(profile.selected)?profile.selected:'courier';return {selected_style:selected,high_score:Math.floor(profile.highScore),best_distance:Math.floor(profile.bestDistance),settings:{music:profile.settings.music,sfx:profile.settings.sfx,quality:profile.settings.quality}};}
  async function syncProgress(){if(!identity.signedIn||!online)return;return perform('progress','progress_save',{progress:progressPayload()},null,{quiet:true});}
  async function perform(key,method,params,onSuccess,options={}){
    if(busy||!identity.signedIn||!online||!platform.available()){if(!options.quiet)toast('Sign in and connect to use this feature. Guest play remains available.');return null;}
    const scoped=actionKey(key),owner=identity.uid;let entry=pending.get(scoped);
    if(entry&&entry.method==='reward'&&entry.waiting){await platform.call('reward_refresh').catch(report);toast('Checking the pending reward. No additional ad will open.');return null;}
    if(!entry){entry={request_id:operationId(key),method,params,owner};pending.set(scoped,entry);persistPending();}
    busy=true;
    try{
      const result=await platform.call(entry.method,{...entry.params,request_id:entry.request_id},['reward','delete_account'].includes(entry.method)?180000:25000);
      if(identity.uid!==owner||!identity.signedIn)return null;
      if(entry.method==='reward'){
        entry.intent_id=result.intent_id||entry.intent_id;entry.waiting=['pending','skipped'].includes(result.status);persistPending();
        handleReward(result,entry,scoped);
      }else if(entry.method==='delete_account'){
        if(result.deleted===true&&result.status==='deleted')clearPending(scoped);
      }else{applyServer(result);clearPending(scoped);}
      if(onSuccess)onSuccess(result);return result;
    }catch(error){syncStatus='Request pending · retry from Settings';report(error);return null;}finally{busy=false;if(!options.quiet)repaintAccount();}
  }
  async function retryActions(){for(const [key,entry]of [...pending]){if(entry.owner!==identity.uid||!['progress_save','spin','store'].includes(entry.method))continue;const short=key.slice((identity.uid+':').length);await perform(short,entry.method,entry.params,null,{quiet:true});}}
  function loadProducts(result){productDetails=Array.isArray(result&&result.products)?result.products.filter(item=>DIAMOND_PRODUCTS.some(pack=>pack.id===(item.product_id||item.id))):[];}
  async function purchaseDiamonds(id){if(!canTransact()||!productDetails.some(item=>(item.product_id||item.id)===id))return;busy=true;try{const result=await platform.call('purchase',{product_id:id},180000);toast(result.status==='pending'?'Payment is pending. Diamonds appear after server verification.':'Google Play opened. Diamonds appear after server verification.');}catch(error){report(error);}finally{busy=false;}await refreshAccount();}
  async function storePurchase(id){if(!canTransact())return;const kind=id.startsWith('style_')?'style':id==='coins_1000'?'exchange':'item',itemId=kind==='style'?id.slice(6):id;await perform('store:'+kind+':'+itemId,'store',{kind,id:itemId},result=>{if(kind==='style'&&result.profile&&result.profile.owned_styles.includes(itemId)){profile.selected=itemId;preview='';save();}toast('Store balance updated.');});}
  function outcomeLabel(outcome){if(outcome.kind==='coins')return '● '+format(outcome.amount)+' coins';if(outcome.kind==='item')return format(outcome.amount)+' '+(outcome.item_id==='magnet'?'Magnet':'Shield');const style=STYLES.find(item=>item.id===outcome.style_id);return style?style.name+' runner':String(outcome.id||'Reward');}
  function showSpin(){
    pause();const e=setScreen('spin','center shaded'),p=box('panel spin-panel');p.append(text('div','A NEW CHANCE EVERY DAY','eyebrow'),text('h1','Daily spin'),text('p','One free spin per UTC day. Adults can watch up to two extra ads per UTC day. Diamond spins cost 20 Diamonds and have no daily limit.'),text('div','● '+format(coinBalance())+'   ◆ '+format(diamondBalance()),'stat-line'));
    const outcomes=serverCatalog&&serverCatalog.spin_outcomes;
    if(Array.isArray(outcomes)&&outcomes.length){const odds=box('spin-odds');odds.append(text('strong','Reward odds'));for(const item of outcomes)odds.append(text('div',outcomeLabel(item)+' · '+(Number(item.probability)*100).toFixed(2).replace(/\.00$/,'')+'%'));const duplicate=serverCatalog.duplicate_character_compensation;if(duplicate)p.append(text('p','Owned runner duplicates award '+format(duplicate.amount)+' coins.','fine'));p.append(odds);}else p.append(text('p','Connect and sign in to load the reward odds.','fine'));
    const day=serverProfile&&serverProfile.day_utc,free=serverProfile&&(typeof serverProfile.free_spins_remaining==='number'?serverProfile.free_spins_remaining:serverProfile.free_spin_day===day?0:1),adLeft=serverProfile&&(typeof serverProfile.ad_spins_remaining==='number'?serverProfile.ad_spins_remaining:Math.max(0,2-(serverProfile.ad_spins_day===day?serverProfile.ad_spins_used:0)));
    const ready=canTransact()&&Array.isArray(outcomes)&&outcomes.length>0;
    const freeButton=button('FREE SPIN · '+format(free)+' LEFT',()=>spin('free'),'primary');freeButton.disabled=!ready||!free;
    const adPending=[...pending.values()].some(item=>item.owner===identity.uid&&item.method==='reward'&&item.params.placement==='spin'&&item.waiting);
    const adButton=button(adPending?'CHECK PENDING AD SPIN':'WATCH AD · '+format(adLeft)+' EXTRA SPINS LEFT',()=>adPending?checkRewards():spin('ad'));adButton.disabled=age!=='adult'||!ready||(!adLeft&&!adPending);
    const paid=button('SPIN · ◆ '+format(serverCatalog&&serverCatalog.spin_cost||20),()=>protectedAction(()=>spin('diamonds')));paid.disabled=!ready||diamondBalance()<Number(serverCatalog.spin_cost||20);
    p.append(freeButton);if(age==='adult')p.append(adButton);p.append(paid,button('DONE',()=>sim.phase==='paused'?showPause():showMenu()));e.append(p);
  }
  async function spin(source){if(!canTransact()||!Array.isArray(serverCatalog.spin_outcomes)||!serverCatalog.spin_outcomes.length||source==='ad'&&age!=='adult')return;
    if(source==='ad')return perform('spin:ad','reward',{placement:'spin'},result=>{if(result.status!=='granted')toast('Reward verification is pending. Check again without watching another ad.');});
    return perform('spin:'+source,'spin',{source},result=>{if(result.reward)toast('You received '+outcomeLabel(result.reward)+'.');});
  }
  async function checkRewards(){await platform.call('reward_refresh').catch(report);toast('Checking pending reward verification.');}
  function handleReward(result,entry,key){
    if(!result||!entry||entry.owner!==identity.uid||!identity.signedIn)return;
    if(result.intent_id)entry.intent_id=result.intent_id;
    if(['pending','skipped'].includes(result.status)){entry.waiting=true;persistPending();return;}
    if(!['granted','expired','rejected','failed'].includes(result.status))return;
    if(result.status==='granted'){
      applyServer(result);
      if(entry.params.placement==='revive'&&result.run_id===entry.params.run_id&&serverRunId===result.run_id&&serverRunLocalId===runId&&!banked&&age==='adult'&&sim.phase==='crashed'&&state().can_revive){if(sim.revive()){showRunning();sound.effect('powerup');}}
      else if(entry.params.placement==='spin'&&result.reward)toast('You received '+outcomeLabel(result.reward)+'.');
    }
    clearPending(key);
  }
  async function useInventory(id){if(!canTransact()||!serverRunId||serverRunLocalId!==runId||banked||sim.phase!=='running'||!(serverProfile.inventory&&serverProfile.inventory[id]>0))return;
    const local=runId,remote=serverRunId;await perform('use:'+local+':'+id,'store',{kind:'use_item',id,run_id:remote},result=>{if(runId!==local||banked||result.run_id!==remote||!result.consumed||result.consumed.id!==id||!['running','paused'].includes(sim.phase))return;if(id==='magnet')sim.magnet=Math.max(sim.magnet,12);else sim.shield_charges=Math.min(3,sim.shield_charges+1);sound.effect('powerup');},{quiet:true});if(screen==='running')showRunning();
  }
  function showDeleteConfirmation(){pause();const e=setScreen('delete','center shaded'),p=box('panel');p.append(text('h1','Delete your account?'),text('p','This permanently deletes your cloud profile, Diamonds, items and runner unlocks. Google Play purchase records remain with Google. The app will request a fresh sign-in.'),button('DELETE PERMANENTLY',()=>perform('delete','delete_account',{},result=>{if(result.deleted===true&&result.status==='deleted'){acceptIdentity({signed_in:false});syncStatus='Account deleted · guest play available';showSettings(settingsReturn);toast('Your cloud account was deleted.');}else toast('Deletion has not been confirmed. Your account remains signed in.');}),'danger'),button('CANCEL',()=>showSettings(settingsReturn)));e.append(p);}
  function savedAge(){try{const value=localStorage.getItem(AGE_KEY);return AGE_GROUPS.includes(value)?value:'';}catch(_e){return '';}}
  function rememberAge(group){try{localStorage.setItem(AGE_KEY,group);}catch(_e){}}
  function chooseAge(group){if(!AGE_GROUPS.includes(group))return;age=group;rememberAge(group);platform.call('set_age',{group}).catch(()=>{});const back=ageReturn;ageReturn='';if(back==='settings')showSettings(settingsReturn);else showMenu();refreshAccount();}
  function showAge(){
    pause();const e=setScreen('age','center shaded'),p=box('panel age-panel'),fromSettings=ageReturn==='settings';
    p.append(text('div',fromSettings?'PLAYER SAFETY':'FIRST STOP · PLAYER SAFETY','eyebrow'),text('h1',fromSettings?'Change your age':'How old are you?'),text('p','Slide to choose your age. We only save an age group, never your birthday.'));
    const start=age==='under13'?10:age==='teen'?15:age==='adult'?25:16;
    const label=text('strong',start+' YEARS','age-value'),slider=document.createElement('input');
    slider.type='range';slider.min='6';slider.max='70';slider.value=String(start);slider.step='1';slider.className='age-slider';
    slider.setAttribute('aria-label','Select your age');
    slider.addEventListener('input',()=>{label.textContent=slider.value+(Number(slider.value)>=70?'+':'')+' YEARS';});
    p.append(label,slider,box('age-marks',text('span','6'),text('span','18'),text('span','70+')));
    p.append(button('CONTINUE',()=>{const years=Number(slider.value);chooseAge(years<13?'under13':years<18?'teen':'adult');},'primary big'));
    const quick=box('row age-quick');[['Under 13','under13'],['13–17','teen'],['18 or older','adult']].forEach(([caption,group])=>quick.append(button(caption,()=>chooseAge(group),'small')));p.append(quick);
    p.append(text('p','Rewarded ads are never automatic. They stay disabled for under-18 and unknown players.','fine'));
    if(fromSettings)p.append(button('CANCEL',()=>{ageReturn='';showSettings(settingsReturn);}));
    e.append(p);
  }
  function hero(value,className){const e=text('span','',className);e.setAttribute('data-text',value);e.append(text('span',value,'face'));return e;}
  function freeSpinReady(){if(!identity.signedIn||!serverProfile)return false;const day=serverProfile.day_utc;return typeof serverProfile.free_spins_remaining==='number'?serverProfile.free_spins_remaining>0:serverProfile.free_spin_day!==day;}
  function showMenu(){
    bankRun();sim.phase='ready';crashDelay=-1;
    const e=setScreen('menu','menu3d');
    const shop=button('SHOP',showShop,'menu-icon shop-btn');shop.setAttribute('aria-label','Runner shop');
    const settings=button('SETTINGS',()=>showSettings('menu'),'menu-icon settings-btn');settings.setAttribute('aria-label','Settings and Play Games sign-in');
    const ready=freeSpinReady(),wheel=box('spin-wheel');wheel.setAttribute('aria-hidden','true');
    const spinButton=button('DAILY SPIN',showSpin,'spin-widget'+(ready?' ready':''));spinButton.append(wheel);if(ready)spinButton.append(text('span','FREE','spin-badge'));
    const title=text('h1','','title3d');title.setAttribute('aria-label','Subway Runner');title.append(hero('SUBWAY','t3 line-a'),hero('RUNNER','t3 line-b'));
    const brand=box('menu-brand',title,box('city-chip',text('span','✦'),text('strong',renderer&&renderer.district?renderer.district.name:'SUNRISE CITY')));
    e.append(box('menu-top',shop,brand,box('menu-top-right',settings,spinButton)));
    const play=button('',startRun,'play3d');play.setAttribute('aria-label','Play');play.setAttribute('data-text','PLAY');play.append(text('span','PLAY','face'));e.append(box('menu-center',play));
    e.append(box('menu-foot',box('wallet-row',text('span','BEST  '+format(profile.highScore)),text('span','● '+format(coinBalance())+'   ◆ '+format(diamondBalance()),'coin')),text('p','Swipe to move · up to jump · down to slide\nDouble tap for shield','hint'),text('div',identity.signedIn?'PLAY GAMES · '+(identity.displayName||'CONNECTED'):syncStatus,'account-status')));
  }
  function currentStyle(){return preview||profile.selected;}
  function finishPayload(snapshot){return {score:Math.max(0,Math.floor(snapshot.score||0)),distance:Math.max(0,Math.floor(snapshot.distance||0)),coins:Math.max(0,Math.floor(snapshot.coins||0))};}
  async function finishCloudRun(record){
    if(!cloudRuns.has(record.local)||record.owner!==identity.uid||!identity.signedIn||!record.finish)return;
    if(!record.remote){const started=await platform.call('run_start',{request_id:record.start_request_id});record.remote=started.run_id;persistPending();}
    if(!record.remote)throw Error('The run service did not confirm this run. Retry from Settings.');
    const result=await platform.call('run_finish',{request_id:record.finish_request_id,run_id:record.remote,...record.finish});
    if(record.owner!==identity.uid||!identity.signedIn)return;
    applyServer(result);cloudRuns.delete(record.local);persistPending();
  }
  async function retryCloudRuns(){for(const record of [...cloudRuns.values()])if(record.owner===identity.uid&&record.finish)await finishCloudRun(record);}
  function queueCloudRun(local){
    const owner=identity.uid,record={local,owner,start_request_id:platform.id(),finish_request_id:platform.id(),remote:''};cloudRuns.set(local,record);persistPending();
    cloudQueue=cloudQueue.catch(()=>{}).then(async()=>{
      // Finishing the previous online run must succeed before a new online run
      // starts, because the server marks an older active run as abandoned.
      await retryCloudRuns();
      if(owner!==identity.uid||!identity.signedIn||!cloudRuns.has(local))return;
      const result=await platform.call('run_start',{request_id:record.start_request_id});
      record.remote=result.run_id||'';persistPending();
      if(owner!==identity.uid||!identity.signedIn)return;
      if(runId===local&&!banked){serverRunId=record.remote;serverRunLocalId=local;if(screen==='running')showRunning();else if(screen==='results')showResults();}
      if(record.finish)await finishCloudRun(record);
    }).catch(error=>{syncStatus='Run sync pending · retry from Settings';report(error);});
  }
  function startRun(){
    if(age==='unknown'){showAge();return;}
    bankRun();preview='';if(!ownedStyles().includes(profile.selected))profile.selected='courier';runId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);banked=false;crashDelay=-1;lastTap=-10000;
    serverRunId='';serverRunLocalId=runId;sim.start((Date.now()^Math.floor(Math.random()*0x7fffffff))>>>0, profile.selected);showRunning();sound.unlock();
    if(identity.signedIn)queueCloudRun(runId);
  }
  function showRunning(){
    const e=setScreen('running');e.className='hud';
    const pauseButton=button('Ⅱ',()=>{pause();showPause();},'icon');pauseButton.setAttribute('aria-label','Pause');
    const score=text('strong','000000');const scoreBox=box('pill hud-score',text('small','SCORE'),score);const coins=text('span','● 0','pill hud-coins');
    const shield=button('◇',()=>sim.use_shield(),'icon');shield.setAttribute('aria-label','Activate shield');
    const missions=text('div','','hud-missions'),powers=text('div','','hud-powers'),tutorial=text('div','SWIPE TO MOVE · UP TO JUMP\nDOWN TO SLIDE · DOUBLE TAP FOR SHIELD','hud-tutorial');
    e.append(box('hud-top',pauseButton,scoreBox,coins,shield),text('div',identity.signedIn?'PLAY GAMES · ONLINE FEATURES REQUIRE CONNECTION':'GUEST · LOCAL PROGRESS','hud-build'),missions,powers,tutorial);
    if(identity.signedIn&&serverProfile&&serverProfile.inventory){const items=box('inventory-controls');for(const id of ['magnet','shield'])if(serverProfile.inventory[id]>0){const use=button('USE '+id.toUpperCase()+' ('+format(serverProfile.inventory[id])+')',()=>useInventory(id),'small');use.disabled=!canTransact()||!serverRunId;items.append(use);}e.append(items);}
    if(profile.settings.tap){const controls=box('touch-row');[['‹',()=>sim.move_lane(-1)],['↑',()=>sim.jump()],['↓',()=>sim.slide()],['›',()=>sim.move_lane(1)]].forEach(([t,fn])=>controls.append(button(t,fn)));e.append(controls);}
    hudRefs={score,coins,shield,missions,powers,tutorial};
  }
  function showPause(){pause();const e=setScreen('pause','center shaded');const p=box('panel');p.append(text('div','TAKE A BREATHER','eyebrow'),text('h1','Your city can wait.'),text('p','Your run is paused.'),button('KEEP RUNNING',()=>{sim.set_paused(false);showRunning();},'primary'),button('SETTINGS',()=>showSettings('pause')),button('BACK TO MENU',showMenu));e.append(p);}
  function showShop(){
    pause();const e=setScreen('shop','shop-page');
    e.append(box('page-head',text('h2','Your run. Your style.'),text('span','● '+format(coinBalance())+'  ◆ '+format(diamondBalance()),'coin')));
    const tabs=box('row tabs');[['RUNNERS','characters'],['DIAMONDS','diamonds'],['ITEMS','items']].forEach(([label,id])=>tabs.append(button(label,()=>{tab=id;showShop();},tab===id?'primary':'')));e.append(tabs);
    if(tab==='characters'){
      const selected=STYLES.find(item=>item.id===(preview||profile.selected))||STYLES[0];
      const stage=box('runner-showcase',text('div','LIVE 3D CHARACTER PREVIEW','showcase-label'),text('strong',selected.name+' · '+selected.subtitle.split(' · ').pop(),'showcase-name'),text('span','Drag to turn · select PREVIEW below to inspect any runner','showcase-hint'));
      showcaseEl=stage;e.append(stage);
      let spinDrag=null;
      stage.addEventListener('pointerdown',event=>{spinDrag={x:event.clientX};if(renderer)renderer.showcaseDragging=true;if(stage.setPointerCapture){try{stage.setPointerCapture(event.pointerId);}catch(_e){}}});
      stage.addEventListener('pointermove',event=>{if(!spinDrag||!renderer)return;renderer.turnShowcase((event.clientX-spinDrag.x)*.014);spinDrag.x=event.clientX;});
      const endSpin=()=>{spinDrag=null;if(renderer)renderer.showcaseDragging=false;};
      stage.addEventListener('pointerup',endSpin);stage.addEventListener('pointercancel',endSpin);
    }
    const list=box('shop-list');e.append(box('shop-scroll',list));
    if(tab==='characters')for(const s of STYLES){
      const avatar=text('div',s.name[0],'avatar');avatar.style.color=s.accent;avatar.style.background=s.accent+'24';
      const info=box('card-copy',text('strong',s.name),text('p',s.subtitle));let pick;
      if(ownedStyles().includes(s.id)){pick=button(profile.selected===s.id?'SELECTED':'SELECT',()=>{profile.selected=s.id;preview='';save();syncProgress();showShop();},profile.selected===s.id?'primary':'');pick.disabled=profile.selected===s.id&&!preview;}
      else if(s.type==='coins'&&!identity.signedIn){pick=button('● '+format(s.cost),()=>{if(profile.wallet<s.cost){toast('Collect more coins to unlock '+s.name+'.');return;}profile.wallet-=s.cost;profile.unlocked.push(s.id);profile.selected=s.id;preview='';save();showShop();});}
      else {const priced=(serverCatalog&&serverCatalog.styles||[]).find(item=>item.id===s.id);pick=button(priced?(priced.currency==='coins'?'● ':'◆ ')+format(priced.cost):'SIGN IN FOR STORE',()=>protectedAction(()=>storePurchase('style_'+s.id)));pick.disabled=!priced||!canTransact();}
      const card=box('card',avatar,info,pick);card.append(button('PREVIEW',()=>{preview=s.id;showShop();toast(s.name+' · live 3D preview. Select an owned runner to race.');},'small'));list.append(card);
    }
    else if(tab==='diamonds')for(const pack of DIAMOND_PRODUCTS){
      const detail=productDetails.find(item=>(item.product_id||item.id)===pack.id),price=detail&&(detail.price||detail.formatted_price);
      const card=box('card pack-card',text('strong','◆ '+format(pack.diamonds)+' Diamonds'),text('p','Consumable Diamond pack · verified by the game server.'));
      const buy=button(price||'PRICE UNAVAILABLE',()=>protectedAction(()=>purchaseDiamonds(pack.id)),'primary');buy.disabled=!price||!canTransact();card.append(buy);list.append(card);
    }
    else {for(const item of (serverCatalog&&serverCatalog.items||[]).filter(item=>['magnet','shield'].includes(item.id))){const buy=button((item.currency==='coins'?'● ':'◆ ')+format(item.cost),()=>storePurchase(item.id));buy.disabled=!canTransact();list.append(box('card',box('card-copy',text('strong',item.name||item.id),text('p',(item.description||'Game item')+' · Owned '+format(serverProfile&&serverProfile.inventory&&serverProfile.inventory[item.id]))),buy));}
      const exchange=button('EXCHANGE',()=>protectedAction(()=>storePurchase('coins_1000')));exchange.disabled=!canTransact()||!(serverCatalog.items||[]).some(item=>item.id==='coins_1000');list.append(box('card pack-card',text('strong','Coin exchange'),text('p','◆ 10 → ● 1,000 coins'),exchange));
    }
    list.append(text('p',identity.signedIn?syncStatus:'Sign in for Diamond purchases, cloud items and secure server balances. Guest coin progress stays on this device.','footer-note'));
    e.append(box('row',button('RECONCILE PURCHASES',()=>platform.call('products',{reconcile:true}).then(result=>{loadProducts(result);return refreshAccount();}).catch(report)),button('DONE',()=>{preview='';sim.phase==='paused'?showPause():showMenu();},'primary')));
    if(!productDetails.length&&platform.available()&&!productsLoading){productsLoading=true;platform.call('products').then(result=>{loadProducts(result);if(screen==='shop'&&tab==='diamonds'&&productDetails.length)showShop();}).catch(()=>{}).finally(()=>{productsLoading=false;});}
  }
  function showSettings(returnTo){pause();settingsReturn=returnTo||settingsReturn;const e=setScreen('settings','center shaded');const p=box('panel');p.append(text('div','MAKE IT YOURS','eyebrow'),text('h1','Settings'));const pg=button(identity.signedIn?'PLAY GAMES · CONNECTED':'SIGN IN WITH PLAY GAMES',signIn,'play-games-btn');pg.prepend?pg.prepend(box('pg-logo')):pg.append(box('pg-logo'));p.append(pg,text('p',identity.signedIn?(identity.displayName||'Signed in'):syncStatus,'fine'),text('div','GRAPHICS','section-title'));const q=box('row');for(const quality of ['low','medium','high'])q.append(button(quality[0].toUpperCase()+quality.slice(1),()=>{profile.settings.quality=quality;renderer.setQuality(quality);save();showSettings(settingsReturn);},profile.settings.quality===quality?'primary':''));p.append(q,text('p','Try Low for smoother play or longer battery life.','fine'));
    for(const [label,key]of [['Music','music'],['Sound effects','sfx'],['On-screen controls','tap']]){const sw=button('',()=>{profile.settings[key]=!profile.settings[key];save();showSettings(settingsReturn);},'switch');sw.className='switch';sw.setAttribute('role','switch');sw.setAttribute('aria-label',label);sw.setAttribute('aria-checked',String(profile.settings[key]));p.append(box('toggle',text('span',label),sw));}
    p.append(button('CHANGE AGE',()=>{ageReturn='settings';showAge();}),button('SYNC PROGRESS',()=>refreshAccount(true)),button('CHECK PENDING REWARDS',checkRewards),button('PRIVACY POLICY',()=>protectedAction(()=>platform.call('open_privacy').catch(report))),button('AD PRIVACY OPTIONS',()=>platform.call('privacy_options',{},180000).catch(report)),button('ACCOUNT DELETION PAGE',()=>protectedAction(()=>platform.call('open_deletion').catch(report))),button('DELETE MY ACCOUNT',()=>protectedAction(showDeleteConfirmation)),button('DONE',()=>settingsReturn==='pause'?showPause():showMenu(),'primary'));if(identity.signedIn)p.append(button('SIGN OUT',async()=>{if(busy)return;try{acceptIdentity(await platform.call('sign_out'));syncStatus='Guest · saved on this device';showSettings(settingsReturn);}catch(error){report(error);}}));e.append(p);
  }
  function missions(s){return[{label:'500m',value:Math.min(500,Math.floor(s.distance||0)),target:500},{label:'25 coins',value:Math.min(25,s.coins||0),target:25},{label:'5 jumps',value:Math.min(5,s.jumps||0),target:5}];}
  function bonus(s){return missions(s).filter(m=>m.value>=m.target).length*100;}
  function bankRun(){if(!sim||!runId||banked)return;const s=state();banked=true;if(profile.processed.includes(runId))return;
    if(!identity.signedIn)profile.wallet=Math.min(2e9,profile.wallet+(s.coins||0)+bonus(s));
    profile.highScore=Math.max(profile.highScore,s.score||0);profile.bestDistance=Math.max(profile.bestDistance,s.distance||0);profile.totalDistance+=(s.distance||0);profile.runs++;profile.processed.push(runId);profile.processed=profile.processed.slice(-256);save();
    const record=cloudRuns.get(runId);if(record){record.finish=finishPayload(s);persistPending();cloudQueue=cloudQueue.catch(()=>{}).then(()=>retryCloudRuns()).catch(error=>{syncStatus='Run sync pending · retry from Settings';report(error);});}
    syncProgress();
  }
  function showResults(){
    const s=state();const e=setScreen('results','center shaded'),p=box('panel');p.append(text('div','THERE’S ALWAYS ANOTHER ROUTE','eyebrow'),text('h1','Nice run!'),text('div',format(s.score),'score-big'),text('div',Math.floor(s.distance)+'m travelled   ·   ● '+format(s.coins)+' collected','stat-line'));
    if(s.score>profile.highScore)p.append(text('div','NEW PERSONAL BEST','best'));if(bonus(s))p.append(text('div','MISSION BONUS  +'+bonus(s)+' coins','best'));p.append(button('RUN AGAIN  ›',startRun,'primary'));
    if(age==='adult'&&s.can_revive&&!banked&&identity.signedIn&&serverRunId){const waiting=pending.get(actionKey('revive:'+runId));const revive=button(waiting&&waiting.waiting?'CHECK PENDING REVIVE':'WATCH AD · REVIVE',showRewardedRevive);revive.disabled=!canTransact();p.append(revive);}p.append(button('BACK TO MENU',showMenu),text('p','Run rewards are saved when you finish or start another run.','fine'));e.append(p);
  }
  async function showRewardedRevive(){
    if(age!=='adult'||sim.phase!=='crashed'||banked||!state().can_revive||!identity.signedIn||!serverRunId)return;
    const ownRun=runId,remoteRun=serverRunId;pause();
    await perform('revive:'+ownRun,'reward',{placement:'revive',run_id:remoteRun},result=>{if(result.status!=='granted')toast(['pending','skipped'].includes(result.status)?'Reward verification is pending. Check again without watching another ad.':'Reward unavailable. No revive was granted.');});
  }
  function protectedAction(fn) {
    if(age==='adult'){fn();return;}
    pause();
    const previous=screen,a=13+Math.floor(Math.random()*13),b=7+Math.floor(Math.random()*12);
    const e=setScreen('parent','center shaded'),p=box('panel');
    p.append(text('div','FOR A GROWN-UP','eyebrow'),text('h1','Ask a parent.'),text('p','Please solve this, then hold to continue.'),text('div',a+' + '+b+' = ?','score-big'));
    const input=document.createElement('input');
    input.className='parent-input';input.type='number';input.inputMode='numeric';input.placeholder='Answer';input.setAttribute('aria-label','Parent answer');p.append(input);
    let timer=null,holding=false,attempt=0;
    const back=()=>previous==='settings'?showSettings(settingsReturn):showShop();
    const hold=button('HOLD TO CONTINUE',()=>{},'primary');
    const cancel=()=>{holding=false;attempt++;clearTimeout(timer);hold.textContent='HOLD TO CONTINUE';};
    hold.addEventListener('pointerdown',ev=>{
      ev.preventDefault();cancel();
      if(Number(input.value)!==a+b){toast('Please check the answer.');return;}
      holding=true;hold.textContent='KEEP HOLDING…';
      const ownAttempt=attempt,ownScreen=screenGeneration;
      timer=setTimeout(()=>{
        if(holding&&ownAttempt===attempt&&ownScreen===screenGeneration&&screen==='parent'&&!document.hidden){holding=false;attempt++;back();fn();}
      },1200);
    });
    for(const name of ['pointerup','pointerleave','pointercancel'])hold.addEventListener(name,cancel);
    p.append(hold,button('GO BACK',()=>{cancel();back();}));e.append(p);
  }
  function updateHUD(s){if(!hudRefs)return;hudRefs.score.textContent=String(Math.floor(s.score||0)).padStart(6,'0');hudRefs.coins.textContent='● '+format(s.coins);hudRefs.shield.disabled=(s.shield_charges||0)<=0;hudRefs.missions.textContent=missions(s).map(m=>(m.value>=m.target?'✓ ':'')+m.label+' '+m.value+'/'+m.target).join('  ·  ');const powers=[];if(s.shield>0)powers.push('SHIELD '+Math.ceil(s.shield)+'s');if(s.magnet>0)powers.push('MAGNET '+Math.ceil(s.magnet)+'s');if(s.double_score>0)powers.push('SCORE ×2');hudRefs.powers.textContent=powers.join('  ·  ');hudRefs.tutorial.style.display=(s.elapsed||0)<6?'block':'none';}
  function onSimEvent(kind,payload){if(kind==='crash'){
      crashDelay=.82;sound.effect('crash');
      const burst=box('crash-burst');burst.setAttribute('aria-hidden','true');
      for(let n=0;n<7;n++){const star=text('span','★');star.style.setProperty('--angle',n*360/7+'deg');star.style.setProperty('--delay',n*30+'ms');burst.append(star);}ui.append(burst);
    }else sound.effect(kind);}
  function frame(now){
    const dt=lastFrame?Math.min(.075,Math.max(0,(now-lastFrame)/1000)):1/60;lastFrame=now;
    try{if(screen==='running'&&sim.phase==='running')sim.update(dt);const s=state();const inShowcase=screen==='shop'&&tab==='characters';if(renderer){if(renderer.setShowcaseRect)renderer.setShowcaseRect(inShowcase&&showcaseEl&&typeof showcaseEl.getBoundingClientRect==='function'?showcaseEl.getBoundingClientRect():null);renderer.render(s,dt,currentStyle(),inShowcase);}if(screen==='running')updateHUD(s);if(crashDelay>=0){crashDelay-=dt;if(crashDelay<0&&sim.phase==='crashed')showResults();}sound.tick(now,screen==='running'&&sim.phase==='running',s,soundMode());}catch(error){if(!renderErrorShown){renderErrorShown=true;toast('Graphics error: '+error.message);console.error(error);}}
    animationId=requestAnimationFrame(frame);
  }
  function togglePause(){if(screen==='running'){pause();showPause();}else if(screen==='pause'){sim.set_paused(false);showRunning();}else if(['shop','settings','parent','spin','delete'].includes(screen)){sim.phase==='paused'?showPause():showMenu();}}
  function beginPointer(e){if(screen!=='running'||sim.phase!=='running')return;if(pointer&&pointer.id!==e.pointerId){pointer=null;lastTap=-10000;return;}pointer={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};canvas.setPointerCapture&&canvas.setPointerCapture(e.pointerId);}
  function movePointer(e){if(!pointer||pointer.id!==e.pointerId)return;const x=e.clientX-pointer.x,y=e.clientY-pointer.y;if(Math.hypot(x,y)<26)return;pointer=null;lastTap=-10000;if(Math.abs(x)>Math.abs(y))sim.move_lane(x>0?1:-1);else y<0?sim.jump():sim.slide();e.preventDefault();}
  function endPointer(e){if(!pointer||pointer.id!==e.pointerId)return;movePointer(e);if(pointer){const now=performance.now();if(now-pointer.t<250&&now-lastTap<300){sim.use_shield();lastTap=-10000;}else lastTap=now;pointer=null;}}
  canvas.addEventListener('pointerdown',beginPointer);canvas.addEventListener('pointermove',movePointer,{passive:false});canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',()=>{pointer=null;lastTap=-10000;});
  window.addEventListener('keydown',e=>{if(e.target&&['INPUT','TEXTAREA'].includes(e.target.tagName))return;if(e.repeat)return;const k=e.key.toLowerCase();if(['escape','p'].includes(k)){e.preventDefault();togglePause();return;}if(screen!=='running')return;const actions={arrowleft:()=>sim.move_lane(-1),a:()=>sim.move_lane(-1),arrowright:()=>sim.move_lane(1),d:()=>sim.move_lane(1),arrowup:()=>sim.jump(),w:()=>sim.jump(),' ':()=>sim.jump(),arrowdown:()=>sim.slide(),s:()=>sim.slide(),h:()=>sim.use_shield()};if(actions[k]){e.preventDefault();actions[k]();}});
  document.addEventListener('visibilitychange',()=>{pointer=null;lastFrame=0;if(document.hidden&&screen==='running'){pause();showPause();}if(document.hidden){screenGeneration++;sound.suspend();}});
  window.addEventListener('blur',()=>{screenGeneration++;pointer=null;if(screen==='running'){pause();showPause();}});
  window.addEventListener('resize',()=>{if(renderer)renderer.resize();});
  window.addEventListener('subway-back',togglePause);
  window.addEventListener('subway-native',event=>{
    const detail=event.detail||{},type=detail.type,payload=detail.payload||{};
    if(['ad_state','lifecycle'].includes(type)&&payload.paused===true){screenGeneration++;pointer=null;lastTap=-10000;pause();sound.suspend();if(screen==='running')showPause();return;}
    if(type==='reward'){
      for(const [key,entry]of [...pending]){
        if(entry.method!=='reward'||entry.owner!==identity.uid||entry.params.placement!==payload.placement)continue;
        if(entry.intent_id&&entry.intent_id!==payload.intent_id)continue;
        if(entry.params.placement==='revive'&&entry.params.run_id!==payload.run_id)continue;
        handleReward(payload,entry,key);
      }
      refreshAccount();return;
    }
    // Purchase callbacks only trigger an authenticated profile read. The SDK
    // event itself is never proof of a wallet credit or entitlement.
    if(['auth','purchase','profile','profile_refresh','purchase_verified'].includes(type))refreshAccount();
  });
  const sound=window.RunnerAudio?window.RunnerAudio.create({settings:()=>profile&&profile.settings}):{unlock(){},suspend(){},effect(){},tick(){}};
  function soundMode(){if(screen==='running')return sim.phase==='running'?'run':'hush';return ['menu','shop','settings','spin','results','age'].includes(screen)?'menu':'hush';}
  ['pointerdown','touchstart','keydown'].forEach(name=>document.addEventListener(name,()=>sound.unlock(),{passive:true}));
  try {
    if(typeof RunnerSimulation!=='function'||typeof RunnerRenderer!=='function'||!window.RUNNER_MODELS)throw Error('Game assets are missing. Please download the complete APK.');
    profile=load();loadPending();sim=new RunnerSimulation();sim.onEvent=onSimEvent;sim.start(421);sim.phase='ready';renderer=new RunnerRenderer(canvas,window.RUNNER_MODELS);renderer.setQuality(profile.settings.quality);renderer.resize();if(window.RunnerLoadProgress)window.RunnerLoadProgress.complete();else document.getElementById('loading').remove();save();{const remembered=savedAge();if(remembered){age=remembered;platform.call('set_age',{group:remembered}).catch(()=>{});showMenu();}else{showAge();platform.call('set_age',{group:'unknown'}).catch(()=>{});}}if(platform.available())refreshAccount();animationId=requestAnimationFrame(frame);
    window.subwayRunner={sim,renderer,get profile(){return profile;},get screen(){return screen;},get age(){return age;},chooseAge,start:startRun,showMenu,showShop,showSettings,showResults,showRewardedRevive,showSpin,signIn,refreshAccount,get serverProfile(){return serverProfile;},get identity(){return identity;},bankRun,bonus,controls:{beginPointer,movePointer,endPointer,togglePause},stop(){cancelAnimationFrame(animationId);sound.suspend();}};
  }catch(error){document.getElementById('loading').remove();const e=setScreen('error','center shaded');e.append(box('panel error-panel',text('h1','The city needs a restart.'),text('p',error.message),button('TRY AGAIN',()=>location.reload(),'primary')));console.error(error);}
})();
