import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkCollectionGroupSort({app,rpc,results,delay,origin,out}) {
  const wait=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await delay(80);}throw Error('Collection grouping did not settle');};
  const wid=(await app.evaluate('chrome.tabs.getCurrent()')).windowId;
  await rpc('settings',{settings:{autoGroup:false,autoUpdateDefault:false}});
  await rpc('import',{collections:[{id:'fixture',name:'Collection grouping check',note:'Keep this note',groups:[],links:[
    {id:'z',url:'https://example.org/z',title:'Zebra'},
    {id:'s',url:'https://single.test/',title:'Single'},
    {id:'a',url:'https://example.org/a',title:'Apple'},
  ]}]});
  const before=(await rpc('load')).state.collections[0];
  await wait(()=>app.evaluate(`!!document.querySelector('[aria-label="Options for Collection grouping check"]')`));
  await app.evaluate(`document.querySelector('[aria-label="Options for Collection grouping check"]').click()`);
  const labels=await app.evaluate(`Array.from(document.querySelectorAll('[role="menuitem"]'),n=>n.textContent.trim())`);
  assert(!labels.includes('Organisation') && !labels.includes('Apply default grouping'));
  assert.equal(labels.indexOf('Group & sort')+1,labels.indexOf('Organise collection with AI'));
  await fs.writeFile(path.join(out,'collection-menu.png'),Buffer.from((await app.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await app.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(n=>n.textContent==='Group & sort').click();document.querySelector('#action-popover .primary').click()`);
  await wait(async()=> (await rpc('load')).state.collections[0].groups.length===1);
  const after=(await rpc('load')).state.collections[0];
  assert.deepEqual(after.links.map(l=>l.title),['Apple','Zebra','Single']);
  assert.equal(after.note,before.note);
  await wait(()=>app.evaluate(`!![...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo')`));
  await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
  await wait(async()=>JSON.stringify((await rpc('load')).state.collections[0].links)===JSON.stringify(before.links));
  results.push('Collection menu replaces Organisation with Group & sort above AI; website grouping, alphabetical sorting, metadata and Undo verified');

  await rpc('settings',{settings:{autoUpdateDefault:true}});
  const tabs=await app.evaluate(`Promise.all(['/z','/a'].map(p=>chrome.tabs.create({windowId:${wid},url:${JSON.stringify(origin)}+p,active:false})))`);
  await wait(()=>app.evaluate(`Promise.all(${JSON.stringify(tabs.map(t=>t.id))}.map(id=>chrome.tabs.get(id))).then(ts=>ts.every(t=>t.status==='complete'))`));
  const saved=await rpc('save',{tabIds:tabs.map(t=>t.id),windowId:wid,minimal:true,adopt:true});
  const operation=await rpc('collection-group-sort',{collectionId:saved.collectionId});
  const grouped=(await rpc('load')).state.collections.find(c=>c.id===saved.collectionId);
  assert.equal(grouped.groups.length,1);
  assert.equal(grouped.links.length,2);
  const live=await app.evaluate(`chrome.tabs.query({windowId:${wid}})`);
  const members=live.filter(t=>tabs.some(x=>x.id===t.id));
  assert(members.every(t=>t.groupId>=0 && t.groupId===members[0].groupId));
  assert.equal((await rpc('load')).sessionState.active[wid].tracking,true);
  await rpc('undo-action',{id:operation.id,windowId:wid});
  const restored=await app.evaluate(`chrome.tabs.query({windowId:${wid}})`);
  assert(restored.filter(t=>tabs.some(x=>x.id===t.id)).every(t=>t.groupId<0));
  results.push('Active collection grouping updates native tabs and the saved collection together, keeps tracking on, and supports native Undo');
}
