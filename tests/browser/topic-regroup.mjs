// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import http from 'node:http';
export async function checkTopicRegroup({app,rpc,results,delay,origin}) {
  const wait=async(fn,message)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw Error(message);};
  let payload,requests=0;
  const server=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;
    const prompt=JSON.parse(raw).messages[0].content;payload=JSON.parse(prompt.split('\nData: ')[1]);requests++;
    const ids=Array.isArray(payload)?payload.map(t=>t.id):payload.groupable;
    const answer=Array.isArray(payload)?{groups:[{name:'Cross-site research',tabIds:ids}]}:{name:'Topic collection',note:'Useful research references.',groups:[{name:'Cross-site research',ids}]};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    await rpc('settings',{settings:{autoGroup:false,provider:'compatible',model:'fixture',aiEndpoint:`http://127.0.0.1:${server.address().port}/chat/completions`,rules:[],regroupExisting:true}});
    await app.evaluate(`document.querySelector('.tab-more-button').click();[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Group by topic with AI').click()`);
    assert.equal(await app.evaluate(`document.querySelector('#dialog').textContent.includes('Organise this space')`),false);
    await app.evaluate(`document.querySelector('#dialog').close()`);await delay(50);
    for(const scope of [{type:'space',id:'main'},{type:'all'}])await assert.rejects(rpc('ai-assist',{kind:'library',scope}),/Select open tabs or one collection to organise/);
    assert.equal(requests,0,'Removed workspace action reached the provider');
    results.push('AI tools has no space organisation; space/all-space requests are rejected without a provider call');
    const own=await app.evaluate('chrome.tabs.getCurrent()');
    const tabs=await app.evaluate(`Promise.all(Array.from({length:4},(_,i)=>chrome.tabs.create({url:${JSON.stringify(origin)}+'/topic/'+i,active:false})))`);
    await wait(()=>app.evaluate(`chrome.tabs.query({windowId:${own.windowId}}).then(ts=>ts.filter(t=>${JSON.stringify(tabs.map(t=>t.id))}.includes(t.id)).every(t=>t.status==='complete'))`),'Tabs did not settle');
    const group=await app.evaluate(`chrome.tabs.group({tabIds:${JSON.stringify(tabs.slice(0,2).map(t=>t.id))}})`);
    await app.evaluate(`chrome.tabGroups.update(${group},{title:'Old website group',color:'blue'})`);
    // AI changes should survive the next automatic website grouping checkpoint.
    await rpc('settings',{settings:{autoGroup:true}});await delay(700);
    const result=await rpc('group-topic',{windowId:own.windowId,requestId:'flash-regression',regroupExisting:true});
    const snapshot=()=>app.evaluate(`(async()=>{const gs=await chrome.tabGroups.query({windowId:${own.windowId}});return (await chrome.tabs.query({windowId:${own.windowId}})).sort((a,b)=>a.index-b.index).map(t=>[t.id,t.groupId,gs.find(g=>g.id===t.groupId)?.title]);})()`);
    const after=await snapshot();assert(after.some(t=>t[2]==='Cross-site research'));
    await delay(1800);assert.deepEqual(await snapshot(),after,'Automatic website grouping overwrote the AI result and flashed the layout');
    await rpc('undo-action',{id:result.id,windowId:own.windowId});
    results.push('Topic groups remain stable with automatic website grouping on; Undo survives later checkpoints');
    await rpc('settings',{settings:{autoGroup:false}});
    await app.evaluate(`chrome.tabs.ungroup(${JSON.stringify(tabs.slice(2).map(t=>t.id))})`);await delay(500);
    const preserved=(await snapshot()).filter(t=>tabs.slice(0,2).some(x=>x.id===t[0]));
    const open=async()=>{
      await app.evaluate(`document.querySelector('.tab-more-button').click();[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Group by topic with AI').click()`);
      await wait(()=>app.evaluate(`!!document.querySelector('dialog[open] .topic-apply')`),'Topic options did not open');
    };
    // Undo may recreate browser groups with new native IDs; compare membership
    // and names, not those implementation-generated IDs.
    const membership=async()=>(await snapshot()).map(([id,,name])=>[id,name]);
    const beforeApply=await membership();
    let before=requests;await open();assert.equal(requests,before,'Opening options sent an AI request');
    await app.evaluate(`document.querySelector('dialog input[aria-label="Include already grouped tabs"]').checked=false;document.querySelector('.topic-apply').click()`);
    await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Grouped 2 tabs')`),'Exclude-grouped action failed');
    assert.equal(requests,before+1);assert.deepEqual(payload.map(t=>t.id).sort(),tabs.slice(2).map(t=>t.id).sort());
    assert.deepEqual((await snapshot()).filter(t=>tabs.slice(0,2).some(x=>x.id===t[0])),preserved,'Excluded groups changed');
    await app.evaluate(`[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`);
    await wait(async()=>JSON.stringify(await membership())===JSON.stringify(beforeApply),'UI Undo did not restore the native layout');
    await open();assert.equal(await app.evaluate(`document.querySelector('dialog input').checked`),false,'Choice was not remembered');
    before=requests;
    await app.evaluate(`document.querySelector('dialog input').checked=true;document.querySelector('.topic-apply').click()`);
    await wait(()=>app.evaluate(`document.querySelector('#toast')?.textContent.includes('Grouped 4 tabs')`),'Include-grouped action failed');
    assert.equal(requests,before+1);assert.equal(payload.length,4);assert(payload.every(t=>!('group' in t)&&!('groupId' in t)),'Existing groups leaked into topic input');
    assert((await snapshot()).filter(t=>tabs.some(x=>x.id===t[0])).every(t=>t[2]==='Cross-site research'));
    results.push('Topic modal remembers include/exclude; no request before Apply; excluded native groups stay intact; included tabs regroup across old boundaries');
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
