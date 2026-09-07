// SPDX-License-Identifier: MPL-2.0
import {el,button,modal,task,rpc} from './shared.js';
import {uid} from '../lib/model.js';
import {providerEndpoint} from '../lib/providers.js';
import {endpointOrigin} from '../lib/integrations.js';
import {linkPicker} from './link-picker.js';
export async function assist(state,data) {
  const granted=await chrome.permissions.request({origins:[endpointOrigin(providerEndpoint(state.settings))+'/*']});
  if(!granted)throw Error('AI access was not enabled.');
  return rpc('ai-assist',data);
}
export function researchOverview({state,collection,change}) {
  const picks=linkPicker(collection.links,{max:20});
  const status=el('p',{class:'hint',role:'status'}),requestId=uid();let cancelled=false;
  const {dialog,close}=modal('Research overview',el('div',{},el('p',{},'Read selected open pages and draft an overview with sources and suggested next steps.'),picks.node,status),[
    button('Cancel',()=>close()),button('Read pages and draft',task(async()=>{
      const links=collection.links.filter(l=>picks.ids().includes(l.id));
      if(!links.length)throw Error('Choose at least one page.');
      const origins=[...new Set(links.filter(l=>/^https?:/.test(l.url)).map(l=>new URL(l.url).origin+'/*'))];
      const granted=await chrome.permissions.request({origins:[...origins,endpointOrigin(providerEndpoint(state.settings))+'/*']});
      if(!granted)throw Error('Page access was not enabled.');
      status.textContent='Reading pages and drafting…';
      const result=await rpc('ai-assist',{kind:'overview',collectionId:collection.id,linkIds:links.map(l=>l.id),requestId});
      if(cancelled)return;close();
      const note=el('textarea',{rows:14,value:result.note,'aria-label':'Research overview draft'});
      const review=modal('Review research overview',el('div',{},note,result.unavailable.length?el('details',{},el('summary',{},result.unavailable.length+' pages not read'),...result.unavailable.map(p=>el('p',{},p.url+' · '+p.reason))):null),[
        button('Cancel',()=>review.close()),button('Save collection note',task(async()=>{await change('ai-overview-apply',{collectionId:collection.id,note:note.value,revision:result.revision});review.close();}),{className:'primary'}),
      ]);
    }),{className:'primary'}),
  ]);
  dialog.addEventListener('close',()=>{cancelled=true;rpc('ai-cancel',{requestId}).catch(()=>{});},{once:true});
}
