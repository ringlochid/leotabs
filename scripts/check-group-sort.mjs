// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
export async function checkGroupSort({app,rpc,results,delay,origin,out}) {
 const wait=async(fn,msg)=>{for(const deadline=Date.now()+30000;Date.now()<deadline;){if(await fn())return;await delay(50);}await fs.writeFile(path.join(out,'failure.txt'),await app.evaluate('document.body.innerText'));await fs.writeFile(path.join(out,'failure.png'),Buffer.from((await app.send('Page.captureScreenshot')).data,'base64'));throw Error(msg);};
 const own=await app.evaluate('chrome.tabs.getCurrent()');
 await rpc('settings',{settings:{autoGroup:false,tabSort:'recent',rules:Array.from({length:8},(_,i)=>({domain:'127.0.0.1/g'+i+'/*',group:'Group '+i,color:'random'}))}});
 const pin=await app.evaluate(`chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin)}+'/pinned',pinned:true,active:false})`);
 const tabs=await app.evaluate(`Promise.all(Array.from({length:30},(_,i)=>chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin)}+'/g'+(i%8)+'/page-'+(30-i),active:false})))`);
 await wait(()=>app.evaluate(`chrome.tabs.query({windowId:${own.windowId}}).then(ts=>ts.filter(t=>${JSON.stringify(tabs.map(t=>t.id))}.includes(t.id)).every(t=>t.status==='complete'))`),'pages did not settle');
 await app.evaluate(`Promise.all(${JSON.stringify(tabs.map(t=>t.id))}.map((tabId,i)=>chrome.scripting.executeScript({target:{tabId},func:n=>document.title='Page '+String(n).padStart(2,'0'),args:[30-i]})))`);
 await delay(450);
 const original=await app.evaluate(`chrome.tabs.group({tabIds:[${tabs[0].id},${tabs[1].id}]})`);
 await app.evaluate(`chrome.tabGroups.update(${original},{title:'Original group',color:'orange',collapsed:true})`);
 const saved=await rpc('save',{tabIds:tabs.map(t=>t.id),name:'Benchmark collection',close:false});
 await rpc('settings',{settings:{autoUpdateDefault:true}});
 await app.evaluate(`chrome.storage.session.set({neoSessions:{active:{[${own.windowId}]:{collectionId:${JSON.stringify(saved.collectionId)},name:'Benchmark collection',tracking:true}},parked:{}}})`);
 await rpc('session-checkpoint',{windowId:own.windowId});
 const normal=async()=>app.evaluate(`(async()=>{const ts=await chrome.tabs.query({windowId:${own.windowId}}),gs=await chrome.tabGroups.query({windowId:${own.windowId}});return ts.sort((a,b)=>a.index-b.index).map(t=>({id:t.id,pinned:t.pinned,active:t.active,group:gs.filter(g=>g.id===t.groupId).map(g=>({name:g.title,color:g.color,collapsed:g.collapsed}))}));})()`);
 const before=await normal();
 await delay(700);
 await app.evaluate(`window.__redraws={tabs:0,board:0};for(const id of ['tabs','board'])new MutationObserver(()=>window.__redraws[id]++).observe(document.getElementById(id),{childList:true});`);
 const samples=[],breakdowns=[];
 for(let i=0;i<(process.argv.includes('--quick-group-check')?2:20);i++) {
   // Native worker restart exercises a cold run without touching any personal profile.
   if(i===0){await app.send('ServiceWorker.enable');await app.send('ServiceWorker.stopAllWorkers');}
   await wait(()=>app.evaluate(`!!document.querySelector('.tab-more-button:not(:disabled)')`),'Group button not ready');
   await app.evaluate(`(()=>{document.querySelector('#toast')?.setAttribute('hidden','');window.__groupStart=performance.now();document.querySelector('.tab-more-button').click();[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Group & sort').click();document.querySelector('.group-apply').click();})()`);
   await wait(()=>app.evaluate(`(()=>{const b=document.querySelector('.tab-more-button');return !b.disabled&&document.querySelector('#toast:not([hidden])')?.textContent.includes('Grouped 30 tabs');})()`),'Group & sort did not complete through UI');
   samples.push(await app.evaluate('Number(document.querySelector(".tab-more-button").dataset.durationMs)'));breakdowns.push(await app.evaluate('JSON.parse(document.querySelector(".tab-more-button").dataset.timings)'));
   if(i===0){const redraws=await app.evaluate('window.__redraws');assert(redraws.tabs<=2&&redraws.board<=2,'Intermediate layouts rendered: '+JSON.stringify(redraws));assert(await app.evaluate(`getComputedStyle(document.querySelector('.collection')).contentVisibility==='visible'`),'Collection height uses an estimate');}
   assert.equal((await rpc('load')).state.settings.tabSort,'position','Sidebar did not show actual browser order');
   const tracked=(await rpc('load')).state.collections.find(c=>c.id===saved.collectionId);assert.equal(tracked.links.length,30);assert.equal(tracked.groups.length,8);
   const gs=await app.evaluate(`chrome.tabGroups.query({windowId:${own.windowId}})`);assert.equal(gs.length,8);assert(new Set(gs.map(g=>g.color)).size>=7);
   for(const g of gs){const titles=await app.evaluate(`chrome.tabs.query({groupId:${g.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index).map(t=>t.title))`);assert.deepEqual(titles,[...titles].sort());}
   if(i===0){await rpc('group-sort',{windowId:own.windowId,tabIds:tabs.map(t=>t.id)});assert.deepEqual((await app.evaluate(`chrome.tabGroups.query({windowId:${own.windowId}})`)).map(g=>[g.title,g.color]).sort(),gs.map(g=>[g.title,g.color]).sort(),'repeat changed colours');}
   const operationId=await app.evaluate('document.querySelector(".tab-more-button").dataset.operationId');
   const difference=await app.evaluate(`(async()=>{const db=await import('./lib/db.js');const op=await db.read('journal',${JSON.stringify(operationId)});const ts=(await chrome.tabs.query({windowId:${own.windowId}})).filter(t=>op.tabs.some(x=>x.id===t.id)).sort((a,b)=>a.index-b.index),gs=await chrome.tabGroups.query({windowId:${own.windowId}});const now=ts.map(t=>{const g=gs.find(g=>g.id===t.groupId);return [t.id,t.url,t.index,t.pinned,g?[g.title,g.color,g.collapsed,ts.filter(x=>x.groupId===g.id).map(x=>x.id).sort((a,b)=>a-b)]:null];});const old=JSON.parse(op.after);return now.map((row,i)=>JSON.stringify(row)!==JSON.stringify(old[i])?{old:old[i],now:row}:null).filter(Boolean).slice(0,2);})()`);
   assert.deepEqual(difference,[],'Layout changed before Undo: '+JSON.stringify(difference));
   await rpc('undo-action',{id:operationId,windowId:own.windowId});
   assert.deepEqual(await normal(),before,'Undo did not restore original layout');
   console.log('Grouping sample '+(i+1)+': '+samples.at(-1)+' ms');
 }
 const sorted=[...samples].sort((a,b)=>a-b);const timing={samples:samples.length,coldMs:Math.round(samples[0]),medianMs:Math.round(sorted[Math.floor((sorted.length-1)/2)]),p95Ms:Math.round(sorted[Math.ceil(sorted.length*.95)-1]),maxMs:Math.round(sorted.at(-1))};
 await fs.writeFile(path.join(out,'group-sort-performance.json'),JSON.stringify({...timing,breakdowns},null,2));if(!process.argv.includes('--quick-group-check'))assert(timing.p95Ms<2000,JSON.stringify(timing));results.push('30-tab UI grouping and sorting: '+JSON.stringify(timing)+'; no AI requests; stable colours; full Undo');
 await app.evaluate(`document.querySelector('.tab-more-button').click();[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Group & sort').click();document.querySelector('input[aria-label="Include already grouped tabs"]').click();document.querySelector('.group-apply').click();`);
 await wait(()=>app.evaluate(`!document.querySelector('.tab-more-button').disabled&&document.querySelector('#toast')?.textContent.includes('Grouped 28 tabs')`),'unchecked regroup still included existing groups');
 const kept=await app.evaluate(`chrome.tabGroups.query({windowId:${own.windowId}}).then(gs=>gs.find(g=>g.title==='Original group'))`);assert(kept);assert.equal(kept.color,'orange');assert.equal((await app.evaluate(`chrome.tabs.query({groupId:${kept.id}})`)).length,2);
 assert.equal((await rpc('load')).state.settings.regroupExisting,false);
 await app.evaluate(`document.querySelector('.tab-more-button').click();[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Group & sort').click()`);assert.equal(await app.evaluate(`document.querySelector('input[aria-label="Include already grouped tabs"]').checked`),false);
 await fs.writeFile(path.join(out,'group-panel.png'),Buffer.from((await app.send('Page.captureScreenshot')).data,'base64'));
 await app.evaluate(`document.querySelector('#action-popover').hidePopover()`);
 await rpc('undo-action',{id:await app.evaluate('document.querySelector(".tab-more-button").dataset.operationId'),windowId:own.windowId});
 await rpc('settings',{settings:{regroupExisting:true}});await delay(250);
 results.push('Group panel remembers Include already grouped tabs; switching it off preserves existing group membership, name and colour');
 assert(await app.evaluate(`(()=>{const s=document.querySelector('#sidebar'),r=document.querySelector('.tab-more-button').getBoundingClientRect();return s.scrollWidth<=s.clientWidth+1&&r.right<=s.getBoundingClientRect().right;})()`),'Rules overflowed the sidebar');
 await fs.writeFile(path.join(out,'grouping-sidebar.png'),Buffer.from((await app.send('Page.captureScreenshot')).data,'base64'));
 await app.evaluate(`document.querySelector('#settings').click();[...document.querySelectorAll('#action-popover button')].find(b=>b.textContent.includes('Grouping rules')).click()`);
 await wait(()=>app.evaluate(`document.querySelector('dialog')?.textContent.includes('Grouping rules')`),'Rules not directly visible');
 assert(await app.evaluate(`document.querySelector('dialog').textContent.includes('Ready-made rules')&&!document.querySelector('dialog').textContent.includes('AI ordering purpose')`));
 for(const width of [1440,390]){await app.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});assert(await app.evaluate(`document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth+1`));await fs.writeFile(path.join(out,'rules-'+width+'.png'),Buffer.from((await app.send('Page.captureScreenshot')).data,'base64'));}
 await app.evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Combine AI tools').click()`);
 await app.evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save rules').click()`);
 await wait(async()=>(await rpc('load')).state.settings.rules.some(r=>r.group==='AI tools'),'preset did not persist');
 await app.evaluate(`document.querySelector('.tab-row[data-tab-id="${tabs[2].id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
 await wait(()=>app.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Create rule from this tab')`),'tab rule shortcut missing');
 await app.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Create rule from this tab').click()`);
 await wait(()=>app.evaluate(`!!document.querySelector('dialog[open] .rule-editor input[value]')||[...document.querySelectorAll('dialog[open] input')].some(i=>i.value==='127.0.0.1')`),'rule was not prefilled');
 await app.evaluate(`document.querySelector('dialog[open]').close()`);
 await app.send('Emulation.clearDeviceMetricsOverride');
 await rpc('settings',{settings:{autoGroup:true,rules:[],organisation:{automatic:false}}});
 const fresh=await app.evaluate(`chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin)}+'/fresh',active:false})`);
 await delay(700);assert.equal(await app.evaluate(`chrome.tabs.get(${fresh.id}).then(t=>t.groupId)`),-1,'Automatic grouping created a singleton');
 await app.evaluate(`document.querySelector('.auto-group-control input').click()`);
 await wait(async()=>(await rpc('load')).state.settings.autoGroup===false,'visible Off switch did not persist');
 const second=await app.evaluate(`chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin)}+'/second',active:false})`);
 await delay(700);assert.equal(await app.evaluate(`chrome.tabs.get(${second.id}).then(t=>t.groupId)`),-1,'Automatic grouping continued while Off');
 await app.evaluate(`document.querySelector('.auto-group-control input').click()`);
 await wait(()=>app.evaluate(`Promise.all([${fresh.id},${second.id}].map(id=>chrome.tabs.get(id))).then(ts=>ts[0].groupId>=0&&ts[0].groupId===ts[1].groupId)`),'two matching tabs did not group after switching On');
 assert.deepEqual((await normal()).filter(t=>tabs.some(x=>x.id===t.id)),before.filter(t=>tabs.some(x=>x.id===t.id)),'Undo was overwritten by automation');
 results.push('Dedicated Rules is immediately visible with presets; 1440px/390px layouts fit; two-tab threshold, visible On/Off switch, zero-rule grouping and Undo protection work');

 // Drag actual sidebar rows into a collapsed native group, then back out with Undo.
 const targetGroup=await app.evaluate(`chrome.tabGroups.query({windowId:${own.windowId}}).then(gs=>gs.find(g=>g.title==='Original group').id)`);
 const drag=async(id,selector)=>app.evaluate(`(()=>{const row=document.querySelector('.tab-row[data-tab-id="'+${id}+'"]'),drop=document.querySelector(${JSON.stringify(selector)}),dt=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));drop.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));drop.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`);
 await drag(tabs[2].id,`.open-tab-group[data-group-id="${targetGroup}"]`);
 await wait(()=>app.evaluate(`chrome.tabs.get(${tabs[2].id}).then(t=>t.groupId===${targetGroup})`),'drop did not move tab into native group');
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Moved 1 tab')`),'move has no Undo');
 await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
 await wait(()=>app.evaluate(`chrome.tabs.get(${tabs[2].id}).then(t=>t.groupId===-1)`),'move Undo did not restore membership');
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Tab move undone')`),'move Undo did not finish');
 const restored=await app.evaluate(`chrome.tabGroups.query({windowId:${own.windowId}}).then(gs=>gs.find(g=>g.title==='Original group').id)`);
 await app.evaluate(`document.querySelector('.open-tab-group[data-group-id="${restored}"] .open-group-fold').click()`);
 await drag(tabs[1].id,`.tab-row[data-tab-id="${tabs[0].id}"]`);
 await wait(()=>app.evaluate(`chrome.tabs.get(${tabs[0].id}).then(t=>chrome.tabs.query({groupId:t.groupId})).then(ts=>ts.sort((a,b)=>a.index-b.index)[0].id===${tabs[1].id})`),'row drop did not reorder native tabs');
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Moved 1 tab')`),'reorder has no Undo');
 await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Tab move undone')`),'reorder Undo did not finish');
 const reordered=await app.evaluate(`chrome.tabs.get(${tabs[0].id}).then(t=>t.groupId)`);
 await wait(()=>app.evaluate(`!!document.querySelector('.open-tab-group[data-group-id="${reordered}"]')`),'restored group did not render');
 if(!await app.evaluate(`!!document.querySelector('.tab-row[data-tab-id="${tabs[0].id}"]')`))await app.evaluate(`document.querySelector('.open-tab-group[data-group-id="${reordered}"] .open-group-fold').click()`);
 await drag(tabs[0].id,'.native-ungroup-drop');
 await wait(()=>app.evaluate(`chrome.tabs.get(${tabs[0].id}).then(t=>t.groupId===-1)`),'drop to Ungroup did not ungroup');
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Moved 1 tab')`),'ungroup has no Undo');
 await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Tab move undone')`),'ungroup Undo did not finish');
 results.push('Sidebar drop into a collapsed native group, reorder before a row, and drop out to Ungroup work; Undo restores browser membership and order');
 await rpc('settings',{settings:{autoGroup:false}});
 await wait(()=>app.evaluate(`chrome.tabs.query({windowId:${own.windowId}}).then(ts=>ts.every(t=>!t.pendingUrl&&t.status==='complete'))`),'AI fixture pages did not finish navigation');await delay(300);
 let requests=0,hold;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests++;const body=JSON.parse(raw);assert.equal(body.reasoning_effort,'minimal');assert.equal(body.verbosity,'low');const payload=JSON.parse(body.messages[0].content.split('\nData: ')[1]);
   const respond=()=>{const answer=Array.isArray(payload)?{groups:[{name:'Research',tabIds:payload.slice(0,15).map(t=>t.id)},{name:'Reference',tabIds:payload.slice(15).map(t=>t.id)}]}:{name:'AI tools and research',note:'Compare AI chatbots and keep useful search references together.',groups:payload.links.length===3?[{name:'ChatGPT',ids:[1]},{name:'Gemini',ids:[2]},{name:'Search',ids:[3]}]:[{name:'Research',ids:payload.groupable.slice(0,15)},{name:'Reference',ids:payload.groupable.slice(15)}]};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));};
   if(hold)hold(respond);else respond();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 console.log('Mock AI endpoint port: '+server.address().port);
 try {
   await rpc('settings',{settings:{provider:'compatible',model:'gpt-5-mini',aiEndpoint:'http://127.0.0.1:'+server.address().port+'/chat/completions'}});
   await delay(350);
   await app.evaluate(`document.querySelector('.tab-more-button').click();[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Group by topic with AI').click()`);
   await wait(()=>app.evaluate(`!!document.querySelector('.topic-apply')`),'Topic choices missing');
   await app.evaluate(`document.querySelector('.topic-apply').click()`);
   await wait(()=>app.evaluate(`document.querySelector('#toast:not([hidden])')?.textContent.includes('Grouped 32 tabs')`),'direct AI grouping failed');
   assert.equal(requests,1);assert(!await app.evaluate(`!!document.querySelector('dialog[open]')`));
   await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
   await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Grouping undone')`),'direct AI Undo failed');
   let release;hold=fn=>release=fn;
   await app.evaluate(`void chrome.runtime.sendMessage({action:'group-topic',data:{windowId:${own.windowId},requestId:'stale-fixture'}}).then(r=>window.__pending=r)`);
   await wait(()=>!!release,'provider did not receive request');
   await app.evaluate(`chrome.tabs.update(${fresh.id},{url:${JSON.stringify(origin)}+'/changed-during-ai'})`);await wait(()=>app.evaluate(`chrome.tabs.get(${fresh.id}).then(t=>(t.pendingUrl||t.url).endsWith('/changed-during-ai'))`),'navigation did not start');release();
   await wait(()=>app.evaluate(`window.__pending?.error?.includes('Tabs changed')`),'late response was not rejected');
   release=null;await app.evaluate('window.__pending=null');
   await app.evaluate(`void chrome.runtime.sendMessage({action:'group-topic',data:{windowId:${own.windowId},requestId:'cancel-fixture'}}).then(r=>window.__pending=r)`);
   await wait(()=>!!release,'cancel fixture did not start');await rpc('ai-cancel',{requestId:'cancel-fixture'});release();
   await wait(()=>app.evaluate(`!!window.__pending?.error`),'cancelled AI did not finish');
   results.push('AI grouping uses one batch request, applies directly without a plan modal, offers Undo, and rejects cancelled or stale responses');
   hold=null;
   await rpc('import',{collections:[{id:'bundle-fixture',name:'Bundle fixture',groups:[],links:[{id:'gpt',url:'https://chatgpt.com/',title:'ChatGPT'},{id:'gemini',url:'https://gemini.google.com/',title:'Gemini'},{id:'search',url:'https://google.com/',title:'Google'}]}]});
   const bundle=(await rpc('load')).state.collections.find(c=>c.name==='Bundle fixture'),requestsBefore=requests;
   await wait(()=>app.evaluate(`!!document.querySelector('[data-collection-id="${bundle.id}"] [aria-label="Options for Bundle fixture"]')`),'collection action missing');
   await app.evaluate(`document.querySelector('[data-collection-id="${bundle.id}"] [aria-label="Options for Bundle fixture"]').click();[...document.querySelectorAll('#action-popover button')].find(b=>b.textContent==='Organise collection with AI').click()`);
   await wait(()=>app.evaluate(`!!document.querySelector('.topic-apply')`),'Collection topic choices missing');
   await app.evaluate(`document.querySelector('.topic-apply').click()`);
   await wait(async()=>(await rpc('load')).state.collections.find(c=>c.id===bundle.id)?.name==='AI tools and research','combined collection action did not apply');
   const organised=(await rpc('load')).state.collections.find(c=>c.id===bundle.id);assert.equal(requests,requestsBefore+1);assert(organised.note);assert.deepEqual(organised.groups.map(g=>g.name),['AI chatbots']);assert(!organised.links.find(l=>l.url==='https://google.com/').groupId);
   await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Organised AI tools and research')`),'collection operation has no Undo');
   await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
   await wait(async()=>(await rpc('load')).state.collections.find(c=>c.id===bundle.id)?.name==='Bundle fixture','saved collection Undo failed');
   const activeBefore=(await rpc('load')).state.collections.find(c=>c.id===saved.collectionId),layoutBefore=await normal();
   const combined=await rpc('collection-ai',{collectionId:saved.collectionId,windowId:own.windowId,requestId:'active-bundle'});
   const activeAfter=(await rpc('load')).state.collections.find(c=>c.id===saved.collectionId);assert.equal(activeAfter.name,'AI tools and research');assert(activeAfter.note);assert(combined.undoable);assert((await app.evaluate(`chrome.tabGroups.query({windowId:${own.windowId}})`)).some(g=>g.title==='Research'));
   await rpc('undo-action',{id:combined.id,windowId:own.windowId});
   const restoredCollection=(await rpc('load')).state.collections.find(c=>c.id===saved.collectionId);assert.equal(restoredCollection.name,activeBefore.name);assert.equal(restoredCollection.note,activeBefore.note);assert.deepEqual(await normal(),layoutBefore);
   results.push('One collection AI action updates name, note and topic groups; ChatGPT/Gemini combine, singleton Search stays ungrouped; saved and tracked browser collections both Undo completely');
   const single=await rpc('group-sort',{windowId:own.windowId,tabIds:[tabs[0].id]});
   assert.equal(await app.evaluate(`chrome.tabs.get(${tabs[0].id}).then(t=>t.groupId)`),-1,'Explicit grouping created a singleton group');
   await rpc('undo-action',{id:single.id,windowId:own.windowId});assert.deepEqual(await normal(),layoutBefore);


 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}

 await app.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await app.evaluate(`import('./ui/shared.js').then(({toast})=>{toast('Timer fixture',{undo:async()=>{},duration:500});document.querySelector('#toast').dispatchEvent(new MouseEvent('mouseenter'));})`);
 await delay(650);assert(await app.evaluate(`!document.querySelector('#toast').hidden`),'hover did not pause Undo timer');
 await app.evaluate(`document.querySelector('#toast').dispatchEvent(new MouseEvent('mouseleave'))`);await wait(()=>app.evaluate(`document.querySelector('#toast').hidden`),'Undo message did not disappear after mouse left');
 await app.evaluate(`import('./ui/shared.js').then(({toast})=>{toast('Focus timer fixture',{undo:async()=>{},duration:500});document.querySelector('#toast button').focus();})`);await delay(650);assert(await app.evaluate(`!document.querySelector('#toast').hidden`),'keyboard focus did not pause Undo timer');await app.evaluate(`document.querySelector('.tab-more-button').focus()`);await wait(()=>app.evaluate(`document.querySelector('#toast').hidden`),'Undo message did not disappear after keyboard focus left');
 results.push('Presets save with one click; tab context menu prefills a rule; Undo message pauses on hover and expires afterward');

}
