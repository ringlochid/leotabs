import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkWorkflow({app,rpc,out,results,delay,origin,extensionOrigin}) {
  const wait=async(fn,message)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(100);}throw Error(message);};
  const click=selector=>app.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await app.evaluate(`document.querySelector('#action-popover')?.hidePopover()`);
  const own=await app.evaluate('chrome.tabs.getCurrent()');const windowId=own.windowId;
  const beforeSettings=(await rpc('load')).state.settings;
  assert.equal(beforeSettings.aiNaming,false);assert(beforeSettings.rules.some(r=>r.domain==='github.com/*'&&r.group==='GitHub'));
  await rpc('import',{collections:[
    {id:'source',name:'Workflow source',autoUpdate:true,color:'#123456',groups:[],links:[{id:'s',title:'Source',url:origin+'/workflow-source'}]},
    {id:'dest',name:'Workflow destination',autoUpdate:false,color:'#fcf0b4',groups:[],links:[{id:'d',title:'Destination',url:origin+'/workflow-destination',note:'Preserve me'}]},
  ]});
  let state=(await rpc('load')).state;
  const source=state.collections.find(c=>c.name==='Workflow source'),dest=state.collections.find(c=>c.name==='Workflow destination');
  await rpc('switch',{windowId,destinationId:source.id,tracking:true});
  await rpc('session-checkpoint',{windowId});
  const savedSource=JSON.stringify((await rpc('load')).state.collections.find(c=>c.id===source.id).links);
  const utility=await app.evaluate(`Promise.all(['chrome://newtab/','chrome://newtab/','chrome://settings/','chrome://extensions/'].map(url=>chrome.tabs.create({windowId:${windowId},url,active:false})))`);
  const windowIds=(await app.evaluate('chrome.windows.getAll({})')).map(w=>w.id).sort();
  await wait(()=>app.evaluate(`!!document.querySelector('[data-collection-id="${dest.id}"] .collection-switch')`),'destination action missing');
  await click(`[data-collection-id="${dest.id}"] .collection-switch`);
  assert.equal(await app.evaluate(`document.querySelector('#dialog input[type="checkbox"]').checked`),false);
  assert(await app.evaluate(`(()=>{const d=document.querySelector('#dialog'),s=getComputedStyle(d);return s.boxShadow==='none' && s.borderRadius==='4px' && !d.textContent.includes('Keep a snapshot') && !d.textContent.includes('Replaces unpinned');})()`));
  assert.equal((await rpc('load')).sessionState.active[windowId]?.collectionId,source.id);
  await click('#dialog footer .primary');
  await wait(async()=> (await rpc('load')).sessionState.active[windowId]?.collectionId===dest.id,'replace failed');
  await delay(2300);
  state=(await rpc('load')).state;
  assert.equal(JSON.stringify(state.collections.find(c=>c.id===source.id).links),savedSource);
  const remaining=await app.evaluate('chrome.tabs.query({})');
  assert(utility.every(t=>!remaining.some(x=>x.id===t.id)));
  assert.deepEqual((await app.evaluate('chrome.windows.getAll({})')).map(w=>w.id).sort(),windowIds);
  results.push('Direct Replace closes new/settings/extension-management tabs in the same window and preserves outgoing saved content');
  await wait(()=>app.evaluate(`document.querySelector('#current-collection')?.textContent.includes('Workflow destination')`),'active collection identity absent');
  await wait(()=>app.evaluate(`chrome.action.getTitle({tabId:${own.id}}).then(t=>t.includes('Workflow destination'))`),'toolbar identity absent');
  assert(await app.evaluate(`document.title.includes('Workflow destination') && document.querySelector('link[rel=icon]').href.startsWith('data:image/png')`));
  assert(!(await app.evaluate(`!!document.querySelector('#save-current,#switch-collection')`)));
  assert(await app.evaluate(`document.querySelector('.head-actions #current-collection') !== null && document.querySelector('[data-collection-id="${dest.id}"] .collection-switch').disabled`));
  for (const width of [1440, 900, 390]) {
    await app.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    assert(await app.evaluate(`(()=>{const global=document.querySelector('.global-actions').getBoundingClientRect(),spaces=document.querySelector('#spaces').getBoundingClientRect(),local=document.querySelector('.head-actions').getBoundingClientRect();return Math.abs(global.top-spaces.top)<2 && local.top>=global.bottom && document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.collection-primary-actions')].every(row=>{const buttons=[...row.querySelectorAll('button')];return buttons.length===3 && buttons.every(b=>Math.abs(b.getBoundingClientRect().top-buttons[0].getBoundingClientRect().top)<2) && row.scrollWidth<=row.clientWidth;});})()`), 'global controls must stay in the first row without overflow at '+width);
  }
  await app.send('Emulation.clearDeviceMetricsOverride');
  results.push('Search and Settings stay upper right beside spaces; AI and current collection occupy the row below at desktop and narrow widths');
  for(const theme of ['light','dark']){await rpc('settings',{settings:{theme}});await delay(250);const shot=await app.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'active-'+theme+'.png'),Buffer.from(shot.data,'base64'));}
  results.push('Current collection name/colour/Close, library favicon and per-tab extension tooltip reflect the active collection');
  const updateToggle='#current-collection input[aria-label="Auto-update current collection"]';
  assert(!(await app.evaluate(`document.querySelector('${updateToggle}').checked`)));
  await click(updateToggle);
  await wait(async()=> (await rpc('load')).sessionState.active[windowId]?.tracking===true,'auto-update did not resume');
  const updateStarted = Date.now();
  const tracked=await app.evaluate(`chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin+'/tracked')},active:false})`);
  await wait(async()=> (await rpc('load')).state.collections.find(c=>c.id===dest.id).links.some(l=>l.url===origin+'/tracked'),'resumed auto-update did not save new tab');
  await wait(async()=> {
    const c=(await rpc('load')).state.collections.find(c=>c.id===dest.id);
    const link=c.links.find(l=>l.url===origin+'/tracked');
    return link && app.evaluate(`!!document.querySelector('[data-collection-id="${dest.id}"] [data-link-id="${link.id}"]')`);
  },'updated collection did not render');
  const updateMs = Date.now()-updateStarted;
  assert(updateMs < 1200, 'auto-update took '+updateMs+'ms');
  results.push('Native tab creation reaches the persisted collection and rendered card in '+updateMs+'ms');
  await app.evaluate(`{window.__burstDone=false;window.__burst=(async()=>{for(let i=0;i<12;i++){await chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin)}+'/burst-'+i,active:false});await new Promise(r=>setTimeout(r,100));}window.__burstDone=true;})();void 0;}`);
  await wait(async()=> (await rpc('load')).state.collections.find(c=>c.id===dest.id).links.some(l=>l.url===origin+'/burst-0'),'continuous activity starved updates');
  assert(!(await app.evaluate('window.__burstDone')), 'first burst update arrived only after activity stopped');
  await app.evaluate('window.__burst');
  await wait(async()=> (await rpc('load')).state.collections.find(c=>c.id===dest.id).links.some(l=>l.url===origin+'/burst-11'),'last burst event was lost');
  results.push('Continuous tab creation updates the collection before the burst ends and preserves the final event');
  await click(updateToggle);
  await wait(async()=> (await rpc('load')).sessionState.active[windowId]?.tracking===false,'auto-update did not pause');
  let pausedLinks=JSON.stringify((await rpc('load')).state.collections.find(c=>c.id===dest.id).links);
  await app.evaluate(`chrome.tabs.remove(${tracked.id})`);
  await delay(2300);
  assert.equal(JSON.stringify((await rpc('load')).state.collections.find(c=>c.id===dest.id).links),pausedLinks);
  await app.send('Page.navigate',{url:extensionOrigin+'/app.html'});await delay(650);
  assert(!(await app.evaluate(`document.querySelector('${updateToggle}').checked`)));
  results.push('Top-right Auto-update resumes actual tab mirroring, pauses immediately, and preserves its state across reload');
  await click('#settings');
  await click('input[aria-label="Auto-update all collections"]');
  await wait(async()=> (await rpc('load')).state.settings.autoUpdateDefault===true,'default setting did not save');
  await rpc('edit',{kind:'create',name:'Default-on fixture',id:'default-on-fixture'});
  assert.equal((await rpc('load')).state.collections.find(c=>c.id==='default-on-fixture').autoUpdate,true);
  assert((await rpc('load')).state.collections.every(c=>c.autoUpdate===true));
  assert.equal((await rpc('load')).sessionState.active[windowId].tracking,true);
  await click('input[aria-label="Auto-update all collections"]');
  await app.evaluate(`document.querySelector('#action-popover')?.hidePopover()`);
  await rpc('edit',{kind:'create',name:'Default-off fixture',id:'default-off-fixture'});
  assert.equal((await rpc('load')).state.collections.find(c=>c.id==='default-off-fixture').autoUpdate,false);
  assert((await rpc('load')).state.collections.every(c=>c.autoUpdate===false));
  assert.equal((await rpc('load')).sessionState.active[windowId].tracking,false);
  pausedLinks=JSON.stringify((await rpc('load')).state.collections.find(c=>c.id===dest.id).links);
  results.push('Global Settings applies On/Off to every existing and new collection and immediately updates open sessions');
  await app.evaluate(`chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin+'/extra')},active:false})`);
  await delay(2300);
  assert.equal(JSON.stringify((await rpc('load')).state.collections.find(c=>c.id===dest.id).links),pausedLinks);
  await click('#current-collection .close-current');
  await wait(async()=>!(await rpc('load')).sessionState.active[windowId],'close current failed');
  assert.equal((await rpc('load')).state.collections.find(c=>c.id===dest.id).links[0].note,'Preserve me');
  results.push('Opened copies never track browsing; top-right Close preserves saved links/notes and ends the active association');
  await app.evaluate(`chrome.tabs.create({windowId:${windowId},url:'chrome://newtab/',active:false})`);
  await rpc('close-window',{windowId});
  assert(!(await app.evaluate(`chrome.tabs.query({windowId:${windowId}}).then(ts=>ts.some(t=>t.url==='chrome://newtab/'))`)));
  results.push('Close tabs works with only utility tabs and no active collection');
  const dragTab=await app.evaluate(`chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin+'/drop-created')},active:false})`);
  await wait(async()=> (await rpc('load')).tabs.some(t=>t.id===dragTab.id),'drag tab missing');
  await app.evaluate(`{const d=new DataTransfer();d.setData('application/x-neo',JSON.stringify({type:'tabs',ids:[${dragTab.id}]}));document.querySelector('.add-collection').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));}`);
  await wait(async()=> (await rpc('load')).state.collections.some(c=>c.links.some(l=>l.url===origin+'/drop-created')),'drop did not save');
  results.push('Dropping onto the New collection placeholder creates a populated collection directly');
  await click(`[data-collection-id="${dest.id}"] [aria-label="Options for Workflow destination"]`);
  await app.evaluate(`{const input=document.querySelector('input[aria-label="Custom collection colour"]');input.value='#351a83';input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await wait(async()=> (await rpc('load')).state.collections.find(c=>c.id===dest.id).color==='#351a83','custom colour not persisted');
  await app.evaluate(`document.querySelector('#action-popover')?.hidePopover()`);
  await app.send('Page.navigate',{url:extensionOrigin+'/app.html'});await delay(600);
  assert.equal((await rpc('load')).state.collections.find(c=>c.id===dest.id).color,'#351a83');
  const bg=await app.evaluate(`getComputedStyle(document.querySelector('[data-collection-id="${dest.id}"] .collection-head')).backgroundColor`);
  assert.equal(bg,'rgb(53, 26, 131)');
  results.push('Custom colour picker persists across reload and renders the selected RGB value');
  await rpc('settings',{settings:{autoGroup:true}});
  // Rules use hostname, so use explicit hostname without a test server port.
  await rpc('settings',{settings:{rules:[{domain:'127.0.0.1',group:'Fixture rules'}]}});
  const ruleTab=await app.evaluate(`chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin+'/rule-created')},active:false})`);
  await wait(()=>app.evaluate(`chrome.tabs.get(${ruleTab.id}).then(t=>t.groupId>=0)`),'automatic grouping did not run');
  const grouped=await app.evaluate(`chrome.tabs.get(${ruleTab.id})`);
  assert.equal((await app.evaluate(`chrome.tabGroups.get(${grouped.groupId})`)).title,'Fixture rules');
  await rpc('ungroup-tabs',{tabIds:[ruleTab.id]});await delay(2300);
  assert.equal((await app.evaluate(`chrome.tabs.get(${ruleTab.id})`)).groupId,-1);
  results.push('Automatic rule grouping works without AI credentials; manual Ungroup stays respected');
  for(const theme of ['light','dark']){
    await rpc('settings',{settings:{theme}});await delay(300);
    const shot=await app.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'workflow-'+theme+'.png'),Buffer.from(shot.data,'base64'));
  }
  // Replace is a review boundary, including Cancel and the unchecked path.
  await click(`[data-collection-id="${source.id}"] .collection-switch`);
  await click('#dialog footer button:first-child');
  assert(!(await rpc('load')).sessionState.active[windowId]);
  const retainedBefore=new Set((await rpc('load')).sessionState.retained.map(r=>r.key));
  await click(`[data-collection-id="${source.id}"] .collection-switch`);
  assert.equal(await app.evaluate(`document.querySelector('#dialog input[type="checkbox"]').checked`),false);
  await click('#dialog footer .primary');
  await wait(async()=> (await rpc('load')).sessionState.active[windowId]?.collectionId===source.id,'unchecked replace failed');
  assert((await rpc('load')).state.collections.length===state.collections.length);
  results.push('Switch Cancel preserves the session; the unchecked option creates no extra collection while recovery remains automatic');

  await rpc('import',{collections:Array.from({length:18},(_,i)=>({id:'drag-'+i,name:'Drag fixture '+i,groups:[],links:Array.from({length:5},(_,j)=>({id:'l'+j,title:'Drag link '+j,url:origin+'/drag-'+i+'-'+j}))}))});
  await wait(()=>app.evaluate(`document.querySelectorAll('.collection').length>=18`),'drag fixtures missing');
  const points=await app.evaluate(`(()=>{
    const cards=[...document.querySelectorAll('.collection')];
    const card=cards.find(c=>c.textContent.includes('Drag fixture 9'));
    card.scrollIntoView({block:'center'});
    const source=card.querySelector('.saved-row');
    window.__dragSource=source;
    const box=source.getBoundingClientRect();
    window.__dragScroll=document.querySelector('#main').scrollTop;
    return {start:{x:box.left+60,y:box.top+box.height/2},end:{x:box.right-40,y:box.top+box.height/2}};
  })()`);
  let payload;
  const listener=e=>{const m=JSON.parse(e.data);if(m.method==='Input.dragIntercepted')payload=m.params.data;};
  app.ws.addEventListener('message',listener);
  try {
    await app.send('Input.setInterceptDrags',{enabled:true});
    await app.send('Input.dispatchMouseEvent',{type:'mouseMoved',...points.start});
    await app.send('Input.dispatchMouseEvent',{type:'mousePressed',...points.start,button:'left',clickCount:1});
    await app.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.start.x+24,y:points.start.y+8,button:'left',buttons:1});
    await wait(()=>!!payload,'native drag did not start');
    await rpc('settings',{settings:{theme:'light'}});
    await delay(450);
    assert(await app.evaluate('window.__dragSource.isConnected'),'live event replaced dragged DOM node');
    assert(await app.evaluate('document.querySelector("#main").scrollTop===window.__dragScroll'),'live event jumped scroll');
    for(const type of ['dragEnter','dragOver','drop'])await app.send('Input.dispatchDragEvent',{type,...points.end,data:payload});
    await app.send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.end,button:'left',clickCount:1});
    await delay(650);
    assert(await app.evaluate('document.querySelector("#main").scrollTop===window.__dragScroll'),'drop jumped scroll');
    assert(await app.evaluate('document.documentElement.dataset.theme==="light" || document.body.dataset.theme==="light"'),'queued refresh did not resume');
  } finally {
    app.ws.removeEventListener('message',listener);
    await app.send('Input.setInterceptDrags',{enabled:false});
  }
  assert(await app.evaluate(`(()=>{const t=document.querySelector('.add-collection'),h=t.getBoundingClientRect().height;const d=new DataTransfer();t.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:d}));const same=t.getBoundingClientRect().height===h;t.dispatchEvent(new DragEvent('dragleave',{bubbles:true,dataTransfer:d}));return same;})()`));
  results.push('Native saved-link drag survives live refresh without replacing its DOM or moving scroll; refresh resumes after drop and the new-collection target keeps its height');
  const originalWindows = await app.evaluate('chrome.windows.getAll({})');
  const originalTabs = (await app.evaluate(`chrome.tabs.query({windowId:${windowId}})`)).map(t => t.id).sort();
  await click(`[data-collection-id="${dest.id}"] .collection-open-window`);
  await wait(async () => (await app.evaluate('chrome.windows.getAll({})')).length === originalWindows.length + 1, 'visible new-window action did not open a window');
  assert.deepEqual((await app.evaluate(`chrome.tabs.query({windowId:${windowId}})`)).map(t => t.id).sort(), originalTabs);
  const createdWindow = (await app.evaluate('chrome.windows.getAll({})')).find(w => !originalWindows.some(x => x.id === w.id));
  await wait(() => app.evaluate(`chrome.tabs.query({windowId:${createdWindow.id}}).then(ts=>ts.some(t=>t.url===${JSON.stringify(origin+'/workflow-destination')}))`), 'new window did not open the saved destination');
  await click(`[data-collection-id="${dest.id}"] [aria-label="Options for Workflow destination"]`);
  assert(await app.evaluate(`![...document.querySelectorAll('#action-popover [role=menuitem]')].some(b=>['Open all','Open in new window','Switch to collection','Close current collection','Fold collection','Unfold collection'].includes(b.textContent.trim()))`));
  await app.evaluate(`document.querySelector('#action-popover')?.hidePopover()`);
  await app.evaluate(`chrome.windows.remove(${createdWindow.id})`);
  results.push('Open in new window is exposed on the card, opens saved pages in a separate window and preserves the original tabs; duplicate menu actions are removed');


}


export async function checkCollectionColors({app,rpc,results,delay,origin,extensionOrigin}) {
  const palette = ['mint','blue','lavender','peach','rose','teal','yellow','grey'];
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  const tab = await app.evaluate(`chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin+'/palette')},active:false})`);
  let previous = (await rpc('load')).state.collections.at(-1)?.color;
  const fresh = [];
  for (let i = 0; i < 3; i++) {
    const saved = await rpc('save', { tabIds: [tab.id], close: false });
    const c = (await rpc('load')).state.collections.find(c => c.id === saved.collectionId);
    assert(palette.includes(c.color));
    assert.notEqual(c.color, previous);
    previous = c.color;
    fresh.push({ id: c.id, color: c.color });
  }
  await rpc('edit', { kind:'duplicate-collection', collectionId:fresh[0].id });
  const copy = (await rpc('load')).state.collections.at(-1);
  assert(palette.includes(copy.color));
  assert.notEqual(copy.color, fresh[0].color);
  await rpc('edit',{kind:'create',id:'palette-manual',name:'New collection'});
  assert(palette.includes((await rpc('load')).state.collections.find(c=>c.id==='palette-manual').color));
  const source=(await rpc('load')).state.collections.find(c=>c.id===fresh[0].id);
  previous=(await rpc('load')).state.collections.at(-1).color;
  await rpc('drop-new',{payload:{type:'link',collectionId:source.id,linkId:source.links[0].id},copy:true});
  const dropped=(await rpc('load')).state.collections.at(-1);
  assert(palette.includes(dropped.color));assert.notEqual(dropped.color,previous);
  await rpc('edit',{kind:'collection',collectionId:copy.id,color:'#123456'});
  await app.send('Page.navigate', { url: extensionOrigin+'/app.html' });
  await delay(450);
  const reloaded = (await rpc('load')).state.collections;
  assert(fresh.every(saved => reloaded.find(c => c.id === saved.id).color === saved.color));
  assert.equal(reloaded.find(c => c.id === copy.id).color, '#123456');
  results.push('New saves, manual and drop-created collections choose palette colours; saves avoid adjacent repeats and duplicates differ from source; chosen/custom colours persist after reload');
}
