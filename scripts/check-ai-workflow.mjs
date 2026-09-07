// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import http from 'node:http';

export async function checkAIWorkflow({ app, rpc, results, delay, origin }) {
  const calls = [];
  let slow = false;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    const prompt = body.messages[0].content;
    const context = JSON.parse(prompt.slice(prompt.indexOf('\nData: ') + 7));
    calls.push({ prompt, context });
    if (slow) await delay(750);
    const groups = context.groups?.length && !prompt.includes('LIVE_PLAN')
      ? context.groups.map(g => ({ name: 'AI group', linkIds: context.links.filter(l => l.groupId === g.id).map(l => l.id) })).filter(g => g.linkIds.length)
      : [{ name: 'AI group', linkIds: context.links.map(l => l.id) }];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ collectionName: 'AI collection', groups, note: '' }) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wait = async (predicate, label) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(50); }
    throw Error(label);
  };
  const collection = async id => (await rpc('load')).state.collections.find(c => c.id === id);
  try {
    const own = await app.evaluate('chrome.tabs.getCurrent()');
    await rpc('settings', { settings: { provider: 'compatible', model: 'local-fixture', aiEndpoint: `http://127.0.0.1:${server.address().port}/chat/completions`, autoGroup: false } });
    assert.equal((await rpc('load')).connections.ai, true);
    const tabs = await app.evaluate(`Promise.all([0,1].map(i=>chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin)}+'/ai-'+i,active:false})))`);
    const first = await rpc('save', { tabIds: tabs.map(t => t.id), close: false });
    await delay(300);
    assert.equal(calls.length, 0, 'AI-off save called provider');
    const native = await rpc('group-tabs', { tabIds: tabs.map(t => t.id), name: 'Group' });
    const context = await rpc('ai-tabs-context', { windowId: own.windowId, tabIds: tabs.map(t => t.id).reverse() });
    const chosen = context.collection.links[0];
    const plan = await rpc('ai-tabs-plan', { context, requestId: 'subset-fixture', linkIds: [chosen.id], instruction: 'LIVE_PLAN' });
    assert.equal(calls.at(-1).context.links.length, 1);
    assert.equal(calls.at(-1).context.links[0].id, chosen.id);
    assert.equal(plan.scopeLinkIds.length, 1);
    plan.groups[0].name = 'Reviewed native group';
    await rpc('ai-tabs-apply', { context, plan });
    const selectedId = context.tabs[0].id;
    const selected = await app.evaluate(`chrome.tabs.get(${selectedId})`);
    assert.equal((await app.evaluate(`chrome.tabGroups.get(${selected.groupId})`)).title, 'Reviewed native group');
    assert.equal((await app.evaluate(`chrome.tabs.get(${context.tabs[1].id})`)).groupId, native.groupId);
    await assert.rejects(rpc('ai-tabs-apply', { context, plan }), /changed/);
    results.push('Live AI sends only the selected subset, applies to the correct native tab, leaves unchecked tabs in place and rejects stale plans');

    const latest = await rpc('ai-tabs-context', { windowId: own.windowId, tabIds: tabs.map(t => t.id) });
    slow = true;
    const count = calls.length;
    const cancelled = rpc('ai-tabs-plan', { context: latest, requestId: 'cancel-fixture', instruction: 'LIVE_PLAN' }).then(() => 'completed', () => 'cancelled');
    await wait(() => calls.length > count, 'cancel request not started');
    await rpc('ai-cancel', { requestId: 'cancel-fixture' });
    assert.equal(await cancelled, 'cancelled');
    results.push('Live-tab AI cancellation aborts the actual provider request without applying a late result');
    slow = false;
    await app.evaluate(`document.querySelector('[data-collection-id="${first.collectionId}"] [aria-label^="Options for"]').click()`);
    await app.evaluate(`[...document.querySelectorAll('#action-popover [role=menuitem]')].find(b=>b.textContent==='Organise with AI').click()`);
    await app.evaluate(`[...document.querySelectorAll('#dialog button')].find(b=>b.textContent==='Generate a plan').click()`);
    await wait(() => app.evaluate(`document.querySelector('#dialog h2')?.textContent==='Review your organisation plan'`), 'AI review did not open');
    await app.evaluate(`{const name=document.querySelector('input[aria-label="Proposed collection name"]');name.value='Reviewed UI collection';name.dispatchEvent(new Event('input'));const group=document.querySelector('input[aria-label="Proposed group name"]');group.value='Reviewed UI group';group.dispatchEvent(new Event('input'));const pick=document.querySelectorAll('#dialog details select')[1];pick.value='';pick.dispatchEvent(new Event('change'));}`);
    assert.equal(await app.evaluate(`document.querySelectorAll('.plan-group li').length`), 1);
    assert(await app.evaluate(`document.querySelector('#dialog details select option[value]:last-child').textContent==='Reviewed UI group'`));
    await app.evaluate(`[...document.querySelectorAll('#dialog button')].find(b=>b.textContent==='Apply selected changes').click()`);
    await wait(async () => (await collection(first.collectionId)).name === 'Reviewed UI collection', 'reviewed AI names were not applied');
    const reviewed = await collection(first.collectionId);
    assert.equal(reviewed.groups[0].name, 'Reviewed UI group');
    assert.equal(reviewed.links.filter(l => l.groupId).length, 1);
    results.push('The actual AI review dialog supports edited collection/group names and individual placement changes with an accurate preview before Apply');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
