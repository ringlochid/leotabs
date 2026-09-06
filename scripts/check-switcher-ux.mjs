// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkSwitcherUX({ read, rpc, app, pin, nativePage, out, results, delay }) {
  const waitFor = async (code) => {
    for (let i = 0; i < 120; i++) {
      if (await read(code)) return;
      await delay(100);
    }
    throw Error('Switcher did not settle: ' + code);
  };
  const click = (label) =>
    read(
      `const b=[...root.querySelectorAll('button')].find(n=>n.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Button unavailable: '+${JSON.stringify(label)});b.click();`,
    );
  const screenshot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from(
        (await nativePage.send('Page.captureScreenshot', { format: 'png' })).data,
        'base64',
      ),
    );
  // Observe real loaded images continuously across more than three poll cycles.
  await read(`globalThis.__uxImages=[...root.querySelectorAll('.preview-image img')];globalThis.__uxMissing=0;
    globalThis.__uxTimer=setInterval(()=>{if(globalThis.__uxImages.some(n=>!n.isConnected||!n.complete))globalThis.__uxMissing++;},30);`);
  await rpc('settings', { settings: { theme: 'dark' } });
  await waitFor(`return getComputedStyle(root.host).colorScheme==='dark';`);
  assert(
    await read(
      `return getComputedStyle(root.querySelector('.task-view')).backgroundColor.includes('40, 42, 46');`,
    ),
  );
  await screenshot('switcher-dark');
  await delay(8200);
  assert.equal(
    await read('clearInterval(globalThis.__uxTimer);return globalThis.__uxMissing;'),
    0,
    'Loaded previews remain mounted and decoded through all refreshes',
  );
  await rpc('settings', { settings: { theme: 'light' } });
  await waitFor(`return getComputedStyle(root.host).colorScheme==='light';`);
  await screenshot('switcher-light');
  results.push(
    'Loaded previews never disappear across 8.2 seconds of polling and theme changes; injected light/dark colors match Settings',
  );
  const baseURL = await nativePage.evaluate('location.href');
  const testTabs = await app.evaluate(
    `Promise.all(['select-one','select-two'].map(p=>chrome.tabs.create({url:new URL('/'+p,${JSON.stringify(baseURL)}).href,windowId:${pin.windowId},active:false})))`,
  );
  await waitFor(
    `return ${JSON.stringify(testTabs.map((t) => t.id))}.every(id=>[...root.querySelectorAll('.switcher-card')].some(n=>n.dataset.key.includes('tab:'+id+':')));`,
  );
  await read(`root.querySelector('#select-mode').click();`);
  assert(
    await read(
      `return !root.querySelector('.selection-toolbar').hidden && !root.querySelector('.selection-toolbar button[aria-label=Group]').disabled===false;`,
    ),
  );
  for (const tab of testTabs)
    await read(
      `[...root.querySelectorAll('.switcher-card')].find(n=>n.dataset.key.includes('tab:${tab.id}:')).querySelector('button').click();`,
    );
  assert.equal(
    await read(`return root.querySelector('.selection-toolbar strong').textContent;`),
    '2 selected',
  );
  await click('Group');
  await waitFor(`return !root.querySelector('.group-rename').hidden;`);
  assert.equal(await read(`return !!root.querySelector('dialog[open]');`), false);
  await read(`root.querySelector('.group-rename input').value='Focus work';`);
  await delay(2800);
  assert.equal(await read(`return root.querySelector('.group-rename input').value;`), 'Focus work');
  await read(`root.querySelector('.group-rename').requestSubmit();`);
  await waitFor(
    `return root.querySelector('.group-rename').hidden && [...root.querySelectorAll('.group-tile')].some(n=>n.textContent.includes('Focus work'));`,
  );
  const native = (await rpc('load')).groups.find((g) => g.title === 'Focus work');
  assert(native);
  await rpc('settings', { settings: { theme: 'dark' } });
  await waitFor(`return getComputedStyle(root.host).colorScheme==='dark';`);
  await screenshot('switcher-select');
  await click('Clear');
  await read(
    `[...root.querySelectorAll('.group-tile')].find(n=>n.textContent.includes('Focus work')).querySelector('button').click();`,
  );
  assert.equal(
    await read(`return root.querySelector('.selection-toolbar strong').textContent;`),
    '2 selected',
  );
  await click('Rename group');
  await read(
    `root.querySelector('.group-rename input').value='Writing';root.querySelector('.group-rename').requestSubmit();`,
  );
  await waitFor(
    `return [...root.querySelectorAll('.group-tile')].some(n=>n.textContent.includes('Writing'));`,
  );
  await click('Ungroup');
  await waitFor(
    `return ![...root.querySelectorAll('.group-tile')].some(n=>n.textContent.includes('Writing'));`,
  );
  assert(
    (await rpc('load')).tabs
      .filter((t) => testTabs.some((x) => x.id === t.id))
      .every((t) => t.groupId === -1),
  );
  await click('Group');
  await waitFor(`return !root.querySelector('.group-rename').hidden;`);
  await click('Cancel');
  await click('Close tabs');
  await waitFor(
    `return root.querySelector('.selection-toolbar strong').textContent==='Select tabs or groups';`,
  );
  assert((await rpc('load')).tabs.every((t) => !testTabs.some((x) => x.id === t.id)));
  assert(await read('return !!root.querySelector(".task-view");'));
  await click('Undo');
  await waitFor(
    `return [...root.querySelectorAll('.group-tile')].some(n=>n.textContent.includes('2 tabs'));`,
  );
  results.push(
    'Select mode groups multiple tabs, renames inline, selects whole groups, ungroups, closes groups and undoes closure without leaving the overlay',
  );
  await read(
    `root.querySelector('#quick-search').focus();root.querySelector('#quick-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`,
  );
  assert(
    await read(
      `return root.querySelector('.selection-toolbar').hidden && !!root.querySelector('.task-view');`,
    ),
  );
  await nativePage.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await read(`root.querySelector('#quick-search').dispatchEvent(new Event('input'));`);
  assert(
    await read(
      `const b=root.querySelector('.task-view').getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight;`,
    ),
  );
  await screenshot('switcher-narrow');
  await nativePage.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await read(`root.querySelector('#quick-search').dispatchEvent(new Event('input'));`);
  results.push('Escape exits selection first; narrow floating layout stays within the viewport');
}
