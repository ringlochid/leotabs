// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
export async function checkAutoUpdate({app,rpc,results,delay,origin}) {
 const wait=async(fn,msg)=>{for(let i=0;i<80;i++){if(await fn())return;await delay(75);}throw Error(msg);};
 const wid=(await app.evaluate('chrome.tabs.getCurrent()')).windowId;
 await rpc('settings',{settings:{autoGroup:false,autoUpdateDefault:true}});
 await rpc('import',{collections:[{name:'Audit A',autoUpdate:true,groups:[],links:[]},{name:'Audit B',autoUpdate:false,groups:[],links:[]}]});
 const state=(await rpc('load')).state,a=state.collections.find(c=>c.name==='Audit A'),b=state.collections.find(c=>c.name==='Audit B');
 await rpc('switch',{windowId:wid,destinationId:a.id});
 const get=async()=> (await rpc('load')).state.collections.find(c=>c.id===a.id);
 const actual=async()=>{const d=await rpc('load');return d.tabs.filter(t=>t.windowId===wid&&!t.pinned&&(t.resourceUrl||t.url).startsWith(origin)).sort((a,b)=>a.index-b.index).map(t=>{const g=d.groups.find(g=>g.id===t.groupId);return [t.resourceUrl||t.url,g?.title||null,g?.color||null,g?.collapsed||false]});};
 const mirrored=async(label)=>{await wait(async()=>{const c=await get(),saved=c.links.map(l=>{const g=c.groups.find(g=>g.id===l.groupId);return [l.url,g?.name||null,g?.color||null,g?.collapsed||false]});return JSON.stringify(saved)===JSON.stringify(await actual());},label+' did not mirror');assert.equal((await get()).autoUpdate,true,label+' paused auto-update');results.push(label);};
 const tabs=await app.evaluate(`Promise.all(Array.from({length:4},(_,i)=>chrome.tabs.create({windowId:${wid},url:${JSON.stringify(origin)}+'/audit/'+i,active:false})))`);
 await mirrored('New tabs mirror');
 const gid=await app.evaluate(`chrome.tabs.group({tabIds:${JSON.stringify(tabs.slice(0,2).map(t=>t.id))}})`);
 await app.evaluate(`chrome.tabGroups.update(${gid},{title:'Research',color:'green',collapsed:true})`);await mirrored('Native grouping, name, colour and collapse mirror');
 await app.evaluate(`chrome.tabGroups.move(${gid},{index:-1})`);await mirrored('Moving native groups mirrors order');
 await rpc('group-sort',{windowId:wid});await mirrored('Group & sort mirrors without pausing');
 await rpc('move-open-tabs',{windowId:wid,tabIds:[tabs[0].id],groupId:-1});await mirrored('Neo drag/ungroup operation mirrors without pausing');
 await app.evaluate(`chrome.tabs.update(${tabs[1].id},{url:${JSON.stringify(origin)}+'/navigated'})`);await mirrored('Navigation mirrors');
 await app.evaluate(`chrome.tabs.update(${tabs[2].id},{pinned:true})`);await mirrored('Pinning excludes the tab');
 await app.evaluate(`chrome.tabs.update(${tabs[2].id},{pinned:false})`);await mirrored('Unpinning includes the tab');
 await rpc('collection-auto-update',{windowId:wid,collectionId:a.id,enabled:false});const paused=JSON.stringify((await get()).links);
 await app.evaluate(`chrome.tabs.create({windowId:${wid},url:${JSON.stringify(origin)}+'/paused',active:false})`);await delay(500);assert.equal(JSON.stringify((await get()).links),paused);results.push('Paused collection does not mirror later browsing');
 await rpc('collection-auto-update',{windowId:wid,collectionId:a.id,enabled:true});await mirrored('Resume captures current tabs');
 await rpc('settings',{settings:{autoUpdateDefault:false}});assert.equal((await get()).autoUpdate,false);assert.equal((await rpc('load')).sessionState.active[wid].tracking,false);
 await rpc('settings',{settings:{autoUpdateDefault:true}});await mirrored('Global On/Off updates active tracking');
 // Characterize the currently surprising saved-card edit path explicitly.
 await rpc('edit',{kind:'group-links',collectionId:a.id,linkIds:(await get()).links.slice(0,2).map(l=>l.id),groupId:'saved-edit-fixture'});
 assert.equal((await get()).autoUpdate,false);assert.equal((await get()).autoUpdatePausedReason,'Saved list edited');results.push('AUDIT GAP: saved-card grouping pauses auto-update instead of editing native groups');
 await rpc('collection-auto-update',{windowId:wid,collectionId:a.id,enabled:true});await mirrored('Resume after saved-card editing restores mirroring');
 await rpc('edit',{kind:'collection',collectionId:a.id,note:'Keep this note'});assert.equal((await get()).autoUpdate,true);results.push('Editing collection notes keeps tracking on');
 const beforeSwitchCount=(await rpc('load')).state.collections.length;
 await app.evaluate(`document.querySelector('[data-collection-id="${b.id}"] .collection-switch').click()`);
 // Block queued checkpoints until the switch request: the UI must perform its own final capture.
 await app.evaluate(`chrome.runtime.sendMessage({action:'interaction-drag',data:{active:true}})`);
 const extra=await app.evaluate(`chrome.tabs.create({windowId:${wid},url:${JSON.stringify(origin)}+'/before-switch',active:false})`);
 await app.evaluate(`document.querySelector('#dialog footer .primary').click()`);
 await wait(async()=>(await rpc('load')).sessionState.active[wid]?.collectionId===b.id,'Switch did not finish');
 assert((await get()).links.some(l=>l.url===origin+'/before-switch'));assert.equal((await rpc('load')).state.collections.length,beforeSwitchCount);results.push('Switch saves outgoing collection without creating a duplicate collection');
 await rpc('interaction-drag',{active:false});
 await rpc('switch',{windowId:wid,destinationId:a.id});await mirrored('Switching back restores saved collection');
 const snapshot=JSON.stringify((await get()).links);
 const live=(await rpc('load')).tabs.filter(t=>t.windowId===wid&&(t.resourceUrl||t.url).startsWith(origin));
 await rpc('save',{tabIds:[live[0].id],close:true});assert.equal((await get()).autoUpdate,false);await delay(500);assert.equal(JSON.stringify((await get()).links),snapshot);results.push('Partial stash pauses before closing and preserves the full source collection');
 await rpc('collection-auto-update',{windowId:wid,collectionId:a.id,enabled:true});await mirrored('Explicit resume after stash mirrors the remaining tabs');
 const remaining=(await actual()).length;await rpc('close-collection',{windowId:wid,collectionId:a.id});
 assert.equal((await get()).links.length,remaining);assert(!(await rpc('load')).sessionState.active[wid]);results.push('Close collection preserves contents and detaches before closure');
}
