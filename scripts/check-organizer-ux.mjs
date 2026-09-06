// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkOrganizerUX({ app, rpc, out, results, delay, origin }) {
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await app.evaluate(expression)) return;
      await delay(100);
    }
    throw Error('Organizer did not settle: ' + expression);
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  // Small isolated space keeps real drag targets on the same screen.
  await rpc('edit', { kind: 'create-space', name: 'UX verification' });
  const space = (await rpc('load')).state.spaces.find((s) => s.name === 'UX verification');
  await app.evaluate(`localStorage.setItem('neo-space',${JSON.stringify(space.id)})`);
  for (const name of ['Source', 'Destination'])
    await rpc('edit', { kind: 'create', name, spaceId: space.id });
  await app.send('Page.reload');
  await waitFor(`document.querySelectorAll('.collection').length===2`);
  let state = (await rpc('load')).state;
  const source = state.collections.find((c) => c.name === 'Source'),
    dest = state.collections.find((c) => c.name === 'Destination');
  const tabs = await app.evaluate(
    `Promise.all(['drag-one','drag-two'].map(p=>chrome.tabs.create({url:${JSON.stringify(origin)}+'/'+p,active:false})))`,
  );
  await waitFor(
    `chrome.tabs.query({}).then(t=>${JSON.stringify(tabs.map((t) => t.id))}.every(id=>t.some(x=>x.id===id&&x.status==='complete')))`,
  );
  const native = await rpc('group-tabs', { tabIds: tabs.map((t) => t.id), name: 'Drag together' });
  await waitFor(`!!document.querySelector('.group-label[data-group-id="${native.groupId}"]')`);
  async function drag(from, to, type) {
    const point = (selector) =>
      app.evaluate(
        `(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      );
    const end = await point(to),
      start = await point(from);
    let payload;
    const listener = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Input.dragIntercepted') payload = m.params.data;
    };
    app.ws.addEventListener('message', listener);
    try {
      await app.send('Input.setInterceptDrags', { enabled: true });
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
      await app.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...start,
        button: 'left',
        clickCount: 1,
      });
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + 24,
        y: start.y + 16,
        button: 'left',
        buttons: 1,
      });
      for (let i = 0; i < 50 && !payload; i++) await delay(30);
      const item = payload?.items.find((i) => i.mimeType === 'application/x-neo');
      assert(item, 'Native pointer drag must carry Neo data');
      assert.equal(JSON.parse(item.data).type, type);
      for (const type of ['dragEnter', 'dragOver', 'drop'])
        await app.send('Input.dispatchDragEvent', { type, ...end, data: payload });
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...end,
        button: 'left',
        clickCount: 1,
      });
    } finally {
      app.ws.removeEventListener('message', listener);
      await app.send('Input.setInterceptDrags', { enabled: false });
    }
  }
  const card = (id) => `[data-collection-id="${id}"]`;
  await drag(
    `.group-label[data-group-id="${native.groupId}"]`,
    card(source.id) + ' .collection-head',
    'tabs',
  );
  await waitFor(
    `${JSON.stringify(tabs.map((t) => t.id))}.every(id=>!!document.querySelector('[data-tab-id="'+id+'"]')) && document.querySelectorAll('${card(source.id)} .saved-row').length===2`,
  );
  state = (await rpc('load')).state;
  const saved = state.collections.find((c) => c.id === source.id),
    group = saved.groups.find((g) => g.name === 'Drag together');
  assert(group && saved.links.every((l) => l.groupId === group.id));
  await drag(`${card(source.id)} .group-header`, card(dest.id) + ' .collection-head', 'group');
  await waitFor(
    `document.querySelectorAll('${card(dest.id)} .saved-row').length===2 && !document.querySelector('${card(source.id)} .saved-group')`,
  );
  let moved = (await rpc('load')).state.collections.find((c) => c.id === dest.id);
  assert.equal(moved.groups[0].id, group.id);
  assert.deepEqual(moved.links.map((l) => l.id).sort(), saved.links.map((l) => l.id).sort());
  results.push(
    'Real pointer drags save an entire native group and move a saved group with member identities preserved',
  );
  await rpc('edit', { kind: 'create-group', collectionId: dest.id, name: 'Intentionally empty' });
  for (const link of moved.links) {
    await waitFor(`!!document.querySelector('[data-link-id="${link.id}"]')`);
    await drag(
      `[data-link-id="${link.id}"] .link-open`,
      card(source.id) + ' .collection-head',
      'link',
    );
    await waitFor(`!!document.querySelector('${card(source.id)} [data-link-id="${link.id}"]')`);
  }
  moved = (await rpc('load')).state.collections.find((c) => c.id === dest.id);
  assert(!moved.groups.some((g) => g.id === group.id));
  assert(moved.groups.some((g) => g.name === 'Intentionally empty'));
  results.push(
    'Moving the final link removes the emptied source group while preserving intentionally empty groups',
  );
  const link = saved.links[0],
    note = 'Read the full summary.\nKeep the group context for tomorrow.';
  await rpc('edit', { kind: 'link', collectionId: source.id, linkId: link.id, note });
  const noteSelector = `[data-link-id="${link.id}"] .note-button`;
  await waitFor(`!!document.querySelector('${noteSelector}')`);
  const bounds = await app.evaluate(
    `(()=>{const n=document.querySelector('${noteSelector}');n.scrollIntoView();const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...bounds });
  await waitFor(`document.querySelector('.note-content')?.textContent===${JSON.stringify(note)}`);
  const popup = await app.evaluate(
    `(()=>{const r=document.querySelector('.note-preview').getBoundingClientRect();return{x:r.x+20,y:r.y+60}})()`,
  );
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...popup });
  await delay(300);
  assert(await app.evaluate(`document.querySelector('.note-preview')?.matches(':popover-open')`));
  await app.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  await waitFor(`!document.querySelector('.note-preview')`);
  await app.evaluate(`document.querySelector('${noteSelector}').focus()`);
  await waitFor(`!!document.querySelector('.note-preview')`);
  await app.evaluate(`document.querySelector('${noteSelector}').click()`);
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20 });
  await app.evaluate(`document.querySelector('#tab-search').focus()`);
  await delay(300);
  assert(await app.evaluate(`document.querySelector('.note-preview')?.matches(':popover-open')`));
  await fs.writeFile(
    path.join(out, 'note-preview.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await app.evaluate(`document.querySelector('[aria-label="Close note"]').click()`);
  results.push(
    'Notes open on real hover and focus, remain hoverable, pin on click, and dismiss with Escape or Close',
  );
  const before = await app.evaluate('chrome.tabs.query({})');
  await app.evaluate(`document.querySelector('[data-link-id="${link.id}"] .link-open').click()`);
  await waitFor(`chrome.tabs.query({}).then(t=>t.length===${before.length + 1})`);
  const after = await app.evaluate('chrome.tabs.query({})');
  assert(
    after.some(
      (t) =>
        !before.some((b) => b.id === t.id) && (t.url === link.url || t.pendingUrl === link.url),
    ),
  );
  assert(tabs.every((t) => after.some((a) => a.id === t.id)));
  await rpc('activate', { tabId: own.id });
  // The shared @ search route must also open another tab with an existing match.
  await app.evaluate(`location.hash='#search'`);
  await waitFor(`!!document.querySelector('.search-dialog input')`);
  await app.evaluate(
    `const i=document.querySelector('.search-dialog input');i.value='@Source ';i.dispatchEvent(new Event('input'));`,
  );
  await waitFor(`document.querySelectorAll('.search-dialog [role=option]').length===1`);
  await app.evaluate(`document.querySelector('.search-dialog [role=option]').click()`);
  await waitFor(`document.querySelectorAll('.search-dialog [role=option]').length===2`);
  assert(
    await app.evaluate(
      `document.querySelector('.search-dialog [role=option]').textContent.includes('Open new tab')`,
    ),
  );
  await app.evaluate(`document.querySelector('.search-dialog [role=option]').click()`);
  await waitFor(`chrome.tabs.query({}).then(t=>t.length===${after.length + 1})`);
  results.push(
    'Clicking a saved link and opening a scoped search result each creates a fresh browser tab despite existing URL matches',
  );
}
