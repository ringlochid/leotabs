import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkCloseCollection({
  app,
  rpc,
  out,
  results,
  delay,
  origin,
  extensionOrigin,
}) {
  const wait = async (fn, message) => {
    for (let n = 0; n < 100; n++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error(message);
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await app.evaluate(`chrome.windows.create({tabId:${own.id}})`);
  const windowId = (await app.evaluate('chrome.tabs.getCurrent()')).windowId;
  await app.send('Page.navigate', { url: extensionOrigin + '/app.html' });
  await delay(500);
  await rpc('import', {
    collections: [
      {
        name: 'Close test previous',
        groups: [],
        links: [{ url: origin + '/close-previous', title: 'Previous' }],
      },
      {
        name: 'Close test current',
        groups: [{ id: 'g', name: 'Closing group', color: 'green' }],
        links: [
          { url: origin + '/close-one', title: 'One', groupId: 'g', note: 'Preserved note' },
          { url: origin + '/close-two', title: 'Two', groupId: 'g' },
        ],
      },
    ],
  });
  const state = (await rpc('load')).state;
  const previous = state.collections.find((c) => c.name === 'Close test previous');
  const current = state.collections.find((c) => c.name === 'Close test current');
  await rpc('switch', { destinationId: previous.id, windowId });
  const pin = await app.evaluate(
    `chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin + '/close-pin')},active:false,pinned:true})`,
  );
  const windows = (await app.evaluate('chrome.windows.getAll({})')).map((w) => w.id).sort();
  const button = `[data-collection-id="${current.id}"] .collection-switch`;
  await wait(
    () =>
      app.evaluate(
        `document.querySelector(${JSON.stringify(button)})?.textContent.includes('Swap to')`,
      ),
    'Swap button missing',
  );
  await app.evaluate(`document.querySelector(${JSON.stringify(button)}).click()`);
  await wait(
    () =>
      app.evaluate(
        `document.querySelector(${JSON.stringify(button)})?.textContent.includes('Close current collection')`,
      ),
    'Current button did not become Close',
  );
  const added = await app.evaluate(
    `chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin + '/close-added')},active:false})`,
  );
  await delay(200);
  await app.send('Page.bringToFront');
  await app.evaluate(
    `document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center'})`,
  );
  await fs.writeFile(
    path.join(out, 'close-current-collection.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await app.evaluate(`document.querySelector(${JSON.stringify(button)}).click()`);
  await wait(
    async () => !(await rpc('load')).sessionState.active[windowId],
    'Collection remained active',
  );
  await delay(2100); // The real closure-triggered checkpoint must not erase saved contents.
  const loaded = await rpc('load');
  const saved = loaded.state.collections.find((c) => c.id === current.id);
  assert.equal(saved.links.length, 3);
  assert.equal(saved.links.find((l) => l.url === origin + '/close-one').note, 'Preserved note');
  assert.equal(saved.groups[0].name, 'Closing group');
  assert.deepEqual(
    (await app.evaluate(`chrome.tabs.query({windowId:${windowId}})`)).map((t) => t.id).sort(),
    [own.id, pin.id].sort(),
  );
  assert.equal((await app.evaluate(`chrome.tabGroups.query({windowId:${windowId}})`)).length, 0);
  assert.deepEqual(
    (await app.evaluate('chrome.windows.getAll({})')).map((w) => w.id).sort(),
    windows,
  );
  assert(
    await app.evaluate(
      `document.querySelector(${JSON.stringify(button)}).textContent.includes('Swap to')`,
    ),
  );
  assert(
    loaded.timeline.some(
      (v) =>
        v.collectionId === current.id &&
        v.reason === 'Closed collection' &&
        v.snapshot.links.length === 3,
    ),
  );
  await app.evaluate(`document.querySelector(${JSON.stringify(button)}).click()`);
  await wait(
    async () =>
      (await rpc('load')).tabs.filter((t) => t.windowId === windowId && !t.pinned).length === 3,
    'Saved collection did not reopen intact',
  );
  await wait(
    () =>
      app.evaluate(
        `document.querySelector(${JSON.stringify(button)})?.textContent.includes('Close current collection')`,
      ),
    'Reopen did not finish activating the collection',
  );
  await app.evaluate(
    `document.querySelector('[data-collection-id="${current.id}"] [aria-label="Options for Close test current"]').click()`,
  );
  assert(
    await app.evaluate(
      `!!document.querySelector('.action-menu button[aria-label="Close current collection"]')`,
    ),
  );
  results.push(
    'Close current collection: real Swap/Close button, saves latest tabs/groups/notes, clears tracking, preserves pins, no previous tabs or new windows; saved collection reopens intact',
  );
}
