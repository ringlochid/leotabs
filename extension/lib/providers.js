// SPDX-License-Identifier: MPL-2.0
export const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    model: 'gpt-5-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  claude: {
    name: 'Claude (Anthropic)',
    model: 'claude-sonnet-5',
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  gemini: {
    name: 'Gemini (Google)',
    model: 'gemini-2.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com',
  },
  deepseek: {
    name: 'DeepSeek',
    model: 'deepseek-v4-flash',
    endpoint: 'https://api.deepseek.com/chat/completions',
  },
  compatible: { name: 'Other / OpenAI-compatible', model: '', endpoint: '' },
};
export function providerEndpoint(settings) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw Error('Choose a supported AI provider.');
  return settings.provider === 'compatible' ? settings.aiEndpoint : provider.endpoint;
}
export function aiConnectionId(settings) {
  return settings.provider === 'compatible'
    ? 'compatible:' + settings.aiEndpoint
    : settings.provider;
}
export async function readAIKeys(storage, settings) {
  const saved = await storage.get(['aiKeys', 'aiKey']);
  if (saved.aiKeys) return saved.aiKeys;
  const keys = saved.aiKey ? { [aiConnectionId(settings)]: saved.aiKey } : {};
  await storage.set({ aiKeys: keys });
  return keys;
}
