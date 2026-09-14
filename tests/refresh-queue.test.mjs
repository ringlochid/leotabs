// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefreshQueue} from '../extension/ui/refresh-queue.js';
const deferred = () => { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a change during a read discards stale state and resolves all callers after the latest render',async()=>{
  const reads=[deferred(),deferred()], applied=[];
  let calls=0, resolved=false;
  const queue=createRefreshQueue({load:()=>reads[calls++].promise,apply:s=>applied.push(s.tabs)});
  const first=queue.request(), closed=queue.request().then(()=>resolved=true);
  reads[0].resolve({tabs:['closed-tab']});await tick();
  assert.deepEqual(applied,[]);assert.equal(resolved,false);assert.equal(calls,2);
  reads[1].resolve({tabs:[]});await Promise.all([first,closed]);
  assert.deepEqual(applied,[[]]);assert.equal(resolved,true);
});
test('passive polling does not continually invalidate a slow read',async()=>{
  const read=deferred();let calls=0,renders=0;
  const queue=createRefreshQueue({load:()=>{calls++;return read.promise;},apply:()=>renders++});
  const requests=[queue.request(),queue.request({passive:true}),queue.request({passive:true})];
  read.resolve({});await Promise.all(requests);
  assert.equal(calls,1);assert.equal(renders,1);
});
test('a newer queued change still loads when the older request fails',async()=>{
  const first=deferred();let calls=0,renders=0;
  const queue=createRefreshQueue({load:()=>++calls===1?first.promise:Promise.resolve({}),apply:()=>renders++});
  const older=queue.request(),newer=queue.request();first.reject(Error('Old connection failed'));
  await Promise.all([older,newer]);assert.equal(calls,2);assert.equal(renders,1);
});
test('busy responses retry without waiting for the polling timer and eventually time out',async()=>{
  let calls=0,time=0,renders=0,busy=true;
  const queue=createRefreshQueue({load:async()=>({layoutBusy:busy&&++calls<3}),apply:()=>renders++,pause:async ms=>{time+=ms;},now:()=>time,timeout:160});
  await queue.request();assert.equal(calls,3);assert.equal(renders,1);
  calls=-10;await assert.rejects(queue.request(),/still changing/);
  busy=false;await queue.request();assert.equal(renders,2);
});
test('a failed read can recover and disposing prevents a late render',async()=>{
  let fail=true,renders=0;const read=deferred();
  const queue=createRefreshQueue({load:()=>fail?Promise.reject(Error('Offline')):read.promise,apply:()=>renders++});
  await assert.rejects(queue.request(),/Offline/);fail=false;
  const pending=queue.request();queue.dispose();await pending;
  read.resolve({});await tick();assert.equal(renders,0);
});
