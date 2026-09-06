// SPDX-License-Identifier: MPL-2.0
import { uid, stamp, text } from './model.js';
import { notionBlocks } from './integrations.js';

export const NOTION_VERSION = '2026-03-11';
const pageID = /^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i;
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function prepareNotion(collection, parent) {
  if (!pageID.test(parent)) throw new Error('Enter a valid destination Notion page ID.');
  const blocks = notionBlocks(collection);
  return {
    id: uid(),
    at: stamp(),
    kind: 'notion',
    label: 'Notion export · ' + collection.name,
    status: 'ready',
    collectionId: collection.id,
    parent,
    name: collection.name,
    blocks,
    total: blocks.length,
    cursor: 0,
    attempts: 0,
  };
}
export function notionBatch(job) {
  const batch = [];
  let size = 2;
  for (const block of job.blocks.slice(job.cursor, job.cursor + 100)) {
    // Leave space for the page properties and JSON envelope, below Notion's 500 KB cap.
    const length = bytes(block) + (batch.length ? 1 : 0);
    if (size + length > 400000) break;
    batch.push(block);
    size += length;
  }
  if (!batch.length && job.cursor < job.total)
    throw new Error('A Notion block exceeds the request size limit.');
  return batch;
}

// Exactly one durable batch per invocation. A fresh worker never replays a pending write.
export async function notionStep(job, key, { save, fetcher = fetch, now = Date.now } = {}) {
  if (!key) throw new Error('Add your Notion integration token in Settings.');
  if (job.status === 'complete') return job;
  if (['sending', 'uncertain'].includes(job.status))
    throw new Error(
      'This batch may already be in Notion. Inspect the destination; Neo will not send it again.',
    );
  if (!['ready', 'waiting', 'partial', 'failed'].includes(job.status))
    throw new Error('This export cannot continue.');
  if (job.retryAt > now()) return job;
  const children = notionBatch(job),
    creating = !job.remoteId;
  const url = creating
    ? 'https://api.notion.com/v1/pages'
    : `https://api.notion.com/v1/blocks/${job.remoteId}/children`;
  const body = creating
    ? {
        parent: { page_id: job.parent },
        properties: { title: { title: [{ type: 'text', text: { content: job.name } }] } },
        children,
      }
    : { children };
  job = {
    ...job,
    status: 'sending',
    pending: { start: job.cursor, count: children.length, creating },
    error: undefined,
  };
  await save(job); // If this fails, no network write has happened.
  let response;
  try {
    response = await fetcher(url, {
      method: creating ? 'POST' : 'PATCH',
      headers: {
        Authorization: `Bearer ${key}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    job.status = 'uncertain';
    job.error = 'The response was lost. Check Notion before taking another action.';
    await save(job);
    return job;
  }
  if ([429, 529].includes(response.status)) {
    const attempts = job.attempts + 1,
      header = response.headers.get('Retry-After');
    const seconds =
      header !== null && Number.isFinite(Number(header))
        ? Math.max(0, Number(header))
        : 2 ** attempts;
    job = {
      ...job,
      status: attempts >= 3 ? (job.remoteId ? 'partial' : 'failed') : 'waiting',
      attempts,
      retryAt: now() + seconds * 1000 + 250,
      pending: null,
      error: attempts >= 3 ? 'Notion is busy. Continue this export later.' : undefined,
    };
    await save(job);
    return job;
  }
  if (!response.ok) {
    const uncertain = response.status >= 500 || response.status === 408;
    job = {
      ...job,
      status: uncertain ? 'uncertain' : job.remoteId ? 'partial' : 'failed',
      pending: uncertain ? job.pending : null,
      error: `Notion returned HTTP ${response.status}. ${uncertain ? 'The batch may have been received. Check the destination.' : 'This batch was rejected. Check the connection and destination access.'}`,
    };
    await save(job);
    return job;
  }
  try {
    const raw = await response.text();
    if (raw.length > 2 * 1024 * 1024) throw new Error('Oversized response');
    const result = JSON.parse(raw);
    if (creating) {
      if (!pageID.test(result.id)) throw new Error('Missing page ID');
      job.remoteId = result.id;
      try {
        const link = new URL(result.url);
        if (link.protocol === 'https:') job.remoteURL = link.href;
      } catch {}
    } else if (!Array.isArray(result.results) || result.results.length !== children.length)
      throw new Error('Incomplete block response');
    job.cursor += children.length;
    job.pending = null;
    job.attempts = 0;
    job.retryAt = now() + 350;
    job.status = job.cursor >= job.total ? 'complete' : 'ready';
  } catch {
    job.status = 'uncertain';
    job.error =
      'Notion returned an incomplete response. Inspect the destination before continuing.';
  }
  await save(job);
  return job;
}
