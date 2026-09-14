// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {safeURL, snapshotTabs, validateCollections} from '../extension/lib/model.js';
import {utilityTab, manageableURL} from '../extension/lib/tab-policy.js';
import {website} from '../extension/lib/website-groups.js';
import {parseImport, backupExport} from '../extension/lib/portable.js';
import {restoreBrowserSession} from '../extension/lib/sessions.js';
import {repairParkedTabs} from '../extension/lib/parked.js';

const fileURL='file:///C:/fixtures/local%20document.pdf';
const webURL='https://example.org/document.pdf';
test('local documents are manageable utility tabs, not saved links or website groups',()=>{
  for(const url of [fileURL,'file://server/share/document.pdf','FILE:///C:/test.html']) {
    assert.equal(utilityTab(url),true);
    assert.equal(manageableURL(url),true);
    assert.equal(safeURL(url),null);
    assert.equal(website(url),null);
  }
  assert.equal(safeURL(webURL),webURL,'An online PDF is still a normal web page');
});

test('snapshots exclude local and new-tab pages without creating empty groups',()=>{
  const tabs=[
    {id:1,index:0,windowId:1,groupId:10,url:fileURL,title:'Local document'},
    {id:2,index:1,windowId:1,groupId:11,url:'chrome://newtab/',title:'New tab'},
    {id:3,index:2,windowId:1,groupId:12,url:webURL,title:'Online document'},
    {id:4,index:3,windowId:1,groupId:12,url:fileURL,title:'Another local tab'},
  ];
  const snapshot=snapshotTabs(tabs,[10,11,12].map(id=>({id,title:'Group '+id,color:'blue'})));
  assert.deepEqual(snapshot.links.map(l=>l.url),[webURL]);
  assert.deepEqual(snapshot.groups.map(g=>g.name),['Group 12']);
  assert.equal(snapshot.links[0].groupId,snapshot.groups[0].id);
});

test('old backups skip local documents and preserve web links, notes and intentional empty groups',()=>{
  const c={id:'old',name:'Mixed',note:'Keep this note',groups:[
    {id:'files',name:'Files'},{id:'mixed',name:'Mixed group'},{id:'empty',name:'Empty group'},
  ],links:[
    {id:'file',url:fileURL,groupId:'files'},
    {id:'file2',url:fileURL,groupId:'mixed'},
    {id:'web',url:webURL,title:'Web PDF',groupId:'mixed',note:'Link note'},
  ],itemOrder:['group:files','group:mixed','group:empty']};
  const before=structuredClone(c);
  const imported=parseImport(JSON.stringify({format:'leotabs-collections',version:1,collections:[c]}));
  assert.equal(imported.skipped,2);
  assert.equal(imported.links,1);
  assert.deepEqual(imported.collections[0].groups.map(g=>g.name),['Mixed group','Empty group']);
  assert.equal(imported.collections[0].links[0].note,'Link note');
  assert.equal(imported.collections[0].note,'Keep this note');
  assert.deepEqual(c,before);
  const backup=JSON.parse(backupExport({collections:[c],settings:{}}));
  assert.deepEqual(backup.collections[0].links.map(l=>l.url),[webURL]);
  assert.throws(()=>validateCollections([{...c,links:[{id:'bad',url:'javascript:alert(1)'}]}]),/not supported/);
});

test('native session restore cannot reopen excluded pages hidden inside a closed window',async()=>{
  const calls=[];
  const browser={sessions:{
    getRecentlyClosed:async()=>[
      {tab:{sessionId:'file',url:fileURL}},
      {tab:{sessionId:'web',url:webURL}},
      {window:{sessionId:'mixed',tabs:[{url:fileURL},{url:webURL},{url:'chrome://newtab/'}]}},
    ],
    restore:async id=>calls.push(['restore',id]),
  },windows:{create:async options=>calls.push(['window',options])}};
  await assert.rejects(restoreBrowserSession(browser,'file'),/No web tabs/);
  assert.deepEqual(calls,[]);
  await restoreBrowserSession(browser,'web');
  await restoreBrowserSession(browser,'mixed');
  assert.deepEqual(calls,[['restore','web'],['window',{url:[webURL]}]]);
});

test('legacy local-file placeholders are not repeatedly reloaded for identity repair',async()=>{
  let reloads=0;
  const browser={runtime:{getURL:p=>'chrome-extension://fixture/'+p},tabs:{
    query:async()=>[{id:1,url:'chrome-extension://fixture/parked.html?id=old',active:false,discarded:true}],
    reload:async()=>reloads++,get:async()=>{throw Error('Unsupported placeholder should not be polled');},
  }};
  await repairParkedTabs(browser,{read:async()=>({id:'old',url:fileURL,title:'Local document'})});
  assert.equal(reloads,0);
});
