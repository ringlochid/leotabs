// SPDX-License-Identifier: MPL-2.0
import {colorHex, colorInk} from './colors.js';
export function drawIdentity(context, size, color) {
  context.clearRect(0,0,size,size);
  context.fillStyle=colorHex(color);
  context.beginPath(); context.roundRect(0,0,size,size,size*.22); context.fill();
  context.fillStyle=colorInk(color); context.font=`bold ${size*.85}px sans-serif`;
  context.textAlign='center'; context.textBaseline='middle'; context.fillText('n',size/2,size*.48);
}
export async function updateIdentity(browser, library, active) {
  const present = new Set();
  for (const tab of await browser.tabs.query({})) {
    if(tab.incognito) continue;
    const c=library.collections.find(c=>c.id===active[tab.windowId]?.collectionId);
    const title=c ? `Neo · ${c.name} · Open library` : 'Open Neo library';
    present.add(tab.id);
    const signature=title+':'+c?.color;
    if(identityCache.get(tab.id)?.signature===signature && identityCache.get(tab.id).applied)continue;
    const entry={signature,applied:false};
    identityCache.set(tab.id,entry);
    const images={};
    if(c) for(const size of [16,32]) {
      const canvas=new OffscreenCanvas(size,size), context=canvas.getContext('2d');
      drawIdentity(context,size,c.color); images[size]=context.getImageData(0,0,size,size);
    }
    try {
      await browser.action.setIcon({tabId:tab.id,...(c?{imageData:images}:{path:{16:'icons/16.png',32:'icons/32.png'}})});
      await browser.action.setTitle({tabId:tab.id,title});
      // Navigation can invalidate this entry while the browser calls are pending.
      if(identityCache.get(tab.id)===entry) entry.applied=true;
    } catch {
      if(identityCache.get(tab.id)===entry) identityCache.delete(tab.id);
    }
  }
  for(const id of identityCache.keys())if(!present.has(id))identityCache.delete(id);
}
const identityCache=new Map();
export function invalidateIdentity(tabId) { identityCache.delete(tabId); }
