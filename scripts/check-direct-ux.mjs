// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkDirectUX({ app, rpc, out, results, delay }) {
  const wait = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Direct UX did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  await app.evaluate('history.replaceState(null,"",location.pathname)');
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector(".collection")'));
  const source = (await rpc('load')).state.collections.find((c) => c.name === 'Source');
  const dest = (await rpc('load')).state.collections.find((c) => c.name === 'Destination');
  const card = (id) => `[data-collection-id="${id}"]`;
  const click = async (selector, label) =>
    app.evaluate(
      `(()=>{const n=document.querySelector(${JSON.stringify(selector)});const b=[...n.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing '+${JSON.stringify(label)});b.focus();b.click();})()`,
    );
  const shot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  await click(card(source.id), 'Fold Source');
  await wait(
    async () => (await rpc('load')).state.collections.find((c) => c.id === source.id).collapsed,
  );
  await app.send('Page.reload');
  await wait(() => app.evaluate(`!!document.querySelector('${card(source.id)}.folded')`));
  assert.equal(
    await app.evaluate(`!!document.querySelector('${card(source.id)} .collection-body')`),
    false,
  );
  await click(card(source.id), 'Unfold Source');
  await wait(() => app.evaluate(`!!document.querySelector('${card(source.id)} .collection-body')`));
  await click(card(source.id), 'Expand Source');
  assert.equal(await app.evaluate('document.querySelectorAll(".collection").length'), 1);
  const restore = await app.evaluate(
    `(()=>{const b=document.querySelector('button[aria-label="Restore Source"]');return{width:b.getBoundingClientRect().width,svg:b.querySelector('path').getAttribute('d')}})()`,
  );
  assert.equal(restore.width, 28);
  await click(card(source.id), 'Restore Source');
  assert((await app.evaluate('document.querySelectorAll(".collection").length')) >= 2);
  await click(card(source.id), 'Options for Source');
  assert.equal(await app.evaluate('!!document.querySelector("dialog[open]")'), false);
  assert(await app.evaluate('document.querySelector("#action-popover").matches(":popover-open")'));
  await shot('collection-menu-05');
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  assert.equal(
    await app.evaluate('document.activeElement.getAttribute("aria-label")'),
    'Options for Source',
  );
  await click('body', 'Organise with AI');
  await click('#action-popover', 'Source');
  assert(
    await app.evaluate('document.querySelector("#dialog").textContent.includes("Generate a plan")'),
  );
  assert(
    await app.evaluate(
      'document.querySelector("#dialog").textContent.includes("AI connection settings")',
    ),
  );
  await shot('ai-entry-05');
  await click('#dialog', 'Close');
  results.push(
    'Collection folding persists across reload; Expand becomes Restore at the same size; anchored menus support Escape; visible AI entry reaches setup and plan review',
  );

  await app.evaluate('document.querySelector("#library-select-mode").click()');
  const tab = (await rpc('load')).tabs.find((t) => !t.pinned && t.windowId === own.windowId);
  await app.evaluate(`document.querySelector('[data-tab-id="${tab.id}"] input').click()`);
  const layout = await app.evaluate(
    `(()=>{const a=document.querySelector('#selection'),b=document.querySelector('#tabs');return{bottom:a.getBoundingClientRect().bottom,top:b.getBoundingClientRect().top,buttons:[...a.querySelectorAll('button')].every(b=>(b.classList.contains('close-selected')?b.textContent==='Close tabs':!b.textContent.trim())&&!!b.title),rows:[...b.querySelectorAll('.tab-row')].map(r=>{const x=r.getBoundingClientRect();return{top:x.top,bottom:x.bottom}})}})()`,
  );
  assert(layout.bottom <= layout.top);
  assert(layout.buttons);
  assert(
    await app.evaluate(
      `[...document.querySelectorAll('#tabs .tab-row > .favicon')].every(n=>getComputedStyle(n).visibility==='hidden')`,
    ),
    'Selection checkboxes must not overlap favicons',
  );
  for (let i = 1; i < layout.rows.length; i++)
    assert(layout.rows[i].top >= layout.rows[i - 1].bottom);
  await shot('selection-strip-05');
  const before = (await rpc('load')).state.collections.length;
  await click('#selection', 'Save tabs');
  assert.equal(await app.evaluate('document.querySelectorAll("#action-popover select").length'), 0);
  await app.evaluate(`document.querySelector('#action-popover input[type=checkbox]').click()`);
  await click('#action-popover', 'Save tabs');
  await wait(async () => (await rpc('load')).state.collections.length === before + 1);
  assert(await app.evaluate(`chrome.tabs.get(${tab.id}).then(t=>!!t)`));
  await app.evaluate('document.querySelector("#library-select-mode").click()');
  results.push(
    'Selection strip sits above non-overlapping rows with titled icons and an explicit Close tabs action; Save makes a new collection without a destination picker and respects keep-open',
  );

  async function drag(after) {
    const points = await app.evaluate(
      `(()=>{const a=document.querySelector('${card(source.id)} .collection-head'),b=document.querySelector('${card(dest.id)}');a.scrollIntoView({block:'center'});const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return{start:{x:x.left+60,y:x.top+18},end:{x:y.left+y.width*${after ? 0.8 : 0.2},y:y.top+20}}})()`,
    );
    let payload;
    const listener = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Input.dragIntercepted') payload = m.params.data;
    };
    app.ws.addEventListener('message', listener);
    try {
      await app.send('Input.setInterceptDrags', { enabled: true });
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start });
      await app.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...points.start,
        button: 'left',
        clickCount: 1,
      });
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: points.start.x + 24,
        y: points.start.y + 16,
        button: 'left',
        buttons: 1,
      });
      await wait(() => !!payload);
      for (const type of ['dragEnter', 'dragOver'])
        await app.send('Input.dispatchDragEvent', { type, ...points.end, data: payload });
      assert(await app.evaluate('!!document.querySelector(".collection-insertion")'));
      assert.equal(
        await app.evaluate('document.querySelectorAll(".collection.drag-over").length'),
        0,
      );
      await shot(after ? 'drag-after-05' : 'drag-before-05');
      await app.send('Input.dispatchDragEvent', { type: 'drop', ...points.end, data: payload });
      await app.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...points.end,
        button: 'left',
        clickCount: 1,
      });
      await wait(async () => {
        const cs = (await rpc('load')).state.collections;
        return after
          ? cs.findIndex((c) => c.id === source.id) > cs.findIndex((c) => c.id === dest.id)
          : cs.findIndex((c) => c.id === source.id) < cs.findIndex((c) => c.id === dest.id);
      });
      assert.equal(await app.evaluate('!!document.querySelector(".collection-insertion")'), false);
    } finally {
      app.ws.removeEventListener('message', listener);
      await app.send('Input.setInterceptDrags', { enabled: false });
    }
  }
  await drag(true);
  await drag(false);
  results.push(
    'Real header dragging shows an insertion line instead of a destination-card outline; before/after drops reorder correctly and clear drag state',
  );
}
