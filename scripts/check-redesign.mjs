// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkRedesign({ app, rpc, out, results, delay, origin, windowId }) {
  const waitFor = async expression => {
    for (let i=0;i<100;i++) { if (await app.evaluate(expression)) return; await delay(100); }
    throw new Error('UI did not settle: ' + expression);
  };
  await app.send('Page.reload');
  await waitFor('!!document.querySelector("#spaces .active")');
  const screenshot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  const click = (selector) =>
    app.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const name = async (value) => {
    await waitFor('document.activeElement.matches(".inline-name")');
    assert.equal(
      await app.evaluate('!!document.querySelector("dialog[open]")'),
      false,
      'No naming modal',
    );
    assert(
      await app.evaluate('document.activeElement.matches(".inline-name")'),
      'Inline title receives focus',
    );
    await app.evaluate(`document.activeElement.value=${JSON.stringify(value)}`);
    await app.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
    });
    await app.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await waitFor(`!document.querySelector('.inline-name') && [...document.querySelectorAll('.editable-name')].some(n=>n.textContent===${JSON.stringify(value)})`);
  };
  await click('.add-collection');
  await delay(220);
  await screenshot('inline-collection');
  await name('Writing');
  let state = (await rpc('load')).state;
  const writing = state.collections.find((c) => c.name === 'Writing');
  assert(writing);
  await app.evaluate(
    `[...document.querySelectorAll('[data-collection-id="${writing.id}"] button')].find(b=>b.textContent==='Add group').click()`,
  );
  await delay(220);
  await name('Drafts');
  assert.equal(
    (await rpc('load')).state.collections.find((c) => c.id === writing.id).groups[0].name,
    'Drafts',
  );
  results.push(
    'Collection and saved group are created immediately, focused inline, and named with Enter without dialogs',
  );
  await click('[aria-label="Add space"]');
  await delay(220);
  await name('Study');
  state = (await rpc('load')).state;
  const study = state.spaces.find((s) => s.name === 'Study');
  assert(study);
  assert.equal(await app.evaluate('document.querySelectorAll(".collection").length'), 0);
  await click('.add-collection');
  await delay(220);
  await name('Coursework');
  const course = (await rpc('load')).state.collections.find((c) => c.name === 'Coursework');
  assert.equal(course.spaceId, study.id);
  await app.send('Page.reload');
  await waitFor('!!document.querySelector("#spaces .active")');
  assert.equal(await app.evaluate('document.querySelectorAll(".collection").length'), 1);
  assert(
    await app.evaluate('document.querySelector(".collection-name").textContent === "Coursework"'),
  );
  await app.evaluate(
    `[...document.querySelectorAll('#spaces button')].find(b=>b.textContent==='My space').click()`,
  );
  assert(await app.evaluate('document.querySelectorAll(".collection").length>1'));
  results.push(
    'Spaces isolate collections, remember the selected space on reload, and preserve existing library content',
  );
  await rpc('edit', { kind: 'collection', collectionId: writing.id, spaceId: study.id });
  await waitFor(`!document.querySelector('[data-collection-id="${writing.id}"]')`);
  assert.equal(
    await app.evaluate(`!!document.querySelector('[data-collection-id="${writing.id}"]')`),
    false,
  );
  await rpc('edit', { kind: 'collection', collectionId: writing.id, spaceId: 'main' });
  const cap = (await rpc('load')).state.collections.find((c) => c.name === 'Capstone');
  const remove = `[data-collection-id="${cap.id}"] .remove-link`;
  await delay(200);
  await click(remove);
  await waitFor(`document.querySelector('[data-collection-id="${cap.id}"] .collection-head > small')?.textContent==='2'`);
  assert.equal((await rpc('load')).state.collections.find((c) => c.id === cap.id).links.length, 2);
  await app.evaluate(
    `[...document.querySelectorAll('#toast button')].find(b=>b.textContent==='Undo').click()`,
  );
  await waitFor(`document.querySelector('[data-collection-id="${cap.id}"] .collection-head > small')?.textContent==='3'`);
  assert.equal((await rpc('load')).state.collections.find((c) => c.id === cap.id).links.length, 3);
  results.push('Direct saved-link removal and Undo restore exactly the removed link');
  const a = await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/dedup')},active:false})`,
  );
  const b = await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/dedup')},active:false})`,
  );
  await waitFor(`chrome.tabs.query({}).then(t=>[${a.id},${b.id}].every(id=>t.some(x=>x.id===id&&x.status==='complete'&&!x.pendingUrl)))`);
  await waitFor('document.querySelector("#dedup .count-badge")?.textContent === "1"');
  assert.equal(
    await app.evaluate('document.querySelector("#dedup .count-badge").textContent'),
    '1',
  );
  await click('#dedup');
  await waitFor('document.querySelector("#dedup").disabled');
  assert.equal((await rpc('load')).tabs.filter((t) => t.url === origin + '/dedup').length, 1);
  assert.equal(await app.evaluate('document.querySelector("#dedup").textContent'), '');
  results.push('Broom badge shows one redundant tab and one click closes only that duplicate');
  // Select stable IDs afresh after each live redraw.
  const live = (await rpc('load')).tabs
    .filter((t) => t.windowId === windowId && !t.pinned)
    .slice(0, 2);
  await app.evaluate(`document.querySelector('#selection button[aria-label="Clear"]')?.click()`);
  for (const t of live) await click(`[data-tab-id="${t.id}"] .tab-select`);
  await app.evaluate(
    `[...document.querySelectorAll('#selection button')].find(b=>b.textContent==='Group').click()`,
  );
  await delay(300);
  await name('Browser group');
  assert((await rpc('load')).groups.some((g) => g.title === 'Browser group'));
  results.push('Native tab grouping creates immediately and renames inline in the sidebar');
  await app.evaluate(`document.querySelector('#selection button[aria-label="Clear"]')?.click()`);
  await click('#save-current');
  await delay(100);
  assert(await app.evaluate('document.querySelector("#action-popover").matches(":popover-open")'));
  await app.evaluate(
    `document.querySelector('#action-popover select').value=${JSON.stringify(writing.id)};[...document.querySelectorAll('#action-popover button')].find(b=>b.textContent==='Save tabs').click()`,
  );
  await waitFor(`Number(document.querySelector('[data-collection-id="${writing.id}"] .collection-head > small')?.textContent)>0`);
  assert((await rpc('load')).state.collections.find((c) => c.id === writing.id).links.length > 0);
  await click('#switch-collection');
  await delay(100);
  await screenshot('switch-collection');
  const before = (await rpc('load')).tabs.filter((t) => t.windowId === windowId && !t.pinned);
  await app.evaluate(
    `document.querySelector('[aria-label="Save current tabs to"]').value=${JSON.stringify(writing.id)};document.querySelector('[aria-label="Replace with collection"]').value=${JSON.stringify(cap.id)};[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Save & switch').click()`,
  );
  for (let i = 0; i < 45; i++) {
    await delay(100);
    if (!(await app.evaluate('!!document.querySelector("dialog[open]")'))) break;
  }
  const after = await rpc('load');
  assert(
    before.every((t) => !after.tabs.some((x) => x.id === t.id)),
    'Prior source tabs are closed after successful save and destination preparation',
  );
  assert.equal(after.tabs.filter((t) => t.windowId === windowId && t.parked).length, 3);
  assert(after.state.collections.find((c) => c.id === writing.id).links.length >= before.length);
  results.push(
    'Visible Save tabs appends to an existing collection; Save & switch persists source then replaces unpinned tabs with destination pages',
  );
  const backup = await app.evaluate(
    `import('./lib/portable.js').then(async p=>p.parseImport(p.backupExport((await chrome.runtime.sendMessage({action:'load'})).value.state)))`,
  );
  await rpc('import', { collections: backup.collections, spaces: backup.spaces });
  const imported = (await rpc('load')).state;
  const importedCourse = imported.collections.filter((c) => c.name === 'Coursework').at(-1);
  assert.notEqual(importedCourse.spaceId, study.id);
  assert.equal(imported.spaces.find((s) => s.id === importedCourse.spaceId).name, 'Study');
  results.push(
    'Full backup import restores spaces with remapped IDs and intact collection membership',
  );
}
