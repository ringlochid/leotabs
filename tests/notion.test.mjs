// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNotion, notionStep, notionBatch, NOTION_VERSION } from '../extension/lib/notion.js';
import { newCollection } from '../extension/lib/model.js';
const parent = 'a'.repeat(32),
  page = 'b'.repeat(32);
function collection(count = 1) {
  const c = newCollection('Research');
  c.links = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    title: 'Link ' + i,
    url: 'https://example.org/' + i,
    note: '',
    groupId: null,
  }));
  return c;
}
const ok = (value) => new Response(JSON.stringify(value), { status: 200 });
test('Notion sends 251 links in three bounded batches with durable checkpoints', async () => {
  let job = prepareNotion(collection(251), parent),
    stored,
    calls = [];
  const save = async (value) => {
    stored = structuredClone(value);
  };
  const fetcher = async (url, options) => {
    assert.equal(stored.status, 'sending');
    assert(stored.pending);
    assert(!JSON.stringify(stored).includes('test-secret'));
    assert.equal(options.headers['Notion-Version'], NOTION_VERSION);
    const body = JSON.parse(options.body);
    calls.push({ url, method: options.method, count: body.children.length });
    return options.method === 'POST'
      ? ok({ id: page, url: 'https://app.notion.com/p/' + page })
      : ok({ results: body.children });
  };
  while (job.status !== 'complete')
    job = await notionStep(job, 'test-secret', { save, fetcher, now: () => Date.now() + 100000 });
  assert.deepEqual(
    calls.map((c) => c.count),
    [100, 100, 51],
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    ['POST', 'PATCH', 'PATCH'],
  );
  assert(calls[1].url.includes(page));
  assert.equal(stored.cursor, 251);
});
test('Notion batches also stay below byte limit with long Unicode notes', () => {
  const c = collection(100);
  c.links.forEach((l) => (l.note = '研究'.repeat(5000)));
  const job = prepareNotion(c, parent),
    batch = notionBatch(job);
  assert(batch.length < 100);
  assert(new TextEncoder().encode(JSON.stringify(batch)).length <= 400000);
});
test('Notion validates local URLs and parent before any remote operation', () => {
  assert.throws(() => prepareNotion(collection(), '-'.repeat(32)), /valid/);
  const c = collection();
  c.links[0].url = 'file:///C:/private.txt';
  assert.throws(() => prepareNotion(c, parent), /web URLs/);
});
test('Notion database failure prevents first HTTP write', async () => {
  let calls = 0;
  await assert.rejects(
    notionStep(prepareNotion(collection(), parent), 'k', {
      save: async () => {
        throw Error('disk full');
      },
      fetcher: async () => calls++,
    }),
    /disk full/,
  );
  assert.equal(calls, 0);
});
test('lost POST response becomes uncertain and cannot create a duplicate page', async () => {
  let calls = 0;
  const save = async () => {},
    fetcher = async () => {
      calls++;
      throw Error('connection lost');
    };
  const job = await notionStep(prepareNotion(collection(), parent), 'k', { save, fetcher });
  assert.equal(job.status, 'uncertain');
  await assert.rejects(notionStep(job, 'k', { save, fetcher }), /may already/);
  assert.equal(calls, 1);
});
test('worker restart with persisted sending state never replays it', async () => {
  const job = prepareNotion(collection(), parent);
  job.status = 'sending';
  job.pending = { start: 0, count: 1 };
  let calls = 0;
  await assert.rejects(
    notionStep(job, 'k', { save: async () => {}, fetcher: async () => calls++ }),
    /may already/,
  );
  assert.equal(calls, 0);
});
test('Notion rate limits respect Retry-After and cap automatic retries', async () => {
  let job = prepareNotion(collection(), parent),
    now = 1000,
    calls = 0;
  const options = {
    save: async () => {},
    now: () => now,
    fetcher: async () => {
      calls++;
      return new Response('', { status: 429, headers: { 'Retry-After': '15' } });
    },
  };
  job = await notionStep(job, 'k', options);
  assert.equal(job.status, 'waiting');
  assert(job.retryAt >= now + 15000);
  await notionStep(job, 'k', options);
  assert.equal(calls, 1);
  now = job.retryAt;
  job = await notionStep(job, 'k', options);
  now = job.retryAt;
  job = await notionStep(job, 'k', options);
  assert.equal(calls, 3);
  assert.equal(job.status, 'failed');
});
test('Notion acknowledges prior batches before a rejected append, allowing safe continuation', async () => {
  let job = prepareNotion(collection(101), parent);
  const save = async () => {};
  job = await notionStep(job, 'k', { save, fetcher: async () => ok({ id: page }), now: () => 0 });
  job = await notionStep(job, 'k', {
    save,
    fetcher: async () => new Response('', { status: 403 }),
    now: () => 1000,
  });
  assert.equal(job.status, 'partial');
  assert.equal(job.cursor, 100);
  assert.equal(job.pending, null);
  job = await notionStep(job, 'k', {
    save,
    fetcher: async (url, options) => {
      assert.equal(JSON.parse(options.body).children[0].bookmark.url, 'https://example.org/100');
      return ok({ results: [{}] });
    },
    now: () => 2000,
  });
  assert.equal(job.status, 'complete');
});
test('Notion does not retry server errors or malformed success responses', async () => {
  for (const response of [new Response('', { status: 503 }), ok({ id: 'bad' })]) {
    const job = await notionStep(prepareNotion(collection(), parent), 'k', {
      save: async () => {},
      fetcher: async () => response,
    });
    assert.equal(job.status, 'uncertain');
  }
});
