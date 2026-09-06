// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkSelectionClarity({ app, rpc, results, out, delay, origin }) {
  const wait = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Selection UI did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  const twins = await app.evaluate(
    `Promise.all([1,2].map(()=>chrome.tabs.create({url:${JSON.stringify(origin + '/clarity-duplicate')},windowId:${own.windowId},active:false})))`,
  );
  await wait(() =>
    app.evaluate(
      `chrome.tabs.query({}).then(t=>${JSON.stringify(twins.map((t) => t.id))}.every(id=>t.some(x=>x.id===id&&x.status==='complete')))`,
    ),
  );
  await rpc('settings', { settings: { theme: 'dark' } });
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector("#dedup .count-badge")'));
  const geometry = await app.evaluate(
    `(()=>{const d=document.querySelector('#dedup'),b=d.querySelector('.count-badge'),s=document.querySelector('#library-select-mode');const r=d.getBoundingClientRect(),q=b.getBoundingClientRect(),t=s.getBoundingClientRect(),i=d.querySelector('svg').getBoundingClientRect();return{circle:q.width===q.height,inside:q.right<=r.right&&q.left>=r.left,gap:q.left-i.right,space:t.left-r.right,overflow:document.querySelector('#sidebar').scrollWidth>document.querySelector('#sidebar').clientWidth};})()`,
  );
  assert(
    geometry.circle &&
      geometry.inside &&
      geometry.gap <= 4 &&
      geometry.space >= 0 &&
      !geometry.overflow,
    JSON.stringify(geometry),
  );
  const before = (await app.evaluate('chrome.tabs.query({})')).map((t) => t.id);
  await app.evaluate(
    'document.querySelector("#library-select-mode").focus();document.querySelector("#library-select-mode").click()',
  );
  assert.equal(
    await app.evaluate('document.querySelector("#library-select-mode").textContent'),
    'Done',
  );
  assert.equal(await app.evaluate('document.querySelector("#library-select-mode svg")'), null);
  await app.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await app.evaluate('document.querySelector("#library-select-mode").focus()');
  assert(
    await app.evaluate(
      'getComputedStyle(document.querySelector("#library-select-mode")).outlineOffset === "-2px"',
    ),
  );
  assert(
    await app.evaluate(
      'document.querySelector("#selection .close-selected").textContent==="Close tabs" && !document.querySelector("#selection .close-selected svg")',
    ),
  );
  await app.evaluate(`document.querySelector('[data-tab-id="${twins[0].id}"] input').click()`);
  assert.equal(
    await app.evaluate('document.querySelector("#selection .close-selected").disabled'),
    false,
  );
  await fs.writeFile(
    path.join(out, 'selection-clarity-library.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await app.evaluate('document.querySelector("#library-select-mode").click()');
  assert.deepEqual(
    (await app.evaluate('chrome.tabs.query({})')).map((t) => t.id),
    before,
  );
  assert(await app.evaluate('document.querySelector("#selection").hidden'));
  await app.evaluate('document.querySelector("#library-select-mode").click()');
  await app.evaluate(`document.querySelector('[data-tab-id="${twins[0].id}"] input').click()`);
  await app.evaluate('document.querySelector("#selection .close-selected").click()');
  await wait(
    async () => !(await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === twins[0].id),
  );
  assert((await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === twins[1].id));
  results.push(
    'Library: circular cleanup badge fits its button, toolbar and focus do not overlap; Done preserves tabs while labelled Close tabs closes only the selection',
  );
}
export async function checkSelectionOverlay({ app, pin, delay, results, connect, targets, out }) {
  const read = (code) =>
    app.evaluate(
      `chrome.scripting.executeScript({target:{tabId:${pin.id}},func:()=>{const root=globalThis.__neoSurface;${code}}}).then(r=>r[0].result)`,
    );
  for (let i = 0; i < 100 && !(await read('return !!root?.querySelector("#select-mode")')); i++)
    await delay(100);
  await read('root.querySelector("#select-mode").click()');
  assert(
    await read(
      'return root.querySelector("#select-mode").textContent==="Done" && !root.querySelector("#select-mode svg")',
    ),
  );
  assert(
    await read(
      'const b=root.querySelector(".selection-toolbar .close-selected");return b.textContent==="Close tabs"&&!b.querySelector("svg")',
    ),
  );
  const native = await connect(
    (await targets()).find((t) => t.url.endsWith('/pinned')).webSocketDebuggerUrl,
  );
  await fs.writeFile(
    path.join(out, 'selection-clarity-overlay.png'),
    Buffer.from((await native.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  const before = await app.evaluate('chrome.tabs.query({}).then(t=>t.map(x=>x.id))');
  await read('root.querySelector("#select-mode").click()');
  assert.deepEqual(await app.evaluate('chrome.tabs.query({}).then(t=>t.map(x=>x.id))'), before);
  await read('globalThis.__neoCloseOverlay()');
  results.push(
    'Overlay shares text Done and explicit Close tabs; exiting selection preserves open tabs',
  );
}
