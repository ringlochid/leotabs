// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import http from 'node:http';

export async function checkConnections({ app, rpc, results, delay, notionCalls }) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST,PATCH,OPTIONS',
      });
      return res.end();
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls.push({ path: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/notion-create')
      return res.end(
        JSON.stringify({ id: 'c'.repeat(32), url: 'https://app.notion.com/p/' + 'c'.repeat(32) }),
      );
    if (req.url === '/notion-append') return res.end(JSON.stringify({ results: body.children }));
    const prompt = body.messages[0].content,
      data = JSON.parse(prompt.slice(prompt.indexOf('\nData: ') + 7));
    if (prompt.includes('SLOW_FIXTURE')) await delay(1200);
    const plan = {
      groups: data.slice(0, 2).map((l, i) => ({ name: 'Suggested ' + i, linkIds: [l.id] })),
      note: 'Suggested next step',
    };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  try {
    const tab = await app.evaluate('chrome.tabs.getCurrent()');
    await rpc('activate', { tabId: tab.id });
    await rpc('settings', {
      settings: {
        provider: 'compatible',
        aiEndpoint: local + '/chat/completions',
        model: 'fixture-model',
        notionParent: 'a'.repeat(32),
      },
    });
    await rpc('credentials', { aiKey: 'fixture-only-ai', notionKey: 'fixture-only-notion' });
    const imported = await rpc('import', {
      collections: [
        {
          name: 'Connection UI fixture',
          note: 'Original continuation',
          groups: [],
          links: Array.from({ length: 121 }, (_, i) => ({
            id: 'c' + i,
            title: 'Fixture ' + i,
            url: 'https://example.org/connection/' + i,
            groupId: null,
          })),
        },
      ],
    });
    const c = imported.state.collections.at(-1);
    const wait = async (predicate) => {
      for (let i = 0; i < 80; i++) {
        if (await predicate()) return;
        await delay(50);
      }
      console.log('Connection diagnostic', {
        dialog: await app.evaluate('document.querySelector("#dialog")?.textContent'),
        toast: await app.evaluate('document.querySelector("#toast")?.textContent'),
        jobs: (await rpc('load')).journal.filter((op) => op.kind === 'notion'),
        requests: calls.map((c) => c.path),
      });
      throw Error('Connection UI did not reach expected state');
    };
    const click = (label) =>
      app.evaluate(
        `[...document.querySelectorAll('#dialog button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`,
      );
    const menu = async () => {
      await wait(() => app.evaluate(`!!document.querySelector('[data-collection-id="${c.id}"]')`));
      await app.evaluate(
        `document.querySelector('[data-collection-id="${c.id}"] .collection-head .icon-button').click()`,
      );
    };
    await menu();
    await click('Organise with AI…');
    await app.evaluate(`document.querySelector('#dialog textarea').value='SLOW_FIXTURE'`);
    await click('Generate a plan');
    await wait(async () => calls.some((c) => c.path === '/chat/completions'));
    await click('Cancel');
    await delay(1400);
    assert.equal(await app.evaluate('!!document.querySelector("#dialog[open]")'), false);
    assert.equal((await rpc('load')).state.collections.find((x) => x.id === c.id).groups.length, 0);
    results.push(
      'Actual AI worker request can be cancelled from its dialog without applying a late response',
    );
    await menu();
    await click('Organise with AI…');
    await click('Generate a plan');
    await wait(() =>
      app.evaluate(
        `document.querySelector('#dialog h2')?.textContent==='Review your organisation plan'`,
      ),
    );
    await app.evaluate(
      `(()=>{const rows=document.querySelectorAll('.plan-group');const name=rows[0].querySelector('input:not([type=checkbox])');name.value='Reviewed group';name.dispatchEvent(new Event('input'));const check=rows[1].querySelector('[type=checkbox]');check.checked=false;check.dispatchEvent(new Event('change'));})()`,
    );
    await click('Apply selected changes');
    await wait(
      async () =>
        (await rpc('load')).state.collections.find((x) => x.id === c.id).groups.length === 1,
    );
    const after = (await rpc('load')).state.collections.find((x) => x.id === c.id);
    assert.equal(after.groups[0].name, 'Reviewed group');
    assert.equal(after.links[1].groupId, null);
    assert.equal(after.note, 'Original continuation');
    results.push(
      'AI generation, editable subset review and application complete through the real UI with fixture-granted host access',
    );

    await menu();
    await click('Export…');
    await click('Send to Notion…');
    await click('Create Notion page');
    await wait(async () =>
      (await rpc('load')).journal.some((op) => op.kind === 'notion' && op.cursor === 100),
    );
    await click('Pause');
    await delay(650);
    assert.equal(notionCalls.filter((c) => c.path === '/v1/pages').length, 1);
    assert.equal(notionCalls.filter((c) => c.path.endsWith('/children')).length, 0);
    await app.evaluate('document.getElementById("recovery").click()');
    await click('Continue export');
    await wait(async () =>
      (await rpc('load')).journal.some((op) => op.kind === 'notion' && op.status === 'complete'),
    );
    await wait(() =>
      app.evaluate(`document.querySelector('#dialog').textContent.includes('Snapshot exported')`),
    );
    assert.equal(notionCalls.filter((c) => c.path === '/v1/pages').length, 1);
    assert.equal(notionCalls.filter((c) => c.path.endsWith('/children')).length, 1);
    await click('Done');
    results.push(
      'Notion UI pauses after a confirmed batch and continues the same persisted page from Recovery',
    );
    await rpc('credentials', { aiKey: '', notionKey: '' });
    await rpc('edit', { kind: 'delete-collection', collectionId: c.id });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
