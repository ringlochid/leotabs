import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkWorkonaUX({ app, rpc, out, results, delay, origin, targets, connect }) {
  const wait = async (fn) => {
    for (let i = 0; i < 120; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Session UI did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  const before = (await rpc('load')).state.collections.length;
  const make = async (name) => {
    await rpc('edit', { kind: 'create', name });
    const c = (await rpc('load')).state.collections.find((c) => c.name === name);
    await rpc('edit', {
      kind: 'add-link',
      collectionId: c.id,
      title: name + ' page',
      url: origin + '/' + name,
    });
    return c;
  };
  const a = await make('Session-A'),
    b = await make('Session-B');
  const source = await app.evaluate(
    `chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin + '/live-form')},active:false})`,
  );
  const other = await app.evaluate(
    `chrome.tabs.create({windowId:${own.windowId},url:${JSON.stringify(origin + '/live-other')},active:false})`,
  );
  await wait(() => app.evaluate(`chrome.tabs.get(${source.id}).then(t=>t.status==='complete')`));
  const target = (await targets()).find((t) => t.url === origin + '/live-form');
  const page = await connect(target.webSocketDebuggerUrl);
  await page.evaluate('window.neoDraft="unsaved draft survives"');
  const group = await app.evaluate(
    `chrome.tabs.group({tabIds:[${source.id},${other.id}]}).then(async id=>{await chrome.tabGroups.update(id,{title:'Live research',color:'green'});return id;})`,
  );
  await rpc('session-checkpoint', { windowId: own.windowId });
  await rpc('switch', { destinationId: a.id, windowId: own.windowId, saveCurrent: true });
  const sourceParked = await app.evaluate(`chrome.tabs.get(${source.id})`);
  assert.notEqual(sourceParked.windowId, own.windowId);
  assert.equal(
    await app.evaluate(`chrome.windows.get(${sourceParked.windowId}).then(w=>w.state)`),
    'minimized',
  );
  assert(
    !(await rpc('load')).tabs.some((t) => t.id === source.id),
    'Holding tabs excluded from open tabs/search',
  );
  const previous = (await rpc('load')).sessionState.retained.find(
    (r) => r.name === 'Previous browsing session',
  );
  await rpc('switch', { destinationId: previous.id, windowId: own.windowId, saveCurrent: true });
  assert.equal((await app.evaluate(`chrome.tabs.get(${source.id})`)).windowId, own.windowId);
  assert.equal(await page.evaluate('window.neoDraft'), 'unsaved draft survives');
  assert.equal((await app.evaluate(`chrome.tabs.get(${source.id})`)).groupId, group);
  assert.equal((await rpc('load')).state.collections.length, before + 2);
  results.push(
    'Live switch returns the same Chrome tab IDs, unsaved JS state, native group; no saved-collection duplicates',
  );
  await rpc('switch', { destinationId: a.id, windowId: own.windowId, saveCurrent: true });
  await rpc('switch', { destinationId: b.id, windowId: own.windowId, saveCurrent: true });
  const store = await app.evaluate('chrome.storage.session.get("neoSessions")');
  const holders = Object.entries(store.neoSessions.parked)
    .filter(([key]) => key.startsWith(own.windowId + ':'))
    .map(([, r]) => r.windowId);
  assert.equal(new Set(holders).size, 1, 'Inactive collections share a single minimized window');
  const retained = store.neoSessions.parked[own.windowId + ':' + a.id];
  await app.evaluate(`chrome.windows.remove(${retained.windowId})`);
  await rpc('switch', { destinationId: a.id, windowId: own.windowId, saveCurrent: true });
  assert(
    (await rpc('load')).tabs.some(
      (t) => t.windowId === own.windowId && (t.resourceUrl || t.url) === origin + '/Session-A',
    ),
  );
  results.push('Closing an inactive window falls back to its durable URL snapshot');
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector(".history-navigation")'));
  assert(
    await app.evaluate('document.querySelector("#recent").textContent.includes("Previously open")'),
  );
  const newest = await app.evaluate('document.querySelector(".history-name").textContent');
  await app.evaluate('document.querySelector(".history-navigation button:first-child").click()');
  assert.equal(
    await app.evaluate('document.querySelector(".history-navigation button:last-child").disabled'),
    false,
  );
  await app.evaluate('document.querySelector(".history-navigation button:last-child").click()');
  assert.equal(await app.evaluate('document.querySelector(".history-name").textContent'), newest);
  assert.equal(
    await app.evaluate('document.querySelector(".history-navigation button:last-child").disabled'),
    true,
  );
  const snapshot = (await rpc('load')).timeline.find((r) =>
    r.snapshot.groups.some((g) => g.name === 'Live research'),
  );
  assert(snapshot);
  const restored = await rpc('timeline-restore', {
    id: snapshot.id,
    linkIds: [snapshot.snapshot.links[0].id],
    windowId: own.windowId,
  });
  assert.equal(restored.created.length + restored.reused.length, 1);
  await fs.writeFile(
    path.join(out, 'previously-open.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await app.evaluate(
    'document.querySelector("#switch-collection").focus();document.querySelector("#switch-collection").click()',
  );
  assert(
    await app.evaluate(
      'document.querySelector(".switch-explanation").textContent.includes("minimized")',
    ),
  );
  await fs.writeFile(
    path.join(out, 'session-switch-picker.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  results.push(
    'Previously open navigation, disabled boundaries, individual restore and live-session picker verified',
  );
  await app.evaluate('document.querySelector("#action-popover").hidePopover()');
  await rpc('switch', { destinationId: b.id, windowId: own.windowId, saveCurrent: false });
  assert.equal((await rpc('load')).sessionState.active[own.windowId].collectionId, b.id);
  results.push('Save-current unchecked path switches and remains recoverable');
  const whole = await rpc('timeline-restore', { id: snapshot.id, windowId: own.windowId });
  assert.equal(whole.failed.length, 0);
  assert.equal(whole.groupFailures.length, 0);
  assert(
    (await app.evaluate(`chrome.tabGroups.query({windowId:${own.windowId}})`)).some(
      (g) => g.title === 'Live research',
    ),
  );
  await rpc('settings', { settings: { theme: 'dark' } });
  await app.send('Page.reload');
  await wait(() =>
    app.evaluate(
      'document.documentElement.dataset.theme === "dark" && !!document.querySelector(".history-navigation")',
    ),
  );
  await fs.writeFile(
    path.join(out, 'previously-open-dark.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  results.push('Whole-session restore recreates native groups; history renders in dark theme');
}
