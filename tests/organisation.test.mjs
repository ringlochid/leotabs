import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_POLICY,policyFor,sanitizeRules,findRule,templateName,applySavedPolicy,rankItems} from '../extension/lib/organisation.js';
import {applyAutomaticPlan,needsAI} from '../extension/lib/ai-organisation.js';
import {initialState,validateCollections,validateSpaces,validatePlan} from '../extension/lib/model.js';
import {sanitizeSettings} from '../extension/lib/settings.js';

test('collection policy overrides space, space overrides global, absent choices inherit',()=>{
  const s=initialState();s.settings.organisation={group:'rules-ai',collectionName:'template'};
  s.spaces[0].organisation={tabOrder:'title',group:'keep'};
  const c={spaceId:'main',organisation:{group:'ai'}};
  assert.deepEqual([policyFor(s,c).group,policyFor(s,c).tabOrder,policyFor(s,c).collectionName],['ai','title','template']);
  assert.equal(policyFor(s).group,'rules-ai');
});
test('priority, title conditions and exclusion rules work internally but settings keep built-in defaults',()=>{
  const rules=sanitizeRules([
    {domain:'github.com/*',group:'Code',color:'mint',priority:1},
    {domain:'github.com/private/*',title:'Confidential',exclude:true,priority:10},
    {title:'guide',group:'Guides',enabled:false,priority:100},
  ]);
  assert(findRule({url:'https://github.com/private/a',title:'Confidential guide'},rules).exclude);
  assert.equal(findRule({url:'https://github.com/private/a',title:'Public guide'},rules).group,'Code');
  assert.equal(findRule({url:'https://github.com.evil.test/x',title:'guide'},rules),null);
  assert.deepEqual(sanitizeSettings({rules,websiteGrouping:false}).rules,initialState().settings.rules);
  assert.equal(sanitizeSettings({rules,websiteGrouping:false}).websiteGrouping,true);
});
test('templates, rule colours and saved ordering respect manual decisions',()=>{
  const c={name:'New collection',links:[{id:'b',url:'https://docs.test/b',title:'Zebra'},{id:'a',url:'https://docs.test/a',title:'Apple'},{id:'m',url:'https://docs.test/m',title:'Manual',manualGroup:true}],groups:[]};
  const p={...DEFAULT_POLICY,collectionName:'template',collectionTemplate:'{domain} · {count}',tabOrder:'title'};
  applySavedPolicy(c,p,[{domain:'docs.test',group:'Docs',color:'mint'}]);
  assert.equal(c.name,'docs.test · 3');assert.equal(c.groups[0].color,'mint');
  assert.deepEqual(c.links.filter(l=>l.groupId).map(l=>l.title),['Apple','Zebra']);
  assert(!c.links.find(l=>l.id==='m').groupId);
  c.name='My name';c.manualName=true;c.manualOrder=true;
  const before=c.links.map(l=>l.id);applySavedPolicy(c,p,[]);
  assert.equal(c.name,'My name');assert.deepEqual(c.links.map(l=>l.id),before);
  assert.equal(templateName('{space}: {title}',[{title:'Article'}],{space:'Research'}),'Research: Article');
});
test('policy and correction metadata survive collection and space validation',()=>{
  const c=validateCollections([{id:'c',name:'C',manualName:true,manualOrder:true,organisation:{group:'keep'},groups:[{id:'g',name:'G',manualName:true}],links:[{id:'l',url:'https://a.test',manualGroup:true,groupId:'g'}]}])[0];
  assert(c.manualName&&c.manualOrder&&c.groups[0].manualName&&c.links[0].manualGroup);
  assert.equal(c.organisation.group,'keep');
  assert.equal(validateSpaces([{id:'s',name:'S',organisation:{tabOrder:'title'}}])[0].organisation.tabOrder,'title');
});
test('automatic AI groups only eligible links and applies explicit reading order',()=>{
  const c={id:'c',name:'New collection',groups:[{id:'g',name:'My group'}],links:[{id:'a',url:'https://a.test',title:'A'},{id:'b',url:'https://b.test',title:'B',manualGroup:true},{id:'c',url:'https://c.test',title:'C',groupId:'g'}]};
  const p={...DEFAULT_POLICY,group:'rules-ai',collectionName:'ai',tabOrder:'ai'};
  assert(needsAI(c,p));
  const plan=validatePlan({collectionName:'Research',groups:[{name:'AI group',linkIds:['a','b','c']}],orderedLinkIds:['c','a','b']},c);
  applyAutomaticPlan(c,plan,p);
  assert.equal(c.name,'Research');assert(!c.links.find(l=>l.id==='a').groupId,'A lone eligible link must stay ungrouped');
  assert(!c.links.find(l=>l.id==='b').groupId);assert.equal(c.links.find(l=>l.id==='c').groupId,'g');
  assert.deepEqual(c.links.map(l=>l.id),['c','a','b']);
  assert.throws(()=>validatePlan({groups:[],orderedLinkIds:['a','a']},c),/reading order/);
});
