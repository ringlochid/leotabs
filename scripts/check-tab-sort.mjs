// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkTabSort({app,rpc,results,delay,origin,out}) {
 const wait=async(f,msg)=>{for(let i=0;i<150;i++){if(await f())return;await delay(100);}throw Error(msg);};
 await rpc('settings',{settings:{autoGroup:false,tabSort:'recent'}});
 const own=await app.evaluate('chrome.tabs.getCurrent()');
 const tabs=await app.evaluate(`Promise.all(['Zulu','Delta','Bravo','Alpha','Echo'].map(name=>chrome.tabs.create({url:${JSON.stringify(origin)}+'/'+name,active:false})))`);
 const ids=tabs.map(t=>t.id);
 await wait(()=>app.evaluate(`chrome.tabs.query({windowId:${own.windowId}}).then(ts=>ts.filter(t=>${JSON.stringify(ids)}.includes(t.id)).every(t=>t.status==='complete'))`),'Load');
 const group=await app.evaluate(`chrome.tabs.group({tabIds:[${ids[1]},${ids[2]}]})`);
 await app.evaluate(`chrome.tabGroups.update(${group},{title:'Middle',color:'orange',collapsed:true});`);
 await app.evaluate(`chrome.tabs.update(${ids[4]},{pinned:true})`);
 await delay(500);
 const layout=()=>app.evaluate(`(async()=>{const ts=await chrome.tabs.query({windowId:${own.windowId}}),gs=await chrome.tabGroups.query({windowId:${own.windowId}});return ts.filter(t=>${JSON.stringify(ids)}.includes(t.id)).sort((a,b)=>a.index-b.index).map(t=>({id:t.id,title:t.title,url:t.url,pinned:t.pinned,group:gs.filter(g=>g.id===t.groupId).map(g=>({title:g.title,color:g.color,collapsed:g.collapsed}))}));})()`);
 const before=await layout();
 const choose=async label=>{await app.evaluate(`document.querySelector('.tab-more-button').click()`);await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);};
 assert.equal(await app.evaluate(`document.querySelectorAll('.group-sort-button,.rules-button').length`),0);
 await app.evaluate(`document.querySelector('.tab-more-button').click()`);
 await fs.writeFile(path.join(out,'tab-menu.png'),Buffer.from((await app.send('Page.captureScreenshot')).data,'base64'));
 assert(await app.evaluate(`document.querySelector('#action-popover').textContent.includes('Group & sort')`));
 await app.evaluate(`document.querySelector('#action-popover').hidePopover()`);
 const saved=await rpc('save',{tabIds:ids,name:'Sort fixture',close:false});
 await rpc('settings',{settings:{autoUpdateDefault:true}});
 await app.evaluate(`chrome.storage.session.set({neoSessions:{active:{[${own.windowId}]:{collectionId:${JSON.stringify(saved.collectionId)},tracking:true}},parked:{}}})`);
 await rpc('session-checkpoint',{windowId:own.windowId});
 await choose('Title A–Z');
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Sorted tabs')`),'Sort UI');
 const sorted=await layout(),editable=sorted.filter(t=>ids.includes(t.id)&&!t.pinned);
 assert.deepEqual(editable.map(t=>t.id),[ids[3],ids[2],ids[1],ids[0]],'Browser order did not change');
 assert.deepEqual(sorted.find(t=>t.id===ids[4]),before.find(t=>t.id===ids[4]));
 assert.equal(editable.filter(t=>t.group.length).length,2);assert.equal(editable[1].group[0].color,'orange');assert.equal(editable[1].group[0].collapsed,true);
 await wait(async()=>{const c=(await rpc('load')).state.collections.find(c=>c.id===saved.collectionId);return c.links.map(l=>l.url).join()===sorted.filter(t=>ids.includes(t.id)&&!t.pinned).map(t=>t.url).join();},'Saved collection order');
 await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
 await wait(async()=>JSON.stringify(await layout())===JSON.stringify(before),'Undo restore');
 for(const order of ['domain','recent']){
   const op=await rpc('sort-open-tabs',{windowId:own.windowId,order});
   assert.equal((await layout()).filter(t=>t.group.length).length,2);
   await rpc('undo-action',{id:op.id,windowId:own.windowId});assert.deepEqual(await layout(),before);
 }
 await choose('Group & sort');
 assert(await app.evaluate(`!!document.querySelector('.group-apply')`));
 await app.evaluate(`document.querySelector('.group-apply').click()`);
 await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Grouped')`),'Grouping menu action');
 await app.evaluate(`document.querySelector('#settings').click()`);
 await app.evaluate(`[...document.querySelectorAll('#action-popover button')].find(b=>b.textContent.includes('Grouping rules')).click()`);
 await wait(()=>app.evaluate(`document.querySelector('dialog[open]')?.textContent.includes('Ready-made rules')`),'Rules settings');
 await fs.writeFile(path.join(out,'rules-settings.png'),Buffer.from((await app.send('Page.captureScreenshot')).data,'base64'));
 results.push('Native Title sort changes browser and active collection order; preserves pinned tabs and groups; Undo restores original; website/recent keep groups and Undo; Group & sort in menu; rules in Settings');
}
