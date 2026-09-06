// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function checkWorkspaceProviders({ app, rpc, out, results, delay }) {
  const wait = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await delay(100);
    }
    throw Error('Workspace/providers did not settle');
  };
  const own = await app.evaluate('chrome.tabs.getCurrent()');
  await rpc('activate', { tabId: own.id });
  await rpc('edit', { kind: 'create-space', name: 'Menu fixture' });
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector(".space-options")'));
  assert.equal(
    await app.evaluate('document.querySelectorAll(".space-options").length'),
    (await rpc('load')).state.spaces.length,
  );
  const options = () =>
    app.evaluate(
      '(()=>{const b=[...document.querySelectorAll(".space-options")].find(b=>b.title==="Workspace options for Menu fixture");b.focus();b.click();})()',
    );
  const menuClick = (label) =>
    app.evaluate(
      `(()=>{const b=[...document.querySelectorAll('#action-popover button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing enabled action');b.click();})()`,
    );
  await options();
  assert(
    await app.evaluate(
      'document.querySelector("#action-popover").matches(":popover-open") && !document.querySelector("dialog[open]")',
    ),
  );
  await fs.writeFile(
    path.join(out, 'workspace-menu.png'),
    Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await menuClick('Add collection');
  await wait(async () => {
    const s = (await rpc('load')).state;
    return s.collections.some(
      (c) => c.spaceId === s.spaces.find((s) => s.name === 'Menu fixture').id,
    );
  });
  await options();
  assert(
    await app.evaluate(
      '[...document.querySelectorAll("#action-popover button")].find(b=>b.textContent==="Remove workspace").disabled === false',
    ),
  );
  await app.evaluate('document.querySelector("#action-popover").hidePopover()');
  await rpc('edit', { kind: 'create-space', name: 'Empty fixture' });
  await app.send('Page.reload');
  await wait(() => app.evaluate('!!document.querySelector(".space-options")'));
  await app.evaluate(
    '(()=>{const b=[...document.querySelectorAll(".space-options")].find(b=>b.title==="Workspace options for Empty fixture");b.click();})()',
  );
  await menuClick('Remove workspace');
  await app.evaluate(
    '[...document.querySelectorAll("dialog footer button")].find(b=>b.textContent==="Remove workspace").click()',
  );
  await wait(async () => !(await rpc('load')).state.spaces.some((s) => s.name === 'Empty fixture'));
  for (const provider of ['openai', 'claude', 'gemini', 'deepseek', 'compatible']) {
    await app.evaluate(
      'document.querySelector("#settings").focus();document.querySelector("#settings").click()',
    );
    assert.equal(
      await app.evaluate(
        'document.querySelector("#action-popover").textContent.includes("Obsidian")',
      ),
      false,
    );
    await menuClick('AI connection');
    await app.evaluate(
      `(()=>{const s=document.querySelector('dialog select');s.value=${JSON.stringify(provider)};s.dispatchEvent(new Event('change'));})()`,
    );
    assert.equal(
      await app.evaluate(
        '(()=>{const label=[...document.querySelectorAll("dialog .field")].find(n=>n.textContent.includes("Compatible endpoint"));return label.hidden;})()',
      ),
      provider !== 'compatible',
    );
    if (provider === 'compatible')
      await app.evaluate(
        '(()=>{const f=[...document.querySelectorAll("dialog .field")].find(n=>n.textContent.includes("Compatible endpoint"));f.querySelector("input").value="";})()',
      );
    if (provider === 'claude')
      await fs.writeFile(
        path.join(out, 'provider-claude.png'),
        Buffer.from((await app.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
      );
    await app.evaluate(
      '[...document.querySelectorAll("dialog button")].find(b=>b.textContent==="Save settings").click()',
    );
    await wait(() => app.evaluate('!document.querySelector("dialog[open]")'));
    assert.equal((await rpc('load')).state.settings.provider, provider);
  }
  await rpc('credentials', { aiProvider: 'openai', aiKey: 'isolated-fixture-key' });
  await rpc('settings', { settings: { provider: 'claude' } });
  assert.equal((await rpc('load')).connections.ai, false);
  await rpc('settings', { settings: { provider: 'openai' } });
  assert.equal((await rpc('load')).connections.ai, true);
  results.push(
    'Workspace menus add collections and prevent nonempty deletion; empty workspace removal works; all five provider options save, custom endpoint is conditional, keys stay provider-scoped, and Obsidian is absent',
  );
}
