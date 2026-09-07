// SPDX-License-Identifier: MPL-2.0
import {el,button,field,modal,task} from './shared.js';
import {findRule} from '../lib/organisation.js';
import {website,RULE_PRESETS} from '../lib/website-groups.js';
import {PALETTE} from '../lib/model.js';
export function rulesDialog({state,tabs=[],change,seed}) {
  const rules=structuredClone(state.settings.rules||[]).sort((a,b)=>(b.priority||0)-(a.priority||0));
  const automatic=el('input',{type:'checkbox',role:'switch',checked:state.settings.autoGroup!==false,'aria-label':'Auto-group new tabs'});
  const websites=el('input',{type:'checkbox',checked:state.settings.websiteGrouping!==false,'aria-label':'Group remaining tabs by website'});
  const list=el('div',{class:'rules-list'}),presets=el('div',{class:'rule-presets'}),suggestions=el('div',{class:'rule-suggestions'});
  function add(rule){rules.push({id:crypto.randomUUID(),enabled:true,color:'random',...rule});render();}
  function render(){
    list.replaceChildren(...rules.map((rule,index)=>{
      const toggle=el('input',{type:'checkbox',checked:rule.enabled!==false,'aria-label':'Enable '+(rule.group||rule.domain||'rule'),onchange:e=>rule.enabled=e.target.checked});
      const summary=el('summary',{},toggle,el('span',{},rule.exclude?'Leave matching tabs alone':rule.group||'New rule'),el('span',{class:'hint'},rule.domain||rule.title||'Choose a website'));
      const count=el('p',{class:'hint',role:'status'});
      const updateCount=()=>{count.textContent=`Matches ${tabs.filter(t=>findRule(t,[{...rule,enabled:true}])).length} open tabs`;};
      const input=(key,label)=>field(label,el('input',{value:rule[key]||'',oninput:e=>{rule[key]=e.target.value;updateCount();}}));
      const colour=el('select',{'aria-label':'Group colour',onchange:e=>rule.color=e.target.value},...['random',...PALETTE].map(c=>el('option',{value:c,selected:c===(rule.color||'random')},c==='random'?'Random':c)));
      const details=el('details',{class:'rule-card',open:!!rule.editing},summary,el('div',{class:'rule-editor'},
        input('domain','Website or URL pattern'),input('group','Group name'),field('Colour',colour),count,
        el('details',{},el('summary',{},'Advanced'),input('title','Title contains'),el('label',{class:'check-label'},el('input',{type:'checkbox',checked:!!rule.regex,onchange:e=>{rule.regex=e.target.checked;updateCount();}}),'Use a regular expression for URL matching'),el('label',{class:'check-label'},el('input',{type:'checkbox',checked:!!rule.exclude,onchange:e=>rule.exclude=e.target.checked}),'Leave matching tabs alone'),el('p',{class:'hint'},'Use * for URL wildcards. Both conditions must match. GitHub names can use {project}.')),
        el('div',{class:'rule-row-actions'},button('Move up',()=>{if(index){[rules[index-1],rules[index]]=[rules[index],rules[index-1]];render();}}),button('Move down',()=>{if(index<rules.length-1){[rules[index+1],rules[index]]=[rules[index],rules[index+1]];render();}}),button('Remove',()=>{rules.splice(index,1);render();}))));
      toggle.onclick=e=>e.stopPropagation();updateCount();return details;
    }));
    if(!rules.length)list.append(el('p',{class:'hint'},'Website grouping already works. Add a rule only when you want a different destination.'));
  }
  for(const preset of RULE_PRESETS)presets.append(button(preset.name,()=>{
    for(const rule of preset.rules)if(!rules.some(r=>r.domain===rule.domain&&r.group===rule.group))rules.unshift({id:crypto.randomUUID(),enabled:true,color:'random',...rule});render();
  },{title:preset.description}));
  const sites=new Map();for(const tab of tabs){const site=website(tab.resourceUrl||tab.url);if(site){if(!sites.has(site.key))sites.set(site.key,{...site,tabs:[]});sites.get(site.key).tabs.push(tab);}}
  for(const site of [...sites.values()].sort((a,b)=>b.tabs.length-a.tabs.length).slice(0,4))suggestions.append(button(`Group ${site.tabs.length} ${site.name} tab${site.tabs.length===1?'':'s'}`,()=>{
    if(!rules.some(r=>r.domain===site.key.slice(5)))add({domain:site.key.slice(5),group:site.name,editing:true});
  }));
  if(seed?.length){const hosts=[...new Set(seed.map(t=>{try{return new URL(t.resourceUrl||t.url).hostname;}catch{return '';}}))].filter(Boolean);for(const domain of hosts)add({domain,group:seed.groupName||website('https://'+domain)?.name||domain,editing:true});}
  render();
  const body=el('div',{class:'rules-screen'},
    el('div',{class:'rules-defaults'},el('label',{class:'check-label'},websites,'Group remaining tabs by website'),el('p',{class:'hint'},'Short names, varied colours and alphabetical order. Works locally, without AI.'),el('label',{class:'settings-preference'},el('span',{},'Auto-group new tabs'),automatic),el('p',{class:'hint'},'Create a new group when at least two tabs match. A single tab can join an existing group.')),
    el('strong',{},'Ready-made rules'),presets,
    sites.size?el('div',{},el('strong',{},'From your open tabs'),suggestions):null,
    el('div',{class:'rules-heading'},el('strong',{},'Your rules'),button('Add rule',()=>add({editing:true}))),el('p',{class:'hint'},'First matching rule wins. Move specific rules above general ones.'),list);
  const {close}=modal('Grouping rules',body,[button('Cancel',()=>close()),button('Save rules',task(async()=>{
    await change('settings',{settings:{autoGroup:automatic.checked,websiteGrouping:websites.checked,rules:rules.map((r,i)=>({...r,priority:rules.length-i}))}});close();
  }),{className:'primary'})]);
}
