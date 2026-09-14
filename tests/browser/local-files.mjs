// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function checkLocalFiles({app,rpc,results,delay,out,origin,targets,connect}) {
  const wait=async(fn,message)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw Error(message);};
  await rpc('settings',{settings:{autoGroup:false,autoUpdateDefault:false,closeAfterStash:false}});
  const own=await app.evaluate('chrome.tabs.getCurrent()');
  const filePath=path.join(out,'local-document.html');
  await fs.writeFile(filePath,'<!doctype html><title>Local document fixture</title><p>Local file fixture</p>');
  const fileURL=pathToFileURL(filePath).href;
  // An inactive file tab may remain deferred by the browser. Visit the fixture
  // once before asserting its settled URL and testing LeoTabs' handling of it.
  const local=await app.evaluate(`chrome.tabs.create({url:${JSON.stringify(fileURL)},active:true})`);
  const web=await app.evaluate(`chrome.tabs.create({url:${JSON.stringify(origin+'/online-document.pdf')},active:false})`);
  await wait(()=>app.evaluate(`chrome.tabs.get(${local.id}).then(t=>t.url===${JSON.stringify(fileURL)}&&t.status==='complete')`),'Local fixture did not load');
  await wait(()=>app.evaluate(`!!document.querySelector('[data-tab-id="${local.id}"]')`),'Local tab disappeared from open tabs');
  await assert.rejects(rpc('save',{tabIds:[local.id],close:false}),/Can't save utility tabs/);
  await rpc('activate',{tabId:local.id});
  assert.equal(await app.evaluate(`chrome.tabs.get(${local.id}).then(t=>t.active)`),true,'Existing local tab cannot be focused');
  await rpc('activate',{tabId:own.id});
  const fileGroup=await app.evaluate(`chrome.tabs.group({tabIds:[${local.id}]})`);
  await app.evaluate(`chrome.tabGroups.update(${fileGroup},{title:'Local document',color:'grey'})`);
  const saved=await rpc('save',{tabIds:[local.id,web.id],adopt:true,windowId:own.windowId});
  const collectionId=(saved.operation||saved).collectionId;
  await rpc('collection-auto-update',{collectionId,windowId:own.windowId,enabled:true});
  await rpc('session-checkpoint',{windowId:own.windowId});
  const snapshot=(await rpc('load')).state.collections.find(c=>c.id===collectionId);
  assert.deepEqual(snapshot.links.map(l=>l.url),[origin+'/online-document.pdf']);
  assert.deepEqual(snapshot.groups,[],'File-only group was saved');
  results.push('Local tabs stay visible and focusable; save-only rejects files, and active collection snapshots contain only web links');

  const beforeClose=await rpc('load');
  const closed=await rpc('close',{tabIds:[local.id,web.id]});
  await rpc('undo-action',{id:closed.id,windowId:own.windowId});
  await wait(async()=>(await rpc('load')).tabs.some(t=>(t.resourceUrl||t.url)===origin+'/online-document.pdf'),'Undo did not restore the online PDF');
  assert(!(await rpc('load')).tabs.some(t=>(t.resourceUrl||t.url)===fileURL),'Undo reopened a local document');
  assert.equal(beforeClose.tabs.filter(t=>t.id===local.id).length,1);
  results.push('Close and Undo restore the web page without reopening the local document');

  const mixed=await app.evaluate(`chrome.windows.create({url:[${JSON.stringify(fileURL)},${JSON.stringify(origin+'/mixed-session')}],focused:false})`);
  await wait(()=>app.evaluate(`chrome.tabs.query({windowId:${mixed.id}}).then(ts=>ts.length===2&&ts.every(t=>t.status==='complete'))`),'Mixed window did not settle');
  await app.evaluate(`chrome.windows.remove(${mixed.id})`);
  let recent;
  await wait(async()=>{recent=await app.evaluate(`chrome.sessions.getRecentlyClosed({maxResults:25}).then(rows=>rows.find(r=>r.window?.tabs?.some(t=>t.url===${JSON.stringify(origin+'/mixed-session')})))`);return !!recent;},'Closed mixed window was not recorded');
  const reopened=await rpc('restore-session',{sessionId:recent.window.sessionId});
  const restoredTabs=await app.evaluate(`chrome.tabs.query({windowId:${reopened.id}})`);
  assert.deepEqual(restoredTabs.map(t=>t.pendingUrl||t.url),[origin+'/mixed-session'],'Restoring a mixed window reopened its local document');
  await app.evaluate(`chrome.windows.remove(${reopened.id})`);
  results.push('Restoring a real closed window containing web and local pages reopens only its web page');

  // Seed old-version records directly to verify backward compatibility, not
  // through import, which intentionally filters local links in new versions.
  await app.evaluate(`(async()=>{
    const db=await import('./lib/db.js');
    const {newCollection}=await import('./lib/model.js');
    await db.mutate('Legacy fixture',s=>{
      const c=newCollection('Legacy files');c.id='legacy-files';c.links=[
        {id:'local',title:'Legacy local document',url:${JSON.stringify(fileURL)},groupId:null},
        {id:'web',title:'Online PDF',url:${JSON.stringify(origin+'/legacy-online.pdf')},groupId:null},
      ];s.collections.push(c);
    });
    await db.write('parked',{id:'legacy-file-placeholder',url:${JSON.stringify(fileURL)},title:'Legacy local document',at:Date.now()});
  })()`);
  await assert.rejects(rpc('open-link',{collectionId:'legacy-files',linkId:'local',windowId:own.windowId}),/Can't reopen local files/);
  await assert.rejects(rpc('open-url',{url:fileURL,windowId:own.windowId}),/isn't supported/);
  const resumed=await rpc('resume',{collectionId:'legacy-files',windowId:own.windowId,deferred:true});
  assert.equal(resumed.created.length,1);
  assert.deepEqual(resumed.failed,[]);
  const records=await app.evaluate("import('./lib/db.js').then(db=>db.all('parked'))");
  assert.deepEqual(records.filter(r=>r.url===fileURL).map(r=>r.id),['legacy-file-placeholder'],'Resume created a new local-file placeholder');
  results.push('Legacy collection opens skip local files; direct open paths reject them without creating placeholders');

  const placeholderURL=await app.evaluate("chrome.runtime.getURL('parked.html?id=legacy-file-placeholder')");
  const placeholder=await app.evaluate(`chrome.tabs.create({url:${JSON.stringify(placeholderURL)},active:true})`);
  let target;
  await wait(async()=>{target=(await targets()).find(t=>t.url===placeholderURL);return !!target;},'Legacy placeholder target missing');
  const page=await connect(target.webSocketDebuggerUrl);
  await wait(()=>page.evaluate("!!document.querySelector('#error:not([hidden])')"),'Legacy file placeholder kept spinning');
  assert(await page.evaluate("document.querySelector('#description').textContent.includes(\"can't reopen local files\")"));
  assert(await page.evaluate("document.querySelector('#loading').hidden && document.querySelector('#load').hidden"),'Unsupported page still offers a retry loop');
  await assert.rejects(rpc('parked-load',{tabId:placeholder.id}),/Can't reopen local files/);
  assert.equal(await app.evaluate(`chrome.tabs.get(${placeholder.id}).then(t=>t.url)`),placeholderURL);
  await fs.writeFile(path.join(out,'legacy-local-file.png'),Buffer.from((await page.send('Page.captureScreenshot')).data,'base64'));
  results.push('Old local-file placeholders stop the spinner, explain the limitation, and never navigate or offer Retry');
}
