import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function checkGroupCleanup({ app, rpc, out, results, delay, origin, processId }) {
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await app.evaluate(`chrome.windows.create({tabId:${own.id}})`);
  const windowId = (await app.evaluate('chrome.tabs.getCurrent()')).windowId;
  const make = (suffix) =>
    app.evaluate(
      `chrome.tabs.create({windowId:${windowId},url:${JSON.stringify(origin + '/cleanup-' + suffix)},active:false})`,
    );
  const tabs = await Promise.all([make('one'), make('two')]);
  const groupId = await app.evaluate(
    `chrome.tabs.group({tabIds:${JSON.stringify(tabs.map((t) => t.id))}})`,
  );
  const name = 'Neo cleanup verification';
  await app.evaluate(
    `chrome.tabGroups.update(${groupId},{title:${JSON.stringify(name)},color:'green'})`,
  );
  await delay(500);
  const capture = (name) => {
    if (!process.argv.includes('--native-icons')) return;
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        'scripts/capture-test-window.ps1',
        '-ProcessId',
        String(processId),
        '-OutputPath',
        path.join(out, name + '.png'),
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (r.status) throw Error(r.stderr || r.stdout);
  };
  await app.send('Page.bringToFront');
  capture('group-cleanup-before');
  const closedOne = await rpc('close', { tabIds: [tabs[0].id] });
  assert.deepEqual(closedOne.closed, [tabs[0].id]);
  assert.equal((await app.evaluate(`chrome.tabs.get(${tabs[1].id})`)).groupId, groupId);
  const closedTwo = await rpc('close', { tabIds: [tabs[1].id] });
  assert.deepEqual(closedTwo.closed, [tabs[1].id]);
  assert(!(await app.evaluate('chrome.tabGroups.query({})')).some((g) => g.id === groupId));
  capture('group-cleanup-after');
  await rpc('undo-action', { id: closedTwo.id, windowId });
  const restored = (await app.evaluate('chrome.tabGroups.query({})')).find((g) => g.title === name);
  assert(restored && restored.color === 'green', 'Undo did not restore name/colour');
  await rpc('import', {
    collections: [
      {
        name: 'Cleanup swap target',
        groups: [],
        links: [{ title: 'Destination', url: origin + '/cleanup-destination' }],
      },
    ],
  });
  const destination = (await rpc('load')).state.collections.find(
    (c) => c.name === 'Cleanup swap target',
  );
  const windowIds = (await app.evaluate('chrome.windows.getAll({})')).map((w) => w.id).sort();
  await rpc('switch', { destinationId: destination.id, windowId, saveCurrent: true });
  assert(!(await app.evaluate('chrome.tabGroups.query({})')).some((g) => g.id === restored.id));
  assert.deepEqual(
    (await app.evaluate('chrome.windows.getAll({})')).map((w) => w.id).sort(),
    windowIds,
  );
  results.push(
    'Group cleanup: partial close preserves members, full close/swap delete groups, Undo restores metadata',
  );
}
