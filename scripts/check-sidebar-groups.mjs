import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkSidebarGroups({ app, rpc, out, results, delay, origin }) {
  const wait = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Sidebar groups did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  const win = await app.evaluate(`chrome.windows.create({tabId:${own.id}})`);
  const tabs = [];
  for (const name of ['outside-before', 'research-a', 'research-b', 'outside-after', 'reading-a'])
    tabs.push(
      await app.evaluate(
        `chrome.tabs.create({windowId:${win.id},active:false,url:${JSON.stringify(origin + '/' + name)}})`,
      ),
    );
  const makeGroup = (ids, title, color) =>
    app.evaluate(
      `chrome.tabs.group({tabIds:${JSON.stringify(ids)}}).then(async id=>{await chrome.tabGroups.update(id,${JSON.stringify({ title, color })});return id})`,
    );
  const group = await makeGroup([tabs[1].id, tabs[2].id], 'Research', 'blue');
  const second = await makeGroup([tabs[4].id], 'Reading', 'green');
  await rpc('edit', { kind: 'create', name: 'Group drop destination' });
  const destination = (await rpc('load')).state.collections.find(
    (c) => c.name === 'Group drop destination',
  );
  await rpc('settings', { settings: { tabSort: 'position', theme: 'light' } });
  await app.send('Page.reload');
  await wait(() => app.evaluate('document.querySelectorAll("#tabs .open-tab-group").length===2'));
  await rpc('activate', { tabId: own.id });
  await app.send('Page.bringToFront');
  const selector = `#tabs .open-tab-group[data-group-id="${group}"]`;
  const read = (code) =>
    app.evaluate(
      `(()=>{const group=document.querySelector(${JSON.stringify(selector)});${code}})()`,
    );
  assert.deepEqual(
    await read('return [...group.querySelectorAll(".tab-row")].map(n=>+n.dataset.tabId)'),
    [tabs[1].id, tabs[2].id],
  );
  assert.deepEqual(
    await app.evaluate(
      '[...document.querySelectorAll("#tabs > .tab-row")].map(n=>+n.dataset.tabId)',
    ),
    [tabs[0].id, tabs[3].id],
  );
  const shot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  await shot('sidebar-groups-light');
  await read('group.querySelector(".open-group-fold").click()');
  assert(
    await read(
      'return group.querySelector(".open-group-fold").getAttribute("aria-expanded")==="false" && group.querySelectorAll(".tab-row").length===0',
    ),
  );
  assert.equal(await app.evaluate('document.querySelectorAll("#tabs > .tab-row").length'), 2);
  await app.send('Page.reload');
  await wait(() => read('return !!group'));
  assert(
    await read(
      'return group.querySelector(".open-group-fold").getAttribute("aria-expanded")==="false"',
    ),
  );
  const query = async (value) => {
    await app.evaluate(
      `(()=>{const input=document.querySelector('#tab-search');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input'));})()`,
    );
    await delay(150);
  };
  await query('research-a');
  assert(await read('return group.querySelectorAll(".tab-row").length===1'));
  await query('');
  assert(await read('return group.querySelectorAll(".tab-row").length===0'));
  // Drag the folded header: payload and ghost must include every member, no outsiders.
  const payload = await read(
    `const transfer=new DataTransfer();group.querySelector('.open-group-header').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));window.groupTransfer=transfer;return JSON.parse(transfer.getData('application/x-neo'));`,
  );
  assert.deepEqual(payload.ids, [tabs[1].id, tabs[2].id]);
  assert.equal(
    await app.evaluate(
      'document.querySelectorAll(".native-group-drag-image .native-drag-row").length',
    ),
    2,
  );
  await app.evaluate(
    `document.querySelector('[data-collection-id="${destination.id}"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:window.groupTransfer}));`,
  );
  await wait(
    async () =>
      (await rpc('load')).state.collections.find((c) => c.id === destination.id).links.length === 2,
  );
  const saved = (await rpc('load')).state.collections.find((c) => c.id === destination.id);
  assert.equal(saved.groups.length, 1);
  assert.equal(saved.groups[0].name, 'Research');
  assert.equal(saved.groups[0].color, 'blue');
  assert(saved.links.every((l) => l.groupId === saved.groups[0].id));
  assert.equal((await app.evaluate(`chrome.tabs.query({windowId:${win.id}})`)).length, 6);
  await app.evaluate('document.querySelector("#library-select-mode").click()');
  await read('const check=group.querySelector("input[type=checkbox]");check.focus();check.click()');
  assert(
    await read('return document.activeElement===group.querySelector(".open-group-header input")'),
  );
  assert(
    await app.evaluate('document.querySelector("#selection strong").textContent==="2 selected"'),
  );
  await read('group.querySelector(".open-group-fold").click()');
  await read('group.querySelector(".tab-select").click()');
  assert(await read('return group.querySelector(".open-group-header input").indeterminate'));
  await rpc('settings', { settings: { theme: 'dark', tabSort: 'recent' } });
  await delay(350);
  assert.equal(await app.evaluate('document.querySelectorAll("#tabs .open-tab-group").length'), 2);
  await shot('sidebar-groups-dark');
  results.push(
    'Sidebar groups have bounded colour blocks, independent persistent folding, temporary search expansion, whole/partial selection and full folded-header drag payloads; collection drop preserves native group and leaves browser tabs open',
  );
}
