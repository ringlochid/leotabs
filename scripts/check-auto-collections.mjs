import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkAutoCollections({
  app,
  rpc,
  out,
  results,
  delay,
  origin,
  extensionOrigin,
}) {
  const wait = async (fn, message) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error(message);
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await app.evaluate(`chrome.windows.create({tabId:${own.id}})`);
  const windowId = (await app.evaluate('chrome.tabs.getCurrent()')).windowId;
  const originalWindowIds = (await app.evaluate('chrome.windows.getAll({})'))
    .map((w) => w.id)
    .sort();
  await rpc('import', {
    collections: [
      {
        id: 'auto',
        name: 'Auto research',
        color: 'blue',
        groups: [{ id: 'g', name: 'Research', color: 'blue' }],
        links: [
          {
            id: 'one',
            title: 'One',
            url: origin + '/auto-one',
            groupId: 'g',
            note: 'Keep this note',
          },
          { id: 'two', title: 'Two', url: origin + '/auto-two', groupId: 'g' },
          { id: 'three', title: 'Three', url: origin + '/auto-three' },
        ],
      },
      {
        id: 'other',
        name: 'Auto other',
        color: 'rose',
        groups: [],
        links: [{ id: 'other-link', url: origin + '/auto-other', title: 'Other' }],
      },
    ],
  });
  const state = (await rpc('load')).state,
    A = state.collections.find((c) => c.name === 'Auto research'),
    B = state.collections.find((c) => c.name === 'Auto other');
  const get = async () => (await rpc('load')).state.collections.find((c) => c.id === A.id);
  await rpc('switch', { destinationId: A.id, windowId, saveCurrent: true });
  const live = async () =>
    (await rpc('load')).tabs.filter((t) => t.windowId === windowId && !t.pinned);
  assert.equal((await live()).length, 3);
  const pin = await app.evaluate(
    `chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin + '/auto-pin')},active:false,pinned:true})`,
  );
  const added = await app.evaluate(
    `chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin + '/auto-added')},title:undefined,active:false})`.replace(
      ',title:undefined',
      '',
    ),
  );
  await wait(async () => (await get()).links.length === 4, 'New tab was not automatically saved');
  assert.equal(
    (await get()).links.find((l) => l.url === origin + '/auto-one').note,
    'Keep this note',
  );
  await app.evaluate(
    `chrome.tabs.update(${added.id},{url:${JSON.stringify(origin + '/auto-navigated')}})`,
  );
  await wait(
    async () => (await get()).links.some((l) => l.url === origin + '/auto-navigated'),
    'Navigation did not update the saved URL',
  );
  await app.evaluate(`chrome.tabs.update(${added.id},{pinned:true})`);
  await wait(
    async () => (await get()).links.length === 3,
    'Pinned tab should leave the tracked collection',
  );
  await app.evaluate(`chrome.tabs.update(${added.id},{pinned:false})`);
  await wait(
    async () => (await get()).links.length === 4,
    'Unpinned tab should rejoin the tracked collection',
  );
  let tabs = await live();
  const group = tabs.find((t) => (t.resourceUrl || t.url) === origin + '/auto-one').groupId;
  await app.evaluate(`chrome.tabGroups.update(${group},{title:'Renamed research',color:'green'})`);
  await wait(
    async () =>
      (await get()).groups.some((g) => g.name === 'Renamed research' && g.color === 'green'),
    'Group edit was not automatically saved',
  );
  await app.evaluate(
    `chrome.tabs.remove(${JSON.stringify(tabs.filter((t) => t.id !== added.id).map((t) => t.id))})`,
  );
  await wait(async () => (await get()).links.length === 1, 'Closed tabs remain in the collection');
  assert.equal((await get()).links[0].url, origin + '/auto-navigated');
  await rpc('switch', { destinationId: B.id, windowId, saveCurrent: true });
  await rpc('switch', { destinationId: A.id, windowId, saveCurrent: true });
  assert.equal((await live()).length, 1, 'Switch must reopen the same one tab shown in the card');
  const versions = await rpc('collection-versions', { collectionId: A.id });
  const version = versions.find(
    (r) =>
      r.version &&
      r.snapshot.links.length === 4 &&
      r.snapshot.groups.some((g) => g.name === 'Renamed research'),
  );
  assert(version, 'Previous four-tab version missing');
  assert(versions.every((r) => r.collectionId === A.id));
  await app.send('Page.navigate', { url: extensionOrigin + '/app.html' });
  await app.send('Page.bringToFront');
  await wait(
    () =>
      app.evaluate(
        `!!document.querySelector('[data-collection-id="${A.id}"] button[aria-label="Options for Auto research"]')`,
      ),
    'Collection card missing',
  );
  await app.evaluate(
    `document.querySelector('[data-collection-id="${A.id}"] button[aria-label="Options for Auto research"]').click()`,
  );
  await app.evaluate(`document.querySelector('button[aria-label="Version history"]').click()`);
  await wait(
    () => app.evaluate('!!document.querySelector(".collection-versions")'),
    'Version history missing from collection menu',
  );
  await app.evaluate(`document.querySelector('[data-version-id="${version.id}"]').open=true`);
  await fs.writeFile(
    path.join(out, 'collection-versions.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await app.evaluate(`document.querySelector('[data-version-id="${version.id}"] button').click()`);
  await wait(
    async () => (await get()).links.length === 4 && (await live()).length === 4,
    'Version restore did not update both saved and live tabs',
  );
  assert.equal(
    (await get()).links.find((l) => l.url === origin + '/auto-one').note,
    'Keep this note',
  );
  const current = await live();
  await app.evaluate(`chrome.tabs.remove(${JSON.stringify(current.map((t) => t.id))})`);
  await wait(
    async () => (await get()).links.length === 0,
    'Closing last tab must save an empty collection',
  );
  await rpc('switch', { destinationId: B.id, windowId, saveCurrent: true });
  await rpc('switch', { destinationId: A.id, windowId, saveCurrent: true });
  assert.equal((await live()).length, 0, 'Empty collection must not resurrect an old timeline');
  assert((await app.evaluate(`chrome.tabs.get(${pin.id})`)).pinned);
  assert(
    (await rpc('collection-versions', { collectionId: A.id })).some(
      (r) => r.snapshot.links.length === 4,
    ),
  );
  assert.deepEqual(
    (await app.evaluate('chrome.windows.getAll({})')).map((w) => w.id).sort(),
    originalWindowIds,
    'Swapping/restoring must not create any browser windows',
  );
  results.push(
    'Active collections autosave additions, closures, empty states and native group changes; switching matches card contents; collection menu restores a scoped previous version with notes and pinned tabs preserved, without creating any browser windows',
  );
}
