// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkSwitchPicker({ app, rpc, out, results, delay, origin }) {
  const wait = async (fn) => {
    for (let i = 0; i < 150; i++) {
      if (await fn()) return;
      await delay(100);
    }
    await fs.writeFile(
      path.join(out, 'switch-failure.json'),
      JSON.stringify(
        await app.evaluate(
          '({popover:document.querySelector("#action-popover")?.outerHTML,toast:document.querySelector("#toast")?.textContent})',
        ),
        null,
        2,
      ),
    );
    throw Error('Switch picker did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  await rpc('edit', { kind: 'create', name: 'Switch picker destination' });
  const destination = (await rpc('load')).state.collections.find(
    (c) => c.name === 'Switch picker destination',
  );
  await rpc('edit', {
    kind: 'add-link',
    collectionId: destination.id,
    title: 'Destination page',
    url: origin + '/picker-destination',
  });
  const pin = await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/picker-pin')},pinned:true,active:false,windowId:${own.windowId}})`,
  );
  for (const saveCurrent of [true, false]) {
    const sentinel = await app.evaluate(
      `chrome.tabs.create({url:${JSON.stringify(origin + '/picker-source-')}+${saveCurrent},active:false,windowId:${own.windowId}})`,
    );
    await wait(() =>
      app.evaluate(`chrome.tabs.get(${sentinel.id}).then(t=>t.status==='complete')`),
    );
    await app.send('Page.reload');
    await wait(() => app.evaluate('!!document.querySelector("#switch-collection")?.onclick'));
    const before = (await rpc('load')).state.collections.length;
    await app.evaluate(
      'document.querySelector("#switch-collection").focus(); document.querySelector("#switch-collection").click()',
    );
    assert(
      await app.evaluate('document.querySelector("#action-popover").matches(":popover-open")'),
    );
    assert.equal(await app.evaluate('!!document.querySelector("dialog[open]")'), false);
    assert.equal(
      await app.evaluate('document.querySelectorAll("#action-popover select").length'),
      0,
    );
    assert(
      await app.evaluate('document.querySelector("#action-popover input[type=checkbox]").checked'),
    );
    await app.evaluate(
      '(()=>{const s=document.querySelector("#action-popover input[type=search]"); s.value="missing collection xyz"; s.dispatchEvent(new Event("input"));})()',
    );
    assert.equal(
      await app.evaluate('document.querySelectorAll(".switch-choices button").length'),
      0,
    );
    assert(
      await app.evaluate(
        'document.querySelector("#action-popover [role=status]").textContent.includes("No matching")',
      ),
    );
    await app.evaluate(
      '(()=>{const s=document.querySelector("#action-popover input[type=search]"); s.value="switch picker"; s.dispatchEvent(new Event("input"));})()',
    );
    assert.equal(
      await app.evaluate('document.querySelectorAll(".switch-choices button").length'),
      1,
    );
    if (!saveCurrent)
      await app.evaluate('document.querySelector("#action-popover input[type=checkbox]").click()');
    await fs.writeFile(
      path.join(out, `switch-picker-${saveCurrent ? 'save' : 'no-save'}.png`),
      Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
    const bounds = await app.evaluate(
      '(()=>{const p=document.querySelector("#action-popover"),r=p.getBoundingClientRect(); return ({left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:p.scrollWidth>p.clientWidth});})()',
    );
    assert(
      bounds.left >= 0 &&
        bounds.right <= bounds.width &&
        bounds.bottom <= bounds.height &&
        !bounds.overflow,
    );
    if (saveCurrent) {
      await app.evaluate('document.querySelector("#action-popover input[type=search]").focus()');
      await app.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'ArrowDown',
        code: 'ArrowDown',
      });
      assert(await app.evaluate('document.activeElement.matches(".switch-choices button")'));
      await app.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await app.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
    } else await app.evaluate('document.querySelector(".switch-choices button").click()');
    await wait(() => app.evaluate('!document.querySelector("#action-popover")'));
    const after = await rpc('load');
    assert.equal(after.state.collections.length, before + (saveCurrent ? 1 : 0));
    assert(!(await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === sentinel.id));
    assert((await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === pin.id && t.pinned));
    if (saveCurrent)
      assert(
        after.state.collections.some((c) =>
          c.links.some((l) => l.url === origin + '/picker-source-' + saveCurrent),
        ),
      );
  }
  results.push(
    'Shared switch picker: searchable rows, empty result, keyboard activation, checked saves automatically, unchecked creates no collection; source replaced and pinned tabs preserved',
  );
}

export async function checkSwitchOverlay({ app, rpc, pin, delay, results, connect, targets, out }) {
  const read = (code) =>
    app.evaluate(
      `chrome.scripting.executeScript({target:{tabId:${pin.id}},func:()=>{const root=globalThis.__neoSurface;${code}}}).then(r=>r[0].result)`,
    );
  for (
    let i = 0;
    i < 100 && !(await read('return !!root?.querySelector("button[aria-label^=Switch]")'));
    i++
  )
    await delay(100);
  await read('root.querySelector("button[aria-label^=Switch]").click()');
  assert(
    await read(
      'const p=root.querySelector("#action-popover"); return p.matches(":popover-open") && !!p.querySelector("input[type=search]") && !p.querySelector("select") && !root.querySelector("dialog[open]")',
    ),
  );
  await read(
    'const s=root.querySelector("#action-popover input[type=search]"); s.value="Capstone"; s.dispatchEvent(new Event("input"));',
  );
  assert.equal(await read('return root.querySelectorAll(".switch-choices button").length'), 1);
  const nativePage = await connect(
    (await targets()).find((t) => t.url.endsWith('/pinned')).webSocketDebuggerUrl,
  );
  await fs.writeFile(
    path.join(out, 'switch-picker-overlay.png'),
    Buffer.from(
      (await nativePage.send('Page.captureScreenshot', { format: 'png' })).data,
      'base64',
    ),
  );
  const before = (await rpc('load')).state.collections.length;
  await read(
    'root.querySelector("#action-popover input[type=checkbox]").click(); root.querySelector(".switch-choices button").click();',
  );
  for (let i = 0; i < 150 && (await read('return !!root')); i++) await delay(100);
  assert.equal(await read('return !!root'), false);
  assert.equal((await rpc('load')).state.collections.length, before);
  results.push(
    'Overlay switch picker filters collections, switches with Save current tabs unchecked, adds no collection and dismisses on success',
  );
}
