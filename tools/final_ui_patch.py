from pathlib import Path
p=Path(__file__).resolve().parents[1]/'web/app.js'
s=p.read_text()
s=s.replace("sfx:true,tap:false,musicVolume", "sfx:true,tap:false,haptics:true,musicVolume")
s=s.replace("['music','sfx','tap']", "['music','sfx','tap','haptics']")
s=s.replace("sound.effect('button');fn();", "sound.effect('button');if(profile&&profile.settings.haptics&&navigator.vibrate)navigator.vibrate(12);fn();")
s=s.replace("platform.call('set_age',{group}).catch(()=>{});showMenu();refreshAccount();", "platform.call('set_age',{group}).catch(()=>{});showPostAgeLoading();refreshAccount();")
pos=s.index('  function showAge(){')
s=s[:pos]+'''  // Second loading screen uses genuine asset-prewarm completion, never a fake timer percentage.
  function showPostAgeLoading(){
    const e=setScreen('post-age-loading','center shaded');
    const p=box('panel transition-panel',text('div','SUBWAY RUNNER','transition-logo'),
      text('h1','GET READY TO RUN!'),text('p','Finishing local sounds and city artwork…'));
    const bar=box('transition-track'),fill=box('transition-fill');bar.append(fill);
    const percent=text('strong','0%','transition-percent');p.append(bar,percent);e.append(p);
    const requests=[];
    const icon=new Image();requests.push(new Promise(resolve=>{icon.onload=icon.onerror=resolve;icon.src='assets/app-icon.png';if(icon.complete)resolve();}));
    if(arcadeAudio.supported)for(const filename of ['arcade_menu','arcade_run']){
      const a=arcadeAudio.get(filename);a.preload='auto';
      requests.push(new Promise(resolve=>{if(a.readyState>=2){resolve();return;}
        const finish=()=>{a.removeEventListener('loadeddata',finish);a.removeEventListener('error',finish);resolve();};
        a.addEventListener('loadeddata',finish,{once:true});a.addEventListener('error',finish,{once:true});
        try{a.load();}catch(_){finish();}
      }));
    }
    let done=0,finished=false;const ownScreen=screenGeneration;
    const next=()=>{if(finished||ownScreen!==screenGeneration)return;finished=true;showMenu();};
    const fallback=setTimeout(()=>{if(ownScreen===screenGeneration){percent.textContent='READY';next();}},3500);
    requests.forEach(request=>request.then(()=>{
      if(ownScreen!==screenGeneration||finished)return;
      done++;let pct=Math.round(done/requests.length*100);fill.style.width=pct+'%';percent.textContent=pct+'%';
      if(done===requests.length){clearTimeout(fallback);setTimeout(next,450);}
    }));
  }
''' +s[pos:]
s=s.replace("for(const [label,key]of [['Music','music'],['Sound effects','sfx'],['On-screen controls','tap']])", "for(const [label,key]of [['Music','music'],['Sound effects','sfx'],['Vibration & haptics','haptics'],['On-screen controls','tap']])")
s=s.replace("    p.append(text('p',syncStatus,'fine'),button(identity.signedIn?", "    p.append(box('settings-region',text('strong','Country / Region'),text('span',((navigator.language||'en').split('-')[1]||'Device default')+' · device setting')));\n    p.append(text('p',syncStatus,'fine'),button(identity.signedIn?")
s=s.replace("const list=box('shop-list');e.append(box('shop-scroll',list));", "const list=box('shop-list '+(tab==='diamonds'?'diamond-grid':''));e.append(box('shop-scroll',list));")
s=s.replace("const card=box('card pack-card',text('strong','◆ '+format(pack.diamonds)+' Diamonds'),text('p','Consumable Diamond pack · verified by the game server.'));", "const card=box('card pack-card diamond-tile',text('div','◆','diamond-icon'),text('strong',format(pack.diamonds)+' DIAMONDS'),text('p','Secure Play Store purchase'));" )
# Rebuild results with full body reserved stage rather than covering player
start=s.index('  function showResults(){')
end=s.index('  async function showRewardedRevive(){',start)
s=s[:start]+'''  function showResults(){
    const s=state(),e=setScreen('results','results-stage');
    e.append(box('results-character',text('span','FULL 3D RUNNER','eyebrow')));
    const p=box('panel results-panel');p.append(text('div','RUN COMPLETE','eyebrow'),text('h1','Your Run'),
      box('results-score-grid',box('result-stat',text('span','SCORE'),text('strong',format(s.score))),
      box('result-stat',text('span','COINS'),text('strong','● '+format(s.coins))),
      box('result-stat',text('span','DISTANCE'),text('strong',Math.floor(s.distance)+'m'))));
    if(s.score>profile.highScore)p.append(text('div','★ NEW HIGH SCORE!','best high-score-label'));
    if(bonus(s))p.append(text('div','MISSION BONUS  +'+bonus(s)+' coins','best'));
    p.append(button('RUN AGAIN  ›',startRun,'primary'),button('BACK TO MENU',showMenu),
      text('p','Run rewards are saved when you finish or start another run.','fine'));
    e.append(p);
  }
  function showRevivePrompt(){
    if(age!=='adult'||!identity.signedIn||!serverRunId||!canTransact()||!state().can_revive){
      return state().score>profile.highScore?showHighScore():showResults();
    }
    const e=setScreen('revive','center shaded'),p=box('panel revive-panel');
    p.append(text('div','ONE MORE CHANCE','eyebrow'),text('h1','Continue your run?'),
      text('div','↻','revive-icon'),text('p','Watch one voluntary rewarded ad to revive once in this run. Rewards require server verification.'),
      button('▶ WATCH AD · REVIVE',showRewardedRevive,'primary big'),
      button('NO THANKS',()=>state().score>profile.highScore?showHighScore():showResults()));e.append(p);
  }
  function showMultiplierReward(value){
    const e=setScreen('multiplier','center reward-stage'),p=box('reward-content');
    p.append(text('div','★','multiplier-star'),text('h1','+'+format(value||1)+' MULTIPLIER'),
      text('p','Your score multiplier is ready!'),
      button('TAP TO CONTINUE',()=>showSpin(),'reward-next'));
    e.append(p);sound.effect('reward');
  }
''' +s[end:]
s=s.replace("if(s.score>profile.highScore)showHighScore();else showResults();", "showRevivePrompt();")
s=s.replace("if(result.reward)toast('You received '+outcomeLabel(result.reward)+'.');", "if(result.reward){toast('You received '+outcomeLabel(result.reward)+'.');if(result.reward.kind==='multiplier'||result.reward.type==='multiplier')showMultiplierReward(Number(result.reward.amount)||1);}")
s=s.replace("if(entry.params.placement==='spin'&&result.reward)toast('You received '+outcomeLabel(result.reward)+'.');", "if(entry.params.placement==='spin'&&result.reward){toast('You received '+outcomeLabel(result.reward)+'.');if(result.reward.kind==='multiplier'||result.reward.type==='multiplier')showMultiplierReward(Number(result.reward.amount)||1);}")
s=s.replace("renderer.render(s,dt,currentStyle(),(screen==='shop'&&tab==='characters')||screen==='highscore')", "renderer.render(s,dt,currentStyle(),(screen==='shop'&&tab==='characters')||['highscore','results'].includes(screen),['highscore','results'].includes(screen)?screen:'')")
s=s.replace("else if(['shop','settings','parent','spin','delete'].includes(screen))", "else if(['shop','settings','parent','spin','delete','revive','multiplier'].includes(screen))")
# Music: local loops are the only backing tracks; no conflicting tone generator
s=s.replace("  if(!profile.settings.music||now<this.next)return;\n  this.next=now+320;const notes=[261.63,329.63,392,523.25,440,392,329.63,293.66];\n  this.tone(notes[this.note++%notes.length],.23,1,.065*(profile.settings.musicVolume??.58),'triangle');if(this.note%2===0)this.tone(65.4,.19,.8,.1*(profile.settings.musicVolume??.58));", "  // Original OGG loops are the sole background tracks: no overlapping synthesized melody.")
p.write_text(s)
