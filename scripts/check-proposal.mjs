import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkProposal({app,rpc,results,delay,origin,out,extensionOrigin}) {
  const wait=async(fn,message)=>{for(let i=0;i<120;i++){if(await fn())return;await delay(100);}throw Error(message);};
  const click=text=>app.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)}));if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click();})()`);
  const calls=[];let slow=false;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    const prompt=JSON.parse(body).messages[0].content;
    const data=JSON.parse(prompt.slice(prompt.indexOf('\nData: ')+7));calls.push({prompt,data});
    if(slow)await delay(1000);
    let reply;
    if(prompt.includes('alternative names'))reply={names:['Clear research name','Second name']};
    else if(data.tabs)reply={name:'Suggested save',destinations:[{id:data.collections[0]?.id,reason:'Related source'}]};
    else if(Array.isArray(data))reply={collectionIds:data.map(c=>c.id).reverse()};
    else if(data.collections) {
      const [a,b]=data.collections;
      reply={actions:prompt.includes('CROSS_SPACE')?[{type:'merge',collectionId:a.id,destinationId:data.collections.at(-1).id}]:b?[{type:'rename',collectionId:a.id,name:'Reviewed source'},{type:'merge',collectionId:a.id,destinationId:b.id}]:[]};
    } else reply={collectionName:'AI collection',groups:(data.groups||[]).map(g=>({name:g.name,linkIds:data.links.filter(l=>l.groupId===g.id).map(l=>l.id)})),orderedLinkIds:data.links.map(l=>l.id).reverse()};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const snapshot=async file=>fs.writeFile(path.join(out,file),Buffer.from((await app.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  try {
    const own=await app.evaluate('chrome.tabs.getCurrent()');
    await rpc('settings',{settings:{autoGroup:false}});
    await rpc('settings',{settings:{provider:'compatible',model:'fixture',aiEndpoint:`http://127.0.0.1:${server.address().port}/chat/completions`}});
    const tabs=await app.evaluate(`Promise.all(['source-a','source-b'].map(p=>chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin)}+'/'+p,active:false})))`);
    await wait(()=>app.evaluate(`chrome.tabs.get(${tabs[0].id}).then(t=>t.status==='complete')`),'source did not load');
    await rpc('import',{collections:[{id:'source',name:'Research source',note:'Source note',autoUpdate:false,groups:[],links:[{id:'s1',title:'Source',url:origin+'/source-a'}]},{id:'dest',name:'Research destination',note:'Destination note',autoUpdate:false,groups:[],links:[{id:'s2',title:'Destination',url:origin+'/source-b'}]}]});
    let state=(await rpc('load')).state;const source=state.collections.find(c=>c.name==='Research source'),dest=state.collections.find(c=>c.name==='Research destination');

    await app.evaluate(`document.querySelector('.tab-more-button').click();[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Group by topic with AI').click()`);
    assert(!await app.evaluate(`document.querySelector('#dialog').textContent.includes('Organise this space')`));
    await app.evaluate(`document.querySelector('#dialog').close()`);
    const beforeLibraryCalls=calls.length;
    for(const scope of [{type:'space',id:'main'},{type:'all'}])await assert.rejects(rpc('ai-assist',{kind:'library',scope}),/no longer available/);
    assert.equal(calls.length,beforeLibraryCalls);
    results.push('Workspace AI entry points are removed and old space requests do not call the provider');

    await app.evaluate(`document.querySelector('[data-collection-id="${source.id}"] .editable-name').click()`);
    await click('Suggest names');
    await wait(()=>app.evaluate(`document.querySelector('.inline-name-suggestions')?.textContent.includes('Clear research name')`),'inline names absent');
    await click('Clear research name');
    await wait(async()=>(await rpc('load')).state.collections.find(c=>c.id===source.id).name==='Clear research name','chosen inline name not saved');
    const suggested=await rpc('ai-assist',{kind:'destinations',tabIds:[tabs[0].id]});
    assert.equal(suggested.name,'Suggested save');assert(suggested.destinations.length);
    const beforeCount=(await rpc('load')).state.collections.length;
    await app.evaluate(`(()=>{const d=new DataTransfer();d.setData('application/x-neo',JSON.stringify({type:'tabs',ids:[${tabs[0].id}]}));document.querySelector('.add-collection').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));})()`);
    await wait(async()=>(await rpc('load')).state.collections.length===beforeCount+1,'drop did not create collection');
    await wait(()=>app.evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Suggest name or destination')`),'drop assistance absent');
    await click('Suggest name or destination');await click('Ask AI');
    await wait(()=>app.evaluate(`document.querySelector('#action-popover')?.textContent.includes('Name this Suggested save')`),'drop suggestions absent');
    await click('Keep here');
    results.push('Inline AI names are selectable and persist; save destination suggestions work; drag-created collections expose contextual filing and naming without interrupting the drop');

    slow=true;const pending=rpc('ai-assist',{kind:'names',collectionId:source.id,requestId:'cancel-assist'});
    await delay(150);await rpc('ai-cancel',{requestId:'cancel-assist'});await assert.rejects(pending);slow=false;
    results.push('Pending contextual AI requests can be cancelled');

    const windows=await app.evaluate('chrome.windows.getAll({})');
    await rpc('library-window');
    const extra=(await app.evaluate('chrome.windows.getAll({})')).find(w=>!windows.some(x=>x.id===w.id));assert.equal(extra.type,'popup');
    await app.evaluate(`chrome.windows.remove(${extra.id})`);
    await app.send('Page.navigate',{url:extensionOrigin+'/app.html#q=Clear%20research'});await delay(500);
    assert.equal(await app.evaluate('document.querySelector("#tab-search").value'),'Clear research');
    await app.send('Page.navigate',{url:extensionOrigin+'/app.html'});await delay(400);
    const eventBefore=(await rpc('load')).timeline.filter(r=>r.event==='switch').length;
    await rpc('switch',{windowId:own.windowId,destinationId:dest.id,tracking:false});await delay(350);
    const events=(await rpc('load')).timeline.filter(r=>r.event==='switch');assert.equal(events.length,eventBefore+1);assert(events[0].name.includes('→'));assert(events[0].operationId);
    await click('Timeline');assert(await app.evaluate(`!!document.querySelector('.timeline-event-list')`));
    await snapshot('timeline-events.png');
    results.push('Standalone Library opens as a popup, encoded Library search works, and switching creates one action-linked Timeline event with a date-grouped event browser');
    await rpc('edit',{kind:'create-space',name:'Other space'});
    const otherSpace=(await rpc('load')).state.spaces.at(-1);
    await rpc('import',{spaceId:otherSpace.id,collections:[{name:'Cross-space destination',spaceId:otherSpace.id,note:'Preserve destination',groups:[],links:[]}]});
    const crossState=(await rpc('load')).state,crossDest=crossState.collections.at(-1);
    await rpc('edit',{kind:'collection',collectionId:crossDest.id,spaceId:otherSpace.id});
    const crossPlan={revision:(await rpc('load')).state.revision,scope:{type:'all'},actions:[{type:'merge',collectionId:source.id,destinationId:crossDest.id}]};
    const movedSource=crossState.collections.find(c=>c.id===crossPlan.actions[0].collectionId);
    await rpc('ai-library-apply',{plan:crossPlan});
    const merged=(await rpc('load')).state.collections.find(c=>c.id===crossDest.id);
    assert.equal(merged.spaceId,otherSpace.id);assert(merged.links.some(l=>l.url===movedSource.links[0].url));
    assert(merged.note.includes(movedSource.note));assert(merged.note.includes('Preserve destination'));
    results.push('Explicit filing merges into a chosen destination while preserving source links and both collection notes');
  } finally {
    await snapshot('last-screen.png');
    await fs.writeFile(path.join(out,'last-state.json'),JSON.stringify({calls,text:await app.evaluate('document.body.innerText')},null,2));
    server.close();server.closeAllConnections();
  }
}
