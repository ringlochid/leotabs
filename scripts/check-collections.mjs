import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkCollections({ app, rpc, out, results, delay, origin }) {
  const wait = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Collection UI did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  const win = await app.evaluate(`chrome.windows.create({tabId:${own.id}})`);
  const create = async (name, pinned = false) =>
    app.evaluate(
      `chrome.tabs.create(${JSON.stringify({ windowId: win.id, url: origin + '/' + name, pinned, active: false })})`,
    );
  const old = await create('collection-old'),
    fresh = await create('collection-new'),
    duplicate = await create('collection-new'),
    second = await create('collection-second'),
    pinned = await create('collection-pinned', true);
  await app.evaluate(
    `chrome.tabs.group({tabIds:[${old.id},${fresh.id},${duplicate.id}]}).then(id=>chrome.tabGroups.update(id,{title:'Live research',color:'blue'}))`,
  );
  await delay(1200);
  await rpc('edit', { kind: 'create', name: 'Collection workflow' });
  let data = await rpc('load');
  const c = data.state.collections.find((x) => x.name === 'Collection workflow');
  await rpc('edit', { kind: 'create-group', collectionId: c.id, name: 'Curated research' });
  const group = (await rpc('load')).state.collections.find((x) => x.id === c.id).groups[0];
  await rpc('edit', {
    kind: 'add-link',
    collectionId: c.id,
    url: origin + '/collection-old',
    title: 'My custom title',
    note: 'Keep link note',
    groupId: group.id,
  });
  await rpc('edit', { kind: 'collection', collectionId: c.id, note: 'Keep collection note' });
  const get = async () => (await rpc('load')).state.collections.find((x) => x.id === c.id);
  const before = await get();
  const preview = () => rpc('collection-update-preview', { collectionId: c.id, windowId: win.id });
  const rev = (await rpc('load')).state.revision;
  let plan = await preview();
  assert.equal(plan.additions.length, 2);
  assert.equal(plan.alreadySaved, 1);
  assert.equal(plan.currentCount, 4);
  assert.equal((await rpc('load')).state.revision, rev);
  const apply = (p, urls) =>
    rpc('collection-update', {
      collectionId: c.id,
      windowId: win.id,
      expectedRevision: p.revision,
      signature: p.signature,
      urls,
    });
  await rpc('edit', { kind: 'collection', collectionId: c.id, pinned: true });
  await assert.rejects(apply(plan, [origin + '/collection-new']), /library changed/);
  assert.equal((await get()).updatedAt, before.updatedAt);
  plan = await preview();
  await app.evaluate(
    `chrome.tabs.update(${second.id},{url:${JSON.stringify(origin + '/collection-changed')}})`,
  );
  await delay(600);
  await assert.rejects(apply(plan, [origin + '/collection-new']), /Open tabs changed/);
  assert.deepEqual((await get()).links, before.links);
  await rpc('edit', { kind: 'collection', collectionId: c.id, collapsed: true });
  assert.equal((await get()).updatedAt, before.updatedAt);
  await rpc('edit', { kind: 'collection', collectionId: c.id, collapsed: false });
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector(".collection-meta")'));
  await rpc('activate', { tabId: own.id });
  await app.send('Page.bringToFront');
  const selector = `[data-collection-id="${c.id}"]`;
  const card = (code) =>
    app.evaluate(
      `(()=>{const card=document.querySelector(${JSON.stringify(selector)});${code}})()`,
    );
  assert.equal(
    await app.evaluate('document.querySelector(".collection").dataset.collectionId'),
    c.id,
  );
  assert(
    await card('return card.querySelector(".collection-meta").textContent.includes("Pinned")'),
  );
  const open = async () => {
    await card(
      '[...card.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Options for Collection workflow").click()',
    );
    await app.evaluate(
      '[...document.querySelectorAll("#action-popover button")].find(b=>b.textContent==="Update from current window").click()',
    );
    await wait(() =>
      app.evaluate('!!document.querySelector("dialog[open] .collection-update-list")'),
    );
  };
  const footer = (label) =>
    app.evaluate(
      `[...document.querySelectorAll('dialog footer button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`,
    );
  await open();
  assert.equal(await app.evaluate('document.querySelectorAll(".collection-update-row").length'), 2);
  await footer('Cancel');
  assert.deepEqual((await get()).links, before.links);
  await open();
  await app.evaluate('document.querySelectorAll(".collection-update-row input")[1].click()');
  await fs.writeFile(
    path.join(out, 'collection-update-review.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  const tabsBefore = (await app.evaluate(`chrome.tabs.query({windowId:${win.id}})`))
    .map((t) => t.id)
    .sort();
  await footer('Add 1 tab');
  await wait(async () => (await get()).links.length === 2);
  const after = await get();
  assert.deepEqual(after.links[0], before.links[0]);
  assert.equal(after.note, before.note);
  assert.equal(after.links[1].url, origin + '/collection-new');
  assert.equal(after.links[1].groupId, group.id);
  assert.deepEqual(after.groups, before.groups);
  assert(after.updatedAt > before.updatedAt);
  assert.deepEqual(
    (await app.evaluate(`chrome.tabs.query({windowId:${win.id}})`)).map((t) => t.id).sort(),
    tabsBefore,
  );
  const journal = (await rpc('load')).journal.find((j) => j.label === 'Update collection');
  await rpc('undo-action', { id: journal.id, windowId: win.id });
  assert.deepEqual((await get()).links, before.links);
  assert.equal((await get()).note, before.note);
  await app.send('Page.reload');
  await wait(() => card('return !!card?.querySelector(".collection-meta")'));
  assert.equal((await get()).pinned, true);
  await fs.writeFile(
    path.join(out, 'collection-pinned-library.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await rpc('switch', { destinationId: c.id, windowId: win.id, saveCurrent: true });
  await create('collection-active-new');
  await wait(() =>
    card('return card?.querySelector(".collection-update-prompt")?.textContent==="1 new tab"'),
  );
  await card('card.querySelector(".collection-update-prompt").click()');
  await wait(() =>
    app.evaluate('!!document.querySelector("dialog[open] .collection-update-list")'),
  );
  assert.equal(await app.evaluate('document.querySelectorAll(".collection-update-row").length'), 1);
  await footer('Cancel');
  await rpc('activate', { tabId: own.id });
  await app.send('Page.bringToFront');
  await fs.writeFile(
    path.join(out, 'collection-active-update.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  results.push(
    'Collection update: excludes pinned and other-window tabs, deduplicates new URLs, preserves notes/custom titles/groups, rejects stale library and tab previews, supports Cancel/selection/Undo without closing tabs',
  );
  results.push(
    'Pinned collections lead the library after reload; pinning and folding preserve the saved-content date; reviewed updates advance it; active collections show a working new-tab update shortcut',
  );
}
