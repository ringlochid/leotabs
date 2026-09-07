// SPDX-License-Identifier: MPL-2.0
import {uid,text} from './model.js';
export function libraryScope(state,scope) {
  if(scope?.type==='all')return state.collections;
  if(scope?.type==='space'&&state.spaces.some(s=>s.id===scope.id))return state.collections.filter(c=>c.spaceId===scope.id);
  throw Error('Choose a space or explicitly choose All spaces.');
}
export function validateLibraryPlan(raw,state,scope) {
  const collections=libraryScope(state,scope),ids=new Set(collections.map(c=>c.id));
  if(!Array.isArray(raw.actions)||raw.actions.length>300)throw Error('Invalid library plan.');
  const actions=raw.actions.map(a=>{
    if(!['rename','move','merge','order'].includes(a.type))throw Error('Unsupported library action.');
    if(a.type==='order') {
      if(!Array.isArray(a.collectionIds)||a.collectionIds.some(id=>!ids.has(id))||new Set(a.collectionIds).size!==a.collectionIds.length)throw Error('Invalid collection order.');
      return {type:'order',collectionIds:a.collectionIds};
    }
    if(!ids.has(a.collectionId))throw Error('Plan references a collection outside the selected scope.');
    if(a.type==='rename') {
      const name=text(a.name,500).trim();if(!name)throw Error('A proposed name is empty.');
      return {type:a.type,collectionId:a.collectionId,name};
    }
    if(!ids.has(a.destinationId)||a.destinationId===a.collectionId)throw Error('Invalid destination.');
    if(a.type==='merge')return {type:a.type,collectionId:a.collectionId,destinationId:a.destinationId};
    const source=collections.find(c=>c.id===a.collectionId);
    if(!Array.isArray(a.linkIds)||!a.linkIds.length||new Set(a.linkIds).size!==a.linkIds.length||a.linkIds.some(id=>!source.links.some(l=>l.id===id)))throw Error('Invalid moved links.');
    return {type:'move',collectionId:a.collectionId,destinationId:a.destinationId,linkIds:a.linkIds};
  });
  return {revision:state.revision,scope,actions};
}
export function applyLibraryPlan(state,plan) {
  if(state.revision!==plan.revision)throw Error('The library changed. Generate a new plan before applying it.');
  const checked=validateLibraryPlan(plan,state,plan.scope);
  for(const action of checked.actions) {
    if(action.type==='order') {
      const rank=new Map(action.collectionIds.map((id,i)=>[id,i]));
      const ordered=state.collections.filter(c=>rank.has(c.id)).sort((a,b)=>rank.get(a.id)-rank.get(b.id));
      state.collections=state.collections.map(c=>rank.has(c.id)?ordered.shift():c);continue;
    }
    const source=state.collections.find(c=>c.id===action.collectionId);
    if(!source)throw Error('Selected actions conflict. Review the plan again.');
    if(action.type==='rename'){source.name=action.name;source.manualName=true;continue;}
    const dest=state.collections.find(c=>c.id===action.destinationId);
    if(!dest)throw Error('Selected actions conflict. Review the plan again.');
    const selected=source.links.filter(l=>action.type==='merge'||action.linkIds.includes(l.id));
    if(action.type==='move'&&selected.length!==action.linkIds.length)throw Error('Selected actions move the same link twice.');
    const groups=new Map();
    for(const group of source.groups.filter(g=>selected.some(l=>l.groupId===g.id))) {
      const existing=dest.groups.find(g=>g.name===group.name),id=existing?.id||uid();
      if(!existing)dest.groups.push({...group,id});groups.set(group.id,id);
    }
    const existingIds=new Set(dest.links.map(l=>l.id));
    dest.links.push(...selected.map(l=>({...l,id:existingIds.has(l.id)?uid():l.id,groupId:groups.get(l.groupId)||null,manualGroup:true})));
    source.links=source.links.filter(l=>!selected.includes(l));
    if(action.type==='merge') {
      if(source.note) {
        const combined=[dest.note,source.name+'\n'+source.note].filter(Boolean).join('\n\n');
        if(combined.length>10000)throw Error('Combined notes exceed the collection limit. Move the links and keep both notes separately.');
        dest.note=combined;
      }
      state.collections=state.collections.filter(c=>c.id!==source.id);
    }
    dest.updatedAt=Date.now();source.updatedAt=Date.now();
  }
}
export function destinationSuggestions(tabs,collections) {
  const hosts=new Set(tabs.map(t=>{try{return new URL(t.resourceUrl||t.url).hostname;}catch{return '';}}));
  return collections.map(c=>({id:c.id,name:c.name,score:c.links.reduce((n,l)=>{try{return n+Number(hosts.has(new URL(l.url).hostname));}catch{return n;}},0)})).filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
}
