/* Measured setup stages: external game resources, not a fake moving timer. */
(function(){
 'use strict';
 const bar=document.getElementById('loading-bar'),label=document.getElementById('loading-percent'),status=document.getElementById('loading-status');
 if(!bar||!label||!status)return;
 let value=0;
 const stages={'assets/models.js':[52,'3D world models ready'],'assets/fox.js':[62,'Character models ready'],'assets/kenney_models.js':[67,'184 city and train meshes ready'],'assets/quaternius_props.js':[72,'Animal and robot props ready'],'assets/skinned_characters.js':[83,'Rigged characters and motion clips ready'],'skinned_player.js':[88,'Animation controller ready'],'simulation.js':[91,'Gameplay engine ready'],'renderer.js':[95,'Graphics engine ready'],'platform.js':[98,'Mobile services ready']};
 function update(percent,message){value=Math.max(value,percent);bar.style.width=value+'%';label.textContent=value+'%';status.textContent=message;}
 const visited=new WeakSet();
 function track(node){if(!node||node.tagName!=='SCRIPT'||visited.has(node))return;visited.add(node);const src=node.getAttribute('src')||'';const stage=stages[src];if(stage)node.addEventListener('load',()=>update(stage[0],stage[1]),{once:true});}
 const observer=new MutationObserver(changes=>{for(const change of changes)for(const node of change.addedNodes)track(node);});
 observer.observe(document.body,{subtree:true,childList:true});
 update(0,'Preparing your city…');
 window.RunnerLoadProgress={complete(){update(100,'City ready. Run!');observer.disconnect();requestAnimationFrame(()=>{const loading=document.getElementById('loading');if(loading)loading.remove();});}};
})();
