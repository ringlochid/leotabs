// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkIntegrations({
  app,
  rpc,
  connect,
  targets,
  extensionOrigin,
  results,
  out,
}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers':
          'content-type, authorization, x-goog-api-key, notion-version',
      });
      return res.end();
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    requests.push({ path: req.url, origin: req.headers.origin, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/notion-create')
      return res.end(
        JSON.stringify({ id: 'b'.repeat(32), url: 'https://app.notion.com/p/' + 'b'.repeat(32) }),
      );
    if (req.url === '/notion-append') return res.end(JSON.stringify({ results: body.children }));
    if (req.url === '/notion-failure') {
      res.statusCode = 503;
      return res.end('{}');
    }
    const prompt =
      req.url === '/gemini' ? body.contents[0].parts[0].text : body.messages[0].content;
    const links = JSON.parse(prompt.slice(prompt.indexOf('\nData: ') + 7));
    const text = JSON.stringify({
      groups: links.slice(0, 2).map((l, i) => ({ name: 'Suggested ' + i, linkIds: [l.id] })),
      note: 'A suggested continuation',
    });
    res.end(
      JSON.stringify(
        req.url === '/gemini'
          ? { candidates: [{ content: { parts: [{ text }] } }] }
          : { choices: [{ message: { content: text } }] },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  try {
    const fixture = {
      name: 'Adapter fixture',
      groups: [],
      note: 'Original continuation',
      links: [0, 1, 2].map((i) => ({
        id: 'input-' + i,
        title: 'Fixture link ' + i,
        url: 'https://example.org/integration/' + i,
        note: i === 2 ? 'Not in the reviewed selection' : '',
        groupId: null,
      })),
    };
    await rpc('import', { collections: [fixture] });
    let c = (await rpc('load')).state.collections.find((c) => c.name === fixture.name);
    await assert.rejects(
      rpc('ai-plan', { collectionId: c.id, instruction: 'group' }),
      /Enable this connection/,
    );
    await assert.rejects(rpc('bookmarks-read'), /Enable this connection/);
    assert.equal(requests.length, 0);
    results.push(
      'Optional AI/bookmark calls fail before network or data access when permission is absent',
    );
    const adapterPage = app;
    const plans = [];
    for (const provider of ['gemini', 'compatible']) {
      const plan = await adapterPage.evaluate(`(async()=>{
        const {organize}=await import('./lib/integrations.js');const {initialState}=await import('./lib/model.js');
        const settings={...initialState().settings,provider:${JSON.stringify(provider)},aiEndpoint:${JSON.stringify(local + '/compatible')},model:'fixture-model'};
        return organize(${JSON.stringify(c)},'Group reviewed links',settings,'fixture-ai-token',
          (url,options)=>fetch(${JSON.stringify(local + '/' + provider)},options),{linkIds:${JSON.stringify(c.links.slice(0, 2).map((l) => l.id))}});
      })()`);
      plans.push(plan);
    }
    assert.equal(requests.length, 2);
    assert(!JSON.stringify(requests).includes('Not in the reviewed selection'));
    assert(requests.every((r) => r.origin === extensionOrigin));
    assert.equal(requests[0].headers['x-goog-api-key'], 'fixture-ai-token');
    assert.equal(requests[1].headers.authorization, 'Bearer fixture-ai-token');
    results.push(
      'Both AI adapters send only reviewed metadata over real HTTP from the extension origin to local fixtures',
    );
    await rpc('edit', { kind: 'collection', collectionId: c.id, note: 'A newer continuation' });
    await assert.rejects(rpc('ai-apply', { plan: plans[0], applyNote: true }), /changed after/);
    c = (await rpc('load')).state.collections.find((x) => x.id === c.id);
    const current = await adapterPage.evaluate(
      `(async()=>{const {validatePlan}=await import('./lib/model.js');return validatePlan(${JSON.stringify(plans[0])},${JSON.stringify(c)});})()`,
    );
    current.groups[0].name = 'Reviewed name';
    current.groups[1].accepted = false;
    const applied = await rpc('ai-apply', { plan: current, applyNote: false });
    const changed = (await rpc('load')).state.collections.find((x) => x.id === c.id);
    assert.equal(changed.groups.length, 1);
    assert.equal(changed.groups[0].name, 'Reviewed name');
    assert.equal(changed.links[1].groupId, null);
    assert.equal(changed.note, 'A newer continuation');
    await rpc('undo-action', { id: applied.operation.id });
    assert.equal((await rpc('load')).state.collections.find((x) => x.id === c.id).groups.length, 0);
    results.push(
      'Actual worker rejects stale AI plans, applies only accepted groups and supports durable Undo',
    );

    const notion = await adapterPage.evaluate(`(async()=>{
      const {prepareNotion,notionStep}=await import('./lib/notion.js'),db=await import('./lib/db.js');
      const snapshot=${JSON.stringify(c)};snapshot.links=Array.from({length:121},(_,i)=>({...snapshot.links[0],id:String(i),url:'https://example.org/large/'+i,note:''}));
      let job=prepareNotion(snapshot,'a'.repeat(32)),clock=Date.now();
      while(job.status!=='complete')job=await notionStep(job,'fixture-notion-token',{now:()=>clock+=1000,save:j=>db.write('journal',j),fetcher:(url,options)=>fetch(${JSON.stringify(local)}+(options.method==='POST'?'/notion-create':'/notion-append'),options)});
      return db.journalSummary(job);
    })()`);
    assert.equal(notion.cursor, 122);
    assert.equal(notion.status, 'complete');
    assert(!notion.blocks);
    assert.deepEqual(
      requests.filter((r) => r.path.startsWith('/notion')).map((r) => r.body.children.length),
      [100, 22],
    );
    assert(
      requests
        .filter((r) => r.path.startsWith('/notion'))
        .every((r) => r.headers['notion-version'] === '2026-03-11'),
    );
    const load = await rpc('load');
    assert(!JSON.stringify(load).includes('fixture-notion-token'));
    assert(!JSON.stringify(load).includes('fixture-ai-token'));
    results.push(
      'Notion batches complete over extension-origin fixture HTTP; local journal progress excludes credentials and block payloads',
    );

    const failure = await adapterPage.evaluate(
      `(async()=>{const {prepareNotion,notionStep}=await import('./lib/notion.js'),db=await import('./lib/db.js');return notionStep(prepareNotion(${JSON.stringify(c)},'a'.repeat(32)),'fixture-token',{save:j=>db.write('journal',j),fetcher:(url,options)=>fetch(${JSON.stringify(local + '/notion-failure')},options)});})()`,
    );
    assert.equal(failure.status, 'uncertain');
    assert(
      (await rpc('load')).journal.some((j) => j.id === failure.id && j.status === 'uncertain'),
    );
    results.push('Notion server failure remains visibly uncertain in the durable recovery log');
    // Fixtures use dummy keys only; record request sizes/origins, not their bodies.
    await fs.writeFile(
      path.join(out, 'adapter-http.json'),
      JSON.stringify(
        requests.map((r) => ({
          path: r.path,
          origin: r.origin,
          bytes: Buffer.byteLength(JSON.stringify(r.body)),
          notionVersion: r.headers['notion-version'],
        })),
        null,
        2,
      ),
    );
    await rpc('edit', { kind: 'delete-collection', collectionId: c.id });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
