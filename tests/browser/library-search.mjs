// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkLibrarySearch({ app, rpc, out, results, delay, origin }) {
  const wait = async (fn) => {
    for (let i = 0; i < 80; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Library search did not settle');
  };
  const query = async (value) => {
    await app.evaluate(
      `(()=>{const input=document.querySelector('#tab-search');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input'));})()`,
    );
    await delay(400);
  };
  const shot = async (name) => {
    await fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('settings', { settings: { autoGroup: false } });
  await rpc('activate', { tabId: own.id });
  await app.send('Page.bringToFront');
  const imported = await rpc('import', {
    collections: [
      {
        name: 'Design references',
        collapsed: true,
        groups: [{ id: 'docs', name: 'Reading', collapsed: true }],
        links: [
          {
            id: 'match',
            title: 'Research <svg onload=alert(1)> guide',
            url: origin + '/research-saved',
            groupId: 'docs',
          },
          { id: 'other', title: 'Unrelated guide', url: origin + '/unrelated' },
        ],
      },
      { name: 'Unrelated collection', groups: [], links: [] },
    ],
  });
  const fixture = imported.state.collections.find((c) => c.name === 'Design references');
  await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/research-live')},windowId:${own.windowId},active:false})`,
  );
  const closed = await app.evaluate(
    `chrome.tabs.create({url:${JSON.stringify(origin + '/research-closed')},windowId:${own.windowId},active:false})`,
  );
  await wait(() => app.evaluate(`chrome.tabs.get(${closed.id}).then(t=>t.status==='complete'&&!t.pendingUrl)`));
  await app.evaluate(`chrome.tabs.remove(${closed.id})`);
  const granted = await app.evaluate("chrome.permissions.contains({permissions:['history']})");
  if (granted)
    await app.evaluate(
      `chrome.history.addUrl({url:${JSON.stringify(origin + '/research-visited')}})`,
    );
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector(".recent-mode")'));
  await query('research');
  assert(await app.evaluate('document.querySelectorAll("#tabs mark").length>0'));
  await wait(() => app.evaluate('document.querySelectorAll("#recent .recent-pages mark").length>0'));
  assert(await app.evaluate('document.querySelectorAll("#board mark").length>0'));
  assert(await app.evaluate('!document.querySelector("#board .row-title svg")'));
  assert(
    await app.evaluate(
      '![...document.querySelectorAll("#board .row-title")].some(e=>e.textContent==="Unrelated guide")',
    ),
  );
  assert(
    (await rpc('load')).state.collections.find((c) => c.id === fixture.id).collapsed,
    'Search must preserve fold state',
  );
  if (granted) {
    await wait(() =>
      app.evaluate(
        'document.querySelector(".history-pages")?.textContent.includes("research-visited")',
      ),
    );
    assert(
      await app.evaluate(
        '!document.querySelector(".history-pages").textContent.includes("research-closed")',
      ),
      'Deduplicate recent pages from history',
    );
    await app.evaluate(
      "(()=>{const i=document.querySelector('#tab-search');i.value='research';i.dispatchEvent(new Event('input'));setTimeout(()=>{i.value='unrelatedzz';i.dispatchEvent(new Event('input'));},190);})()",
    );
    await delay(700);
    assert(
      await app.evaluate(
        '!document.querySelector(".history-pages").textContent.includes("research")',
      ),
      'Stale history results must not reappear',
    );
    await query('research');
  } else {
    assert(await app.evaluate('!!document.querySelector(".enable-history")'));
    await assert.rejects(() => rpc('history', { query: 'research' }));
  }
  await app.evaluate('document.querySelector("#global-search").click()');
  assert(await app.evaluate('document.activeElement.id==="tab-search"'));
  await query('');
  await app.evaluate(
    `document.querySelector('[data-collection-id="${fixture.id}"] button[aria-label="Expand Design references"]').click()`,
  );
  await query('nothing-matches-this-collection');
  assert(await app.evaluate('!document.querySelector("#board .collection")'));
  await query('');
  await app.evaluate(`document.querySelector('button[aria-label="All collections"]').click()`);
  await query('research');
  await rpc('settings', { settings: { theme: 'dark' } });
  await delay(200);
  await shot('library-unified-search-dark');
  await query('');
  assert(
    await app.evaluate(
      '!![...document.querySelectorAll("#board .collection-name")].find(e=>e.textContent==="Unrelated collection")',
    ),
  );
  await app.evaluate('document.querySelector(".recent-mode").click()');
  await wait(() => app.evaluate('!!document.querySelector(".history-restore")'));
  assert(
    await app.evaluate(
      '(()=>{const b=document.querySelector(".history-restore").getBoundingClientRect(),l=document.querySelector(".history-tabs").getBoundingClientRect();return b.height>=38 && b.top>=l.bottom;})()',
    ),
  );
  assert(
    await app.evaluate(
      '!document.querySelector("#recent select") && !document.querySelector(".history-reason")',
    ),
  );
  assert(
    await app.evaluate(
      'document.querySelector("#recent h2").innerText.includes("Timeline")',
    ),
  );
  assert(
    await app.evaluate(
      'document.querySelectorAll(".timeline-page").length>0 && [...document.querySelectorAll(".timeline-page")].every(p=>p.querySelector(".favicon") && p.querySelector(".recent-page-copy small"))',
    ),
  );
  await shot('library-timeline');
  await app.evaluate('document.querySelector(".recent-mode").click()');
  await query('research');
  await rpc('settings', { settings: { theme: 'light' } });
  await delay(200);
  await shot('library-unified-search-light');
  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 760,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(300);
  assert(await app.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  assert(
    await app.evaluate(
      'document.querySelector("#sidebar").scrollWidth<=document.querySelector("#sidebar").clientWidth',
    ),
  );
  await shot('library-unified-search-compact');
  await app.send('Emulation.clearDeviceMetricsOverride');
  results.push(
    'Unified library query filters and highlights live tabs, closed pages and saved collections; safe text rendering; folded state retained; clear restores board',
  );
  results.push(
    granted
      ? 'Real Chrome history with isolated fixture permission, URL deduplication and stale-query protection'
      : 'Browser history remains optional: permission CTA shown and ungranted reads rejected',
  );
  results.push(
    'Session restore is a visible 38px action below the scrollable list; light/dark and compact layout captured',
  );
}
