// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkPolish({ app, rpc, out, results, delay }) {
  const tab = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: tab.id });
  const record = {
    id: 'long-ui',
    name: 'Long research collection',
    color: 'mint',
    note: 'An existing note',
    groups: [{ id: 'long-group', name: 'Research sources', collapsed: false }],
    links: Array.from({ length: 105 }, (_, i) => ({
      id: 'long-' + i,
      title: 'Research source ' + i,
      url: 'https://example.org/paper/' + i,
      groupId: 'long-group',
    })),
  };
  await rpc('import', { collections: [record] });
  await delay(250);
  const c = (await rpc('load')).state.collections.find((c) => c.name === record.name);
  const scope = `document.querySelector('[data-collection-id="${c.id}"]')`;
  for (let i = 0; i < 30 && !(await app.evaluate(`!!${scope}`)); i++) await delay(100);
  assert.equal(await app.evaluate(`${scope}.querySelectorAll('.saved-row').length`), 8);
  await app.evaluate(`${scope}.querySelector('.more-links').click()`);
  assert.equal(await app.evaluate(`${scope}.querySelectorAll('.saved-row').length`), 80);
  await app.evaluate(`${scope}.querySelector('.more-links').click()`);
  assert.equal(await app.evaluate(`${scope}.querySelectorAll('.saved-row').length`), 105);
  assert(!(await app.evaluate(`${scope}.textContent.includes('Group options')`)));
  results.push(
    'Long saved groups are fully browsable; group actions use a quiet accessible header menu',
  );

  await app.evaluate(
    `(()=>{const note=${scope}.querySelector('textarea');note.focus();note.value='Unfinished typing survives live refresh';note.setSelectionRange(12,12);})()`,
  );
  await rpc('settings', { settings: { tabSort: 'position' } });
  await delay(300);
  assert.equal(
    await app.evaluate('document.activeElement.value'),
    'Unfinished typing survives live refresh',
  );
  assert.equal(await app.evaluate('document.activeElement.selectionStart'), 12);
  // Commit the draft explicitly before testing group focus.
  await app.evaluate(`document.activeElement.dispatchEvent(new Event('change',{bubbles:true}))`);
  await delay(250);
  await app.evaluate(`${scope}.querySelector('.group-toggle').focus()`);
  await app.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    unmodifiedText: '\r',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await app.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  for (
    let i = 0;
    i < 30 &&
    (await app.evaluate(
      `${scope}.querySelector('.group-toggle').getAttribute('aria-expanded')==='true'`,
    ));
    i++
  )
    await delay(100);
  assert.equal(await app.evaluate('document.activeElement.className'), 'group-toggle');
  assert.equal(await app.evaluate('document.activeElement.getAttribute("aria-expanded")'), 'false');
  results.push(
    'Live refresh preserves typed notes/caret; keyboard collapse preserves group-header focus',
  );

  await app.evaluate(`document.querySelector('#breadcrumbs button').click()`);
  await app.evaluate(
    `(()=>{const rows=[...document.querySelectorAll('.tab-row')];rows[0].querySelector('.tab-select').click();rows[1].querySelector('.tab-open').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));})()`,
  );
  const selected = await app.evaluate('document.querySelectorAll(".tab-row.selected").length');
  await app.evaluate(
    `document.querySelectorAll('.tab-row')[2].querySelector('.tab-open').dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true}))`,
  );
  assert.equal(
    Math.abs(
      (await app.evaluate('document.querySelectorAll(".tab-row.selected").length')) - selected,
    ),
    1,
  );
  results.push('Ctrl/Cmd selection toggles one displayed tab without opening it');

  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 500,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await delay(200);
  assert.equal(await app.evaluate('document.documentElement.scrollWidth>innerWidth'), false);
  const shot = await app.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(out, 'compact-2x.png'), Buffer.from(shot.data, 'base64'));
  await app.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await rpc('edit', { kind: 'delete-collection', collectionId: c.id });
  await delay(200);
  results.push('Compact high-density display reflows without horizontal overflow');
}
