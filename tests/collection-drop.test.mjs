// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionDropPlan } from '../extension/ui/collection-drop.js';

const node = (dataset, top, height=40) => ({
  dataset,
  getBoundingClientRect: () => ({left:20,right:320,top,bottom:top+height,width:300,height}),
});
const card = ({rows=[],groups=[]}={}) => ({
  querySelector: selector => selector === '.collection-body'
    ? {querySelectorAll: () => rows}
    : node({},20),
  querySelectorAll: () => groups,
});

test('a whole-group drop after the last visible group inserts before hidden groups', () => {
  const groups=[node({groupId:'visible'},100,80)];
  const collection={id:'c',groups:[{id:'visible'},{id:'hidden'}],links:[]};
  const plan=collectionDropPlan(card({groups}),collection,{x:40,y:179},{type:'tabs',wholeGroup:true});
  assert.equal(plan.beforeId,'hidden');
  assert.equal(plan.group,true);
  assert.equal(plan.rect.top,179);
});

test('row gaps choose one insertion boundary and position before hidden links', () => {
  const rows=[node({linkId:'one'},100),node({linkId:'two'},150)];
  const collection={id:'c',groups:[],links:[{id:'one'},{id:'two'},{id:'hidden'}]};
  const a=collectionDropPlan(card({rows}),collection,{x:40,y:141},{type:'tabs'});
  const b=collectionDropPlan(card({rows}),collection,{x:40,y:149},{type:'tabs'});
  for (const key of ['left','top','width','height']) assert.equal(a.rect[key],b.rect[key]);
  assert.equal(a.beforeId,'two');assert.equal(b.beforeId,'two');
  const after=collectionDropPlan(card({rows}),collection,{x:40,y:189},{type:'tabs'});
  assert.equal(after.beforeId,'hidden');assert.equal(after.groupId,null);
});

test('moving the first saved row onto its own position leaves the insertion before the next survivor', () => {
  const rows=[node({linkId:'one'},100),node({linkId:'two'},150)];
  const collection={id:'c',groups:[],links:[{id:'one'},{id:'two'}]};
  const plan=collectionDropPlan(card({rows}),collection,{x:40,y:101},{type:'link',collectionId:'c',linkId:'one'});
  assert.equal(plan.beforeId,'two');
});
