// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkSettingsUX({ app, rpc, out, results, delay }) {
  const wait = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Settings did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector("#settings")?.onclick'));
  const shot = async (name) =>
    fs.writeFile(
      path.join(out, name + '.png'),
      Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    );
  const open = () =>
    app.evaluate(
      'document.querySelector("#settings").focus();document.querySelector("#settings").click()',
    );
  const click = (label) =>
    app.evaluate(
      `(()=>{const b=[...document.querySelectorAll('#action-popover button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing menu action');b.click();})()`,
    );
  assert(
    await app.evaluate(
      '!!document.querySelector(".head-actions > #settings") && !document.querySelector(".brand #settings")',
    ),
  );
  await open();
  assert.equal(await app.evaluate('!!document.querySelector("dialog[open]")'), false);
  await app.evaluate(
    '(()=>{const s=document.querySelector(".settings-list select");s.value="dark";s.dispatchEvent(new Event("change"));})()',
  );
  await wait(async () => (await rpc('load')).state.settings.theme === 'dark');
  assert(await app.evaluate('document.querySelector("#action-popover").matches(":popover-open")'));
  await shot('settings-menu');
  const previous = (await rpc('load')).state.settings.currentWindowOnly;
  await app.evaluate('document.querySelector("input[role=switch]").click()');
  await wait(async () => (await rpc('load')).state.settings.currentWindowOnly !== previous);
  await click('AI connection');
  assert(
    await app.evaluate(
      'document.querySelector("dialog h2").textContent==="AI connection" && document.querySelectorAll("dialog .settings-section").length===1',
    ),
  );
  assert.equal(
    await app.evaluate(
      'document.querySelector("dialog").textContent.includes("Notion integration token")',
    ),
    false,
  );
  await shot('settings-ai');
  const before = (await rpc('load')).state.settings;
  await app.evaluate(
    '(()=>{const field=[...document.querySelectorAll("dialog .field")].find(n=>n.querySelector("span").textContent==="Model");field.querySelector("input").value="settings-ui-test";[...document.querySelectorAll("dialog button")].find(b=>b.textContent==="Save settings").click();})()',
  );
  await wait(() => app.evaluate('!document.querySelector("dialog[open]")'));
  const after = (await rpc('load')).state.settings;
  assert.equal(after.model, 'settings-ui-test');
  assert.deepEqual(after.rules, before.rules);
  assert.equal(after.theme, 'dark');
  assert.equal(after.currentWindowOnly, !previous);
  await open();
  await click('Import data');
  assert(
    await app.evaluate(
      'document.querySelector("dialog h2").textContent==="Import data" && !document.querySelector("dialog details").open',
    ),
  );
  await app.evaluate('document.querySelector("dialog summary").click()');
  assert(await app.evaluate('document.querySelector("dialog details").open'));
  await shot('settings-import');
  await app.evaluate(
    '(()=>{const b=[...document.querySelectorAll("dialog button")].find(b=>b.textContent==="Switch to Export & backup");b.click();})()',
  );
  assert(await app.evaluate('document.querySelector("dialog h2").textContent==="Export & backup"'));
  await shot('settings-backup');
  await app.evaluate('document.querySelector("dialog").close()');
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector("#settings")?.onclick'));
  assert.equal((await rpc('load')).state.settings.theme, 'dark');
  await open();
  await app.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  });
  assert(
    await app.evaluate(
      '!document.querySelector("#action-popover") && document.activeElement.id==="settings"',
    ),
  );
  results.push(
    'Settings: top-right anchored menu, immediate persistent theme/scope preferences, focused AI save preserving unrelated preferences, import/file expansion, backup dialog, and Escape focus return',
  );
}
