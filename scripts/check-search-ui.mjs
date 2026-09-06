// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkSearchUI({
  app,
  rpc,
  connect,
  targets,
  extensionOrigin,
  windowId,
  out,
  results,
  delay,
}) {
  const sourceTabs = await app.evaluate('chrome.tabs.query({})');
  const url = extensionOrigin + '/quick.html?mode=search&window=' + windowId;
  const searchWindow = await app.evaluate(
    `chrome.windows.create({url:${JSON.stringify(url)},type:'popup',width:700,height:590})`,
  );
  let target;
  for (let i = 0; i < 30; i++) {
    target = (await targets()).find((t) => t.url === url);
    if (target) break;
    await delay(100);
  }
  assert(target, 'Standalone search opens');
  const search = await connect(target.webSocketDebuggerUrl);
  await search.send('Runtime.enable');
  for (
    let i = 0;
    i < 100 && !(await search.evaluate('!!document.querySelector("#quick-search")'));
    i++
  )
    await delay(100);
  const enter = () =>
    search.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  const type = async (value) => {
    await search.evaluate(
      `(()=>{const input=document.getElementById('quick-search');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`,
    );
    await delay(70);
  };
  const text = () => search.evaluate(`document.getElementById('quick-results').textContent`);
  await type('/');
  assert((await text()).includes('Switch collection'));
  assert(!(await text()).includes('in the library'));
  assert.equal(
    await search.evaluate(`document.getElementById('quick-search').getAttribute('role')`),
    'combobox',
  );
  results.push(
    'Standalone command bar discovers all packaged actions without opening the organiser',
  );

  await type('@Product design');
  await enter();
  await delay(70);
  assert(
    (await search.evaluate(`document.querySelector('.search-scope').textContent`)).includes(
      'Product design',
    ),
  );
  assert((await text()).includes('Interaction references'));
  const afterScope = await app.evaluate('chrome.tabs.query({})');
  assert.equal(afterScope.length, sourceTabs.length + 1);
  results.push('Multi-word collection context becomes a chip without creating destination tabs');

  await type('Evaluation');
  assert((await text()).includes('Evaluation notes'));
  await search.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowDown',
    code: 'ArrowDown',
  });
  assert.equal(await search.evaluate('document.activeElement.id'), 'quick-search');
  assert(
    await search.evaluate(
      `!!document.getElementById(document.getElementById('quick-search').getAttribute('aria-activedescendant'))`,
    ),
  );
  results.push(
    'Scoped search finds collapsed-group links and Arrow navigation retains input focus',
  );

  await type('/note');
  await enter();
  await delay(70);
  assert(
    (await search.evaluate(`document.querySelector('#dialog h2').textContent`)).includes(
      'Product design',
    ),
  );
  await search.evaluate(
    `document.querySelector('#dialog textarea').value='Continue with keyboard testing';[...document.querySelectorAll('#dialog button')].find(b=>b.textContent==='Save note').click()`,
  );
  await delay(180);
  assert.equal(
    (await rpc('load')).state.collections.find((c) => c.name === 'Product design').note,
    'Continue with keyboard testing',
  );
  assert.equal(await search.evaluate('document.querySelectorAll(".app-shell").length'), 0);
  results.push('Standalone /note edits the scoped collection through the shared durable action');

  await type('/open');
  await enter();
  await delay(60);
  assert(
    (await search.evaluate(`document.querySelector('#dialog h2').textContent`)).includes(
      'Resume Product design',
    ),
  );
  const beforeCancel = (await app.evaluate('chrome.tabs.query({})')).length;
  await search.evaluate(`document.querySelector('#dialog').close()`);
  await delay(50);
  assert.equal((await app.evaluate('chrome.tabs.query({})')).length, beforeCancel);
  results.push('Standalone /open shows selective deferred resume; cancelling changes no tabs');

  await type('/export');
  await enter();
  await delay(50);
  assert(
    (await search.evaluate(`document.querySelector('#dialog').textContent`)).includes(
      'Send to Notion',
    ),
  );
  await search.evaluate(`document.querySelector('#dialog').close()`);
  await type('/organize');
  await enter();
  await delay(50);
  assert(
    (await search.evaluate(`document.querySelector('#dialog').textContent`)).includes(
      'Send selected link titles',
    ),
  );
  await search.evaluate(`document.querySelector('#dialog').close()`);
  results.push(
    'Standalone export and AI commands open full review flows without provider requests',
  );

  await type('/history');
  await enter();
  await delay(150);
  assert(
    (await search.evaluate(`document.querySelector('.search-scope').textContent`)).includes(
      'Closed pages',
    ),
  );
  await search.evaluate(`document.querySelector('.scope-chip').click()`);
  await type('/history');
  await enter();
  await delay(100);
  assert(
    (await text()).includes('Retained closed page') || (await text()).includes('Recently closed'),
  );
  results.push('Closed-page search includes retained operation records and browser sessions');

  await type('/save');
  await enter();
  await delay(60);
  assert(
    (await search.evaluate(`document.querySelector('#action-popover h2').textContent`)).includes(
      'Save 2 tabs',
    ),
  );
  await search.evaluate(`document.querySelector('#action-popover').hidePopover()`);
  results.push(
    'Standalone save targets the original normal window, excluding pins and the search window',
  );

  await type('/');
  await search.send('Emulation.setDeviceMetricsOverride', {
    width: 700,
    height: 570,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const screenshot = await search.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    path.join(out, 'standalone-search.png'),
    Buffer.from(screenshot.data, 'base64'),
  );
  assert.equal(await search.evaluate('document.documentElement.scrollWidth>innerWidth'), false);
  assert.equal(search.events.length, 0);
  await app.evaluate(`chrome.windows.remove(${searchWindow.id})`);
}
