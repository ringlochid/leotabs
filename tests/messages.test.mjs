// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { operationFeedback, errorText } from '../extension/lib/messages.js';
import { askJSON } from '../extension/lib/integrations.js';
import { parseImport } from '../extension/lib/portable.js';

const settings = {provider:'compatible',model:'fixture',aiEndpoint:'http://localhost:1234/v1/chat/completions'};
test('no-op and settings results do not request a toast', () => {
  assert.equal(operationFeedback({unchanged:true}, 'move-open-tabs'), null);
  assert.equal(operationFeedback({label:'Saved'}, 'settings'), null);
  assert.equal(operationFeedback({operation:null}, 'edit'), null);
  assert.equal(operationFeedback({label:'Undid Save tabs'}, 'undo-action'), null);
});
test('close feedback reports confirmed counts without claiming skipped tabs remain open', () => {
  const op={label:'Close tabs',closed:[1],skipped:[2],status:'complete'};
  const feedback=operationFeedback(op,'close');
  assert.equal(feedback.message,'Closed 1 tab · Incomplete');
  assert.equal(feedback.error,true);
  assert.equal(op.label,'Close tabs');
  assert.deepEqual(operationFeedback({...op,closed:[],cancelled:true,status:'partial'},'close'),{message:'No tabs closed · Cancelled',error:false});
  assert.equal(operationFeedback({label:'Stash tabs',snapshot:{links:[{},{}]},closed:[1],skipped:[2]},'save').message,'Saved 2 tabs · 1 closed · Incomplete');
});
test('AI HTTP failures identify the failed step without blaming every setting', async () => {
  for(const [status,expected] of [[401,/rejected the API key/],[403,/denied access/],[404,/endpoint or model not found/],[429,/limit reached/],[503,/unavailable/]]) {
    let calls=0;
    await assert.rejects(askJSON('test',settings,'',async()=>{calls++;return new Response('secret response body',{status});}),expected);
    assert.equal(calls,1);
  }
});
test('AI transport errors distinguish cancellation, timeout and connection failure', async () => {
  const controller=new AbortController();controller.abort();
  await assert.rejects(askJSON('test',settings,'',async()=>{throw new DOMException('secret','AbortError');},{signal:controller.signal}),/AI request cancelled/);
  await assert.rejects(askJSON('test',settings,'',async()=>{throw new DOMException('secret','TimeoutError');}),/timed out/);
  await assert.rejects(askJSON('test',settings,'',async()=>{throw new TypeError('Failed to fetch secret endpoint');}),/Can't reach the AI provider/);
});
test('malformed AI output retains its syntax-error type for response repair without exposing raw content', async () => {
  await assert.rejects(askJSON('test',settings,'',async()=>new Response(JSON.stringify({choices:[{message:{content:'secret malformed content'}}]}))),error=>error instanceof SyntaxError && error.message==='AI returned an unreadable response. Try again.');
  assert.throws(()=>parseImport('{"secret":'),error=>error.message==="Can't read this JSON file. Check the format or export it again.");
});
test('browser errors get useful context while specific application failures remain intact', () => {
  assert.match(errorText(new Error('No tab with id: 123')),/no longer available/);
  assert.match(errorText(new Error('Extension context invalidated.')),/Reload the extension/);
  assert.match(errorText(new DOMException('raw browser error','QuotaExceededError')),/storage is full/);
  assert.equal(errorText(new Error("Can't save utility tabs")),"Can't save utility tabs");
});
