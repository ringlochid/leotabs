// SPDX-License-Identifier: MPL-2.0
import {randomCollectionColor} from './colors.js';
import {isGenericName,findRule} from './organisation.js';

export function needsAI(c,p,rules=[]) {
  return p.automatic && (
    p.collectionName==='ai'&&!c.manualName&&isGenericName(c.name)
    || p.groupName==='ai'&&c.groups.some(g=>!g.manualName&&isGenericName(g.name))
    || ['ai','rules-ai'].includes(p.group)&&c.links.some(l=>!l.groupId&&!l.manualGroup&&!findRule(l,rules)?.exclude)
    || !c.manualOrder&&(p.tabOrder==='ai'||p.groupOrder==='ai')
  );
}
export function organisationInstruction(p) {
  return `Group policy: ${p.group}. ${['ai','rules-ai'].includes(p.group)?'Classify ungrouped links into existing or new project groups. Leave uncertain links ungrouped.':'Keep group membership exactly.'} Never move manually grouped links. Collection naming: ${p.collectionName}. Group naming: ${p.groupName}; keep specific existing names. ${[p.tabOrder,p.groupOrder,p.collectionOrder].includes('ai')?'Provide orderedLinkIds and groups in this order: '+p.orderInstruction:'Do not change the order.'} Return no note.`;
}
export function applyAutomaticPlan(c,plan,p,rules=[]) {
  if(p.collectionName==='ai'&&!c.manualName&&isGenericName(c.name)&&plan.collectionName)c.name=plan.collectionName;
  for(const group of plan.groups) {
    const exact=c.groups.find(g=>{
      const ids=c.links.filter(l=>l.groupId===g.id).map(l=>l.id);
      return ids.length&&ids.length===group.linkIds.length&&ids.every(id=>group.linkIds.includes(id));
    });
    if(exact&&p.groupName==='ai'&&!exact.manualName&&isGenericName(exact.name))exact.name=group.name;
    if(!['ai','rules-ai'].includes(p.group))continue;
    const eligible=c.links.filter(l=>group.linkIds.includes(l.id)&&!l.groupId&&!l.manualGroup&&!findRule(l,rules)?.exclude);
    if(!eligible.length)continue;
    let target=c.groups.find(g=>g.name===group.name);
    if(!target&&eligible.length<2)continue;
    if(!target){target={id:crypto.randomUUID(),name:group.name,color:randomCollectionColor(c.groups.at(-1)?.color),collapsed:false};c.groups.push(target);}
    for(const link of eligible)link.groupId=target.id;
  }
  if(!c.manualOrder) {
    if(p.tabOrder==='ai'&&plan.orderedLinkIds?.length) {
      const rank=new Map(plan.orderedLinkIds.map((id,i)=>[id,i]));
      c.links.sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));
    }
    if(p.groupOrder==='ai') {
      const rank=new Map(plan.groups.map((g,i)=>[g.name,i]));
      c.groups.sort((a,b)=>(rank.get(a.name)??Infinity)-(rank.get(b.name)??Infinity));
    }
  }
  return c;
}
