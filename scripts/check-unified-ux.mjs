// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkUnifiedUX({
  app,
  rpc,
  out,
  results,
  delay,
  origin,
  targets,
  connect,
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
  const card = (id) => `[data-collection-id="${id}"]`;
  const click = (selector, label) =>
    app.evaluate(
      `(() => { const root = document.querySelector(${JSON.stringify(selector)}); const b=[...root.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)} || b.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable: '+${JSON.stringify(label)});b.click(); })()`,
    );
  const shot = async (name, client = app) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await client.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  const id = 'unified-collection',
    other = 'unified-destination';
  await rpc('import', {
    collections: [
      {
        id,
        name: 'Unified selection',
        color: 'mint',
        groups: [{ id: 'g', name: 'Saved group', color: 'blue', collapsed: false }],
        links: [
          {
            id: 'a',
            title: 'First saved page',
            url: origin + '/unified-a',
            groupId: 'g',
            note: 'Preserve note',
          },
          { id: 'b', title: 'Second saved page', url: origin + '/unified-b', groupId: 'g' },
          { id: 'c', title: 'Third saved page', url: origin + '/unified-c', groupId: null },
        ],
      },
      { id: other, name: 'Selection destination', color: 'blue', groups: [], links: [] },
    ],
  });
  // Imports generate IDs; find the actual stable identities.
  let state = (await rpc('load')).state;
  let c = state.collections.find((c) => c.name === 'Unified selection');
  const dest = state.collections.find((c) => c.name === 'Selection destination');
  await wait(
    () => app.evaluate(`!!document.querySelector('${card(c.id)} .collection-select')`),
    'Collection not rendered',
  );
  await app.evaluate(`document.querySelector('${card(c.id)} .collection-select').click()`);
  assert(
    await app.evaluate(
      `document.querySelector('${card(c.id)} .saved-selection button[aria-label=Group]').disabled`,
    ),
  );
  await app.evaluate(
    `document.querySelector('${card(c.id)} .group-header input[type=checkbox]').click()`,
  );
  await click(card(c.id) + ' .saved-selection', 'Ungroup');
  await wait(
    async () =>
      !(await rpc('load')).state.collections
        .find((x) => x.id === c.id)
        .links.some((l) => l.groupId),
    'Saved ungroup failed',
  );
  await click(card(c.id) + ' .saved-selection', 'Group');
  await wait(
    () => app.evaluate(`!!document.querySelector('${card(c.id)} .inline-name')`),
    'Inline group editor missing',
  );
  // Blur the inline editor without a modal.
  await app.evaluate(`document.activeElement.blur()`);
  await delay(150);
  c = (await rpc('load')).state.collections.find((x) => x.id === c.id);
  assert.equal(c.groups.length, 1);
  assert.equal(c.links.filter((l) => l.groupId).length, 2);
  await app.evaluate(`document.querySelector('${card(c.id)}').scrollIntoView({block:'center'})`);
  await shot('collection-selection');
  await click(card(c.id) + ' .saved-selection', 'Move to…');
  await click('#action-popover', dest.name);
  await wait(
    async () =>
      (await rpc('load')).state.collections.find((x) => x.id === dest.id).links.length === 2,
    'Move selection failed',
  );
  let updated = (await rpc('load')).state;
  assert.equal(updated.collections.find((x) => x.id === c.id).groups.length, 0);
  assert.equal(
    updated.collections
      .find((x) => x.id === dest.id)
      .links.find((l) => l.title === 'First saved page').note,
    'Preserve note',
  );
  await app.evaluate(`document.querySelector('${card(c.id)} .collection-select').click()`);
  await app.evaluate(`document.querySelector('${card(dest.id)} .collection-select').click()`);
  await click(card(dest.id) + ' .saved-selection', 'Select all');
  await click(card(dest.id) + ' .saved-selection', 'Remove');
  await wait(
    async () =>
      (await rpc('load')).state.collections.find((x) => x.id === dest.id).links.length === 0,
    'Bulk remove failed',
  );
  await wait(
    () => app.evaluate(`!!document.querySelector('#toast button[aria-label="Undo"]')`),
    'Remove undo unavailable',
  );
  await click('#toast', 'Undo');
  await wait(
    async () =>
      (await rpc('load')).state.collections.find((x) => x.id === dest.id).links.length === 2,
    'Bulk remove Undo failed',
  );
  await app.evaluate(`document.querySelector('${card(dest.id)} .collection-select').click()`);
  results.push(
    'Collection Select groups/ungroups inline, moves members together, retains notes and prunes the source group',
  );

  // One menu click starts opening: no chooser or progress modal.
  const openFromMenu = async (target) => {
    await rpc('activate', { tabId: own.id });
    const jobs = new Set((await rpc('load')).journal.map((j) => j.id));
    await app.evaluate(
      `document.querySelector('${card(dest.id)} button[aria-label="Options for ${dest.name}"]').click()`,
    );
    assert(await app.evaluate('!!document.querySelector("#action-popover[role=menu]")'));
    assert.equal(await app.evaluate('!!document.querySelector("dialog[open]")'), false);
    await click('#action-popover', target === 'new' ? 'Open in new window' : 'Open all');
    await wait(
      async () =>
        (await rpc('load')).journal.some(
          (j) => !jobs.has(j.id) && j.kind === 'resume' && j.status === 'complete',
        ),
      'Direct opening did not complete',
    );
    assert.equal(await app.evaluate('!!document.querySelector("dialog[open]")'), false);
    await delay(150);
  };
  const initialTabs = await app.evaluate(`chrome.tabs.query({windowId:${own.windowId}})`);
  await openFromMenu('current');
  let tabs = await app.evaluate(`chrome.tabs.query({windowId:${own.windowId}})`);
  const created = tabs.filter((t) => !initialTabs.some((x) => x.id === t.id));
  assert.equal(created.length, 2);
  assert(created.every((t) => (t.url || t.pendingUrl).startsWith(origin + '/unified-')));
  assert(created.every((t) => t.groupId === created[0].groupId && t.groupId >= 0));
  const beforeAgain = tabs.length;
  await openFromMenu('current');
  assert.equal(
    (await app.evaluate(`chrome.tabs.query({windowId:${own.windowId}})`)).length,
    beforeAgain + 2,
    'Opening again creates fresh instances',
  );
  const oldWindows = await app.evaluate('chrome.windows.getAll()');
  await openFromMenu('new');
  const newWindow = (await app.evaluate('chrome.windows.getAll({populate:true})')).find(
    (w) => !oldWindows.some((x) => x.id === w.id),
  );
  if (!newWindow)
    console.log(
      'New-window diagnostics',
      JSON.stringify({
        oldWindows,
        windows: await app.evaluate('chrome.windows.getAll({populate:true})'),
        jobs: (await rpc('load')).journal.filter((j) => j.kind === 'resume'),
      }),
    );
  assert(newWindow && newWindow.type === 'normal');
  assert.equal(newWindow.tabs.length, 2, 'No blank guard tab remains');
  assert(newWindow.tabs.every((t) => t.groupId >= 0 && t.groupId === newWindow.tabs[0].groupId));
  assert.equal((await rpc('load')).state.collections.find((x) => x.id === dest.id).links.length, 2);
  await app.evaluate(`chrome.windows.remove(${newWindow.id})`);
  results.push(
    'Real Open UI completes without the close-before-initialization error; current/new windows preserve groups, fresh tabs and saved links',
  );

  // Both surfaces render the same save choices and defaults.
  await rpc('activate', { tabId: own.id });
  await app.evaluate(`document.querySelector('#stash-button').click()`);
  const libraryForm = await app.evaluate(
    `(()=>{const p=document.querySelector('#action-popover');return { labels:[...p.querySelectorAll('label')].map(n=>n.textContent), options:[...p.querySelectorAll('option')].map(n=>n.textContent), close:p.querySelector('input[type=checkbox]').checked, font:getComputedStyle(p).fontFamily };})()`,
  );
  assert.equal(libraryForm.options.length, 0, 'Stash has no destination chooser');
  assert(libraryForm.labels.includes('and close them'));
  await shot('library-save');
  await app.evaluate(`document.querySelector('#action-popover').hidePopover()`);
  const pin = (await rpc('load')).tabs.find((t) => t.pinned);
  await rpc('activate', { tabId: pin.id });
  const openOverlay = (mode) =>
    app.evaluate(
      `import(chrome.runtime.getURL('lib/overlay.js')).then(m=>m.openSwitcher(${JSON.stringify(pin)},${JSON.stringify({ mode })}))`,
    );
  const read = (code) =>
    app.evaluate(
      `chrome.scripting.executeScript({target:{tabId:${pin.id}},func:()=>{const root=globalThis.__neoSurface;${code}}}).then(r=>r[0].result)`,
    );
  await openOverlay('switcher');
  await wait(() => read('return !!root?.querySelector(".tab-tools")'), 'Overlay tools missing');
  await read(`root.querySelector('.tab-tools button[aria-label="Save tabs"]').click()`);
  const overlayForm = await read(
    `const p=root.querySelector('#action-popover');return {labels:[...p.querySelectorAll('label')].map(n=>n.textContent),options:[...p.querySelectorAll('option')].map(n=>n.textContent),close:p.querySelector('input[type=checkbox]').checked,font:getComputedStyle(p).fontFamily};`,
  );
  assert.deepEqual(overlayForm, libraryForm, 'Save UX and typography match');
  const native = await connect(
    (await targets()).find((t) => t.url === pin.url).webSocketDebuggerUrl,
  );
  await shot('overlay-save', native);
  await read(
    `root.querySelector('#action-popover').hidePopover();root.querySelector('.tab-tools button[aria-label="Sort tabs"]').click()`,
  );
  await read(
    `[...root.querySelectorAll('#action-popover button')].find(b=>b.textContent==='Reverse tab order').click()`,
  );
  await wait(
    async () => (await rpc('load')).state.settings.tabSort === 'reverse',
    'Overlay sort did not persist',
  );
  const countBeforeDuplicate = await read(
    'return Number(root.querySelector(".dedup-button .count-badge")?.textContent || 0)',
  );
  await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(pin.url)},windowId:${own.windowId},active:false})`,
  );
  await wait(
    () =>
      read(
        `return Number(root.querySelector(".dedup-button .count-badge")?.textContent || 0) > ${countBeforeDuplicate}`,
      ),
    'Duplicate badge missing',
  );
  await read('root.querySelector(".dedup-button").click()');
  await wait(
    async () =>
      (await app.evaluate(`chrome.tabs.query({url:${JSON.stringify(pin.url)}})`)).length === 1,
    'Duplicate tab stayed open',
  );
  assert(
    (await app.evaluate(`chrome.tabs.get(${pin.id})`)).pinned,
    'Pinned original survives duplicate removal',
  );
  await read('globalThis.__neoCloseOverlay()');
  await openOverlay('search');
  await wait(
    () => read('return !!root?.querySelector(".search-only")'),
    'Search-only mode missing',
  );
  assert.equal(await read('return root.querySelectorAll(".preview-image").length'), 0);
  assert(await read('return root.querySelector(".collection-dock").hidden'));
  await read(
    `const s=root.querySelector('#quick-search');s.value='/open';s.dispatchEvent(new Event('input'));`,
  );
  assert(
    await read(
      'return root.querySelector("#quick-results").textContent.includes("Open collection")',
    ),
  );
  await shot('search-only', native);
  await read(
    `const s=root.querySelector('#quick-search');s.value='@Selection destination';s.dispatchEvent(new Event('input'));s.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`,
  );
  const beforeSearchOpen = (await app.evaluate(`chrome.tabs.query({windowId:${own.windowId}})`))
    .length;
  await read(
    `root.querySelector('#quick-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`,
  );
  await wait(
    async () =>
      (await app.evaluate(`chrome.tabs.query({windowId:${own.windowId}})`)).length ===
      beforeSearchOpen + 1,
    'Search-only Enter did not open saved link in a fresh tab',
  );
  await rpc('settings', { settings: { tabSort: 'recent' } });
  results.push(
    'Overlay and library share Save form, default, font and sort setting; search-only has commands without thumbnails or collection dock',
  );
  const mismatch = await app.evaluate(
    `chrome.runtime.sendMessage({action:'ungroup-tabs',protocol:999,data:{tabIds:[]}})`,
  );
  assert.match(mismatch.error, /Reload Neo/);
  results.push(
    'Old UI/worker protocol mismatch returns an actionable reload message before an operation runs',
  );
}
