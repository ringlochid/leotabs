// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkInteractions({ app, rpc, out, results, delay }) {
  const tab = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: tab.id });
  await delay(250);
  async function drag(from, to) {
    const point = (selector) =>
      app.evaluate(
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      );
    const end = await point(to),
      start = await point(from);
    let payload;
    const listener = (event) => {
      const m = JSON.parse(event.data);
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
        x: start.x + 20,
        y: start.y + 15,
        button: 'left',
        buttons: 1,
      });
      for (let i = 0; i < 20 && !payload; i++) await delay(30);
      assert(
        payload?.items.some((item) => item.mimeType === 'application/x-neo'),
        'Native drag carries the production handler data',
      );
      for (const type of ['dragEnter', 'dragOver', 'drop'])
        await app.send('Input.dispatchDragEvent', { type, ...end, data: payload });
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...end,
        button: 'left',
        clickCount: 1,
      });
      await delay(300);
    } finally {
      app.ws.removeEventListener('message', listener);
      await app.send('Input.setInterceptDrags', { enabled: false });
    }
  }
  let data = await rpc('load'),
    first = data.state.collections[0],
    second = data.state.collections.find((c) => c.name === 'Capstone');
  await app.evaluate(
    `(()=>{if(!document.querySelector('#selection').hidden)document.querySelector('#selection .row button').click();document.querySelector('.tab-select').click();})()`,
  );
  const beforeTabs = data.tabs.length;
  await drag('.tab-row .tab-open', `[data-collection-id="${first.id}"] .collection-head`);
  data = await rpc('load');
  assert.equal(
    data.state.collections.find((c) => c.id === first.id).links.length,
    first.links.length + 1,
  );
  assert.equal(data.tabs.length, beforeTabs);
  results.push('Native pointer drag saves a sidebar selection without closing its source tab');
  const link = first.links[0],
    group = second.groups[0];
  await drag(`[data-link-id="${link.id}"] .link-open`, `[data-focus-key="${group.id}:toggle"]`);
  data = await rpc('load');
  assert(
    !data.state.collections.find((c) => c.id === first.id).links.some((l) => l.id === link.id),
  );
  assert.equal(
    data.state.collections.find((c) => c.id === second.id).links.find((l) => l.id === link.id)
      .groupId,
    group.id,
  );
  await drag(
    `[data-collection-id="${second.id}"] .collection-name`,
    `[data-collection-id="${first.id}"] .collection-head`,
  );
  assert.equal((await rpc('load')).state.collections[0].id, second.id);
  results.push(
    'Native drag moves a link into a group and reorders collections without losing link identity',
  );

  const file = path.join(out, 'backup-ui.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      format: 'neo-backup',
      version: 1,
      collections: [
        {
          name: 'Backup UI fixture',
          color: 'rose',
          note: 'Restored continuation',
          groups: [],
          links: [{ id: 'portable', title: 'Portable link', url: 'https://example.org/portable' }],
        },
      ],
      settings: {
        theme: 'dark',
        previewCapture: true,
        rules: [{ domain: 'example.org', group: 'Imported rule' }],
      },
      recovery: [{ label: 'Old action', at: Date.now(), status: 'complete' }],
    }),
  );
  const prior = (await rpc('load')).state;
  await app.evaluate('document.getElementById("imports").click()');
  const document = await app.send('DOM.getDocument'),
    input = await app.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '#dialog input[type=file]',
    });
  await app.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] });
  for (
    let i = 0;
    i < 30 &&
    !(await app.evaluate('document.querySelector("#dialog h2")?.textContent==="Review import"'));
    i++
  )
    await delay(50);
  assert(
    await app.evaluate(
      'document.querySelector("#dialog").textContent.includes("Restore saved preferences")',
    ),
  );
  assert.equal(
    await app.evaluate('document.querySelector("#dialog input[type=checkbox]").checked'),
    false,
  );
  await app.evaluate('document.querySelector("#dialog input[type=checkbox]").click()');
  await app.evaluate(
    `[...document.querySelectorAll('#dialog button')].find(b=>b.textContent==='Import collections').click()`,
  );
  await delay(250);
  const restored = (await rpc('load')).state;
  assert.equal(restored.collections.length, prior.collections.length + 1);
  assert.equal(restored.settings.theme, 'dark');
  assert.equal(restored.settings.previewCapture, false);
  assert.equal(restored.settings.rules[0].group, 'Imported rule');
  assert.equal(restored.importedHistory[0].status, 'archived');
  results.push(
    'Actual file-input backup review preserves existing work and restores only chosen settings with inert history',
  );
  const importOp = (await rpc('load')).journal.find((op) => op.revision === restored.revision);
  await rpc('undo-action', { id: importOp.id });
  const undone = (await rpc('load')).state;
  assert.equal(undone.collections.length, prior.collections.length);
  assert.equal(undone.settings.theme, prior.settings.theme);
  assert.deepEqual(undone.importedHistory, prior.importedHistory);
  results.push(
    'Undo of a backup import removes newly introduced archive metadata and restores prior preferences',
  );

  await app.evaluate('document.getElementById("global-search").click()');
  const initialTabs = (await rpc('load')).tabs.length;
  await app.evaluate(
    `(()=>{const input=document.querySelector('.search-dialog input');input.value='/save';input.dispatchEvent(new Event('input'));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));})()`,
  );
  assert.equal(await app.evaluate('!!document.querySelector("#dialog[open]")'), false);
  assert.equal((await rpc('load')).tabs.length, initialTabs);
  await app.evaluate('document.querySelector(".search-dialog").close()');
  results.push('IME composition does not trigger a slash action');
}
