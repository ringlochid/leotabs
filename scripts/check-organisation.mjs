import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkOrganisation({app,rpc,results,delay,origin,out}) {
  const wait=async(fn,message)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw Error(message);};
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    const prompt=JSON.parse(body).messages[0].content;
    const data=JSON.parse(prompt.slice(prompt.indexOf('\nData: ')+7));calls.push(data);
    const links=Array.isArray(data)?[]:data.links.filter(l=>!l.groupId);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(Array.isArray(data)?{collectionIds:data.map(c=>c.id).reverse()}:{collectionName:'AI research',groups:[...data.groups.map(g=>({name:g.name==='Group'?'AI named group':g.name,linkIds:data.links.filter(l=>l.groupId===g.id).map(l=>l.id)})),...(links.length?[{name:'AI research',linkIds:links.map(l=>l.id)}]:[])],orderedLinkIds:data.links.map(l=>l.id).reverse(),note:''})}}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const own=await app.evaluate('chrome.tabs.getCurrent()');
    const base={group:'rules',collectionName:'template',groupName:'template',collectionTemplate:'{domain} · {count}',groupTemplate:'{domain}',tabOrder:'title',groupOrder:'title',collectionOrder:'title',automatic:true};
    await rpc('organisation-policy',{scope:{type:'global'},organisation:base,rules:[{domain:'127.0.0.1/rule*',group:'Local rules',color:'mint',priority:10}]});
    const tabs=await app.evaluate(`Promise.all(['rule-b','rule-a','other'].map(name=>chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin)}+'/'+name,active:false})))`);
    await wait(()=>app.evaluate(`chrome.tabs.get(${tabs[0].id}).then(t=>t.groupId>=0)`),'automatic native grouping failed');
    const grouped=await app.evaluate(`chrome.tabs.get(${tabs[0].id}).then(t=>chrome.tabGroups.get(t.groupId))`);
    assert.equal(grouped.title,'Local rules');
    assert.notEqual(grouped.color,'blue');
    await app.evaluate(`Promise.all([chrome.scripting.executeScript({target:{tabId:${tabs[0].id}},func:()=>document.title='Zulu'}),chrome.scripting.executeScript({target:{tabId:${tabs[1].id}},func:()=>document.title='Alpha'})])`);
    await wait(()=>app.evaluate(`chrome.tabs.query({groupId:${grouped.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index)[0].id===${tabs[1].id})`),'native alphabetical ordering did not move actual tabs');
    results.push('Alphabetical policy moves actual browser tabs within their native group');
    const saved=await rpc('save',{tabIds:tabs.map(t=>t.id),close:false});
    await wait(async()=>(await rpc('load')).state.collections.find(c=>c.id===saved.collectionId).name==='127.0.0.1 · 3','template naming failed');
    await app.evaluate(`chrome.tabs.ungroup(${tabs[0].id})`);
    await delay(450);
    await wait(async()=>(await rpc('organisation-status',{scope:{type:'global'}})).count>0,'native manual correction was not remembered');
    assert.equal((await app.evaluate(`chrome.tabs.get(${tabs[0].id})`)).groupId,-1);
    results.push('URL rules create native groups with configured colours; saved templates apply; native manual ungrouping becomes a durable exception');

    await rpc('settings',{settings:{provider:'compatible',model:'fixture',aiEndpoint:`http://127.0.0.1:${server.address().port}/chat/completions`}});
    await rpc('organisation-policy',{scope:{type:'global'},organisation:{...base,group:'rules-ai',collectionName:'ai',groupName:'ai',tabOrder:'ai'}});
    await wait(()=>app.evaluate(`chrome.tabs.get(${tabs[2].id}).then(t=>t.groupId>=0)`),'unmatched tab was not automatically grouped by AI');
    assert.equal((await app.evaluate(`chrome.tabs.get(${tabs[0].id})`)).groupId,-1,'AI overrode manual ungrouping');
    const aiGroup=await app.evaluate(`chrome.tabs.get(${tabs[2].id}).then(t=>chrome.tabGroups.get(t.groupId))`);
    assert.equal(aiGroup.title,'AI research');assert(calls.length>0);
    results.push('Automatic rules-then-AI groups unmatched tabs through a local provider while protecting manual corrections');

    await rpc('organisation-policy',{scope:{type:'global'},organisation:{...base,group:'keep',collectionName:'keep',groupName:'keep',tabOrder:'ai',groupOrder:'manual',collectionOrder:'manual'}});
    await rpc('organisation-reset',{scope:{type:'global'}});
    // Regroup the corrected tab explicitly; the AI ordering policy may order
    // this group, but may not choose a different group for it.
    await app.evaluate(`chrome.tabs.group({tabIds:[${tabs[0].id}],groupId:${grouped.id}})`);
    await delay(250);
    const beforeOrder=await app.evaluate(`chrome.tabs.query({groupId:${grouped.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index).map(t=>t.id))`);
    await rpc('organisation-reset',{scope:{type:'global'}});await rpc('organisation-retry');
    await wait(()=>app.evaluate(`chrome.tabs.query({groupId:${grouped.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index).map(t=>t.id).join()===${JSON.stringify([...beforeOrder].reverse().join())})`),'AI reading order did not move actual browser tabs');
    const orderNow=await app.evaluate(`chrome.tabs.query({groupId:${grouped.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index))`);
    await app.evaluate(`chrome.tabs.move(${orderNow[1].id},{index:${orderNow[0].index}})`);
    await delay(500);
    const correctedOrder=await app.evaluate(`chrome.tabs.query({groupId:${grouped.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index).map(t=>t.id))`);
    await rpc('organisation-retry');await delay(1100);
    assert.deepEqual(await app.evaluate(`chrome.tabs.query({groupId:${grouped.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index).map(t=>t.id))`),correctedOrder);
    results.push('Purpose-driven AI order moves native tabs; manually correcting that order prevents later automatic reordering');
    await rpc('save',{tabIds:[tabs[2].id],close:false,name:'Second collection'});
    const beforeCollections=(await rpc('load')).state.collections.map(c=>c.id);
    await rpc('organisation-policy',{scope:{type:'global'},organisation:{...base,group:'keep',collectionName:'keep',groupName:'keep',tabOrder:'manual',groupOrder:'manual',collectionOrder:'ai'}});
    await wait(async()=>(await rpc('load')).state.collections.map(c=>c.id).join()===[...beforeCollections].reverse().join(),'AI collection order was not persisted');
    const ordered=(await rpc('load')).state.collections.map(c=>c.id);
    await delay(1100);assert.deepEqual((await rpc('load')).state.collections.map(c=>c.id),ordered);
    results.push('Automatic AI ordering persists the requested collection sequence without repeatedly reversing settled work');
    await rpc('organisation-policy',{scope:{type:'global'},organisation:{...base,group:'keep',collectionName:'keep',groupName:'keep',automatic:false}});
    await rpc('organisation-reset',{scope:{type:'global'}});
    await rpc('organisation-run',{scope:{type:'global'}});
    assert.equal((await rpc('load')).state.settings.organisation.automatic,false);
    assert.equal((await rpc('load')).state.collections[0].name,'127.0.0.1 · 3');
    assert.equal((await app.evaluate(`chrome.tabs.query({groupId:${grouped.id}}).then(ts=>ts.sort((a,b)=>a.index-b.index))`))[0].title,'Alpha');
    results.push('Apply once arranges real tabs and saved collections without enabling automatic mode');

    await rpc('organisation-policy',{scope:{type:'global'},organisation:{...base,group:'rules',collectionName:'keep',groupName:'keep'}});
    await rpc('organisation-policy',{scope:{type:'collection',id:saved.collectionId},organisation:{group:'keep'}});
    await rpc('switch',{windowId:own.windowId,destinationId:saved.collectionId,tracking:false});
    const inherited=await app.evaluate(`chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin+'/rule-inheritance')},active:false})`);
    await delay(400);assert.equal((await app.evaluate(`chrome.tabs.get(${inherited.id})`)).groupId,-1);
    await rpc('organisation-policy',{scope:{type:'space',id:'main'},organisation:{group:'keep'}});
    await rpc('organisation-policy',{scope:{type:'collection',id:saved.collectionId},organisation:null});
    await delay(400);assert.equal((await app.evaluate(`chrome.tabs.get(${inherited.id})`)).groupId,-1);
    await rpc('organisation-policy',{scope:{type:'space',id:'main'},organisation:null});
    await wait(()=>app.evaluate(`chrome.tabs.get(${inherited.id}).then(t=>t.groupId>=0)`),'restoring global inheritance did not group the matching tab');
    results.push('Live tabs obey collection overrides, then space overrides, then global defaults when inheritance is restored');

    await rpc('organisation-policy',{scope:{type:'collection',id:saved.collectionId},organisation:{group:'keep',automatic:false}});
    await app.evaluate(`chrome.tabs.reload(${own.id})`);await delay(600);
    assert.equal((await rpc('load')).state.collections.find(c=>c.id===saved.collectionId).organisation.automatic,false);
    await app.evaluate(`import(chrome.runtime.getURL('ui/organisation-dialog.js')).then(async m=>{const r=await chrome.runtime.sendMessage({action:'load'});m.organisationDialog({state:r.value.state,change:(action,data)=>chrome.runtime.sendMessage({action,data})});})`);
    assert(await app.evaluate(`document.querySelector('[aria-label="Group tabs"]')?.value==='rules'`));
    assert(await app.evaluate(`document.querySelector('[aria-label="AI ordering purpose"]')!==null`));
    await fs.writeFile(path.join(out,'organisation-settings.png'),Buffer.from((await app.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    for(const width of [1440,390]) {
      await app.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      assert(await app.evaluate(`(()=>{const d=document.querySelector('#dialog');return d.scrollWidth<=d.clientWidth+1;})()`),'organisation dialog overflows at '+width);
      await fs.writeFile(path.join(out,'organisation-'+width+'.png'),Buffer.from((await app.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    await app.send('Emulation.clearDeviceMetricsOverride');
    results.push('Collection override persists after reload; independent policy controls and rule editor render in the actual extension');
  } finally {server.close();server.closeAllConnections();}
}
