import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const until = async (fn, delay) => {
  for (let i = 0; i < 120; i++) {
    if (await fn()) return;
    await delay(100);
  }
  throw Error('Copy/swap did not settle');
};
export async function checkSwapOverlay({ app, rpc, pin, delay, results, connect, targets, out }) {
  const read = (code) =>
    app.evaluate(
      `chrome.scripting.executeScript({target:{tabId:${pin.id}},func:()=>{const root=globalThis.__neoSurface;${code}}}).then(r=>r[0].result)`,
    );
  await until(() => read('return !!root?.querySelector(".dock-collection")'), delay);
  await read(
    '[...root.querySelectorAll(".dock-collection")].find(b=>b.textContent==="Research").click()',
  );
  assert(
    await read(
      'return [...root.querySelectorAll(".search-scope button")].some(b=>b.textContent==="Open collection")',
    ),
  );
  assert(
    await read(
      'return [...root.querySelectorAll(".search-scope button")].some(b=>b.textContent==="Swap to collection")',
    ),
  );
  const native = await connect(
    (await targets()).find((t) => t.url.endsWith('/pinned')).webSocketDebuggerUrl,
  );
  await fs.writeFile(
    path.join(out, 'overlay-open-and-swap.png'),
    Buffer.from((await native.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  const c = (await rpc('load')).state.collections.find((c) => c.name === 'Research');
  await read(
    '[...root.querySelectorAll(".search-scope button")].find(b=>b.textContent==="Swap to collection").click()',
  );
  await until(
    async () => (await rpc('load')).sessionState.active[pin.windowId]?.collectionId === c.id,
    delay,
  );
  await until(() => read('return !root'), delay);
  const active = await app.evaluate(`chrome.tabs.query({windowId:${pin.windowId},active:true})`);
  assert(
    !active[0].url?.includes('/app.html'),
    'Overlay swap should focus a page, not the library',
  );
  assert.equal((await app.evaluate(`chrome.tabs.get(${pin.id})`)).windowId, pin.windowId);
  results.push(
    'Overlay offers Open and Swap together; Swap replaces unpinned session, preserves pinned tab, closes overlay and focuses a page',
  );
}
export async function checkCopySwap({ app, rpc, out, results, delay }) {
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  for (const name of ['Copy source', 'Copy target']) await rpc('edit', { kind: 'create', name });
  const state = (await rpc('load')).state;
  const source = state.collections.find((c) => c.name === 'Copy source'),
    target = state.collections.find((c) => c.name === 'Copy target');
  for (const title of ['First', 'Second'])
    await rpc('edit', {
      kind: 'add-link',
      collectionId: source.id,
      title,
      url: 'https://example.test/' + title,
    });
  let c = (await rpc('load')).state.collections.find((c) => c.id === source.id);
  await rpc('edit', {
    kind: 'link',
    collectionId: source.id,
    linkId: c.links[0].id,
    note: 'Keep note',
  });
  await rpc('edit', {
    kind: 'group-links',
    collectionId: source.id,
    linkIds: c.links.map((l) => l.id),
    groupId: 'copy-source-group',
  });
  await rpc('edit', { kind: 'create-group', collectionId: target.id, name: 'Target group' });
  const read = async (id) => (await rpc('load')).state.collections.find((c) => c.id === id);
  c = await read(source.id);
  await app.send('Page.reload');
  await until(() => app.evaluate('!!document.querySelector(".saved-row")'), delay);
  const card = (id) => `[data-collection-id="${id}"]`;
  const drop = async (selector, payload, copy) => {
    await app.evaluate(
      `(()=>{const t=document.querySelector(${JSON.stringify(selector)});if(!t)throw Error('Missing drop target');const dt=new DataTransfer();dt.setData('application/x-neo',${JSON.stringify(JSON.stringify(payload))});t.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,ctrlKey:${copy}}));t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,ctrlKey:${copy}}));})()`,
    );
  };
  await drop(
    card(target.id),
    { type: 'link', collectionId: source.id, linkId: c.links[0].id },
    true,
  );
  await until(async () => (await read(target.id)).links.length === 1, delay);
  let dest = await read(target.id);
  assert.equal((await read(source.id)).links.length, 2);
  assert.notEqual(dest.links[0].id, c.links[0].id);
  assert.equal(dest.links[0].note, 'Keep note');
  await drop(
    card(target.id) + ' .saved-group',
    { type: 'links', collectionId: source.id, linkIds: c.links.map((l) => l.id) },
    true,
  );
  await until(async () => (await read(target.id)).links.length === 3, delay);
  dest = await read(target.id);
  assert.equal(dest.links.filter((l) => l.groupId === dest.groups[0].id).length, 2);
  assert.deepEqual((await read(source.id)).links, c.links);
  await drop(
    card(target.id),
    { type: 'group', collectionId: source.id, groupId: 'copy-source-group' },
    true,
  );
  await until(async () => (await read(target.id)).links.length === 5, delay);
  dest = await read(target.id);
  assert.equal(dest.groups.length, 2);
  assert.equal(new Set(dest.links.map((l) => l.id)).size, 5);
  await drop(
    card(target.id),
    { type: 'link', collectionId: source.id, linkId: c.links[0].id },
    false,
  );
  await until(async () => (await read(source.id)).links.length === 1, delay);
  assert((await read(target.id)).links.some((l) => l.id === c.links[0].id));
  results.push(
    'Chrome library drop handlers: Ctrl copies single tabs, selections into groups and whole groups with fresh IDs/notes; normal drag moves originals',
  );
  await app.evaluate(
    `document.querySelector(${JSON.stringify(card(target.id) + ' .collection-switch')}).click()`,
  );
  await until(
    async () => (await rpc('load')).sessionState.active[own.windowId]?.collectionId === target.id,
    delay,
  );
  assert.equal(
    (await app.evaluate(`chrome.tabs.query({windowId:${own.windowId},active:true})`))[0].id,
    own.id,
  );
  results.push('Library card uses the same Swap action and retains library focus');
  await fs.writeFile(
    path.join(out, 'library-copy-and-swap.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
}
