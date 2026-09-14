// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkAutoUpdateRefresh({app,rpc,results,delay,origin,out,connect,targets,extensionOrigin}) {
  const wait=async(fn,label,attempts=100)=>{for(let i=0;i<attempts;i++){if(await fn())return;await delay(50);}throw Error(label);};
  await rpc('settings',{settings:{autoGroup:false,autoUpdateDefault:false}});
  const own=await app.evaluate('chrome.tabs.getCurrent()');
  const tabs=await app.evaluate(`Promise.all([0,1].map(i=>chrome.tabs.create({url:${JSON.stringify(origin)}+'/sync-'+i,active:false})))`);
  for (const tab of tabs) {
    await app.evaluate(`chrome.tabs.update(${tab.id},{active:true})`);
    await wait(()=>app.evaluate(`chrome.tabs.get(${tab.id}).then(t=>t.status==='complete')`),'Tabs did not settle',200);
  }
  await app.evaluate(`chrome.tabs.update(${own.id},{active:true})`);
  const saved=await rpc('save',{adopt:true,windowId:own.windowId,tabIds:tabs.map(t=>t.id)});
  const id=(saved.operation||saved).collectionId;
  await rpc('import',{collections:[{name:'Untouched collection',groups:[],links:[{id:'other',url:origin+'/other',title:'Unrelated page'}]}]});
  await rpc('collection-auto-update',{collectionId:id,windowId:own.windowId,enabled:true});
  await wait(()=>app.evaluate("document.querySelectorAll('#board .collection').length===2"),'Collections did not render');
  const other=(await rpc('load')).state.collections.find(c=>c.name==='Untouched collection');
  await app.evaluate("chrome.alarms.clear('neo-session-checkpoint')");
  const otherWindow=await app.evaluate(`chrome.windows.create({url:${JSON.stringify(origin+'/other-window')},focused:false})`);
  await wait(()=>app.evaluate(`chrome.tabs.query({windowId:${otherWindow.id}}).then(ts=>ts.length===1&&ts[0].status==='complete')`),'Other window did not settle');
  await delay(700);
  const worker=await connect((await targets()).find(t=>t.type==='service_worker'&&t.url===extensionOrigin+'/background.js').webSocketDebuggerUrl);
  await worker.evaluate(`globalThis.__groupQueryWindows=[];const queryGroups=chrome.tabGroups.query.bind(chrome.tabGroups);chrome.tabGroups.query=(options,...args)=>{if(Number.isInteger(options?.windowId))__groupQueryWindows.push(options.windowId);return queryGroups(options,...args);};`);
  await app.evaluate(`globalThis.__untouched=document.querySelector('[data-collection-id="${other.id}"]');globalThis.__untouchedIcon=__untouched.querySelector('.favicon');`);
  // A title burst should save the final title once, without replacing other cards.
  const before=await app.evaluate("import('./lib/db.js').then(db=>db.getState()).then(s=>s.revision)");
  await app.evaluate(`chrome.scripting.executeScript({target:{tabId:${tabs[0].id}},func:async()=>{for(let i=0;i<5;i++){document.title='Inbox '+i;await new Promise(r=>setTimeout(r,60));}}})`);
  await wait(()=>app.evaluate(`import('./lib/db.js').then(db=>db.getState()).then(s=>s.collections.find(c=>c.id==='${id}').links.some(l=>l.title==='Inbox 4'))`),'Latest title was not mirrored');
  await wait(()=>app.evaluate(`document.querySelector('[data-collection-id="${id}"]').textContent.includes('Inbox 4')`),'Updated card did not render');
  const sync=await app.evaluate(`(async()=>{const db=await import('./lib/db.js');return {revision:(await db.getState()).revision,journal:(await db.all('journal')).filter(r=>r.label==='Automatic collection update').length,versions:(await db.all('timeline')).filter(r=>r.version&&r.collectionId==='${id}').length,retained:__untouched===document.querySelector('[data-collection-id="${other.id}"]')&&__untouchedIcon===__untouched.querySelector('.favicon')};})()`);
  assert(sync.revision-before<=2,'A short title burst wrote too many revisions');
  assert.equal(sync.journal,0,'Automatic updates created full-library journal snapshots');
  assert(sync.versions>0,'Automatic updates lost collection-version recovery');
  assert(sync.retained,'An unrelated collection or its favicon was recreated');
  const queriedWindows=await worker.evaluate('__groupQueryWindows');
  assert(queriedWindows.includes(own.windowId),'Changed window was not checkpointed');
  assert(!queriedWindows.includes(otherWindow.id),'A title-only event checkpointed another window');
  results.push('Title bursts retain the final title and collection history without full-library journal snapshots or rebuilding unrelated cards');
  await app.evaluate('globalThis.__changes=0;chrome.runtime.onMessage.addListener(m=>{if(m.event==="changed")__changes++;});');
  await app.evaluate("chrome.alarms.create('neo-session-checkpoint',{when:Date.now()+200})");
  await delay(1500);
  assert.equal(await app.evaluate('__changes'),0,'An unchanged periodic checkpoint broadcast a refresh');
  await app.evaluate("chrome.alarms.create('neo-session-checkpoint',{periodInMinutes:1})");
  await app.evaluate(`chrome.windows.remove(${otherWindow.id})`);
  results.push('Title-only checkpoints stay within the affected window; unchanged periodic checkpoints send no refresh notification');

  // Exercise the production IndexedDB transaction against concurrent edits,
  // no-op writes, storage failure and history retention in this fresh profile.
  const database=await app.evaluate(`(async()=>{
    const db=await import('./lib/db.js');
    const originalTransaction=IDBDatabase.prototype.transaction;
    let readwrites=0,injectPause=false;
    IDBDatabase.prototype.transaction=function(stores,mode,...args){
      if(mode==='readwrite')readwrites++;
      if(injectPause&&Array.isArray(stores)&&stores.length===2&&stores.includes('timeline')){
        injectPause=false;
        const concurrent=originalTransaction.call(this,['state'],'readwrite');
        const read=concurrent.objectStore('state').get('library');
        read.onsuccess=()=>{const state=read.result;const c=state.value.collections.find(c=>c.id==='${id}');c.autoUpdate=false;c.note='Concurrent edit';state.value.revision++;concurrent.objectStore('state').put(state);};
      }
      return originalTransaction.call(this,stores,mode,...args);
    };
    try {
      await db.mutateCollection('No-op','${id}',()=>null,${own.windowId});
      const noopWrites=readwrites;
      injectPause=true;
      const race=await db.mutateCollection('Race','${id}',c=>c.autoUpdate===false?null:{...c,note:'Stale overwrite'},${own.windowId});
      const after=(await db.getState()).collections.find(c=>c.id==='${id}');
      const beforeFailure=JSON.stringify(await db.getState()),originalPut=IDBObjectStore.prototype.put;
      let rejected=false;
      IDBObjectStore.prototype.put=function(value,...args){if(this.name==='timeline'&&value.reason==='Failure')throw Error('Fixture disk failure');return originalPut.call(this,value,...args);};
      try{await db.mutateCollection('Failure','${id}',c=>({...c,note:'Uncommitted'}),${own.windowId});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=originalPut;}
      const preserved=beforeFailure===JSON.stringify(await db.getState());
      const conn=await db.openDB();
      await new Promise((resolve,reject)=>{const tx=conn.transaction('timeline','readwrite');for(let i=0;i<205;i++)tx.objectStore('timeline').put({id:'retention-'+i,at:Date.now()-1000-i,snapshot:{links:[],groups:[]}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      await db.mutateCollection('Retention','${id}',c=>({...c,note:'Current note'}),${own.windowId});
      return {noopWrites,raceChanged:race.changed,note:after.note,paused:after.autoUpdate===false,rejected,preserved,historyCount:(await db.all('timeline')).length};
    }finally{IDBDatabase.prototype.transaction=originalTransaction;}
  })()`);
  assert.deepEqual(database,{noopWrites:0,raceChanged:false,note:'Concurrent edit',paused:true,rejected:true,preserved:true,historyCount:200});
  results.push('No-op mirroring opens no write transaction; concurrent pause/edit wins, failed writes are atomic, and history stays bounded');

  await rpc('collection-auto-update',{collectionId:id,windowId:own.windowId,enabled:false});
  await app.send('Page.navigate',{url:await app.evaluate("chrome.runtime.getURL('quick.html')")});
  await wait(()=>app.evaluate("document.querySelectorAll('.switcher-card').length===2"),'Switcher did not load');
  await app.evaluate(`
    globalThis.__holdNext=true;globalThis.__notified=0;
    chrome.runtime.onMessage.addListener(m=>{if(m.event==='changed')__notified++;});
    const originalSend=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage=async(message,...args)=>{
      const response=await originalSend(message,...args);
      if(message?.action==='load'&&__holdNext&&!response.value?.layoutBusy){__holdNext=false;await new Promise(resolve=>globalThis.__releaseRead=resolve);}
      return response;
    };
  `);
  await wait(()=>app.evaluate('typeof __releaseRead==="function"'),'No in-flight read to test');
  await app.evaluate('globalThis.__notified=0');
  await app.evaluate(`chrome.tabs.remove(${tabs[1].id})`);
  await wait(()=>app.evaluate('__notified>0'),'Close notification did not arrive');
  await app.evaluate('__releaseRead()');
  await wait(()=>app.evaluate(`![...document.querySelectorAll('.switcher-card')].some(c=>c.dataset.key.includes(':tab:${tabs[1].id}:'))`),'An older response left the closed tab visible until polling',20);
  results.push('A close during an in-flight read refreshes immediately after the read, without waiting for the 2.5-second poll');
  await fs.writeFile(path.join(out,'sync-evidence.json'),JSON.stringify({sync,database},null,2));
}
