// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkMessages({app,rpc,results,delay,origin,out}) {
  const wait=async(fn,message)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(60);}throw Error(message);};
  const click=selector=>app.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const toast=()=>app.evaluate(`document.querySelector('#toast:not([hidden]) > span')?.textContent||''`);
  const shot=async name=>fs.writeFile(path.join(out,name+'.png'),Buffer.from((await app.send('Page.captureScreenshot')).data,'base64'));
  await rpc('settings',{settings:{autoGroup:false,closeAfterStash:false,theme:'dark'}});
  const utility=await app.evaluate(`chrome.tabs.create({url:'chrome://newtab/',active:false})`);
  await wait(()=>app.evaluate(`document.querySelectorAll('#tabs .tab-row').length===1`),'Utility tab did not render');
  await click('#stash-button');
  assert.equal(await app.evaluate(`document.querySelector('#action-popover h2').textContent`),'Save 1 tab');
  await click('#action-popover .primary');
  await wait(async()=>await toast()==="Can't save utility tabs",'Utility error did not appear');
  assert(await app.evaluate(`(()=>{const n=document.querySelector('#toast'),r=n.getBoundingClientRect();return !!n.closest('#action-popover')&&r.bottom<=innerHeight&&n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()`),'Error is covered by the popover or outside the viewport');
  assert.equal((await rpc('load')).state.collections.length,0);
  assert(await app.evaluate(`chrome.tabs.get(${utility.id}).then(t=>!!t)`));
  await shot('utility-save-message');
  await app.evaluate(`document.querySelector('#toast [aria-label="Dismiss"]').click();document.querySelector('#action-popover button[aria-label="Cancel"]').click()`);
  await app.evaluate(`chrome.tabs.remove(${utility.id})`);
  const tab=await app.evaluate(`chrome.tabs.create({url:${JSON.stringify(origin)}+'/message-fixture',active:false})`);
  const row=`.tab-row[data-tab-id="${tab.id}"]`;
  await wait(()=>app.evaluate(`!!document.querySelector('${row}')`),'Web tab did not render');
  await app.evaluate(`(async()=>{
    const row=document.querySelector('${row}'),r=row.getBoundingClientRect(),dt=new DataTransfer();
    dt.setData('application/x-neo',JSON.stringify({type:'tabs',ids:[${tab.id}]}));
    await row.ondrop(new DragEvent('drop',{dataTransfer:dt,clientX:r.left+40,clientY:r.top+2}));
  })()`);
  assert.equal(await toast(),'','Dropping onto the same tab must not show a no-op toast');
  await click('#stash-button');await click('#action-popover .primary');
  await wait(async()=>await toast()==='Saved 1 tab','Save outcome did not use the confirmed count');
  assert(await app.evaluate(`!!document.querySelector('#toast button[aria-label="Undo"]')`),'Save feedback lost Undo');
  await shot('saved-tab-message');
  await click('#toast button[aria-label="Undo"]');
  await wait(async()=>(await rpc('load')).state.collections.length===0,'Undo did not restore the library');
  results.push('Utility-save errors are compact, singular counts are correct, no-op drops stay quiet and successful save feedback retains working Undo');
  await app.evaluate(`import('./ui/shared.js').then(({toast})=>toast('Test failure',{error:true}))`);
  assert.equal(await app.evaluate(`document.querySelector('#toast').className`),'error');
  results.push('Errors retain their visible error treatment and dismissal control');
  const quickURL=await app.evaluate(`chrome.runtime.getURL('quick.html')`);
  await app.send('Page.navigate',{url:quickURL});
  await wait(()=>app.evaluate(`!!document.querySelector('#quick-search')`),'Switcher did not load');
  await app.evaluate(`[...document.querySelectorAll('button[aria-label="Save tabs"]')].find(b=>b.getClientRects().length).click()`);
  await click('#action-popover .primary');
  await wait(async()=>await toast()==='Saved 1 tab','Switcher save feedback differs from the Library');
  await shot('switcher-save-message');
  await click('#toast button[aria-label="Undo"]');
  await wait(async()=>(await rpc('load')).state.collections.length===0,'Switcher Undo failed');
  results.push('The switcher shares concise save feedback and working Undo with the Library');
}
