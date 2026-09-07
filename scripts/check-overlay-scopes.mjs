import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkOverlayScopes({
  app,
  rpc,
  pin,
  delay,
  results,
  connect,
  targets,
  out,
  triggerSwitcher,
}) {
  const wait = async (fn) => {
    for (let i = 0; i < 120; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Overlay scopes did not settle');
  };
  const read = (code) =>
    app.evaluate(
      `chrome.scripting.executeScript({target:{tabId:${pin.id}},func:()=>{const root=globalThis.__neoSurface;${code}}}).then(r=>r[0].result)`,
    );
  const click = (label) =>
    read(
      `const b=[...root.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing '+${JSON.stringify(label)});b.click();`,
    );
  const query = (value) =>
    read(
      `const s=root.querySelector('#quick-search');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
  const native = await connect(
    (await targets()).find((t) => t.url.endsWith('/pinned')).webSocketDebuggerUrl,
  );
  const shot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await native.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  await native.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(200);
  await wait(() => read('return !!root?.querySelector(".browse-scopes")'));
  assert(
    await read(
      'return root.querySelector("[data-mode=window]").getAttribute("aria-pressed")==="true"',
    ),
  );
  assert(await read('return root.querySelector(".collection-dock").hidden'));
  if(process.argv.includes('--overlay-ai')) {
    await (await import('./check-overlay-ai.mjs')).checkOverlayAI({app,rpc,read,click,wait,results,triggerSwitcher,pin});
    return;
  }
  const key = async (value,code=value) => {
    await native.send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code,...(value==='/'?{text:'/'}:{})});
    await native.send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code});
  };
  assert(await read(`return !!root.activeElement?.matches('.preview-tile,.tab-choice')`), 'Switcher opens on a tab');
  const toolbarOrder = await read(`return [...root.querySelector('.overlay-navigation').children].map(n=>n.className)`);
  assert(toolbarOrder[0].includes('audio-filter') && toolbarOrder[1].includes('tab-tools') && toolbarOrder[2].includes('selection-mode-button'),JSON.stringify(toolbarOrder));
  await key('/','Slash');
  assert(await read(`return root.activeElement?.id==='quick-search' && root.activeElement.value===''`), '/ focuses search without inserting a slash');
  for (const mode of ['This window','All windows']) {
    await click(mode);
    for (const arrow of ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight']) {
      await read(`root.querySelector('[data-mode="${mode==='This window'?'window':'all'}"]').focus()`);
      await key(arrow);
      assert(await read(`return !!root.activeElement?.matches('.preview-tile,.tab-choice')`), mode+' '+arrow+' focuses tab');
    }
  }
  await click('This window');
  results.push('Switcher opens focused on tabs; slash focuses search; all four arrows return from scope controls to tabs; shared Sort, Save and Duplicates controls sit between Audio and Select');
  const other = await app.evaluate(
    `chrome.windows.create({url:'https://example.test/other-scope',focused:false})`,
  );
  await rpc('activate', { tabId: pin.id });
  await query('other-scope');
  await wait(() =>
    read('return root.querySelector("#quick-results").textContent.includes("No matching")'),
  );
  assert(await read('return !root.querySelector(".expand-search")'));
  assert(
    !(await read('return root.querySelector("#quick-results").textContent')).includes(
      'Window ' + other.id,
    ),
  );
  await click('All windows');
  assert.equal(await read('return root.querySelector("#quick-search").value'), 'other-scope');
  await wait(() =>
    read(`return root.querySelector('#quick-results').textContent.includes('Window ${other.id}')`),
  );
  await click('This window');
  await query('');
  const one = await app.evaluate(
    `chrome.tabs.create({windowId:${pin.windowId},url:'https://example.test/close-single',active:false})`,
  );
  await query('close-single');
  await wait(() => read('return !!root.querySelector(".tile-close:not(:disabled)")'));
  const before = await app.evaluate(
    `chrome.tabs.query({windowId:${pin.windowId},active:true}).then(t=>t[0].id)`,
  );
  await read('root.querySelector(".tile-close").click()');
  await wait(
    async () => !(await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === one.id),
  );
  assert(await read('return !!root'));
  assert.equal(
    await app.evaluate(
      `chrome.tabs.query({windowId:${pin.windowId},active:true}).then(t=>t[0].id)`,
    ),
    before,
  );
  await click('Recently closed');
  assert.equal(await read('return root.querySelector("#quick-search").value'), 'close-single');
  await wait(() => read('return !!root.querySelector(".session-page")'));
  await shot('overlay-recently-closed');
  await read('root.querySelector(".session-page").click()');
  await wait(async () =>
    (await app.evaluate(`chrome.tabs.query({windowId:${pin.windowId}})`)).some(
      (t) => t.url?.includes('close-single') || t.pendingUrl?.includes('close-single'),
    ),
  );
  // Restore opens the page; reactivate the overlay's host to continue inspecting it.
  await rpc('activate', { tabId: pin.id });
  await query('');
  await click('Timeline');
  assert(await read('return !!root.querySelector(".session-results")'));
  await click('This window');
  await query('pinned');
  // Editing Delete must never close a result.
  const count = (await app.evaluate('chrome.tabs.query({})')).length;
  await read(
    'const s=root.querySelector("#quick-search");s.focus();s.dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true}));',
  );
  assert.equal((await app.evaluate('chrome.tabs.query({})')).length, count);
  await query('');
  await app.evaluate(`chrome.tabs.update(${pin.id},{muted:true})`);
  await click('Audio');
  await wait(() => read('return !!root.querySelector(".tile-mute:not([hidden])")'));
  await click('Unmute tab');
  await wait(() => app.evaluate(`chrome.tabs.get(${pin.id}).then(t=>!t.mutedInfo.muted)`));
  assert(
    await read('return root.querySelector(".audio-filter").getAttribute("aria-pressed")==="true"'),
  );
  await click('Audio');
  await click('Collections');
  await query('Research');
  assert(
    await read(
      'return !!root.querySelector(".collection-result .collection-color") && getComputedStyle(root.querySelector(".collection-color")).backgroundColor!=="rgba(0, 0, 0, 0)"',
    ),
  );
  await query('');
  await shot('overlay-collection-colours');
  await query('Research');
  await read('root.querySelector(".collection-result").click()');
  assert(
    await read(
      'return root.querySelector(".search-scope").textContent.includes("Open collection") && root.querySelector(".search-scope").textContent.includes("Switch to collection")',
    ),
  );
  assert(await read('return ![...root.querySelectorAll("button")].some(b=>b.textContent==="Update collection")'));
  await shot('overlay-collections');
  for (const theme of ['light', 'dark']) {
    await rpc('settings', { settings: { theme } });
    await wait(() => read(`return root.host.dataset.theme===${JSON.stringify(theme)}`));
    await click('Switch to collection');
    assert(await read(`const d=root.querySelector('#dialog'),s=getComputedStyle(d);return d.open && s.borderTopWidth==='1px' && s.borderRadius==='4px' && s.boxShadow==='none' && !d.textContent.includes('Keep a snapshot') && !d.textContent.includes('Replaces unpinned') && !!d.querySelector('input[type="checkbox"]') && !d.querySelector('input[type="checkbox"]').checked && d.textContent.includes("Save current tabs as a new collection");`));
    await shot('flat-switch-modal-' + theme);
    await read(`root.querySelector('#dialog footer button').click()`);
    await wait(() => read('return !root.querySelector("#dialog[open]")'));
  }
  results.push('Light/dark injected switch dialogs use a flat 1px border, 4px corners and no shadow; removed copy is absent and Cancel keeps the switcher open');
  await click('This window');
  await query('');
  await rpc('settings', { settings: { theme: 'dark' } });
  await wait(() => read('return root.host.dataset.theme==="dark"'));
  await click('Previews');
  assert(
    await read('return !root.querySelector(".task-head") && !root.querySelector(".switcher-hint")'),
  );
  assert(await read('return !!root.querySelector(".overlay-navigation > .audio-filter")'));
  assert(
    await read(
      'return root.querySelector(".overlay-navigation .tab-tools").nextElementSibling.id==="select-mode" && !root.querySelector(".overlay-more")',
    ),
  );
  assert(await read('return !!root.querySelector(".browse-scopes .overlay-navigation")'));
  const livePin = await app.evaluate(`chrome.tabs.get(${pin.id})`);
  const grouped = await app.evaluate(
    `(async()=>{const a=await chrome.tabs.create({url:${JSON.stringify(new URL('/flat-one', livePin.url).href)},windowId:${pin.windowId},active:false});const b=await chrome.tabs.create({url:${JSON.stringify(new URL('/flat-two', livePin.url).href)},windowId:${pin.windowId},active:false});const id=await chrome.tabs.group({tabIds:[a.id,b.id]});await chrome.tabGroups.update(id,{title:'Design',color:'blue'});return [a.id,b.id];})()`,
  );
  await wait(() =>
    read('return !!root.querySelector(".group-tile[data-group-color=blue] .group-preview")'),
  );
  assert(
    await read(
      'return !!root.querySelector(".quick-head button[aria-label=Library]") && [...root.querySelectorAll(".quick-head button")].some(b=>b.getAttribute("aria-label")==="Close switcher") && !!root.querySelector(".overlay-navigation #select-mode")',
    ),
  );
  assert(
    await read(
      'return root.querySelectorAll(".group-tile[data-group-color=blue] .group-preview > .preview-image").length===2',
    ),
  );
  const rename = async (name, key = 'Enter') => {
    await read('root.querySelector(".group-tile[data-group-color=blue] .group-name").click()');
    await read(
      `const input=root.querySelector('.group-name-slot input');input.value=${JSON.stringify(name)};input.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}));`,
    );
  };
  await rename('Renamed normally');
  await wait(() =>
    read(
      'return root.querySelector(".group-tile[data-group-color=blue] .group-name").textContent==="Renamed normally"',
    ),
  );
  await click('List');
  await read('root.querySelector(".group-tile[data-group-color=blue] .group-name").click()');
  await read(
    'const input=root.querySelector(".group-name-slot input");input.value="Renamed normally";root.querySelector("#quick-search").focus();',
  );
  await wait(() => read('return !root.querySelector(".group-name-slot input")'));
  await read('root.querySelector(".group-tile[data-group-color=blue] .group-name").click()');
  await shot('overlay-group-inline-list');
  await read(
    'const input=root.querySelector(".group-name-slot input");input.value="Saved on blur";root.querySelector("#quick-search").focus();',
  );
  await wait(() =>
    read(
      'return root.querySelector(".group-tile[data-group-color=blue] .group-name").textContent==="Saved on blur"',
    ),
  );
  await click('Previews');
  await rename('Renamed normally');
  await wait(() =>
    read(
      'return root.querySelector(".group-tile[data-group-color=blue] .group-name").textContent==="Renamed normally"',
    ),
  );
  await rename('Cancelled name', 'Escape');
  assert(
    await read(
      'return root.querySelector(".group-tile[data-group-color=blue] .group-name").textContent==="Renamed normally" && !root.querySelector(".group-name-slot input")',
    ),
  );
  assert(
    await read(
      'return !root.querySelector(".browse-group") && !root.textContent.includes("Browse group")',
    ),
  );
  await read('root.querySelector(".group-tile[data-group-color=blue] .preview-tile").click()');
  assert(
    await read(
      'return !root.querySelector(".group-tile") && root.querySelectorAll(".switcher-card").length===2',
    ),
  );
  for (const id of grouped)
    assert(
      await read(
        `return !![...root.querySelectorAll('.switcher-card')].find(n=>n.dataset.key.includes('tab:${id}:'))?.querySelector('.preview-image')`,
      ),
    );
  await click('All tabs');
  assert(
    await read(
      'const n=root.querySelector(".native-group-card[data-group-color=blue]");return getComputedStyle(n).boxShadow==="none" && getComputedStyle(n).backgroundColor!==getComputedStyle(root.querySelector(".task-view")).backgroundColor',
    ),
  );
  await wait(() => read('return !!root.querySelector(".preview-image > :is(img, canvas)")'));
  await shot('overlay-scopes-dark');
  await read('root.querySelector("#select-mode").click()');
  const activeBefore = await app.evaluate(
    `chrome.tabs.query({windowId:${pin.windowId},active:true}).then(t=>t[0].id)`,
  );
  await read('root.querySelector(".group-tile[data-group-color=blue] .group-select").click()');
  assert(
    await read(
      'return root.querySelector(".selection-toolbar strong").textContent==="2 selected" && root.querySelector(".group-tile[data-group-color=blue] .group-select").getAttribute("aria-pressed")==="true"',
    ),
  );
  await rename('Renamed while selected');
  await wait(() =>
    read(
      'return root.querySelector(".group-tile[data-group-color=blue] .group-name").textContent==="Renamed while selected"',
    ),
  );
  assert(
    await read(
      'return root.querySelector(".selection-toolbar strong").textContent==="2 selected" && [...root.querySelectorAll(".selection-toolbar button")].some(b=>b.textContent==="Ungroup") && ![...root.querySelectorAll(".selection-toolbar button")].some(b=>b.textContent==="More"||b.textContent==="Rename group")',
    ),
  );
  await read('root.querySelector(".group-tile[data-group-color=blue] .preview-tile").click()');
  await read('root.querySelector(".preview-tile").click()');
  assert(
    await read('return root.querySelector(".selection-toolbar strong").textContent==="1 selected"'),
  );
  await click('All tabs');
  assert(
    await read(
      'return root.querySelector(".group-tile[data-group-color=blue] .group-select").getAttribute("aria-pressed")==="mixed"',
    ),
  );
  await shot('overlay-group-partial-selection');
  await read('root.querySelector(".group-tile[data-group-color=blue] .group-select").click()');
  assert(
    await read('return root.querySelector(".selection-toolbar strong").textContent==="2 selected"'),
  );
  await read('root.querySelector(".group-tile[data-group-color=blue] .group-select").click()');
  assert(
    await read(
      'return root.querySelector(".selection-toolbar strong").textContent==="Select tabs or groups"',
    ),
  );
  assert.equal(
    await app.evaluate(
      `chrome.tabs.query({windowId:${pin.windowId},active:true}).then(t=>t[0].id)`,
    ),
    activeBefore,
  );
  await read('root.querySelector("#select-mode").click()');
  await read('root.querySelector("#select-mode").click()');
  await read('root.querySelector(".group-tile[data-group-color=blue] .group-select").click()');
  await click('Ungroup');
  await wait(() => read('return !root.querySelector(".group-tile[data-group-color=blue]")'));
  for (const id of grouped)
    assert.equal(await app.evaluate(`chrome.tabs.get(${id}).then(t=>t.groupId)`), -1);
  await read('root.querySelector("#select-mode").click()');
  results.push(
    'Overlay groups: inline rename in normal and selection modes, Escape cancels, preview opens folders, checkbox selects whole/partial groups, direct Ungroup works; coloured collection rows and no Browse group or selection More button',
  );
  assert(await read('return !root.querySelector(".overlay-more")'));
  await read('root.querySelector(".overlay-navigation .tab-tools>button").focus()');
  await click('Save tabs');
  const geometry = await read(`const p=root.querySelector('#action-popover').getBoundingClientRect(),v=root.querySelector('.task-view').getBoundingClientRect();return {dx:Math.abs(p.left+p.width/2-v.left-v.width/2),dy:Math.abs(p.top+p.height/2-v.top-v.height/2),top:p.top,left:p.left,right:p.right,bottom:p.bottom,w:innerWidth,h:innerHeight}`);
  assert(geometry.dx<2 && geometry.dy<2, JSON.stringify(geometry));
  assert(geometry.top>=0 && geometry.left>=0 && geometry.right<=geometry.w && geometry.bottom<=geometry.h);
  await shot('switcher-save-centred');
  await click('Cancel');
  // Exercise the visible overlay sort menu, including the actual browser order.
  const sortOrigin=new URL(livePin.url).origin;
  const sortTabs=await app.evaluate(`Promise.all(['/research-sort','/brief-sort'].map(p=>chrome.tabs.create({windowId:${pin.windowId},url:${JSON.stringify(sortOrigin)}+p,active:false})))`);
  await wait(()=>app.evaluate(`Promise.all(${JSON.stringify(sortTabs.map(t=>t.id))}.map(id=>chrome.tabs.get(id))).then(ts=>ts.every(t=>t.status==='complete'))`));
  await click('Group and sort tabs');
  assert(await read(`return root.querySelector('#action-popover').textContent.includes('Group & sort') && root.querySelector('#action-popover').textContent.includes('Group by topic with AI')`));
  await read(`[...root.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='Title A–Z').click()`);
  await wait(()=>app.evaluate(`Promise.all(${JSON.stringify(sortTabs.map(t=>t.id))}.map(id=>chrome.tabs.get(id))).then(([research,brief])=>brief.index<research.index)`));
  results.push('The overlay Title A–Z menu changes actual browser tab order');
  await query('keep text');
  await read(
    'root.querySelector("#quick-search").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));',
  );
  await wait(() => read('return !root'));
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector("#sidebar-scopes button")'));
  assert(
    await app.evaluate(
      'document.querySelector("#recent").textContent.includes("Recent & history")',
    ),
  );
  assert(
    await app.evaluate(
      'document.querySelector("#sidebar-scopes").textContent.includes("All windows")',
    ),
  );
  results.push(
    'Explicit scopes preserve queries and exclude other windows; individual close keeps overlay and active tab; Recently closed reopens; separate session history',
  );
  results.push(
    'Audio filter/unmute, readable selection actions, collection Open/Swap, shared action toolbar, safe Delete editing and Escape dismissal; matching library scopes',
  );
  // Bounded narrow-layout screenshot of the new overlay.
  await triggerSwitcher(pin);
  await wait(() => read('return !!root?.querySelector(".browse-scopes")'));
  await native.send('Emulation.setDeviceMetricsOverride', {
    width: 620,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(250);
  assert(
    await read(
      'return root.querySelector(".task-view").scrollWidth <= root.querySelector(".task-view").clientWidth + 1',
    ),
  );
  await shot('overlay-scopes-narrow');
  await native.send('Emulation.clearDeviceMetricsOverride');
  await read('globalThis.__neoCloseOverlay()');
  if (process.argv.includes('--focus-scroll')) {
    await native.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const focusTabs = [];
    const focusSource = await app.evaluate(`chrome.tabs.get(${pin.id})`);
    for (let i = 0; i < 16; i++)
      focusTabs.push(
        await app.evaluate(
          `chrome.tabs.create({windowId:${pin.windowId},active:false,url:${JSON.stringify(focusSource.url + '/focus-' + i)}})`,
        ),
      );
    await triggerSwitcher(pin);
    await wait(() => read('return !!root?.querySelector("#quick-search")'));
    await query('focus-');
    await click('Previews');
    await wait(() => read('return root.querySelectorAll(".preview-tile").length===16'));
    const dimensions = () =>
      read(
        `const list=root.querySelector('#quick-results'),panel=root.querySelector('.task-view'),first=list.querySelector('.preview-tile'),a=first.getBoundingClientRect(),b=list.getBoundingClientRect(),p=panel.getBoundingClientRect(),style=getComputedStyle(first);return {top:a.top,height:a.height,panelTop:p.top,panelHeight:p.height,scroll:list.scrollTop,ringTop:a.top-parseFloat(style.outlineOffset)-parseFloat(style.outlineWidth),listTop:b.top};`,
      );
    const before = await dimensions();
    await read('root.querySelector("#quick-search").focus()');
    const arrow = async (key) => {
      await native.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key });
      await native.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
    };
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 16; i++) await arrow('ArrowDown');
      for (let i = 0; i < 16; i++) await arrow('ArrowUp');
    }
    // Reproduce a partially visible first row, as in the supplied recording.
    await read('root.querySelector("#quick-results").scrollTop=100');
    await arrow('ArrowDown');
    await arrow('ArrowUp');
    const after = await dimensions();
    await fs.writeFile(
      path.join(out, 'focus-scroll-geometry.json'),
      JSON.stringify({ before, after }, null, 2),
    );
    await shot('overlay-focus-return');
    assert.equal(
      after.scroll,
      0,
      'Returning to the first row restores the original scroll position',
    );
    assert(Math.abs(after.top - before.top) < 1, 'First card returns to its original position');
    assert(
      Math.abs(after.height - before.height) < 1 &&
        Math.abs(after.panelHeight - before.panelHeight) < 1,
      'Card and overlay heights remain stable',
    );
    assert(after.ringTop >= after.listTop, 'Top focus ring is fully visible');
    await read('globalThis.__neoCloseOverlay()');
    await app.evaluate(`chrome.tabs.remove(${JSON.stringify(focusTabs.map((t) => t.id))})`);
    results.push(
      'Repeated ArrowDown/ArrowUp returns to the original first-row position and panel/card heights, with the full focus outline visible',
    );
  }
  if (process.argv.includes('--toggle')) {
    const invoke = async (tab, mode = 'switcher') =>
      app.evaluate(
        `import(chrome.runtime.getURL('lib/overlay.js')).then(m=>m.openSwitcher(${JSON.stringify(tab)},${JSON.stringify({ mode })}))`,
      );
    const source = await app.evaluate(`chrome.tabs.get(${pin.id})`);
    const ids = (await app.evaluate('chrome.tabs.query({})')).map((t) => t.id).sort();
    await invoke(source);
    await wait(() => read('return !!root?.querySelector("#quick-search")'));
    // A key event reaching the renderer must not also close/reopen the overlay.
    await read(
      'root.querySelector("#quick-search").dispatchEvent(new KeyboardEvent("keydown",{key:"q",altKey:true,bubbles:true}))',
    );
    assert(await read('return !!root'));
    await invoke(source);
    await wait(() => read('return !root'));
    await invoke(source);
    await wait(() => read('return !!root?.querySelector(".tab-more-button")'));
    await click('Group and sort tabs');
    await invoke(source);
    await wait(() => read('return !root'));
    await invoke(source, 'search');
    await wait(() => read('return !!root?.querySelector("#quick-search")'));
    await invoke(source);
    await wait(() => read('return !root'));
    assert.deepEqual((await app.evaluate('chrome.tabs.query({})')).map((t) => t.id).sort(), ids);
    const protectedTab = await app.evaluate(
      `chrome.tabs.create({url:'chrome://version',windowId:${pin.windowId},active:false})`,
    );
    await wait(() =>
      app.evaluate(
        `chrome.tabs.get(${protectedTab.id}).then(t=>t.url==='chrome://version/' && t.status==='complete')`,
      ),
    );
    await invoke(await app.evaluate(`chrome.tabs.get(${protectedTab.id})`));
    await wait(async () =>
      (await app.evaluate('chrome.tabs.query({})')).some((t) =>
        (t.url || t.pendingUrl || '').includes('/quick.html?window=' + pin.windowId),
      ),
    );
    const fallback = (await app.evaluate('chrome.tabs.query({})')).find((t) =>
      (t.url || t.pendingUrl || '').includes('/quick.html?window=' + pin.windowId),
    );
    assert(fallback, 'Protected page must open a fallback');
    await invoke(fallback);
    assert(!(await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === fallback.id));
    assert((await app.evaluate('chrome.tabs.query({})')).some((t) => t.id === protectedTab.id));
    await app.evaluate(`chrome.tabs.remove(${protectedTab.id})`);
    results.push(
      'Shortcut command path opens, closes and reopens without duplicate renderer handling; closes with menu open, in search mode and in protected-page fallback; source tabs preserved',
    );
  }
  results.push(
    'Flat overlay fits a 620px viewport; no redundant heading/footer/empty action; Audio followed by shared action buttons beside Select; folder groups show previews, browse into individual tabs and support whole/partial group selection without activating pages',
  );
}
