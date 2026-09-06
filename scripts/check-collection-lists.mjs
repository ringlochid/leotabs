import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkCollectionLists({
  app,
  rpc,
  out,
  results,
  delay,
  origin,
  extensionOrigin,
}) {
  const wait = async (fn) => {
    for (let i = 0; i < 60; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Collection picker did not settle');
  };
  const shot = async (name) => {
    await app.send('Page.bringToFront');
    await fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  };
  const click = (label) =>
    app.evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`,
    );
  await rpc('import', {
    collections: ['mint', 'blue', 'rose', 'teal', 'lavender', 'yellow'].map((color, i) => ({
      id: 'list-' + i,
      name: 'Picker ' + ['Research', 'Design', 'Writing', 'Reading', 'Archive', 'Ideas'][i],
      color,
      groups: [],
      links: [{ id: 'page-' + i, title: 'Saved page ' + i, url: origin + '/list-' + i }],
    })),
  });
  let state = (await rpc('load')).state;
  const src = state.collections.find((c) => c.name === 'Picker Research'),
    dest = state.collections.find((c) => c.name === 'Picker Design');
  await rpc('settings', { settings: { theme: 'light' } });
  await app.send('Page.navigate', { url: extensionOrigin + '/app.html' });
  await wait(() => app.evaluate('!!document.querySelector("#switch-collection")?.onclick'));
  await app.evaluate(
    'document.querySelector("#switch-collection").focus();document.querySelector("#switch-collection").click()',
  );
  await shot('collection-switch-light');
  const geometry = await app.evaluate(
    `(()=>{const list=document.querySelector('.switch-choices');const r=[...list.querySelectorAll('button')].map(x=>x.getBoundingClientRect());return {gap:r[1].top-r[0].bottom,width:r[0].width,listWidth:list.clientWidth,overflow:list.scrollWidth>list.clientWidth}})()`,
  );
  assert(geometry.gap >= 7 && !geometry.overflow);
  await app.evaluate('document.querySelector("#action-popover").hidePopover()');
  await app.evaluate(
    `document.querySelector('[data-collection-id="${src.id}"] .collection-select').click()`,
  );
  await app.evaluate(
    `document.querySelector('[data-collection-id="${src.id}"] .saved-row input').click()`,
  );
  await click('Move to…');
  await shot('collection-move-light');
  assert(
    !(await app.evaluate(
      `!!document.querySelector('#action-popover button[aria-label="Picker Research"]')`,
    )),
  );
  await app.evaluate(
    `(()=>{const s=document.querySelector('#action-popover input');s.value='Picker Design';s.dispatchEvent(new Event('input'));})()`,
  );
  assert.equal(
    await app.evaluate('document.querySelectorAll("#action-popover .collection-choice").length'),
    1,
  );
  await app.evaluate('document.querySelector("#action-popover .collection-choice").click()');
  await wait(
    async () =>
      (await rpc('load')).state.collections.find((c) => c.id === dest.id).links.length === 2,
  );
  assert.equal((await rpc('load')).state.collections.find((c) => c.id === src.id).links.length, 0);
  for (const theme of ['light', 'dark']) {
    await rpc('settings', { settings: { theme } });
    await app.send('Page.navigate', { url: extensionOrigin + '/quick.html' });
    await wait(() => app.evaluate('!!document.querySelector("button[aria-label=Collections]")'));
    await click('Collections');
    await shot('collection-overlay-' + theme);
    const gaps = await app.evaluate(
      `(()=>{const rows=[...document.querySelectorAll('.collection-result')].map(x=>x.getBoundingClientRect());return rows.slice(1).map((r,i)=>r.top-rows[i].bottom)})()`,
    );
    assert(gaps.every((g) => g >= 7));
  }
  results.push(
    'Collection pickers share spaced full-width coloured rows; Move search excludes source and moves selected links; light/dark overlay lists retain gaps',
  );
}
