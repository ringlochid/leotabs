// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS,
  providerEndpoint,
  readAIKeys,
  aiConnectionId,
} from '../extension/lib/providers.js';
import { organize } from '../extension/lib/integrations.js';
import { newCollection } from '../extension/lib/model.js';
import { sanitizeSettings, portableSettings } from '../extension/lib/settings.js';
for (const provider of ['openai', 'claude', 'gemini', 'deepseek']) {
  test(`${provider} uses its own request protocol and validates the result`, async () => {
    const c = newCollection('Test');
    c.links.push({ id: 'known', title: 'Test', url: 'https://example.org', note: '' });
    const result = JSON.stringify({ groups: [{ name: 'Test', linkIds: ['known'] }], note: '' });
    let call;
    const plan = await organize(
      c,
      'Group these',
      { provider, model: PROVIDERS[provider].model, aiEndpoint: 'https://wrong.example/v1' },
      'fixture-key',
      async (url, options) => {
        call = { url, options };
        const body =
          provider === 'claude'
            ? {
                content: [
                  { type: 'thinking', thinking: 'ignore' },
                  { type: 'text', text: result },
                ],
              }
            : provider === 'gemini'
              ? { candidates: [{ content: { parts: [{ text: result }] } }] }
              : { choices: [{ message: { content: result } }] };
        return { ok: true, text: async () => JSON.stringify(body) };
      },
    );
    assert.equal(new URL(call.url).origin, new URL(PROVIDERS[provider].endpoint).origin);
    assert.equal(call.options.redirect, 'error');
    const body = JSON.parse(call.options.body);
    if (provider === 'claude') {
      assert.equal(call.options.headers['x-api-key'], 'fixture-key');
      assert.equal(body.max_tokens, 8192);
      assert.equal(body.response_format, undefined);
    } else if (provider !== 'gemini') {
      assert.equal(call.options.headers.Authorization, 'Bearer fixture-key');
      assert.equal(body.response_format.type, 'json_object');
    }
    assert.deepEqual(plan.groups[0].linkIds, ['known']);
    assert.equal(sanitizeSettings({ provider }).provider, provider);
  });
}
test('legacy key is migrated once and never follows a different provider or custom endpoint', async () => {
  const saved = { aiKey: 'legacy-fixture' };
  const storage = {
    get: async () => structuredClone(saved),
    set: async (value) => Object.assign(saved, value),
  };
  let keys = await readAIKeys(storage, { provider: 'gemini' });
  assert.equal(keys.gemini, 'legacy-fixture');
  keys = await readAIKeys(storage, { provider: 'claude' });
  assert.equal(keys.claude, undefined);
  keys.gemini = '';
  await storage.set({ aiKeys: keys });
  assert.equal((await readAIKeys(storage, { provider: 'gemini' })).gemini, '');
  assert.notEqual(
    aiConnectionId({ provider: 'compatible', aiEndpoint: 'https://a.example/api' }),
    aiConnectionId({ provider: 'compatible', aiEndpoint: 'https://b.example/api' }),
  );
  assert.throws(() => providerEndpoint({ provider: 'unknown' }));
});
test('backups omit obsolete Obsidian configuration and credentials', () => {
  const s = portableSettings({
    provider: 'claude',
    obsidianVault: 'obsolete',
    aiKeys: { claude: 'secret' },
  });
  assert.equal(s.provider, 'claude');
  assert.equal(s.obsidianVault, undefined);
  assert.equal(s.aiKeys, undefined);
});
