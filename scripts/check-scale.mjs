// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkScale({ app, rpc, out, results, delay }) {
  const tab = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: tab.id });
  const measurements = await app.evaluate(`(async()=>{
    const collections=Array.from({length:300},(_,i)=>({name:'Scale collection '+i,color:'blue',groups:[],links:Array.from({length:50},(_,j)=>({id:i+'-'+j,title:'Scale link '+j,url:'https://example.org/scale/'+i+'/'+j,note:'Continuation keyword '+i,groupId:null}))}));
    const start=performance.now();const result=await chrome.runtime.sendMessage({action:'import',data:{collections}});if(!result.ok)throw Error(result.error);
    const imported=performance.now(),loaded=await chrome.runtime.sendMessage({action:'load'}),end=performance.now();
    return {collections:loaded.value.state.collections.length,links:loaded.value.state.collections.reduce((n,c)=>n+c.links.length,0),importMs:imported-start,loadMs:end-imported};
  })()`);
  for (
    let i = 0;
    i < 40 &&
    !(await app.evaluate(
      `document.querySelector('#breadcrumbs').textContent.includes('${measurements.collections}')`,
    ));
    i++
  )
    await delay(100);
  measurements.renderedCollections = await app.evaluate(
    'document.querySelectorAll(".collection").length',
  );
  assert(measurements.renderedCollections <= 60);
  assert.equal(measurements.renderedCollections, 60);
  await app.evaluate('document.querySelector("#global-search").click()');
  measurements.searchMs = await app.evaluate(`(async()=>{
    const input=document.querySelector('.search-dialog input'),start=performance.now();input.value='Continuation keyword 299';input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(requestAnimationFrame);return performance.now()-start;
  })()`);
  assert(
    await app.evaluate(
      `document.querySelector('.search-dialog .search-results').textContent.includes('Scale link')`,
    ),
  );
  measurements.searchNodes = await app.evaluate(
    'document.querySelectorAll(".search-dialog [role=option]").length',
  );
  assert(measurements.searchNodes <= 41);
  await app.evaluate('document.querySelector(".search-dialog").close()');
  await fs.writeFile(path.join(out, 'scale.json'), JSON.stringify(measurements, null, 2));
  results.push(
    '300 additional collections / 15,000 links traverse real import, storage, runtime messaging and search with bounded DOM',
  );
  console.log('Measured library scale:', measurements);
}
